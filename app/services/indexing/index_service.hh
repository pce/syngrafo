#pragma once
/**
 * @file services/indexing/index_service.hh
 * @brief IndexService — document indexing expressed as a core/pipeline.hh chain.
 *
 * Pipeline per document:
 * @code
 *   FilePayload{path, mime, text}
 *       | stage(store_doc)      → AnalyzedPayload{doc_id, ...}
 *       | stage(analyze_nlp)    → AnalyzedPayload{kw, ents, sent, lang}
 *       | stage(embed_persist)  → json result
 * @endcode
 */

#include "../../core/pipeline.hh"
#include "../../db/database.hh"
#include "../../dms_monadic.hh"
#include "../../internal/discard.hh"
#include "../../internal/fs_utils.hh"
#include "../../internal/hashing.hh"
#include "../../internal/mime.hh"
#include "../../internal/text_utils.hh"

#include <atomic>
#include <filesystem>
#include <format>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include <nlohmann/json.hpp>
#include "nlp/nlp_engine.hh"
#include "nlp/nlp_pipeline.hh"

#ifdef NLP_WITH_ONNX
#  include "nlp/addons/onnx_addon.hh"
#endif

namespace pce::dms {

namespace fs = std::filesystem;
using json   = nlohmann::json;


/** Normalized file content flowing into the first pipeline stage. */
struct FilePayload {
    fs::path    path;
    std::string mime;
    std::string text; ///< normalized (HTML stripped, SVG extracted, etc.)
};

/** Intermediate value carrying the freshly persisted doc_id plus NLP results. */
struct AnalyzedPayload {
    FilePayload file;
    int64_t     doc_id{0};
    std::string kw_json{"[]"};
    std::string ents_json{"[]"};
    std::string sent_label{"neutral"};
    std::string lang{"en"};
    double      sentiment{0.0};
};


/**
 * @class IndexService
 * @brief Owns the single-document and bulk-document indexing logic.
 *
 * Receives infrastructure references from DMSHandle (facade), never owns them.
 */
class IndexService {
public:
    using ActiveDbFn = std::function<pce::db::Database&()>;
    using ProgressFn = std::function<void(json)>;

    explicit IndexService(ActiveDbFn                                     active_db,
                          std::mutex&                                    db_mutex,
                          pce::nlp::NLPEngine*                           engine,
                          std::shared_ptr<pce::nlp::onnx::IOnnxService>  embed_svc)
        : active_db_(std::move(active_db))
        , db_mutex_(db_mutex)
        , engine_(engine)
        , embed_svc_(std::move(embed_svc))
    {}


    /** Route by MIME: read text, call index_one().  Handles PDF/HTML/SVG/text. */
    [[nodiscard]] Expected<json> index_document(std::string_view path_str);

    /** Core pipeline: store → analyze → embed → return result JSON. */
    [[nodiscard]] Expected<json> index_one(const fs::path& p, std::string_view content);

    /** Dispatch a background bulk-index job.  Caller owns the jthread. */
    [[nodiscard]] Expected<json> bulk_index_start(std::string_view         dir_path,
                                                   std::atomic<bool>&       bulk_active,
                                                   std::jthread&            bulk_thread,
                                                   std::function<std::string()> get_in_path,
                                                   ProgressFn               push_progress);

    static float       ocr_alpha_ratio(const std::string& text);
    static std::string ocr_quality(const std::string& text);

private:
    [[nodiscard]] Expected<std::vector<float>> embed_text(std::string_view text) const;

