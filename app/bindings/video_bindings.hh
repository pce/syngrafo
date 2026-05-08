#pragma once
/**
 * @file bindings/video_bindings.hh
 * @brief Saucer IPC bindings for the FFmpeg video backend.
 *
 * Call pce::dms::register_video_bindings(webview) from main.cc.
 * Safe to call when SGF_WITH_VIDEO is OFF — bindings register and return
 * {ok:false} via the stub in video_backend.hpp.
 */

#include <string>
#include <filesystem>
#include <vector>
#include <cstdint>
#include <print>

#include <nlohmann/json.hpp>
#include <saucer/smartview.hpp>

#include "../../external/video/video_backend.hpp"

namespace pce::dms {

namespace video_detail {

/** Minimal self-contained base-64 encoder — no external dependency. */
[[nodiscard]] inline std::string base64_encode(const std::vector<uint8_t>& bytes)
{
    static constexpr std::string_view B64 =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((bytes.size() + 2u) / 3u) * 4u);
    for (std::size_t i = 0; i < bytes.size(); i += 3) {
        const uint32_t b =
            (static_cast<uint32_t>(bytes[i]) << 16) |
            ((i + 1 < bytes.size()) ? (static_cast<uint32_t>(bytes[i + 1]) << 8) : 0u) |
            ((i + 2 < bytes.size()) ?  static_cast<uint32_t>(bytes[i + 2])        : 0u);
        out += B64[(b >> 18) & 0x3Fu];
        out += B64[(b >> 12) & 0x3Fu];
        out += (i + 1 < bytes.size()) ? B64[(b >> 6) & 0x3Fu] : '=';
        out += (i + 2 < bytes.size()) ? B64[ b       & 0x3Fu] : '=';
    }
    return out;
}

} // namespace video_detail

inline void register_video_bindings(saucer::smartview& wv)
{
    using json   = nlohmann::json;
    using string = std::string;

    // video_get_media_info(path) → { ok, data: { width, height, fps,
    //                                duration_sec, duration_frames, codec, has_audio } }
    wv.expose("video_get_media_info",
        [](string path_str) -> string {
            auto result = pce::video::get_media_info(path_str);
            if (!result)
                return json{{"ok", false}, {"error", result.error()}}.dump();
            const auto& i = *result;
            return json{
                {"ok",   true},
                {"data", {
                    {"width",           i.width},
                    {"height",          i.height},
                    {"fps",             i.fps},
                    {"duration_sec",    i.duration_sec},
                    {"duration_frames", i.duration_frames},
                    {"codec",           i.codec},
                    {"has_audio",       i.has_audio},
                }},
            }.dump();
        });

    // video_decode_frame(sourcePath, frameNumber, fps) →
    //   { ok, data: { dataUrl, width, height, frameNumber, timestampSec } }
    // Frame returned as base64 JPEG data-URL ready for <img src=…>.
    // saucer runs expose() on a thread-pool thread; blocking decode is fine.
    wv.expose("video_decode_frame",
        [](string path_str, int frame_number, double fps) -> string {
            auto result = pce::video::decode_frame(path_str, frame_number, fps);
            if (!result)
                return json{{"ok", false}, {"error", result.error()}}.dump();
            const auto& f   = *result;
            const string b64 =
                "data:image/jpeg;base64," +
                video_detail::base64_encode(f.jpeg_bytes);
            return json{
                {"ok",   true},
                {"data", {
                    {"dataUrl",      b64},
                    {"width",        f.width},
                    {"height",       f.height},
                    {"frameNumber",  f.frame_number},
                    {"timestampSec", f.timestamp_sec},
                }},
            }.dump();
        });

    // video_get_thumbnail(path, atSec) — same shape as video_decode_frame.
    // Derives frame index from atSec * fps so the caller needs no prior fps.
    wv.expose("video_get_thumbnail",
        [](string path_str, double at_sec) -> string {
            auto info_r = pce::video::get_media_info(path_str);
            if (!info_r)
                return json{{"ok", false}, {"error", info_r.error()}}.dump();
            const int frame =
                (info_r->fps > 0.0) ? static_cast<int>(at_sec * info_r->fps) : 0;
            auto result = pce::video::decode_frame(path_str, frame, info_r->fps);
            if (!result)
                return json{{"ok", false}, {"error", result.error()}}.dump();
            const string b64 =
                "data:image/jpeg;base64," +
                video_detail::base64_encode(result->jpeg_bytes);
            return json{
                {"ok",   true},
                {"data", {
                    {"dataUrl",      b64},
                    {"width",        result->width},
                    {"height",       result->height},
                    {"frameNumber",  frame},
                    {"timestampSec", at_sec},
                }},
            }.dump();
        });

    // video_import_clip(absPath) →
    //   { ok, data: { resolvedPath, info: { width, height, fps, ... } } }
    // Single round-trip that validates + returns all metadata needed by the timeline.
    wv.expose("video_import_clip",
        [](string abs_path) -> string {
            auto info_r = pce::video::get_media_info(abs_path);
            if (!info_r)
                return json{{"ok", false}, {"error", info_r.error()}}.dump();
            const auto& i = *info_r;
            return json{
                {"ok",   true},
                {"data", {
                    {"resolvedPath", abs_path},
                    {"info", {
                        {"width",           i.width},
                        {"height",          i.height},
                        {"fps",             i.fps},
                        {"duration_sec",    i.duration_sec},
                        {"duration_frames", i.duration_frames},
                        {"codec",           i.codec},
                        {"has_audio",       i.has_audio},
                    }},
                }},
            }.dump();
        });

    std::print("[video] bindings registered (SGF_WITH_VIDEO={})\n",
#ifdef SGF_WITH_VIDEO
               "ON"
#else
               "OFF"
#endif
    );
}

} // namespace pce::dms
