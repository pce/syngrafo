#pragma once
#include "../../dms_handle.hh"

namespace pce::dms {

namespace {

struct WorkflowSeedState {
    const char* key;
    const char* label;
    const char* color;
    const char* category;
    bool is_default;
    bool is_terminal;
    int sort_order;
};

struct WorkflowSeedTransition {
    const char* from;
    const char* to;
    const char* label;
    bool requires_reason;
    int sort_order;
};

inline const std::vector<WorkflowSeedState>& default_workflow_states() {
    static const std::vector<WorkflowSeedState> kStates{
        {"INPUT", "Input", "#64748b", "intake", true, false, 10},
        {"PROCESSING", "Processing", "#0284c7", "automation", false, false, 20},
        {"REVIEW", "Review", "#d97706", "review", false, false, 30},
        {"INDEXED", "Indexed", "#0f766e", "ready", false, false, 40},
        {"ACTIVE", "Active", "#16a34a", "active", false, false, 50},
        {"ON_HOLD", "On hold", "#9333ea", "blocked", false, false, 60},
        {"REVISIT", "Revisit", "#ec4899", "follow_up", false, false, 70},
        {"ARCHIVED", "Archived", "#475569", "archive", false, true, 80},
        {"ERROR", "Error", "#dc2626", "error", false, false, 90},
    };
    return kStates;
}

inline const std::vector<WorkflowSeedTransition>& default_workflow_transitions() {
    static const std::vector<WorkflowSeedTransition> kTransitions{
        {"INPUT", "PROCESSING", "Start processing", false, 10},
        {"PROCESSING", "REVIEW", "Send to review", false, 20},
        {"PROCESSING", "ERROR", "Mark error", true, 21},
        {"REVIEW", "INDEXED", "Accept review", false, 30},
        {"REVIEW", "PROCESSING", "Retry processing", true, 31},
        {"REVIEW", "ON_HOLD", "Put on hold", true, 32},
        {"REVIEW", "REVISIT", "Revisit later", true, 33},
        {"INDEXED", "ACTIVE", "Activate", false, 40},
        {"INDEXED", "ARCHIVED", "Archive", true, 41},
        {"ACTIVE", "ON_HOLD", "Pause", true, 50},
        {"ACTIVE", "REVISIT", "Schedule revisit", true, 51},
        {"ACTIVE", "ARCHIVED", "Archive", true, 52},
        {"ON_HOLD", "ACTIVE", "Resume", false, 60},
        {"ON_HOLD", "REVISIT", "Revisit later", true, 61},
        {"REVISIT", "ACTIVE", "Reactivate", false, 70},
        {"REVISIT", "ARCHIVED", "Archive", true, 71},
        {"ERROR", "PROCESSING", "Retry", true, 80},
        {"ERROR", "REVIEW", "Review manually", true, 81},
        {"ARCHIVED", "ACTIVE", "Restore", true, 90},
    };
    return kTransitions;
}

inline json parse_json_or(std::string_view raw, json fallback) {
    try { return json::parse(raw); } catch (...) { return fallback; }
}

inline std::optional<pce::db::Row> find_document_registry_row_locked(DMSHandle& dms,
                                                                     std::string_view ref) {
    const auto ref_str = std::string{ref};
    auto row = dms.active_db()
                   .from("dms_document_registry")
                   .where("document_uid = ?", ref_str)
                   .first();
    if (!row)
        row = dms.active_db()
                  .from("dms_document_registry")
                  .where("path = ?", ref_str)
                  .first();
    if (!row)
        row = dms.active_db()
                  .from("dms_document_registry")
                  .where("source_path = ?", ref_str)
                  .first();
    return row;
}

inline std::string workflow_id_for_zone(std::string_view zone_name) {
    return std::format("workflow:{}", zone_name.empty() ? "global" : std::string{zone_name});
}

inline std::string ensure_default_workflow_locked(DMSHandle& dms, std::string_view zone_name) {
    const auto workflow_id = workflow_id_for_zone(zone_name);
    const auto now = pce::db::now_unix();
    if (!dms.active_db().from("dms_zone_workflows").where("id = ?", workflow_id).exists()) {
        discard(dms.active_db().insert_into("dms_zone_workflows")
            .value("id", workflow_id)
            .value("zone_name", std::string{zone_name})
            .value("name", std::string{zone_name.empty() ? "Default workflow" :
                                                std::format("{} workflow", std::string{zone_name})})
            .value("is_default", int64_t{1})
            .value("created_at", now)
            .value("updated_at", now)
            .on_conflict_replace()
            .execute());
    }
    if (dms.active_db().from("dms_workflow_states").where("workflow_id = ?", workflow_id).count() == 0) {
        for (const auto& state : default_workflow_states()) {
            discard(dms.active_db().insert_into("dms_workflow_states")
                .value("workflow_id", workflow_id)
                .value("state_key", std::string{state.key})
                .value("label", std::string{state.label})
                .value("color", std::string{state.color})
                .value("category", std::string{state.category})
                .value("is_default", int64_t{state.is_default ? 1 : 0})
                .value("is_terminal", int64_t{state.is_terminal ? 1 : 0})
                .value("sort_order", int64_t{state.sort_order})
                .execute());
        }
    }
    if (dms.active_db().from("dms_workflow_transitions").where("workflow_id = ?", workflow_id).count() == 0) {
        for (const auto& transition : default_workflow_transitions()) {
            discard(dms.active_db().insert_into("dms_workflow_transitions")
                .value("workflow_id", workflow_id)
                .value("from_state_key", std::string{transition.from})
                .value("to_state_key", std::string{transition.to})
                .value("label", std::string{transition.label})
                .value("requires_reason", int64_t{transition.requires_reason ? 1 : 0})
                .value("sort_order", int64_t{transition.sort_order})
                .execute());
        }
    }
    return workflow_id;
}

inline json workflow_states_payload_locked(DMSHandle& dms, std::string_view workflow_id) {
    return dms.active_db()
        .from("dms_workflow_states")
        .where("workflow_id = ?", std::string{workflow_id})
        .order_by("sort_order")
        .map<json>([](const pce::db::Row& row) {
            return json{
                {"key", row.get<std::string>("state_key")},
                {"label", row.try_get<std::string>("label").value_or("")},
                {"color", row.try_get<std::string>("color").value_or("")},
                {"category", row.try_get<std::string>("category").value_or("")},
                {"is_default", row.try_get<int64_t>("is_default").value_or(0) != 0},
                {"is_terminal", row.try_get<int64_t>("is_terminal").value_or(0) != 0},
                {"sort_order", row.try_get<int64_t>("sort_order").value_or(0)},
            };
        });
}

inline json workflow_transitions_payload_locked(DMSHandle& dms,
                                                std::string_view workflow_id,
                                                std::string_view from_state_key) {
    return dms.active_db()
        .from("dms_workflow_transitions")
        .where("workflow_id = ?", std::string{workflow_id})
        .where("from_state_key = ?", std::string{from_state_key})
        .order_by("sort_order")
        .map<json>([](const pce::db::Row& row) {
            return json{
                {"from", row.try_get<std::string>("from_state_key").value_or("")},
                {"to", row.try_get<std::string>("to_state_key").value_or("")},
                {"label", row.try_get<std::string>("label").value_or("")},
                {"requires_reason", row.try_get<int64_t>("requires_reason").value_or(0) != 0},
                {"sort_order", row.try_get<int64_t>("sort_order").value_or(0)},
            };
        });
}

inline std::string map_technical_state_to_workflow(std::string_view state) {
    const auto key = std::string{state};
    if (key == "READY") return "INDEXED";
    return key.empty() ? "INPUT" : key;
}

struct WorkflowStateRecord {
    std::string key;
    std::string label;
    std::string color;
    std::string category;
    bool        is_default = false;
    bool        is_terminal = false;
    int64_t     sort_order = 0;
};

struct WorkflowTransitionRecord {
    std::string from;
    std::string to;
    std::string label;
    bool        requires_reason = false;
    int64_t     sort_order = 0;
};

inline std::string default_workflow_name(std::string_view zone_name) {
    return std::string{zone_name.empty() ? "Default workflow"
                                         : std::format("{} workflow", std::string{zone_name})};
}

inline std::vector<WorkflowStateRecord> parse_workflow_states_or_throw(const json& payload) {
    const auto it = payload.find("states");
    if (it == payload.end() || !it->is_array() || it->empty())
        throw std::runtime_error("workflow must define at least one state");

    std::vector<WorkflowStateRecord> states;
    std::set<std::string> seen_keys;
    int default_count = 0;
    int64_t sort_order = 10;
    for (const auto& entry : *it) {
        if (!entry.is_object()) throw std::runtime_error("workflow state entry must be an object");
        WorkflowStateRecord state{
            .key = entry.value("key", entry.value("state_key", "")),
            .label = entry.value("label", ""),
            .color = entry.value("color", "#64748b"),
            .category = entry.value("category", "custom"),
            .is_default = entry.value("is_default", entry.value("isDefault", false)),
            .is_terminal = entry.value("is_terminal", entry.value("isTerminal", false)),
            .sort_order = entry.value("sort_order", entry.value("sortOrder", sort_order)),
        };
        if (state.key.empty()) throw std::runtime_error("workflow state key must not be empty");
        if (!seen_keys.insert(state.key).second)
            throw std::runtime_error("duplicate workflow state key: " + state.key);
        if (state.label.empty()) state.label = state.key;
        if (state.is_default) ++default_count;
        states.push_back(std::move(state));
        sort_order += 10;
    }
    if (default_count != 1)
        throw std::runtime_error("workflow must define exactly one default state");
    return states;
}

inline std::vector<WorkflowTransitionRecord> parse_workflow_transitions_or_throw(
    const json& payload,
    const std::set<std::string>& state_keys) {
    const auto it = payload.find("transitions");
    if (it == payload.end() || it->is_null()) return {};
    if (!it->is_array()) throw std::runtime_error("workflow transitions must be an array");

    std::vector<WorkflowTransitionRecord> transitions;
    std::set<std::pair<std::string, std::string>> seen_pairs;
    int64_t sort_order = 10;
    for (const auto& entry : *it) {
        if (!entry.is_object()) throw std::runtime_error("workflow transition entry must be an object");
        WorkflowTransitionRecord transition{
            .from = entry.value("from", entry.value("from_state_key", "")),
            .to = entry.value("to", entry.value("to_state_key", "")),
            .label = entry.value("label", ""),
            .requires_reason = entry.value("requires_reason", entry.value("requiresReason", false)),
            .sort_order = entry.value("sort_order", entry.value("sortOrder", sort_order)),
        };
        if (transition.from.empty() || transition.to.empty())
            throw std::runtime_error("workflow transition endpoints must not be empty");
        if (!state_keys.contains(transition.from) || !state_keys.contains(transition.to))
            throw std::runtime_error("workflow transition references unknown state");
        if (!seen_pairs.insert({transition.from, transition.to}).second)
            throw std::runtime_error("duplicate workflow transition: " + transition.from + " -> " + transition.to);
        if (transition.label.empty()) transition.label = transition.to;
        transitions.push_back(std::move(transition));
        sort_order += 10;
    }
    return transitions;
}

inline json document_links_payload_locked(DMSHandle& dms, std::string_view ref, int limit) {
    const auto ref_str = std::string{ref};
    return dms.active_db()
        .from("dms_document_links")
        .where("(source_ref = ? OR target_ref = ?)", ref_str, ref_str)
        .order_by("created_at", false)
        .limit(limit)
        .map<json>([](const pce::db::Row& row) {
            return json{
                {"id", row.get<int64_t>("id")},
                {"zone_name", row.try_get<std::string>("zone_name").value_or("")},
                {"source_ref", row.try_get<std::string>("source_ref").value_or("")},
                {"target_ref", row.try_get<std::string>("target_ref").value_or("")},
                {"type", row.try_get<std::string>("link_type").value_or("depends_on")},
                {"note", row.try_get<std::string>("note").value_or("")},
                {"status", row.try_get<std::string>("status").value_or("active")},
                {"created_at", row.try_get<int64_t>("created_at").value_or(0)},
            };
        });
}

} // namespace

} // namespace pce::dms
