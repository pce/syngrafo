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
                                                 const pce::db::Row& doc,
                                                 const std::optional<pce::db::Row>& note);

private:
    [[nodiscard]] Expected<std::vector<float>> embed_text(std::string_view text) const;

    ActiveDbFn                                    active_db_;
    std::mutex&                                   db_mutex_;
    std::shared_ptr<pce::nlp::onnx::IOnnxService> embed_svc_;
};

// ─── Implementations ──────────────────────────────────────────────────────────

inline Expected<json> SearchService::search(std::string_view query_sv, int top_k) {
    if (top_k <= 0 || top_k > 500) top_k = 10;
    const std::string query{query_sv};

    // ── Semantic path ─────────────────────────────────────────────────────────
    if (const auto qemb = embed_text(query_sv); qemb) {

        struct Candidate { int64_t doc_id; float score; };

        // Pipeline: embed → scan → boost → assemble
        return std::vector<float>{*qemb}   // raw value: kick off the chain

            | stage([&](std::vector<float> qvec) -> Expected<std::vector<Candidate>> {
                // Scan all stored embeddings, compute cosine similarity
                std::vector<pce::db::Row> rows;
                {
                    std::lock_guard lk{db_mutex_};
                    rows = active_db_().from("nlp_embeddings")
                               .where("row_type = ?", std::string{"dms_doc"}).execute();
                }
                std::vector<Candidate> cands;
                cands.reserve(rows.size());
                for (const auto& row : rows) {
                    const auto id  = row.try_get<int64_t>("row_id").value_or(0);
                    const auto vec = pce::db::try_blob_to_floats(row["vector"]);
                    if (id == 0 || vec.empty()) continue;
                    cands.push_back({id, cosine_similarity(
                        {qvec.data(), qvec.size()}, {vec.data(), vec.size()})});
                }
                // Take 2× top_k for hybrid re-ranking headroom
                const auto keep = std::min(size_t(top_k) * 2, cands.size());
                std::ranges::partial_sort(cands, cands.begin() + (std::ptrdiff_t)keep,
                    [](const Candidate& a, const Candidate& b){ return a.score > b.score; });
                cands.resize(keep);
                return cands;
            })

            | stage([&](std::vector<Candidate> cands) -> Expected<std::vector<Candidate>> {
                // Hybrid boost: if any query token appears in stored NLP keywords, +0.12
                std::vector<std::string> q_tokens;
                {
                    std::string cur;
                    for (char c : query) {
                        if (c == ' ' || c == '\t' || c == '\n') {
                            if (cur.size() >= 3) q_tokens.push_back(cur);
                            cur.clear();
                        } else {
                            cur += (char)std::tolower((unsigned char)c);
                        }
                    }
                    if (cur.size() >= 3) q_tokens.push_back(cur);
                }
                if (q_tokens.empty()) return cands;

                for (auto& c : cands) {
                    std::optional<pce::db::Row> nr;
                    {
                        std::lock_guard lk{db_mutex_};
                        nr = active_db_().from("nlp_notes")
                                 .where("row_type = ?", std::string{"dms_doc"})
                                 .where("row_id   = ?", c.doc_id)
                                 .order_by("created_at", false).first();
                    }
                    if (!nr) continue;
                    auto kw = nr->try_get<std::string>("keywords").value_or("");
                    for (auto& ch : kw) ch = (char)std::tolower((unsigned char)ch);
                    for (const auto& tok : q_tokens) {
                        if (kw.find(tok) != std::string::npos) {
                            c.score = std::min(1.0f, c.score + 0.12f);
                            break;
                        }
                    }
                }
                return cands;
            })

            | stage([&](std::vector<Candidate> cands) -> Expected<json> {
                // Fetch doc rows, build result JSON, final sort + trim
                struct Entry { float score; json data; };
                std::vector<Entry> entries;
                entries.reserve(cands.size());

                for (const auto& c : cands) {
                    if (c.score < 0.10f) continue;
                    std::optional<pce::db::Row> dr, nr;
                    {
                        std::lock_guard lk{db_mutex_};
                        dr = active_db_().from("dms_documents").where("id = ?", c.doc_id).first();
                        nr = active_db_().from("nlp_notes")
                                 .where("row_type = ?", std::string{"dms_doc"})
                                 .where("row_id   = ?", c.doc_id)
                                 .order_by("created_at", false).first();
                    }
                    if (!dr) continue;
                    entries.push_back({c.score, build_result_json(c.doc_id, c.score, *dr, nr)});
                }

                std::ranges::sort(entries, [](const Entry& a, const Entry& b){
                    return a.score > b.score;
                });
                if ((int)entries.size() > top_k) entries.resize(top_k);

                json results = json::array();
                for (auto& e : entries) results.push_back(std::move(e.data));
                return json{{"strategy", "semantic"}, {"query", query}, {"results", std::move(results)}};
            });
    }

    //  Keyword fallback ──────────────────────────────────────────────────────
    // scoring: filename (0.85) > snippet (0.75) > keyword (0.65) > full-text (0.60)
    const std::string q_like = "%" + query + "%";
    struct KwCand { int64_t doc_id; float score; };
    std::unordered_map<int64_t, KwCand> kw_map;
    {
        std::lock_guard lk{db_mutex_};
        for (const auto& row : active_db_().from("dms_documents")
                 .where("filename LIKE ?", q_like).limit(int64_t(top_k) * 2).execute()) {
            const auto id = row.try_get<int64_t>("id").value_or(0);
            if (id) kw_map[id] = {id, 0.85f};
        }
        for (const auto& row : active_db_().from("dms_documents")
                 .where("snippet LIKE ?", q_like).limit(int64_t(top_k) * 2).execute()) {
            const auto id = row.try_get<int64_t>("id").value_or(0);
            if (!id) continue;
            auto it = kw_map.find(id);
            if (it == kw_map.end()) kw_map[id] = {id, 0.75f};
            else it->second.score = std::max(it->second.score, 0.75f);
        }
        for (const auto& row : active_db_().from("nlp_notes")
                 .where("row_type = ?", std::string{"dms_doc"})
                 .where("keywords LIKE ?", q_like)
                 .limit(int64_t(top_k) * 2).execute()) {
            const auto id = row.try_get<int64_t>("row_id").value_or(0);
            if (!id) continue;
            auto it = kw_map.find(id);
            if (it == kw_map.end()) kw_map[id] = {id, 0.65f};
            else it->second.score = std::max(it->second.score, 0.65f);
        }
        // Full-text fallback: search the stored document/OCR text in note_text.
        // This catches documents (especially OCR-indexed images) whose search term
        // appears beyond the 280-char snippet and was not extracted as a keyword.
        // Score 0.60 — below snippet (0.75) and keyword (0.65) matches.
        for (const auto& row : active_db_().from("nlp_notes")
                 .where("row_type = ?", std::string{"dms_doc"})
                 .where("note_text LIKE ?", q_like)
                 .limit(int64_t(top_k) * 2).execute()) {
            const auto id = row.try_get<int64_t>("row_id").value_or(0);
            if (!id) continue;
            auto it = kw_map.find(id);
            if (it == kw_map.end()) kw_map[id] = {id, 0.60f};
            else it->second.score = std::max(it->second.score, 0.60f);
        }
    }
    std::vector<KwCand> kw_cands;
    kw_cands.reserve(kw_map.size());
    for (auto& [id, c] : kw_map) kw_cands.push_back(c);
    std::ranges::sort(kw_cands, [](const KwCand& a, const KwCand& b){ return a.score > b.score; });
    if ((int)kw_cands.size() > top_k) kw_cands.resize(top_k);

    json results = json::array();
    for (const auto& c : kw_cands) {
        std::optional<pce::db::Row> dr, nr;
        {
            std::lock_guard lk{db_mutex_};
            dr = active_db_().from("dms_documents").where("id = ?", c.doc_id).first();
            nr = active_db_().from("nlp_notes")
                     .where("row_type = ?", std::string{"dms_doc"})
                     .where("row_id   = ?", c.doc_id).order_by("created_at", false).first();
        }
        if (!dr) continue;
        auto rj = build_result_json(c.doc_id, c.score, *dr, nr);
        // Context snippet centred on the query match
        const auto ctx = make_context_snippet(dr->get<std::string>("snippet"), query);
        if (!ctx.empty()) rj["snippet"] = ctx;
        results.push_back(std::move(rj));
    }
    return json{{"strategy", "keyword"}, {"query", query}, {"results", std::move(results)}};
}

inline json SearchService::build_result_json(int64_t doc_id, float score,
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

