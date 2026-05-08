/**
 * @file ocr_addon_onnx.cpp
 * @brief ONNX OCR backend using the PP-OCRv4 server recognition model.
 *
 * Compiled when @c NLP_ONNX_OCR is defined — set by CMake when ONNX Runtime
 * is available and neither Apple Vision nor Tesseract was found.
 *
 * Implements pce::nlp::backend::extract_text() and extract_text_from_pdf()
 * declared in platform_services.hh.
 *
 * Pipeline per image:
 *   1. Load RGBA with stb_image.
 *   2. Convert to grayscale; detect text-line bands via horizontal projection.
 *   3. For each band: resize RGBA crop to height=48 with stb_image_resize2.
 *   4. Convert to float NCHW tensor [1, 3, 48, W]; run ocr_rec.onnx.
 *   5. CTC-greedy decode output [1, T, C] / [T, 1, C] against ocr_keys.txt vocab.
 *   6. Join line results with "\n".
 *
 * Model:  PP-OCRv4 server rec  →  ocr_rec.onnx
 * Vocab:  ppocr_keys_v1.txt    →  ocr_keys.txt  (one token per line; file starts
 *         at class 1 because class 0 is the CTC blank, which is implicit)
 */

#ifdef NLP_ONNX_OCR

#include "platform_services.hh"

#include <onnxruntime_cxx_api.h>

#include "../3rdparty/stb_image.h"
#include "../3rdparty/stb_image_resize2.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace pce::nlp::backend {

