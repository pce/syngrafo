#pragma once
/**
 * @file image_decode.hh
 * @brief Cross-platform raster image → RGBA8888 decoder.
 *
 * Platform backends:
 *   Apple  – ImageIO / CoreGraphics (image_decode_apple.mm)
 *             Supports: JPEG, PNG, BMP, GIF, TGA, WebP, HEIC/HEIF, AVIF,
 *                       and any format the OS Image I/O framework handles.
 *   Other  – stb_image (image_decode_generic.cc)
 *             Supports: JPEG, PNG, BMP, TGA, GIF, HDR, PIC, PNM.
 */

#include <cstdint>
#include <string>
#include <vector>

namespace pce {

struct RGBAImage {
    /// Flat RGBA8888 pixel buffer, row-major, width*height*4 bytes.
    /// Pixels are laid out as [R0,G0,B0,A0, R1,G1,B1,A1, ...].
    std::vector<uint8_t> pixels;
    int  width  = 0;
    int  height = 0;
    bool ok     = false;
    std::string error;  ///< Non-empty when ok == false.
};

/**
 * Decode any supported raster image file to a flat RGBA8888 pixel buffer.
 *
 * @param path  Absolute or relative path to the image file.
 * @returns     RGBAImage with ok=true on success, ok=false + error on failure.
 */
RGBAImage decode_image_to_rgba(const std::string& path);

} // namespace pce
