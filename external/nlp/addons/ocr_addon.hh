//
// Created by Patrick Engel on 03.04.26.
//

#ifndef OCR_ADDON_H
#define OCR_ADDON_H

#pragma once

#include "../nlp_addon_system.hh"
#include "platform_services.hh"
#include <string>
#include <unordered_map>
#include <functional>
#include <memory>

namespace pce::nlp {

/**
 * @class OCRAddon
 * @brief Optical Character Recognition engine for extracting text from images.
 *
 * On Apple platforms: delegates to Apple Vision framework (ocr_addon_apple.mm).
 * On Linux/Windows:   delegates to Tesseract (ocr_addon_tesseract.cpp) when
 *                     available; returns an informative error string otherwise.
 */
class OCRAddon : public NLPAddon<OCRAddon> {
public:
    OCRAddon() = default;
    virtual ~OCRAddon() = default;

    const std::string& name_impl()    const { return name_; }
    const std::string& version_impl() const { return version_; }

    bool init_impl() {
        ready_ = true;
        return true;
    }

    bool is_ready_impl() const { return ready_; }

    /**
     * @brief Extract text from an image file.
     *
     * Calls the platform-specific implementation (Apple Vision / Tesseract).
     * Returns the extracted UTF-8 text, or a "[OCR error: …]" string on failure.
     */
    std::string extract_text(const std::string& input) {
        if (!ready_) return "";
        return platform::extract_text(input);
    }

    bool initialize() { return init_impl(); }

    AddonResponse process_impl(const std::string& input,
                               const std::unordered_map<std::string, std::string>& options,
                               std::shared_ptr<AddonContext> context = nullptr) {
        if (!ready_) return {"", false, "OCR engine not initialized", {}};

        const std::string method = options.contains("method") ? options.at("method") : "ocr";
        if (method == "ocr") {
            std::string text = extract_text(input);
            const bool ok    = !text.empty() && !text.starts_with("[OCR error");
            return {text, ok, ok ? "" : text, {}};
        }

        return {"", false, "Unknown OCR method", {}};
    }

    void process_stream_impl(const std::string& input,
                             std::function<void(const std::string& chunk, bool is_final)> callback,
                             const std::unordered_map<std::string, std::string>& options,
                             std::shared_ptr<AddonContext> context = nullptr) {
        AddonResponse resp = process_impl(input, options, context);
        callback(resp.output, true);
    }

private:
    std::string name_    = "ocr_engine";
    std::string version_ = "1.1.0";
    bool        ready_   = false;
};

} // namespace pce::nlp

#endif // OCR_ADDON_H

