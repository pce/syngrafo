#pragma once
/**
 * @file bindings/file_bindings.hh
 * @author Patrick Engel
 * @brief File-I/O domain bindings: scan, read, write, copy, move, delete,
 *        directory picker, path helpers, network path resolution,
 *        preferences (save/load to global SQLite DB).
 *
 * All exposed functions use the standard JSON envelope:
 *   success → { "ok": true,  "data": <payload> }
 *   failure → { "ok": false, "error": "<message>" }
 */

#pragma once
#include "../dms_handle.hh"
#include <saucer/modules/desktop.hpp>

// Platform services give us reveal_in_finder (NSWorkspace on macOS, stub elsewhere).
#include "../../external/nlp/addons/platform_services.hh"

namespace pce::dms {

inline void register_file_bindings(saucer::smartview& wv, DMSHandle& dms,
                                    saucer::modules::desktop& desk) {
    using std::string;

    // ── Path normalisation (strips file:// scheme + percent-decode) ───────────
    auto normalise_picker_path = [](const std::string& raw) -> std::string {
        std::string p = raw;
        if      (p.starts_with("file:///"))          p = p.substr(7);
        else if (p.starts_with("file://localhost/")) p = p.substr(16);
        else if (p.starts_with("file://"))           p = p.substr(7);
        std::string dec; dec.reserve(p.size());
        for (size_t i = 0; i < p.size(); ++i) {
            if (p[i]=='%' && i+2<p.size()) {
                auto hx=[](unsigned char c)->int{
                    if(c>='0'&&c<='9') return c-'0';
                    if(c>='A'&&c<='F') return c-'A'+10;
                    if(c>='a'&&c<='f') return c-'a'+10;
                    return -1;};
                int h=hx(p[i+1]),l=hx(p[i+2]);
                if(h>=0&&l>=0){dec+=(char)(h*16+l);i+=2;continue;}
            }
            dec+=p[i];
        }
#if defined(_WIN32)||defined(_WIN64)
        if (dec.size()>=3&&dec[0]=='/'&&std::isalpha((unsigned char)dec[1])&&dec[2]==':')
            dec=dec.substr(1);
        std::replace(dec.begin(),dec.end(),'/','\\');
        while (dec.size()>3&&dec.back()=='\\') dec.pop_back();
#else
        while (dec.size()>1&&dec.back()=='/') dec.pop_back();
#endif
        return dec;
    };

    // ── dms_scan_dir ─────────────────────────────────────────────────────────
    wv.expose("dms_scan_dir", [&dms](string path, bool recursive) -> string {
        const auto r = dms.scan_dir(path, recursive);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // ── dms_read_file ─────────────────────────────────────────────────────────
    wv.expose("dms_read_file", [&dms](string path) -> string {
        const auto r = dms.read_file(path);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // dms_write_file
    wv.expose("dms_write_file", [](string path, string content) -> string {
        const fs::path p{path};
        std::error_code ec;
        if (p.has_parent_path()) {
            fs::create_directories(p.parent_path(), ec);
            if (ec) return DMSHandle::err_str(
                std::format("failed to create parent dir: {}", ec.message()));
        }
        std::ofstream ofs(p, std::ios::out|std::ios::trunc|std::ios::binary);
        if (!ofs) return DMSHandle::err_str(std::format("cannot open '{}' for writing", path));
        ofs.write(content.data(), (std::streamsize)content.size());
        if (!ofs) return DMSHandle::err_str(std::format("write error for '{}'", path));
        return DMSHandle::ok_str(json{{"written",true}});
    });

    // dms_fetch_data_url
    wv.expose("dms_fetch_data_url", [](string path) -> string {
        const fs::path p(path);
        if (!fs::exists(p))
            return DMSHandle::err_str(std::format("'{}' does not exist", path));
        const auto mime = mime_for_extension(p.extension().string());
        std::ifstream f(p, std::ios::binary);
        if (!f) return DMSHandle::err_str(std::format("failed to open '{}'", path));
        std::string data((std::istreambuf_iterator<char>(f)),
                          std::istreambuf_iterator<char>());
        static const char* tbl =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        std::string out; out.reserve(((data.size()+2)/3)*4);
        size_t i=0;
        while (i+2<data.size()){
            unsigned a=(unsigned char)data[i],b=(unsigned char)data[i+1],c=(unsigned char)data[i+2];
            out.push_back(tbl[(a>>2)&0x3F]);
            out.push_back(tbl[((a<<4)|(b>>4))&0x3F]);
            out.push_back(tbl[((b<<2)|(c>>6))&0x3F]);
            out.push_back(tbl[c&0x3F]);
            i+=3;
        }
        if (i<data.size()){
            unsigned a=(unsigned char)data[i];
            unsigned b=(i+1<data.size())?(unsigned char)data[i+1]:0;
            out.push_back(tbl[(a>>2)&0x3F]);
            out.push_back(tbl[((a<<4)|(b>>4))&0x3F]);
            if (i+1<data.size()){out.push_back(tbl[((b<<2)&0x3F)]);out.push_back('=');}
            else {out.push_back('=');out.push_back('=');}
        }
        return DMSHandle::ok_str(json{{"data_url",
            std::format("data:{};base64,{}", mime, out)}});
    });

    // dms_file_stats
    wv.expose("dms_file_stats", [&dms](string path_str) -> string {
        const fs::path p{path_str};
        const auto ext       = p.extension().string();
        const auto mime      = mime_for_extension(ext);
        const auto kind      = kind_for_extension(ext);
        const std::string ep = (!ext.empty()&&ext[0]=='.')?ext.substr(1):ext;

        std::optional<pce::db::Row> row;
        {
            std::lock_guard lk{dms.db_mutex};
            row = dms.active_db().from("dms_documents")
                      .where("path = ?", path_str).first();
        }
        if (row) {
            const int64_t sz   = row->try_get<int64_t>("size_bytes").value_or(0);
            const int64_t mt   = row->try_get<int64_t>("mtime").value_or(0);
            const int64_t iat  = row->try_get<int64_t>("indexed_at").value_or(0);
            const auto dk      = row->try_get<std::string>("kind").value_or(kind);
            return DMSHandle::ok_str(json{
                {"path",path_str},{"name",p.filename().string()},
                {"ext",ep},{"kind",dk.empty()?kind:dk},{"mime",mime},
                {"size",sz},{"mtime",mt},{"indexed",iat>0},{"inDb",true}});
        }
        std::error_code ec;
        if (!fs::exists(p,ec)||!fs::is_regular_file(p,ec))
            return DMSHandle::err_str(
                std::format("'{}' not found on disk or in DB", path_str));
        return DMSHandle::ok_str(json{
            {"path",path_str},{"name",p.filename().string()},
            {"ext",ep},{"kind",kind},{"mime",mime},
            {"size",(int64_t)fs::file_size(p,ec)},
            {"mtime",file_mtime_unix(p)},{"indexed",false},{"inDb",false}});
    });

    // dms_register_file
    wv.expose("dms_register_file", [&dms](string path_str) -> string {
        const fs::path p{path_str};
        std::error_code ec;
        if (!fs::exists(p,ec)||!fs::is_regular_file(p,ec)){
            std::lock_guard lk{dms.db_mutex};
            auto row=dms.active_db().from("dms_documents")
                         .where("path = ?",path_str).first();
            if (row){
                const auto k=row->try_get<std::string>("kind")
                                 .value_or(kind_for_extension(p.extension().string()));
                return DMSHandle::ok_str(json{{"registered",false},{"kind",k},{"inDb",true}});
            }
            return DMSHandle::err_str(
                std::format("'{}' not found on disk or in DB", path_str));
        }
        const auto ext=p.extension().string();
        const auto mime=mime_for_extension(ext), kind=kind_for_extension(ext);
        const int64_t fsize=(int64_t)fs::file_size(p,ec);
        const int64_t mtime=file_mtime_unix(p);
        bool newly=false;
        {
            std::lock_guard lk{dms.db_mutex};
            try {
                (void)dms.active_db().insert_into("dms_documents")
                    .value("path",path_str).value("filename",p.filename().string())
                    .value("extension",ext).value("size_bytes",fsize)
                    .value("mtime",mtime).value("mime_type",mime).value("kind",kind)
                    .value("indexed_at",int64_t{0}).value("text_hash",std::string{""})
                    .value("snippet",std::string{""}).execute();
                newly=true;
            } catch (...) {}
        }
        return DMSHandle::ok_str(json{
            {"registered",newly},{"kind",kind},{"size",fsize},{"mtime",mtime}});
    });

    // dms_path_exists
    wv.expose("dms_path_exists", [](string path) -> string {
        std::error_code ec;
        const bool ex=fs::exists(fs::path{path},ec);
        const bool id=ex&&fs::is_directory(fs::path{path},ec);
        return DMSHandle::ok_str(json{{"exists",ex},{"is_dir",id}});
    });

    // dms_create_dir
    wv.expose("dms_create_dir", [](string path) -> string {
        std::error_code ec;
        if (fs::exists(fs::path{path},ec))
            return DMSHandle::ok_str(json{{"created",false},{"path",path}});
        const bool ok=fs::create_directories(fs::path{path},ec);
        if (!ok||ec) return DMSHandle::err_str(
            std::format("failed to create '{}': {}", path, ec.message()));
        return DMSHandle::ok_str(json{{"created",true},{"path",path}});
    });

    // dms_select_directory
    wv.expose("dms_select_directory",
              [&desk, normalise_picker_path]() mutable -> string {
        namespace picker = saucer::modules::picker;
        auto res = desk.pick<picker::type::folder>();
        if (!res.has_value())
            return DMSHandle::ok_str(json{{"path",""}});
        return DMSHandle::ok_str(json{{"path",normalise_picker_path(res->string())}});
    });

    // dms_select_files
    wv.expose("dms_select_files",
              [&desk, normalise_picker_path]() mutable -> string {
        namespace picker = saucer::modules::picker;
        auto res = desk.pick<picker::type::files>();
        json paths = json::array();
        if (res.has_value())
            for (const auto& p : *res)
                paths.push_back(normalise_picker_path(p.string()));
        return DMSHandle::ok_str(json{{"paths",paths}});
    });

    // dms_copy_files
    wv.expose("dms_copy_files",
              [](string sources_json, string dest_dir, string conflict) -> string {
        std::vector<std::string> sources;
        try { for(auto& s:json::parse(sources_json)) sources.push_back(s.get<std::string>()); }
        catch (...) { return DMSHandle::err_str("Invalid sources JSON"); }
        fs::path dest{dest_dir}; std::error_code ec;
        if (!fs::exists(dest,ec)) fs::create_directories(dest,ec);
        if (!fs::is_directory(dest,ec))
            return DMSHandle::err_str(std::format("'{}' is not a directory", dest_dir));
        int64_t copied=0,skipped=0; std::vector<std::string> errors;
        for (const auto& ss : sources) {
            fs::path src{ss};
            if (!fs::exists(src,ec)){errors.push_back(std::format("'{}' not found",ss));continue;}
            fs::path tgt=dest/src.filename();
            if (fs::exists(tgt,ec)){
                if (conflict=="skip"){++skipped;continue;}
                else if (conflict=="keep"){
                    auto stem=tgt.stem().string(),ext=tgt.extension().string();
                    for(int n=1;fs::exists(tgt,ec);++n)
                        tgt=dest/std::format("{} ({}){}", stem, n, ext);
                }
            }
            try {
                if (fs::is_directory(src,ec))
                    fs::copy(src,tgt,fs::copy_options::recursive|fs::copy_options::overwrite_existing,ec);
                else
                    fs::copy_file(src,tgt,fs::copy_options::overwrite_existing,ec);
                if(ec){errors.push_back(std::format("copy '{}': {}",ss,ec.message()));ec.clear();}
                else ++copied;
            } catch(const std::exception& e){errors.push_back(std::format("copy '{}': {}",ss,e.what()));}
        }
        return DMSHandle::ok_str(json{{"copied",copied},{"skipped",skipped},{"errors",errors}});
    });

    // dms_move_files
    wv.expose("dms_move_files",
              [](string sources_json, string dest_dir, string conflict) -> string {
        std::vector<std::string> sources;
        try { for(auto& s:json::parse(sources_json)) sources.push_back(s.get<std::string>()); }
        catch (...) { return DMSHandle::err_str("Invalid sources JSON"); }
        fs::path dest{dest_dir}; std::error_code ec;
        if (!fs::exists(dest,ec)) fs::create_directories(dest,ec);
        if (!fs::is_directory(dest,ec))
            return DMSHandle::err_str(std::format("'{}' is not a directory", dest_dir));
        int64_t moved=0,skipped=0; std::vector<std::string> errors;
        for (const auto& ss : sources) {
            fs::path src{ss};
            if (!fs::exists(src,ec)){errors.push_back(std::format("'{}' not found",ss));continue;}
            fs::path tgt=dest/src.filename();
            if (fs::exists(tgt,ec)){
                if (conflict=="skip"){++skipped;continue;}
                else if (conflict=="keep"){
                    auto stem=tgt.stem().string(),ext=tgt.extension().string();
                    for(int n=1;fs::exists(tgt,ec);++n)
                        tgt=dest/std::format("{} ({}){}", stem, n, ext);
                }
            }
            try {
                fs::rename(src,tgt,ec);
                if (ec){
                    ec.clear();
                    if (fs::is_directory(src,ec))
                        fs::copy(src,tgt,fs::copy_options::recursive|fs::copy_options::overwrite_existing,ec);
                    else
                        fs::copy_file(src,tgt,fs::copy_options::overwrite_existing,ec);
                    if (!ec)
                        fs::is_directory(tgt,ec)?(void)fs::remove_all(src,ec):(void)fs::remove(src,ec);
                }
                if(ec){errors.push_back(std::format("move '{}': {}",ss,ec.message()));ec.clear();continue;}
                ++moved;
            } catch(const std::exception& e){errors.push_back(std::format("move '{}': {}",ss,e.what()));}
        }
        return DMSHandle::ok_str(json{{"moved",moved},{"skipped",skipped},{"errors",errors}});
    });

    // dms_delete_files
    wv.expose("dms_delete_files", [](string paths_json) -> string {
        std::vector<std::string> paths;
        try { for(auto& p:json::parse(paths_json)) paths.push_back(p.get<std::string>()); }
        catch (...) { return DMSHandle::err_str("Invalid paths JSON"); }
        int64_t deleted=0; std::vector<std::string> errors; std::error_code ec;
        for (const auto& ps : paths) {
            fs::path p{ps};
            if (!fs::exists(p,ec)){errors.push_back(std::format("'{}' not found",ps));continue;}
            try {
                fs::is_directory(p,ec)?fs::remove_all(p,ec):fs::remove(p,ec);
                if(ec){errors.push_back(std::format("delete '{}': {}",ps,ec.message()));ec.clear();}
                else ++deleted;
            } catch(const std::exception& e){errors.push_back(std::format("delete '{}': {}",ps,e.what()));}
        }
        return DMSHandle::ok_str(json{{"deleted",deleted},{"errors",errors}});
    });

    // dms_share_file
    // Reveals the file in the native Finder/Explorer window.
    // macOS: delegates to NSWorkspace.shared.activateFileViewerSelectingURLs (no child process).
    // Other platforms: not yet supported.
    wv.expose("dms_share_file", [](string path) -> string {
        const bool ok = pce::nlp::platform::reveal_in_finder(path);
        if (!ok) return DMSHandle::err_str(
            "Reveal in file manager is not supported on this platform");
        return DMSHandle::ok_str(json{{"shared", true}});
    });

    // ── dms_save_preference ────────────────────────────────────────────────────
    // Persists an app-level string preference in the global SQLite DB.
    // Keys are owned by the frontend (e.g. "syngrafo_theme", "syngrafo_locale").
    // Thread-safe; uses db_mutex.  Zone DBs are intentionally NOT used — preferences
    // are global to the installation, not per-zone.
    wv.expose("dms_save_preference", [&dms](string key, string value) -> string {
        if (key.empty()) return DMSHandle::err_str("key must not be empty");
        if (key.size() > 256) return DMSHandle::err_str("key too long (max 256 chars)");
        try {
            const auto now = pce::db::now_unix();
            std::lock_guard lk{dms.db_mutex};
            (void)dms.db
                .insert_into("app_preferences")
                .value("key",        key)
                .value("value",      value)
                .value("updated_at", now)
                .on_conflict_replace()
                .execute();
        } catch (const std::exception& e) {
            return DMSHandle::err_str(std::format("save_preference: {}", e.what()));
        }
        return DMSHandle::ok_str(json{{"saved", true}, {"key", key}});
    });

    // ── dms_load_preference ────────────────────────────────────────────────────
    // Returns { "value": "<string>" } or { "value": null } when key not found.
    wv.expose("dms_load_preference", [&dms](string key) -> string {
        if (key.empty()) return DMSHandle::err_str("key must not be empty");
        std::optional<pce::db::Row> row;
        {
            std::lock_guard lk{dms.db_mutex};
            row = dms.db
                      .from("app_preferences")
                      .where("key = ?", key)
                      .first();
        }
        if (!row) return DMSHandle::ok_str(json{{"value", nullptr}});
        return DMSHandle::ok_str(json{{"value", row->get<std::string>("value")}});
    });
}

} // namespace pce::dms

