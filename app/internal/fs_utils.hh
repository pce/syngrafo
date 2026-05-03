#pragma once
/**
 * @file internal/fs_utils.hh
 * @brief Filesystem helpers: mtime, safe text/binary reads.
 *
 * @note Application-internal. Do not include from external headers.
 */

#include "../dms_monadic.hh"

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <format>
#include <fstream>
#include <string>
#include <vector>

namespace pce::dms {

namespace fs = std::filesystem;

/** File last-write time as a Unix timestamp (seconds). Returns 0 on error. */
[[nodiscard]] inline int64_t file_mtime_unix(const fs::path& p) noexcept {
    std::error_code ec;
    const auto ft = fs::last_write_time(p, ec);
    if (ec) return 0;
    // clock_cast is not yet in all libc++ builds (e.g. Apple Clang).
    const auto sys = std::chrono::system_clock::now() +
        std::chrono::duration_cast<std::chrono::system_clock::duration>(
            ft - fs::file_time_type::clock::now());
    return std::chrono::duration_cast<std::chrono::seconds>(
        sys.time_since_epoch()).count();
}

/** Read up to @p max bytes from @p p as text. */
[[nodiscard]] inline Expected<std::string>
safe_read_text(const fs::path& p, size_t max = 1u << 20) {
    std::error_code ec;
    const auto sz = fs::file_size(p, ec);
    if (ec) return std::unexpected(std::format("stat '{}': {}", p.string(), ec.message()));
    std::ifstream f{p, std::ios::binary};
    if (!f) return std::unexpected(std::format("open '{}': permission denied", p.string()));
    const size_t rsz = std::min((size_t)sz, max);
    std::string buf(rsz, '\0');
    f.read(buf.data(), (std::streamsize)rsz);
    buf.resize((size_t)f.gcount());
    return buf;
}

/** Read up to @p max bytes from @p p as a byte vector. */
[[nodiscard]] inline Expected<std::vector<uint8_t>>
safe_read_binary(const fs::path& p, size_t max = 50u * 1024u * 1024u) {
    std::error_code ec;
    const auto sz = fs::file_size(p, ec);
    if (ec) return std::unexpected(std::format("stat '{}': {}", p.string(), ec.message()));
    if ((size_t)sz > max)
        return std::unexpected(std::format("'{}' exceeds blob size limit", p.string()));
    std::ifstream f{p, std::ios::binary};
    if (!f) return std::unexpected(std::format("open '{}': permission denied", p.string()));
    std::vector<uint8_t> buf((size_t)sz);
    f.read(reinterpret_cast<char*>(buf.data()), (std::streamsize)sz);
    buf.resize((size_t)f.gcount());
    return buf;
}

} // namespace pce::dms

