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
 *
 * Exposed JS functions (subset):
 *   dms_read_file             path                → { content }
 *   dms_write_file            path, content       → { written }
 *   dms_write_base64_file     path, base64_data   → { written, bytes }  (binary write)
 *   dms_fetch_data_url        path                → { data_url }
 *   dms_select_files          ()                  → { paths }
 *   dms_select_directory      ()                  → { path }
 *   dms_scan_dir              path, recursive     → { ... }
 *   dms_copy_files / dms_move_files / dms_delete_files
 *   dms_save_preference / dms_load_preference
 *   dms_share_file            path
 */

#pragma once
#include "../dms_handle.hh"
#include "../dms_monadic.hh"
#include <saucer/modules/desktop.hpp>

// Platform services: reveal_in_file_manager (NSWorkspace / SHOpenFolderAndSelectItems / D-Bus FileManager1).
#include "../../external/nlp/addons/platform_services.hh"

#include <algorithm>
#include <fstream>

namespace pce::dms {

inline Expected<json> DMSHandle::collect_svgs(std::string_view folder_path) noexcept {
    try {
        const fs::path dir{folder_path};
        if (!fs::exists(dir) || !fs::is_directory(dir))
            return std::unexpected("not a directory: " + std::string{folder_path});

        json result = json::array();
        for (const auto& entry : fs::directory_iterator(dir)) {
            if (entry.path().extension() != ".svg") continue;

            std::ifstream f(entry.path(), std::ios::in);
            if (!f) continue;
            std::string content((std::istreambuf_iterator<char>(f)),
                                 std::istreambuf_iterator<char>());

            // Strip XML declaration if present
            if (content.starts_with("<?xml")) {
                const auto end_pos = content.find("?>");
                if (end_pos != std::string::npos) content = content.substr(end_pos + 2);
            }
            // Trim leading whitespace
            const auto first = content.find_first_not_of(" \t\n\r");
            if (first != std::string::npos) content = content.substr(first);

            result.push_back({
                {"name",    entry.path().stem().string()},
                {"content", std::move(content)}
            });
        }
        // Sort by name for deterministic sprite order
        std::sort(result.begin(), result.end(), [](const json& a, const json& b){
            return a["name"].get<std::string>() < b["name"].get<std::string>();
        });
        return result;
    } catch (const std::exception& e) {
        return std::unexpected(std::string{"collect_svgs: "} + e.what());
    }
}

inline void register_file_bindings(saucer::smartview& wv, DMSHandle& dms,
                                    saucer::modules::desktop& desk) {
    using std::string;

    ///  Path normalisation (strips file:// scheme + percent-decode)
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

    wv.expose("dms_scan_dir", [&dms](string path, bool recursive) -> string {
        const auto r = dms.scan_dir(path, recursive);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    wv.expose("dms_read_file", [&dms](string path) -> string {
        const auto r = dms.read_file(path);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

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

    // dms_write_base64_file(path, base64_data) → { written:true, bytes:N }
    // Decodes a standard base64 string (JS btoa / bytesToBase64) and writes
    // the raw bytes to path.  Used for writing binary files (.sdoc ZIP, images)
    // from the frontend where JSON-string transport cannot carry raw binary.
    wv.expose("dms_write_base64_file", [](string path, string b64) -> string {
        const fs::path p{path};
        std::error_code ec;
        if (p.has_parent_path()) {
            fs::create_directories(p.parent_path(), ec);
            if (ec) return DMSHandle::err_str(
                std::format("failed to create parent dir: {}", ec.message()));
        }
        // RFC-4648 base64 decode table
        // Each entry maps ASCII byte → 6-bit value; -1 = not a valid base64 char.
        static constexpr int8_t kDec[256] = {
            -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, //   0
            -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, //  16
            -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,62,-1,-1,-1,63, //  32  (+/)
            52,53,54,55,56,57,58,59,60,61,-1,-1,-1,-1,-1,-1, //  48  (0-9)
            -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13,14, //  64  (A-O)
            15,16,17,18,19,20,21,22,23,24,25,-1,-1,-1,-1,-1, //  80  (P-Z)
            -1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40, //  96  (a-o)
            41,42,43,44,45,46,47,48,49,50,51,-1,-1,-1,-1,-1, // 112  (p-z)
            -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, // 128
            -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, // 144
            -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, // 160
            -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, // 176
            -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, // 192
            -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, // 208
            -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, // 224
            -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, // 240
        };
        std::string out;
        out.reserve(b64.size() * 3 / 4 + 3);
        int buf = 0, bits = 0;
        for (unsigned char c : b64) {
            if (c == '=') break;        // padding — stop
            const int v = kDec[c];
            if (v < 0) continue;        // ignore whitespace / CR LF
            buf = (buf << 6) | v;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                out.push_back(static_cast<char>((buf >> bits) & 0xFF));
            }
        }
        std::ofstream ofs(p, std::ios::out|std::ios::trunc|std::ios::binary);
        if (!ofs) return DMSHandle::err_str(std::format("cannot open '{}' for writing", path));
        ofs.write(out.data(), static_cast<std::streamsize>(out.size()));
        if (!ofs) return DMSHandle::err_str(std::format("write error for '{}'", path));
        return DMSHandle::ok_str(json{{"written",true},{"bytes",(int64_t)out.size()}});
    });

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
                discard(dms.active_db().insert_into("dms_documents")
                    .value("path",path_str).value("filename",p.filename().string())
                    .value("extension",ext).value("size_bytes",fsize)
                    .value("mtime",mtime).value("mime_type",mime).value("kind",kind)
                    .value("indexed_at",int64_t{0}).value("text_hash",std::string{""})
                    .value("snippet",std::string{""}).execute());
                newly=true;
            } catch (...) {}
        }
        return DMSHandle::ok_str(json{
            {"registered",newly},{"kind",kind},{"size",fsize},{"mtime",mtime}});
    });

