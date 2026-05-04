#pragma once
/**
 * @file services/search/search_service.hh
 * @brief Hybrid document search: FTS5 BM25 → LIKE fallback → optional embedding re-rank.
 */

#include "../../core/pipeline.hh"
#include "../../db/database.hh"
#include "../../dms_monadic.hh"
#include "../../internal/hashing.hh"
#include "../../internal/math.hh"

#include <algorithm>
#include <cmath>
#include <format>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include <nlohmann/json.hpp>

#ifdef NLP_WITH_ONNX
#  include "nlp/addons/onnx_addon.hh"
#endif

namespace pce::dms {

using json = nlohmann::json;


/**
 * @class SearchService
 * @brief Executes DMS queries against the active database.
 *
 * Receives infrastructure references from DMSHandle (facade), never owns them.
 */
class SearchService {
public:
    using ActiveDbFn = std::function<pce::db::Database&()>;

    explicit SearchService(ActiveDbFn                                    active_db,
                           std::mutex&                                   db_mutex,
                           std::shared_ptr<pce::nlp::onnx::IOnnxService> embed_svc)
        : active_db_(std::move(active_db))
        , db_mutex_(db_mutex)
        , embed_svc_(std::move(embed_svc))
    {}

    [[nodiscard]] Expected<json> search(std::string_view query, int top_k);

    [[nodiscard]] static json build_result_json(int64_t doc_id, float score,
                                                 const std::string& match,
                                                 const pce::db::Row& doc,
                                                 const std::optional<pce::db::Row>& note);

private:
    [[nodiscard]] Expected<std::vector<float>> embed_text(std::string_view text) const;

