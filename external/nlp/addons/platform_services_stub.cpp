/**
 * @file platform_services_stub.cpp
 * @brief No-op stubs for all @c pce::nlp::platform functions and (when no OCR
 *        backend is selected) @c pce::nlp::backend.
 *
 * Compiled on platforms not covered by a dedicated implementation file.
 * @c ocr_addon_tesseract.cpp provides the real OCR backend when
 * @c NLP_WITH_TESSERACT is defined.
 */
#include "platform_services.hh"

namespace pce::nlp::platform {

std::vector<Point2D> detect_document_corners(const std::string& /*input_path*/) { return {}; }

bool rectify_image(const std::string& /*input_path*/,
                   const std::string& /*output_path*/,
                   const std::vector<Point2D>& /*corners*/) { return false; }

bool reveal_in_file_manager(const std::string& /*path*/) { return false; }

std::string extract_exif(const std::string& /*input_path*/) { return "{}"; }

} // namespace pce::nlp::platform

// OCR backend stubs — active when neither NLP_APPLE_VISION nor NLP_WITH_TESSERACT is defined.
#if !defined(NLP_APPLE_VISION) && !defined(NLP_WITH_TESSERACT)
namespace pce::nlp::backend {

std::string extract_text(const std::string& /*input_path*/) { return ""; }

std::string extract_text_from_pdf(const std::string& input_path) {
    return extract_text(input_path);
}

} // namespace pce::nlp::backend
#endif
