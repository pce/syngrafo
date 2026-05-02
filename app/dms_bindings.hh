#pragma once
/**
 * @file dms_bindings.hh
 * @author Patrick Engel
 * @brief DMS C++23 bindings — thin orchestrator.
 *
 * Wires DMSHandle into saucer::smartview by delegating to four domain modules:
 *
 *   bindings/file_bindings.hh    — scan/read/write/copy/move/delete/picker
 *   bindings/image_bindings.hh   — SVG, mesh, OCR, EXIF, rectify, PDF
 *   bindings/nlp_bindings.hh     — index, search, zones, bulk-index
 *   bindings/archive_bindings.hh — create_archive, compress_file
 *
 * Core value types (no webview, no JSON, no DB):
 *   core/image.hh     — Image, ImageView, pal:: palette helpers
 *   core/mesh.hh      — MeshVertex, MeshData, MeshMode, builders, PLY writer
 *   core/document.hh  — Document, Block, NLPResult
 *   core/zone.hh      — Zone pure value type
 *   core/pipeline.hh  — C++23 pipe operator for Expected<T> chains
 *
 * JSON envelope (every exposed function returns Promise<string>):
 *   { "ok": true,  "data": <payload> }  // success
 *   { "ok": false, "error": "<msg>"  }  // failure
 *
 * @note Include only from app/main.cc — application-internal header.
 */

// ── Domain handle + helpers ───────────────────────────────────────────────────
#include "dms_handle.hh"

// ── Domain binding modules ────────────────────────────────────────────────────
#include "bindings/file_bindings.hh"
#include "bindings/image_bindings.hh"
#include "bindings/nlp_bindings.hh"
#include "bindings/archive_bindings.hh"
#include "bindings/palette_bindings.hh"

namespace pce::dms {

// =============================================================================
// DMSHandle method implementations
// (declared in dms_handle.hh, defined here so all helpers are in scope)
// =============================================================================

// ── scan_dir ──────────────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::scan_dir(std::string_view path_str, bool recursive) {
    std::string actual{path_str};
    if (actual=="global"||actual=="input"||actual.empty())
        actual=get_active_in_path();
    const fs::path root{actual};
    return require(fs::exists(root), std::format("'{}' does not exist", actual))
        .and_then([&]()->VoidResult{
            return require(fs::is_directory(root),
                           std::format("'{}' is not a directory", path_str));
        })
        .and_then([&]()->Expected<json>{
            return try_invoke([&]()->json{
                json items=json::array(); std::error_code ec;
                auto collect=[&](const fs::directory_entry& e){
                    std::error_code e2;
                    const bool is_dir=e.is_directory(e2);
                    const int64_t fsize=is_dir?0:(int64_t)e.file_size(e2);
                    const auto ext=e.path().extension().string();
                    const auto mime=is_dir?"inode/directory":mime_for_extension(ext);
                    bool indexed=false;
                    if (!is_dir){
                        std::lock_guard lk{db_mutex};
                        indexed=active_db().from("dms_documents")
                                    .where("path = ?",e.path().string()).exists();
                    }
                    items.push_back({{"name",e.path().filename().string()},
                        {"path",e.path().string()},{"is_dir",is_dir},
                        {"size",fsize},{"mtime",file_mtime_unix(e.path())},
                        {"mime_type",mime},{"indexed",indexed}});
                };
                const auto skip=fs::directory_options::skip_permission_denied;
                if (recursive)
                    for(const auto& e:fs::recursive_directory_iterator(root,skip,ec)) collect(e);
                else
                    for(const auto& e:fs::directory_iterator(root,skip,ec)) collect(e);
                std::sort(items.begin(),items.end(),[](const json& a,const json& b){
                    const bool da=a.value("is_dir",false),db_=b.value("is_dir",false);
                    if(da!=db_) return (int)da>(int)db_;
                    return a.value("name",std::string{})<b.value("name",std::string{});
                });
                return json{{"path",root.string()},{"items",std::move(items)}};
            });
        });
}

