#pragma once
/**
 * @file bindings/audio_bindings.hh
 * @brief Saucer IPC bindings for the CSound audio backend.
 */
#include <string>
#include <filesystem>
#include <print>

#include <nlohmann/json.hpp>
#include <saucer/smartview.hpp>

#include "../../external/audio/audio_backend.hpp"
#include "../dms_handle.hh"

namespace pce::dms {

inline void register_audio_bindings(saucer::smartview& wv, DMSHandle& dms)
{
    using json   = nlohmann::json;
    using string = std::string;

    wv.expose("audio_export_wav",
        [](string csd_text, string out_path) -> string {
            auto r = pce::audio::export_wav(csd_text, out_path);
            if (!r) return DMSHandle::err_str(r.error());
            return DMSHandle::ok_str(json{
                {"output_path",  r->output_path},
                {"duration_sec", r->duration_sec},
            });
        });

    /** A syntax error returns ok:true/valid:false so the frontend can show
     *  details without treating it as an IPC failure. */
    wv.expose("audio_validate_csd",
        [](string csd_text) -> string {
            auto r = pce::audio::validate_csd(csd_text);
            if (!r) return DMSHandle::ok_str(json{{"valid", false},
                                                   {"errors", json::array({r.error()})}});
            return DMSHandle::ok_str(json{{"valid", true}, {"errors", json::array()}});
        });

    wv.expose("audio_save_project",
        [&dms](string name, string zone_name, string data_json) -> string {
            auto j = try_invoke([&]() { return json::parse(data_json); });
            if (!j) return DMSHandle::err_str("invalid JSON: " + j.error());
            const auto r = dms.media_save_project("audio", name, zone_name, *j);
            if (!r) return DMSHandle::err_str(r.error());
            return DMSHandle::ok_str(*r);
        });

    wv.expose("audio_load_project",
        [&dms](string name, string zone_name) -> string {
            const auto r = dms.media_load_project("audio", name, zone_name);
            if (!r) return DMSHandle::err_str(r.error());
            return DMSHandle::ok_str(*r);
        });

    wv.expose("audio_list_projects",
        [&dms](string zone_name) -> string {
            const auto r = dms.media_list_projects("audio", zone_name);
            if (!r) return DMSHandle::err_str(r.error());
            return DMSHandle::ok_str(*r);
        });

    wv.expose("audio_delete_project",
        [&dms](string name, string zone_name) -> string {
            const auto r = dms.media_delete_project("audio", name, zone_name);
            if (!r) return DMSHandle::err_str(r.error());
            return DMSHandle::ok_str(*r);
        });

    std::print("[audio] bindings registered (SGF_WITH_AUDIO={})\n",
#ifdef SGF_WITH_AUDIO
               "ON"
#else
               "OFF"
#endif
    );
}

} // namespace pce::dms
