#pragma once
/**
 * @file internal/encoding.hh
 * @brief Base-64 encode / decode. Zero-copy via std::span; derived overload
 *        accepts any contiguous byte range (std::string, std::string_view,
 *        std::vector<uint8_t>, std::span<const char>, …).
 */
#include <concepts>
#include <cstddef>
#include <cstdint>
#include <ranges>
#include <span>
#include <string>
#include <string_view>

namespace pce::encoding {

[[nodiscard]] inline std::string base64_encode(std::span<const std::byte> in)
{
    static constexpr std::string_view kAlpha =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((in.size() + 2u) / 3u) * 4u);
    for (std::size_t i = 0; i < in.size(); i += 3) {
        const uint32_t b0 = std::to_integer<uint32_t>(in[i]);
        const uint32_t b1 = (i + 1 < in.size()) ? std::to_integer<uint32_t>(in[i + 1]) : 0u;
        const uint32_t b2 = (i + 2 < in.size()) ? std::to_integer<uint32_t>(in[i + 2]) : 0u;
        const uint32_t w  = (b0 << 16) | (b1 << 8) | b2;
        out += kAlpha[(w >> 18) & 0x3Fu];
        out += kAlpha[(w >> 12) & 0x3Fu];
        out += (i + 1 < in.size()) ? kAlpha[(w >> 6) & 0x3Fu] : '=';
        out += (i + 2 < in.size()) ? kAlpha[ w       & 0x3Fu] : '=';
    }
    return out;
}

template <std::ranges::contiguous_range R>
    requires (sizeof(std::ranges::range_value_t<R>) == 1)
[[nodiscard]] std::string base64_encode(const R& r)
{
    return base64_encode(std::span<const std::byte>(
        reinterpret_cast<const std::byte*>(std::ranges::data(r)),
        std::ranges::size(r)));
}

[[nodiscard]] inline std::string base64_decode(std::string_view b64)
{
    static constexpr int8_t kDec[256] = {
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, //   0
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, //  16
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,62,-1,-1,-1,63, //  32  (+/)
        52,53,54,55,56,57,58,59,60,61,-1,-1,-1,-1,-1,-1, //  48  (0-9)
        -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13,14, //  64  (A-O)
        15,16,17,18,19,20,21,22,23,24,25,-1,-1,-1,-1,-1, //  80  (P-Z)
        -1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40, //  96  (a-o)
        41,42,43,44,45,46,47,48,49,50,51,-1,-1,-1,-1,-1, // 112  (p-z)
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, // 128
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, // 144
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, // 160
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, // 176
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, // 192
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, // 208
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, // 224
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1, // 240
    };
    std::string out;
    out.reserve(b64.size() * 3 / 4 + 3);
    int buf = 0, bits = 0;
    for (const unsigned char c : b64) {
        if (c == '=') break;
        const int v = kDec[c];
        if (v < 0) continue;
        buf = (buf << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<char>((buf >> bits) & 0xFF));
        }
    }
    return out;
}

} // namespace pce::encoding
