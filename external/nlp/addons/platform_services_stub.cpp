#include "platform_services.hh"

namespace pce::nlp::platform {

/**
 * @brief Default/Stub implementations for platforms without hardware-accelerated document services.
 * These return empty/false values, which triggers the ONNX fallbacks in the high-level Addon logic.
 */

std::vector<Point2D> detect_document_corners(const std::string& /*input_path*/) {
    return {};
}

bool rectify_image(const std::string& /*input_path*/, const std::string& /*output_path*/, const std::vector<Point2D>& /*corners*/) {
    return false;
}

// extract_text is provided by ocr_addon_tesseract.cpp when NLP_WITH_TESSERACT is defined.
// This stub covers the case where CMake could not find Tesseract.
#ifndef NLP_WITH_TESSERACT
std::string extract_text(const std::string& /*input_path*/) {
    return "";
}
#endif

std::string extract_exif(const std::string& /*input_path*/) {
    return "{}";
}

} // namespace pce::nlp::platform