// ── read_file ─────────────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::read_file(std::string_view path_str) {
    const fs::path p{path_str}; std::error_code ec;
    if (!fs::exists(p,ec)){
        std::lock_guard lk{db_mutex};
        auto row=active_db().from("dms_documents")
                     .where("path = ?",std::string{path_str}).first();
        if (row && !row->is_null("content_blob")){
            const auto mime=row->get<std::string>("mime_type");
            const auto blob=row->get<std::vector<uint8_t>>("content_blob");
            if (!is_indexable_text(mime))
                return json{{"path",std::string{path_str}},
                    {"filename",row->get<std::string>("filename")},
                    {"mime_type",mime},{"size",(int64_t)blob.size()},
                    {"mtime",row->get<int64_t>("mtime")},{"content",nullptr},
                    {"line_count",0},{"truncated",false},{"binary",true},{"from_db",true}};
            std::string content(blob.begin(),blob.end());
            const int lines=(int)(std::ranges::count(content,'\n')+(content.empty()?0:1));
            return json{{"path",std::string{path_str}},
                {"filename",row->get<std::string>("filename")},
                {"mime_type",mime},{"size",(int64_t)blob.size()},
                {"mtime",row->get<int64_t>("mtime")},{"content",std::move(content)},
                {"line_count",lines},{"truncated",false},{"binary",false},{"from_db",true}};
        }
        return std::unexpected(std::format("'{}' does not exist on disk or in DB",path_str));
    }
    return require(!fs::is_directory(p,ec),
                   std::format("'{}' is a directory",path_str))
        .and_then([&]()->Expected<json>{
            const int64_t fsize=(int64_t)fs::file_size(p,ec);
            const auto mime=mime_for_extension(p.extension().string());
            if (!is_indexable_text(mime))
                return json{{"path",p.string()},{"filename",p.filename().string()},
                    {"mime_type",mime},{"size",fsize},{"mtime",file_mtime_unix(p)},
                    {"content",nullptr},{"line_count",0},{"truncated",false},{"binary",true}};
            static constexpr size_t kMax=10u*1024u*1024u;
            const bool trunc=(size_t)fsize>kMax;
            return safe_read_text(p,kMax).transform([&](std::string content)->json{
                const int lines=(int)(std::ranges::count(content,'\n')+(content.empty()?0:1));
                return json{{"path",p.string()},{"filename",p.filename().string()},
                    {"mime_type",mime},{"size",fsize},{"mtime",file_mtime_unix(p)},
                    {"content",std::move(content)},{"line_count",lines},
                    {"truncated",trunc},{"binary",false}};
            });
        });
}

// ── index_document ────────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::index_document(std::string_view path_str) {
    const fs::path p{path_str}; std::error_code ec;
    const auto mime=mime_for_extension(p.extension().string());
    return require(fs::exists(p,ec), std::format("'{}' does not exist",path_str))
        .and_then([&]()->VoidResult{
            return require(!fs::is_directory(p,ec),std::format("'{}' is a directory",path_str));
        })
        .and_then([&]()->VoidResult{
            if (is_indexable_text(mime)) return {};
            std::string hint;
            if      (mime.starts_with("image/")) hint=std::format("'{}' is an image \u2014 use OCR to extract text.",p.filename().string());
            else if (mime.starts_with("audio/")||mime.starts_with("video/")) hint=std::format("'{}' ({}) is a media file.",p.filename().string(),mime);
            else if (mime=="application/zip"||mime.starts_with("application/x-")) hint=std::format("'{}' is a binary/archive.",p.filename().string());
            else hint=std::format("'{}' (MIME:{}) is not indexable text.",p.filename().string(),mime);
            return std::unexpected(hint);
        })
        .and_then([&]()->Expected<json>{
            return safe_read_text(p,1u<<20).and_then([&](std::string content)->Expected<json>{
                if (mime=="text/html"||mime=="text/htm"||mime=="text/xhtml+xml")
                    content=strip_html_tags(content);
                else if (mime=="image/svg+xml")
                    content=extract_svg_text(content);
                return index_one_file_(p,content);
            });
        });
}

// ── bulk_index_start ──────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::bulk_index_start(std::string_view dir_path) {
    if (bulk_active.exchange(true))
        return std::unexpected(std::string{"bulk index already running"});
    std::string actual{dir_path};
    if (actual=="global"||actual=="input"||actual.empty()) actual=get_active_in_path();
    const fs::path root{actual}; std::error_code ec;
    if (!fs::exists(root,ec)||!fs::is_directory(root,ec)){
        bulk_active.store(false);
        return std::unexpected(std::format("'{}' is not a directory",actual));
    }
    std::vector<fs::path> candidates;
    const auto skip=fs::directory_options::skip_permission_denied;
    for(const auto& e:fs::recursive_directory_iterator(root,skip,ec)){
        if(ec){ec.clear();continue;}
        if(!e.is_regular_file()) continue;
        if(is_indexable_text(mime_for_extension(e.path().extension().string())))
            candidates.push_back(e.path());
    }
    const int64_t total=(int64_t)candidates.size();
    push_progress_({{"phase","start"},{"total",total},{"done",0},{"errors",0}});
    bulk_thread=std::jthread{[this,files=std::move(candidates),total](std::stop_token st){
        int64_t done{},errors{};
        for(const auto& p:files){
            if(st.stop_requested()) break;
            const auto content=safe_read_text(p,1u<<20);
            if(!content){++errors;continue;}
            if(const auto r=index_one_file_(p,*content);!r){
                std::print(stderr,"[dms] index '{}': {}\n",p.string(),r.error());
                ++errors;
            }
            ++done;
            if(done%5==0||done==total)
                push_progress_({{"phase","indexing"},{"file",p.filename().string()},
                    {"done",done},{"total",total},{"errors",errors}});
        }
        push_progress_({{"phase","complete"},{"done",done},{"total",total},{"errors",errors}});
        bulk_active.store(false);
    }};
    return json{{"task_id","bulk_0"},{"total_files",total}};
}

