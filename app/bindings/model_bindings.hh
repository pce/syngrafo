#pragma once
/**
 * @file bindings/model_bindings.hh
 * @brief NLP model management bindings — list, download, cancel, delete.
 */

#include <saucer/model_downloader.hpp>
#include <saucer/smartview.hpp>
#include "../dms_handle.hh"

namespace pce::dms {

inline void register_model_bindings(saucer::smartview& wv,
                                     saucer::model_downloader::ModelDownloader& dl,
                                     DMSHandle& dms)
{
    using std::string;
    using namespace saucer::model_downloader;

    wv.expose("model_list", [&dl]() -> string {
        return dl.list_models();
    });

    wv.expose("model_start", [&dl](string model_id) -> string {
        return dl.start_download(model_id);
    });

    wv.expose("model_progress", [&dl](string download_id) -> string {
        return dl.get_progress(download_id);
    });

    wv.expose("model_cancel", [&dl](string download_id) -> bool {
        return dl.cancel_download(download_id);
    });

    wv.expose("model_delete", [&dl](string model_id) -> bool {
        return dl.delete_model(model_id);
    });

    wv.expose("model_path", [&dl](string model_id) -> string {
        return dl.get_model_path(model_id);
    });

    /** Returns the active LLM models directory (may differ from the default
     *  when the user has configured a custom path via model_set_models_dir). */
    wv.expose("model_get_models_dir", [&dl]() -> string {
        return dl.models_dir();
    });

    /** Persists a new LLM models directory preference to the DB.
     *  Takes effect on the next app launch — the downloader instance is
     *  immutable at runtime; changing the directory mid-session could
     *  corrupt partial downloads. Returns the persisted path. */
    wv.expose("model_set_models_dir", [&dms](string path) -> string {
        if (path.empty()) return R"({"ok":false,"error":"path must not be empty"})";
        dms.save_preference_sync("llm_models_dir", path);
        return R"({"ok":true,"restart_required":true,"path":")" + path + R"("})";
    });
}

} // namespace pce::dms
