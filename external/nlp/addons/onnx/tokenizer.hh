/**
 * @file tokenizer.hh
 * @brief Standalone tokeniser types for NLP preprocessing.
 *
 * No ONNX dependency. These types are shared across all addons that need
 * to encode text into integer token sequences — including ONNXAddon,
 * SummarizeAddon, StylizeAddon, and any future sequence model.
 *
 * ### Usage
 * ```cpp
 * #include "nlp/addons/onnx/tokenizer.hh"
 *
 * pce::nlp::tokenizer::SimpleTokenizer tok;
 * tok.load_vocab("models/vocab.txt");
 *
 * auto enc = tok.encode("NASA and SpaceX launched a rocket.", 128);
 * // enc.input_ids, enc.attention_mask, enc.token_type_ids
 * ```
 */

#pragma once

#include <algorithm>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace pce::nlp::tokenizer {

// ─────────────────────────────────────────────────────────────────────────────
// Encoding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @struct Encoding
 * @brief Token ID sequence with attention mask and segment type IDs.
 *
 * This is the wire format expected by BERT-family models (ONNX or otherwise).
 * All three vectors have identical length — padded or truncated to `max_len`.
 *
 * | field            | description                                          |
 * |------------------|------------------------------------------------------|
 * | input_ids        | Token IDs including [CLS] and [SEP]                  |
 * | attention_mask   | 1 for real tokens, 0 for padding                     |
 * | token_type_ids   | Segment ID (0 = sentence A, 1 = sentence B)          |
 * | real_length      | Number of tokens before padding (incl. [CLS]/[SEP]) |
 */
struct Encoding {
    std::vector<int64_t> input_ids;
    std::vector<int64_t> attention_mask;
    std::vector<int64_t> token_type_ids;
    size_t               real_length = 0;

    /** @brief True if at least one non-padding token is present. */
    [[nodiscard]] bool empty() const noexcept { return real_length == 0; }

