/**
 * @file markov_addon.hh
 * @brief High-performance Markov Chain text generation engine.
 */

#ifndef MARKOV_ADDON_HH
#define MARKOV_ADDON_HH

#include "../nlp_addon_system.hh"
#include "../nlp_engine.hh"
#include <unordered_map>
#include <vector>
#include <string>
#include <random>
#include <iostream>
#include <fstream>
#include <sstream>
#include <algorithm>
#include <cmath>
#include <nlohmann/json.hpp>
#include "nlp/version.hh"
#include "vector_addon.hh"

namespace pce::nlp {

using json = nlohmann::json;

/**
 * @class MarkovAddon
 * @brief High-performance C++23 Markov Chain Text Generator with N-Gram support.
 *
 * This implementation follows the "Native-First" pattern, ensuring core generation
 * logic is decoupled from serialization.
 *
 * Key Features:
 * 1. Variable N-Grams (Bigrams, Trigrams, etc.)
 * 2. Softmax Temperature Sampling for creativity control.
 * 3. Nucleus (Top-P) Sampling.
 * 4. Hybrid Semantic Filtering via VectorAddon.
 */
class MarkovAddon : public NLPAddon<MarkovAddon>, public ITrainable {
private:
    /**
     * @brief Internal state for the Markov model.
     * Maps an N-Gram sequence (joined by space) to a map of next words and their frequencies.
     */
    std::unordered_map<std::string, std::unordered_map<std::string, uint32_t>> chain_;

    // Configurable N-Gram size (default to 2 for bigrams, 3 for trigrams)
    size_t n_gram_size_ = 2;

    // Optional semantic validator
    std::shared_ptr<VectorAddon> vector_engine_;

    std::string name_ = "markov_generator";
    std::string version_ = NLP_ENGINE_VERSION;
    bool ready_ = false;

    // Random engine for generation
    mutable std::mt19937 gen_{std::random_device{}()};

    /**
     * @brief Normalizes a string to lowercase for consistent matching.
     */
    std::string to_lower(std::string s) const {
        std::transform(s.begin(), s.end(), s.begin(),
                       [](unsigned char c){ return std::tolower(c); });
        return s;
    }

    /**
     * @brief Cleans a word for lookup (lowercase + remove punctuation).
     */
    std::string clean_word(std::string s) const {
        s = to_lower(s);
        // Keep alphanumeric for tokens
        s.erase(std::remove_if(s.begin(), s.end(),
                               [](unsigned char c){ return std::ispunct(c) && c != '\'' && c != '-'; }),
                s.end());
        return s;
    }

    /**
     * @brief Joins a window of words into a single key string.
     */
    std::string join_window(const std::vector<std::string>& window) const {
        std::string result;
        for (size_t i = 0; i < window.size(); ++i) {
            result += window[i];
            if (i < window.size() - 1) result += " ";
        }
        return result;
    }

public:
    /**
     * @brief Construct a new Markov Addon object.
     */
    /** @brief Default Constructor. */
    MarkovAddon() = default;

    /** @brief Rule of 5: Explicitly declared for modern C++ standards. */
    virtual ~MarkovAddon() = default;
    MarkovAddon(const MarkovAddon&) = default;
    MarkovAddon& operator=(const MarkovAddon&) = default;
    MarkovAddon(MarkovAddon&&) noexcept = default;
    MarkovAddon& operator=(MarkovAddon&&) noexcept = default;

    // --- NLPAddon Implementation ---

    /** @brief Internal implementation of name retrieval. */
    const std::string& name_impl() const { return name_; }
    /** @brief Internal implementation of version retrieval. */
    const std::string& version_impl() const { return version_; }

    /** @brief Manually override the model name. */
    void set_name(const std::string& new_name) { name_ = new_name; }

    /**
     * @brief Set the N-Gram context size. 2 = Bigram, 3 = Trigram.
     * @param n The window size for the Markov chain.
     */
    void set_ngram_size(size_t n) { n_gram_size_ = n; }

    /**
     * @brief Attach a vector engine for semantic rule-based filtering.
     * @param engine Shared pointer to a VectorAddon instance.
     */
    void set_vector_engine(std::shared_ptr<VectorAddon> engine) {
        vector_engine_ = engine;
    }

    /** @brief Internal initialization logic. */
    bool init_impl() {
        return true;
    }

