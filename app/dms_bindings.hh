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

#include "dms_handle.hh"

#include "bindings/file_bindings.hh"
#include "bindings/image_bindings.hh"
#include "bindings/nlp_bindings.hh"
#include "bindings/archive_bindings.hh"
#include "bindings/palette_bindings.hh"
#include "bindings/model_bindings.hh"
#include "bindings/bookmark_bindings.hh"

namespace pce::dms {


    // DMSHandle method implementations
    // (declared in dms_handle.hh, defined here so all helpers are in scope)


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

inline Expected<json> DMSHandle::index_document(std::string_view path_str) {
    return index_svc_.index_document(path_str);
}

inline Expected<json> DMSHandle::bulk_index_start(std::string_view dir_path) {
    return index_svc_.bulk_index_start(
        dir_path,
        bulk_active,
        bulk_thread,
        [this]{ return get_active_in_path(); },
        [this](json ev){ push_progress_(std::move(ev)); });
}

inline Expected<json> DMSHandle::search(std::string_view query, int top_k) {
    return search_svc_.search(query, top_k);
}

inline Expected<pce::db::Database> DMSHandle::open_zone_db(
    std::string_view zone_name,
    std::optional<std::string> password) {
    if (zone_name=="global"||zone_name=="") return open_db_();
    std::optional<pce::db::Row> zone_row;
    {
        std::lock_guard lk{db_mutex};
        zone_row=db.from("dms_zones").where("name = ?",std::string{zone_name}).first();
    }
    if (!zone_row) return std::unexpected(std::format("Zone '{}' not found",zone_name));
    fs::path db_path=fs::path{zone_row->get<std::string>("out_path")}/".syngrafo.db";
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
            discard(pce::keychain::store(pce::keychain::zone_account(zone_name_str), key));
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
    if (scan && rectifier) {
        std::print("[dms] Rectifying {}\n", dest.string());
        std::string rf = (out_dir / (src.stem().string() + ".rectified" + src.extension().string())).string();
        if (rectifier->rectify(dest.string(), rf)) { fs::remove(dest); dest = fs::path(rf); meta["applied_scan"] = true; }
        else std::print(stderr, "[dms] Rectifier: no corners detected, skipping\n");
    }
    if (compress){std::print("[dms] Compress placeholder\n");meta["applied_compression"]=true;}
    auto r=index_document(dest.string());
    if(r){
        std::lock_guard lk{db_mutex};
        discard(active_db().update("dms_documents")
            .set("origin_path",path)
            .set("is_transformed",(compress||scan)?1:0)
            .set("transform_meta",meta.dump())
            .where("path = ?",dest.string()).execute());
    }
    return json{{"ok",true},{"dest",dest.string()},{"meta",meta}};
}

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
        discard(tdb.insert_into("dms_documents")
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
            .on_conflict_replace().execute());
        const int64_t new_id=tdb.last_insert_rowid();
        if(note_row)
            discard(tdb.insert_into("nlp_notes")
                .value("row_type","dms_doc").value("row_id",new_id)
                .value("note_text",note_row->get<std::string>("note_text"))
                .value("keywords",note_row->get<std::string>("keywords"))
                .value("entities",note_row->get<std::string>("entities"))
                .value("sentiment",note_row->get<double>("sentiment"))
                .value("sentiment_label",note_row->get<std::string>("sentiment_label"))
                .value("lang",note_row->get<std::string>("lang"))
                .value("created_at",note_row->get<int64_t>("created_at")).execute());
        if(emb_row)
            discard(tdb.insert_into("nlp_embeddings")
                .value("row_type","dms_doc").value("row_id",new_id)
                .value("text_hash",emb_row->get<std::string>("text_hash"))
                .value("vector",emb_row->get<std::vector<uint8_t>>("vector"))
                .value("dimensions",emb_row->get<int64_t>("dimensions"))
                .value("snippet",emb_row->get<std::string>("snippet"))
                .value("updated_at",emb_row->get<int64_t>("updated_at"))
                .on_conflict_replace().execute());
        tx.commit();
        const auto old_id=doc_row->get<int64_t>("id");
        discard(db.delete_from("dms_documents").where("id = ?", old_id).execute());
        discard(db.delete_from("nlp_notes").where("row_type = 'dms_doc' AND row_id = ?", old_id).execute());
        discard(db.delete_from("nlp_embeddings").where("row_type = 'dms_doc' AND row_id = ?", old_id).execute());
    }
    return json{{"ok",true},{"dest",dest.string()}};
}