// ── search ────────────────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::search(std::string_view query_sv, int top_k) {
    if (top_k<=0||top_k>500) top_k=10;
    const std::string query{query_sv};
    if (const auto qemb=embed_text_(query_sv); qemb){
        struct Cand{int64_t doc_id; float score;};
        std::vector<pce::db::Row> rows;
        {
            std::lock_guard lk{db_mutex};
            rows=active_db().from("nlp_embeddings")
                     .where("row_type = ?",std::string{"dms_doc"}).execute();
        }
        std::vector<Cand> cands; cands.reserve(rows.size());
        for(const auto& row:rows){
            const auto id=row.try_get<int64_t>("row_id").value_or(0);
            const auto vec=pce::db::try_blob_to_floats(row["vector"]);
            if(id==0||vec.empty()) continue;
            cands.push_back({id,cosine_similarity({qemb->data(),qemb->size()},{vec.data(),vec.size()})});
        }
        const auto keep=std::min((size_t)top_k,cands.size());
        std::ranges::partial_sort(cands,cands.begin()+(std::ptrdiff_t)keep,
            [](const Cand& a,const Cand& b){return a.score>b.score;});
        cands.resize(keep);
        json results=json::array();
        for(const auto& c:cands){
            if(c.score<0.10f) continue;
            std::optional<pce::db::Row> dr,nr;
            {
                std::lock_guard lk{db_mutex};
                dr=active_db().from("dms_documents").where("id = ?",c.doc_id).first();
                nr=active_db().from("nlp_notes")
                       .where("row_type = ?",std::string{"dms_doc"})
                       .where("row_id   = ?",c.doc_id).order_by("created_at",false).first();
            }
            if (!dr) continue;
            results.push_back(build_result_json_(c.doc_id,c.score,*dr,nr));
        }
        return json({
            {"strategy", "semantic"},
            {"query", query},
            {"results", std::move(results)},
        });
    }
    std::vector<pce::db::Row> doc_rows;
    {
        std::lock_guard lk{db_mutex};
        doc_rows=active_db().from("dms_documents")
                     .where("snippet LIKE ?","%"+query+"%").limit((int64_t)top_k).execute();
    }
    json results=json::array();
    for(const auto& row:doc_rows){
        const auto doc_id=row.try_get<int64_t>("id").value_or(0);
        std::optional<pce::db::Row> nr;
        {
            std::lock_guard lk{db_mutex};
            nr=active_db().from("nlp_notes")
                   .where("row_type = ?",std::string{"dms_doc"})
                   .where("row_id   = ?",doc_id).order_by("created_at",false).first();
        }
        results.push_back(build_result_json_(doc_id,1.f,row,nr));
    }
    return json({
        {"strategy", "keyword"},
        {"query", query},
        {"results", std::move(results)},
    });
}

// ── index_status ──────────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::index_status() {
    return try_invoke([&]()->json{
        int64_t total{},last{};
        {
            std::lock_guard lk{db_mutex};
            total=active_db().from("dms_documents").count();
            if(const auto r=active_db().from("dms_documents")
                                .select({"MAX(indexed_at) AS t"}).first())
                last=r->try_get<int64_t>("t").value_or(0);
        }
        return json({
            {"total_docs",total},
            {"bulk_active",bulk_active.load()},
            {"last_indexed_at",last},
            {"active_zone",active_zone_name},
            {"active_in_path",get_active_in_path()},
        });
    });
}

