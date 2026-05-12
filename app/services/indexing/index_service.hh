#pragma once
/**
 * @file services/indexing/index_service.hh
 * @brief IndexService — indexes documents through a store → NLP → embed pipeline.
 */

#include "../../core/pipeline.hh"
#include "../../db/database.hh"
#include "../../dms_monadic.hh"
#include "../../internal/discard.hh"
#include "../../internal/fs_utils.hh"
#include "../../internal/hashing.hh"
#include "../../internal/mime.hh"
#include "../../internal/text_utils.hh"
#include "../lifecycle/document_lifecycle_service.hh"

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
                          std::shared_ptr<pce::nlp::onnx::IOnnxService>  embed_svc,
                          DocumentLifecycleService*                      lifecycle_svc = nullptr)
        : active_db_(std::move(active_db))
        , db_mutex_(db_mutex)
        , engine_(engine)
        , embed_svc_(std::move(embed_svc))
        , lifecycle_svc_(lifecycle_svc)
    {}


    /** Route by MIME: read text, call index_one().  Handles PDF/HTML/SVG/text. */
    [[nodiscard]] Expected<json> index_document(std::string_view path_str,
                                                std::string_view extractor = "text");

    /** Core pipeline: store → analyze → embed → return result JSON. */
    [[nodiscard]] Expected<json> index_one(const fs::path& p,
                                           std::string_view content,
                                           std::string_view extractor = "text");

    /** Dispatch a background bulk-index job.  Caller owns the jthread. */
    [[nodiscard]] Expected<json> bulk_index_start(std::string_view         dir_path,
                                                   std::atomic<bool>&       bulk_active,
                                                   std::jthread&            bulk_thread,
                                                   std::function<std::string()> get_in_path,
                                                   ProgressFn               push_progress);

    static float       ocr_alpha_ratio(const std::string& text);
    static std::string ocr_quality(const std::string& text);

    /// Split text into overlapping chunks for passage-level indexing.
    /// target_chars ≈ 2000 (≈ 500 tokens). overlap_chars ≈ 200 (≈ 50 tokens).
    [[nodiscard]] static std::vector<std::string>
    split_into_chunks(std::string_view text, int target_chars = 2000, int overlap_chars = 200);

private:
    [[nodiscard]] Expected<std::vector<float>> embed_text(std::string_view text) const;

    ActiveDbFn                                    active_db_;
    std::mutex&                                   db_mutex_;
    pce::nlp::NLPEngine*                          engine_;
    std::shared_ptr<pce::nlp::onnx::IOnnxService> embed_svc_;
    DocumentLifecycleService*                     lifecycle_svc_;
};


inline Expected<json> IndexService::index_document(std::string_view path_str,
                                                   std::string_view extractor) {
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
                return index_one(p, text, extractor);
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
                return index_one(p, content, extractor);
            });
        });
}

