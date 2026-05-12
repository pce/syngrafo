#pragma once
#include "../../dms_handle.hh"
#include "workflow_helpers.hh"

namespace pce::dms {

inline Expected<json> DMSHandle::get_document_lifecycle(std::string_view ref) {
    auto snapshot = lifecycle_svc_.snapshot(ref);
    if (!snapshot) return snapshot;

    std::lock_guard lk{db_mutex};
    const auto registry = find_document_registry_row_locked(*this, ref);
    if (!registry) return snapshot;

    const auto document_uid = registry->get<std::string>("document_uid");
    const auto state_row = active_db()
                               .from("dms_document_states")
                               .where("document_uid = ?", document_uid)
                               .first();
    if (!state_row) return snapshot;

    const auto zone_name = registry->try_get<std::string>("zone_name").value_or(active_zone_name);
    const auto workflow_id = ensure_default_workflow_locked(*this, zone_name);
    auto workflow_state = state_row->try_get<std::string>("workflow_state_key").value_or("");
    if (workflow_state.empty()) {
        workflow_state = map_technical_state_to_workflow(
            state_row->try_get<std::string>("state").value_or("INPUT"));
        discard(active_db().update("dms_document_states")
            .set("workflow_id", workflow_id)
            .set("workflow_state_key", workflow_state)
            .set("workflow_updated_at", pce::db::now_unix())
            .where("document_uid = ?", document_uid)
            .execute());
    }

    auto& payload = *snapshot;
    payload["workflow"] = json{
        {"id", workflow_id},
        {"zone_name", zone_name},
        {"states", workflow_states_payload_locked(*this, workflow_id)},
        {"current_state", workflow_state},
        {"updated_at", state_row->try_get<int64_t>("workflow_updated_at").value_or(0)},
        {"available_transitions", workflow_transitions_payload_locked(*this, workflow_id, workflow_state)},
    };
    payload["links"] = document_links_payload_locked(*this, ref, 20);
    return payload;
}

inline Expected<json> DMSHandle::get_document_timeline(std::string_view ref, int limit) {
    return lifecycle_svc_.timeline(ref, limit);
}

inline Expected<json> DMSHandle::transition_document_state(std::string_view ref,
                                                           std::string_view next_state,
                                                           std::string_view actor,
                                                           std::string_view reason,
                                                           std::string_view source) {
    const auto parsed = document_state_from_string(next_state);
    if (!parsed)
        return std::unexpected("invalid document state: " + std::string{next_state});
    return lifecycle_svc_.transition_state(ref, *parsed, actor, reason, source);
}

inline Expected<json> DMSHandle::get_zone_workflow(std::string_view zone_name) {
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        const auto resolved_zone = std::string{zone_name.empty() ? active_zone_name : zone_name};
        const auto workflow_id = ensure_default_workflow_locked(*this, resolved_zone);
        const auto row = active_db().from("dms_zone_workflows").where("id = ?", workflow_id).first();
        return json{
            {"id", workflow_id},
            {"zone_name", resolved_zone},
            {"name", row ? row->try_get<std::string>("name").value_or("") : std::string{}},
            {"states", workflow_states_payload_locked(*this, workflow_id)},
            {"transitions", active_db()
                .from("dms_workflow_transitions")
                .where("workflow_id = ?", workflow_id)
                .order_by("sort_order")
                .map<json>([](const pce::db::Row& transition) {
                    return json{
                        {"from", transition.try_get<std::string>("from_state_key").value_or("")},
                        {"to", transition.try_get<std::string>("to_state_key").value_or("")},
                        {"label", transition.try_get<std::string>("label").value_or("")},
                        {"requires_reason", transition.try_get<int64_t>("requires_reason").value_or(0) != 0},
                        {"sort_order", transition.try_get<int64_t>("sort_order").value_or(0)},
                    };
                })},
        };
    });
}