// ── get_metadata ──────────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::get_metadata(std::string_view path_str) {
    std::optional<pce::db::Row> doc_row,note_row,emb_row;
    {
        std::lock_guard lk{db_mutex};
        doc_row=active_db().from("dms_documents")
                    .where("path = ?",std::string{path_str}).first();
        if(doc_row){
            const auto id=doc_row->try_get<int64_t>("id").value_or(0);
            note_row=active_db().from("nlp_notes")
                         .where("row_type = ?",std::string{"dms_doc"})
                         .where("row_id   = ?",id).order_by("created_at",false).first();
            emb_row=active_db().from("nlp_embeddings")
                        .where("row_type = ?",std::string{"dms_doc"})
                        .where("row_id   = ?",id).first();
        }
    }
    if (!doc_row) return std::unexpected(std::format("'{}' has not been indexed",path_str));
    const auto id=doc_row->try_get<int64_t>("id").value_or(0);
    auto parse_arr=[](std::string_view s)->json{try{return json::parse(s);}catch(...){return json::array();}};
    const auto kw=note_row?note_row->try_get<std::string>("keywords").value_or("[]"):"[]";
    const auto ent=note_row?note_row->try_get<std::string>("entities").value_or("[]"):"[]";
    return json{
        {"doc_id",id},
        {"path",doc_row->get<std::string>("path")},
        {"filename",doc_row->get<std::string>("filename")},
        {"extension",doc_row->get<std::string>("extension")},
        {"mime_type",doc_row->get<std::string>("mime_type")},
        {"size_bytes",doc_row->try_get<int64_t>("size_bytes").value_or(0)},
        {"mtime",doc_row->try_get<int64_t>("mtime").value_or(0)},
        {"indexed_at",doc_row->try_get<int64_t>("indexed_at").value_or(0)},
        {"snippet",doc_row->get<std::string>("snippet")},
        {"keywords",parse_arr(kw)},
        {"entities",parse_arr(ent)},
        {"sentiment",note_row?note_row->try_get<double>("sentiment").value_or(0.0):0.0},
        {"sentiment_label",note_row?note_row->try_get<std::string>("sentiment_label").value_or("neutral"):std::string{"neutral"}},
        {"lang",note_row?note_row->try_get<std::string>("lang").value_or("en"):std::string{"en"}},
        {"has_embedding",emb_row.has_value()},
        {"dimensions",emb_row?emb_row->try_get<int64_t>("dimensions").value_or(0):int64_t{0}},
        {"has_content_blob",doc_row&&!doc_row->is_null("content_blob")}};
}

// ── rectify_document ──────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::rectify_document(std::string_view path_str,
                                                    std::optional<std::string> out_opt) {
    const fs::path src{path_str}; std::error_code ec;
    return require(fs::exists(src,ec),std::format("'{}' does not exist",path_str))
        .and_then([&]()->Expected<json>{
            fs::path out=out_opt&&!out_opt->empty()
                ? fs::path{*out_opt}
                : src.parent_path()/(src.stem().string()+".rectified.jpg");
            if (!rectifier) return std::unexpected(std::string{"Rectifier addon not loaded"});
            if (!rectifier->rectify(src.string(),out.string()))
                return std::unexpected(std::string{"Rectification failed"});
            (void)index_document(out.string());
            return json{{"success",true},{"outPath",out.string()}};
        });
}

// ── get_zones ─────────────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::get_zones() {
    std::lock_guard lk{db_mutex};
    return try_invoke([&]()->json{
        return db.from("dms_zones").order_by("last_visited",false).limit(10)
            .map<json>([](const pce::db::Row& r)->json{
                return json{{"name",r.get<std::string>("name")},
                    {"in_path",r.get<std::string>("in_path")},
                    {"out_path",r.get<std::string>("out_path")},
                    {"last_visited",r.get<int64_t>("last_visited")},
                    {"description",r.try_get<std::string>("description").value_or("")},
                    {"taxonomy_domain",r.try_get<std::string>("taxonomy_domain").value_or("General")},
                    {"is_encrypted",r.try_get<int64_t>("is_encrypted").value_or(0)!=0}};
            });
    });
}

// ── upsert_zone ───────────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::upsert_zone(std::string_view name,
                                              std::string_view in_path,
                                              std::string_view out_path,
                                              std::optional<std::string> password,
                                              std::string_view description,
                                              std::string_view taxonomy_domain) {
    std::lock_guard lk{db_mutex};
    return try_invoke([&]()->json{
        const auto now=pce::db::now_unix();
        auto query=db.insert_into("dms_zones")
                       .value("name",std::string{name})
                       .value("in_path",std::string{in_path})
                       .value("out_path",std::string{out_path})
                       .value("last_visited",now)
                       .value("description",std::string{description})
                       .value("taxonomy_domain",std::string{taxonomy_domain});
        if (password&&!password->empty()){
            const auto salt=generate_zone_salt();
            const auto key=derive_zone_key(*password,salt);
            query.value("salt_hex",salt);
            query.value("is_encrypted",1);
#ifdef __APPLE__
            const auto account=pce::keychain::zone_account(name);
            if(pce::keychain::store(account,key)) query.value("password_hashed",std::string{""});
            else{std::print(stderr,"[dms] Keychain store failed for zone '{}'\n",name);
                 query.value("password_hashed",key);}
#else
            query.value("password_hashed",key);
#endif
        }
        (void)query.on_conflict_replace().execute();
        return json{{"ok",true}};
    });
}

