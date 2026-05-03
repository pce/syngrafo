#include <saucer/model_downloader.hpp>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include <curl/curl.h>
#include <nlohmann/json.hpp>

namespace fs = std::filesystem;

namespace saucer::model_downloader
{

// ── Catalog loaders ────────────────────────────────────────────────────────────

std::vector<ModelInfo> load_catalog_from_json(const std::string& json_text)
{
    std::vector<ModelInfo> out;
    try
    {
        auto arr = nlohmann::json::parse(json_text);
        for (const auto& obj : arr)
        {
            out.push_back({
                .id          = obj.value("id",          ""),
                .name        = obj.value("name",        ""),
                .description = obj.value("description", ""),
                .url         = obj.value("url",         ""),
                .filename    = obj.value("filename",    ""),
                .size_bytes  = obj.value("size_bytes",  int64_t{0}),
            });
        }
    }
    catch (const std::exception& e)
    {
        std::cerr << "[ModelDownloader] catalog parse error: " << e.what() << '\n';
    }
    return out;
}

std::vector<ModelInfo> load_catalog_from_json_file(const std::string& path)
{
    std::ifstream f(path);
    if (!f)
    {
        std::cerr << "[ModelDownloader] catalog file not found: " << path << '\n';
        return {};
    }
    std::ostringstream ss;
    ss << f.rdbuf();
    return load_catalog_from_json(ss.str());
}




    static std::string status_to_string(DownloadStatus s)
    {
        switch (s)
        {
            case DownloadStatus::idle:        return "idle";
            case DownloadStatus::downloading: return "downloading";
            case DownloadStatus::completed:   return "completed";
            case DownloadStatus::failed:      return "failed";
            case DownloadStatus::cancelled:   return "cancelled";
        }
        return "unknown";
    }

    static std::string escape_json_string(const std::string& s)
    {
        std::string out;
        out.reserve(s.size() + 4);
        for (unsigned char c : s)
        {
            switch (c)
            {
                case '"':  out += "\\\""; break;
                case '\\': out += "\\\\"; break;
                case '\n': out += "\\n";  break;
                case '\r': out += "\\r";  break;
                case '\t': out += "\\t";  break;
                default:
                    if (c < 0x20)
                    {
                        char buf[8];
                        std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                        out += buf;
                    }
                    else
                    {
                        out += static_cast<char>(c);
                    }
                    break;
            }
        }
        return out;
    }

    /// Generate a unique download ID using a monotonic nanosecond timestamp.
    static std::string generate_download_id()
    {
        auto ns = std::chrono::steady_clock::now().time_since_epoch().count();
        return "dl_" + std::to_string(ns);
    }

    // Download state
    struct DownloadState
    {
        std::string            download_id;
        std::string            model_id;
        std::string            dest_path;   ///< Final file path
        std::string            tmp_path;    ///< Partial file path ("<dest>.tmp")
        int64_t                total_bytes{0};
        DownloadStatus         status{DownloadStatus::idle};
        std::string            error_message;
        std::atomic<bool>      cancel_requested{false};
        std::thread            worker;
    };

    struct ModelDownloader::Impl
    {
        mutable std::mutex                                      mutex;
        std::map<std::string, std::shared_ptr<DownloadState>>   downloads;
    };

    ModelDownloader::ModelDownloader(const ModelDownloaderConfig& config)
        : m_models_dir(config.models_dir)
        , m_user_agent(config.user_agent)
        , m_catalog(config.catalog)
        , m_impl(std::make_unique<Impl>())
    {
        if (!m_models_dir.empty() && !fs::exists(m_models_dir))
        {
            std::error_code ec;
            fs::create_directories(m_models_dir, ec);
            if (ec)
            {
                std::cerr << "[ModelDownloader] Failed to create models_dir '"
                          << m_models_dir << "': " << ec.message() << std::endl;
            }
        }
    }

    ModelDownloader::~ModelDownloader()
    {
        // Signal all active downloads to cancel, then detach so the process can exit.
        std::lock_guard<std::mutex> lock(m_impl->mutex);
        for (auto& [id, state] : m_impl->downloads)
        {
            state->cancel_requested.store(true);
            if (state->worker.joinable())
            {
                state->worker.detach();
            }
        }
    }