inline std::string DMSHandle::ocr_document(std::string path, std::string zone_name) {
    // OcrPayload flows through: cache-check → run OCR → validate → cache-write
    //                           → index + export → json response

    struct OcrPayload {
        fs::path    path;
        long long   mtime{};
        std::string text;
        bool        was_cached{false};
    };

    const fs::path p{path};
    if (!fs::exists(p)) return err_str("File not found: " + path);

    const long long mtime = (long long)fs::last_write_time(p).time_since_epoch().count();

    auto result =
        OcrPayload{p, mtime}

        | stage([&](OcrPayload pl) -> Expected<OcrPayload> {
            // Cache hit: return early with stored text
            auto cached = db.from("dms_ocr_cache").select({"text"})
                             .where("path = ? AND mtime = ?", pl.path.string(), pl.mtime)
                             .first();
            if (cached) {
                pl.text       = cached->get<std::string>("text");
                pl.was_cached = true;
                return pl;
            }
            // Cache miss: run OCR
            if (!engine || !engine->has_ocr())
                return std::unexpected(std::string{"OCR engine not available"});

            pl.text = engine->extract_text_from_image(pl.path.string());
            if (pl.text.empty())
                return std::unexpected(std::string{"OCR failed to extract any text"});
            if (pl.text.starts_with("[Error:") || pl.text.starts_with("[error:"))
                return std::unexpected("OCR failed: " + pl.text);

            const auto trimmed = [](std::string s) {
                s.erase(0, s.find_first_not_of(" \t\r\n"));
                const auto e = s.find_last_not_of(" \t\r\n");
                if (e != std::string::npos) s.erase(e + 1);
                return s;
            }(pl.text);
            if (trimmed.size() < 4)
                return std::unexpected(std::string{"__empty__"});

            return pl;
        })

        | stage([&](OcrPayload pl) -> Expected<OcrPayload> {
            // Persist to cache if freshly extracted
            if (!pl.was_cached) {
                const auto created = (long long)std::chrono::system_clock::now()
                                         .time_since_epoch().count();
                discard(db.insert_into("dms_ocr_cache")
                             .value("path",       pl.path.string())
                             .value("text",       pl.text)
                             .value("mtime",      pl.mtime)
                             .value("created_at", created)
                             .on_conflict_replace()
                             .execute());
            }
            return pl;
        })

        | stage([&](OcrPayload pl) -> Expected<OcrPayload> {
            // Index the extracted text
            discard(index_svc_.index_one(pl.path, pl.text));

            // Export .ocr.txt to the zone output directory if a zone was given
            if (!zone_name.empty()) {
                std::optional<pce::db::Row> zr;
                {
                    std::lock_guard lk{db_mutex};
                    zr = db.from("dms_zones").where("name = ?", zone_name).first();
                }
                if (zr) {
                    const fs::path od{zr->get<std::string>("out_path")};
                    if (fs::exists(od) && fs::is_directory(od)) {
                        const fs::path of = od / (p.stem().string() + ".ocr.txt");
                        if (std::ofstream ofs{of}; ofs) {
                            ofs << pl.text;
                            discard(index_document(of.string()));
                        }
                    }
                }
            }
            return pl;
        });

    // The "__empty__" sentinel encodes a clean empty-text result (not an error)
    if (!result && result.error() == "__empty__")
        return ok_str(json{{"text", ""}, {"cached", false}});
    if (!result)
        return err_str(result.error());

    const auto quality = IndexService::ocr_quality(result->text);
    return ok_str(json{
        {"text",     result->text},
        {"cached",   result->was_cached},
        {"quality",  quality},
    });
}

/**
 * @brief Perspective-rectify a document image and re-index the result.
 *
 * Works on all platforms:
 *   - macOS: Apple Vision detects corners; CoreImage or C++ warp applies the transform.
 *   - Linux/Windows + ONNX model loaded: segmentation model detects corners.
 *   - Linux/Windows without ONNX: fails gracefully — no corner detection available.
 */