inline Expected<json> IndexService::index_one(const fs::path& p,
                                              std::string_view content,
                                              std::string_view extractor) {
    const auto now     = pce::db::now_unix();
    const auto hash    = hash_hex(content);
    const auto snippet = make_snippet(content);
    const auto mime    = mime_for_extension(p.extension().string());
    std::error_code ec;
    const int64_t fsize = (int64_t)fs::file_size(p, ec);
    const int64_t mtime = file_mtime_unix(p);

    const DocumentRegistration base_reg{
        .doc_id      = 0,
        .path        = p.string(),
        .source_path = "",
        .zone_name   = "",
        .kind        = kind_for_extension(p.extension().string()),
        .mime_type   = mime,
        .size_bytes  = fsize,
        .mtime       = mtime,
    };
    std::string document_uid;
    if (lifecycle_svc_) {
        if (auto ensured = lifecycle_svc_->ensure_document(base_reg, "system", "indexer"); ensured)
            document_uid = std::move(*ensured);
    }

    int64_t unchanged_doc_id = 0;
    bool unchanged_index_hit = false;
    {
        std::lock_guard lk{db_mutex_};
        const auto ex = active_db_().from("dms_documents").select({"id", "text_hash"})
                             .where("path = ?", p.string()).first();
        if (ex && ex->try_get<std::string>("text_hash").value_or("") == hash) {
            unchanged_doc_id = ex->try_get<int64_t>("id").value_or(0);
            discard(active_db_().update("dms_documents").set("indexed_at", now)
                               .where("id = ?", unchanged_doc_id).execute());
            unchanged_index_hit = true;
        }
    }
    if (unchanged_index_hit) {
        if (lifecycle_svc_) {
            DocumentRegistration existing_reg = base_reg;
            existing_reg.doc_id = unchanged_doc_id;
            discard(lifecycle_svc_->ensure_document(existing_reg, "system", "indexer"));
            discard(lifecycle_svc_->record_text_extraction(
                document_uid.empty() ? p.string() : document_uid,
                TextContentVersion{
                    .extractor = std::string{extractor},
                    .text_hash = hash,
                    .mime_type = "text/plain",
                    .payload_json = json{{"path", p.string()}, {"unchanged", true}}.dump(),
                },
                "system",
                "indexer"
            ));
        }
        return json{{"doc_id", unchanged_doc_id}, {"path", p.string()}, {"unchanged", true}};
    }

    if (lifecycle_svc_ && !document_uid.empty())
        discard(lifecycle_svc_->transition_state(document_uid, DocumentState::Processing,
                                                 "system", "indexing started", "indexer"));

    return FilePayload{p, mime, std::string{content}}
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
                discard(q.on_conflict_replace().execute());
                doc_id = active_db_().last_insert_rowid();
            }
            if (doc_id == 0)
                return std::unexpected(std::format("DB upsert failed for '{}'", fp.path.string()));
            if (lifecycle_svc_) {
                DocumentRegistration reg = base_reg;
                reg.doc_id = doc_id;
                if (auto ensured = lifecycle_svc_->ensure_document(reg, "system", "indexer"); ensured)
                    document_uid = *ensured;
            }
            return AnalyzedPayload{std::move(fp), doc_id};
        })
        | stage([&](AnalyzedPayload ap) -> Expected<AnalyzedPayload> {
            if (engine_) {
                const std::string ts = pce::nlp::strip_urls(ap.file.text); // drop forge/TLD tokens
                try { ap.lang = engine_->detect_language(ts).language; } catch (...) {}
                try { ap.kw_json   = engine_->keywords_to_json(engine_->extract_keywords(ts, 15, ap.lang)).dump(); } catch (...) {}
                try { ap.ents_json = engine_->entities_to_json(engine_->extract_entities(ts, ap.lang)).dump();     } catch (...) {}
                try {
                    const auto sr  = engine_->analyze_sentiment(ts, ap.lang);
                    ap.sentiment   = (double)sr.score;
                    ap.sent_label  = sr.label;
                } catch (...) {}
            }
            return ap;
        })
        | stage([&](AnalyzedPayload ap) -> Expected<json> {
            const auto now2 = pce::db::now_unix();
            {
                std::lock_guard lk{db_mutex_};
                discard(active_db_().insert_into("nlp_notes")
                    .value("row_type",       std::string{"dms_doc"})
                    .value("row_id",         ap.doc_id)
                    .value("note_text",      std::string{ap.file.text}) // full text, not snippet — needed for FTS/keyword search
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
            {
                auto kw_plain = [](const std::string& kw_json) -> std::string {
                    try {
                        std::string out;
                        for (const auto& k : json::parse(kw_json))
                            if (k.is_string()) {
                                if (!out.empty()) out += ' ';
                                out += k.get<std::string>();
                            }
                        return out;
                    } catch (...) { return {}; }
                };
                std::lock_guard lk{db_mutex_};
                try {
                    auto* del = active_db_().prepare_cached(
                        "DELETE FROM dms_fts WHERE rowid = ?");
                    pce::db::Database::bind(del, 1, pce::db::to_db_value(ap.doc_id));
                    sqlite3_step(del);
                    auto* ins = active_db_().prepare_cached(
                        "INSERT INTO dms_fts(rowid, filename, keywords, body) VALUES(?,?,?,?)");
                    pce::db::Database::bind(ins, 1, pce::db::to_db_value(ap.doc_id));
                    pce::db::Database::bind(ins, 2, pce::db::to_db_value(ap.file.path.filename().string()));
                    pce::db::Database::bind(ins, 3, pce::db::to_db_value(kw_plain(ap.kw_json)));
                    pce::db::Database::bind(ins, 4, pce::db::to_db_value(std::string{ap.file.text}));
                    sqlite3_step(ins);
                } catch (...) {}
            }

            {
                struct ChunkData { std::string text; std::vector<float> embedding; };
                const auto raw_chunks = split_into_chunks(ap.file.text);
                std::vector<ChunkData> chunk_data;
                chunk_data.reserve(raw_chunks.size());
                for (const auto& chunk : raw_chunks) {
                    ChunkData cd{chunk, {}};
                    if (embed_svc_ && embed_svc_->is_loaded()) {
                        auto r = embed_svc_->embed(chunk);
                        if (r.success && !r.vector.empty())
                            cd.embedding = std::move(r.vector);
                    }
                    chunk_data.push_back(std::move(cd));
                }
                std::lock_guard lk{db_mutex_};
                auto* del_c = active_db_().prepare_cached(
                    "DELETE FROM dms_chunks WHERE doc_id = ?");
                pce::db::Database::bind(del_c, 1, pce::db::to_db_value(ap.doc_id));
                sqlite3_step(del_c);
                for (int i = 0; i < (int)chunk_data.size(); ++i) {
                    const auto& cd = chunk_data[i];
                    auto ins = active_db_().insert_into("dms_chunks")
                        .value("doc_id",      ap.doc_id)
                        .value("position",    (int64_t)i)
                        .value("token_count", (int64_t)(cd.text.size() / 4))
                        .value("chunk_text",  cd.text)
                        .value("updated_at",  now2);
                    if (!cd.embedding.empty())
                        ins.value("embedding", pce::db::floats_to_blob(cd.embedding));
                    discard(ins.execute());
                }
            }

            auto parse_arr = [](std::string_view s) -> json {
                try { return json::parse(s); } catch (...) { return json::array(); }
            };
            if (lifecycle_svc_) {
                discard(lifecycle_svc_->record_text_extraction(
                    document_uid.empty() ? ap.file.path.string() : document_uid,
                    TextContentVersion{
                        .extractor = std::string{extractor},
                        .text_hash = hash,
                        .mime_type = "text/plain",
                        .payload_json = json{
                            {"path", ap.file.path.string()},
                            {"lang", ap.lang},
                            {"keywords", parse_arr(ap.kw_json)},
                            {"entities", parse_arr(ap.ents_json)},
                            {"sentiment", ap.sentiment},
                            {"sentiment_label", ap.sent_label},
                        }.dump(),
                    },
                    "system",
                    "indexer"
                ));
            }
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
                {"chunks_indexed",  true},
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

inline std::vector<std::string>
IndexService::split_into_chunks(std::string_view text, int target_chars, int overlap_chars) {
    std::vector<std::string> chunks;
    const int n = static_cast<int>(text.size());
    if (n == 0) return chunks;

    int start = 0;
    while (start < n) {
        int end = std::min(start + target_chars, n);
        // Prefer to break at a sentence boundary
        if (end < n) {
            for (int i = end; i > start + target_chars / 2; --i) {
                if (text[i] == '.' || text[i] == '\n') { end = i + 1; break; }
            }
        }
        chunks.emplace_back(text.substr(start, end - start));
        const int next = end - overlap_chars;
        start = (next > start) ? next : end;
    }
    return chunks;
}

} // namespace pce::dms
