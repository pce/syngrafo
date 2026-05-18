#pragma once
/**
 * @file core/zone.hh
 * @author Patrick Engel
 * @brief DMS Zone pure value type — no database, no virtuals.
 *
 * A Zone is a named, optionally-encrypted workspace with an inbox (in_path)
 * and an output directory (out_path).  The DB representation lives in
 * dms_handle.hh; this is the raw value type used in business logic and
 * for passing between layers without pulling in SQLite.
 *
 * @code{.cpp}
 *   Zone z{
 *       .name            = "invoices",
 *       .in_path         = "/home/user/Documents/Invoices",
 *       .out_path        = "/home/user/.syngrafo/zones/invoices",
 *       .encrypted       = true,
 *       .taxonomy_domain = "Finance",
 *   };
 * @endcode
 */

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_set>

namespace pce::dms {

enum class BookmarkRoot : uint8_t {
    Source,
    Workspace,
    Notes,
    Kanban,
};

[[nodiscard]] constexpr std::string_view bookmark_root_name(BookmarkRoot root) noexcept {
    switch (root) {
        case BookmarkRoot::Source:    return "source";
        case BookmarkRoot::Workspace: return "workspace";
        case BookmarkRoot::Notes:     return "notes";
        case BookmarkRoot::Kanban:    return "kanban";
    }
    return "workspace";
}

[[nodiscard]] inline std::optional<BookmarkRoot>
bookmark_root_from_string(std::string_view raw) noexcept {
    if (raw == "source")    return BookmarkRoot::Source;
    if (raw == "workspace") return BookmarkRoot::Workspace;
    if (raw == "notes")     return BookmarkRoot::Notes;
    if (raw == "kanban")    return BookmarkRoot::Kanban;
    return std::nullopt;
}

/// Pure value type representing a DMS workspace (zone).
/// No database dependencies — add/remove/query zones through DMSHandle.
struct Zone {
    std::string  name;             ///< Unique short identifier
    std::string  in_path;          ///< Input directory (inbox)
    std::string  out_path;         ///< Output/working directory
    std::string  description;      ///< Human-readable description
    std::string  taxonomy_domain{"General"};  ///< Classification domain
    int64_t      last_visited{0};  ///< Unix timestamp of last activation
    bool         encrypted{false}; ///< Whether the zone DB is encrypted

    [[nodiscard]] bool valid()      const noexcept { return !name.empty() && !in_path.empty(); }
    [[nodiscard]] bool is_global()  const noexcept { return name == "global" || name.empty(); }
};

// ─────────────────────────────────────────────────────────────────────────────
/// A Bookmark is a named quick-jump target that lives *inside* a Zone.
///
/// @par Target format (root-relative materialized path)
///
///   path/to/file.py           → whole file
///   path/to/file.py?10:12     → line range 10–12 (inclusive)
///   path/to/file.py?10:       → from line 10 to EOF
///   path/to/folder/           → directory (trailing slash)
///   path/to/image.png         → image file (kind="image")
///
/// The target is relative to a typed bookmark root (`source`, `workspace`,
/// `notes`, or `kanban`).
///
/// When expressing a bookmark as a URI (e.g. for display or clipboard), use
/// the canonical form:  `/#zone/<root>/<target>`  where `<zone>` is the zone
/// name and `<root>` is `source`, `workspace`, `notes`, or `kanban`.
/// Example:  `/#invoices/workspace/reports/q1.py?5:20`
// ─────────────────────────────────────────────────────────────────────────────
struct Bookmark {
    int64_t     id{0};
    std::string zone_name;          ///< Zone this bookmark belongs to
    std::string label;              ///< User-provided display name
    BookmarkRoot root{BookmarkRoot::Workspace}; ///< Base area inside the zone
    /// Zone-relative path + optional `?<from>:<to>` suffix.
    /// Trailing `/` denotes a directory target.
    std::string target;
    /// "file" | "image" | "folder"  — derived from target if not supplied.
    std::string kind{"file"};
    int64_t     line_from{0};       ///< 0 = not specified
    int64_t     line_to{0};         ///< 0 = not specified (open range)
    int64_t     created_at{0};
    int64_t     updated_at{0};
    int64_t     sort_order{0};

    /// True when the bookmark has been fully initialised.
    [[nodiscard]] bool valid() const noexcept {
        return !zone_name.empty();
    }

    // ── URI helpers ──────────────────────────────────────────────────────────

    /// Return the canonical display URI:  `/#<zone>/<root>/<target>`
    [[nodiscard]] std::string uri() const {
        const std::string prefix = "/#" + zone_name + "/" + std::string{bookmark_root_name(root)};
        return target.empty() ? prefix : prefix + "/" + target;
    }

    /// Parse a `?<from>:<to>` suffix from `raw_target` and return the bare path.
    /// Fills `line_from` / `line_to` as a side-effect.
    static std::string parse_target(std::string_view raw,
                                    int64_t& line_from_out,
                                    int64_t& line_to_out) {
        line_from_out = 0;
        line_to_out   = 0;
        const auto q = raw.rfind('?');
        if (q == std::string_view::npos) return std::string{raw};
        const auto spec = raw.substr(q + 1); // e.g. "10:12" or "10:"
        const auto colon = spec.find(':');
        if (colon == std::string_view::npos) return std::string{raw}; // no colon → not a line spec
        // from
        const auto from_sv = spec.substr(0, colon);
        if (!from_sv.empty()) {
            try { line_from_out = std::stoll(std::string{from_sv}); }
            catch (...) { return std::string{raw}; }
        }
        // to (may be empty → open range)
        const auto to_sv = spec.substr(colon + 1);
        if (!to_sv.empty()) {
            try { line_to_out = std::stoll(std::string{to_sv}); }
            catch (...) {}
        }
        return std::string{raw.substr(0, q)};
    }

    /// Derive kind from a bare (no `?…`) target path.
    static std::string infer_kind(std::string_view bare_path) {
        if (bare_path.empty()) return "folder";
        if (!bare_path.empty() && bare_path.back() == '/') return "folder";
        const auto dot = bare_path.rfind('.');
        if (dot == std::string_view::npos) return "file";
        const std::string ext{bare_path.substr(dot)};
        static const std::unordered_set<std::string> kImg{
            ".jpg",".jpeg",".png",".gif",".bmp",".tiff",".tif",
            ".webp",".heic",".heif",".avif",".tga",".ico",".svg"};
        if (kImg.count(ext)) return "image";
        return "file";
    }
};

} // namespace pce::dms