    ActiveDbFn                                    active_db_;
    std::mutex&                                   db_mutex_;
    pce::nlp::NLPEngine*                          engine_;
    std::shared_ptr<pce::nlp::onnx::IOnnxService> embed_svc_;
};


inline Expected<json> IndexService::index_document(std::string_view path_str) {
    const fs::path p{path_str};
    std::error_code ec;
    const auto mime = mime_for_extension(p.extension().string());

    return require(fs::exists(p, ec), std::format("'{}' does not exist", path_str))
        .and_then([&]() -> VoidResult {
            return require(!fs::is_directory(p, ec),
                           std::format("'{}' is a directory", path_str));
        })
        .and_then([&]() -> Expected<json> {
            if (mime == "application/pdf") {
                if (!engine_)
                    return std::unexpected(std::format(
                        "'{}': PDF indexing requires the NLP engine.", p.filename().string()));
                const auto text = engine_->extract_text_from_pdf(p.string());
                if (text.empty())
                    return std::unexpected(std::format(
                        "'{}': PDF text extraction returned no content.", p.filename().string()));
                if (ocr_quality(text) == "garbage")
                    return std::unexpected(std::format(
                        "'{}': PDF OCR quality too low — use dms_ocr_document.", p.filename().string()));
                return index_one(p, text);
            }
            if (mime.starts_with("image/") && mime != "image/svg+xml")
                return std::unexpected(std::format(
                    "'{}' is an image — use dms_ocr_document.", p.filename().string()));
            if (mime.starts_with("audio/") || mime.starts_with("video/"))
                return std::unexpected(std::format(
                    "'{}' is a media file — no text to index.", p.filename().string()));
            if (!is_indexable_text(mime))
                return std::unexpected(std::format(
                    "'{}' (MIME:{}) is not indexable.", p.filename().string(), mime));

            return safe_read_text(p, 1u << 20).and_then([&](std::string content) -> Expected<json> {
                if (mime == "text/html" || mime == "text/htm")
                    content = strip_html_tags(content);
                else if (mime == "image/svg+xml")
                    content = extract_svg_text(content);
                return index_one(p, content);
            });
        });
}

inline Expected<json> IndexService::index_one(const fs::path& p, std::string_view content) {
    const auto now     = pce::db::now_unix();
    const auto hash    = hash_hex(content);
    const auto snippet = make_snippet(content);
    const auto mime    = mime_for_extension(p.extension().string());
    std::error_code ec;
    const int64_t fsize = (int64_t)fs::file_size(p, ec);
    const int64_t mtime = file_mtime_unix(p);

    auto blob_res     = safe_read_binary(p);
    auto content_blob = blob_res ? std::make_optional(std::move(*blob_res)) : std::nullopt;

    // Early-exit: document unchanged
    {
        std::lock_guard lk{db_mutex_};
        const auto ex = active_db_().from("dms_documents").select({"id", "text_hash"})
                             .where("path = ?", p.string()).first();
        if (ex && ex->try_get<std::string>("text_hash").value_or("") == hash) {
            const auto id = ex->try_get<int64_t>("id").value_or(0);
            discard(active_db_().update("dms_documents").set("indexed_at", now)
                               .where("id = ?", id).execute());
            return json{{"doc_id", id}, {"path", p.string()}, {"unchanged", true}};
        }
    }

    return FilePayload{p, mime, std::string{content}}

        // Stage 1: store document row, produce AnalyzedPayload with doc_id
        | stage([&](FilePayload fp) -> Expected<AnalyzedPayload> {
            int64_t doc_id = 0;
            {
                std::lock_guard lk{db_mutex_};
                auto q = active_db_().insert_into("dms_documents")
                             .value("path",      fp.path.string())
                             .value("filename",  fp.path.filename().string())
                             .value("extension", fp.path.extension().string())
                             .value("size_bytes", fsize)
                             .value("mtime",     mtime)
                             .value("mime_type", fp.mime)
                             .value("kind",      kind_for_extension(fp.path.extension().string()))
                             .value("indexed_at", now)
                             .value("text_hash", hash)
                             .value("snippet",   snippet);
                if (content_blob) q.value("content_blob", *content_blob);
                discard(q.on_conflict_replace().execute());
                doc_id = active_db_().last_insert_rowid();
            }
            if (doc_id == 0)
                return std::unexpected(std::format("DB upsert failed for '{}'", fp.path.string()));
            return AnalyzedPayload{std::move(fp), doc_id};
        })

        // Stage 2: NLP analysis — keywords, entities, sentiment, language
        | stage([&](AnalyzedPayload ap) -> Expected<AnalyzedPayload> {
            if (engine_) {
                // Stage 0: strip bare URLs so forge/TLD tokens don't pollute keywords.
                const std::string ts = pce::nlp::strip_urls(ap.file.text);
                try { ap.kw_json   = engine_->keywords_to_json(engine_->extract_keywords(ts, 15, "")).dump(); } catch (...) {}
                try { ap.ents_json = engine_->entities_to_json(engine_->extract_entities(ts, "")).dump();     } catch (...) {}
                try {
                    const auto sr  = engine_->analyze_sentiment(ts, "");
                    ap.sentiment   = (double)sr.score;
                    ap.sent_label  = sr.label;
                } catch (...) {}
                try { ap.lang = engine_->detect_language(ts).language; } catch (...) {}
            }
            return ap;
        })

        // Stage 3: persist NLP notes + embedding, return final result JSON
        | stage([&](AnalyzedPayload ap) -> Expected<json> {
            const auto now2 = pce::db::now_unix(); // may differ slightly from above
            {
                std::lock_guard lk{db_mutex_};
                discard(active_db_().insert_into("nlp_notes")
                    .value("row_type",       std::string{"dms_doc"})
                    .value("row_id",         ap.doc_id)
                    // Store the full document text (not just the 280-char snippet) so
                    // that keyword searches can match terms anywhere in the content —
                    // especially important for OCR-indexed images where the search term
                    // may appear well past the first 280 characters.
                    .value("note_text",      std::string{ap.file.text})
                    .value("keywords",       ap.kw_json)
                    .value("entities",       ap.ents_json)
                    .value("sentiment",      ap.sentiment)
                    .value("sentiment_label", ap.sent_label)
                    .value("lang",           ap.lang)
                    .value("created_at",     now2)
                    .execute());
            }
            size_t dims = 0;
            if (const auto emb = embed_text(ap.file.text); emb) {
                dims = emb->size();
                const auto blob = pce::db::floats_to_blob(*emb);
                std::lock_guard lk{db_mutex_};
                discard(active_db_().insert_into("nlp_embeddings")
                    .value("row_type",   std::string{"dms_doc"})
                    .value("row_id",     ap.doc_id)
                    .value("text_hash",  hash)
                    .value("vector",     blob)
                    .value("dimensions", (int64_t)dims)
                    .value("snippet",    snippet)
                    .value("updated_at", now2)
                    .on_conflict_replace()
                    .execute());
            }
            auto parse_arr = [](std::string_view s) -> json {
                try { return json::parse(s); } catch (...) { return json::array(); }
            };
            return json{
                {"doc_id",          ap.doc_id},
                {"path",            ap.file.path.string()},
                {"filename",        ap.file.path.filename().string()},
                {"mime_type",       ap.file.mime},
                {"snippet",         snippet},
                {"keywords",        parse_arr(ap.kw_json)},
                {"entities",        parse_arr(ap.ents_json)},
                {"sentiment",       ap.sentiment},
                {"sentiment_label", ap.sent_label},
                {"lang",            ap.lang},
                {"dimensions",      (int64_t)dims},
                {"indexed_at",      now},
                {"unchanged",       false},
            };
        });
}

inline Expected<json> IndexService::bulk_index_start(
        std::string_view             dir_path,
        std::atomic<bool>&           bulk_active,
        std::jthread&                bulk_thread,
        std::function<std::string()> get_in_path,
        ProgressFn                   push_progress)
{
    if (bulk_active.exchange(true))
        return std::unexpected(std::string{"bulk index already running"});

    std::string actual{dir_path};
    if (actual == "global" || actual == "input" || actual.empty())
        actual = get_in_path();

    const fs::path root{actual};
    std::error_code ec;
    if (!fs::exists(root, ec) || !fs::is_directory(root, ec)) {
        bulk_active.store(false);
        return std::unexpected(std::format("'{}' is not a directory", actual));
    }

    std::vector<fs::path> candidates;
    const auto skip = fs::directory_options::skip_permission_denied;
    for (const auto& e : fs::recursive_directory_iterator(root, skip, ec)) {
        if (ec) { ec.clear(); continue; }
        if (!e.is_regular_file()) continue;
        const auto m = mime_for_extension(e.path().extension().string());
        if (is_indexable_text(m) || (m == "application/pdf" && engine_ && engine_->has_ocr()))
            candidates.push_back(e.path());
    }
    const int64_t total = (int64_t)candidates.size();
    push_progress({{"phase", "start"}, {"total", total}, {"done", 0}, {"errors", 0}});

    bulk_thread = std::jthread{
        [this, files = std::move(candidates), total, bulk_active = &bulk_active, push_progress](std::stop_token st) {
            int64_t done{}, errors{};
            for (const auto& p : files) {
                if (st.stop_requested()) break;
                const auto content = safe_read_text(p, 1u << 20);
                if (!content) { ++errors; continue; }
                if (const auto r = index_one(p, *content); !r) {
                    std::print(stderr, "[dms] index '{}': {}\n", p.string(), r.error());
                    ++errors;
                }
                ++done;
                if (done % 5 == 0 || done == total)
                    push_progress({{"phase", "indexing"}, {"file", p.filename().string()},
                                   {"done", done}, {"total", total}, {"errors", errors}});
            }
            push_progress({{"phase", "complete"}, {"done", done}, {"total", total}, {"errors", errors}});
            bulk_active->store(false);
        }};
    return json{{"task_id", "bulk_0"}, {"total_files", total}};
}

inline Expected<std::vector<float>> IndexService::embed_text(std::string_view text) const {
    if (!embed_svc_)            return std::unexpected(std::string{"no embed service configured"});
    if (!embed_svc_->is_loaded()) return std::unexpected(std::string{"embed model not loaded"});
    return try_invoke([&]() -> std::vector<float> {
        auto r = embed_svc_->embed(std::string{text});
        if (!r.success || r.vector.empty()) throw std::runtime_error{"embedding returned empty"};
        return std::move(r.vector);
    });
}

inline float IndexService::ocr_alpha_ratio(const std::string& text) {
    size_t alpha = 0, total = 0;
    for (unsigned char c : text) {
        if (std::isspace((int)c)) continue;
        ++total;
        if (std::isalpha((int)c)) ++alpha;
    }
    return total == 0 ? 0.f : (float)alpha / (float)total;
}

inline std::string IndexService::ocr_quality(const std::string& text) {
    const float r = ocr_alpha_ratio(text);
    return r >= 0.55f ? "ok" : r >= 0.30f ? "low" : "garbage";
}

} // namespace pce::dms
