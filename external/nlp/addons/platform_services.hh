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
 * **`pce::nlp::platform`** — macOS-specific OS services.
 *   Stubbed on non-Apple builds.  Not influenced by OCR backend flags.
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
    /** Reveal the file in Finder. macOS only; no-op on other platforms. */
    bool reveal_in_finder(const std::string& path);
    /** Extract EXIF / image metadata as a compact JSON object. */
    std::string extract_exif(const std::string& input_path);
} // namespace platform

} // namespace pce::nlp

