/**
 * @file fractal_addon.hh
 * @brief Recursive fractal text generation engine.
 *
 * Generates text by recursively branching a Markov source: each recursion
 * level produces two segments (A and B), where B is seeded from the tail
 * of A to maintain local coherence.  An optional VectorAddon can provide
 * thematic consistency across branches.
 */

#pragma once

#include "../nlp_addon_system.hh"
#include "markov_addon.hh"
#include "vector_addon.hh"
#include <algorithm>
#include <cmath>
#include <iterator>
#include <random>
#include <sstream>

namespace pce::nlp {

/**
 * @class FractalAddon
 * @brief Experimental text generator using recursive branching patterns.
 */
class FractalAddon : public NLPAddon<FractalAddon> {
public:
    FractalAddon() : name_("fractal_generator"), version_("1.2.0") {
        std::random_device rd;
        gen_.seed(rd());
    }

    virtual ~FractalAddon() = default;
    FractalAddon(const FractalAddon&) = default;
    FractalAddon& operator=(const FractalAddon&) = default;
    FractalAddon(FractalAddon&&) noexcept = default;
    FractalAddon& operator=(FractalAddon&&) noexcept = default;

    const std::string& name_impl()    const { return name_; }
    const std::string& version_impl() const { return version_; }
    bool               init_impl()          { return true; }
    bool               is_ready_impl() const { return markov_source_ != nullptr; }

    /** @brief Attach the Markov source used for segment generation. */
    void set_markov_source(std::shared_ptr<MarkovAddon> source) {
        markov_source_ = std::move(source);
    }

    /** @brief Attach a vector engine for thematic consistency (optional). */
    void set_vector_engine(std::shared_ptr<VectorAddon> engine) {
        vector_engine_ = std::move(engine);
    }

    AddonResponse process_impl(const std::string& input,
                               const std::unordered_map<std::string, std::string>& options,
                               std::shared_ptr<AddonContext> context = nullptr) {
        if (!markov_source_)
            return {"", false, "Fractal engine requires a Markov source.", {}};

        const int depth   = std::clamp(opt_int(options, "depth",  3), 0, 5);
        const int seg_len = std::clamp(opt_int(options, "length", 20), 5, 200);

        std::string result = generate_recursive(input, depth, seg_len, options, context);

        AddonResponse resp;
        resp.output             = result;
        resp.success            = true;
        resp.metrics["depth"]        = static_cast<double>(depth);
        resp.metrics["total_length"] = static_cast<double>(result.length());
        return resp;
    }

    void process_stream_impl(const std::string& input,
                             std::function<void(const std::string& chunk, bool is_final)> callback,
                             const std::unordered_map<std::string, std::string>& options,
                             std::shared_ptr<AddonContext> context = nullptr) {
        callback(process_impl(input, options, context).output, true);
    }

private:
    std::string generate_recursive(const std::string& seed, int depth, int segment_len,
                                   const std::unordered_map<std::string, std::string>& options,
                                   std::shared_ptr<AddonContext> context) {
        if (depth <= 0) {
            auto local_opts = options;
            local_opts["length"] = std::to_string(segment_len);
            auto result = markov_source_->process(seed, local_opts, context);
            return result.has_value() ? result->output : "";
        }

        std::string branch_a = generate_recursive(seed, depth - 1, segment_len, options, context);

        const int   ctx_words  = opt_int(options, "n_gram", 2);
        std::string bridge     = tail_words(branch_a, ctx_words);
        if (bridge.empty()) bridge = seed;

        std::string branch_b = generate_recursive(bridge, depth - 1, segment_len, options, context);

        std::string result = branch_a;
        if (!branch_b.empty()) {
            if (!result.empty() && result.back() != ' ' && result.back() != '\n')
                result += ' ';
            result += branch_b;
        }
        return result;
    }

    /** Extract the last @p n words from @p text as a bridge seed. */
    static std::string tail_words(const std::string& text, int n) {
        std::istringstream iss(text);
        std::vector<std::string> words(std::istream_iterator<std::string>{iss},
                                       std::istream_iterator<std::string>{});
        if (words.empty()) return {};
        const int start = std::max(0, static_cast<int>(words.size()) - n);
        std::string result;
        for (int i = start; i < static_cast<int>(words.size()); ++i) {
            if (i > start) result += ' ';
            result += words[i];
        }
        return result;
    }

    static int opt_int(const std::unordered_map<std::string, std::string>& opts,
                       const std::string& key, int fallback) {
        const auto it = opts.find(key);
        return it != opts.end() ? std::stoi(it->second) : fallback;
    }

    std::shared_ptr<MarkovAddon> markov_source_;
    std::shared_ptr<VectorAddon> vector_engine_;
    std::string name_;
    std::string version_;
    std::mt19937 gen_;
};

} // namespace pce::nlp

