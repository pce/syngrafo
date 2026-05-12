#pragma once
#include "../../dms_handle.hh"

namespace pce::dms {

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
            bootstrap_fts_schema(zdb);
            bootstrap_chunks_schema(zdb);
            bootstrap_sdm_schema(zdb);
            bootstrap_document_lifecycle_schema(zdb);
            pce::db::migration::apply(zdb, kDmsMigrations);
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
        bootstrap_fts_schema(zdb);
        bootstrap_chunks_schema(zdb);
        bootstrap_sdm_schema(zdb);
        bootstrap_document_lifecycle_schema(zdb);
        pce::db::migration::apply(zdb, kDmsMigrations);
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
        int64_t doc_id = 0;
        std::string tracked_kind = kind_for_extension(dest.extension().string());
        std::string tracked_mime = mime_for_extension(dest.extension().string());
        int64_t tracked_size = 0;
        int64_t tracked_mtime = 0;
        {
            std::lock_guard lk{db_mutex};
            discard(active_db().update("dms_documents")
                .set("origin_path",path)
                .set("is_transformed",(compress||scan)?1:0)
                .set("transform_meta",meta.dump())
                .where("path = ?",dest.string()).execute());
            auto row = active_db().from("dms_documents").where("path = ?", dest.string()).first();
            if (row) {
                doc_id = row->try_get<int64_t>("id").value_or(0);
                tracked_kind = row->try_get<std::string>("kind").value_or(tracked_kind);
                tracked_mime = row->try_get<std::string>("mime_type").value_or(tracked_mime);
                tracked_size = row->try_get<int64_t>("size_bytes").value_or(0);
                tracked_mtime = row->try_get<int64_t>("mtime").value_or(0);
            }
        }
        discard(lifecycle_svc_.ensure_document(DocumentRegistration{
            .doc_id = doc_id,
            .path = dest.string(),
            .source_path = path,
            .zone_name = zone_name,
            .kind = tracked_kind,
            .mime_type = tracked_mime,
            .size_bytes = tracked_size,
            .mtime = tracked_mtime,
        }, "system", "import_to_zone"));
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
    std::optional<pce::db::Row> doc_row,note_row,emb_row,registry_row,state_row;
    std::vector<pce::db::Row> event_rows, version_rows, blob_rows;
    {
        std::lock_guard lk{db_mutex};
        doc_row=db.from("dms_documents").where("path = ?",path).first();
        if(doc_row){
            const auto id=doc_row->get<int64_t>("id");
            note_row=db.from("nlp_notes").where("row_type = 'dms_doc' AND row_id = ?",id).first();
            emb_row=db.from("nlp_embeddings").where("row_type = 'dms_doc' AND row_id = ?",id).first();
            registry_row=active_db().from("dms_document_registry")
                .where("path = ? OR doc_id = ?", path, id).first();
            if (registry_row) {
                const auto uid = registry_row->get<std::string>("document_uid");
                state_row = active_db().from("dms_document_states")
                    .where("document_uid = ?", uid).first();
                event_rows = active_db().from("dms_document_events")
                    .where("document_uid = ?", uid)
                    .order_by("event_no", true)
                    .execute();
                version_rows = active_db().from("dms_document_content_versions")
                    .where("document_uid = ?", uid)
                    .order_by("version_no", true)
                    .execute();
                std::vector<std::string> blob_hashes;
                const auto current_blob = registry_row->try_get<std::string>("current_blob_hash").value_or("");
                if (!current_blob.empty()) blob_hashes.push_back(current_blob);
                for (const auto& vr : version_rows) {
                    const auto blob_hash = vr.try_get<std::string>("blob_hash").value_or("");
                    if (!blob_hash.empty()) blob_hashes.push_back(blob_hash);
                }
                std::sort(blob_hashes.begin(), blob_hashes.end());
                blob_hashes.erase(std::unique(blob_hashes.begin(), blob_hashes.end()), blob_hashes.end());
                for (const auto& hash : blob_hashes) {
                    if (auto row = active_db().from("dms_blob_store").where("blob_hash = ?", hash).first())
                        blob_rows.push_back(*row);
                }
            }
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
        if (registry_row) {
            const auto uid = registry_row->get<std::string>("document_uid");
            for (const auto& br : blob_rows) {
                discard(tdb.insert_into("dms_blob_store")
                    .value("blob_hash", br.get<std::string>("blob_hash"))
                    .value("algorithm", br.try_get<std::string>("algorithm").value_or("fnv1a64"))
                    .value("storage_key", br.try_get<std::string>("storage_key").value_or(""))
                    .value("mime_type", br.try_get<std::string>("mime_type").value_or("application/octet-stream"))
                    .value("size_bytes", br.try_get<int64_t>("size_bytes").value_or(0))
                    .value("created_at", br.try_get<int64_t>("created_at").value_or(0))
                    .value("last_seen_at", br.try_get<int64_t>("last_seen_at").value_or(0))
                    .on_conflict_replace().execute());
            }
            discard(tdb.insert_into("dms_document_registry")
                .value("document_uid", uid)
                .value("doc_id", new_id)
                .value("path", dest.string())
                .value("source_path", registry_row->try_get<std::string>("source_path").value_or(""))
                .value("zone_name", zone_name)
                .value("kind", registry_row->try_get<std::string>("kind").value_or(kind_for_extension(dest.extension().string())))
                .value("mime_type", registry_row->try_get<std::string>("mime_type").value_or(mime_for_extension(dest.extension().string())))
                .value("size_bytes", registry_row->try_get<int64_t>("size_bytes").value_or(0))
                .value("mtime", registry_row->try_get<int64_t>("mtime").value_or(0))
                .value("current_blob_hash", registry_row->try_get<std::string>("current_blob_hash").value_or(""))
                .value("created_at", registry_row->try_get<int64_t>("created_at").value_or(0))
                .value("updated_at", pce::db::now_unix())
                .on_conflict_replace().execute());
            if (state_row)
                discard(tdb.insert_into("dms_document_states")
                    .value("document_uid", uid)
                    .value("state", state_row->try_get<std::string>("state").value_or("INPUT"))
                    .value("review_status", state_row->try_get<std::string>("review_status").value_or(""))
                    .value("latest_event_no", state_row->try_get<int64_t>("latest_event_no").value_or(0))
                    .value("latest_content_version", state_row->try_get<int64_t>("latest_content_version").value_or(0))
                    .value("title", state_row->try_get<std::string>("title").value_or(""))
                    .value("tags_json", state_row->try_get<std::string>("tags_json").value_or("[]"))
                    .value("metadata_json", state_row->try_get<std::string>("metadata_json").value_or("{}"))
                    .value("created_at", state_row->try_get<int64_t>("created_at").value_or(0))
                    .value("updated_at", pce::db::now_unix())
                    .value("archived_at", state_row->try_get<int64_t>("archived_at").value_or(0))
                    .on_conflict_replace().execute());
            for (const auto& er : event_rows)
                discard(tdb.insert_into("dms_document_events")
                    .value("document_uid", uid)
                    .value("event_no", er.try_get<int64_t>("event_no").value_or(0))
                    .value("event_type", er.try_get<std::string>("event_type").value_or(""))
                    .value("state_from", er.try_get<std::string>("state_from").value_or(""))
                    .value("state_to", er.try_get<std::string>("state_to").value_or(""))
                    .value("actor", er.try_get<std::string>("actor").value_or("system"))
                    .value("source", er.try_get<std::string>("source").value_or("system"))
                    .value("payload_json", er.try_get<std::string>("payload_json").value_or("{}"))
                    .value("created_at", er.try_get<int64_t>("created_at").value_or(0))
                    .on_conflict_replace().execute());
            for (const auto& vr : version_rows)
                discard(tdb.insert_into("dms_document_content_versions")
                    .value("document_uid", uid)
                    .value("version_no", vr.try_get<int64_t>("version_no").value_or(0))
                    .value("content_kind", vr.try_get<std::string>("content_kind").value_or("TEXT_EXTRACTED"))
                    .value("text_hash", vr.try_get<std::string>("text_hash").value_or(""))
                    .value("blob_hash", vr.try_get<std::string>("blob_hash").value_or(""))
                    .value("mime_type", vr.try_get<std::string>("mime_type").value_or("text/plain"))
                    .value("payload_json", vr.try_get<std::string>("payload_json").value_or("{}"))
                    .value("created_at", vr.try_get<int64_t>("created_at").value_or(0))
                    .value("source_event_no", vr.try_get<int64_t>("source_event_no").value_or(0))
                    .on_conflict_replace().execute());
        }
        tx.commit();
        const auto old_id=doc_row->get<int64_t>("id");
        discard(db.delete_from("dms_documents").where("id = ?", old_id).execute());
        discard(db.delete_from("nlp_notes").where("row_type = 'dms_doc' AND row_id = ?", old_id).execute());
        discard(db.delete_from("nlp_embeddings").where("row_type = 'dms_doc' AND row_id = ?", old_id).execute());
        if (registry_row) {
            const auto uid = registry_row->get<std::string>("document_uid");
            discard(active_db().delete_from("dms_document_events").where("document_uid = ?", uid).execute());
            discard(active_db().delete_from("dms_document_content_versions").where("document_uid = ?", uid).execute());
            discard(active_db().delete_from("dms_document_states").where("document_uid = ?", uid).execute());
            discard(active_db().delete_from("dms_document_registry").where("document_uid = ?", uid).execute());
        }
    }
    return json{{"ok",true},{"dest",dest.string()}};
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

} // namespace pce::dms
