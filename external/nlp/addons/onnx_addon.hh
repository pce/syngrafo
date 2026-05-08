/**
 * @file onnx_addon.hh
 * @brief ONNX Runtime Addon — context-aware inference via pre-trained models.
 *
 * Supporting types (no ONNX dependency — include directly if that is all you need):
 *   #include "onnx/tokenizer.hh"         — Encoding, ITokenizer, SimpleTokenizer
 *   #include "onnx/inference_result.hh"  — EmbeddingResult, TagResult, InferenceResult
 *   #include "onnx/onnx_service.hh"      — IOnnxService (engine-layer interface)
 *
 * ONNXAddon is compiled only when ONNX Runtime is present (NLP_WITH_ONNX defined).
 * To exclude it from the build: -DNLP_WITH_ONNX=OFF
 *
 * ### Supported modalities
 *   - Text embedding   — BERT-family mean-pool or [CLS] vector
 *   - Sequence tagging — NER, POS, chunking via tag()
 *   - Generic tensor   — any ONNX model via infer()
 *
 * ### Integration path
 *   text → embed()   → inference::EmbeddingResult → VectorAddon / GraphAddon
 *   text → tag()     → inference::TagResult        → entity extraction
 *   text → infer()   → inference::InferenceResult  → classifiers / regressors
 *
 * ### Recommended starter model
 *   all-MiniLM-L6-v2 — 384 dims, 22 MB, Apache-2.0
 *   https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
 */

#pragma once

#include "onnx/inference_result.hh"
#include "onnx/onnx_service.hh"
#include "onnx/tokenizer.hh"

#ifdef NLP_WITH_ONNX

#include "../nlp_addon_system.hh"
#include "vector_addon.hh"

#include <onnxruntime_cxx_api.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <functional>
#include <limits>
#include <memory>
#include <shared_mutex>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

namespace pce::nlp::onnx {

using json = nlohmann::json;

// ─────────────────────────────────────────────────────────────────────────────
// ONNXAddon
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @class ONNXAddon
 * @brief Context-aware inference via ONNX Runtime.
 *
 * Implements both the NLPAddon<> CRTP interface (process / process_stream)
 * and the IOnnxService interface (embed / tag / infer / similarity).
 * NLPEngine holds one shared instance; all other addons call inference
 * through NLPEngine::embed(), NLPEngine::tag(), etc. — never directly.
 *
 * ### Model compatibility
 * Any BERT-family model exported to ONNX with three int64 inputs:
 *   input_ids      [batch, seq_len]
 *   attention_mask [batch, seq_len]
 *   token_type_ids [batch, seq_len]
 *
 * and at least one float32 output:
 *   last_hidden_state [batch, seq_len, hidden]  — embedding
 *   logits            [batch, seq_len, classes] — tagging / classification
 */
class ONNXAddon : public NLPAddon<ONNXAddon>, public IOnnxService {
public:
    // ── Configuration ─────────────────────────────────────────────────────────

    struct Config {
        std::filesystem::path model_path;
        std::filesystem::path vocab_path;
        size_t max_sequence_len  = 128;
        size_t batch_size        = 32;
        bool   use_mean_pooling  = true;
        int    intra_op_threads  = 1;
        int    inter_op_threads  = 1;
        std::string input_name_ids  = "input_ids";
        std::string input_name_mask = "attention_mask";
        std::string input_name_type = "token_type_ids";
        std::string output_name     = "last_hidden_state";
    };

    // ── Construction ──────────────────────────────────────────────────────────

    ONNXAddon() = default;
    explicit ONNXAddon(Config cfg) : config_(std::move(cfg)) {}

    ~ONNXAddon() override = default;
    ONNXAddon(const ONNXAddon&)             = delete;  // Ort::Session is not copyable
    ONNXAddon& operator=(const ONNXAddon&)  = delete;
    ONNXAddon(ONNXAddon&&) noexcept         = delete;  // std::shared_mutex is not movable
    ONNXAddon& operator=(ONNXAddon&&) noexcept = delete;

    // ── NLPAddon CRTP interface ───────────────────────────────────────────────

    const std::string& name_impl()     const { return name_; }
    const std::string& version_impl()  const { return version_; }
    bool               init_impl()           { return is_loaded_.load(std::memory_order_acquire); }
    bool               is_ready_impl() const { return is_loaded_.load(std::memory_order_acquire); }

