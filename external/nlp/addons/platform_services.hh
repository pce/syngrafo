#pragma once
/**
 * @file platform_services.hh
 * @brief Two distinct namespaces with clearly separated concerns.
 *
 * **`pce::nlp::backend`** — compile-time selected OCR engine.
 *   Implemented by exactly one of:
 *   - `ocr_addon_apple.mm`      when `NLP_APPLE_VISION` is defined
 *   - `ocr_addon_tesseract.cpp` when `NLP_WITH_TESSERACT` is defined
 *   - `platform_services_stub.cpp` otherwise (returns empty strings)
 *
 *   Apple platforms may use *either* backend: Vision is the default,
 *   but passing `-DNLP_APPLE_VISION=OFF` selects Tesseract instead.
 *
 * **`pce::nlp::platform`** — native OS services (file-manager reveal, document corners, EXIF).
 *   Platform implementations live in per-platform addon files; non-Apple functions are no-ops.
 */

#include <string>
#include <vector>

namespace pce::nlp {

struct Point2D {
    float x;
    float y;
};


namespace backend {
    /** Extract text from a single image file. */
    std::string extract_text(const std::string& input_path);
    /** Extract text from a PDF document (all pages). */
    std::string extract_text_from_pdf(const std::string& input_path);
} // namespace backend


namespace platform {
    /** Detect document corners (perspective correction). macOS / Apple Vision only. */
    std::vector<Point2D> detect_document_corners(const std::string& input_path);
    /** Warp an image to correct perspective. macOS / Apple Vision only. */
    bool rectify_image(const std::string& input_path,
                       const std::string& output_path,
                       const std::vector<Point2D>& corners);
    /** Reveal the file in the native file manager (Finder / Explorer / Nautilus). */
    bool reveal_in_file_manager(const std::string& path);
    /** Extract EXIF / image metadata as a compact JSON object. */
    std::string extract_exif(const std::string& input_path);
} // namespace platform

} // namespace pce::nlp
