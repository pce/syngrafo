#pragma once

//
// Model Downloader Module
//
// Provides a native binding for downloading GGUF model files from a built-in
// catalog.  Designed to mirror the updater module's structure so it can be
// wired into saucer::smartview with webview->expose() calls.
//
// Threading model
//
//   Each download runs in its own std::thread.  Progress is tracked by reading
//   the size of the partially-written .tmp file.  The JS side polls via
//   model_get_progress at a user-defined interval (default 500 ms).
//
// Cancellation
//
//   cancel_download() sets an atomic flag.  If curl has not yet started, the
//   thread exits immediately.  If curl is already running the thread performs
//   a soft cancel: once curl finishes, the .tmp file is deleted and the status
//   is updated to "cancelled".  The status is set optimistically to "cancelled"
//   immediately so the UI can respond without waiting.
//

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace saucer::model_downloader
{

    struct ModelInfo
    {
        std::string id;          ///< Stable identifier (e.g. "phi-3.5-mini-q4")
        std::string name;        ///< Human-readable display name
        std::string description; ///< Short description / use-case guidance
        std::string url;         ///< Direct download URL
        std::string filename;    ///< Local filename once downloaded
        int64_t     size_bytes;  ///< Approximate file size in bytes
    };

    enum class DownloadStatus
    {
        idle,
        downloading,
        completed,
        failed,
        cancelled
    };

    struct DownloadProgress
    {
        std::string    download_id;
        std::string    model_id;
        int64_t        bytes_downloaded{0};
        int64_t        total_bytes{0};
        DownloadStatus status{DownloadStatus::idle};
        std::string    error_message;
    };

    struct ModelDownloaderConfig
    {
        std::string            models_dir;                                  ///< Directory where model files are stored (required)
        std::string            user_agent = "ModelDownloader/1.0"; ///< User-Agent for HTTP requests
        /// Model catalog exposed to the UI.  If empty the downloader serves an
        /// empty list — no models are offered for download.  Keeping the catalog
        /// in the caller (main.cc) means adding / removing models never requires
        /// recompiling the module; the list can also be loaded from a JSON file
        /// or fetched from a remote manifest at runtime.
        std::vector<ModelInfo> catalog;
    };

    /**
     * Parse a JSON array string into a catalog vector.
     * Returns an empty vector on any parse failure.
     */
    std::vector<ModelInfo> load_catalog_from_json(const std::string& json_text);

    /**
     * Read the file at `path` and parse it as a JSON catalog.
     * Logs a warning and returns an empty vector when the file is missing or malformed.
     */
    std::vector<ModelInfo> load_catalog_from_json_file(const std::string& path);


    class ModelDownloader
    {
      public:
        explicit ModelDownloader(const ModelDownloaderConfig& config);
        ~ModelDownloader();

        // Non-copyable – owns background threads
        ModelDownloader(const ModelDownloader&)            = delete;
        ModelDownloader& operator=(const ModelDownloader&) = delete;

      public:
        /// Returns the built-in model catalog as a JSON array.
        /// Each entry includes an "downloaded" boolean reflecting current state.
        [[nodiscard]] std::string list_models() const;

        /// Start downloading a model.
        /// Returns a download_id string on success, or "error: <msg>" on failure.
        /// If the model is already downloading, returns the existing download_id.
        [[nodiscard]] std::string start_download(const std::string& model_id);

        /// Query the current download progress as a JSON object.
        /// Returns {"error":"not found"} if the download_id is unknown.
        [[nodiscard]] std::string get_progress(const std::string& download_id) const;

        /// Request cancellation of an active download.
        /// Returns true if the cancellation was registered; false if not found / not active.
        bool cancel_download(const std::string& download_id);

        /// True if the model file exists on disk and is non-empty.
        [[nodiscard]] bool is_downloaded(const std::string& model_id) const;

        /// Delete a downloaded model file.
        /// Returns true if the file was removed successfully.
        bool delete_model(const std::string& model_id);

        /// Returns the absolute path to a downloaded model file, or "" if not found.
        [[nodiscard]] std::string get_model_path(const std::string& model_id) const;

      private:
        std::string            m_models_dir;
        std::string            m_user_agent;
        std::vector<ModelInfo> m_catalog;

        struct Impl;
        std::unique_ptr<Impl> m_impl;
    };

} // namespace saucer::model_downloader