    /**
     * @brief process_impl — dispatches by options["method"].
     *
     * | method       | behaviour                                           |
     * |--------------|-----------------------------------------------------|
     * | "embed"      | single sentence → EmbeddingResult JSON (default)   |
     * | "similarity" | requires options["target"] — cosine score JSON      |
     * | "batch"      | newline-separated sentences → array of vectors JSON |
     * | "tag"        | sequence tagging → per-token labels JSON            |
     * | "infer"      | generic forward pass → all output tensors JSON      |
     */
    AddonResponse process_impl(
            const std::string& input,
            const std::unordered_map<std::string, std::string>& options,
            std::shared_ptr<AddonContext> context = nullptr) {

        if (!is_loaded_.load(std::memory_order_acquire)) {
            return {"", false,
                    "ONNXAddon: no model loaded. Call load_model() before use.", {}};
        }

        const std::string method = options.contains("method")
                                   ? options.at("method") : "embed";

        if (method == "similarity") {
            if (!options.contains("target")) {
                return {"", false,
                        "ONNXAddon: 'target' option required for similarity", {}};
            }
            const float sim = similarity(input, options.at("target"));
            json j;
            j["cosine_similarity"] = sim;
            AddonResponse resp;
            resp.output                       = j.dump();
            resp.success                      = true;
            resp.metrics["cosine_similarity"] = static_cast<double>(sim);
            return resp;
        }

        if (method == "batch") {
            std::vector<std::string> sentences;
            std::string line;
            std::istringstream iss(input);
            while (std::getline(iss, line)) {
                if (!line.empty()) sentences.push_back(line);
            }
            const auto results = embed_batch(sentences);
            json j = json::array();
            for (const auto& r : results) {
                j.push_back({
                    {"input",      r.input_text},
                    {"dimensions", r.dimensions},
                    {"vector",     r.vector},
                    {"success",    r.success}
                });
            }
            AddonResponse resp;
            resp.output                = j.dump();
            resp.success               = true;
            resp.metrics["batch_size"] = static_cast<double>(sentences.size());
            return resp;
        }

        if (method == "tag") {
            std::vector<std::string> labels;
            if (options.contains("labels")) {
                std::istringstream iss(options.at("labels"));
                std::string lbl;
                while (std::getline(iss, lbl, ',')) {
                    if (!lbl.empty()) labels.push_back(lbl);
                }
            }
            return tag(input, labels).to_addon_response();
        }

        if (method == "infer") {
            return infer(input).to_addon_response();
        }

        // default: "embed"
        return embed(input).to_addon_response();
    }

