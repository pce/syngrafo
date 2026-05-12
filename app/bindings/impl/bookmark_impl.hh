#pragma once
#include "../../dms_handle.hh"

namespace pce::dms {

/** @brief Resolves a zone-relative bookmark target to an absolute path and line range. */
inline Expected<json> DMSHandle::bookmark_resolve(std::string_view zone_name,
                                                  std::string_view root,
                                                  std::string_view target) {
    if (zone_name.empty()) return std::unexpected("zone_name must not be empty");
    const auto parsed_root = bookmark_root_from_string(root).value_or(BookmarkRoot::Workspace);

    int64_t line_from{0}, line_to{0};
    const std::string bare = Bookmark::parse_target(target, line_from, line_to);
    const std::string kind = Bookmark::infer_kind(bare);

    std::string in_dir;
    std::string out_dir;
    {
        std::lock_guard lk{db_mutex};
        if (zone_name != "global" && !zone_name.empty()) {
            const auto row = db.from("dms_zones")
                               .where("name = ?", std::string{zone_name}).first();
            if (row) {
                in_dir  = row->get<std::string>("in_path");
                out_dir = row->get<std::string>("out_path");
            }
        }
    }
    if (in_dir.empty()) in_dir = get_active_in_path();
    if (out_dir.empty()) out_dir = in_dir;

    fs::path base_dir;
    switch (parsed_root) {
        case BookmarkRoot::Source:    base_dir = fs::path{in_dir}; break;
        case BookmarkRoot::Workspace: base_dir = fs::path{out_dir}; break;
        case BookmarkRoot::Notes:     base_dir = fs::path{out_dir} / ".notes"; break;
        case BookmarkRoot::Kanban:    base_dir = fs::path{out_dir} / ".kanban"; break;
    }
    const fs::path abs_path = bare.empty() ? base_dir : (base_dir / bare);
    std::error_code ec;
    const bool exists = fs::exists(abs_path, ec);

    return json{
        {"abs_path",  abs_path.string()},
        {"root",      std::string{bookmark_root_name(parsed_root)}},
        {"line_from", line_from},
        {"line_to",   line_to},
        {"kind",      kind},
        {"exists",    exists},
        {"zone_name", std::string{zone_name}},
        {"target",    std::string{target}},
    };
}

inline Expected<json> DMSHandle::bookmark_add(std::string_view zone_name,
                                               std::string_view root,
                                               std::string_view label,
                                               std::string_view target) {
    if (zone_name.empty()) return std::unexpected("zone_name must not be empty");
    const auto parsed_root = bookmark_root_from_string(root);
    if (!parsed_root)
        return std::unexpected("invalid bookmark root: " + std::string{root});
    int64_t line_from{0}, line_to{0};
    const std::string bare = Bookmark::parse_target(target, line_from, line_to);
    const std::string kind = Bookmark::infer_kind(bare);
    const int64_t now = pce::db::now_unix();
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        const int64_t id = db.insert_into("zone_bookmarks")
            .value("zone_name",  std::string{zone_name})
            .value("label",      std::string{label})
            .value("root",       std::string{bookmark_root_name(*parsed_root)})
            .value("target",     std::string{target})
            .value("kind",       kind)
            .value("line_from",  line_from)
            .value("line_to",    line_to)
            .value("created_at", now)
            .value("updated_at", now)
            .execute();
        return json{
            {"id",         id},
            {"zone_name",  zone_name},
            {"label",      label},
            {"root",       std::string{bookmark_root_name(*parsed_root)}},
            {"target",     target},
            {"kind",       kind},
            {"line_from",  line_from},
            {"line_to",    line_to},
            {"sort_order", int64_t{0}},
            {"created_at", now},
            {"updated_at", now},
        };
    });
}

inline Expected<json> DMSHandle::bookmark_list(std::string_view zone_name) {
    if (zone_name.empty()) return std::unexpected("zone_name must not be empty");
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        return db.from("zone_bookmarks")
            .where("zone_name = ?", std::string{zone_name})
            .order_by("sort_order")
            .map<json>([](const pce::db::Row& r) {
                return json{
                    {"id",         r.get<int64_t>("id")},
                    {"zone_name",  r.get<std::string>("zone_name")},
                    {"label",      r.get<std::string>("label")},
                    {"root",       r.try_get<std::string>("root").value_or("workspace")},
                    {"target",     r.get<std::string>("target")},
                    {"kind",       r.get<std::string>("kind")},
                    {"line_from",  r.try_get<int64_t>("line_from").value_or(0)},
                    {"line_to",    r.try_get<int64_t>("line_to").value_or(0)},
                    {"sort_order", r.try_get<int64_t>("sort_order").value_or(0)},
                    {"created_at", r.try_get<int64_t>("created_at").value_or(0)},
                    {"updated_at", r.try_get<int64_t>("updated_at").value_or(0)},
                };
            });
    });
}

inline Expected<json> DMSHandle::bookmark_delete(int64_t id) {
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        const int affected = db.delete_from("zone_bookmarks").where("id = ?", id).execute();
        return json{{"deleted", affected > 0}};
    });
}

inline Expected<json> DMSHandle::bookmark_update(int64_t id,
                                                 std::string_view root,
                                                 std::string_view label,
                                                 std::string_view target,
                                                 int64_t sort_order) {
    const auto parsed_root = bookmark_root_from_string(root);
    if (!parsed_root)
        return std::unexpected("invalid bookmark root: " + std::string{root});
    const int64_t now = pce::db::now_unix();
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
        int64_t line_from{0}, line_to{0};
        const std::string bare = Bookmark::parse_target(target, line_from, line_to);
        const std::string kind = Bookmark::infer_kind(bare);
        const int affected = db.update("zone_bookmarks")
            .set("label",      std::string{label})
            .set("root",       std::string{bookmark_root_name(*parsed_root)})
            .set("target",     std::string{target})
            .set("kind",       kind)
            .set("line_from",  line_from)
            .set("line_to",    line_to)
            .set("sort_order", sort_order)
            .set("updated_at", now)
            .where("id = ?", id)
            .execute();
        if (affected == 0) return json{{"ok", false}, {"error", "bookmark not found"}};
        const auto row = db.from("zone_bookmarks").where("id = ?", id).first();
        if (!row) return json{{"ok", true}};
        return json{
            {"id",         row->get<int64_t>("id")},
            {"zone_name",  row->get<std::string>("zone_name")},
            {"label",      row->get<std::string>("label")},
            {"root",       row->try_get<std::string>("root").value_or("workspace")},
            {"target",     row->get<std::string>("target")},
            {"kind",       row->get<std::string>("kind")},
            {"line_from",  row->try_get<int64_t>("line_from").value_or(0)},
            {"line_to",    row->try_get<int64_t>("line_to").value_or(0)},
            {"sort_order", row->try_get<int64_t>("sort_order").value_or(0)},
            {"created_at", row->try_get<int64_t>("created_at").value_or(0)},
            {"updated_at", row->try_get<int64_t>("updated_at").value_or(0)},
        };
    });
}

} // namespace pce::dms
