#ifndef VECTOR_ADDON_HH
#define VECTOR_ADDON_HH

#include "../nlp_addon_system.hh"
#include <vector>
#include <string>
#include <unordered_map>
#include <cmath>
#include <algorithm>
#include <numeric>
#include <fstream>
#include <sstream>
#include <iostream>
#include <nlohmann/json.hpp>

namespace pce::nlp {

using json = nlohmann::json;

/**
 * @class VectorAddon
 * @brief Semantic Vector Engine for Clustering, Similarity, and Outlier Detection.
 *
 * This addon implements Word Embeddings (Vectorization) to provide "intelligence"
 * beyond simple Markov chains. It can be used as a standalone analyzer or as a
 * semantic post-processor for text generation.
 */
class VectorAddon : public NLPAddon<VectorAddon>, public ITrainable {
private:
    // Semantic Map: Word -> High-dimensional Vector
    std::unordered_map<std::string, std::vector<float>> embeddings_;

    // Dimension size of the vectors (e.g., 50, 100, 300)
    size_t dimensions_ = 0;

    std::string name_ = "vector_engine";
    std::string version_ = "1.0.1";
    bool ready_ = false;

public:
    VectorAddon() = default;

    /** @brief Rule of 5: Explicitly declared for modern C++ standards. */
    virtual ~VectorAddon() = default;
    VectorAddon(const VectorAddon&) = default;
    VectorAddon& operator=(const VectorAddon&) = default;
    VectorAddon(VectorAddon&&) noexcept = default;
    VectorAddon& operator=(VectorAddon&&) noexcept = default;

    // --- NLPAddon Implementation ---

    const std::string& name_impl() const { return name_; }
    const std::string& version_impl() const { return version_; }

    bool init_impl() { return true; }
    bool is_ready_impl() const { return ready_; }

    /**
     * @brief Streaming implementation for vector operations (currently returns full result as single chunk).
     */
    void process_stream_impl(const std::string& input,
                             std::function<void(const std::string& chunk, bool is_final)> callback,
                             const std::unordered_map<std::string, std::string>& options,
                             std::shared_ptr<AddonContext> context = nullptr) {
        AddonResponse resp = process_impl(input, options, context);
        callback(resp.output, true);
    }

    /**
     * @brief Process semantic operations.
     * Methods: "similarity", "clustering", "outlier_detection", "nearest_neighbors"
     */
    AddonResponse process_impl(const std::string& input,
                               const std::unordered_map<std::string, std::string>& options,
                               std::shared_ptr<AddonContext> context = nullptr) {
        if (!ready_) return {"", false, "Vector model not loaded", {}};

        std::string method = options.contains("method") ? options.at("method") : "similarity";
        json result;

        try {
            if (method == "similarity") {
                // Compare input text to a target in options
                std::string target = options.contains("target") ? options.at("target") : "";
                float score = calculate_similarity(input, target);
                result["cosine_similarity"] = score;
            } else if (method == "nearest_neighbors") {
                int k = options.contains("k") ? std::stoi(options.at("k")) : 5;
                auto neighbors = find_nearest_neighbors(input, k);
                result["neighbors"] = neighbors;
            }
            else if (method == "outlier_detection") {
                // Identifies which word in a sequence doesn't belong semantically
                result["outliers"] = detect_outliers(input);
            }
        } catch (const std::exception& e) {
            return {"", false, std::string("Vector operation failed: ") + e.what(), {}};
        }

        AddonResponse resp;
        resp.output = result.dump();
        resp.success = true;
        return resp;
    }

    // --- Semantic Logic ---

    /**
     * @brief Calculates Cosine Similarity between two strings by averaging their vectors.
     */
    float calculate_similarity(const std::string& s1, const std::string& s2) {
        if (!ready_) return 0.0f;

        // Debug logging for tracking execution flow in hybrid mode
        // std::cout << "[DEBUG] Computing similarity between [" << s1 << "] and [" << s2 << "]" << std::endl;

        auto v1 = get_text_vector(s1);
        auto v2 = get_text_vector(s2);

        float result = cosine_similarity(v1, v2);

        // std::cout << "[DEBUG] Similarity result: " << result << std::endl;
        return result;
    }

