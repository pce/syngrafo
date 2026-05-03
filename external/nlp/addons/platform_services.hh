#pragma once
#include <string>
#include <vector>

namespace pce::nlp {

struct Point2D {
    float x;
    float y;
};

/**
 * Platform-specific document services.
 * OCR backend is selected at compile time:
 *   NLP_APPLE_VISION defined → Apple Vision (macOS default)
 *   NLP_WITH_TESSERACT defined → libtesseract (non-Apple, or Apple with NLP_APPLE_VISION=OFF)
 */
namespace platform {
    std::vector<Point2D> detect_document_corners(const std::string& input_path);
    bool rectify_image(const std::string& input_path, const std::string& output_path, const std::vector<Point2D>& corners);
    std::string extract_text(const std::string& input_path);
    /// Extract text from a PDF document (all pages).
    std::string extract_text_from_pdf(const std::string& input_path);
    /// Reveal the file in the native file manager (Finder on macOS).
    bool reveal_in_finder(const std::string& path);
    /// Extract EXIF / image metadata as a compact JSON object.
    std::string extract_exif(const std::string& input_path);
}

} // namespace pce::nlp

