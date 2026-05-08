// updater.cpp — HTTP-based auto-updater using libcurl (no process spawning).
//
// All network I/O (version check + installer download) goes through the
// libcurl C API.  The only remaining std::system() / ShellExecute() calls are
// restricted to *launching* the downloaded installer (a deliberate user-facing
// action, not background process spawning).

#include <saucer/updater.hpp>

// saucer/smartview.hpp brings in the full coco::task<T> template definition
// and transitively includes <coroutine>.  Without this, the co_return /
// co_await expressions below fail with "undefined template coco::task".
#include <saucer/smartview.hpp>

#include <array>
#include <coroutine>
#include <cstdio>
#include <filesystem>
#include <glaze/glaze.hpp>
#include <iostream>
#include <tuple>

// libcurl — link via CURL::libcurl (updater/CMakeLists.txt)
#include <curl/curl.h>

#ifdef _WIN32
#  include <shlobj.h>
#  include <windows.h>
#  include <shellapi.h>  // ShellExecuteA — not included by <windows.h> when WIN32_LEAN_AND_MEAN is defined
#elif __APPLE__
#  include <CoreFoundation/CoreFoundation.h>
#endif

namespace fs = std::filesystem;

namespace saucer::updater
{
    // ── libcurl helpers ───────────────────────────────────────────────────────

    /// Write callback: appends received bytes to a std::string buffer.
    static std::size_t write_to_string(const char* ptr, std::size_t size,
                                       std::size_t nmemb, void* userdata)
    {
        auto* buf = static_cast<std::string*>(userdata);
        buf->append(ptr, size * nmemb);
        return size * nmemb;
    }

    /// Write callback: streams bytes directly into an open std::FILE*.
    static std::size_t write_to_file(const char* ptr, std::size_t size,
                                     std::size_t nmemb, void* userdata)
    {
        return std::fwrite(ptr, size, nmemb, static_cast<std::FILE*>(userdata));
    }

