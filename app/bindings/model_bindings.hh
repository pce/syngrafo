#pragma once
/**
 * @file bindings/model_bindings.hh
 * @author Patrick Engel
 * @brief NLP model management bindings — list, download, cancel, delete.
 *
 * Exposes the saucer::model_downloader module to the JS frontend so
 * users can manage their local NLP models from within the app.
 *
 * Exposed bindings:
 *   model_list          ()                         → JSON array of ModelInfo
 *   model_start         (modelId: string)          → download_id | "error: …"
 *   model_progress      (downloadId: string)       → DownloadProgress JSON
 *   model_cancel        (downloadId: string)       → boolean
 *   model_delete        (modelId: string)          → boolean
 *   model_path          (modelId: string)          → absolute path | ""
 *
 * The download uses libcurl C API directly — no child processes are spawned.
 * Progress polling is left to the frontend (recommended: 500 ms interval).
 */

#include <saucer/model_downloader.hpp>
#include <saucer/smartview.hpp>
#include "../dms_handle.hh"

namespace pce::dms {

// ─────────────────────────────────────────────────────────────────────────────
inline void register_model_bindings(saucer::smartview& wv,
                                     saucer::model_downloader::ModelDownloader& dl)
{
    using std::string;
    using namespace saucer::model_downloader;

    // ── model_list ───────────────────────────────────────────────────────────
    // Returns the built-in catalog as a JSON array with a "downloaded" flag
    // for each entry reflecting the current on-disk state.
    wv.expose("model_list", [&dl]() -> string {
        return dl.list_models();
    });

    // ── model_start ──────────────────────────────────────────────────────────
    // Start downloading a model from the catalog.  Returns the download_id on
    // success, or a string starting with "error:" on failure.
    wv.expose("model_start", [&dl](string model_id) -> string {
        return dl.start_download(model_id);
    });

    // ── model_progress ───────────────────────────────────────────────────────
    // Query download progress by download_id.  Poll every ~500 ms from JS.
    wv.expose("model_progress", [&dl](string download_id) -> string {
        return dl.get_progress(download_id);
    });

    // ── model_cancel ─────────────────────────────────────────────────────────
    wv.expose("model_cancel", [&dl](string download_id) -> bool {
        return dl.cancel_download(download_id);
    });

    // ── model_delete ─────────────────────────────────────────────────────────
    wv.expose("model_delete", [&dl](string model_id) -> bool {
        return dl.delete_model(model_id);
    });

    // ── model_path ───────────────────────────────────────────────────────────
    // Returns the absolute path to a downloaded model file, or "" if absent.
    wv.expose("model_path", [&dl](string model_id) -> string {
        return dl.get_model_path(model_id);
    });
}

} // namespace pce::dms