    ActiveDbFn                                    active_db_;
    std::mutex&                                   db_mutex_;
    std::shared_ptr<pce::nlp::onnx::IOnnxService> embed_svc_;
};

inline Expected<json> SearchService::search(std::string_view query_sv, int top_k) {
    if (top_k <= 0 || top_k > 500) top_k = 10;
    const std::string query{query_sv};

    struct Cand { int64_t doc_id; float score; std::string match; };
    std::unordered_map<int64_t, Cand> merged;

    bool fts_used = false;
    {
        std::lock_guard lk{db_mutex_};
        try {
            auto* stmt = active_db_().prepare_cached(
                "SELECT rowid, rank FROM dms_fts WHERE dms_fts MATCH ? ORDER BY rank LIMIT ?");
            pce::db::Database::bind(stmt, 1, pce::db::to_db_value(query));
            pce::db::Database::bind(stmt, 2, pce::db::to_db_value(int64_t(top_k) * 3));

            std::vector<std::pair<int64_t, float>> fts_hits;
            float min_rank = 0.0f;
            while (sqlite3_step(stmt) == SQLITE_ROW) {
                const int64_t id = sqlite3_column_int64(stmt, 0);
                const float   rk = static_cast<float>(sqlite3_column_double(stmt, 1));
                fts_hits.emplace_back(id, rk);
                if (rk < min_rank) min_rank = rk;
            }
            if (!fts_hits.empty()) {
                fts_used = true;
                // BM25 rank is negative; normalise to (0, 0.90] via rk/min_rank
                for (const auto& [id, rk] : fts_hits) {
                    const float score = std::min(0.90f,
                        min_rank < 0.0f ? rk / min_rank : 0.50f);
                    merged[id] = {id, score, "bm25"};
                }
            }
        } catch (...) {
            // FTS5 not available or query syntax error — fall through to LIKE.
        }
    }

    const std::string q_like = "%" + query + "%";
    if (!fts_used) {
        std::lock_guard lk{db_mutex_};
        for (const auto& row : active_db_().from("dms_documents")
                 .where("filename LIKE ?", q_like).limit(int64_t(top_k) * 2).execute()) {
            const auto id = row.try_get<int64_t>("id").value_or(0);
            if (id) merged[id] = {id, 0.85f, "filename"};
        }
        for (const auto& row : active_db_().from("dms_documents")
                 .where("snippet LIKE ?", q_like).limit(int64_t(top_k) * 2).execute()) {
            const auto id = row.try_get<int64_t>("id").value_or(0);
            if (!id) continue;
            auto it = merged.find(id);
            if (it == merged.end()) merged[id] = {id, 0.75f, "snippet"};
            else if (it->second.score < 0.75f) { it->second.score = 0.75f; it->second.match = "snippet"; }
        }
        for (const auto& row : active_db_().from("nlp_notes")
                 .where("row_type = ?", std::string{"dms_doc"})
                 .where("keywords LIKE ?", q_like).limit(int64_t(top_k) * 2).execute()) {
            const auto id = row.try_get<int64_t>("row_id").value_or(0);
            if (!id) continue;
            auto it = merged.find(id);
            if (it == merged.end()) merged[id] = {id, 0.65f, "keyword"};
            else if (it->second.score < 0.65f) { it->second.score = 0.65f; it->second.match = "keyword"; }
        }
        for (const auto& row : active_db_().from("nlp_notes")
                 .where("row_type = ?", std::string{"dms_doc"})
                 .where("note_text LIKE ?", q_like).limit(int64_t(top_k) * 2).execute()) {
            const auto id = row.try_get<int64_t>("row_id").value_or(0);
            if (!id) continue;
            auto it = merged.find(id);
            if (it == merged.end()) merged[id] = {id, 0.60f, "fulltext"};
            else if (it->second.score < 0.60f) { it->second.score = 0.60f; it->second.match = "fulltext"; }
        }
    }

    // Semantic re-rank: only boosts scores of keyword candidates; never introduces new ones.
    bool used_semantic = false;
    if (!merged.empty()) {
        if (const auto qemb = embed_text(query_sv); qemb) {
            used_semantic = true;
            std::vector<std::pair<int64_t, float>> sem;
            {
                std::lock_guard lk{db_mutex_};
                const auto rows = active_db_().from("nlp_embeddings")
                                      .where("row_type = ?", std::string{"dms_doc"}).execute();
                sem.reserve(rows.size());
                for (const auto& row : rows) {
                    const auto id  = row.try_get<int64_t>("row_id").value_or(0);
                    const auto vec = pce::db::try_blob_to_floats(row["vector"]);
                    if (id == 0 || vec.empty()) continue;
                    sem.push_back({id, cosine_similarity(
                        {qemb->data(), qemb->size()}, {vec.data(), vec.size()})});
                }
            }
            for (const auto& [id, score] : sem) {
                auto it = merged.find(id);
                if (it == merged.end()) continue;
                const float boosted = std::min(score, 0.95f);
                if (boosted > it->second.score) {
                    it->second.score = boosted;
                    it->second.match = "hybrid";
                }
            }
        }
    }

    std::vector<Cand> cands;
    cands.reserve(merged.size());
    for (auto& [id, c] : merged) cands.push_back(c);
    std::ranges::sort(cands, [](const Cand& a, const Cand& b){ return a.score > b.score; });
    if ((int)cands.size() > top_k) cands.resize(top_k);

    json results = json::array();
    for (const auto& c : cands) {
        std::optional<pce::db::Row> dr, nr;
        {
            std::lock_guard lk{db_mutex_};
            dr = active_db_().from("dms_documents").where("id = ?", c.doc_id).first();
            nr = active_db_().from("nlp_notes")
                     .where("row_type = ?", std::string{"dms_doc"})
                     .where("row_id   = ?", c.doc_id).order_by("created_at", false).first();
        }
        if (!dr) continue;
        auto rj = build_result_json(c.doc_id, c.score, c.match, *dr, nr);
        const auto ctx = make_context_snippet(dr->get<std::string>("snippet"), query);
        if (!ctx.empty()) rj["snippet"] = ctx;
        results.push_back(std::move(rj));
    }
    const std::string strategy = used_semantic ? "hybrid" : (fts_used ? "bm25" : "keyword");
    return json{{"strategy", strategy}, {"query", query}, {"results", std::move(results)}};
}

inline json SearchService::build_result_json(int64_t doc_id, float score,
                                              const std::string& match,
                                              const pce::db::Row& doc,
                                              const std::optional<pce::db::Row>& note) {
    auto pa = [](std::string_view s) -> json {
        try { return json::parse(s); } catch (...) { return json::array(); }
    };
    const auto kw = note ? note->try_get<std::string>("keywords").value_or("[]") : "[]";
    return json{
        {"doc_id",    doc_id},
        {"path",      doc.get<std::string>("path")},
        {"filename",  doc.get<std::string>("filename")},
        {"score",     score},
        {"match",     match},
        {"snippet",   doc.get<std::string>("snippet")},
        {"mime_type", doc.get<std::string>("mime_type")},
        {"keywords",  pa(kw)},
        {"sentiment", note ? note->try_get<double>("sentiment").value_or(0.0) : 0.0},
        {"lang",      note ? note->try_get<std::string>("lang").value_or("en") : std::string{"en"}},
    };
}

inline Expected<std::vector<float>> SearchService::embed_text(std::string_view text) const {
    if (!embed_svc_)              return std::unexpected(std::string{"no embed service configured"});
    if (!embed_svc_->is_loaded()) return std::unexpected(std::string{"embed model not loaded"});
    return try_invoke([&]() -> std::vector<float> {
        auto r = embed_svc_->embed(std::string{text});
        if (!r.success || r.vector.empty()) throw std::runtime_error{"embedding returned empty"};
        return std::move(r.vector);
    });
}

} // namespace pce::dms
