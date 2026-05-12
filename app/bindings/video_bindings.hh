#pragma once
/**
 * @file bindings/video_bindings.hh
 * @brief Saucer IPC bindings for the FFmpeg video backend.
 */
#include <string>
#include <filesystem>
#include <vector>
#include <algorithm>
#include <print>

#include <nlohmann/json.hpp>
#include <saucer/smartview.hpp>

#include "../../external/video/video_backend.hpp"
#include "../dms_handle.hh"
#include "../internal/encoding.hh"

namespace pce::dms {

inline void register_video_bindings(saucer::smartview& wv, DMSHandle& dms)
{
    using json   = nlohmann::json;
    using string = std::string;

    wv.expose("video_get_media_info",
        [](string path_str) -> string {
            auto r = pce::video::get_media_info(path_str);
            if (!r) return DMSHandle::err_str(r.error());
            const auto& i = *r;
            return DMSHandle::ok_str(json{
                {"width", i.width}, {"height", i.height}, {"fps", i.fps},
                {"duration_sec", i.duration_sec}, {"duration_frames", i.duration_frames},
                {"codec", i.codec}, {"has_audio", i.has_audio},
            });
        });

    wv.expose("video_decode_frame",
        [](string path_str, int frame_number, double fps) -> string {
            auto r = pce::video::decode_frame(path_str, frame_number, fps);
            if (!r) return DMSHandle::err_str(r.error());
            const string b64 = "data:image/jpeg;base64," +
                pce::encoding::base64_encode(r->jpeg_bytes);
            return DMSHandle::ok_str(json{
                {"dataUrl", b64}, {"width", r->width}, {"height", r->height},
                {"frameNumber", r->frame_number}, {"timestampSec", r->timestamp_sec},
            });
        });

    wv.expose("video_get_thumbnail",
        [](string path_str, double at_sec) -> string {
            auto info_r = pce::video::get_media_info(path_str);
            if (!info_r) return DMSHandle::err_str(info_r.error());
            const int frame = (info_r->fps > 0.0)
                ? static_cast<int>(at_sec * info_r->fps) : 0;
            auto r = pce::video::decode_frame(path_str, frame, info_r->fps);
            if (!r) return DMSHandle::err_str(r.error());
            const string b64 = "data:image/jpeg;base64," +
                pce::encoding::base64_encode(r->jpeg_bytes);
            return DMSHandle::ok_str(json{
                {"dataUrl", b64}, {"width", r->width}, {"height", r->height},
                {"frameNumber", frame}, {"timestampSec", at_sec},
            });
        });

    wv.expose("video_import_clip",
        [](string abs_path) -> string {
            auto r = pce::video::get_media_info(abs_path);
            if (!r) return DMSHandle::err_str(r.error());
            const auto& i = *r;
            return DMSHandle::ok_str(json{
                {"resolvedPath", abs_path},
                {"info", {
                    {"width", i.width}, {"height", i.height}, {"fps", i.fps},
                    {"duration_sec", i.duration_sec}, {"duration_frames", i.duration_frames},
                    {"codec", i.codec}, {"has_audio", i.has_audio},
                }},
            });
        });

    wv.expose("video_list_directory",
        [](string dir_path, std::vector<string> extensions) -> string {
            namespace fs = std::filesystem;
            const fs::path root{dir_path};
            std::error_code ec;
            if (!fs::is_directory(root, ec))
                return DMSHandle::err_str("Not a directory");
            std::vector<string> exts;
            exts.reserve(extensions.size());
            for (auto e : extensions) {
                std::transform(e.begin(), e.end(), e.begin(), ::tolower);
                if (!e.empty() && e[0] != '.') e = '.' + e;
                exts.push_back(std::move(e));
            }
            json files = json::array();
            for (const auto& entry : fs::directory_iterator(root,
                     fs::directory_options::skip_permission_denied, ec)) {
                if (!entry.is_regular_file(ec)) continue;
                if (!exts.empty()) {
                    string ext = entry.path().extension().string();
                    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
                    if (std::find(exts.begin(), exts.end(), ext) == exts.end()) continue;
                }
                files.push_back(entry.path().string());
            }
            return DMSHandle::ok_str(json{{"files", files}});
        });

    wv.expose("video_export",
        [&dms](string project_json, string out_path) -> string {
            const auto r = dms.video_export_project(project_json, out_path);
            if (!r) return DMSHandle::err_str(r.error());
            return DMSHandle::ok_str(*r);
        });

    wv.expose("video_save_project",
        [&dms](string name, string zone_name, string data_json) -> string {
            auto j = try_invoke([&]() { return json::parse(data_json); });
            if (!j) return DMSHandle::err_str("invalid JSON: " + j.error());
            const auto r = dms.media_save_project("video", name, zone_name, *j);
            if (!r) return DMSHandle::err_str(r.error());
            return DMSHandle::ok_str(*r);
        });

    wv.expose("video_load_project",
        [&dms](string name, string zone_name) -> string {
            const auto r = dms.media_load_project("video", name, zone_name);
            if (!r) return DMSHandle::err_str(r.error());
            return DMSHandle::ok_str(*r);
        });

    wv.expose("video_list_projects",
        [&dms](string zone_name) -> string {
            const auto r = dms.media_list_projects("video", zone_name);
            if (!r) return DMSHandle::err_str(r.error());
            return DMSHandle::ok_str(*r);
        });

    wv.expose("video_delete_project",
        [&dms](string name, string zone_name) -> string {
            const auto r = dms.media_delete_project("video", name, zone_name);
            if (!r) return DMSHandle::err_str(r.error());
            return DMSHandle::ok_str(*r);
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
