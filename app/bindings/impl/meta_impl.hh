#pragma once
#include "../../dms_handle.hh"

namespace pce::dms {

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

inline void DMSHandle::push_progress_(nlohmann::json ev) const {
    saucer::webview* wv2 = wv_ptr.load(std::memory_order_acquire);
    if (!wv2) return;
    try {
        wv2->execute(std::format("if(typeof window.__dms_progress==='function')"
                                 "{{window.__dms_progress({})}}",
                                 ev.dump()));
    } catch (...) {}
}

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

} // namespace pce::dms