    /** @brief Number of actual content tokens (excludes [CLS], [SEP], padding). */
    [[nodiscard]] size_t content_length() const noexcept {
        return real_length > 2 ? real_length - 2 : 0;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// ITokenizer interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @class ITokenizer
 * @brief Abstract tokeniser interface.
 *
 * Allows swapping SimpleTokenizer for a production BPE / WordPiece tokeniser
 * without changing any addon code. All addons accept `const ITokenizer&`.
 */
class ITokenizer {
public:
    virtual ~ITokenizer() = default;

    /**
     * @brief Encode a single sentence into token IDs.
     * @param text     Input text.
     * @param max_len  Maximum sequence length — pads or truncates.
     * @return Encoding with input_ids, attention_mask, token_type_ids.
     */
    [[nodiscard]] virtual Encoding encode(std::string_view text,
                                          size_t max_len = 128) const = 0;

    /**
     * @brief Encode a sentence pair (e.g. question + context for QA models).
     * Sentence A gets token_type_id=0, sentence B gets token_type_id=1.
     */
    [[nodiscard]] virtual Encoding encode_pair(std::string_view text_a,
                                               std::string_view text_b,
                                               size_t max_len = 256) const = 0;

    /** @brief Number of entries in the vocabulary. */
    [[nodiscard]] virtual size_t vocab_size() const noexcept = 0;

    /** @brief True if the vocabulary has been populated. */
    [[nodiscard]] virtual bool is_ready() const noexcept = 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// SimpleTokenizer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @class SimpleTokenizer
 * @brief Whitespace tokeniser with vocabulary lookup.
 *
 * Suitable for smoke-testing and cases where exact tokenisation is not
 * critical (e.g. entity extraction, simple classification heuristics).
 *
 * For production sentence embedding with `all-MiniLM-L6-v2` or similar,
 * replace with a WordPiece or BPE tokeniser whose vocabulary was exported
 * alongside the ONNX model.
 *
 * ### Special token IDs (BERT-base-uncased convention)
 *
 * These match the `all-MiniLM-L6-v2` vocabulary exactly.
 * Load the model's `vocab.txt` with `load_vocab()` to assign correct IDs
 * to all other tokens — each line's 0-based index is its token ID.
 *
 * | ID  | Token  |
 * |-----|--------|
 * |   0 | [PAD]  |
 * | 100 | [UNK]  |
 * | 101 | [CLS]  |
 * | 102 | [SEP]  |
 */
class SimpleTokenizer final : public ITokenizer {
public:
    static constexpr int64_t PAD_ID = 0;
    static constexpr int64_t UNK_ID = 100;
    static constexpr int64_t CLS_ID = 101;
    static constexpr int64_t SEP_ID = 102;

    SimpleTokenizer() = default;

    // ── Vocabulary management ─────────────────────────────────────────────────

    /** @brief Register a single token → id mapping. */
    void add_token(const std::string& token, int64_t id) {
        vocab_[token] = id;
    }

    /**
     * @brief Load vocabulary from a plain-text file.
     *
     * Format: one token per line. Line index (starting at 4) becomes the ID.
     * IDs 0-3 are reserved for [PAD], [UNK], [CLS], [SEP].
     *
     * @param vocab_path  Path to the vocabulary file.
     * @return true if at least one token was loaded.
     */
    bool load_vocab(const std::filesystem::path& vocab_path) {
        std::ifstream file(vocab_path);
        if (!file.is_open()) return false;

        vocab_.clear();
        std::string line;
        int64_t id = 0;  // line index IS the token ID in BERT vocab format
        while (std::getline(file, line)) {
            if (!line.empty()) {
                vocab_[line] = id++;
            }
        }
        return !vocab_.empty();
    }

    // ── ITokenizer impl ───────────────────────────────────────────────────────

    /**
     * @brief Encode a single sentence.
     *
     * Produces: [CLS] w1 w2 ... [SEP] [PAD]...
     */
    [[nodiscard]] Encoding encode(std::string_view text,
                                  size_t max_len = 128) const override {
        const auto tokens = split(text);
        return build_encoding(tokens, {}, max_len);
    }

    /**
     * @brief Encode a sentence pair.
     *
     * Produces: [CLS] a1 a2 ... [SEP] b1 b2 ... [SEP] [PAD]...
     * token_type_ids: 0 for sentence A (incl. [CLS]/[SEP]), 1 for sentence B.
     */
    [[nodiscard]] Encoding encode_pair(std::string_view text_a,
                                       std::string_view text_b,
                                       size_t max_len = 256) const override {
        const auto tokens_a = split(text_a);
        const auto tokens_b = split(text_b);
        return build_encoding(tokens_a, tokens_b, max_len);
    }

    [[nodiscard]] size_t vocab_size()  const noexcept override { return vocab_.size(); }
    [[nodiscard]] bool   is_ready()    const noexcept override { return !vocab_.empty(); }

private:
    std::unordered_map<std::string, int64_t> vocab_;

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** @brief Lowercase-whitespace split. */
    [[nodiscard]] std::vector<std::string> split(std::string_view text) const {
        std::vector<std::string> tokens;
        std::string token;
        for (unsigned char c : text) {
            if (std::isspace(c)) {
                if (!token.empty()) {
                    tokens.push_back(std::move(token));
                    token.clear();
                }
            } else {
                token += static_cast<char>(std::tolower(c));
            }
        }
        if (!token.empty()) tokens.push_back(std::move(token));
        return tokens;
    }

    [[nodiscard]] int64_t lookup(const std::string& token) const noexcept {
        auto it = vocab_.find(token);
        return it != vocab_.end() ? it->second : UNK_ID;
    }

    /**
     * @brief Core encoding logic for single or pair inputs.
     *
     * @param a        Tokens for sentence A.
     * @param b        Tokens for sentence B (empty = single sentence).
     * @param max_len  Total sequence length including special tokens.
     */
    [[nodiscard]] Encoding build_encoding(
            const std::vector<std::string>& a,
            const std::vector<std::string>& b,
            size_t max_len) const {

        std::vector<int64_t> ids;
        std::vector<int64_t> type_ids;
        ids.reserve(max_len);
        type_ids.reserve(max_len);

        // [CLS]
        ids.push_back(CLS_ID);
        type_ids.push_back(0);

        // Sentence A tokens
        const size_t reserve_b = b.empty() ? 1 : 2 + b.size();
        const size_t max_a     = max_len > 1 + reserve_b
                                 ? max_len - 1 - reserve_b
                                 : 0;
        for (size_t i = 0; i < a.size() && ids.size() < 1 + max_a; ++i) {
            ids.push_back(lookup(a[i]));
            type_ids.push_back(0);
        }

        // [SEP] after sentence A
        ids.push_back(SEP_ID);
        type_ids.push_back(0);

        // Sentence B tokens (optional)
        if (!b.empty()) {
            for (const auto& t : b) {
                if (ids.size() >= max_len - 1) break;
                ids.push_back(lookup(t));
                type_ids.push_back(1);
            }
            // [SEP] after sentence B
            ids.push_back(SEP_ID);
            type_ids.push_back(1);
        }

        const size_t real_len = ids.size();

        // Pad to max_len
        ids.resize(max_len, PAD_ID);
        type_ids.resize(max_len, 0);

        // Attention mask: 1 for real tokens, 0 for padding
        std::vector<int64_t> mask(max_len, 0);
        std::fill_n(mask.begin(), real_len, 1);

        return Encoding{
            std::move(ids),
            std::move(mask),
            std::move(type_ids),
            real_len
        };
    }
};

} // namespace pce::nlp::tokenizer
