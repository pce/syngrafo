/**
 * @file image_decode_generic.cc
 * @brief stb_image fallback backend for decode_image_to_rgba().
 *
 * Supports JPEG, PNG, BMP, TGA, GIF, HDR, PIC, PNM.
 * WebP / HEIC are NOT supported on non-Apple platforms via this backend.
 */

#include "image_decode.hh"

// stb_image — declaration only (implementation lives in nlp_engine.cpp).
#include "nlp/3rdparty/stb_image.h"

#include <format>

namespace pce {

RGBAImage decode_image_to_rgba(const std::string& path) {
    RGBAImage result;

    int w = 0, h = 0, channels = 0;
    stbi_uc* data = stbi_load(path.c_str(), &w, &h, &channels, 4);
    if (!data) {
        const char* reason = stbi_failure_reason();
        result.error = std::format("Failed to load '{}': {}",
                                   path,
                                   reason ? reason : "unknown error");
        return result;
    }

    result.width  = w;
    result.height = h;
    result.pixels.assign(data, data + static_cast<std::size_t>(w) * h * 4);
    stbi_image_free(data);
    result.ok = true;
    return result;
}

} // namespace pce
