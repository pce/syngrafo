#pragma once
/**
 * @file services/zone/zone_storage_service.hh
 * @brief ZoneStorageService — cross-platform disk-usage query for Zone paths.
 *
 * Wraps `std::filesystem::space` (C++17) to return a structured JSON report
 * for one or both paths associated with a Zone:
 *
 * @code
 * {
 *   "zone":      "my-project",
 *   "in_path":  {
 *     "path":       "/Users/me/Documents/my-project",
 *     "capacity":   512110190592,
 *     "free":        78123450000,
 *     "available":   78123450000,
 *     "used":       433986740592,
 *     "used_ratio":  0.848
 *   },
 *   "out_path": { … }   // only present when out_path differs from in_path
 * }
 * @endcode
 *
 * Works on macOS, Linux and Windows — resolves to the underlying volume even
 * for deeply nested zone directories.
 */

#include "../../dms_monadic.hh"

#include <filesystem>
#include <format>
#include <string>
#include <string_view>

#include <nlohmann/json.hpp>

namespace pce::dms {

namespace fs = std::filesystem;
using json   = nlohmann::json;

/**
 * @class ZoneStorageService
 * @brief Stateless helper: converts a path → disk-usage JSON.
 *
 * No database access; callers supply the resolved paths they fetched from the
 * zone row.  Lives in DMSHandle purely as a named dependency.
 */
class ZoneStorageService {
public:
    ZoneStorageService() = default;

    /**
     * Query disk-usage for `path` (any depth — resolves to the volume root).
     *
     * Returns an error string via `std::unexpected` if:
     *   - the path does not exist
     *   - the OS reports a permission error
     *   - `std::filesystem::space` fails for any reason
     */
    [[nodiscard]] Expected<json> usage_for(std::string_view path_sv) const noexcept {
        const fs::path p{path_sv};

        std::error_code ec;
        if (!fs::exists(p, ec) || ec)
            return std::unexpected(std::format("path does not exist: '{}'", path_sv));

        const auto info = fs::space(p, ec);
        if (ec)
            return std::unexpected(std::format("space() failed for '{}': {}", path_sv, ec.message()));

        // Defensive: some network/virtual mounts report 0 capacity
        if (info.capacity == 0)
            return std::unexpected(std::format("no capacity reported for '{}' (virtual/network mount?)", path_sv));

        const auto capacity  = static_cast<int64_t>(info.capacity);
        const auto available = static_cast<int64_t>(info.available);
        const auto free_     = static_cast<int64_t>(info.free);
        const auto used      = capacity - free_;
        const double used_ratio =
            capacity > 0 ? static_cast<double>(used) / static_cast<double>(capacity) : 0.0;

        return json{
            {"path",       p.string()},
            {"capacity",   capacity},
            {"free",       free_},
            {"available",  available},
            {"used",       used},
            {"used_ratio", std::round(used_ratio * 1000.0) / 1000.0},   // 3 decimal places
        };
    }

    /**
     * Build the full zone disk-usage report.
     * When `in_path` and `out_path` resolve to the same volume the `out_path`
     * entry is omitted to avoid polluting the payload with duplicates.
     *
     * @param zone_name  Display name embedded in the JSON.
     * @param in_path    Zone input directory.
     * @param out_path   Zone output / workspace directory (may equal in_path).
     */
    [[nodiscard]] Expected<json> zone_usage(std::string_view zone_name,
                                             std::string_view in_path,
                                             std::string_view out_path) const noexcept {
        auto in_result = usage_for(in_path);
        if (!in_result) return std::unexpected(in_result.error());

        json payload{
            {"zone",    std::string{zone_name}},
            {"in_path", *in_result},
        };

        // Include out_path only when it is on a different volume
        if (!out_path.empty() && out_path != in_path) {
            // Compare canonical root — same capacity == same volume (heuristic)
            std::error_code ec;
            const auto out_fs = fs::space(fs::path{out_path}, ec);
            if (!ec && out_fs.capacity != static_cast<uintmax_t>((*in_result)["capacity"].get<int64_t>())) {
                auto out_result = usage_for(out_path);
                if (out_result) payload["out_path"] = *out_result;
            }
        }

        return payload;
    }
};

} // namespace pce::dms

