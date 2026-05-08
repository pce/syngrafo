/**
 * @file ocr_addon_stub.cpp
 * @brief No-op OCR backend — compiled when no real OCR backend is selected
 *        (neither Apple Vision, Tesseract, nor ONNX PP-OCRv4).
 *
 * This file provides the link-time definitions of pce::nlp::backend::extract_text
 * and pce::nlp::backend::extract_text_from_pdf that the rest of the engine expects.
 * It is chosen by CMakeLists.txt as a last resort and must never be compiled
 * alongside a real OCR backend — that would produce LNK2005 / ODR violations.
 *
 * No preprocessor guards are needed here: selection is done entirely in CMakeLists.
 */

#include "platform_services.hh"

namespace pce::nlp::backend {

std::string extract_text(const std::string& /*input_path*/) { return ""; }

std::string extract_text_from_pdf(const std::string& input_path) {
    return extract_text(input_path);
}

} // namespace pce::nlp::backend
