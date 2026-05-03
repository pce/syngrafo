#pragma once
/**
 * @file bindings/bookmark_bindings.hh
 * @author Patrick Engel
 * @brief Bookmark domain bindings — quick jump targets within Zones.
 *
 * Bookmarks are zone-relative path references, stored in the global DB
 * (zone_bookmarks table) so they survive zone DB re-encryption.
 *
 * Target format (zone-relative materialized path):
 *   path/to/file.py           → whole file
 *   path/to/file.py?10:12     → line range 10–12 (inclusive)
 *   path/to/file.py?10:       → from line 10 to EOF
 *   path/to/folder/           → directory
 *   path/to/image.png         → image file
 *
 * Canonical URI:  /#<zone>/<target>
 *
 * All exposed functions use the standard JSON envelope:
 *   success → { "ok": true,  "data": <payload> }
 *   failure → { "ok": false, "error": "<message>" }
 */

#pragma once
#include "../dms_handle.hh"
#include "../core/zone.hh"

namespace pce::dms {

inline void register_bookmark_bindings(saucer::smartview& wv, DMSHandle& dms) {
    using std::string;

    // ── dms_bookmark_add ──────────────────────────────────────────────────────
    // Add a bookmark to a zone.
    // Args: zone_name (string), label (string), target (zone-relative path string)
    // Returns: { id, zone_name, label, target, kind, line_from, line_to, sort_order }
    wv.expose("dms_bookmark_add",
              [&dms](string zone_name, string label, string target) -> string {
        const auto r = dms.bookmark_add(zone_name, label, target);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // ── dms_bookmark_list ─────────────────────────────────────────────────────
    // List all bookmarks for a zone, ordered by sort_order, then id.
    // Args: zone_name (string)
    // Returns: array of bookmark objects
    wv.expose("dms_bookmark_list", [&dms](string zone_name) -> string {
        const auto r = dms.bookmark_list(zone_name);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // ── dms_bookmark_delete ───────────────────────────────────────────────────
    // Delete a bookmark by id.
    // Args: id (int)  — JS numbers arrive as f64; glaze maps them to int fine.
    // Returns: { "deleted": true }
    wv.expose("dms_bookmark_delete", [&dms](int id) -> string {
        const auto r = dms.bookmark_delete(static_cast<int64_t>(id));
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // ── dms_bookmark_update ───────────────────────────────────────────────────
    // Update label, target, and sort_order of an existing bookmark.
    // Args: id (int), label (string), target (string), sort_order (int)
    // Returns: updated bookmark object
    wv.expose("dms_bookmark_update",
              [&dms](int id, string label, string target, int sort_order) -> string {
        const auto r = dms.bookmark_update(static_cast<int64_t>(id), label, target, static_cast<int64_t>(sort_order));
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // ── dms_bookmark_resolve ──────────────────────────────────────────────────
    // Resolve a zone-relative bookmark target to an absolute filesystem path.
    // Args: zone_name (string), target (string)
    // Returns: { abs_path, line_from, line_to, kind, exists }
    wv.expose("dms_bookmark_resolve",
              [&dms](string zone_name, string target) -> string {
        const auto r = dms.bookmark_resolve(zone_name, target);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });
}

} // namespace pce::dms

