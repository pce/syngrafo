#pragma once
/**
 * @file services/search/search_service.hh
 * @brief SearchService — two-strategy search over the DMS index.
 *
 * Strategy selection is automatic:
 *   - **Semantic** (embed service available): cosine similarity over
 *     `nlp_embeddings`, then hybrid keyword boost, then re-rank.
 *   - **Keyword fallback**: LIKE queries across filename, snippet, and
 *     `nlp_notes.keywords`.
 *
 * The semantic path is expressed as a `core/pipeline.hh` chain:
 * @code
 *   query_text
 *       | stage(embed_query)         → embedding vector
 *       | stage(scan_candidates)     → scored candidate list
 *       | stage(hybrid_boost)        → re-ranked candidate list
 *       | stage(fetch_and_build)     → json result array
 * @endcode
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

    /** Candidate entry in the result map. */
    struct Cand { int64_t doc_id; float score; std::string match; };
    std::unordered_map<int64_t, Cand> merged;

    /**
     * Keyword pass — the sole source of candidates.
     *
     * Scoring tiers (descending priority):
     *   filename  0.85  — query term appears in the document filename
     *   snippet   0.75  — query term appears in the stored text snippet
     *   keyword   0.65  — query term appears in NLP-extracted keyword list
     *   fulltext  0.60  — query term found anywhere in the full indexed text
     *
     * A document may match in several tiers; only the highest score is kept.
     */
    const std::string q_like = "%" + query + "%";
    {
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

    /**
     * Semantic re-rank (optional) — only adjusts scores of candidates already
     * found by keyword; never introduces new candidates.
     *
     * Rationale: embedding models often produce degenerate similarity scores
     * (all document vectors cluster together, cosine_sim ≈ 0.97 for everything).
     * Restricting semantic to re-ranking ensures a degenerate model cannot
     * surface irrelevant documents.  When the model improves, this design
     * naturally rewards it without changing the interface.
     */
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
                if (it == merged.end()) continue; // never add from semantic alone
                const float boosted = std::min(score, 0.95f);
                if (boosted > it->second.score) {
                    it->second.score = boosted;
                    it->second.match = "hybrid";
                }
            }
        }
    }

    // Collect, sort by score, trim to top_k, fetch rows, build JSON.
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
    const std::string strategy = used_semantic ? "hybrid" : "keyword";
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