inline Expected<json> DMSHandle::rectify_document(std::string_view path_str,
                                                    std::optional<std::string> out_path_opt) {
    const fs::path src{path_str};
    std::error_code ec;
    return require(fs::exists(src, ec), std::format("'{}' does not exist", path_str))
        .and_then([&]() -> Expected<json> {
            fs::path out_path;
            if (out_path_opt && !out_path_opt->empty())
                out_path = *out_path_opt;
            else
                out_path = src.parent_path() / (src.stem().string() + ".rectified.jpg");
            if (!rectifier)
                return std::unexpected(std::string{"Rectifier addon not loaded"});
            if (!rectifier->rectify(src.string(), out_path.string()))
                return std::unexpected(std::string{"Rectification failed (no document corners detected)"});
            discard(index_document(out_path.string()));
            return json{{"success", true}, {"outPath", out_path.string()}};
        });
}

/** @brief Creates or updates a zone record and its on-disk directories. */
inline Expected<json> DMSHandle::upsert_zone(std::string_view name,
                                               std::string_view in_path,
                                               std::string_view out_path,
                                               std::optional<std::string> password,
                                               std::string_view description,
                                               std::string_view taxonomy_domain) {
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        const auto now = pce::db::now_unix();
        auto query = db.insert_into("dms_zones")
                         .value("name",            std::string{name})
                         .value("in_path",         std::string{in_path})
                         .value("out_path",        std::string{out_path})
                         .value("last_visited",    now)
                         .value("description",     std::string{description})
                         .value("taxonomy_domain", std::string{taxonomy_domain});
        if (password && !password->empty()) {
            const std::string salt = generate_zone_salt();
            const std::string key  = derive_zone_key(*password, salt);
            query.value("salt_hex",     salt);
            query.value("is_encrypted", 1);
#ifdef __APPLE__
            const std::string account = pce::keychain::zone_account(name);
            if (pce::keychain::store(account, key))
                query.value("password_hashed", "");
            else {
                std::print(stderr, "[dms] WARNING: Keychain store failed for zone '{}'. "
                           "Falling back to DB key storage.\n", name);
                query.value("password_hashed", key);
            }
#else
            query.value("password_hashed", key);
#endif
        }
        discard(query.on_conflict_replace().execute());
        return json{{"ok", true}};
    });
}

/** @brief Returns per-directory disk usage stats for a zone's output tree. */
inline Expected<json> DMSHandle::zone_disk_usage(std::string_view zone_name) {
    if (zone_name.empty() || zone_name == "global")
        return std::unexpected("zone_disk_usage requires a zone name");

    std::string in_path, out_path;
    {
        std::lock_guard lk{db_mutex};
        const auto row = db.from("dms_zones")
                             .where("name = ?", std::string{zone_name})
                             .first();
        if (!row)
            return std::unexpected(std::format("Zone '{}' not found", zone_name));
        in_path  = row->get<std::string>("in_path");
        out_path = row->get<std::string>("out_path");
    }

    return storage_svc_.zone_usage(zone_name, in_path, out_path);
}

/** @brief Resolves a zone-relative bookmark target to an absolute path and line range. */
inline Expected<json> DMSHandle::bookmark_resolve(std::string_view zone_name,
                                                    std::string_view target) {
    if (zone_name.empty()) return std::unexpected("zone_name must not be empty");
    if (target.empty())    return std::unexpected("target must not be empty");

    int64_t line_from{0}, line_to{0};
    const std::string bare = Bookmark::parse_target(target, line_from, line_to);
    const std::string kind = Bookmark::infer_kind(bare);

    std::string out_dir;
    {
        std::lock_guard lk{db_mutex};
        if (zone_name != "global" && !zone_name.empty()) {
            const auto row = db.from("dms_zones")
                               .where("name = ?", std::string{zone_name}).first();
            if (row) out_dir = row->get<std::string>("out_path");
        }
    }
    if (out_dir.empty()) out_dir = get_active_in_path();

    const fs::path abs_path = fs::path{out_dir} / bare;
    std::error_code ec;
    const bool exists = fs::exists(abs_path, ec);

    return json{
        {"abs_path",  abs_path.string()},
        {"line_from", line_from},
        {"line_to",   line_to},
        {"kind",      kind},
        {"exists",    exists},
    };
}

// ── push_progress_ ──────────────────────────────────────────────────────────
inline void DMSHandle::push_progress_(nlohmann::json ev) const {
    saucer::webview* wv2 = wv_ptr.load(std::memory_order_acquire);
    if (!wv2) return;
    try {
        wv2->execute(std::format("if(typeof window.__dms_progress==='function')"
                                 "{{window.__dms_progress({})}}",
                                 ev.dump()));
    } catch (...) {}
}

