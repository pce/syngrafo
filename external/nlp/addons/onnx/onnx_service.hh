/**
 * @file onnx_service.hh
 * @brief Abstract ONNX inference service interface — no ONNX Runtime dependency.
 *
 * This header is safe to include from any addon or engine layer without
 * pulling in ONNX Runtime headers. ONNXAddon implements this interface;
 * all other addons (SummarizeAddon, StylizeAddon, GraphAddon, …) and
 * NLPEngine depend only on IOnnxService — never on ONNXAddon directly.
 *
 * ### Architecture
 * ```
 * NLPEngine
 *   └── shared_ptr<IOnnxService>  ←  set_onnx_service()
 *                                         ↑
 *                                    ONNXAddon  (compiled only when NLP_WITH_ONNX)
 * ```
 *
 * ### Service contract
 * | method         | description                                              |
 * |----------------|----------------------------------------------------------|
 * | embed()        | L2-normalised dense vector from a single sentence        |
 * | embed_batch()  | Vectorise many sentences in one batched forward pass     |
 * | similarity()   | Context-aware cosine similarity in [-1, 1]               |
 * | tag()          | Per-token label sequence (NER / POS / chunking)          |
 * | infer()        | Generic forward pass — raw named output tensors          |
 * | is_loaded()    | True when a model file is live                           |
 * | dimensions()   | Embedding dimensionality (0 if not loaded)               |
 *
 * ### Usage (addons and engine)
 * ```cpp
 * #include "nlp/addons/onnx/onnx_service.hh"
 *
 * class SummarizeAddon {
 * public:
 *     void set_onnx(std::shared_ptr<pce::nlp::onnx::IOnnxService> svc) {
 *         onnx_ = std::move(svc);
 *     }
 *
 *     void rerank_sentences(std::vector<std::string>& sents, const std::string& query) {
 *         if (!onnx_ || !onnx_->is_loaded()) return;
 *         auto q = onnx_->embed(query);
 *         std::stable_sort(sents.begin(), sents.end(), [&](const auto& a, const auto& b) {
 *             return onnx_->embed(a).cosine_similarity(q)
 *                  > onnx_->embed(b).cosine_similarity(q);
 *         });
 *     }
 *
 * private:
 *     std::shared_ptr<pce::nlp::onnx::IOnnxService> onnx_;
 * };
 * ```
 */

#pragma once

#include "inference_result.hh"
#include "tokenizer.hh"

#include <memory>
#include <string>
#include <vector>

namespace pce::nlp::onnx {

// ─────────────────────────────────────────────────────────────────────────────
// IOnnxService
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @class IOnnxService
 * @brief Pure-virtual interface for the shared ONNX inference service.
 *
 * A single ONNXAddon instance is created per engine and injected wherever
 * inference is needed — no addon starts its own ONNX session. This keeps
 * memory use predictable and avoids loading the same model file more than once.
 *
 * All methods are `[[nodiscard]]` because ignoring an EmbeddingResult or
 * InferenceResult silently discards the work performed by the model.
 */
class IOnnxService {
public:
    virtual ~IOnnxService() = default;

    // ── Core inference ────────────────────────────────────────────────────────

    /**
     * @brief Encode a single sentence to a dense L2-normalised float vector.
     *
     * The returned vector has `dimensions()` elements. Vectors produced by
     * this method are L2-normalised, so cosine similarity reduces to a dot
     * product — `EmbeddingResult::cosine_similarity()` handles this for you.
     *
     * @param text  Input sentence or passage (UTF-8).
     * @return EmbeddingResult; check `.success` before consuming `.vector`.
     */
    [[nodiscard]] virtual inference::EmbeddingResult embed(const std::string& text) = 0;

    /**
     * @brief Encode a list of sentences in one batched forward pass.
     *
     * Batching amortises the ONNX session setup overhead.  Results are
     * returned in the same order as `texts`.
     *
     * @param texts  Non-empty list of input sentences.
     * @return One EmbeddingResult per input sentence, in order.
     */
    [[nodiscard]] virtual std::vector<inference::EmbeddingResult>
    embed_batch(const std::vector<std::string>& texts) = 0;

    /**
     * @brief Context-aware cosine similarity between two sentences.
     *
     * Unlike VectorAddon (static word vectors), the same surface form gets a
     * different vector depending on surrounding context — "bank account" vs
     * "river bank" are represented as distinct points in the embedding space.
     *
     * Implementations may use a single batched forward pass for efficiency
     * instead of calling `embed()` twice.
     *
     * @param a  First sentence (UTF-8).
     * @param b  Second sentence (UTF-8).
     * @return Cosine similarity in [-1.0, 1.0]. Returns 0.0 on failure.
     */
    [[nodiscard]] virtual float similarity(const std::string& a, const std::string& b) = 0;

    /**
     * @brief Per-token sequence labelling — NER, POS, or chunking.
     *
     * The model must output a `logits` tensor of shape
     * [batch, seq_len, num_classes].  Each real token gets the label with
     * the highest logit.
     *
     * @param text    Input text (UTF-8); tokenised internally.
     * @param labels  Optional label vocabulary.  When non-empty, class index `i`
     *                maps to `labels[i]` (e.g. `{"O","B-PER","I-PER","B-ORG",…}`).
     *                When empty, labels are rendered as `"C0"`, `"C1"`, … and
     *                the caller is responsible for mapping indices to names.
     * @return TagResult with one TokenTag per real (non-padding) token.
     */
    [[nodiscard]] virtual inference::TagResult
    tag(const std::string& text, const std::vector<std::string>& labels = {}) = 0;

    /**
     * @brief Generic ONNX forward pass — raw named output tensors.
     *
     * Use this for classifiers, regressors, or any custom ONNX model that
     * does not follow the BERT embedding or sequence-tagging conventions.
     * Call `result.argmax("output_0")` or `result.softmax("output_0")` on
     * the returned object to interpret the logits.
     *
     * @param text  Input text; tokenised internally using the loaded vocabulary.
     * @return InferenceResult with one flat float vector per named output node.
     */
    [[nodiscard]] virtual inference::InferenceResult infer(const std::string& text) = 0;

    /** @brief Generic ONNX forward pass using a raw float input tensor (e.g. image). */
    [[nodiscard]] virtual inference::InferenceResult
    infer_raw(const std::vector<float>& data, const std::vector<int64_t>& shape) = 0;

    // ── Introspection ─────────────────────────────────────────────────────────

    /**
     * @brief True if a model file has been loaded and the ONNX session is live.
     *
     * Callers should guard ONNX calls behind this check — or rely on the
     * NLPEngine::has_onnx() convenience wrapper.
     */
    [[nodiscard]] virtual bool is_loaded() const noexcept = 0;

    /**
     * @brief Number of dimensions in the embedding space.
     *
     * Determined after loading the model from the shape of the first
     * output tensor. Returns 0 when no model is loaded.
     *
     * Consumers (VectorAddon, GraphAddon) use this to validate that ONNX
     * embeddings are compatible with any pre-existing static vectors.
     */
    [[nodiscard]] virtual size_t dimensions() const noexcept = 0;

    /** @brief OCR recognition vocabulary / character set for decoding CTC logits. */
    virtual const std::vector<std::string>& ocr_vocab() const noexcept = 0;
};

}  // namespace pce::nlp::onnx
