//
// Created by Patrick Engel on 03.04.26.
//

#ifndef OCR_ADDON_H
#define OCR_ADDON_H

#pragma once

#include "../nlp_addon_system.hh"
#include "platform_services.hh"
#include <string>
#include <vector>
#include <unordered_map>
#include <functional>
#include <memory>

#include "3rdparty/stb_image.h"
#include "3rdparty/stb_image_resize2.h"

namespace pce::nlp {

/**
 * @class OCRAddon
 * @brief Optical Character Recognition engine for extracting text from images.
 */
class OCRAddon : public NLPAddon<OCRAddon> {
public:
    OCRAddon() = default;
    virtual ~OCRAddon() = default;

    const std::string& name_impl() const { return name_; }
    const std::string& version_impl() const { return version_; }

    bool init_impl() {
        // Vision is always available on modern macOS
        ready_ = true;
        return true;
    }

    bool is_ready_impl() const { return ready_; }

    /**
     * @brief Process OCR requests using Apple Vision on macOS or ONNX on other platforms.
     * @param input Path to the image file.
     */
    std::string extract_text(const std::string& input) {
        if (!ready_) return "";

        std::string result = platform::extract_text(input);
        if (!result.empty() && !result.starts_with("[Error:")) {
            return result;
        }

        if (!onnx_ || !onnx_->is_loaded()) {
            return result.empty() ? "[OCR error: ONNX service not available]" : result;
        }

        int width, height, channels;
        unsigned char* img = stbi_load(input.c_str(), &width, &height, &channels, 3); // Load as RGB
        if (!img) return "[OCR error: failed to load image " + input + "]";

        // PP-OCR recognition models usually expect 32x[Fixed or Dynamic Width]
        const int target_h = 32;
        const int target_w = 320; // Example fixed width for simplicity, or scale proportionally
        std::vector<float> resized(target_w * target_h * 3);

        stbir_resize_uint8_linear(img, width, height, 0, (unsigned char*)resized.data(), target_w, target_h, 0, (stbir_pixel_layout)STBIR_RGB);
        stbi_image_free(img);

        // Normalize and convert to float HWC -> CHW
        std::vector<float> tensor_data(3 * target_h * target_w);
        for (int c = 0; c < 3; ++c) {
            for (int h = 0; h < target_h; ++h) {
                for (int w = 0; h < target_w; ++w) {
                    // Simple [0, 1] normalization. PP-OCR might need mean/std.
                    tensor_data[c * target_h * target_w + h * target_w + w] =
                        ((unsigned char*)resized.data())[(h * target_w + w) * 3 + c] / 255.0f;
                }
            }
        }

        auto raw = onnx_->infer_raw(tensor_data, {1, 3, target_h, target_w});
        if (!raw.success) return "[OCR error: " + raw.error + "]";

        // CTC Decode PP-OCR recognition output
        const auto* logits = raw.get("softmax_0.tmp_0"); // Example output name for PP-OCR recognition
        if (!logits) return "[OCR error: model output not found]";

        // Simple Greedy CTC Decoder
        // std::string result;
        const auto& vocab = onnx_->ocr_vocab();
        int prev_idx = -1;
        int time_steps = target_w / 4; // Simplified, depends on model stride
        int num_classes = vocab.size();

        for (int t = 0; t < time_steps; ++t) {
            int max_idx = 0;
            float max_val = -1e9;
            for (int i = 0; i < num_classes; ++i) {
                float val = (*logits)[t * num_classes + i];
                if (val > max_val) {
                    max_val = val;
                    max_idx = i;
                }
            }
            if (max_idx > 0 && max_idx != prev_idx && max_idx < (int)vocab.size()) {
                result += vocab[max_idx];
            }
            prev_idx = max_idx;
        }

        return result;
    }

    void set_onnx(std::shared_ptr<onnx::IOnnxService> svc) {
        onnx_ = std::move(svc);
    }

    bool initialize() { return init_impl(); }

    AddonResponse process_impl(const std::string& input,
                               const std::unordered_map<std::string, std::string>& options,
                               std::shared_ptr<AddonContext> context = nullptr) {
        if (!ready_) return {"", false, "OCR engine not initialized", {}};

        std::string method = options.contains("method") ? options.at("method") : "ocr";

        if (method == "ocr") {
            std::string text = extract_text(input);
            return {text, !text.empty(), text.empty() ? "OCR failed or image empty" : "", {}};
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
    std::string name_ = "ocr_engine";
    std::string version_ = "1.0.0";
    bool ready_ = false;
    std::shared_ptr<onnx::IOnnxService> onnx_;
};

} // namespace pce::nlp

#endif // OCR_ADDON_H