// ── index_status ─────────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::index_status() {
    return try_invoke([&]() -> json {
        int64_t total{}, last_indexed{};
        {
            std::lock_guard lk{db_mutex};
            total = active_db().from("dms_documents").count();
            if (const auto r = active_db()
                                   .from("dms_documents")
                                   .select({"MAX(indexed_at) AS t"})
                                   .first())
                last_indexed = r->try_get<int64_t>("t").value_or(0);
        }
        return json{
            {"total_docs",        total},
            {"bulk_active",       bulk_active.load()},
            {"last_indexed_at",   last_indexed},
            {"active_zone",       active_zone_name},
            {"active_in_path",    get_active_in_path()},
        };
    });
}

// ── get_metadata ─────────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::get_metadata(std::string_view path_str) {
    std::optional<pce::db::Row> doc_row, note_row, emb_row;
    {
        std::lock_guard lk{db_mutex};
        doc_row = active_db()
                      .from("dms_documents")
                      .where("path = ?", std::string{path_str})
                      .first();
        if (doc_row) {
            const auto id = doc_row->try_get<int64_t>("id").value_or(0);
            note_row = active_db()
                           .from("nlp_notes")
                           .where("row_type = ?", std::string{"dms_doc"})
                           .where("row_id   = ?", id)
                           .order_by("created_at", false)
                           .first();
            emb_row  = active_db()
                           .from("nlp_embeddings")
                           .where("row_type = ?", std::string{"dms_doc"})
                           .where("row_id   = ?", id)
                           .first();
        }
    }
    if (!doc_row)
        return std::unexpected(std::format("'{}' has not been indexed", path_str));

    const auto id = doc_row->try_get<int64_t>("id").value_or(0);
    auto parse_arr = [](std::string_view s) -> json {
        try { return json::parse(s); } catch (...) { return json::array(); }
    };
    auto kw_str  = note_row ? note_row->try_get<std::string>("keywords").value_or("[]") : "[]";
    auto ent_str = note_row ? note_row->try_get<std::string>("entities").value_or("[]") : "[]";
    return json{
        {"doc_id",           id},
        {"path",             doc_row->get<std::string>("path")},
        {"filename",         doc_row->get<std::string>("filename")},
        {"extension",        doc_row->get<std::string>("extension")},
        {"mime_type",        doc_row->get<std::string>("mime_type")},
        {"size_bytes",       doc_row->try_get<int64_t>("size_bytes").value_or(0)},
        {"mtime",            doc_row->try_get<int64_t>("mtime").value_or(0)},
        {"indexed_at",       doc_row->try_get<int64_t>("indexed_at").value_or(0)},
        {"snippet",          doc_row->get<std::string>("snippet")},
        {"keywords",         parse_arr(kw_str)},
        {"entities",         parse_arr(ent_str)},
        {"sentiment",        note_row ? note_row->try_get<double>("sentiment").value_or(0.0) : 0.0},
        {"sentiment_label",  note_row ? note_row->try_get<std::string>("sentiment_label").value_or("neutral") : std::string{"neutral"}},
        {"lang",             note_row ? note_row->try_get<std::string>("lang").value_or("en") : std::string{"en"}},
        {"has_embedding",    emb_row.has_value()},
        {"dimensions",       emb_row ? emb_row->try_get<int64_t>("dimensions").value_or(0) : int64_t{0}},
        {"has_content_blob", doc_row && !doc_row->is_null("content_blob")},
    };
}

// ── get_zones ────────────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::get_zones() {
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        return db.from("dms_zones")
            .order_by("last_visited", false)
            .limit(10)
            .map<json>([](const pce::db::Row& r) {
                return json{
                    {"name",            r.get<std::string>("name")},
                    {"in_path",         r.get<std::string>("in_path")},
                    {"out_path",        r.get<std::string>("out_path")},
                    {"last_visited",    r.get<int64_t>("last_visited")},
                    {"description",     r.try_get<std::string>("description").value_or("")},
                    {"taxonomy_domain", r.try_get<std::string>("taxonomy_domain").value_or("General")},
                    {"is_encrypted",    r.try_get<int64_t>("is_encrypted").value_or(0) != 0},
                };
            });
    });
}

