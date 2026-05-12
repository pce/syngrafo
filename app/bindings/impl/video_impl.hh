#pragma once
/**
 * @file bindings/impl/video_impl.hh
 * @brief DMSHandle implementations for video project persistence and export.
 *
 * Follows the same impl-header pattern as bookmark_impl.hh / lifecycle_impl.hh.
 * Include only from dms_bindings.hh (after DMSHandle is fully declared).
 */
#include "../../dms_handle.hh"
#include "../../../external/video/video_backend.hpp"

namespace pce::dms {

namespace detail {

/** @brief Parse a CSS hex color ("#rrggbb" or "rrggbb") to {R, G, B}; returns {0,0,0} on parse failure. */
inline std::array<uint8_t, 3> hex_to_rgb(std::string_view hex) noexcept {
    if (!hex.empty() && hex[0] == '#') hex.remove_prefix(1);
    if (hex.size() < 6) return {};
    try {
        const unsigned v = std::stoul(std::string{hex.substr(0, 6)}, nullptr, 16);
        return { uint8_t(v >> 16), uint8_t(v >> 8), uint8_t(v) };
    } catch (...) { return {}; }
}

} // namespace detail

/**
 * @brief Deserialise a VideoProject JSON value into a typed ExportProject.
 *
 * Encapsulates all field access in try_invoke so any exception becomes
 * std::unexpected — callers can .and_then() directly.
 */
[[nodiscard]] inline Expected<pce::video::ExportProject>
parse_export_project(const json& j) {
    return try_invoke([&]() -> pce::video::ExportProject {
        pce::video::ExportProject proj;
        const auto res_j     = j.value("resolution", json::object());
        proj.width           = res_j.value("width",  1920);
        proj.height          = res_j.value("height", 1080);
        proj.fps             = j.value("fps", 25.0);
        proj.duration_frames = j.value("durationFrames", 0);
        proj.bg_color        = detail::hex_to_rgb(
            j.value("settings", json::object()).value("backgroundColor", "#000000"));

        for (const auto& track : j.value("tracks", json::array())) {
            const bool muted       = track.value("muted", false);
            const int  track_layer = track.value("layer", 0);
            for (const auto& clip : track.value("clips", json::array())) {
                pce::video::ExportClip ec;
                ec.muted         = muted;
                ec.layer         = clip.value("layer", track_layer);
                ec.opacity       = clip.value("opacity", 1.0);
                ec.source_offset = clip.value("sourceOffset", 0);
                const auto rng   = clip.value("range", json::object());
                ec.start_frame   = rng.value("startFrame", 0);
                ec.end_frame     = rng.value("endFrame",   0);
                const std::string ks = clip.value("kind", "solid_color");
                if      (ks == "video") ec.kind = pce::video::ExportClipKind::Video;
                else if (ks == "image") ec.kind = pce::video::ExportClipKind::Image;
                else if (ks == "audio") ec.kind = pce::video::ExportClipKind::Audio;
                else                    ec.kind = pce::video::ExportClipKind::SolidColor;
                const auto src  = clip.value("source", json::object());
                ec.source_path  = src.value("path",  "");
                ec.color        = detail::hex_to_rgb(src.value("color", "#000000"));
                proj.clips.push_back(std::move(ec));
            }
        }
        std::ranges::sort(proj.clips, {}, &pce::video::ExportClip::layer);
        return proj;
    });
}

inline Expected<json> DMSHandle::media_save_project(std::string_view kind,
                                                    std::string_view name,
                                                    std::string_view zone_name,
                                                    const json&      data) {
    if (name.empty()) return std::unexpected("name must not be empty");
    const int64_t now = pce::db::now_unix();
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        const int64_t id = db.insert_into("media_projects")
            .value("kind",       std::string{kind})
            .value("name",       std::string{name})
            .value("zone_name",  std::string{zone_name})
            .value("data_json",  data.dump())
            .value("created_at", now)
            .value("updated_at", now)
            .on_conflict_replace()
            .execute();
        return json{
            {"id",         id},
            {"kind",       kind},
            {"name",       name},
            {"zone_name",  zone_name},
            {"updated_at", now},
        };
    });
}

inline Expected<json> DMSHandle::media_load_project(std::string_view kind,
                                                    std::string_view name,
                                                    std::string_view zone_name) {
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        const auto row = db.from("media_projects")
            .where("kind = ? AND name = ? AND zone_name = ?",
                   std::string{kind}, std::string{name}, std::string{zone_name})
            .first();
        if (!row) throw std::runtime_error("project not found: " + std::string{name});
        return json{
            {"id",         row->get<int64_t>("id")},
            {"kind",       row->get<std::string>("kind")},
            {"name",       row->get<std::string>("name")},
            {"zone_name",  row->get<std::string>("zone_name")},
            {"data",       json::parse(row->get<std::string>("data_json"))},
            {"created_at", row->try_get<int64_t>("created_at").value_or(0)},
            {"updated_at", row->try_get<int64_t>("updated_at").value_or(0)},
        };
    });
}

inline Expected<json> DMSHandle::media_list_projects(std::string_view kind,
                                                     std::string_view zone_name) {
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        return db.from("media_projects")
            .where("kind = ? AND zone_name = ?",
                   std::string{kind}, std::string{zone_name})
            .order_by("updated_at", false)
            .map<json>([](const pce::db::Row& r) {
                return json{
                    {"id",         r.get<int64_t>("id")},
                    {"kind",       r.get<std::string>("kind")},
                    {"name",       r.get<std::string>("name")},
                    {"zone_name",  r.get<std::string>("zone_name")},
                    {"created_at", r.try_get<int64_t>("created_at").value_or(0)},
                    {"updated_at", r.try_get<int64_t>("updated_at").value_or(0)},
                };
            });
    });
}

inline Expected<json> DMSHandle::media_delete_project(std::string_view kind,
                                                      std::string_view name,
                                                      std::string_view zone_name) {
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        const int affected = db.delete_from("media_projects")
            .where("kind = ? AND name = ? AND zone_name = ?",
                   std::string{kind}, std::string{name}, std::string{zone_name})
            .execute();
        return json{{"deleted", affected > 0}};
    });
}

inline Expected<json> DMSHandle::video_export_project(std::string_view project_json,
                                                      std::string_view output_path) {
    return try_invoke([&]() { return json::parse(project_json); })
        .and_then([](const json& j) {
            return parse_export_project(j);
        })
        .and_then([&](pce::video::ExportProject proj) -> Expected<json> {
            auto r = pce::video::export_project(proj, std::filesystem::path{output_path});
            if (!r) return std::unexpected(r.error());
            return json{
                {"outputPath",  r->output_path},
                {"durationSec", r->duration_sec},
                {"frameCount",  r->frame_count},
            };
        });
}

} // namespace pce::dms
