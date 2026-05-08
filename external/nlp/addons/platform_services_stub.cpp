/**
 * @file platform_services_stub.cpp
 * @brief No-op stubs for @c pce::nlp::platform functions on platforms that
 *        have no dedicated implementation (not Apple, not Windows, not UNIX).
 *
 * This file only covers the platform-services interface (file-manager reveal,
 * document rectification, EXIF extraction).  OCR backend stubs live in
 * @c ocr_addon_stub.cpp and are compiled independently by CMakeLists.
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