// ── open_zone_db ──────────────────────────────────────────────────────────────
inline Expected<pce::db::Database> DMSHandle::open_zone_db(
    std::string_view zone_name, std::optional<std::string> password) {
    if (zone_name=="global"||zone_name=="") return open_db_();
    std::optional<pce::db::Row> zone_row;
    {
        std::lock_guard lk{db_mutex};
        zone_row=db.from("dms_zones").where("name = ?",std::string{zone_name}).first();
    }
    if (!zone_row) return std::unexpected(std::format("Zone '{}' not found",zone_name));
    fs::path db_path=fs::path{zone_row->get<std::string>("out_path")}/".papiere.db";
    {std::error_code ec;fs::create_directories(db_path.parent_path(),ec);}
    const bool is_enc=zone_row->get<int64_t>("is_encrypted")!=0;
    try {
        if (!is_enc){
            auto zdb=pce::db::Database::open(db_path.string());
            bootstrap_dms_schema(zdb);bootstrap_nlp_schema(zdb);
            bootstrap_palette_schema(zdb);
            pce::db::apply_migrations(zdb,kDmsMigrations);
            return std::move(zdb);
        }
        const auto zone_name_str=zone_row->get<std::string>("name");
        const auto salt_hex=zone_row->try_get<std::string>("salt_hex").value_or("");
        const auto stored_key=zone_row->try_get<std::string>("password_hashed").value_or("");
        std::string key;
        if (password&&!password->empty()){
            const auto eff=salt_hex.empty()?zone_name_str:salt_hex;
            key=derive_zone_key(*password,eff);
#ifdef __APPLE__
            (void)pce::keychain::store(pce::keychain::zone_account(zone_name_str),key);
#endif
        } else {
#ifdef __APPLE__
            const auto account=pce::keychain::zone_account(zone_name_str);
            auto kc=pce::keychain::load(account);
            if(kc){key=std::move(*kc);}
            else if(!stored_key.empty()){
                key=stored_key;
                if(pce::keychain::store(account,key))
                    std::print(stderr,"[dms] Migrated zone '{}' key to Keychain.\n",zone_name_str);
            } else {
                return std::unexpected(std::string{"__keychain_missing__"});
            }
#else
            if(stored_key.empty())
                return std::unexpected(std::string{"Encrypted zone has no stored key."});
            key=stored_key;
#endif
        }
        auto zdb=pce::db::Database::open_encrypted(db_path.string(),key);
        bootstrap_dms_schema(zdb);bootstrap_nlp_schema(zdb);
        bootstrap_palette_schema(zdb);
        pce::db::apply_migrations(zdb,kDmsMigrations);
        return std::move(zdb);
    } catch(const std::exception& e){
        return std::unexpected(std::format("Failed to open zone DB: {}",e.what()));
    }
}

// ── import_to_zone ────────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::import_to_zone(std::string path, std::string zone_name,
                                                  bool compress, bool scan) {
    fs::path src(path);
    if (!fs::exists(src)) return std::unexpected(std::format("Source not found: {}",path));
    std::optional<pce::db::Row> zone_row;
    {std::lock_guard lk{db_mutex};zone_row=db.from("dms_zones").where("name = ?",zone_name).first();}
    if (!zone_row) return std::unexpected(std::format("Zone '{}' not found",zone_name));
    fs::path out_dir=zone_row->get<std::string>("out_path");
    if (!fs::exists(out_dir)) fs::create_directories(out_dir);
    fs::path dest=out_dir/src.filename();
    std::error_code ec;
    fs::copy_file(src,dest,fs::copy_options::overwrite_existing,ec);
    if (ec) return std::unexpected(std::format("Failed to copy: {}",ec.message()));
    json meta=json::object();
    meta["import_date"]=pce::db::now_unix();
    meta["original_source"]=path;
    if (scan&&rectifier){
        std::print("[dms] Rectifying {}\n",dest.string());
        std::string rf=(out_dir/(src.stem().string()+".rectified"+src.extension().string())).string();
        if(rectifier->rectify(dest.string(),rf)){fs::remove(dest);dest=fs::path(rf);meta["applied_scan"]=true;}
        else std::print(stderr,"[dms] Rectifier failed\n");
    }
    if (compress){std::print("[dms] Compress placeholder\n");meta["applied_compression"]=true;}
    auto r=index_document(dest.string());
    if(r){
        std::lock_guard lk{db_mutex};
        (void)active_db().update("dms_documents")
            .set("origin_path",path)
            .set("is_transformed",(compress||scan)?1:0)
            .set("transform_meta",meta.dump())
            .where("path = ?",dest.string()).execute();
    }
    return json{{"ok",true},{"dest",dest.string()},{"meta",meta}};
}

