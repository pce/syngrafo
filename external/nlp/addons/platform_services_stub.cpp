#include "platform_services.hh"

// Non-Apple stubs for platform services that have no implementation outside macOS.
// OCR (extract_text / extract_text_from_pdf) is provided by ocr_addon_tesseract.cpp
// when NLP_WITH_TESSERACT is defined; stubs below cover the no-Tesseract build.

namespace pce::nlp::platform {

std::vector<Point2D> detect_document_corners(const std::string& /*input_path*/) { return {}; }

bool rectify_image(const std::string& /*input_path*/,
                   const std::string& /*output_path*/,
                   const std::vector<Point2D>& /*corners*/) { return false; }

bool reveal_in_finder(const std::string& /*path*/) { return false; }

std::string extract_exif(const std::string& /*input_path*/) { return "{}"; }

} // namespace pce::nlp::platform

// OCR backend stubs — only compiled when no backend is selected.
#if !defined(NLP_APPLE_VISION) && !defined(NLP_WITH_TESSERACT)
namespace pce::nlp::backend {

std::string extract_text(const std::string& /*input_path*/) { return ""; }

std::string extract_text_from_pdf(const std::string& input_path) {
    return extract_text(input_path);
}

} // namespace pce::nlp::backend
#endif