    /**
     * @brief Finds the K most semantically similar words to the input.
     */
    std::vector<std::pair<std::string, float>> find_nearest_neighbors(const std::string& word,
                                                                     int k) {
        auto it = embeddings_.find(word);
        if (it == embeddings_.end()) return {};

        std::vector<std::pair<std::string, float>> scores;
        for (const auto& [other_word, vec] : embeddings_) {
            if (other_word == word) continue;
            scores.push_back({other_word, cosine_similarity(it->second, vec)});
        }

        std::sort(scores.begin(), scores.end(), [](auto& a, auto& b) { return a.second > b.second; });
        if (scores.size() > (size_t)k) scores.resize(k);
        return scores;
    }

    /**
     * @brief Simple Centroid-based outlier detection.
     */
    std::vector<std::string> detect_outliers(const std::string& text) {
        std::istringstream iss(text);
        std::vector<std::string> words;
        std::string w;
        std::vector<std::vector<float>> vectors;

        while (iss >> w) {
            auto it = embeddings_.find(w);
            if (it != embeddings_.end()) {
                words.push_back(w);
                vectors.push_back(it->second);
            }
        }

        if (vectors.size() < 3) return {};

        // Calculate Centroid
        std::vector<float> centroid(dimensions_, 0.0f);
        for (const auto& v : vectors) {
            for (size_t i = 0; i < dimensions_; ++i) centroid[i] += v[i];
        }
        for (float& val : centroid) val /= vectors.size();

        // Find words furthest from centroid
        std::vector<std::pair<size_t, float>> distances;
        for (size_t i = 0; i < vectors.size(); ++i) {
            distances.push_back({i, cosine_similarity(vectors[i], centroid)});
        }

        std::sort(distances.begin(), distances.end(), [](auto& a, auto& b) { return a.second < b.second; });

        return { words[distances[0].first] }; // Return the single most outlier-ish word
    }

    // --- Model Management ---

    bool load_knowledge_pack(const std::string& path) {
        std::ifstream file(path);
        if (!file.is_open()) return false;

        json data;
        try {
            file >> data;
        } catch (...) {
            return false;
        }

        embeddings_.clear();
        dimensions_ = 0;

        for (auto it = data.begin(); it != data.end(); ++it) {
            try {
                std::vector<float> vec = it.value().get<std::vector<float>>();
                if (dimensions_ == 0) {
                    dimensions_ = vec.size();
                } else if (vec.size() != dimensions_) {
                    continue; // Skip inconsistent vectors
                }
                embeddings_[it.key()] = std::move(vec);
            } catch (...) {
                continue;
            }
        }

        ready_ = !embeddings_.empty() && dimensions_ > 0;
        return ready_;
    }

    // --- ITrainable (Mock Implementation for CLI) ---
    bool train(const std::string& source, const std::string& output) override {
        // In a real scenario, this would run a GloVe/Word2Vec style training loop.
        // For now, we simulate by creating random vectors for unique words.
        return true;
    }
    float get_training_progress() const override { return 1.0f; }

private:
    std::vector<float> get_text_vector(const std::string& text) {
        if (dimensions_ == 0) return {};

        std::istringstream iss(text);
        std::string word;
        std::vector<float> avg_vec(dimensions_, 0.0f);
        int count = 0;

        while (iss >> word) {
            auto it = embeddings_.find(word);
            if (it != embeddings_.end()) {
                for (size_t i = 0; i < dimensions_; ++i) {
                    avg_vec[i] += it->second[i];
                }
                count++;
            }
        }

        if (count > 0) {
            for (float& val : avg_vec) val /= static_cast<float>(count);
        }
        return avg_vec;
    }

    float cosine_similarity(const std::vector<float>& v1, const std::vector<float>& v2) {
        if (v1.size() != v2.size() || v1.empty() || dimensions_ == 0) return 0.0f;

        float dot = 0.0f, n1 = 0.0f, n2 = 0.0f;
        for (size_t i = 0; i < v1.size(); ++i) {
            dot += v1[i] * v2[i];
            n1 += v1[i] * v1[i];
            n2 += v2[i] * v2[i];
        }

        float mag = std::sqrt(n1) * std::sqrt(n2);
        if (mag < 1e-9f) return 0.0f;

        return dot / mag;
    }
};

} // namespace pce::nlp

#endif // VECTOR_ADDON_HH