// ── file_to_zone ──────────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::file_to_zone(std::string path, std::string zone_name) {
    fs::path src(path); std::error_code ec;
    if (!fs::exists(src,ec)) return std::unexpected(std::format("Source not found: {}",path));
    std::optional<pce::db::Row> zone_row;
    {std::lock_guard lk{db_mutex};zone_row=db.from("dms_zones").where("name = ?",zone_name).first();}
    if (!zone_row) return std::unexpected(std::format("Zone '{}' not found",zone_name));
    fs::path in_dir=zone_row->get<std::string>("in_path");
    if (!fs::exists(in_dir,ec)) fs::create_directories(in_dir,ec);
    fs::path dest=in_dir/src.filename();
    std::optional<pce::db::Row> doc_row,note_row,emb_row;
    {
        std::lock_guard lk{db_mutex};
        doc_row=db.from("dms_documents").where("path = ?",path).first();
        if(doc_row){
            const auto id=doc_row->get<int64_t>("id");
            note_row=db.from("nlp_notes").where("row_type = 'dms_doc' AND row_id = ?",id).first();
            emb_row=db.from("nlp_embeddings").where("row_type = 'dms_doc' AND row_id = ?",id).first();
        }
    }
    fs::rename(src,dest,ec);
    if(ec){ec.clear();fs::copy_file(src,dest,fs::copy_options::overwrite_existing,ec);
        if(ec) return std::unexpected(std::format("Failed to move: {}",ec.message()));
        fs::remove(src,ec);}
    auto tdb_res=open_zone_db(zone_name);
    if(!tdb_res) return std::unexpected(tdb_res.error());
    auto& tdb=*tdb_res;
    if(doc_row){
        std::lock_guard lk{db_mutex};
        auto tx=tdb.transaction();
        (void)tdb.insert_into("dms_documents")
            .value("path",dest.string()).value("filename",doc_row->get<std::string>("filename"))
            .value("extension",doc_row->get<std::string>("extension"))
            .value("size_bytes",doc_row->get<int64_t>("size_bytes"))
            .value("mtime",doc_row->get<int64_t>("mtime"))
            .value("mime_type",doc_row->get<std::string>("mime_type"))
            .value("indexed_at",doc_row->get<int64_t>("indexed_at"))
            .value("text_hash",doc_row->get<std::string>("text_hash"))
            .value("snippet",doc_row->get<std::string>("snippet"))
            .value("content_blob",doc_row->try_get<std::vector<uint8_t>>("content_blob")
                .value_or(std::vector<uint8_t>{}))
            .on_conflict_replace().execute();
        const int64_t new_id=tdb.last_insert_rowid();
        if(note_row)
            (void)tdb.insert_into("nlp_notes")
                .value("row_type","dms_doc").value("row_id",new_id)
                .value("note_text",note_row->get<std::string>("note_text"))
                .value("keywords",note_row->get<std::string>("keywords"))
                .value("entities",note_row->get<std::string>("entities"))
                .value("sentiment",note_row->get<double>("sentiment"))
                .value("sentiment_label",note_row->get<std::string>("sentiment_label"))
                .value("lang",note_row->get<std::string>("lang"))
                .value("created_at",note_row->get<int64_t>("created_at")).execute();
        if(emb_row)
            (void)tdb.insert_into("nlp_embeddings")
                .value("row_type","dms_doc").value("row_id",new_id)
                .value("text_hash",emb_row->get<std::string>("text_hash"))
                .value("vector",emb_row->get<std::vector<uint8_t>>("vector"))
                .value("dimensions",emb_row->get<int64_t>("dimensions"))
                .value("snippet",emb_row->get<std::string>("snippet"))
                .value("updated_at",emb_row->get<int64_t>("updated_at"))
                .on_conflict_replace().execute();
        tx.commit();
        const auto old_id=doc_row->get<int64_t>("id");
        (void)db.delete_from("dms_documents").where("id = ?",old_id).execute();
        (void)db.delete_from("nlp_notes").where("row_type = 'dms_doc' AND row_id = ?",old_id).execute();
        (void)db.delete_from("nlp_embeddings").where("row_type = 'dms_doc' AND row_id = ?",old_id).execute();
    }
    return json{{"ok",true},{"dest",dest.string()}};
}

