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
 *       .out_path        = "/home/user/.papiere/zones/invoices",
 *       .encrypted       = true,
 *       .taxonomy_domain = "Finance",
 *   };
 * @endcode
 */

#include <cstdint>
#include <string>

namespace pce::dms {

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

} // namespace pce::dms

