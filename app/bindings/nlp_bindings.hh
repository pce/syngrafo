#pragma once
/**
 * @file bindings/nlp_bindings.hh
 * @author Patrick Engel
 * @brief NLP/search domain bindings: index, bulk-index, semantic search,
 *        status, metadata, zone management, OCR redirect, file-to-zone.
 */

#pragma once
#include "../dms_handle.hh"

namespace pce::dms {

inline void register_nlp_bindings(saucer::smartview& wv, DMSHandle& dms,
                                   saucer::modules::desktop& /*desk*/) {
    using std::string;

    // ── dms_index_document ────────────────────────────────────────────────────
    wv.expose("dms_index_document", [&dms](string path) -> string {
        const auto r=dms.index_document(path);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // ── dms_bulk_index ────────────────────────────────────────────────────────
    wv.expose("dms_bulk_index", [&dms](string dir) -> string {
        const auto r=dms.bulk_index_start(dir);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // ── dms_bulk_index_zone ───────────────────────────────────────────────────
    wv.expose("dms_bulk_index_zone", [&dms]() -> string {
        const std::string path=dms.get_active_in_path();
        if (path.empty()||path=="data")
            return DMSHandle::err_str("No active zone — activate a zone first.");
        const auto r=dms.bulk_index_start(path);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // ── dms_bulk_stop ─────────────────────────────────────────────────────────
    wv.expose("dms_bulk_stop", [&dms]() -> string {
        dms.bulk_index_stop();
        return DMSHandle::ok_str(json{{"stopped",true}});
    });

    // ── dms_search ────────────────────────────────────────────────────────────
    wv.expose("dms_search", [&dms](string query, int top_k) -> string {
        const auto r=dms.search(query,top_k);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // ── dms_index_status ─────────────────────────────────────────────────────
    wv.expose("dms_index_status", [&dms]() -> string {
        const auto r=dms.index_status();
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // ── dms_get_metadata ─────────────────────────────────────────────────────
    wv.expose("dms_get_metadata", [&dms](string path) -> string {
        const auto r=dms.get_metadata(path);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // ── dms_get_zones ─────────────────────────────────────────────────────────
    wv.expose("dms_get_zones", [&dms]() -> string {
        const auto r=dms.get_zones();
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // ── dms_upsert_zone ───────────────────────────────────────────────────────
    wv.expose("dms_upsert_zone",
              [&dms](string name, string in_path, string out_path,
                     std::optional<string> password, string description,
                     string taxonomy_domain) -> string {
        const auto r=dms.upsert_zone(name,in_path,out_path,password,
                                      description,taxonomy_domain);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // ── dms_open_zone_db ─────────────────────────────────────────────────────
    wv.expose("dms_open_zone_db",
              [&dms](string zone_name, std::optional<string> password) -> string {
        if (zone_name=="global"||zone_name=="") {
            dms.bulk_index_stop();
            std::lock_guard lk{dms.db_mutex};
            dms.zone_db=std::nullopt;
            dms.active_zone_name="global";
            return DMSHandle::ok_str(json{{"status","reset_to_global"}});
        }
        auto r=dms.open_zone_db(zone_name,password);
        if (!r) return DMSHandle::err_str(r.error());
        dms.bulk_index_stop();
        std::lock_guard lk{dms.db_mutex};
        dms.zone_db=std::make_optional(std::move(*r));
        dms.active_zone_name=zone_name;
        return DMSHandle::ok_str(json{{"status","switched"},{"zone",zone_name}});
    });

    // ── dms_import_to_zone ────────────────────────────────────────────────────
    wv.expose("dms_import_to_zone",
              [&dms](string path, string zone_name, bool compress, bool scan) -> string {
        const auto r=dms.import_to_zone(path,zone_name,compress,scan);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // ── dms_file_to_zone ──────────────────────────────────────────────────────
    wv.expose("dms_file_to_zone",
              [&dms](string path, string zone_name) -> string {
        const auto r=dms.file_to_zone(path,zone_name);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // ── dms_zone_disk_usage ───────────────────────────────────────────────────
    wv.expose("dms_zone_disk_usage", [&dms](string zone_name) -> string {
        const auto r = dms.zone_disk_usage(zone_name);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });
}

} // namespace pce::dms

