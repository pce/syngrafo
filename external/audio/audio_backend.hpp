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
#include <csignal>
#include <cstdlib>

#ifdef SGF_WITH_AUDIO
#  include <csound/csound.hpp>
#endif

namespace pce::audio {

/// RAII guard that saves and restores SIGINT/SIGTERM around Csound usage.
/// Csound installs its own handlers on Start() and does NOT restore them in
/// Reset(), so without this the stale handlers fire when the host app quits.
struct SignalGuard {
    using Handler = void(*)(int);
    Handler saved_sigint;
    Handler saved_sigterm;
    SignalGuard()
        : saved_sigint (std::signal(SIGINT,  SIG_DFL))
        , saved_sigterm(std::signal(SIGTERM, SIG_DFL)) {}
    ~SignalGuard() {
        std::signal(SIGINT,  saved_sigint);
        std::signal(SIGTERM, saved_sigterm);
    }
    // Non-copyable/movable — guard is tied to the scope.
    SignalGuard(const SignalGuard&)            = delete;
    SignalGuard& operator=(const SignalGuard&) = delete;
};

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
        // RAII guard: saves SIGINT/SIGTERM before Csound installs its own and
        // restores them on all exit paths (normal return, early return, throw).
        SignalGuard sig_guard;

        // Silence "Error opening plugin directory '...Opcodes64'" on macOS when
        // Csound is brew-linked and the framework plugin path doesn't exist.
        // Setting these to empty tells Csound to skip the system plugin scan;
        // built-in opcodes (compiled into libcsound64) are unaffected.
#if defined(_WIN32)
        ::_putenv_s("OPCODEDIR64",  "");
        ::_putenv_s("OPCODE6DIR64", "");
        ::_putenv_s("OPCODEDIR",    "");
#else
        ::setenv("OPCODEDIR64",  "", /*overwrite=*/1);
        ::setenv("OPCODE6DIR64", "", 1);
        ::setenv("OPCODEDIR",    "", 1);
#endif

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

        // CSound 7: CompileCSD(text, mode=1) replaces CompileCsdText
        if (cs.CompileCSD(csd.c_str(), 1) != 0)
            return std::unexpected("CSound CompileCSD failed");

        if (cs.Start() != 0)
            return std::unexpected("CSound Start() failed");

        // PerformKsmps() returns 0 while running, non-zero when score finishes
        while (!cs.PerformKsmps()) {}

        const double duration = cs.GetScoreTime();
        cs.Reset();  // CSound 7: Cleanup() removed, use Reset()

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
        // RAII guard: same as export_wav — restores handlers on all exit paths.
        SignalGuard sig_guard;

        // Suppress plugin-directory warnings (same rationale as export_wav).
#if defined(_WIN32)
        ::_putenv_s("OPCODEDIR64",  "");
        ::_putenv_s("OPCODE6DIR64", "");
        ::_putenv_s("OPCODEDIR",    "");
#else
        ::setenv("OPCODEDIR64",  "", /*overwrite=*/1);
        ::setenv("OPCODE6DIR64", "", 1);
        ::setenv("OPCODEDIR",    "", 1);
#endif

        Csound cs;
        cs.SetOption("-n");
        // CSound 7: CompileCSD(text, mode=1) replaces CompileCsdText
        const int rc = cs.CompileCSD(csd_text.c_str(), 1);
        if (rc != 0)
            return std::unexpected(
                "Syntax error (CompileCSD returned " + std::to_string(rc) + ")");
        cs.Reset();  // CSound 7: Cleanup() removed

        return true;
    } catch (const std::exception& e) {
        return std::unexpected(std::string("CSound exception: ") + e.what());
    }
#endif
}

} // namespace pce::audio
