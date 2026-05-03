#pragma once

// Minimal public header for the updater module.
// Implementation details (curl/glaze/saucer) are kept in updater.cpp to
// reduce transitive include surface at compile time.

#include <optional>
#include <string>
#include <vector>

namespace coco
{
    template <typename T> class task;
}

namespace saucer
{
    class smartview_core;
}

namespace saucer::updater
{
    struct ReleaseAsset
    {
        std::string name;
        std::string browser_download_url;
    };

    struct ReleaseInfo
    {
        std::string               tag_name;
        std::string               body;
        bool                      prerelease = false;
        std::vector<ReleaseAsset> assets;
    };

    struct UpdaterConfig
    {
        /// Where to stage downloaded installers (required).
        std::string staging_dir;

        /// User-Agent header sent with every HTTP request.
        /// Defaults to "Syngrafo-Updater/<no version>" — override with the
        /// running build version via SYNGRAFO_VERSION or a similar define.
        std::string user_agent = "Syngrafo-Updater/1.0";

        // ── Update source ─────────────────────────────────────────────────────
        /// Option A – GitHub shorthand: "owner/repo"  (e.g. "pce/syngrafo").
        /// Automatically resolves to:
        ///   https://api.github.com/repos/<owner>/<repo>/releases/latest
        /// Defaults to the Syngrafo project repo when using make_syngrafo_updater().
        std::optional<std::string> github_repo;

        /// Option B – Explicit URL override (takes precedence over github_repo).
        /// May contain the literal substring {repo} which is substituted by the
        /// value of github_repo (if set), otherwise left unchanged.
        /// Use this to point at a self-hosted release feed.
        std::optional<std::string> update_source_url;

        // ── Version control ───────────────────────────────────────────────────
        /// Running application version (semver, e.g. "1.2.0" or "v1.2.0").
        /// check_for_updates() returns std::nullopt when the latest release tag
        /// is not strictly newer than this string.
        /// Set to "0.0.0" (the default) to always return release info regardless
        /// of the remote version — useful during development/testing.
        std::string current_version = "0.0.0";

        /// When false (default) pre-release tags are skipped.
        bool include_prerelease = false;
    };

    class Updater
    {
      public:
        explicit Updater(const UpdaterConfig& config);
        virtual ~Updater() = default;

      public:
        /// Fetch the latest release via libcurl.  Returns std::nullopt when:
        ///   • the network request fails,
        ///   • the remote version is not strictly newer than current_version, or
        ///   • include_prerelease is false and the latest tag is a pre-release.
        [[nodiscard]] coco::task<std::optional<ReleaseInfo>> check_for_updates();

        [[nodiscard]] coco::task<bool> download_and_install(const ReleaseInfo& release);

      public:
        static std::string get_os_version();
        bool               is_update_pending();

        /// Returns the current_version string passed via UpdaterConfig.
        [[nodiscard]] const std::string& current_version() const noexcept;

      private:
        std::string                m_update_stage_dir;
        std::string                m_user_agent;
        std::optional<std::string> m_github_repo;
        std::optional<std::string> m_update_source_url;
        std::string                m_current_version;
        bool                       m_include_prerelease;

      private:
        [[nodiscard]] coco::task<bool> run_installer(const std::string& path);

        /// Builds the resolved HTTP URL from the config fields.
        [[nodiscard]] std::string build_url() const;

        /// Returns true when `latest` is strictly newer than `current` (semver).
        [[nodiscard]] static bool is_newer_version(const std::string& latest,
                                                   const std::string& current) noexcept;
    };

    // ── Factory helpers ───────────────────────────────────────────────────────

    /// Convenience: create an Updater pre-configured for a GitHub repository.
    ///
    /// @param github_repo      "owner/repo"  (e.g. "pce/syngrafo")
    /// @param staging_dir      Writable directory for staged installers.
    /// @param current_version  Running app version (semver string).
    [[nodiscard]] inline Updater make_github_updater(
        const std::string& github_repo,
        const std::string& staging_dir,
        const std::string& current_version = "0.0.0")
    {
        return Updater(UpdaterConfig{
            .staging_dir     = staging_dir,
            .github_repo     = github_repo,
            .current_version = current_version,
        });
    }

    /// Convenience: create an Updater pre-configured for the Syngrafo project.
    /// Uses the canonical GitHub repository https://github.com/pce/syngrafo.
    ///
    /// @param staging_dir      Writable directory for staged installers.
    /// @param current_version  Running app version (semver string).
    [[nodiscard]] inline Updater make_syngrafo_updater(
        const std::string& staging_dir,
        const std::string& current_version = "0.0.0")
    {
        return Updater(UpdaterConfig{
            .staging_dir     = staging_dir,
            .user_agent      = "Syngrafo-Updater/" + current_version,
            .github_repo     = "pce/syngrafo",
            .current_version = current_version,
        });
    }

} // namespace saucer::updater