inline Expected<json> DMSHandle::save_zone_workflow(std::string_view zone_name,
                                                    std::string_view payload_json) {
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        const auto resolved_zone = std::string{zone_name.empty() ? active_zone_name : zone_name};
        const auto workflow_id = workflow_id_for_zone(resolved_zone);
        const auto payload = json::parse(std::string{payload_json});
        if (!payload.is_object()) throw std::runtime_error("workflow payload must be an object");

        const auto states = parse_workflow_states_or_throw(payload);
        std::set<std::string> state_keys;
        std::string default_state_key;
        for (const auto& state : states) {
            state_keys.insert(state.key);
            if (state.is_default) default_state_key = state.key;
        }
        const auto transitions = parse_workflow_transitions_or_throw(payload, state_keys);
        const auto name = [&]() {
            const auto raw = payload.value("name", "");
            return raw.empty() ? default_workflow_name(resolved_zone) : raw;
        }();

        auto& db = active_db();
        const auto now = pce::db::now_unix();
        const auto existing_row = db.from("dms_zone_workflows").where("id = ?", workflow_id).first();
        const auto created_at = existing_row ? existing_row->try_get<int64_t>("created_at").value_or(now) : now;

        auto tx = db.transaction();
        discard(db.insert_into("dms_zone_workflows")
            .value("id", workflow_id)
            .value("zone_name", resolved_zone)
            .value("name", name)
            .value("is_default", int64_t{1})
            .value("created_at", created_at)
            .value("updated_at", now)
            .on_conflict_replace()
            .execute());

        discard(db.delete_from("dms_workflow_transitions").where("workflow_id = ?", workflow_id).execute());
        discard(db.delete_from("dms_workflow_states").where("workflow_id = ?", workflow_id).execute());

        for (const auto& state : states) {
            discard(db.insert_into("dms_workflow_states")
                .value("workflow_id", workflow_id)
                .value("state_key", state.key)
                .value("label", state.label)
                .value("color", state.color)
                .value("category", state.category)
                .value("is_default", int64_t{state.is_default ? 1 : 0})
                .value("is_terminal", int64_t{state.is_terminal ? 1 : 0})
                .value("sort_order", state.sort_order)
                .execute());
        }

        for (const auto& transition : transitions) {
            discard(db.insert_into("dms_workflow_transitions")
                .value("workflow_id", workflow_id)
                .value("from_state_key", transition.from)
                .value("to_state_key", transition.to)
                .value("label", transition.label)
                .value("requires_reason", int64_t{transition.requires_reason ? 1 : 0})
                .value("sort_order", transition.sort_order)
                .execute());
        }

        const auto state_rows = db.from("dms_document_states")
            .where("workflow_id = ?", workflow_id)
            .execute();
        for (const auto& row : state_rows) {
            const auto current_state = row.try_get<std::string>("workflow_state_key").value_or("");
            if (current_state.empty() || state_keys.contains(current_state)) continue;
            const auto document_uid = row.get<std::string>("document_uid");
            const auto event_no = row.try_get<int64_t>("latest_event_no").value_or(0) + 1;
            discard(db.insert_into("dms_document_events")
                .value("document_uid", document_uid)
                .value("event_no", event_no)
                .value("event_type", std::string{"WORKFLOW_REMAP"})
                .value("state_from", current_state)
                .value("state_to", default_state_key)
                .value("actor", std::string{"user"})
                .value("reason", std::string{"workflow definition updated"})
                .value("source", std::string{"workflow_editor"})
                .value("payload_json", json{
                    {"workflow_id", workflow_id},
                    {"from", current_state},
                    {"to", default_state_key},
                }.dump())
                .value("created_at", now)
                .execute());
            discard(db.update("dms_document_states")
                .set("workflow_id", workflow_id)
                .set("workflow_state_key", default_state_key)
                .set("workflow_updated_at", now)
                .set("latest_event_no", event_no)
                .set("updated_at", now)
                .where("document_uid = ?", document_uid)
                .execute());
        }

        tx.commit();
        return json{
            {"id", workflow_id},
            {"zone_name", resolved_zone},
            {"name", name},
            {"states", workflow_states_payload_locked(*this, workflow_id)},
            {"transitions", db.from("dms_workflow_transitions")
                .where("workflow_id = ?", workflow_id)
                .order_by("sort_order")
                .map<json>([](const pce::db::Row& transition) {
                    return json{
                        {"from", transition.try_get<std::string>("from_state_key").value_or("")},
                        {"to", transition.try_get<std::string>("to_state_key").value_or("")},
                        {"label", transition.try_get<std::string>("label").value_or("")},
                        {"requires_reason", transition.try_get<int64_t>("requires_reason").value_or(0) != 0},
                        {"sort_order", transition.try_get<int64_t>("sort_order").value_or(0)},
                    };
                })},
        };
    });
}

