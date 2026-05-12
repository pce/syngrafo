#pragma once
/**
 * @file bindings/lifecycle_bindings.hh
 * @brief Document lifecycle/workflow bindings: snapshots, timeline, workflow transitions,
 *        folder dashboard summaries, and document links.
 */

#include "../dms_handle.hh"

namespace pce::dms {

inline void register_lifecycle_bindings(saucer::smartview& wv, DMSHandle& dms,
                                        saucer::modules::desktop& /*desk*/) {
    using std::string;

    wv.expose("dms_document_lifecycle", [&dms](string ref) -> string {
        const auto r = dms.get_document_lifecycle(ref);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    wv.expose("dms_document_timeline", [&dms](string ref, int limit) -> string {
        const auto r = dms.get_document_timeline(ref, limit);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    wv.expose("dms_document_transition",
              [&dms](string ref, string next_state, string actor, string reason) -> string {
        const auto r = dms.transition_document_state(ref, next_state, actor, reason, "ui");
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    wv.expose("dms_zone_workflow", [&dms](string zone_name) -> string {
        const auto r = dms.get_zone_workflow(zone_name);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    wv.expose("dms_save_zone_workflow", [&dms](string zone_name, string payload_json) -> string {
        const auto r = dms.save_zone_workflow(zone_name, payload_json);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    wv.expose("dms_document_workflow_transition",
              [&dms](string ref, string next_state, string actor, string reason) -> string {
        const auto r = dms.transition_document_workflow(ref, next_state, actor, reason, "ui");
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    wv.expose("dms_document_links", [&dms](string ref, int limit) -> string {
        const auto r = dms.get_document_links(ref, limit);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    wv.expose("dms_add_document_link",
              [&dms](string source_ref, string target_ref, string link_type,
                     string note) -> string {
        const auto r = dms.add_document_link(source_ref, target_ref, link_type, note);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    wv.expose("dms_folder_dashboard", [&dms](string path, int limit) -> string {
        const auto r = dms.get_folder_dashboard(path, limit);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });
}

} // namespace pce::dms
