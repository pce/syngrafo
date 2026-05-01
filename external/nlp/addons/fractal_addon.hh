/**
 * @file fractal_addon.hh
 * @brief Recursive fractal text generation engine.
 */

#ifndef FRACTAL_ADDON_HH
#define FRACTAL_ADDON_HH

#include "../nlp_addon_system.hh"
#include "markov_addon.hh"
#include "vector_addon.hh"
#include <cmath>
#include <sstream>
#include <random>
#include <algorithm>
#include <iterator>

namespace pce::nlp {

/**
 * @class FractalAddon
 * @brief Experimental text generator that uses recursive branching patterns.
 *
 * This addon creates "Fractal Text" by recursively splitting the generation
 * into branches, using a Markov source for local texture and an optional
 * Vector engine to maintain thematic consistency across branches.
 */
class FractalAddon : public NLPAddon<FractalAddon> {
public:
    /**
     * @brief Construct a new Fractal Addon object.
     * Initializes the random engine and sets default generation parameters.
     */
    FractalAddon()
        : name_("fractal_generator"), version_("1.2.0"), depth_(3), segment_length_(20), ready_(false) {
        std::random_device rd;
        gen_.seed(rd());
    }

    /** @brief Rule of 5: Explicitly declared for modern C++ standards. */
    virtual ~FractalAddon() = default;
    FractalAddon(const FractalAddon&) = default;
    FractalAddon& operator=(const FractalAddon&) = default;
    FractalAddon(FractalAddon&&) noexcept = default;
    FractalAddon& operator=(FractalAddon&&) noexcept = default;

    /** @brief Returns the unique plugin name. */
    const std::string& name_impl() const { return name_; }
    /** @brief Returns the plugin version. */
    const std::string& version_impl() const { return version_; }

    /** @brief Pre-flight initialization logic. */
    bool init_impl() { return true; }

    /**
     * @brief Stream processing implementation.
     * For the fractal engine, this currently wraps the recursive process() call.
     */
    void process_stream_impl(const std::string& input,
                             std::function<void(const std::string& chunk, bool is_final)> callback,
                             const std::unordered_map<std::string, std::string>& options,
                             std::shared_ptr<AddonContext> context = nullptr) {
        auto resp = process_impl(input, options, context);
        callback(resp.output, true);
    }

    /**
     * @brief Attach the primary Markov source used for segment generation.
     * @param source Shared pointer to a MarkovAddon.
     */
    void set_markov_source(std::shared_ptr<MarkovAddon> source) {
        markov_source_ = source;
        if (source) ready_ = true;
    }

    /**
     * @brief Attach a vector engine for thematic consistency.
     * @param engine Shared pointer to a VectorAddon.
     */
    void set_vector_engine(std::shared_ptr<VectorAddon> engine) {
        vector_engine_ = engine;
    }

    /**
     * @brief Process a fractal generation request using a "Native-First" approach.
     *
     * Recursively splits the generation task into branches. Results are stored
     * in the AddonResponse maps (metadata/metrics) rather than as a JSON string.
     *
     * @param input The seed text or thematic anchor.
     * @param options Processing parameters (depth, length, temperature, n_gram).
     * @param context Optional session/document context.
     * @return AddonResponse Native C++ result object.
     */
    AddonResponse process_impl(const std::string& input,
                               const std::unordered_map<std::string, std::string>& options,
                               std::shared_ptr<AddonContext> context = nullptr) {
        if (!markov_source_) {
            return {"", false, "Fractal engine requires a Markov source instance.", {}};
        }

        int depth = options.contains("depth") ? std::stoi(options.at("depth")) : 3;
        int seg_len = options.contains("length") ? std::stoi(options.at("length")) : 20;

        // Ensure parameters are sane
        depth = std::clamp(depth, 0, 5); // Prevent stack overflow
        seg_len = std::clamp(seg_len, 5, 200);

        std::cout << "[Fractal] Starting generation. Depth: " << depth << " SegLen: " << seg_len << std::endl;

        // If input is a command like "[Log] Starting analysis...", we might want to strip it or use it as a thematic anchor.
        // For now, we use the input directly as the seed.
        std::string result = generate_recursive(input, depth, seg_len, options, context);

        AddonResponse resp;
        resp.output = result;
        resp.success = true;
        resp.metrics["depth"] = static_cast<double>(depth);
        resp.metrics["total_length"] = static_cast<double>(result.length());

        return resp;
    }

    /** @brief Checks if the addon has a valid Markov source and is ready. */
    bool is_ready_impl() const {
        return ready_;
    }

private:
    /**
     * @brief Recursive core of the fractal generator.
     */
    std::string generate_recursive(const std::string& seed, int depth, int segment_len,
                                 const std::unordered_map<std::string, std::string>& options,
                                 std::shared_ptr<AddonContext> context) {
        if (depth <= 0) {
            // Base case: Generate a standard Markov segment
            auto local_options = options;
            local_options["length"] = std::to_string(segment_len);

            auto result = markov_source_->process(seed, local_options, context);
            return result.has_value() ? result->output : "";
        }

        // --- Fractal Branching (Binary Split) ---

        // Branch A: Primary generation from current seed
        std::string branch_a = generate_recursive(seed, depth - 1, segment_len, options, context);

        // Extract context for Branch B
        // We use the last N words of Branch A to seed Branch B to maintain flow.
        // If Branch A is empty or short, we fall back to the original seed.
        int context_words = options.contains("n_gram") ? std::stoi(options.at("n_gram")) : 2;
        std::string bridge_seed = extract_context(branch_a, context_words);

        if (bridge_seed.empty()) {
            bridge_seed = seed;
        }

        // Branch B: Recursive variation
        std::string branch_b = generate_recursive(bridge_seed, depth - 1, segment_len, options, context);

        // Compose the segments
        std::string result = branch_a;
        if (!branch_b.empty()) {
            if (!result.empty() && result.back() != ' ' && result.back() != '\n') {
                result += " ";
            }
            result += branch_b;
        }

        return result;
    }

    /**
     * @brief Extracts the last N words from a text segment to act as a bridge seed.
     */
    std::string extract_context(const std::string& text, int word_count) {
        std::istringstream iss(text);
        std::vector<std::string> words((std::istream_iterator<std::string>(iss)),
                                        std::istream_iterator<std::string>());

        if (words.empty()) return "";

        int start = std::max(0, static_cast<int>(words.size()) - word_count);
        std::string res;
        for (size_t i = start; i < words.size(); ++i) {
            res += words[i];
            if (i < words.size() - 1) res += " ";
        }
        return res;
    }

    std::shared_ptr<MarkovAddon> markov_source_;
    std::shared_ptr<VectorAddon> vector_engine_;
    std::string name_;
    std::string version_;
    std::mt19937 gen_;
    int depth_;
    int segment_length_;
    bool ready_;
};

} // namespace pce::nlp

#endif // FRACTAL_ADDON_HH
