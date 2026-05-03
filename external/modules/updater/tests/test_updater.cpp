#include <catch2/catch_test_macros.hpp>
#include <saucer/updater.hpp>
#include <filesystem>
#include <cstdlib>

using namespace saucer::updater;

// ── UpdaterConfig defaults ────────────────────────────────────────────────────

TEST_CASE("UpdaterConfig: explicit fields are stored correctly", "[updater][config]")
{
    UpdaterConfig cfg;
    cfg.staging_dir      = "test-updates";
    cfg.user_agent       = "Test-Agent";
    cfg.update_source_url = "https://example.com/releases/latest";
    cfg.github_repo       = "test/repo";
    cfg.current_version   = "1.2.3";
    cfg.include_prerelease = true;

    REQUIRE(cfg.staging_dir == "test-updates");
    REQUIRE(cfg.user_agent == "Test-Agent");
    REQUIRE(cfg.update_source_url.has_value());
    REQUIRE(*cfg.update_source_url == "https://example.com/releases/latest");
    REQUIRE(cfg.github_repo.has_value());
    REQUIRE(*cfg.github_repo == "test/repo");
    REQUIRE(cfg.current_version == "1.2.3");
    REQUIRE(cfg.include_prerelease == true);
}

TEST_CASE("UpdaterConfig: defaults", "[updater][config]")
{
    UpdaterConfig cfg;
    cfg.staging_dir = "tmp";

    REQUIRE(cfg.user_agent == "Syngrafo-Updater/1.0");
    REQUIRE(cfg.current_version == "0.0.0");
    REQUIRE_FALSE(cfg.include_prerelease);
    REQUIRE_FALSE(cfg.github_repo.has_value());
    REQUIRE_FALSE(cfg.update_source_url.has_value());
}

// ── make_github_updater factory ───────────────────────────────────────────────

TEST_CASE("make_github_updater: constructs with github_repo shorthand", "[updater][factory]")
{
    auto u = make_github_updater("owner/repo", "tmp-staging", "2.0.0");
    REQUIRE(u.current_version() == "2.0.0");
}

TEST_CASE("make_github_updater: defaults current_version to 0.0.0", "[updater][factory]")
{
    auto u = make_github_updater("owner/repo", "tmp-staging");
    REQUIRE(u.current_version() == "0.0.0");
}

// ── make_syngrafo_updater factory ─────────────────────────────────────────────

TEST_CASE("make_syngrafo_updater: uses pce/syngrafo repo", "[updater][factory]")
{
    auto u = make_syngrafo_updater("tmp-staging", "1.0.0");
    REQUIRE(u.current_version() == "1.0.0");
}

TEST_CASE("make_syngrafo_updater: defaults current_version to 0.0.0", "[updater][factory]")
{
    auto u = make_syngrafo_updater("tmp-staging");
    REQUIRE(u.current_version() == "0.0.0");
}

// ── Updater::is_update_pending ────────────────────────────────────────────────

TEST_CASE("is_update_pending: empty staging dir returns false", "[updater]")
{
    UpdaterConfig cfg;
    cfg.staging_dir     = "test-staging-empty-" + std::to_string(std::rand());
    cfg.github_repo     = "owner/repo";
    cfg.current_version = "1.0.0";

    Updater u(cfg);
    // Directory was just created and is empty → pending = false
    REQUIRE_FALSE(u.is_update_pending());

    // Cleanup
    std::filesystem::remove_all(cfg.staging_dir);
}