inline Expected<json> DMSHandle::transition_document_workflow(std::string_view ref,
                                                              std::string_view next_state_key,
                                                              std::string_view actor,
                                                              std::string_view reason,
                                                              std::string_view source) {
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        const auto registry = find_document_registry_row_locked(*this, ref);
        if (!registry) throw std::runtime_error("document not found");
        const auto document_uid = registry->get<std::string>("document_uid");
        const auto zone_name = registry->try_get<std::string>("zone_name").value_or(active_zone_name);
        const auto workflow_id = ensure_default_workflow_locked(*this, zone_name);
        const auto state_row = active_db()
                                   .from("dms_document_states")
                                   .where("document_uid = ?", document_uid)
                                   .first();
        if (!state_row) throw std::runtime_error("document state not found");

        auto current_state = state_row->try_get<std::string>("workflow_state_key").value_or("");
        if (current_state.empty())
            current_state = map_technical_state_to_workflow(
                state_row->try_get<std::string>("state").value_or("INPUT"));
        const auto next_key = std::string{next_state_key};
        if (!active_db().from("dms_workflow_states")
                .where("workflow_id = ?", workflow_id)
                .where("state_key = ?", next_key)
                .exists()) {
            throw std::runtime_error("workflow state does not exist");
        }
        if (current_state != next_key &&
            !active_db().from("dms_workflow_transitions")
                 .where("workflow_id = ?", workflow_id)
                 .where("from_state_key = ?", current_state)
                 .where("to_state_key = ?", next_key)
                 .exists()) {
            throw std::runtime_error("workflow transition is not allowed");
        }

        const auto now = pce::db::now_unix();
        const auto event_no = state_row->try_get<int64_t>("latest_event_no").value_or(0) + 1;
        discard(active_db().insert_into("dms_document_events")
            .value("document_uid", document_uid)
            .value("event_no", event_no)
            .value("event_type", std::string{"WORKFLOW_TRANSITION"})
            .value("state_from", current_state)
            .value("state_to", next_key)
            .value("actor", std::string{actor})
            .value("reason", std::string{reason})
            .value("source", std::string{source})
            .value("payload_json", json{
                {"workflow_id", workflow_id},
                {"zone_name", zone_name},
                {"from", current_state},
                {"to", next_key},
            }.dump())
            .value("created_at", now)
            .execute());
        discard(active_db().update("dms_document_states")
            .set("workflow_id", workflow_id)
            .set("workflow_state_key", next_key)
            .set("workflow_updated_at", now)
            .set("latest_event_no", event_no)
            .set("updated_at", now)
            .where("document_uid = ?", document_uid)
            .execute());
        return json{
            {"document_uid", document_uid},
            {"workflow_id", workflow_id},
            {"workflow_state", next_key},
            {"updated_at", now},
        };
    });
}

inline Expected<json> DMSHandle::add_document_link(std::string_view source_ref,
                                                   std::string_view target_ref,
                                                   std::string_view link_type,
                                                   std::string_view note) {
    if (source_ref.empty() || target_ref.empty())
        return std::unexpected("source_ref and target_ref must not be empty");
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        const auto now = pce::db::now_unix();
        const int64_t id = active_db().insert_into("dms_document_links")
            .value("zone_name", active_zone_name)
            .value("source_ref", std::string{source_ref})
            .value("target_ref", std::string{target_ref})
            .value("link_type", std::string{link_type.empty() ? "depends_on" : link_type})
            .value("note", std::string{note})
            .value("status", std::string{"active"})
            .value("created_at", now)
            .execute();
        return json{
            {"id", id},
            {"zone_name", active_zone_name},
            {"source_ref", source_ref},
            {"target_ref", target_ref},
            {"type", std::string{link_type.empty() ? "depends_on" : link_type}},
            {"note", note},
            {"status", "active"},
            {"created_at", now},
        };
    });
}

