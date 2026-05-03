/**
 * @file ocr_addon.hh
 * @brief OCRAddon — thin NLP addon wrapper over the compile-time OCR backend.
 *
 * Delegates to `pce::nlp::backend::extract_text` which is resolved at link time
 * to either Apple Vision (`ocr_addon_apple.mm`) or Tesseract (`ocr_addon_tesseract.cpp`).
 */

#pragma once

#include "../nlp_addon_system.hh"
#include "platform_services.hh"
#include <functional>
#include <memory>
#include <string>
#include <unordered_map>

namespace pce::nlp {

/**
 * @class OCRAddon
 * @brief Optical Character Recognition addon; backend selected at compile time.
 *
 * - Apple default: Apple Vision (`NLP_APPLE_VISION`)
 * - Cross-platform / Apple fallback: libtesseract (`NLP_WITH_TESSERACT`)
 */
class OCRAddon : public NLPAddon<OCRAddon> {
public:
    OCRAddon() = default;
    virtual ~OCRAddon() = default;

    const std::string& name_impl()    const { return name_; }
    const std::string& version_impl() const { return version_; }

    bool init_impl()        { ready_ = true; return true; }
    bool is_ready_impl() const { return ready_; }
    bool initialize()        { return init_impl(); }

    std::string extract_text(const std::string& input) {
        if (!ready_) return "";
        return backend::extract_text(input);
    }

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
        callback(process_impl(input, options, context).output, true);
    }

private:
    std::string name_    = "ocr_engine";
    std::string version_ = "1.1.0";
    bool        ready_   = false;
};

} // namespace pce::nlp

