#include <catch2/catch_test_macros.hpp>
#include <saucer/model_downloader.hpp>

#include <filesystem>
#include <fstream>
#include <string>

namespace fs = std::filesystem;
using namespace saucer::model_downloader;

// ── Helpers ──────────────────────────────────────────────────────────────────

static ModelDownloaderConfig make_config(const std::string& dir)
{
    return {.models_dir = dir, .user_agent = "test/1.0"};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

TEST_CASE("ModelDownloader - list_models returns non-empty JSON", "[model_downloader]")
{
    fs::path tmp = fs::temp_directory_path() / "model_dl_test_list";
    fs::create_directories(tmp);
    ModelDownloader dl(make_config(tmp.string()));

    std::string json = dl.list_models();
    REQUIRE(!json.empty());
    REQUIRE(json.front() == '[');
    REQUIRE(json.back() == ']');
    // Should contain at least one entry
    REQUIRE(json.find("phi-3.5-mini-q4") != std::string::npos);
    REQUIRE(json.find("downloaded") != std::string::npos);

    fs::remove_all(tmp);
}

TEST_CASE("ModelDownloader - start_download rejects unknown model", "[model_downloader]")
{
    fs::path tmp = fs::temp_directory_path() / "model_dl_test_unknown";
    fs::create_directories(tmp);
    ModelDownloader dl(make_config(tmp.string()));

    std::string result = dl.start_download("does-not-exist");
    REQUIRE(result.starts_with("error:"));

    fs::remove_all(tmp);
}

TEST_CASE("ModelDownloader - is_downloaded returns false when file absent", "[model_downloader]")
{
    fs::path tmp = fs::temp_directory_path() / "model_dl_test_absent";
    fs::create_directories(tmp);
    ModelDownloader dl(make_config(tmp.string()));

    REQUIRE_FALSE(dl.is_downloaded("phi-3.5-mini-q4"));

    fs::remove_all(tmp);
}

TEST_CASE("ModelDownloader - is_downloaded returns true when file present", "[model_downloader]")
{
    fs::path tmp = fs::temp_directory_path() / "model_dl_test_present";
    fs::create_directories(tmp);

    // Plant a fake file with the expected filename
    auto fake_file = tmp / "Phi-3.5-mini-instruct-Q4_K_M.gguf";
    {
        std::ofstream ofs(fake_file);
        ofs << "fake model data";
    }

    ModelDownloader dl(make_config(tmp.string()));
    REQUIRE(dl.is_downloaded("phi-3.5-mini-q4"));
    REQUIRE(dl.get_model_path("phi-3.5-mini-q4") == fs::absolute(fake_file).string());

    fs::remove_all(tmp);
}

TEST_CASE("ModelDownloader - delete_model removes the file", "[model_downloader]")
{
    fs::path tmp = fs::temp_directory_path() / "model_dl_test_delete";
    fs::create_directories(tmp);

    auto fake_file = tmp / "Phi-3.5-mini-instruct-Q4_K_M.gguf";
    {
        std::ofstream ofs(fake_file);
        ofs << "fake model data";
    }

    ModelDownloader dl(make_config(tmp.string()));
    REQUIRE(dl.is_downloaded("phi-3.5-mini-q4"));
    REQUIRE(dl.delete_model("phi-3.5-mini-q4"));
    REQUIRE_FALSE(dl.is_downloaded("phi-3.5-mini-q4"));

    fs::remove_all(tmp);
}

TEST_CASE("ModelDownloader - get_progress returns error for unknown download_id", "[model_downloader]")
{
    fs::path tmp = fs::temp_directory_path() / "model_dl_test_progress";
    fs::create_directories(tmp);
    ModelDownloader dl(make_config(tmp.string()));

    std::string progress = dl.get_progress("dl_does_not_exist");
    REQUIRE(progress.find("error") != std::string::npos);

    fs::remove_all(tmp);
}

TEST_CASE("ModelDownloader - start_download returns error if already downloaded", "[model_downloader]")
{
    fs::path tmp = fs::temp_directory_path() / "model_dl_test_already";
    fs::create_directories(tmp);

    auto fake_file = tmp / "Phi-3.5-mini-instruct-Q4_K_M.gguf";
    {
        std::ofstream ofs(fake_file);
        ofs << "fake";
    }

    ModelDownloader dl(make_config(tmp.string()));
    std::string result = dl.start_download("phi-3.5-mini-q4");
    REQUIRE(result.starts_with("error:"));

    fs::remove_all(tmp);
}

