/**
 * @file dedupe_addon.hh
 * @brief High-performance deduplication and redundancy detection engine.
 */

#ifndef DEDUPE_ADDON_HH
#define DEDUPE_ADDON_HH

#include "../nlp_addon_system.hh"
#include "nlp/version.hh"
#include "vector_addon.hh"
#include <vector>
#include <unordered_set>
#include <unordered_map>
#include <sstream>
#include <algorithm>
#include <iostream>
#include <regex>

namespace pce::nlp {

/**
 * @class DeduplicationAddon
 * @brief Advanced deduplication for granular pattern detection.
 * Supports detection and removal of repeated segments based on normalization rules.
 */
class DeduplicationAddon : public NLPAddon<DeduplicationAddon> {
public:
    /**
     * @brief Construct a new Deduplication Addon object.
     * Initializes with the global engine version and the "deduplication" plugin identity.
     */
    DeduplicationAddon() : name_("deduplication"), version_(NLP_ENGINE_VERSION), ready_(true) {}

    /** @brief Rule of 5: Explicitly declared for modern C++ standards. */
    virtual ~DeduplicationAddon() = default;
    DeduplicationAddon(const DeduplicationAddon&) = default;
    DeduplicationAddon& operator=(const DeduplicationAddon&) = default;
    DeduplicationAddon(DeduplicationAddon&&) noexcept = default;
    DeduplicationAddon& operator=(DeduplicationAddon&&) noexcept = default;

    /** @brief Returns the unique plugin name. */
    const std::string& name_impl() const { return name_; }
    /** @brief Returns the plugin version. */
    const std::string& version_impl() const { return version_; }

    /** @brief Pre-flight initialization logic. */
    bool init_impl() { return true; }

    /**
     * @brief Stream processing implementation.
     * For deduplication, this is a wrapper around the synchronous process() call.
     */
    void process_stream_impl(const std::string& input,
                             std::function<void(const std::string& chunk, bool is_final)> callback,
                             const std::unordered_map<std::string, std::string>& options,
                             std::shared_ptr<AddonContext> context = nullptr) {
        auto resp = process_impl(input, options, context);
        callback(resp.output, true);
    }

    /** @brief Attach a vector engine for semantic similarity checks. */
    void set_vector_engine(std::shared_ptr<VectorAddon> engine) { vector_engine_ = engine; }

