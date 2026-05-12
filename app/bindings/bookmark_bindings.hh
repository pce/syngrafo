#pragma once
/**
 * @file bindings/bookmark_bindings.hh
 * @author Patrick Engel
 * @brief Bookmark domain bindings — quick jump targets within Zones.
 *
 * Bookmarks are typed zone-local references, stored in the global DB
 * (zone_bookmarks table) so they survive zone DB re-encryption.
 *
 * Target format (root-relative materialized path):
 *   path/to/file.py           → whole file
 *   path/to/file.py?10:12     → line range 10–12 (inclusive)
 *   path/to/file.py?10:       → from line 10 to EOF
 *   path/to/folder/           → directory
 *   path/to/image.png         → image file
 *
 * Canonical URI:  /#<zone>/<root>/<target>
 */

#include "../dms_handle.hh"
#include "../core/zone.hh"

namespace pce::dms {

inline void register_bookmark_bindings(saucer::smartview& wv, DMSHandle& dms) {
    using std::string;

    wv.expose("dms_bookmark_add",
              [&dms](string zone_name, string root, string label, string target) -> string {
        const auto r = dms.bookmark_add(zone_name, root, label, target);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    wv.expose("dms_bookmark_list", [&dms](string zone_name) -> string {
        const auto r = dms.bookmark_list(zone_name);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    wv.expose("dms_bookmark_delete", [&dms](int id) -> string {
        const auto r = dms.bookmark_delete(static_cast<int64_t>(id));
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    wv.expose("dms_bookmark_update",
              [&dms](int id, string root, string label, string target, int sort_order) -> string {
        const auto r = dms.bookmark_update(static_cast<int64_t>(id), root, label, target, static_cast<int64_t>(sort_order));
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    wv.expose("dms_bookmark_resolve",
              [&dms](string zone_name, string root, string target) -> string {
        const auto r = dms.bookmark_resolve(zone_name, root, target);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });
}

} // namespace pce::dms
