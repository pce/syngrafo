#pragma once

#include "nlp_addon_system.hh"
#include "onnx/onnx_service.hh"
#include "platform_services.hh"
#include <string>
#include <vector>
#include <memory>
#include <filesystem>
#include <print>
#include <cmath>
#include <algorithm>

#include "../3rdparty/stb_image.h"
#include "../3rdparty/stb_image_resize2.h"
#include "../3rdparty/stb_image_write.h"

namespace pce::nlp {

/**
 * @class RectifierAddon
 * @brief Uses ONNX models to detect document boundaries and rectify (unwarp) perspective.
 */
class RectifierAddon : public NLPAddon<RectifierAddon> {
public:
    RectifierAddon() = default;
    virtual ~RectifierAddon() = default;

    [[nodiscard]] const std::string& name_impl() const { return name_; }
    [[nodiscard]] const std::string& version_impl() const { return version_; }

    bool init_impl() {
        // Initialization logic for the rectifier
        return true;
    }

    [[nodiscard]] bool is_ready_impl() const { return ready_ && onnx_ && onnx_->is_loaded(); }

    AddonResponse process_impl(const json&, const json&, std::shared_ptr<AddonContext>) {
        AddonResponse res;
        res.success = false;
        res.error_message = "RectifierAddon does not support generic process()";
        return res;
    }

    void process_stream_impl(const json&, const std::function<void(const std::string&, bool)>&, const json&, const std::shared_ptr<AddonContext>&) {
    }

    void set_onnx(std::shared_ptr<onnx::IOnnxService> svc) {
        onnx_ = std::move(svc);
        ready_ = (onnx_ != nullptr);
    }

    /**
     * @brief Rectifies a document image.
     *
     * @param input_path  Path to the source image.
     * @param output_path Path to save the rectified image.
     * @return true if successful.
     *
     * Strategy:
     *   1. Platform-native corner detection (Apple Vision on macOS; stub elsewhere).
     *   2. ONNX segmentation model fallback — only attempted when `onnx_` is set and loaded.
     *   3. Manual C++ perspective warp once corners are known.
     */
    bool rectify(const std::string& input_path, const std::string& output_path) {
        auto corners = platform::detect_document_corners(input_path);

        if (corners.empty()) {
            // No platform corners — require a loaded ONNX segmentation model.
            if (!onnx_ || !onnx_->is_loaded()) return false;

            int w, h, c;
            unsigned char* data = stbi_load(input_path.c_str(), &w, &h, &c, 3);
            if (!data) return false;

            std::vector<float> tensor(640 * 640 * 3);
            stbir_resize_uint8_linear(data, w, h, 0, (unsigned char*)tensor.data(), 640, 640, 0, (stbir_pixel_layout)STBIR_RGB);
            stbi_image_free(data);

            for (float& v : tensor) v /= 255.0f;

            auto result = onnx_->infer_raw(tensor, {1, 640, 640, 3});
            corners = parse_onnx_corners(result);

            if (corners.empty()) return false;
        }

        if (platform::rectify_image(input_path, output_path, corners))
            return true;

        return rectify_manual(input_path, output_path, corners);
    }

private:
    std::string name_ = "rectifier_engine";
    std::string version_ = "1.0.0";
    bool ready_ = false;
    std::shared_ptr<onnx::IOnnxService> onnx_;

    /**
     * @brief Parses the output of a segmentation model into 4 corners.
     * Expects model to output coordinates or heatmaps.
     */
    std::vector<Point2D> parse_onnx_corners(const inference::InferenceResult& result) {
        if (!result.success || result.outputs.empty()) return {};

        // This is a placeholder for actual model-specific parsing logic.
        // Assuming the model returns 8 floats (4 x,y pairs) in normalized coordinates.
        const auto& output = result.outputs[0];
        if (output.size() < 8) return {};

        return {
            {output[0], output[1]}, // TL
            {output[2], output[3]}, // TR
            {output[4], output[5]}, // BR
            {output[6], output[7]}  // BL
        };
    }

    /**
     * @brief Manual C++ implementation of perspective warp and high-quality filter.
     * Used as fallback on non-Apple platforms or when CoreImage fails.
     */
    bool rectify_manual(const std::string& input_path, const std::string& output_path, const std::vector<Point2D>& corners) {
        int src_w, src_h, src_c;
        unsigned char* src_data = stbi_load(input_path.c_str(), &src_w, &src_h, &src_c, 3);
        if (!src_data) return false;

        // Estimate target dimensions based on corner distances
        float top_w = std::hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y) * src_w;
        float bot_w = std::hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y) * src_w;
        int dst_w = static_cast<int>(std::max(top_w, bot_w));

        float left_h = std::hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y) * src_h;
        float right_h = std::hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y) * src_h;
        int dst_h = static_cast<int>(std::max(left_h, right_h));

        std::vector<unsigned char> dst_data(dst_w * dst_h * 1); // Grayscale output

        // Apply perspective warp + Grayscale conversion + Adaptive Thresholding
        for (int y = 0; y < dst_h; ++y) {
            for (int x = 0; x < dst_w; ++x) {
                float u = (float)x / dst_w;
                float v = (float)y / dst_h;

                // Bilinear unwarping
                float src_x = (corners[0].x * (1 - u) * (1 - v) +
                             corners[1].x * u * (1 - v) +
                             corners[2].x * u * v +
                             corners[3].x * (1 - u) * v) * src_w;

                float src_y = (corners[0].y * (1 - u) * (1 - v) +
                             corners[1].y * u * (1 - v) +
                             corners[2].y * u * v +
                             corners[3].y * (1 - u) * v) * src_h;

                int ix = std::clamp((int)src_x, 0, src_w - 1);
                int iy = std::clamp((int)src_y, 0, src_h - 1);

                // Simple grayscale: 0.299R + 0.587G + 0.114B
                unsigned char* p = &src_data[(iy * src_w + ix) * 3];
                dst_data[y * dst_w + x] = (unsigned char)(0.299f * p[0] + 0.587f * p[1] + 0.114f * p[2]);
            }
        }

        // Apply basic threshold for "High Quality Scan" effect (B&W)
        // In a real implementation, we would use a sliding window mean here.
        for (int i = 0; i < dst_w * dst_h; ++i) {
            dst_data[i] = (dst_data[i] > 127) ? 255 : 0;
        }

        bool ok = stbi_write_jpg(output_path.c_str(), dst_w, dst_h, 1, dst_data.data(), 90) != 0;
        stbi_image_free(src_data);
        return ok;
    }
};

} // namespace pce::nlp