    /**
     * @brief Process text generation based on a seed (Streaming).
     *
     * @param input The seed word or phrase.
     * @param callback Function to receive generated chunks.
     * @param options Generation parameters (length, temperature, top_p, n_gram).
     * @param context Optional session context.
     */
    void process_stream_impl(const std::string& input,
                            std::function<void(const std::string& chunk, bool is_final)> callback,
                            const std::unordered_map<std::string, std::string>& options,
                            std::shared_ptr<AddonContext> context = nullptr) {
        if (!ready_) {
            return;
        }

        int max_length = options.contains("length") ? std::stoi(options.at("length")) : 50;
        float temperature =
            options.contains("temperature") ? std::stof(options.at("temperature")) : 1.0f;
        float top_p = options.contains("top_p") ? std::stof(options.at("top_p")) : 0.9f;
        bool use_hybrid =
            options.contains("use_hybrid") ? (options.at("use_hybrid") == "true") : false;
        float semantic_threshold =
            options.contains("semantic_filter") ? std::stof(options.at("semantic_filter")) : 0.3f;
        int max_candidates =
            options.contains("max_candidates") ? std::stoi(options.at("max_candidates")) : 100;

        // Ensure n_gram_size is synced from options if provided
        if (options.contains("n_gram")) {
            n_gram_size_ = std::max((size_t)2, (size_t)std::stoul(options.at("n_gram")));
        }

        std::vector<std::string> window;
        std::string w;

        {
            std::istringstream iss(input);
            while (iss >> w) {
                std::string cleaned = clean_word(w);
                if (!cleaned.empty()) {
                    window.push_back(cleaned);
                }
            }
        }

        // Handle empty or too small seed
        if (window.empty()) {
            if (chain_.empty()) {
                callback("Error: Chain is empty. Please train the model first.", true);
                return;
            }
            auto it = chain_.begin();
            std::advance(it, std::uniform_int_distribution<size_t>(0, std::max((size_t)0, chain_.size() - 1))(gen_));
            std::istringstream ss(it->first);
            while (ss >> w) window.push_back(w);
        }

        // Ensure we don't exceed the required history for the N-Gram key
        if (window.size() >= n_gram_size_) {
            window.erase(window.begin(), window.begin() + (window.size() - (n_gram_size_ - 1)));
        }

        if (window.empty()) {
            callback("Error: Seed processing failed to produce window.", true);
            return;
        }

        for (int i = 0; i < max_length; ++i) {
            std::string key = join_window(window);
            auto it = chain_.find(key);

            // Backoff strategy: if trigram not found, try bigram, etc.
            while (it == chain_.end() && !window.empty()) {
                window.erase(window.begin());
                if (window.empty()) break;
                key = join_window(window);
                it = chain_.find(key);
            }

            // If we still didn't find a key OR the window became empty, force a jump
            if (it == chain_.end() || it->second.empty() || window.empty()) {
                // Total dead end: Jump to random start
                auto rand_it = chain_.begin();
                if (rand_it == chain_.end()) break;

                std::advance(rand_it, std::uniform_int_distribution<size_t>(0, std::max((size_t)0, chain_.size() - 1))(gen_));

                std::vector<std::string> new_window;
                std::istringstream ss(rand_it->first);
                while (ss >> w) new_window.push_back(w);

                if (new_window.empty()) continue; // Safety

                callback("... " + new_window.back() + " ", false);
                window = new_window;
                if (window.size() >= n_gram_size_) {
                    window.erase(window.begin(), window.begin() + (window.size() - (n_gram_size_ - 1)));
                }
                continue;
            }

            const auto& possibilities = it->second;
            std::vector<std::pair<std::string, float>> scored_candidates;

            // 1. Temperature-based Softmax Scoring
            float sum_exp = 0.0f;
            for (const auto& [word, freq] : possibilities) {
                float score = std::pow(static_cast<float>(freq), 1.0f / std::max(0.01f, temperature));
                scored_candidates.push_back({word, score});
                sum_exp += score;
            }

            // Normalize
            for (auto& cand : scored_candidates) cand.second /= sum_exp;

            // 2. Hybrid Semantic Filtering (Hardened)
            if (use_hybrid && vector_engine_ && vector_engine_->is_ready_impl() && !window.empty()) {
                std::string context_word = window.back();
                int attempts = 0;
                for (auto& cand : scored_candidates) {
                    if (++attempts > max_candidates) break;
                    try {
                        float sim = vector_engine_->calculate_similarity(context_word, cand.first);
                        if (sim < semantic_threshold) cand.second *= 0.1f; // Penalty
                    } catch (...) {
                        // Skip penalty if similarity fails
                    }
                }
            }

            // 3. Sort for Nucleus Sampling
            std::sort(scored_candidates.begin(), scored_candidates.end(),
                     [](const auto& a, const auto& b) { return a.second > b.second; });

            // 4. Top-P (Nucleus) Filter
            float cumulative = 0.0f;
            std::vector<std::pair<std::string, float>> nucleus;
            for (const auto& cand : scored_candidates) {
                nucleus.push_back(cand);
                cumulative += cand.second;
                if (cumulative >= top_p) break;
            }

            if (nucleus.empty()) nucleus = {scored_candidates.front()};

            // 5. Random Sample from Nucleus
            std::uniform_real_distribution<float> dist(0.0f, std::max(0.0001f, cumulative));
            float target = dist(gen_);
            float current_sum = 0.0f;
            std::string next_word;

            for (const auto& cand : nucleus) {
                current_sum += cand.second;
                if (current_sum >= target) {
                    next_word = cand.first;
                    break;
                }
            }

            if (next_word.empty() && !nucleus.empty()) {
                next_word = nucleus.front().first;
            }

            if (next_word.empty()) {
                // Total stall
                break;
            }

            callback(next_word + " ", false);

            // Advance window
            window.push_back(next_word);
            while (window.size() >= n_gram_size_) {
                window.erase(window.begin());
            }
        }

        callback("", true);
    }

