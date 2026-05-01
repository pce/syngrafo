/**
 * @file inference_result.hh
 * @brief Standalone inference result types for NLP addon outputs.
 *
 * No ONNX dependency. These types are the native C++ result objects
 * returned by any addon that performs model inference — including
 * ONNXAddon, SummarizeAddon, StylizeAddon, and future sequence models.
 *
 * ### JSON-at-the-edge policy
 * These structs hold raw C++ data. JSON serialisation happens only
 * when crossing an API boundary via `to_addon_response()`.
 *
 * ### Usage
 * ```cpp
 * #include "nlp/addons/onnx/inference_result.hh"
 *
 * using namespace pce::nlp::inference;
 *
 * EmbeddingResult r = onnx.embed("NASA launched a rocket.");
 * float sim = r.cosine_similarity(other);          // fast path — no JSON
 * AddonResponse resp = r.to_addon_response();      // edge — serialise once
 * ```
 */

#pragma once

#include "../../nlp_addon_system.hh"

#include <algorithm>
#include <cmath>
#include <string>
#include <unordered_map>
#include <vector>
#include <nlohmann/json.hpp>

namespace pce::nlp::inference {

using json = nlohmann::json;

// ─────────────────────────────────────────────────────────────────────────────
// EmbeddingResult
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @struct EmbeddingResult
 * @brief Dense float vector produced by a single encoder forward pass.
 *
 * The vector is L2-normalised so that cosine similarity reduces to a
 * simple dot product — no magnitude calculation required at query time.
 *
 * Consumers:
 *   - VectorAddon   — cosine similarity, nearest-neighbours
 *   - GraphAddon    — semantic edge weighting
 *   - SummarizeAddon — sentence reranking
 *   - StylizeAddon  — style vector distance
 *
 * | field        | description                                            |
 * |--------------|--------------------------------------------------------|
 * | vector       | L2-normalised dense embedding (e.g. 384 dims)          |
 * | input_text   | Original input for traceability                        |
 * | dimensions   | Length of `vector` (0 if not successful)               |
 * | success      | False if inference failed; check `error` for detail    |
 * | error        | Non-empty on failure                                   |
 */
struct EmbeddingResult {
    std::vector<float> vector;
    std::string        input_text;
    size_t             dimensions = 0;
    bool               success    = false;
    std::string        error;

    // ── Similarity ────────────────────────────────────────────────────────────

    /**
     * @brief Cosine similarity against another embedding.
     *
     * Both vectors must be L2-normalised (which ONNXAddon guarantees).
     * In that case cosine similarity == dot product, making this O(n)
     * with no division.
     *
     * @return Value in [-1, 1]. Returns 0 if either result failed or
     *         dimensions are mismatched.
     */
    [[nodiscard]] float cosine_similarity(
            const EmbeddingResult& other) const noexcept {
        if (!success || !other.success) return 0.0f;
        if (vector.size() != other.vector.size() || vector.empty()) return 0.0f;

        float dot = 0.0f;
        for (size_t i = 0; i < vector.size(); ++i) {
            dot += vector[i] * other.vector[i];
        }
        return std::clamp(dot, -1.0f, 1.0f);
    }

    /**
     * @brief Euclidean distance between two embeddings.
     *
     * Lower is more similar. Useful when the caller needs a distance
     * metric rather than a similarity score.
     */
    [[nodiscard]] float euclidean_distance(
            const EmbeddingResult& other) const noexcept {
        if (!success || !other.success) return std::numeric_limits<float>::max();
        if (vector.size() != other.vector.size() || vector.empty()) {
            return std::numeric_limits<float>::max();
        }

        float sum = 0.0f;
        for (size_t i = 0; i < vector.size(); ++i) {
            const float d = vector[i] - other.vector[i];
            sum += d * d;
        }
        return std::sqrt(sum);
    }

    // ── Serialisation (edge only) ─────────────────────────────────────────────