// ── bookmark_add ─────────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::bookmark_add(std::string_view zone_name,
                                               std::string_view label,
                                               std::string_view target) {
    if (zone_name.empty()) return std::unexpected("zone_name must not be empty");
    if (target.empty())    return std::unexpected("target must not be empty");
    int64_t line_from{0}, line_to{0};
    const std::string bare = Bookmark::parse_target(target, line_from, line_to);
    const std::string kind = Bookmark::infer_kind(bare);
    const int64_t now = pce::db::now_unix();
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        const int64_t id = db.insert_into("zone_bookmarks")
            .value("zone_name",  std::string{zone_name})
            .value("label",      std::string{label})
            .value("target",     std::string{target})
            .value("kind",       kind)
            .value("line_from",  line_from)
            .value("line_to",    line_to)
            .value("created_at", now)
            .value("updated_at", now)
            .execute();
        return json{
            {"id",         id},
            {"zone_name",  zone_name},
            {"label",      label},
            {"target",     target},
            {"kind",       kind},
            {"line_from",  line_from},
            {"line_to",    line_to},
            {"sort_order", int64_t{0}},
        };
    });
}

// ── bookmark_list ────────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::bookmark_list(std::string_view zone_name) {
    if (zone_name.empty()) return std::unexpected("zone_name must not be empty");
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        return db.from("zone_bookmarks")
            .where("zone_name = ?", std::string{zone_name})
            .order_by("sort_order")
            .map<json>([](const pce::db::Row& r) {
                return json{
                    {"id",         r.get<int64_t>("id")},
                    {"zone_name",  r.get<std::string>("zone_name")},
                    {"label",      r.get<std::string>("label")},
                    {"target",     r.get<std::string>("target")},
                    {"kind",       r.get<std::string>("kind")},
                    {"line_from",  r.try_get<int64_t>("line_from").value_or(0)},
                    {"line_to",    r.try_get<int64_t>("line_to").value_or(0)},
                    {"sort_order", r.try_get<int64_t>("sort_order").value_or(0)},
                };
            });
    });
}

// ── bookmark_delete ───────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::bookmark_delete(int64_t id) {
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        const int affected = db.delete_from("zone_bookmarks").where("id = ?", id).execute();
        return json{{"deleted", affected > 0}};
    });
}

// ── bookmark_update ───────────────────────────────────────────────────────────
inline Expected<json> DMSHandle::bookmark_update(int64_t id,
                                                   std::string_view label,
                                                   std::string_view target,
                                                   int64_t sort_order) {
    const int64_t now = pce::db::now_unix();
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        int64_t line_from{0}, line_to{0};
        const std::string bare = Bookmark::parse_target(target, line_from, line_to);
        const std::string kind = Bookmark::infer_kind(bare);
        const int affected = db.update("zone_bookmarks")
            .set("label",      std::string{label})
            .set("target",     std::string{target})
            .set("kind",       kind)
            .set("line_from",  line_from)
            .set("line_to",    line_to)
            .set("sort_order", sort_order)
            .set("updated_at", now)
            .where("id = ?", id)
            .execute();
        if (affected == 0) return json{{"ok", false}, {"error", "bookmark not found"}};
        const auto row = db.from("zone_bookmarks").where("id = ?", id).first();
        if (!row) return json{{"ok", true}};
        return json{
            {"id",         row->get<int64_t>("id")},
            {"zone_name",  row->get<std::string>("zone_name")},
            {"label",      row->get<std::string>("label")},
            {"target",     row->get<std::string>("target")},
            {"kind",       row->get<std::string>("kind")},
            {"line_from",  row->try_get<int64_t>("line_from").value_or(0)},
            {"line_to",    row->try_get<int64_t>("line_to").value_or(0)},
            {"sort_order", row->try_get<int64_t>("sort_order").value_or(0)},
        };
    });
}

/** @brief Wires all DMS C++ functions into the saucer smartview as JS-callable bindings. */
inline void register_dms_bindings(saucer::smartview&                           wv,
                                   DMSHandle&                                   dms,
                                   saucer::modules::desktop&                    desk,
                                   saucer::model_downloader::ModelDownloader&   dl) {
    register_file_bindings    (wv, dms, desk);
    register_image_bindings   (wv, dms, desk);
    register_nlp_bindings     (wv, dms, desk);
    register_archive_bindings (wv, dms, desk);
    register_palette_bindings (wv, dms, desk);
    register_model_bindings   (wv, dl,  dms);
    register_bookmark_bindings(wv, dms);
}

} // namespace pce::dms