    void process_stream_impl(
            const std::string& input,
            std::function<void(const std::string&, bool)> callback,
            const std::unordered_map<std::string, std::string>& options,
            std::shared_ptr<AddonContext> context = nullptr) {
        AddonResponse resp = process_impl(input, options, context);
        callback(resp.output, true);
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /** @brief Load a model by path; uses existing config for all other settings. */
    bool load_model(const std::filesystem::path& model_path) {
        config_.model_path = model_path;
        return initialise_session();
    }

    /** @brief Load a model with a full Config. */
    bool load_model(Config cfg) {
        config_ = std::move(cfg);
        return initialise_session();
    }

    /**
     * @brief Swap the tokeniser for a production BPE / WordPiece implementation.
     *
     * Inject before calling load_model(). Any ITokenizer implementation is accepted.
     */
    void set_tokenizer(std::unique_ptr<tokenizer::ITokenizer> tok) {
        std::unique_lock lock(rw_mutex_);
        tokenizer_ = std::move(tok);
    }

    // ── IOnnxService implementation ───────────────────────────────────────────

    /** @brief Embed a single sentence → L2-normalised float vector. */
    [[nodiscard]] inference::EmbeddingResult
    embed(const std::string& text) override {
        std::shared_lock lock(rw_mutex_);
        auto batch = run_text_inference({text});
        return batch.empty()
               ? inference::EmbeddingResult{{}, text, 0, false, "inference failed"}
               : std::move(batch[0]);
    }

    /** @brief Embed a batch of sentences in one forward pass. */
    [[nodiscard]] std::vector<inference::EmbeddingResult>
    embed_batch(const std::vector<std::string>& texts) override {
        std::shared_lock lock(rw_mutex_);
        return run_text_inference(texts);
    }

    /**
     * @brief Context-aware cosine similarity between two sentences.
     *
     * Unlike VectorAddon (static word vectors), the same word gets a different
     * vector depending on context ("bank account" vs "river bank").
     */
    [[nodiscard]] float
    similarity(const std::string& a, const std::string& b) override {
        // Batch both texts in a single forward pass — avoids acquiring the lock
        // twice and halves the number of ONNX session invocations.
        std::shared_lock lock(rw_mutex_);
        const auto results = run_text_inference({a, b});
        if (results.size() < 2) return 0.0f;
        return results[0].cosine_similarity(results[1]);
    }

    /**
     * @brief Per-token sequence labelling — NER, POS, chunking.
     *
     * @param text    Input text; tokenised internally.
     * @param labels  Optional label vocabulary.  When non-empty, class index i
     *                maps to labels[i] (e.g. {"O","B-PER","I-PER","B-ORG",...}).
     *                When empty, labels render as "C0", "C1", ...
     */
    [[nodiscard]] inference::TagResult
    tag(const std::string& text,
        const std::vector<std::string>& labels = {}) override {

        std::shared_lock lock(rw_mutex_);
        const auto raw = run_generic_inference(text);
        if (!raw.success) {
            return {{}, text, false, raw.error};
        }

        inference::TagResult result;
        result.input_text = text;
        result.success    = true;

        const auto  enc      = tokenizer_->encode(text, config_.max_sequence_len);
        const auto* logits   = raw.get("logits");
        if (!logits || logits->empty()) {
            result.success = false;
            result.error   = "ONNXAddon::tag: model has no 'logits' output";
            return result;
        }

        const size_t real_tokens = enc.real_length;
        const size_t num_classes = real_tokens > 0
                                   ? logits->size() / real_tokens : 0;

        for (size_t s = 0; s < real_tokens; ++s) {
            size_t best_class = 0;
            float  best_score = std::numeric_limits<float>::lowest();
            for (size_t c = 0; c < num_classes; ++c) {
                const float score = (*logits)[s * num_classes + c];
                if (score > best_score) {
                    best_score = score;
                    best_class = c;
                }
            }

            inference::TokenTag tt;
            tt.label      = (best_class < labels.size())
                            ? labels[best_class]
                            : "C" + std::to_string(best_class);
            tt.confidence = best_score;
            tt.offset     = s;
            tt.token      = std::to_string(enc.input_ids[s]);
            result.tags.push_back(std::move(tt));
        }

        return result;
    }

    /**
     * @brief Generic forward pass — returns all output tensors by name.
     *
     * Use for classifiers, regressors, or any custom ONNX model that does not
     * follow the embedding or tagging convention. Call result.argmax() or
     * result.softmax() on the returned object to interpret the logits.
     */
    [[nodiscard]] inference::InferenceResult
    infer(const std::string& text) override {
        std::shared_lock lock(rw_mutex_);
        return run_generic_inference(text);
    }

    /** @brief Generic forward pass with raw float input. */
    [[nodiscard]] inference::InferenceResult
    infer_raw(const std::vector<float>& data, const std::vector<int64_t>& shape) override {
        std::shared_lock lock(rw_mutex_);
        if (!is_loaded_.load(std::memory_order_relaxed))
            return {{}, {}, {}, false, "ONNXAddon: model not loaded"};

        inference::InferenceResult result;
        try {
            Ort::MemoryInfo mem_info = Ort::MemoryInfo::CreateCpu(
                OrtAllocatorType::OrtArenaAllocator,
                OrtMemType::OrtMemTypeDefault);

            auto input_tensor = Ort::Value::CreateTensor<float>(
                mem_info,
                const_cast<float*>(data.data()), data.size(),
                shape.data(), shape.size());

            // For raw inference, we assume the first input name from the model is used.
            std::string in_name = session_->GetInputNameAllocated(0, Ort::AllocatorWithDefaultOptions{}).get();
            const char* in_names[] = { in_name.c_str() };

            std::vector<const char*> out_ptrs;
            for (const auto& n : cached_out_names_) out_ptrs.push_back(n.c_str());

            auto output_tensors = session_->Run(
                Ort::RunOptions{nullptr},
                in_names, &input_tensor, 1,
                out_ptrs.data(), out_ptrs.size());

            result.output_names = cached_out_names_;
            for (auto& tensor : output_tensors) {
                const auto info = tensor.GetTensorTypeAndShapeInfo();
                const float* d = tensor.GetTensorData<float>();
                result.outputs.push_back(std::vector<float>(d, d + info.GetElementCount()));
                result.shapes.push_back(info.GetShape());
            }
            result.success = true;
        } catch (const Ort::Exception& e) {
            result.success = false;
            result.error = e.what();
        }
        return result;
    }

    /**
     * @brief Inject ONNX embeddings into a VectorAddon.
     *
     * After calling this, VectorAddon uses Transformer vectors instead of its
     * static lookup table — useful when VectorAddon is wired into GraphAddon.
     *
     * TODO: add VectorAddon::load_from_map() to avoid the filesystem round-trip.
     */
    void inject_into_vector_addon(VectorAddon& va,
                                  const std::vector<std::string>& texts) {
        const auto results = embed_batch(texts);

        json knowledge;
        for (const auto& r : results) {
            if (r.success && !r.vector.empty()) {
                knowledge[r.input_text] = r.vector;
            }
        }
        if (knowledge.empty()) return;

        const auto tmp = std::filesystem::temp_directory_path()
                       / ("onnx_inject_"
                          + std::to_string(std::hash<std::string>{}(texts.front()))
                          + ".json");
        {
            std::ofstream out(tmp);
            out << knowledge.dump();
        }
        va.load_knowledge_pack(tmp.string());
        std::filesystem::remove(tmp);
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    [[nodiscard]] size_t        dimensions()  const noexcept override { return dimensions_.load(std::memory_order_acquire); }
    [[nodiscard]] bool          is_loaded()   const noexcept override { return is_loaded_.load(std::memory_order_acquire); }
    [[nodiscard]] const Config& config()      const noexcept          { return config_; }
    [[nodiscard]] size_t        vocab_size()  const noexcept {
        std::shared_lock lock(rw_mutex_);
        return tokenizer_ ? tokenizer_->vocab_size() : 0;
    }

    const std::vector<std::string>& ocr_vocab() const noexcept override {
        return ocr_vocab_;
    }

private:
    // ── Identity ──────────────────────────────────────────────────────────────

    std::string name_    = "onnx_engine";
    std::string version_ = "1.0.0";

    // ── Synchronisation ───────────────────────────────────────────────────────
    // Protects: session_, tokenizer_, cached_out_names_.
    // is_loaded_ and dimensions_ are separate atomics for lock-free observer reads.
    //
    // Lock discipline:
    //   unique_lock  — initialise_session(), set_tokenizer()        (write paths)
    //   shared_lock  — embed(), embed_batch(), similarity(), tag(),  (read paths)
    //                  infer(), vocab_size()
    //
    // Private helpers (run_text_inference, run_generic_inference, forward)
    // assume the caller already holds at least a shared_lock on rw_mutex_.

    mutable std::shared_mutex rw_mutex_;

    // ── State ─────────────────────────────────────────────────────────────────

    Config              config_;
    std::atomic<bool>   is_loaded_  {false};
    std::atomic<size_t> dimensions_ {0};

    // Output node names — populated once in initialise_session(), then read-only.
    // Avoids repeated GetOutputNameAllocated() allocator calls during inference.
    std::vector<std::string> cached_out_names_;

    // Maximum safe token ID for this model's embedding table.
    // Detected at session load time; INT64_MAX means "no clamping".
    // Prevents "indices out of data bounds" OnnxRuntime errors when the shared
    // vocab.txt has more entries than the model's embedding layer.
    int64_t max_input_id_ = std::numeric_limits<int64_t>::max();

    // Default tokeniser — replaceable via set_tokenizer()
    std::unique_ptr<tokenizer::ITokenizer> tokenizer_ =
        std::make_unique<tokenizer::SimpleTokenizer>();

    // ONNX Runtime session — not copyable, hence deleted copy ctor/assign above
    Ort::Env              ort_env_{ ORT_LOGGING_LEVEL_WARNING, "nlp_engine_onnx" };
    Ort::SessionOptions   session_opts_;
    std::unique_ptr<Ort::Session> session_;

    // ── Session initialisation ────────────────────────────────────────────────

    bool initialise_session() {
        // Exclusive write lock: no inference can proceed while we (re)load.
        std::unique_lock lock(rw_mutex_);

        // Reset state before attempting to load.
        is_loaded_.store(false, std::memory_order_release);
        dimensions_.store(0, std::memory_order_release);
        session_.reset();
        cached_out_names_.clear();

        if (config_.model_path.empty() ||
            !std::filesystem::exists(config_.model_path)) {
            return false;
        }

        // Load optional vocabulary into the default SimpleTokenizer.
        // If the caller injected a custom tokeniser this is a no-op.
        if (!config_.vocab_path.empty() &&
            std::filesystem::exists(config_.vocab_path)) {
            if (auto* st = dynamic_cast<tokenizer::SimpleTokenizer*>(tokenizer_.get())) {
                st->load_vocab(config_.vocab_path);
            }
        }

        try {
            session_opts_.SetIntraOpNumThreads(config_.intra_op_threads);
            session_opts_.SetInterOpNumThreads(config_.inter_op_threads);
            session_opts_.SetGraphOptimizationLevel(ORT_ENABLE_EXTENDED);

#ifdef _WIN32
            const std::wstring wpath = config_.model_path.wstring();
            session_ = std::make_unique<Ort::Session>(
                ort_env_, wpath.c_str(), session_opts_);
#else
            session_ = std::make_unique<Ort::Session>(
                ort_env_, config_.model_path.c_str(), session_opts_);
#endif
            // Probe hidden dimension from the first output tensor shape.
            // Shape is [batch, seq_len, hidden] or [batch, hidden].
            const auto shape = session_->GetOutputTypeInfo(0)
                                        .GetTensorTypeAndShapeInfo()
                                        .GetShape();
            const size_t dims = static_cast<size_t>(shape.back() > 0 ? shape.back() : 384);

            // Cache output node names once — avoids allocator overhead per inference call.
            // The names are stable for the lifetime of the session.
            Ort::AllocatorWithDefaultOptions alloc;
            const size_t num_outputs = session_->GetOutputCount();
            cached_out_names_.reserve(num_outputs);
            for (size_t i = 0; i < num_outputs; ++i) {
                cached_out_names_.push_back(
                    session_->GetOutputNameAllocated(i, alloc).get());
            }

            // Load OCR vocab if present in metadata (or hardcoded for now)
            // PP-OCR usually doesn't have a vocab.txt but a character list.
            // For now, if it's the OCR model, we'll populate ocr_vocab_.
            if (config_.model_path.filename() == "ocr.onnx") {
                ocr_vocab_ = {
                    "blank", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "!", "\"", "#", "$", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/", ":", ";", "<", "=", ">", "?", "@", "[", "\\", "]", "^", "_", "`", "{", "|", "}", "~", " "
                };
            }

            // Publish with release semantics: inference threads that observe
            // is_loaded_ == true are guaranteed to see the fully initialised
            // session_ and cached_out_names_ written above.
            dimensions_.store(dims, std::memory_order_release);

            // ── Detect safe max_input_id ──────────────────────────────────
            // Some ONNX NER/classifier models are exported with fewer vocab
            // entries than the shared vocab.txt.  Probing a known high ID lets
            // us auto-detect the embedding table boundary and clamp IDs at
            // inference time instead of crashing with a bound-check error.
            {
                const int64_t top = static_cast<int64_t>(
                    tokenizer_->vocab_size() > 0 ? tokenizer_->vocab_size() - 1 : 30521);
                // Only probe if vocab is larger than a "standard size" guess
                if (top > 28990) {
                    const size_t probe_seqlen = 8;
                    auto probe_id = [&](int64_t test_id) -> bool {
                        try {
                            std::vector<int64_t> ids(probe_seqlen, 0);
                            ids[1] = test_id;
                            std::vector<int64_t> mask(probe_seqlen, 0);
                            mask[0] = mask[1] = 1;
                            std::vector<int64_t> type(probe_seqlen, 0);
                            forward(ids, mask, type, 1, probe_seqlen, {cached_out_names_[0]});
                            return true;
                        } catch (...) {
                            return false;
                        }
                    };
                    if (!probe_id(top)) {
                        // Binary-search for the safe ceiling (max ~15 iterations)
                        int64_t lo = 102, hi = top;
                        while (hi - lo > 1) {
                            int64_t mid = (lo + hi) / 2;
                            if (probe_id(mid)) lo = mid; else hi = mid;
                        }
                        max_input_id_ = lo;
                    }
                }
            }

            is_loaded_.store(true,  std::memory_order_release);
            return true;

        } catch (const Ort::Exception&) {
            return false;
        }
    }

    // ── Low-level forward pass ────────────────────────────────────────────────

    /**
     * @brief Build ORT tensors and run the session.
     *
     * @param ids_flat   Flattened input_ids   [bsz * seqlen]
     * @param mask_flat  Flattened attn_mask   [bsz * seqlen]
     * @param type_flat  Flattened type_ids    [bsz * seqlen]
     * @param bsz        Batch size
     * @param seqlen     Sequence length
     * @param out_names  Names of output nodes to collect
     */
    std::vector<Ort::Value> forward(
            std::vector<int64_t>& ids_flat,
            std::vector<int64_t>& mask_flat,
            std::vector<int64_t>& type_flat,
            size_t bsz, size_t seqlen,
            const std::vector<std::string>& out_names) {

        Ort::MemoryInfo mem_info = Ort::MemoryInfo::CreateCpu(
            OrtAllocatorType::OrtArenaAllocator,
            OrtMemType::OrtMemTypeDefault);

        const std::array<int64_t, 2> shape{
            static_cast<int64_t>(bsz),
            static_cast<int64_t>(seqlen)
        };

        auto mk = [&](std::vector<int64_t>& data) {
            return Ort::Value::CreateTensor<int64_t>(
                mem_info,
                data.data(), data.size(),
                shape.data(), shape.size());
        };

        std::array<Ort::Value, 3> inputs{ mk(ids_flat), mk(mask_flat), mk(type_flat) };

        const std::array<const char*, 3> in_names{
            config_.input_name_ids.c_str(),
            config_.input_name_mask.c_str(),
            config_.input_name_type.c_str()
        };

        std::vector<const char*> out_ptrs;
        out_ptrs.reserve(out_names.size());
        for (const auto& n : out_names) out_ptrs.push_back(n.c_str());

        return session_->Run(
            Ort::RunOptions{nullptr},
            in_names.data(), inputs.data(),   inputs.size(),
            out_ptrs.data(), out_ptrs.size());
    }

    // ── Text inference (embedding) ────────────────────────────────────────────

    // CALLER MUST HOLD at least a shared_lock on rw_mutex_.
    // Ort::Session::Run() is documented thread-safe; input tensors are all
    // stack-local so concurrent calls on the same session are fine.
    std::vector<inference::EmbeddingResult>
    run_text_inference(const std::vector<std::string>& texts) {
        if (!is_loaded_.load(std::memory_order_relaxed)) {
            std::vector<inference::EmbeddingResult> results;
            for (const auto& t : texts)
                results.push_back({{}, t, 0, false, "ONNXAddon: model not loaded"});
            return results;
        }
        std::vector<inference::EmbeddingResult> results;
        results.reserve(texts.size());

        for (size_t start = 0; start < texts.size(); start += config_.batch_size) {
            const size_t end    = std::min(start + config_.batch_size, texts.size());
            const size_t bsz    = end - start;
            const size_t seqlen = config_.max_sequence_len;

            std::vector<int64_t> ids_flat(bsz * seqlen, 0);
            std::vector<int64_t> mask_flat(bsz * seqlen, 0);
            std::vector<int64_t> type_flat(bsz * seqlen, 0);

            for (size_t b = 0; b < bsz; ++b) {
                const auto     enc = tokenizer_->encode(texts[start + b], seqlen);
                const ptrdiff_t off = static_cast<ptrdiff_t>(b * seqlen);
                std::copy(enc.input_ids.begin(),      enc.input_ids.end(),
                          ids_flat.begin()  + off);
                std::copy(enc.attention_mask.begin(), enc.attention_mask.end(),
                          mask_flat.begin() + off);
                std::copy(enc.token_type_ids.begin(), enc.token_type_ids.end(),
                          type_flat.begin() + off);
            }

            try {
                auto output_tensors = forward(ids_flat, mask_flat, type_flat,
                                              bsz, seqlen,
                                              {config_.output_name});

                const float* raw    = output_tensors[0].GetTensorData<float>();
                const size_t hidden = dimensions_.load(std::memory_order_relaxed);

                for (size_t b = 0; b < bsz; ++b) {
                    inference::EmbeddingResult r;
                    r.input_text = texts[start + b];
                    r.dimensions = hidden;
                    r.success    = true;
                    r.vector.assign(hidden, 0.0f);

                    if (config_.use_mean_pooling) {
                        size_t token_count = 0;
                        for (size_t s = 0; s < seqlen; ++s) {
                            if (mask_flat[b * seqlen + s] == 0) break;
                            ++token_count;
                            const float* tok = raw + (b * seqlen + s) * hidden;
                            for (size_t d = 0; d < hidden; ++d) r.vector[d] += tok[d];
                        }
                        if (token_count > 0) {
                            for (float& v : r.vector) v /= static_cast<float>(token_count);
                        }
                    } else {
                        // [CLS] token at position 0
                        const float* cls = raw + b * seqlen * hidden;
                        std::copy(cls, cls + hidden, r.vector.begin());
                    }

                    l2_normalise(r.vector);
                    results.push_back(std::move(r));
                }

            } catch (const Ort::Exception& e) {
                for (size_t b = 0; b < bsz; ++b) {
                    results.push_back({{}, texts[start + b], 0, false,
                                       std::string("ONNX inference error: ") + e.what()});
                }
            }
        }

        return results;
    }

    // ── Generic inference (tagging, classification) ───────────────────────────

    // CALLER MUST HOLD at least a shared_lock on rw_mutex_.
    // Uses cached_out_names_ set by initialise_session() — zero allocator overhead.
    inference::InferenceResult run_generic_inference(const std::string& text) {
        if (!is_loaded_.load(std::memory_order_relaxed))
            return {{}, {}, {}, false, "ONNXAddon: model not loaded"};

        if (cached_out_names_.empty())
            return {{}, {}, {}, false,
                    "ONNXAddon: output names not cached — was load_model() called?"};

        const size_t seqlen = config_.max_sequence_len;
        const auto   enc    = tokenizer_->encode(text, seqlen);

        std::vector<int64_t> ids  = enc.input_ids;
        std::vector<int64_t> mask = enc.attention_mask;
        std::vector<int64_t> type = enc.token_type_ids;

        // Clamp token IDs to the model's actual embedding table size.
        // Prevents OrtException "indices element out of data bounds" for models
        // whose vocab was trimmed vs the shared vocab.txt (e.g. Xenova NER).
        if (max_input_id_ < std::numeric_limits<int64_t>::max()) {
            constexpr int64_t UNK = tokenizer::SimpleTokenizer::UNK_ID;
            for (auto& id : ids) {
                if (id > max_input_id_) id = UNK;
            }
        }

        inference::InferenceResult result;

        try {
            auto output_tensors = forward(ids, mask, type, 1, seqlen, cached_out_names_);

            result.output_names = cached_out_names_;
            result.outputs.reserve(cached_out_names_.size());
            result.shapes.reserve(cached_out_names_.size());

            for (auto& tensor : output_tensors) {
                const auto   info = tensor.GetTensorTypeAndShapeInfo();
                const size_t n    = info.GetElementCount();
                const float* data = tensor.GetTensorData<float>();
                result.outputs.push_back(std::vector<float>(data, data + n));
                result.shapes.push_back(info.GetShape());
            }

            result.success = true;

        } catch (const Ort::Exception& e) {
            result.success = false;
            result.error   = std::string("ONNX inference error: ") + e.what();
        }

        return result;
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    static void l2_normalise(std::vector<float>& v) noexcept {
        float norm = 0.0f;
        for (float x : v) norm += x * x;
        norm = std::sqrt(norm);
        if (norm > 1e-9f) {
            for (float& x : v) x /= norm;
        }
    }

    std::vector<std::string> ocr_vocab_;
};

}  // namespace pce::nlp::onnx

#endif  // NLP_WITH_ONNX