    wv.expose("dms_path_exists", [](string path) -> string {
        std::error_code ec;
        const bool ex=fs::exists(fs::path{path},ec);
        const bool id=ex&&fs::is_directory(fs::path{path},ec);
        return DMSHandle::ok_str(json{{"exists",ex},{"is_dir",id}});
    });

    wv.expose("dms_create_dir", [](string path) -> string {
        std::error_code ec;
        if (fs::exists(fs::path{path},ec))
            return DMSHandle::ok_str(json{{"created",false},{"path",path}});
        const bool ok=fs::create_directories(fs::path{path},ec);
        if (!ok||ec) return DMSHandle::err_str(
            std::format("failed to create '{}': {}", path, ec.message()));
        return DMSHandle::ok_str(json{{"created",true},{"path",path}});
    });

    wv.expose("dms_select_directory",
              [&desk, normalise_picker_path]() mutable -> string {
        namespace picker = saucer::modules::picker;
        auto res = desk.pick<picker::type::folder>();
        if (!res.has_value())
            return DMSHandle::ok_str(json{{"path",""}});
        return DMSHandle::ok_str(json{{"path",normalise_picker_path(res->string())}});
    });

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

    /**
     * @brief Show a native Save-As dialog and return the chosen path.
     *
     * @param suggested_name  Pre-filled filename shown in the dialog (e.g. "Report.sdoc").
     *                        May include a leading directory to open the dialog there.
     * @param filter_ext      Extension without dot (e.g. "sdoc", "pdf").
     *                        If the user omits the extension, it is appended automatically.
     *
     * Returns { path: "/abs/path/file.sdoc" } on confirmation.
     * Returns { path: "" }                   if the user cancelled (not an error).
     */
    wv.expose("dms_select_save_path",
              [&desk, normalise_picker_path](string suggested_name, string filter_ext) mutable -> string {
        using namespace pce::dms;
        namespace picker = saucer::modules::picker;

        // try_invoke wraps a plain-value lambda (returns json, not Expected<json>).
        // Throwing from inside propagates as an err_str; cancellation is a
        // successful response with an empty path, not an error.
        return try_invoke([&]() -> json {
            picker::options opts{};
            // Pre-fill the filename; this opens the parent dir on all platforms.
            if (!suggested_name.empty())
                opts.initial = fs::path{suggested_name};
            // Extension filter — format "*.ext" is understood on macOS/GTK/Win.
            // If a platform ignores it the dialog still appears; the extension
            // enforcement below guarantees the correct suffix regardless.
            if (!filter_ext.empty())
                opts.filters.insert("*." + filter_ext);

            const auto res = desk.pick<picker::type::save>(opts);
            if (!res.has_value())
                return json{{"path", ""}};  // user dismissed — not an error

            auto path = normalise_picker_path(res->string());

            // Some platforms (GTK, older macOS) strip the extension from the
            // suggestion; append it if missing.
            if (!filter_ext.empty()) {
                const std::string dot_ext = "." + filter_ext;
                if (!path.ends_with(dot_ext))
                    path += dot_ext;
            }

            return json{{"path", path}};
        })
        .transform([](const json& j) { return DMSHandle::ok_str(j); })
        .value_or(DMSHandle::err_str("save dialog failed"));
    });

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
            fs::path tgt = dest/src.filename();
            if (fs::exists(tgt,ec)) {
                if (conflict == "skip"){
                    ++skipped;
                    continue;
                }
                else if (conflict == "keep"){
                    auto stem = tgt.stem().string(),ext = tgt.extension().string();
                    for(int n=1;fs::exists(tgt,ec);++n) {
                        tgt=dest/std::format("{} ({}){}", stem, n, ext);
                    }
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
                        fs::is_directory(tgt,ec)?discard(fs::remove_all(src,ec)):discard(fs::remove(src,ec));
                }
                if(ec){errors.push_back(std::format("move '{}': {}",ss,ec.message()));ec.clear();continue;}
                ++moved;
            } catch(const std::exception& e){errors.push_back(std::format("move '{}': {}",ss,e.what()));}
        }
        return DMSHandle::ok_str(json{{"moved",moved},{"skipped",skipped},{"errors",errors}});
    });

    /// dms_delete_files
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

    /// @brief Reveals a file in the native file manager with the item selected.
    ///        No child process is spawned on any platform.
    ///        macOS   — @c NSWorkspace activateFileViewerSelectingURLs
    ///        Windows — @c SHOpenFolderAndSelectItems (Shell API)
    ///        Linux   — @c org.freedesktop.FileManager1.ShowItems (D-Bus; requires dbus-1 at build time)
    wv.expose("dms_share_file", [](string path) -> string {
        const bool ok = pce::nlp::platform::reveal_in_file_manager(path);
        if (!ok) return DMSHandle::err_str(
            "Reveal in file manager is not supported on this platform");
        return DMSHandle::ok_str(json{{"shared", true}});
    });

    /// dms_save_preference
    /// Persists an app-level string preference in the global SQLite DB.
    /// Keys are owned by the frontend (e.g. "syngrafo_theme", "syngrafo_locale").
    /// Thread-safe; uses db_mutex.  Zone DBs are intentionally NOT used — preferences
    /// are global to the installation, not per-zone.
    wv.expose("dms_save_preference", [&dms](string key, string value) -> string {
        if (key.empty()) return DMSHandle::err_str("key must not be empty");
        if (key.size() > 256) return DMSHandle::err_str("key too long (max 256 chars)");
        try {
            const auto now = pce::db::now_unix();
            std::lock_guard lk{dms.db_mutex};
            discard(dms.db
                .insert_into("app_preferences")
                .value("key",        key)
                .value("value",      value)
                .value("updated_at", now)
                .on_conflict_replace()
                .execute());
        } catch (const std::exception& e) {
            return DMSHandle::err_str(std::format("save_preference: {}", e.what()));
        }
        return DMSHandle::ok_str(json{{"saved", true}, {"key", key}});
    });

    /// dms_load_preference
    /// Returns { "value": "<string>" } or { "value": null } when key not found.
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

    /// dms_collect_svgs
    /// Returns JSON array of { name, content } for every .svg in the given folder.
    wv.expose("dms_collect_svgs", [&dms](string path) -> string {
        auto r = dms.collect_svgs(path);
        return r ? DMSHandle::ok_str(*r) : DMSHandle::err_str(r.error());
    });
}

} // namespace pce::dms
