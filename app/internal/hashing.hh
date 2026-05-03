#pragma once
/**
 * @file internal/hashing.hh
 * @brief FNV-1a hashing and document snippet helpers.
 *
 * @note Application-internal. Do not include from external headers.
 */

#include <algorithm>
#include <cstdint>
#include <format>
#include <string>
#include <string_view>

namespace pce::dms {

[[nodiscard]] constexpr uint64_t fnv1a_64(std::string_view s) noexcept {
    constexpr uint64_t kBasis = 14695981039346656037ULL;
    constexpr uint64_t kPrime = 1099511628211ULL;
    uint64_t h = kBasis;
    for (unsigned char c : s) { h ^= uint64_t{c}; h *= kPrime; }
    return h;
}

[[nodiscard]] inline std::string hash_hex(std::string_view s) {
    return std::format("{:016x}", fnv1a_64(s));
}

/** First @p max characters of @p content, trimming leading whitespace. */
[[nodiscard]] inline std::string make_snippet(std::string_view content,
                                               size_t max = 280) noexcept {
    const auto first = content.find_first_not_of(" \t\r\n");
    if (first == std::string_view::npos) return {};
    content = content.substr(first);
    if (content.size() <= max) return std::string{content};
    auto v = content.substr(0, max);
    if (const auto p = v.rfind(' '); p != std::string_view::npos) v = v.substr(0, p);
    return std::string{v} + "…";
}

/**
 * @brief Context window of ~@p ctx characters centred on the first occurrence
 *        of @p query in @p text.
 *
 * Falls back to @c make_snippet when the term is absent.
 */
[[nodiscard]] inline std::string make_context_snippet(std::string_view text,
                                                       std::string_view query,
                                                       size_t ctx = 100) noexcept {
    if (text.empty()) return {};
    if (query.empty()) return make_snippet(text);
    std::string tl{text}, ql{query};
    std::transform(tl.begin(), tl.end(), tl.begin(),
                   [](unsigned char c){ return (char)std::tolower(c); });
    std::transform(ql.begin(), ql.end(), ql.begin(),
                   [](unsigned char c){ return (char)std::tolower(c); });
    const auto pos = tl.find(ql);
    if (pos == std::string::npos) return make_snippet(text);
    const size_t start = pos > ctx ? pos - ctx : 0;
    const size_t end   = std::min(text.size(), pos + query.size() + ctx);
    std::string out = start > 0 ? "…" : "";
    out += std::string{text.substr(start, end - start)};
    if (end < text.size()) out += "…";
    return out;
}

} // namespace pce::dms