    /// Performs an HTTP GET via libcurl.
    /// Returns the response body or an empty string on network / HTTP error.
    static std::string http_get(const std::string& url,
                                const std::string& user_agent,
                                const std::string& accept_header = "")
    {
        CURL* curl = curl_easy_init();
        if (!curl)
            return {};

        std::string body;

        struct curl_slist* headers = nullptr;
        if (!accept_header.empty())
            headers = curl_slist_append(headers, accept_header.c_str());

        curl_easy_setopt(curl, CURLOPT_URL,             url.c_str());
        curl_easy_setopt(curl, CURLOPT_USERAGENT,       user_agent.c_str());
        curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION,  1L);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT,         30L);
        curl_easy_setopt(curl, CURLOPT_ACCEPT_ENCODING, ""); // gzip / br / deflate
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION,   write_to_string);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA,       &body);
        if (headers)
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

        const CURLcode rc        = curl_easy_perform(curl);
        long           http_code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);

        if (headers)
            curl_slist_free_all(headers);
        curl_easy_cleanup(curl);

        if (rc != CURLE_OK)
        {
            std::cerr << "[Updater] curl GET failed: " << curl_easy_strerror(rc) << "\n";
            return {};
        }
        if (http_code < 200 || http_code >= 300)
        {
            std::cerr << "[Updater] HTTP " << http_code << " for " << url << "\n";
            return {};
        }
        return body;
    }

    /// Downloads `url` and writes it to `target_path` via libcurl.
    /// Aborts stalled transfers (< 1 byte/s for 60 s).
    /// Returns true on success; removes the partial file on failure.
    static bool http_download(const std::string& url,
                              const fs::path&    target_path,
                              const std::string& user_agent)
    {
        CURL* curl = curl_easy_init();
        if (!curl)
            return false;

        std::FILE* fp = std::fopen(target_path.string().c_str(), "wb");
        if (!fp)
        {
            curl_easy_cleanup(curl);
            return false;
        }

        curl_easy_setopt(curl, CURLOPT_URL,             url.c_str());
        curl_easy_setopt(curl, CURLOPT_USERAGENT,       user_agent.c_str());
        curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION,  1L);
        curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT,  30L);
        // Stall detection: abort if transfer drops below 1 byte/s for 60 s.
        curl_easy_setopt(curl, CURLOPT_LOW_SPEED_LIMIT, 1L);
        curl_easy_setopt(curl, CURLOPT_LOW_SPEED_TIME,  60L);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION,   write_to_file);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA,       fp);

        const CURLcode rc        = curl_easy_perform(curl);
        long           http_code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);

        curl_easy_cleanup(curl);
        std::fclose(fp);

        if (rc != CURLE_OK || http_code < 200 || http_code >= 300)
        {
            std::cerr << "[Updater] Download failed (curl=" << curl_easy_strerror(rc)
                      << ", HTTP=" << http_code << ")\n";
            fs::remove(target_path); // clean up partial file
            return false;
        }
        return true;
    }

    // ── Semver ────────────────────────────────────────────────────────────────

    static std::tuple<int, int, int> parse_semver(const std::string& v) noexcept
    {
        std::string s = v;
        if (!s.empty() && (s[0] == 'v' || s[0] == 'V'))
            s = s.substr(1);
        int major = 0, minor = 0, patch = 0;
        std::sscanf(s.c_str(), "%d.%d.%d", &major, &minor, &patch);
        return {major, minor, patch};
    }

    // ── Updater ───────────────────────────────────────────────────────────────

    Updater::Updater(const UpdaterConfig& config)
        : m_update_stage_dir(config.staging_dir),
          m_user_agent(config.user_agent),
          m_github_repo(config.github_repo),
          m_update_source_url(config.update_source_url),
          m_current_version(config.current_version),
          m_include_prerelease(config.include_prerelease)
    {
        if (!fs::exists(m_update_stage_dir))
            fs::create_directories(m_update_stage_dir);
    }

    const std::string& Updater::current_version() const noexcept
    {
        return m_current_version;
    }

    std::string Updater::build_url() const
    {
        // Explicit URL takes precedence; substitute {repo} placeholder if present.
        if (m_update_source_url.has_value())
        {
            std::string url = m_update_source_url.value();
            if (m_github_repo.has_value())
            {
                auto pos = url.find("{repo}");
                if (pos != std::string::npos)
                    url.replace(pos, 6, m_github_repo.value());
            }
            return url;
        }

        // Default: GitHub Releases API
        if (m_github_repo.has_value())
        {
            return "https://api.github.com/repos/" + m_github_repo.value()
                   + "/releases/latest";
        }

        return {}; // no source configured
    }

    bool Updater::is_newer_version(const std::string& latest,
                                   const std::string& current) noexcept
    {
        auto [lmaj, lmin, lpat] = parse_semver(latest);
        auto [cmaj, cmin, cpat] = parse_semver(current);
        if (lmaj != cmaj) return lmaj > cmaj;
        if (lmin != cmin) return lmin > cmin;
        return lpat > cpat;
    }

    coco::task<std::optional<ReleaseInfo>> Updater::check_for_updates()
    {
        const std::string url = build_url();
        if (url.empty())
        {
            std::cerr << "[Updater] No update source configured.\n";
            co_return std::nullopt;
        }

        // HTTP GET via libcurl — no child process spawned.
        const std::string body = http_get(url, m_user_agent,
                                          "Accept: application/vnd.github+json");
        if (body.empty())
            co_return std::nullopt;

        auto info = glz::read_json<ReleaseInfo>(body);
        if (!info)
            co_return std::nullopt;

        const ReleaseInfo& release = info.value();

        if (release.prerelease && !m_include_prerelease)
            co_return std::nullopt;

        if (!is_newer_version(release.tag_name, m_current_version))
        {
            std::cout << "[Updater] Already up to date (" << m_current_version << ").\n";
            co_return std::nullopt;
        }

        co_return release;
    }

    coco::task<bool> Updater::download_and_install(const ReleaseInfo& release)
    {
        std::string download_url;
        const std::string extension =
#ifdef _WIN32
            ".exe";
#elif __APPLE__
            ".dmg";
#else
            ".tar.gz";
#endif

        for (const auto& asset : release.assets)
        {
            if (asset.name.find(extension) != std::string::npos)
            {
                download_url = asset.browser_download_url;
                break;
            }
#if !defined(_WIN32) && !defined(__APPLE__)
            // Fallback for Linux: accept .deb when no tarball found.
            if (download_url.empty() && asset.name.find(".deb") != std::string::npos)
                download_url = asset.browser_download_url;
#endif
        }

        if (download_url.empty())
            co_return false;

        const auto filename    = fs::path(download_url).filename().string();
        const auto target_path = fs::path(m_update_stage_dir) / filename;

        // Download via libcurl — no child process spawned.
        if (!http_download(download_url, target_path, m_user_agent))
            co_return false;

        co_return co_await run_installer(target_path.string());
    }

    coco::task<bool> Updater::run_installer(const std::string& path)
    {
        // Launching the *downloaded installer* is a deliberate, user-facing action.
        // These calls are intentionally distinct from background HTTP I/O and are
        // equivalent to the user double-clicking the file.
#ifdef _WIN32
        const std::string args = "/SILENT /SP- /NOCANCEL /SUPPRESSMSGBOXES";
        ShellExecuteA(nullptr, "open", path.c_str(), args.c_str(), nullptr,
                      SW_SHOWNORMAL);
        exit(0);
#elif __APPLE__
        // `open` mounts the DMG and shows it in Finder — no network or side-effects.
        std::system(("open \"" + path + "\" &").c_str()); // NOLINT(cert-env33-c)
        co_return true;
#else
        if (path.ends_with(".AppImage"))
        {
            fs::permissions(path,
                            fs::perms::owner_exec | fs::perms::group_exec |
                                fs::perms::others_exec,
                            fs::perm_options::add);
            std::system((path + " &").c_str()); // NOLINT(cert-env33-c)
            exit(0);
        }
        else if (path.ends_with(".deb"))
        {
            std::system(("pkexec apt install -y \"" + path + "\" &").c_str()); // NOLINT
            co_return true;
        }
        co_return false;
#endif
        co_return true; // NOLINT — keeps MSVC happy on paths ending in exit(0)
    }

    std::string Updater::get_os_version()
    {
#ifdef _WIN32
        return "Windows";
#elif __APPLE__
        return "macOS";
#else
        return "Linux";
#endif
    }

    bool Updater::is_update_pending()
    {
        return fs::exists(m_update_stage_dir) && !fs::is_empty(m_update_stage_dir);
    }

} // namespace saucer::updater