namespace {

// ─────────────────────────────────────────────────────────────────────────────
// Model-directory resolution
// ─────────────────────────────────────────────────────────────────────────────

/// Walk the three candidate locations and return the first that exists.
/// Search order:
///   1. @c NLP_MODEL_DIR environment variable
///   2. @c <source_dir>/../../../data/models/  (dev layout, relative to __FILE__)
///   3. @c <current_path>/data/models/         (sibling of the running executable)
std::optional<std::filesystem::path> find_model_dir() {
    namespace fs = std::filesystem;

    // 1. Explicit environment override.
    if (const char* env = std::getenv("NLP_MODEL_DIR")) {
        const fs::path p{env};
        if (fs::exists(p)) return p;
    }

    // 2. Dev layout: this file lives in .../external/nlp/addons/
    //    so three levels up lands at the project root; data/models/ hangs there.
    {
        const fs::path src_dir    = fs::path(__FILE__).parent_path();  // addons/
        const fs::path dev_layout = src_dir / ".." / ".." / ".." / "data" / "models";
        if (fs::exists(dev_layout)) {
            std::error_code ec;
            auto canonical = fs::canonical(dev_layout, ec);
            return ec ? dev_layout : canonical;
        }
    }

    // 3. Sibling next to the executable (use current_path as a reasonable proxy).
    {
        const fs::path exe_adjacent = fs::current_path() / "data" / "models";
        if (fs::exists(exe_adjacent)) return exe_adjacent;
    }

    return std::nullopt;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary loading
// ─────────────────────────────────────────────────────────────────────────────

/// Load a ppocr_keys_v1.txt-style character list — one token per line.
///
/// The returned vector is 0-indexed, but maps to model output class 1 and above:
///   vocab[i]  →  model class i+1   (class 0 is the CTC blank, absent from the file)
///
/// Returns an empty vector if the file cannot be opened.
std::vector<std::string> load_vocab(const std::filesystem::path& path) {
    std::vector<std::string> vocab;
    std::ifstream file{path};
    if (!file.is_open()) return vocab;

    std::string line;
    while (std::getline(file, line)) {
        // Strip trailing CR so Windows-edited files work on POSIX.
        if (!line.empty() && line.back() == '\r') line.pop_back();
        vocab.push_back(std::move(line));
    }
    return vocab;
}

// ─────────────────────────────────────────────────────────────────────────────
// ORT session
// ─────────────────────────────────────────────────────────────────────────────

struct OcrSession {
    Ort::Env                      env{ORT_LOGGING_LEVEL_WARNING, "pce_ocr"};
    Ort::SessionOptions           opts;
    std::unique_ptr<Ort::Session> session;
    std::vector<std::string>      vocab;  ///< vocab[i] maps to model output class i+1
    bool                          ready = false;
};

/// Return the singleton OCR session (initialised exactly once, thread-safe).
/// The returned pointer is always non-null; check @c ready before using.
OcrSession* get_ocr_session() {
    static OcrSession     s_storage;
    static std::once_flag s_once;

    std::call_once(s_once, [&]() {
        s_storage.opts.SetIntraOpNumThreads(2);
        s_storage.opts.SetInterOpNumThreads(1);
        s_storage.opts.SetGraphOptimizationLevel(ORT_ENABLE_EXTENDED);

        const auto model_dir = find_model_dir();
        if (!model_dir) return;

        // Prefer the lightweight mobile model; fall back to the server model if
        // only that one has been downloaded (--models ocr_full).
        const std::filesystem::path mobile_path = *model_dir / "ocr_rec.onnx";
        const std::filesystem::path server_path = *model_dir / "ocr_rec_server.onnx";
        const std::filesystem::path model_path =
            std::filesystem::exists(mobile_path) ? mobile_path : server_path;
        const std::filesystem::path vocab_path = *model_dir / "ocr_keys.txt";

        if (!std::filesystem::exists(model_path)) return;

        try {
#ifdef _WIN32
            const std::wstring wpath = model_path.wstring();
            s_storage.session = std::make_unique<Ort::Session>(
                s_storage.env, wpath.c_str(), s_storage.opts);
#else
            s_storage.session = std::make_unique<Ort::Session>(
                s_storage.env, model_path.c_str(), s_storage.opts);
#endif
            if (std::filesystem::exists(vocab_path))
                s_storage.vocab = load_vocab(vocab_path);

            s_storage.ready = true;
        } catch (const Ort::Exception&) {
            // ready stays false; caller will emit a diagnostic string.
        }
    });

    return &s_storage;
}

// ─────────────────────────────────────────────────────────────────────────────
// CTC greedy decode
// ─────────────────────────────────────────────────────────────────────────────

/// Greedy CTC decode over a flat logit buffer.
///
/// Expected memory layout: T contiguous rows of C floats each.  Both
/// PP-OCRv4 output shapes ([1, T, C] and [T, 1, C]) produce the identical
/// in-memory stride (the middle dimension is 1 in both cases), so the
/// same `logits + t * C` addressing works for either.
///
/// @param logits  Pointer to the raw float tensor data.
/// @param T       Number of time steps.
/// @param C       Total class count (class 0 = CTC blank, classes 1..N = chars).
/// @param vocab   Character table where vocab[i] corresponds to class i+1.
std::string ctc_decode(const float*                     logits,
                       const int64_t                    T,
                       const int64_t                    C,
                       const std::vector<std::string>&  vocab) {
    std::string result;
    int prev_class = 0;  // start with "blank" to suppress leading repetitions

    for (int64_t t = 0; t < T; ++t) {
        const float* row = logits + t * C;

        // Argmax over the class dimension.
        int   best       = 0;
        float best_score = row[0];
        for (int64_t c = 1; c < C; ++c) {
            if (row[c] > best_score) {
                best_score = row[c];
                best       = static_cast<int>(c);
            }
        }

        // Skip the blank token (class 0) and skip repeated classes (CTC rule).
        if (best != 0 && best != prev_class) {
            const int vocab_idx = best - 1;  // class 1 → vocab[0], class N → vocab[N-1]
            if (vocab_idx >= 0 &&
                static_cast<size_t>(vocab_idx) < vocab.size()) {
                result += vocab[static_cast<size_t>(vocab_idx)];
            }
        }
        prev_class = best;
    }

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Projection-based text-line detection
// ─────────────────────────────────────────────────────────────────────────────

/// Detect horizontal text-line regions by projecting dark-pixel counts onto the
/// vertical axis.
///
/// @param gray_pixels  Grayscale uint8 buffer of size H × W (row-major).
/// @param W            Image width in pixels.
/// @param H            Image height in pixels.
/// @returns            Vector of (y0, y1) half-open row ranges.  Falls back to
///                     {0, H} (the entire image) if no lines are detected.
std::vector<std::pair<int, int>> find_text_lines(const uint8_t* gray_pixels,
                                                 const int      W,
                                                 const int      H) {
    // Minimum number of dark pixels per row for the row to count as "text".
    const int threshold = std::max(2, W / 60);
    // Extra rows added above/below each detected region.
    constexpr int pad     = 3;
    // Merge adjacent regions whose gap is smaller than this.
    constexpr int min_gap = 6;
    // Discard regions thinner than this after padding and merging.
    constexpr int min_h   = 4;

    // ── Step 1: count dark pixels per row ────────────────────────────────────
    std::vector<int> row_dark(static_cast<size_t>(H), 0);
    for (int y = 0; y < H; ++y) {
        int dark = 0;
        for (int x = 0; x < W; ++x) {
            if (gray_pixels[y * W + x] < 128) ++dark;
        }
        row_dark[static_cast<size_t>(y)] = dark;
    }

    // ── Step 2: collect raw line bands ───────────────────────────────────────
    std::vector<std::pair<int, int>> raw;
    bool in_text = false;
    int  start   = 0;
    for (int y = 0; y < H; ++y) {
        if (!in_text && row_dark[static_cast<size_t>(y)] >= threshold) {
            in_text = true;
            start   = y;
        } else if (in_text && row_dark[static_cast<size_t>(y)] < threshold) {
            in_text = false;
            raw.emplace_back(start, y);
        }
    }
    if (in_text) raw.emplace_back(start, H);

    // ── Step 3: apply ±pad rows ───────────────────────────────────────────────
    for (auto& [y0, y1] : raw) {
        y0 = std::max(0, y0 - pad);
        y1 = std::min(H, y1 + pad);
    }

    // ── Step 4: merge bands whose gap is < min_gap ───────────────────────────
    std::vector<std::pair<int, int>> merged;
    for (const auto& [y0, y1] : raw) {
        if (!merged.empty() && y0 - merged.back().second < min_gap) {
            merged.back().second = std::max(merged.back().second, y1);
        } else {
            merged.emplace_back(y0, y1);
        }
    }

    // ── Step 5: filter too-thin regions ──────────────────────────────────────
    std::vector<std::pair<int, int>> lines;
    for (const auto& [y0, y1] : merged) {
        if (y1 - y0 >= min_h) lines.emplace_back(y0, y1);
    }

    // Fallback: treat the whole image as one line.
    if (lines.empty()) lines.emplace_back(0, H);

    return lines;
}

}  // anonymous namespace

// ─────────────────────────────────────────────────────────────────────────────
// Public backend API
// ─────────────────────────────────────────────────────────────────────────────

std::string extract_text(const std::string& input_path) {
    // ── Load image ───────────────────────────────────────────────────────────
    int w = 0, h = 0, ch = 0;
    unsigned char* rgba = stbi_load(input_path.c_str(), &w, &h, &ch, 4);
    if (!rgba) {
        return "[OCR error: cannot load image " + input_path + "]";
    }

    // ── Session guard ────────────────────────────────────────────────────────
    OcrSession* sess = get_ocr_session();
    if (!sess->ready) {
        stbi_image_free(rgba);
        return "[OCR error: model not loaded — run: "
               "python3 scripts/download_models.py download --models ocr_rec,ocr_keys]";
    }

    // ── RGBA → grayscale (BT.601 integer approximation) ──────────────────────
    std::vector<uint8_t> gray(static_cast<size_t>(w * h));
    for (int i = 0; i < w * h; ++i) {
        const uint8_t r = rgba[i * 4 + 0];
        const uint8_t g = rgba[i * 4 + 1];
        const uint8_t b = rgba[i * 4 + 2];
        gray[static_cast<size_t>(i)] =
            static_cast<uint8_t>((r * 77 + g * 150 + b * 29) >> 8);
    }

    // ── Detect text line regions ──────────────────────────────────────────────
    const auto lines = find_text_lines(gray.data(), w, h);

    // ── Prepare stable ORT I/O name pointers (fetched once per call) ─────────
    Ort::AllocatorWithDefaultOptions alloc;
    const std::string in_name_str  = sess->session->GetInputNameAllocated(0, alloc).get();
    const std::string out_name_str = sess->session->GetOutputNameAllocated(0, alloc).get();
    const char* in_names[]  = {in_name_str.c_str()};
    const char* out_names[] = {out_name_str.c_str()};

    Ort::MemoryInfo mem_info =
        Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);

    std::string result;

    // ── Process each detected line ────────────────────────────────────────────
    for (const auto& [y0, y1] : lines) {
        const int lh = y1 - y0;
        if (lh < 3) continue;

        // PP-OCRv4 recognition expects height=48; scale width proportionally.
        constexpr int TARGET_H = 48;
        const int new_h = TARGET_H;
        const int new_w = std::min(4096,
                                   std::max(1, static_cast<int>(
                                       static_cast<float>(w) * TARGET_H / static_cast<float>(lh))));

        // Resize the RGBA crop for this line; let stb allocate the output buffer.
        const unsigned char* crop_ptr    = rgba + y0 * w * 4;
        const int            crop_stride = w * 4;  // bytes per input row

        unsigned char* resized = stbir_resize_uint8_linear(
            crop_ptr, w, lh, crop_stride,
            nullptr,  new_w, new_h, 0,      // nullptr → stb allocates; 0 stride → packed
            STBIR_RGBA);

        if (!resized) continue;

        // ── Convert resized RGBA to float NCHW [1, 3, 48, new_w] ─────────────
        // Normalisation: val = pixel / 127.5 − 1.0  (maps [0,255] → [−1, +1])
        const int64_t N  = 1;
        const int64_t C  = 3;
        const int64_t TH = new_h;
        const int64_t TW = new_w;
        const size_t tensor_elems = static_cast<size_t>(C * TH * TW);

        std::vector<float> tensor_data(tensor_elems);
        for (int y = 0; y < new_h; ++y) {
            for (int x = 0; x < new_w; ++x) {
                for (int c = 0; c < 3; ++c) {
                    const uint8_t pix = resized[(y * new_w + x) * 4 + c];
                    tensor_data[static_cast<size_t>(c * new_h * new_w + y * new_w + x)] =
                        static_cast<float>(pix) / 127.5f - 1.0f;
                }
            }
        }

        // stbir allocated the buffer; release it before potentially continuing.
        free(resized);
        resized = nullptr;

        // ── Build ORT input tensor ────────────────────────────────────────────
        const std::array<int64_t, 4> input_shape{N, C, TH, TW};
        auto input_tensor = Ort::Value::CreateTensor<float>(
            mem_info,
            tensor_data.data(),
            tensor_elems,
            input_shape.data(),
            input_shape.size());

        // ── Run inference ────────────────────────────────────────────────────
        try {
            auto output_tensors = sess->session->Run(
                Ort::RunOptions{nullptr},
                in_names,  &input_tensor, 1,
                out_names, 1);

            if (output_tensors.empty()) continue;

            const auto&   out_tensor = output_tensors[0];
            const auto    shape      = out_tensor.GetTensorTypeAndShapeInfo().GetShape();
            const float*  logits     = out_tensor.GetTensorData<float>();

            // ── Resolve T and C from the output shape ─────────────────────────
            // PP-OCRv4 server rec outputs [1, T, C] (batch-first) or [T, 1, C]
            // (time-major).  In both cases the middle dimension is 1, so:
            //   • shape[0] == 1  →  batch-first: [1, T, C]
            //   • shape[1] == 1  →  time-major:  [T, 1, C]
            // For rank-2 tensors (no batch/middle dim), treat as [T, C] directly.
            int64_t T_steps = 0;
            int64_t num_cls = 0;

            if (shape.size() == 3) {
                if (shape[0] == 1) {
                    // [1, T, C]  — batch-first (most common PP-OCRv4 export)
                    T_steps = shape[1];
                    num_cls = shape[2];
                } else if (shape[1] == 1) {
                    // [T, 1, C]  — time-major export
                    T_steps = shape[0];
                    num_cls = shape[2];
                } else {
                    // Unexpected 3D shape: conservatively treat as [B, T, C]
                    T_steps = shape[1];
                    num_cls = shape[2];
                }
            } else if (shape.size() == 2) {
                // [T, C] — no batch dimension
                T_steps = shape[0];
                num_cls = shape[1];
            } else {
                continue;
            }

            if (T_steps <= 0 || num_cls <= 0) continue;

            // ── CTC decode and accumulate ─────────────────────────────────────
            const std::string line_text =
                ctc_decode(logits, T_steps, num_cls, sess->vocab);
            if (!line_text.empty()) {
                result += line_text;
                result += '\n';
            }

        } catch (const Ort::Exception&) {
            // Non-fatal: skip this line and continue with the rest.
        }
    }

    stbi_image_free(rgba);

    // Trim trailing whitespace / newlines.
    while (!result.empty() &&
           (result.back() == '\n' || result.back() == '\r' || result.back() == ' ')) {
        result.pop_back();
    }

    return result;
}

std::string extract_text_from_pdf(const std::string& /*input_path*/) {
    return "[OCR ONNX: PDF not directly supported — "
           "render pages to PNG and OCR each separately]";
}

}  // namespace pce::nlp::backend

#endif  // NLP_ONNX_OCR