    /**
     * @brief Process text by segmenting it into phrases/sentences and identifying duplicates.
     *
     * Options:
     * - mode: "detect" | "remove"
     * - min_length: minimum character length of a segment to be considered for deduplication
     * - skip_words: comma-separated list of words to ignore during normalization
     * - ignore_quotes: boolean string ("true"/"false") to strip quotes during comparison
     * - ignore_punctuation: boolean string ("true"/"false") to strip punctuation during comparison
     */
    /**
     * @brief Core deduplication logic using a "Native-First" approach.
     *
     * Processes the input text and identifies repeated segments. Results are stored
     * in the AddonResponse maps (metadata/metrics) rather than as a JSON string.
     *
     * @param input Raw text to analyze.
     * @param options Processing parameters (mode, min_length, skip_words, etc).
     * @param context Optional session/document context.
     * @return AddonResponse Native C++ result object.
     */
    AddonResponse process_impl(const std::string& input,
                               const std::unordered_map<std::string, std::string>& options,
                               std::shared_ptr<AddonContext> context = nullptr) {
        std::string mode = options.contains("mode") ? options.at("mode") : "detect";
        size_t min_len_threshold =
            options.contains("min_length") ? std::stoul(options.at("min_length")) : 1;
        bool ignore_quotes =
            options.contains("ignore_quotes") && options.at("ignore_quotes") == "true";
        bool ignore_punctuation =
            options.contains("ignore_punctuation") && options.at("ignore_punctuation") == "true";

        std::unordered_set<std::string> skip_set;
        if (options.contains("skip_words") && !options.at("skip_words").empty()) {
            std::stringstream ss(options.at("skip_words"));
            std::string w;
            while (std::getline(ss, w, ',')) {
                if (!w.empty()) skip_set.insert(normalize_word(w));
            }
        }

        struct Segment {
            std::string raw;        // Original text including trailing punctuation/space
            std::string signature;  // Normalized version used for comparison
            size_t offset;
            size_t length;
            bool is_duplicate = false;
        };

        std::vector<Segment> segments;
        // Regex to split by sentence-ending punctuation while keeping the punctuation
        std::regex segment_regex(R"([^.!?\s][^.!?]*[.!?]*)");
        auto seg_begin = std::sregex_iterator(input.begin(), input.end(), segment_regex);
        auto seg_end = std::sregex_iterator();

        size_t last_pos = 0;
        for (std::sregex_iterator i = seg_begin; i != seg_end; ++i) {
            std::smatch match = *i;
            std::string raw = match.str();

            // Check for leading whitespace that might have been skipped by the regex
            if (match.position() > last_pos) {
                // If we are in remove mode, we might want to preserve the leading space
                // but for segmentation we usually attach it to the next segment or keep it.
            }

            std::string sig = create_signature(raw, skip_set, ignore_quotes, ignore_punctuation);

            segments.push_back({raw, sig, static_cast<size_t>(match.position()), raw.length(), false});
            last_pos = match.position() + raw.length();
        }

        std::unordered_set<std::string> seen_signatures;
        int dup_count = 0;

        for (auto& seg : segments) {
            if (seg.signature.empty()) continue;

            // Apply min_length check on the signature or the raw text?
            // Unit tests suggest min_length applies to the segment being compared.
            if (seg.signature.length() < min_len_threshold) continue;

            if (seen_signatures.contains(seg.signature)) {
                seg.is_duplicate = true;
                dup_count++;
            } else {
                seen_signatures.insert(seg.signature);
            }
        }

        AddonResponse resp;
        resp.success = true;

        if (mode == "remove") {
            std::string result;
            bool first = true;
            for (const auto& seg : segments) {
                if (!seg.is_duplicate) {
                    if (!first && !result.empty() && result.back() != ' ' && seg.raw.front() != ' ') {
                        result += " ";
                    }
                    result += seg.raw;
                    first = false;
                }
            }
            // Trim trailing space if added
            if (!result.empty() && result.back() == ' ') result.pop_back();
            resp.output = result;
        } else {
            resp.output = input;
        }

        // Export duplicates as structured metadata
        int meta_idx = 0;
        for (const auto& seg : segments) {
            if (seg.is_duplicate) {
                std::string idx_str = std::to_string(meta_idx++);
                resp.metadata["dup_" + idx_str + "_text"] = seg.raw;
                resp.metadata["dup_" + idx_str + "_offset"] = std::to_string(seg.offset);
                resp.metadata["dup_" + idx_str + "_length"] = std::to_string(seg.length);
            }
        }

        resp.metrics["duplicates_found"] = static_cast<double>(dup_count);
        resp.metrics["has_duplicates"] = dup_count > 0 ? 1.0 : 0.0;

        return resp;
    }

    /** @brief Internal implementation of the is_ready check for the CRTP system. */
    bool is_ready_impl() const { return ready_; }

private:
    /**
     * @brief Normalizes a single word for comparison.
     * Strips punctuation and whitespace, converts to lowercase.
     */
    std::string normalize_word(const std::string& s) {
        std::string res;
        for (unsigned char c : s) {
            if (!std::ispunct(c) && !std::isspace(c)) {
                res += static_cast<char>(std::tolower(c));
            }
        }
        return res;
    }

    /**
     * @brief Creates a normalized signature for a text segment.
     *
     * Tokenizes the segment, applies normalization rules (quotes, punctuation, skip words),
     * and joins the results into a stable signature string.
     */
    std::string create_signature(const std::string& s,
                                 const std::unordered_set<std::string>& skip_set,
                                 bool ignore_quotes,
                                 bool ignore_punctuation) {
        std::stringstream ss;
        std::string word;
        std::string input_copy = s;

        // Simple tokenizer for signature creation
        std::regex word_regex(R"(\S+)");
        auto words_begin = std::sregex_iterator(input_copy.begin(), input_copy.end(), word_regex);
        auto words_end = std::sregex_iterator();

        bool first = true;
        for (std::sregex_iterator i = words_begin; i != words_end; ++i) {
            std::string w = i->str();

            if (ignore_quotes) {
                std::erase(w, '\"');
                std::erase(w, '\'');
            }
            if (ignore_punctuation) {
                std::erase_if(w, ::ispunct);
            }

            std::string norm = normalize_word(w);
            if (norm.empty() || skip_set.contains(norm)) continue;

            if (!first) ss << " ";
            ss << norm;
            first = false;
        }
        return ss.str();
    }

    std::shared_ptr<VectorAddon> vector_engine_;
    std::string name_;
    std::string version_;
    bool ready_;
};

} // namespace pce::nlp

#endif
