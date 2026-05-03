#pragma once
/**
 * @file internal/math.hh
 * @brief Vector arithmetic utilities.
 *
 * @note Application-internal. Do not include from external headers.
 */

#include <cmath>
#include <span>

namespace pce::dms {

/** Cosine similarity in [−1, 1]. Returns 0 for zero-length input. */
[[nodiscard]] inline float
cosine_similarity(std::span<const float> a, std::span<const float> b) noexcept {
    const size_t n = std::min(a.size(), b.size());
    if (!n) return 0.f;
    float dot{}, na{}, nb{};
    for (size_t i = 0; i < n; ++i) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
    const float d = std::sqrt(na) * std::sqrt(nb);
    return d > 1e-9f ? dot / d : 0.f;
}

} // namespace pce::dms