// ── ocr_document ──────────────────────────────────────────────────────────────
inline std::string DMSHandle::ocr_document(std::string path, std::string zone_name) {
    fs::path p(path);
    if (!fs::exists(p)) return err_str("File not found: "+path);
    auto mtime=(long long)fs::last_write_time(p).time_since_epoch().count();
    auto cached=db.from("dms_ocr_cache").select({"text"})
                    .where("path = ? AND mtime = ?",p.string(),mtime).first();
    std::string text; bool was_cached=false;
    if(cached){text=cached->get<std::string>("text");was_cached=true;std::print("[dms] OCR cache hit\n");}
    else {
        std::print("[dms] OCR cache miss: {}\n",path);
        if(engine&&engine->has_ocr()) text=engine->extract_text_from_image(p.string());
        else return err_str("OCR engine not available");
        if(text.empty()) return err_str("OCR failed to extract any text");
        if(text.rfind("[Error:",0)==0||text.rfind("[error:",0)==0) return err_str("OCR failed: "+text);
        std::string trimmed=text;
        trimmed.erase(0,trimmed.find_first_not_of(" \t\r\n"));
        trimmed.erase(trimmed.find_last_not_of(" \t\r\n")+1);
        if(trimmed.size()<4) return ok_str(json{{"text",""},{"cached",false}});
        std::print("[dms] OCR success, {} chars\n",text.length());
        (void)db.insert_into("dms_ocr_cache")
            .value("path",p.string()).value("text",text).value("mtime",mtime)
            .value("created_at",(long long)std::chrono::system_clock::now().time_since_epoch().count())
            .on_conflict_replace().execute();
    }
    if(!text.empty()) (void)index_one_file_(p,text);
    if(!zone_name.empty()&&!text.empty()){
        std::optional<pce::db::Row> zr;
        {std::lock_guard lk{db_mutex};zr=db.from("dms_zones").where("name = ?",zone_name).first();}
        if(zr){
            fs::path od(zr->get<std::string>("out_path"));
            if(fs::exists(od)&&fs::is_directory(od)){
                fs::path of=od/(p.stem().string()+".ocr.txt");
                std::ofstream ofs(of);
                if(ofs){ofs<<text;ofs.close();(void)index_document(of.string());}
            }
        }
    }
    const auto quality=ocr_quality(text);
    std::print("[dms] OCR quality='{}'\n",quality);
    return ok_str(json{{"text",text},{"cached",was_cached},{"quality",quality}});
}

// ── OCR quality helpers ───────────────────────────────────────────────────────
inline float DMSHandle::ocr_alpha_ratio(const std::string& text) {
    size_t alpha=0,total=0;
    for(unsigned char c:text){
        if(std::isspace((int)c)) continue;
        ++total; if(std::isalpha((int)c)) ++alpha;
    }
    return total==0?0.f:(float)alpha/(float)total;
}
inline std::string DMSHandle::ocr_quality(const std::string& text) {
    const float r=ocr_alpha_ratio(text);
    return r>=0.55f?"ok":r>=0.30f?"low":"garbage";
}

// ── embed_text_ ───────────────────────────────────────────────────────────────
inline Expected<std::vector<float>> DMSHandle::embed_text_(std::string_view text) const {
    if(!embed_svc) return std::unexpected(std::string{"no embed service configured"});
    if(!embed_svc->is_loaded()) return std::unexpected(std::string{"embed model not loaded"});
    return try_invoke([&]()->std::vector<float>{
        auto r=embed_svc->embed(std::string{text});
        if(!r.success||r.vector.empty()) throw std::runtime_error{"embedding returned empty"};
        return std::move(r.vector);
    });
}

