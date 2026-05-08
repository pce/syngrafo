#pragma once
/**
 * audio_backend.hpp — CSound offline render backend.
 *
 * Uses csound.hpp as a LINKED LIBRARY.  No subprocess spawning.
 * Compiled only when SGF_WITH_AUDIO=ON.
 */

#include <string>
#include <filesystem>
#include <expected>

#ifdef SGF_WITH_AUDIO
#  include <csound/csound.hpp>
#endif

namespace pce::audio {

struct ExportResult {
    std::string output_path;
    double      duration_sec = 0.0;
};

/**
 * Render a CSD string to a WAV file on disk.
 * CSound is invoked as a C++ object — no process is spawned.
 *
 * @param csd_text    full CSD string (including <CsoundSynthesizer> wrapper)
 * @param output_path absolute path where the .wav will be written
 * @returns ExportResult on success, error string on failure
 */
inline std::expected<ExportResult, std::string>
export_wav(const std::string& csd_text, const std::filesystem::path& output_path)
{
#ifndef SGF_WITH_AUDIO
    return std::unexpected("Audio backend not compiled (SGF_WITH_AUDIO=OFF)");
#else
    try {
        Csound cs;

        // Inject the output path into the CSD's <CsOptions> block so the
        // caller's CSD does not need to specify -o.
        // Also disable realtime output so CSound never opens a DAC device.
        std::string csd = csd_text;
        const std::string out_opt = "-o " + output_path.string();

        const auto opts_start = csd.find("<CsOptions>");
        const auto opts_end   = csd.find("</CsOptions>");
        if (opts_start != std::string::npos && opts_end != std::string::npos) {
            const std::size_t insert_at = opts_start + std::string("<CsOptions>").size();
            csd.insert(insert_at, "\n" + out_opt + "\n");
        }

        // -n  : no realtime audio output
        // -o  : explicit output path (also injected above; belt-and-braces)
        cs.SetOption("-n");
        cs.SetOption(("-o" + output_path.string()).c_str());

        if (cs.CompileCsdText(csd.c_str()) != 0)
            return std::unexpected("CSound CompileCsdText failed");

        if (cs.Start() != 0)
            return std::unexpected("CSound Start() failed");

        // Perform() blocks until the score is done — correct for offline render.
        cs.Perform();
        cs.Cleanup();

        const double duration = cs.GetScoreTime();

        return ExportResult{
            .output_path  = output_path.string(),
            .duration_sec = duration,
        };
    } catch (const std::exception& e) {
        return std::unexpected(std::string("CSound exception: ") + e.what());
    }
#endif
}

/**
 * Validate a CSD string for syntax errors without performing.
 * Compiles but does not call Start() or Perform().
 */
inline std::expected<bool, std::string>
validate_csd(const std::string& csd_text)
{
#ifndef SGF_WITH_AUDIO
    return std::unexpected("Audio backend not compiled (SGF_WITH_AUDIO=OFF)");
#else
    try {
        Csound cs;
        cs.SetOption("-n");
        const int rc = cs.CompileCsdText(csd_text.c_str());
        if (rc != 0)
            return std::unexpected(
                "Syntax error (CompileCsdText returned " + std::to_string(rc) + ")");
        cs.Cleanup();
        return true;
    } catch (const std::exception& e) {
        return std::unexpected(std::string("CSound exception: ") + e.what());
    }
#endif
}

} // namespace pce::audio
