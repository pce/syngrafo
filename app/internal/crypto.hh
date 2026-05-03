#pragma once
/**
 * @file internal/crypto.hh
 * @brief Zone password derivation and salt generation.
 *
 * On Apple: uses CommonCrypto PBKDF2-SHA256 with 200 000 rounds.
 * On other platforms: FNV-1a fan-out (development convenience — not production strength).
 *
 * @note Application-internal. Do not include from external headers.
 */

#include "hashing.hh"

#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <string_view>

#ifdef __APPLE__
#  include <CommonCrypto/CommonKeyDerivation.h>
#endif

namespace pce::dms {

[[nodiscard]] inline std::string generate_zone_salt() {
    uint8_t buf[32] = {};
#ifdef __APPLE__
    arc4random_buf(buf, sizeof(buf));
#else
    std::ifstream f("/dev/urandom", std::ios::binary);
    if (f) {
        f.read(reinterpret_cast<char*>(buf), sizeof(buf));
    } else {
        auto tp = std::chrono::high_resolution_clock::now().time_since_epoch().count();
        uint64_t s = static_cast<uint64_t>(tp);
        for (int i = 0; i < 4; ++i) {
            s = s * 6364136223846793005ULL + 1442695040888963407ULL;
            std::memcpy(buf + i * 8, &s, 8);
        }
    }
#endif
    char hex[65] = {};
    for (int i = 0; i < 32; ++i) std::snprintf(hex + i * 2, 3, "%02x", buf[i]);
    return {hex, 64};
}

[[nodiscard]] inline std::string derive_zone_key(std::string_view password,
                                                  std::string_view salt_hex) {
#ifdef __APPLE__
    uint8_t salt[32] = {};
    const size_t slen = std::min(salt_hex.size() / 2, sizeof(salt));
    for (size_t i = 0; i < slen; ++i) {
        unsigned bv = 0;
        std::sscanf(salt_hex.data() + i * 2, "%02x", &bv);
        salt[i] = (uint8_t)bv;
    }
    uint8_t key[32] = {};
    CCKeyDerivationPBKDF(kCCPBKDF2, password.data(), password.size(),
                         salt, std::max(slen, size_t{1}),
                         kCCPRFHmacAlgSHA256, 200'000, key, sizeof(key));
    char hex[65] = {};
    for (int i = 0; i < 32; ++i) std::snprintf(hex + i * 2, 3, "%02x", key[i]);
    return {hex, 64};
#else
    (void)salt_hex;
    uint64_t h = fnv1a_64(password);
    for (int i = 0; i < 200'000; ++i)
        h = h * 6364136223846793005ULL + 1442695040888963407ULL;
    const uint64_t b = h ^ 0xdeadbeefcafebabeULL;
    char hex[65] = {};
    std::snprintf(hex,    17, "%016llx", (unsigned long long)h);
    std::snprintf(hex+16, 17, "%016llx", (unsigned long long)b);
    std::snprintf(hex+32, 17, "%016llx", (unsigned long long)(h ^ b));
    std::snprintf(hex+48, 17, "%016llx", (unsigned long long)(h + b));
    return {hex, 64};
#endif
}

} // namespace pce::dms