    std::string ModelDownloader::list_models() const
    {
        std::ostringstream oss;
        oss << "[";
        bool first = true;
        for (const auto& m : g_catalog)
        {
            if (!first) oss << ",";
            first = false;
            // clang-format off
            oss << "{"
                << "\"id\":\""          << escape_json_string(m.id)          << "\","
                << "\"name\":\""        << escape_json_string(m.name)        << "\","
                << "\"description\":\"" << escape_json_string(m.description) << "\","
                << "\"filename\":\""    << escape_json_string(m.filename)    << "\","
                << "\"size_bytes\":"    << m.size_bytes                      << ","
                << "\"downloaded\":"    << (is_downloaded(m.id) ? "true" : "false")
                << "}";
            // clang-format on
        }
        oss << "]";
        return oss.str();
    }


    std::string ModelDownloader::start_download(const std::string& model_id)
    {
        // Validate model exists in catalog
        const ModelInfo* info = nullptr;
        for (const auto& m : g_catalog)
        {
            if (m.id == model_id)
            {
                info = &m;
                break;
            }
        }
        if (!info)
        {
            return "error: unknown model id '" + model_id + "'";
        }

        // Already downloaded?
        if (is_downloaded(model_id))
        {
            return "error: already downloaded";
        }

        {
            std::lock_guard<std::mutex> lock(m_impl->mutex);
            // Already downloading?  Return existing download_id.
            for (const auto& [id, state] : m_impl->downloads)
            {
                if (state->model_id == model_id &&
                    state->status == DownloadStatus::downloading)
                {
                    return id;
                }
            }
        }

        const std::string download_id = generate_download_id();
        const std::string dest_path   = (fs::path(m_models_dir) / info->filename).string();
        const std::string tmp_path    = dest_path + ".tmp";

        auto state           = std::make_shared<DownloadState>();
        state->download_id   = download_id;
        state->model_id      = model_id;
        state->dest_path     = dest_path;
        state->tmp_path      = tmp_path;
        state->total_bytes   = info->size_bytes;
        state->status        = DownloadStatus::downloading;

        // Capture by value so the thread owns what it needs
        const std::string url        = info->url;
        const std::string user_agent = m_user_agent;

        state->worker = std::thread(
            [state, url, user_agent]()
            {
                // Remove any stale .tmp left by a previous failed download
                if (fs::exists(state->tmp_path))
                    fs::remove(state->tmp_path);

                // Early cancel check (before network I/O)
                if (state->cancel_requested.load())
                {
                    state->status = DownloadStatus::cancelled;
                    return;
                }

                std::cout << "[ModelDownloader] Starting download: " << state->model_id
                          << " → " << state->tmp_path << '\n';

                // libcurl download (no process spawning)
                FILE* tmp_file = std::fopen(state->tmp_path.c_str(), "wb");
                if (!tmp_file)
                {
                    state->error_message = "Failed to open tmp file for writing: " + state->tmp_path;
                    state->status        = DownloadStatus::failed;
                    return;
                }

                // Write-callback: forwards received data to the file.
                // Returning 0 from the callback aborts the transfer (CURLE_WRITE_ERROR).
                struct WriteCtx { FILE* file; std::atomic<bool>* cancel; };
                WriteCtx wctx{ tmp_file, &state->cancel_requested };

                auto write_cb = [](char* ptr, std::size_t size, std::size_t nmemb, void* ud) -> std::size_t
                {
                    auto* ctx = static_cast<WriteCtx*>(ud);
                    if (ctx->cancel->load()) return 0;           // signal abort
                    return std::fwrite(ptr, size, nmemb, ctx->file);
                };

                CURL* curl = curl_easy_init();
                CURLcode res = CURLE_FAILED_INIT;

                if (curl)
                {
                    curl_easy_setopt(curl, CURLOPT_URL,            url.c_str());
                    curl_easy_setopt(curl, CURLOPT_USERAGENT,      user_agent.c_str());
                    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);          // follow HF redirects
                    curl_easy_setopt(curl, CURLOPT_FAILONERROR,    1L);          // error on 4xx/5xx
                    curl_easy_setopt(curl, CURLOPT_NOPROGRESS,     1L);          // we track via file size
                    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION,  +write_cb);
                    curl_easy_setopt(curl, CURLOPT_WRITEDATA,      &wctx);

                    res = curl_easy_perform(curl);
                    curl_easy_cleanup(curl);
                }

                std::fclose(tmp_file);
                // ─────────────────────────────────────────────────────────────

                // Cancellation wins over any curl error
                if (state->cancel_requested.load())
                {
                    if (fs::exists(state->tmp_path))
                        fs::remove(state->tmp_path);
                    state->status = DownloadStatus::cancelled;
                    std::cout << "[ModelDownloader] Download cancelled: " << state->model_id << '\n';
                    return;
                }

                if (res != CURLE_OK || !fs::exists(state->tmp_path))
                {
                    state->error_message = std::string{"curl error: "} + curl_easy_strerror(res);
                    state->status        = DownloadStatus::failed;
                    if (fs::exists(state->tmp_path))
                        fs::remove(state->tmp_path);
                    std::cerr << "[ModelDownloader] Download failed: " << state->model_id
                              << " — " << state->error_message << '\n';
                    return;
                }

                // Promote .tmp → final destination
                std::error_code ec;
                fs::rename(state->tmp_path, state->dest_path, ec);
                if (ec)
                {
                    state->error_message = "rename failed: " + ec.message();
                    state->status        = DownloadStatus::failed;
                    std::cerr << "[ModelDownloader] " << state->error_message << '\n';
                    return;
                }

                state->status = DownloadStatus::completed;
                std::cout << "[ModelDownloader] Download complete: " << state->model_id
                          << " → " << state->dest_path << '\n';
            });

        {
            std::lock_guard<std::mutex> lock(m_impl->mutex);
            m_impl->downloads[download_id] = state;
        }

        return download_id;
    }


    std::string ModelDownloader::get_progress(const std::string& download_id) const
    {
        std::shared_ptr<DownloadState> state;
        {
            std::lock_guard<std::mutex> lock(m_impl->mutex);
            auto it = m_impl->downloads.find(download_id);
            if (it == m_impl->downloads.end())
            {
                return R"({"error":"not found"})";
            }
            state = it->second;
        }

        int64_t bytes_downloaded = 0;
        if (state->status == DownloadStatus::downloading && fs::exists(state->tmp_path))
        {
            std::error_code ec;
            auto sz = fs::file_size(state->tmp_path, ec);
            if (!ec)
            {
                bytes_downloaded = static_cast<int64_t>(sz);
            }
        }
        else if (state->status == DownloadStatus::completed)
        {
            bytes_downloaded = state->total_bytes;
        }

        std::ostringstream oss;
        // clang-format off
        oss << "{"
            << "\"download_id\":\""      << escape_json_string(state->download_id)   << "\","
            << "\"model_id\":\""         << escape_json_string(state->model_id)       << "\","
            << "\"bytes_downloaded\":"   << bytes_downloaded                          << ","
            << "\"total_bytes\":"        << state->total_bytes                        << ","
            << "\"status\":\""           << status_to_string(state->status)           << "\","
            << "\"error_message\":\""    << escape_json_string(state->error_message)  << "\""
            << "}";
        // clang-format on
        return oss.str();
    }


    bool ModelDownloader::cancel_download(const std::string& download_id)
    {
        std::shared_ptr<DownloadState> state;
        {
            std::lock_guard<std::mutex> lock(m_impl->mutex);
            auto it = m_impl->downloads.find(download_id);
            if (it == m_impl->downloads.end()) return false;
            state = it->second;
        }

        if (state->status != DownloadStatus::downloading) return false;

        // Set cancel flag — the worker thread checks this after curl returns
        state->cancel_requested.store(true);
        // Optimistically mark cancelled so the UI responds immediately
        state->status = DownloadStatus::cancelled;

        // Detach: the thread cleans up the .tmp file asynchronously
        if (state->worker.joinable())
        {
            state->worker.detach();
        }

        std::cout << "[ModelDownloader] Cancel requested: " << state->model_id << std::endl;
        return true;
    }


    bool ModelDownloader::is_downloaded(const std::string& model_id) const
    {
        for (const auto& m : g_catalog)
        {
            if (m.id == model_id)
            {
                auto path = fs::path(m_models_dir) / m.filename;
                std::error_code ec;
                auto sz = fs::file_size(path, ec);
                return !ec && sz > 0;
            }
        }
        return false;
    }


    bool ModelDownloader::delete_model(const std::string& model_id)
    {
        for (const auto& m : g_catalog)
        {
            if (m.id == model_id)
            {
                auto path = fs::path(m_models_dir) / m.filename;
                if (fs::exists(path))
                {
                    std::error_code ec;
                    fs::remove(path, ec);
                    if (!ec)
                    {
                        std::cout << "[ModelDownloader] Deleted: " << path << std::endl;
                        return true;
                    }
                    std::cerr << "[ModelDownloader] Delete failed: " << ec.message() << std::endl;
                }
                return false;
            }
        }
        return false;
    }


    std::string ModelDownloader::get_model_path(const std::string& model_id) const
    {
        for (const auto& m : g_catalog)
        {
            if (m.id == model_id)
            {
                auto path = fs::path(m_models_dir) / m.filename;
                if (fs::exists(path))
                {
                    return fs::absolute(path).string();
                }
                return "";
            }
        }
        return "";
    }

} // namespace saucer::model_downloader

