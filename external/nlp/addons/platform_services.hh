#pragma once
#include <string>
#include <vector>

namespace pce::nlp {

struct Point2D {
    float x;
    float y;
};

/**
 * @brief Platform-agnostic interface for hardware-accelerated document operations.
 * These are implemented in .mm files on Apple and can be implemented elsewhere later.
 */
namespace platform {
    std::vector<Point2D> detect_document_corners(const std::string& input_path);
    bool rectify_image(const std::string& input_path, const std::string& output_path, const std::vector<Point2D>& corners);
    std::string extract_text(const std::string& input_path);
    /// Extract EXIF / image metadata as a compact JSON object.
    /// Returns "{}" when no metadata is available or path is not an image.
    std::string extract_exif(const std::string& input_path);
}

} // namespace pce::nlp