    /**
     * @brief Serialise to AddonResponse for the API / Python layer.
     *
     * Call this only when crossing a process or network boundary.
     * Internal C++ code should consume `vector` directly.
     */
    [[nodiscard]] AddonResponse to_addon_response() const {
        if (!success) return {"", false, error, {}};

        json j;
        j["input"]      = input_text;
        j["dimensions"] = dimensions;
        j["vector"]     = vector;

        AddonResponse resp;
        resp.output                = j.dump();
        resp.success               = true;
        resp.metrics["dimensions"] = static_cast<double>(dimensions);
        return resp;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// TagResult
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @struct TokenTag
 * @brief A single token with its predicted label and confidence score.
 *
 * Used for NER, POS tagging, chunking, and any per-token classification task.
 */
struct TokenTag {
    std::string token;
    std::string label;      ///< e.g. "B-ORG", "I-PER", "O", "NN", "VBZ"
    float       confidence; ///< Softmax probability of the predicted label
    size_t      offset;     ///< Character offset of the token in the original text
};

/**
 * @struct TagResult
 * @brief Per-token label sequence from a sequence tagging model.
 *
 * Returned by ONNXAddon::tag() and any future NER / POS addon.
 * Consumers can iterate `tags` directly or call `to_addon_response()`
 * to get a JSON representation for the API layer.
 */
struct TagResult {
    std::vector<TokenTag> tags;
    std::string           input_text;
    bool                  success = false;
    std::string           error;

    /**
     * @brief Filter tags by label prefix (e.g. "B-" or "I-ORG").
     * @return Subset of tags whose label starts with `prefix`.
     */
    [[nodiscard]] std::vector<TokenTag> filter(std::string_view prefix) const {
        std::vector<TokenTag> result;
        for (const auto& t : tags) {
            if (t.label.starts_with(prefix)) {
                result.push_back(t);
            }
        }
        return result;
    }

    /**
     * @brief Collect entity spans by merging consecutive B-/I- tags.
     *
     * Returns a map of entity type → list of entity strings.
     * e.g. { "ORG": ["NASA", "SpaceX"], "LOC": ["Mars"] }
     */
    [[nodiscard]] std::unordered_map<std::string, std::vector<std::string>>
    entities() const {
        std::unordered_map<std::string, std::vector<std::string>> result;
        std::string current_entity;
        std::string current_type;

        for (const auto& t : tags) {
            if (t.label.starts_with("B-")) {
                if (!current_entity.empty()) {
                    result[current_type].push_back(current_entity);
                }
                current_type   = t.label.substr(2);
                current_entity = t.token;
            } else if (t.label.starts_with("I-") && !current_entity.empty()) {
                current_entity += " " + t.token;
            } else {
                if (!current_entity.empty()) {
                    result[current_type].push_back(current_entity);
                    current_entity.clear();
                    current_type.clear();
                }
            }
        }
        if (!current_entity.empty()) {
            result[current_type].push_back(current_entity);
        }
        return result;
    }

    /** @brief Serialise to AddonResponse. */
    [[nodiscard]] AddonResponse to_addon_response() const {
        if (!success) return {"", false, error, {}};

        json j;
        j["input"] = input_text;
        j["tags"]  = json::array();
        for (const auto& t : tags) {
            j["tags"].push_back({
                {"token",      t.token},
                {"label",      t.label},
                {"confidence", t.confidence},
                {"offset",     t.offset}
            });
        }

        AddonResponse resp;
        resp.output              = j.dump();
        resp.success             = true;
        resp.metrics["tag_count"] = static_cast<double>(tags.size());
        return resp;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// InferenceResult
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @struct InferenceResult
 * @brief Raw tensor output from a generic ONNX forward pass.
 *
 * Use this for models that do not follow the embedding convention —
 * classifiers, regressors, multi-output models, or any custom ONNX graph.
 *
 * Each entry in `outputs` corresponds to one named output node from the
 * model, flattened into a 1-D float vector. Use `shape` to reconstruct
 * the original tensor dimensions if needed.
 */
struct InferenceResult {
    std::vector<std::vector<float>>        outputs;       ///< One flat vector per output node
    std::vector<std::string>               output_names;
    std::vector<std::vector<int64_t>>      shapes;        ///< Original tensor shape per output
    bool                                   success = false;
    std::string                            error;

    /**
     * @brief Retrieve a named output by node name.
     * @return Pointer to the output vector, or nullptr if not found.
     */
    [[nodiscard]] const std::vector<float>*
    get(std::string_view name) const noexcept {
        for (size_t i = 0; i < output_names.size(); ++i) {
            if (output_names[i] == name) return &outputs[i];
        }
        return nullptr;
    }

    /**
     * @brief Argmax over a flat output vector.
     *
     * Useful for single-label classifiers: returns the index of the
     * highest-scoring class.
     */
    [[nodiscard]] size_t argmax(std::string_view output_name) const noexcept {
        const auto* out = get(output_name);
        if (!out || out->empty()) return 0;
        return static_cast<size_t>(
            std::max_element(out->begin(), out->end()) - out->begin());
    }

    /**
     * @brief Softmax over a flat output vector.
     *
     * Converts raw logits to a probability distribution.
     */
    [[nodiscard]] std::vector<float>
    softmax(std::string_view output_name) const noexcept {
        const auto* out = get(output_name);
        if (!out || out->empty()) return {};

        std::vector<float> probs = *out;
        const float max_val = *std::max_element(probs.begin(), probs.end());
        float sum = 0.0f;
        for (float& v : probs) { v = std::exp(v - max_val); sum += v; }
        if (sum > 1e-9f) { for (float& v : probs) v /= sum; }
        return probs;
    }

    /** @brief Serialise to AddonResponse. */
    [[nodiscard]] AddonResponse to_addon_response() const {
        if (!success) return {"", false, error, {}};

        json j;
        for (size_t i = 0; i < output_names.size(); ++i) {
            json node;
            node["data"] = outputs[i];
            if (i < shapes.size()) node["shape"] = shapes[i];
            j[output_names[i]] = std::move(node);
        }

        AddonResponse resp;
        resp.output               = j.dump();
        resp.success              = true;
        resp.metrics["outputs"]   = static_cast<double>(outputs.size());
        return resp;
    }
};

} // namespace pce::nlp::inference