// ── index_one_file_ ───────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::index_one_file_(const fs::path& p,
                                                   std::string_view content) {
    const auto now=pce::db::now_unix();
    const auto hash=hash_hex(content);
    const auto snippet=make_snippet(content);
    const auto mime=mime_for_extension(p.extension().string());
    std::error_code ec;
    const auto fsize=(int64_t)fs::file_size(p,ec);
    const auto mtime=file_mtime_unix(p);
    auto blob_res=safe_read_binary(p);
    std::optional<std::vector<uint8_t>> content_blob;
    if(blob_res) content_blob=std::move(*blob_res);
    {
        std::lock_guard lk{db_mutex};
        const auto ex=active_db().from("dms_documents").select({"id","text_hash"})
                          .where("path = ?",p.string()).first();
        if(ex&&ex->try_get<std::string>("text_hash").value_or("")==hash){
            const auto id=ex->try_get<int64_t>("id").value_or(0);
            (void)active_db().update("dms_documents").set("indexed_at",now).where("id = ?",id).execute();
            return json{{"doc_id",id},{"path",p.string()},{"unchanged",true}};
        }
    }
    int64_t doc_id=0;
    {
        std::lock_guard lk{db_mutex};
        auto q=active_db().insert_into("dms_documents")
                   .value("path",p.string()).value("filename",p.filename().string())
                   .value("extension",p.extension().string()).value("size_bytes",fsize)
                   .value("mtime",mtime).value("mime_type",mime)
                   .value("kind",kind_for_extension(p.extension().string()))
                   .value("indexed_at",now).value("text_hash",hash).value("snippet",snippet);
        if(content_blob) q.value("content_blob",*content_blob);
        (void)q.on_conflict_replace().execute();
        doc_id=active_db().last_insert_rowid();
    }
    if(doc_id==0) return std::unexpected(std::format("DB upsert failed for '{}'",p.string()));
    std::string kw_json="[]",ents_json="[]",sent_label="neutral",lang="en";
    double sentiment=0.0;
    if(engine){
        const std::string ts{content};
        try{kw_json=engine->keywords_to_json(engine->extract_keywords(ts,15,"")).dump();}catch(...){}
        try{ents_json=engine->entities_to_json(engine->extract_entities(ts,"")).dump();}catch(...){}
        try{const auto sr=engine->analyze_sentiment(ts,"");sentiment=(double)sr.score;sent_label=sr.label;}catch(...){}
        try{lang=engine->detect_language(ts).language;}catch(...){}
    }
    {
        std::lock_guard lk{db_mutex};
        (void)active_db().insert_into("nlp_notes")
            .value("row_type",std::string{"dms_doc"}).value("row_id",doc_id)
            .value("note_text",snippet).value("keywords",kw_json).value("entities",ents_json)
            .value("sentiment",sentiment).value("sentiment_label",sent_label)
            .value("lang",lang).value("created_at",now).execute();
    }
    size_t dims=0;
    if(const auto emb=embed_text_(content); emb){
        dims=emb->size();
        const auto blob=pce::db::floats_to_blob(*emb);
        std::lock_guard lk{db_mutex};
        (void)active_db().insert_into("nlp_embeddings")
            .value("row_type",std::string{"dms_doc"}).value("row_id",doc_id)
            .value("text_hash",hash).value("vector",blob).value("dimensions",(int64_t)dims)
            .value("snippet",snippet).value("updated_at",now).on_conflict_replace().execute();
    }
    auto parse_arr=[](std::string_view s)->json{try{return json::parse(s);}catch(...){return json::array();}};
    return json{{"doc_id",doc_id},{"path",p.string()},{"filename",p.filename().string()},
        {"mime_type",mime},{"snippet",snippet},{"keywords",parse_arr(kw_json)},
        {"entities",parse_arr(ents_json)},{"sentiment",sentiment},
        {"sentiment_label",sent_label},{"lang",lang},
        {"dimensions",(int64_t)dims},{"indexed_at",now},{"unchanged",false}};
}

// ── build_result_json_ ────────────────────────────────────────────────────────
inline json DMSHandle::build_result_json_(int64_t doc_id, float score,
                                           const pce::db::Row& doc,
                                           const std::optional<pce::db::Row>& note) {
    auto pa=[](std::string_view s)->json{try{return json::parse(s);}catch(...){return json::array();}};
    const auto kw=note?note->try_get<std::string>("keywords").value_or("[]"):"[]";
    return json{{"doc_id",doc_id},{"path",doc.get<std::string>("path")},
        {"filename",doc.get<std::string>("filename")},{"score",score},
        {"snippet",doc.get<std::string>("snippet")},{"mime_type",doc.get<std::string>("mime_type")},
        {"keywords",pa(kw)},
        {"sentiment",note?note->try_get<double>("sentiment").value_or(0.0):0.0},
        {"lang",note?note->try_get<std::string>("lang").value_or("en"):std::string{"en"}}};
}

// ── push_progress_ ────────────────────────────────────────────────────────────
inline void DMSHandle::push_progress_(nlohmann::json ev) const {
    saucer::webview* wv=wv_ptr.load(std::memory_order_acquire);
    if(!wv) return;
    try {
        wv->execute(std::format("if(typeof window.__dms_progress==='function')"
                                "{{window.__dms_progress({})}}",ev.dump()));
    } catch(...) {}
}

// =============================================================================
// register_dms_bindings — wire all five domain modules
// =============================================================================

inline void register_dms_bindings(saucer::smartview& wv, DMSHandle& dms,
                                   saucer::modules::desktop& desk) {
    // Store webview pointer once, before any jthread work starts.
    dms.wv_ptr.store(&wv, std::memory_order_release);

    register_file_bindings   (wv, dms, desk);   //  file / dir / picker / copy / move
    register_image_bindings  (wv, dms, desk);   //  SVG / mesh / OCR / EXIF / rectify
    register_nlp_bindings    (wv, dms, desk);   //  index / search / zones / bulk
    register_archive_bindings(wv, dms, desk);   //  create_archive / compress_file
    register_palette_bindings(wv, dms, desk);   //  zone/brand/project ColorPalettes

    std::print("[dms] 4 domain binding modules registered "
               "(file / image / nlp / archive)\n");
}

} // namespace pce::dms
