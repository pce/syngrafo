#ifndef NLP_UNICODE_UTILS_HH
#define NLP_UNICODE_UTILS_HH

#include <string>
#include <string_view>
#include <vector>
#include <optional>
#include <algorithm>
#include <simdutf.h>

namespace pce::nlp::unicode {

/**
 * @class UnicodeUtils
 * @brief High-performance Unicode utility layer powered by simdutf.
 *
 * Provides UTF-8 validation, code point iteration, and basic script
 * classification while maintaining zero-copy performance where possible.
 */
class UnicodeUtils {
public:
    /**
     * @brief Validates if a string is well-formed UTF-8.
     * Uses SIMD-accelerated validation from simdutf.
     */
    static bool is_valid_utf8(std::string_view text) {
        return simdutf::validate_utf8(text.data(), text.size());
    }

    /**
     * @brief Returns the number of Unicode code points in a UTF-8 string.
     */
    static size_t count_code_points(std::string_view text) {
        return simdutf::count_utf8(text.data(), text.size());
    }

    /**
     * @brief Decodes UTF-8 into a vector of 32-bit code points.
     */
    static std::vector<char32_t> to_utf32(std::string_view text) {
        if (text.empty()) return {};

        std::vector<char32_t> result(count_code_points(text));
        size_t actual_len = simdutf::convert_utf8_to_utf32(text.data(), text.size(), result.data());
        if (actual_len < result.size()) result.resize(actual_len);
        return result;
    }

    /**
     * @brief Basic Script classification based on Unicode ranges.
     * This allows the tokenizer to dispatch to script-specific logic.
     */
    enum class Script {
        Common,
        Latin,
        Greek,
        Cyrillic,
        Han,      // Chinese
        Hiragana, // Japanese
        Katakana, // Japanese
        Hangul,   // Korean
        Unknown
    };

    /**
     * @brief Detects the primary script of a single code point.
     */
    static Script get_script(char32_t cp) {
        if (cp >= 0x0000 && cp <= 0x007F) return Script::Latin;
        if (cp >= 0x0080 && cp <= 0x024F) return Script::Latin; // Latin Extended
        if (cp >= 0x0370 && cp <= 0x03FF) return Script::Greek;
        if (cp >= 0x0400 && cp <= 0x04FF) return Script::Cyrillic;
        if (cp >= 0x3040 && cp <= 0x309F) return Script::Hiragana;
        if (cp >= 0x30A0 && cp <= 0x30FF) return Script::Katakana;
        if (cp >= 0x4E00 && cp <= 0x9FFF) return Script::Han;
        if (cp >= 0xAC00 && cp <= 0xD7AF) return Script::Hangul;
        return Script::Common;
    }

    /**
     * @brief Simple Unicode Case Folding (simplified for engine performance).
     * For full linguistic correctness, ICU is preferred, but this handles
     * most common cases for Greek and Cyrillic.
     */
    static char32_t to_lower(char32_t cp) {
        // ASCII fast path
        if (cp <= 0x7F) {
            if (cp >= 'A' && cp <= 'Z') return cp + 32;
            return cp;
        }

        // Greek: Α-Ω (0x0391-0x03A9) -> α-ω (0x03B1-0x03C9)
        if (cp >= 0x0391 && cp <= 0x03A9) return cp + 32;

        // Cyrillic: А-Я (0x0410-0x042F) -> а-я (0x0430-0x044F)
        if (cp >= 0x0410 && cp <= 0x042F) return cp + 32;

        return cp;
    }

    /**
     * @brief High-performance single-pass case folding.
     * Processes the entire buffer to minimize allocations.
     */
    static std::string fold_case(std::string_view text) {
        if (text.empty()) return "";

        // Pre-allocate UTF-32 buffer to avoid re-allocs
        std::vector<char32_t> u32(count_code_points(text));
        size_t actual_len = simdutf::convert_utf8_to_utf32(text.data(), text.size(), u32.data());
        if (actual_len < u32.size()) u32.resize(actual_len);

        bool changed = false;
        for (auto& cp : u32) {
            char32_t lowered = to_lower(cp);
            if (lowered != cp) {
                cp = lowered;
                changed = true;
            }
        }

        if (!changed) return std::string(text);

        // Convert back in one go
        std::string result;
        result.resize(u32.size() * 4); // Max possible UTF-8 size
        size_t actual_size = simdutf::convert_utf32_to_utf8(
            u32.data(), u32.size(), result.data());
        result.resize(actual_size);

        return result;
    }

    /**
     * @brief Safe Iterator for UTF-8 code points.
     */
    class CodePointIterator {
    public:
        CodePointIterator(std::string_view text) : text_(text), offset_(0) {
            fetch_next();
        }

        bool has_next() const { return offset_ < text_.size() || current_.has_value(); }

        char32_t next() {
            char32_t val = current_.value_or(0);
            fetch_next();
            return val;
        }

    private:
        void fetch_next() {
            if (offset_ >= text_.size()) {
                current_ = std::nullopt;
                return;
            }

            // Detect sequence length
            uint8_t first = static_cast<uint8_t>(text_[offset_]);
            size_t len = 0;
            if (first < 0x80) len = 1;
            else if ((first & 0xE0) == 0xC0) len = 2;
            else if ((first & 0xF0) == 0xE0) len = 3;
            else if ((first & 0xF8) == 0xF0) len = 4;
            else {
                // Invalid start byte, skip
                offset_++;
                fetch_next();
                return;
            }

            if (offset_ + len > text_.size()) {
                offset_ = text_.size();
                current_ = std::nullopt;
                return;
            }

            // Decode using simdutf for safety/speed
            char32_t cp = 0;
            size_t actual_len = simdutf::convert_utf8_to_utf32(text_.data() + offset_, len, &cp);
            if (actual_len > 0) {
                current_ = cp;
            } else {
                current_ = std::nullopt;
            }
            offset_ += len;
        }

        std::string_view text_;
        size_t offset_;
        std::optional<char32_t> current_;
    };

    /**
     * @brief Checks if a code point is a Unicode whitespace character.
     */
    static bool is_whitespace(char32_t cp) {
        return cp == ' ' || cp == '\t' || cp == '\n' || cp == '\r' ||
               cp == 0x00A0 || cp == 0x1680 || (cp >= 0x2000 && cp <= 0x200A) ||
               cp == 0x202F || cp == 0x205F || cp == 0x3000;
    }
};

} // namespace pce::nlp::unicode

#endif // NLP_UNICODE_UTILS_HH