inline Expected<json> DMSHandle::get_document_links(std::string_view ref, int limit) {
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        return document_links_payload_locked(*this, ref, std::max(limit, 1));
    });
}

inline Expected<json> DMSHandle::get_folder_dashboard(std::string_view path_str, int limit) {
    std::error_code canon_ec;
    const fs::path raw_path{std::string{path_str}};
    const fs::path folder = fs::weakly_canonical(raw_path, canon_ec);
    return require(fs::exists(folder), std::format("'{}' does not exist", folder.string()))
        .and_then([&]() -> VoidResult {
            return require(fs::is_directory(folder),
                           std::format("'{}' is not a directory", folder.string()));
        })
        .and_then([&]() -> Expected<json> {
            return try_invoke([&]() -> json {
                std::error_code ec;
                int64_t file_count = 0, dir_count = 0, total_size = 0;
                json recent_items = json::array();
                const auto skip = fs::directory_options::skip_permission_denied;
                for (const auto& entry : fs::directory_iterator(folder, skip, ec)) {
                    if (entry.is_directory(ec)) {
                        ++dir_count;
                        continue;
                    }
                    ++file_count;
                    total_size += static_cast<int64_t>(entry.file_size(ec));
                    recent_items.push_back(json{
                        {"name", entry.path().filename().string()},
                        {"path", entry.path().string()},
                        {"mtime", file_mtime_unix(entry.path())},
                        {"size", entry.is_regular_file(ec) ? static_cast<int64_t>(entry.file_size(ec)) : int64_t{0}},
                    });
                }
                std::sort(recent_items.begin(), recent_items.end(), [](const json& lhs, const json& rhs) {
                    return lhs.value("mtime", int64_t{0}) > rhs.value("mtime", int64_t{0});
                });
                if (recent_items.size() > static_cast<size_t>(limit)) recent_items.erase(recent_items.begin() + limit, recent_items.end());

                const auto prefix = folder.string();
                auto prefix_like = prefix;
                if (!prefix_like.empty() && prefix_like.back() != fs::path::preferred_separator)
                    prefix_like.push_back(fs::path::preferred_separator);
                prefix_like.append("%");

                std::lock_guard db_lk{db_mutex};
                const auto workflow_id = ensure_default_workflow_locked(*this, active_zone_name);
                const auto hot_items = active_db()
                    .from("dms_document_registry r")
                    .left_join("dms_document_states s", "s.document_uid = r.document_uid")
                    .left_join("nlp_notes n", "n.row_type = 'dms_doc' AND n.row_id = r.doc_id")
                    .select({
                        "r.path AS path",
                        "r.filename AS filename",
                        "r.mtime AS mtime",
                        "r.size_bytes AS size_bytes",
                        "s.workflow_state_key AS workflow_state_key",
                        "n.keywords AS keywords"
                    })
                    .where("(r.path = ? OR r.path LIKE ?)", prefix, prefix_like)
                    .order_by("r.mtime", false)
                    .limit(limit)
                    .map<json>([](const pce::db::Row& row) {
                        return json{
                            {"path", row.try_get<std::string>("path").value_or("")},
                            {"name", row.try_get<std::string>("filename").value_or("")},
                            {"mtime", row.try_get<int64_t>("mtime").value_or(0)},
                            {"size", row.try_get<int64_t>("size_bytes").value_or(0)},
                            {"workflow_state", row.try_get<std::string>("workflow_state_key").value_or("")},
                            {"keywords", parse_json_or(row.try_get<std::string>("keywords").value_or("[]"), json::array())},
                        };
                    });
                std::map<std::string, int64_t> workflow_count_map;
                auto workflow_rows = active_db()
                    .from("dms_document_registry r")
                    .left_join("dms_document_states s", "s.document_uid = r.document_uid")
                    .select({"COALESCE(NULLIF(s.workflow_state_key, ''), 'INPUT') AS workflow_state_key"})
                    .where("(r.path = ? OR r.path LIKE ?)", prefix, prefix_like)
                    .execute();
                for (const auto& row : workflow_rows) {
                    ++workflow_count_map[row.try_get<std::string>("workflow_state_key").value_or("INPUT")];
                }
                json workflow_counts = json::array();
                for (const auto& [state_key, count] : workflow_count_map) {
                    workflow_counts.push_back(json{{"state_key", state_key}, {"count", count}});
                }
                std::sort(workflow_counts.begin(), workflow_counts.end(), [](const json& lhs, const json& rhs) {
                    return lhs.value("count", int64_t{0}) > rhs.value("count", int64_t{0});
                });
                const auto tag_cloud = active_db()
                    .from("nlp_notes n")
                    .join("dms_document_registry r", "n.row_type = 'dms_doc' AND n.row_id = r.doc_id")
                    .select({"n.keywords AS keywords"})
                    .where("(r.path = ? OR r.path LIKE ?)", prefix, prefix_like)
                    .limit(limit * 2)
                    .map<json>([](const pce::db::Row& row) {
                        return parse_json_or(row.try_get<std::string>("keywords").value_or("[]"), json::array());
                    });
                std::map<std::string, int> tag_counts;
                for (const auto& keyword_list : tag_cloud) {
                    for (const auto& keyword : keyword_list) {
                        if (!keyword.is_string()) continue;
                        ++tag_counts[keyword.get<std::string>()];
                    }
                }
                json tags = json::array();
                for (const auto& [tag, count] : tag_counts) tags.push_back(json{{"tag", tag}, {"count", count}});
                std::sort(tags.begin(), tags.end(), [](const json& lhs, const json& rhs) {
                    if (lhs.value("count", 0) != rhs.value("count", 0))
                        return lhs.value("count", 0) > rhs.value("count", 0);
                    return lhs.value("tag", std::string{}) < rhs.value("tag", std::string{});
                });
                if (tags.size() > static_cast<size_t>(limit)) tags.erase(tags.begin() + limit, tags.end());

                const auto folder_links = active_db()
                    .from("dms_document_links")
                    .where("(source_ref LIKE ? OR target_ref LIKE ?)", prefix_like, prefix_like)
                    .order_by("created_at", false)
                    .limit(limit)
                    .map<json>([](const pce::db::Row& row) {
                        return json{
                            {"id", row.get<int64_t>("id")},
                            {"source_ref", row.try_get<std::string>("source_ref").value_or("")},
                            {"target_ref", row.try_get<std::string>("target_ref").value_or("")},
                            {"type", row.try_get<std::string>("link_type").value_or("depends_on")},
                            {"note", row.try_get<std::string>("note").value_or("")},
                            {"created_at", row.try_get<int64_t>("created_at").value_or(0)},
                        };
                    });

                json heatmap = json::array();
                const auto now = std::chrono::system_clock::now();
                for (int day = 13; day >= 0; --day) {
                    const auto point = now - std::chrono::hours(day * 24);
                    const auto stamp = std::chrono::duration_cast<std::chrono::seconds>(
                        point.time_since_epoch()).count();
                    int count = 0;
                    for (const auto& item : recent_items) {
                        const auto item_stamp = item.value("mtime", int64_t{0});
                        const auto delta = item_stamp > stamp ? item_stamp - stamp : stamp - item_stamp;
                        if (delta < 24 * 60 * 60) ++count;
                    }
                    heatmap.push_back(json{{"day_offset", day}, {"count", count}});
                }

                return json{
                    {"path", folder.string()},
                    {"name", folder.filename().string().empty() ? folder.string() : folder.filename().string()},
                    {"parent_path", folder.has_parent_path() ? folder.parent_path().string() : std::string{}},
                    {"file_count", file_count},
                    {"directory_count", dir_count},
                    {"total_size", total_size},
                    {"recent_items", recent_items},
                    {"hot_items", hot_items},
                    {"workflow_counts", workflow_counts},
                    {"workflow", json{{"id", workflow_id}, {"states", workflow_states_payload_locked(*this, workflow_id)}}},
                    {"tag_cloud", tags},
                    {"heatmap", heatmap},
                    {"links", folder_links},
                };
            });
        });
}

} // namespace pce::dms