    /**
     * @brief Synchronous processing implementation.
     *
     * Wraps the streaming implementation to provide a standard AddonResponse.
     * Follows the "JSON at the Edge" pattern by returning native structures.
     *
     * @param input The seed text.
     * @param options Generation configuration.
     * @param context Optional context.
     * @return AddonResponse Native result container.
     */
    AddonResponse process_impl(const std::string& input,
                               const std::unordered_map<std::string, std::string>& options,
                               std::shared_ptr<AddonContext> context = nullptr) {
        if (!ready_) {
            return {"", false, "Markov model not loaded", {}};
        }

        std::string result;
        int tokens_generated = 0;
        process_stream_impl(input, [&](const std::string& chunk, bool is_final) {
            if (!is_final) {
                result += chunk;
                tokens_generated++;
            }
        }, options, context);

        AddonResponse resp;
        resp.output = result;
        resp.success = true;
        resp.metrics["tokens_generated"] = static_cast<double>(tokens_generated);
        return resp;
    }

    /** @brief Checks if the Markov model is loaded and ready. */
    bool is_ready_impl() const { return ready_; }

    /**
     * @brief Loads a pre-trained Markov Knowledge Pack from a JSON file.
     * @param path Filesystem path to the model JSON.
     * @return True if loading was successful.
     */
    bool load_knowledge_pack(const std::string& path) {
        std::ifstream file(path);
        if (!file.is_open()) return false;

        json data;
        try { file >> data; } catch (...) { return false; }

        chain_.clear();
        if (data.contains("ngram_size")) n_gram_size_ = data["ngram_size"];

        auto model_data = data.contains("data") ? data["data"] : data;
        for (auto it = model_data.begin(); it != model_data.end(); ++it) {
            if (it.key() == "metadata" || it.key() == "ngram_size" || it.key() == "data") continue;

            std::string key = it.key();
            if (!it.value().is_object()) continue;

            for (auto next_it = it.value().begin(); next_it != it.value().end(); ++next_it) {
                if (next_it.value().is_number()) {
                    chain_[key][next_it.key()] = next_it.value().get<uint32_t>();
                }
            }
        }

        ready_ = !chain_.empty();
        return ready_;
    }

    /**
     * @brief Trains a new Markov model from a source text file.
     *
     * Implementation of the ITrainable interface.
     *
     * @param source_path Path to the raw training text.
     * @param model_output_path Path where the resulting JSON model should be saved.
     * @return True if training completed and saved successfully.
     */
    bool train(const std::string& source_path, const std::string& model_output_path) override {
        std::ifstream file(source_path);
        if (!file.is_open()) return false;

        std::string word;
        std::vector<std::string> history;
        std::unordered_map<std::string, std::unordered_map<std::string, uint32_t>> temp_chain;

        while (file >> word) {
            word = clean_word(word);
            if (word.empty()) continue;

            // Build N-Gram connections for all sizes up to n_gram_size_
            // This allows for better fallback when generating.
            for (size_t size = 1; size < n_gram_size_; ++size) {
                if (history.size() >= size) {
                    std::vector<std::string> sub_history(history.end() - size, history.end());
                    std::string key = join_window(sub_history);
                    temp_chain[key][word]++;
                }
            }

            history.push_back(word);
            if (history.size() >= n_gram_size_) {
                history.erase(history.begin());
            }
        }

        json output;
        output["ngram_size"] = n_gram_size_;
        output["data"] = temp_chain;
        output["metadata"] = {
            {"version", version_},
            {"engine", "pce_nlp_markov_v2"}
        };

        std::ofstream out_file(model_output_path);
        out_file << output.dump(2);
        return true;
    }

    /** @brief Returns current training progress (0.0 to 1.0). */
    float get_training_progress() const override { return ready_ ? 1.0f : 0.0f; }
};

} // namespace pce::nlp

#endif // MARKOV_ADDON_HH
