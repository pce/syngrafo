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
    /// Extract text from a PDF document (all pages).
    /// macOS:        PDFKit for native embedded text; Vision AI per-page OCR for scanned PDFs.
    /// Linux/Windows: forwards to extract_text() — Tesseract/Leptonica handles the file
    ///               (first page via Ghostscript if installed; may return empty otherwise).
    /// Returns UTF-8 text, or empty string on failure.
    std::string extract_text_from_pdf(const std::string& input_path);
    /// Reveal the file in the native file manager (Finder on macOS).
    /// macOS: uses NSWorkspace.shared.activateFileViewerSelectingURLs.
    /// Returns true on success, false if not supported on this platform.
    bool reveal_in_finder(const std::string& path);
    /// Extract EXIF / image metadata as a compact JSON object.
    /// Returns "{}" when no metadata is available or path is not an image.
    std::string extract_exif(const std::string& input_path);
}

} // namespace pce::nlp

