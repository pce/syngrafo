#pragma once
/**
 * @file bindings/audio_bindings.hh
 * @brief Saucer IPC bindings for the CSound audio backend.
 *
 * Call pce::dms::register_audio_bindings(webview) from main.cc.
 * Safe to call when SGF_WITH_AUDIO is OFF — bindings register and return
 * {ok:false} via the stub in audio_backend.hpp.
 */

#include <string>
#include <filesystem>
#include <print>

#include <nlohmann/json.hpp>
#include <saucer/smartview.hpp>

#include "../../external/audio/audio_backend.hpp"

namespace pce::dms {

inline void register_audio_bindings(saucer::smartview& wv)
{
    using json   = nlohmann::json;
    using string = std::string;

    // audio_export_wav(csdText, outputPath) → { ok, data: { output_path, duration_sec } }
    // CSound::Perform() blocks; saucer runs expose() lambdas on a thread-pool thread.
    wv.expose("audio_export_wav",
        [](string csd_text, string out_path) -> string {
            auto result = pce::audio::export_wav(csd_text, out_path);
            if (!result)
                return json{{"ok", false}, {"error", result.error()}}.dump();
            return json{
                {"ok",   true},
                {"data", {
                    {"output_path",  result->output_path},
                    {"duration_sec", result->duration_sec},
                }},
            }.dump();
        });

    // audio_validate_csd(csdText) → { ok:true, data: { valid, errors[] } }
    // A syntax error is ok:true/valid:false so the frontend can show details
    // without treating it as an IPC failure.
    wv.expose("audio_validate_csd",
        [](string csd_text) -> string {
            auto result = pce::audio::validate_csd(csd_text);
            if (!result)
                return json{
                    {"ok",   true},
                    {"data", {
                        {"valid",  false},
                        {"errors", json::array({result.error()})},
                    }},
                }.dump();
            return json{
                {"ok",   true},
                {"data", {{"valid", true}, {"errors", json::array()}}},
            }.dump();
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
