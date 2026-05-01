#pragma once

#include "inference_result.hh"
#include "onnx_service.hh"

#include <algorithm>
#include <cmath>
#include <memory>
#include <string>
#include <vector>

namespace pce::nlp::onnx {

/**
 * @struct ClassLabel
 * @brief A predicted class paired with its probability score.
 *
 * Returned in a vector sorted by score descending — index 0 is always the
 * top prediction.
 */
struct ClassLabel {
    std::string name;
    float       score = 0.0f;
};

/**
 * @class IClassifierService
 * @brief Abstract interface for single-input text classification.
 *
 * A classifier maps a UTF-8 string to a scored list of mutually-exclusive
 * (softmax) or independent (sigmoid) class labels.  The list is always
 * sorted by score descending so callers can take `result[0]` as the
 * top prediction without further sorting.
 *
 * ### Implementing
 * ```cpp
 * class MyClassifier final : public IClassifierService {
 * public:
 *     std::vector<ClassLabel> classify(const std::string& text) override { ... }
 *     const std::vector<std::string>& label_names() const noexcept override { ... }
 *     bool is_loaded() const noexcept override { ... }
 * };
 * ```
 *
 * ### Consuming (inside NLPEngine)
 * ```cpp
 * if (sentiment_ && sentiment_->is_loaded()) {
 *     auto labels = sentiment_->classify(text);
 *     if (!labels.empty()) { ... labels[0].name, labels[0].score ... }
 * }
 * ```
 */
class IClassifierService {
public:
    virtual ~IClassifierService() = default;

    /**
     * @brief Classify text and return labels sorted by score descending.
     *
     * @param text  Input sentence or passage (UTF-8).
     * @return      Scored label list, highest score first.  Empty on failure.
     */
    [[nodiscard]] virtual std::vector<ClassLabel>
    classify(const std::string& text) = 0;

    /**
     * @brief The ordered label vocabulary in model id2label order.
     *
     * Index `i` in this vector corresponds to output logit `i`.
     */
    [[nodiscard]] virtual const std::vector<std::string>&
    label_names() const noexcept = 0;

    /**
     * @brief True when the underlying model is loaded and ready for inference.
     */
    [[nodiscard]] virtual bool is_loaded() const noexcept = 0;
};

/**
 * @class OnnxClassifier
 * @brief IClassifierService backed by any IOnnxService via its infer() path.
 *
 * Calls IOnnxService::infer(), applies the requested activation function to
 * the named output node, then pairs each score with the caller-supplied label
 * name at the same index.
 *
 * ### Activation modes
 * | Mode      | Use case                                                |
 * |-----------|---------------------------------------------------------|
 * | softmax   | Single-label classification (e.g. SST-2 sentiment)     |
 * | sigmoid   | Multi-label classification (e.g. toxic-bert toxicity)  |
 *
 * ### Setup example — sentiment
 * ```cpp
 * auto addon = std::make_shared<ONNXAddon>();
 * addon->load_model("data/models/sentiment.onnx");
 *
 * auto classifier = std::make_shared<OnnxClassifier>(
 *     addon,
 *     std::vector<std::string>{"NEGATIVE", "POSITIVE"},  // SST-2 id2label
 *     "logits"
 * );
 * engine.set_sentiment_service(classifier);
 * ```
 *
 * ### Setup example — toxicity (multi-label)
 * ```cpp
 * auto addon = std::make_shared<ONNXAddon>();
 * addon->load_model("data/models/toxicity.onnx");
 *
 * auto classifier = std::make_shared<OnnxClassifier>(
 *     addon,
 *     std::vector<std::string>{
 *         "toxic", "severe_toxic", "obscene",
 *         "threat", "insult", "identity_hate"
 *     },
 *     "logits",
 *     OnnxClassifier::Activation::sigmoid
 * );
 * engine.set_toxicity_service(classifier);
 * ```
 *
 * @note The output node name must match an actual named output in the ONNX
 *       graph.  For most HuggingFace ONNX exports this is `"logits"`.
 */
class OnnxClassifier final : public IClassifierService {
public:
    /**
     * @brief Which activation to apply to raw logits before scoring.
     */
    enum class Activation {
        softmax, ///< Sum-to-one; use for single-label classifiers.
        sigmoid, ///< Independent per-class; use for multi-label classifiers.
    };

    /**
     * @param service     A loaded IOnnxService whose infer() output is used.
     * @param labels      Class label names in the model's id2label index order.
     * @param output_node Named ONNX output node containing the logits tensor.
     * @param activation  Activation mode (default: softmax).
     */
    OnnxClassifier(std::shared_ptr<IOnnxService> service,
                   std::vector<std::string>      labels,
                   std::string                   output_node = "logits",
                   Activation                    activation  = Activation::softmax)
        : service_(std::move(service))
        , labels_(std::move(labels))
        , output_node_(std::move(output_node))
        , activation_(activation) {}

    [[nodiscard]] std::vector<ClassLabel>
    classify(const std::string& text) override {
        if (!service_ || !service_->is_loaded()) return {};

        const inference::InferenceResult result = service_->infer(text);
        if (!result.success) return {};

        std::vector<float> scores;

        if (activation_ == Activation::softmax) {
            scores = result.softmax(output_node_);
        } else {
            const std::vector<float>* raw = result.get(output_node_);
            if (!raw || raw->empty()) return {};
            scores.reserve(raw->size());
            for (const float v : *raw)
                scores.push_back(1.0f / (1.0f + std::exp(-v)));
        }

        const size_t n = std::min(scores.size(), labels_.size());
        std::vector<ClassLabel> out;
        out.reserve(n);
        for (size_t i = 0; i < n; ++i)
            out.push_back({labels_[i], scores[i]});

        std::sort(out.begin(), out.end(),
                  [](const ClassLabel& a, const ClassLabel& b) {
                      return a.score > b.score;
                  });
        return out;
    }

    [[nodiscard]] const std::vector<std::string>&
    label_names() const noexcept override {
        return labels_;
    }

    [[nodiscard]] bool is_loaded() const noexcept override {
        return service_ && service_->is_loaded();
    }

private:
    std::shared_ptr<IOnnxService> service_;
    std::vector<std::string>      labels_;
    std::string                   output_node_;
    Activation                    activation_;
};

} // namespace pce::nlp::onnx
