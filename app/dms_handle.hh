#pragma once
/**
 * @file dms_handle.hh
 * @brief DMSHandle — central DMS state and thin facade.
 *
 * DMSHandle owns shared infrastructure (database, NLP engine, embed service,
 * bulk-index thread) and delegates every API call to the appropriate module.
 * Business logic lives in @c bindings/ and @c internal/.
 *
 * @note Include only from @c app/main.cc — application-internal header.
 */

#include "db/database.hh"
#include "dms_monadic.hh"
#include "platform.hh"

#include "internal/crypto.hh"
#include "internal/discard.hh"
#include "internal/fs_utils.hh"
#include "internal/hashing.hh"
#include "internal/math.hh"
#include "internal/mime.hh"
#include "internal/schema.hh"
#include "internal/text_utils.hh"

// Service layer
#include "services/indexing/index_service.hh"
#include "services/lifecycle/document_lifecycle_service.hh"
#include "services/search/search_service.hh"
#include "services/zone/zone_storage_service.hh"

#include <atomic>
#include <memory>
#include <mutex>
#include <optional>
#include <print>
#include <string>
#include <thread>
#include <unordered_map>

#include <nlohmann/json.hpp>
#include <saucer/modules/desktop.hpp>

#ifdef NLP_WITH_ONNX
#  include "nlp/addons/ocr_addon.hh"
#  include "nlp/addons/onnx_addon.hh"
#  include "nlp/addons/platform_services.hh"
#endif
// RectifierAddon only depends on onnx_service.hh (safe to include without ONNX Runtime)
// and platform_services.hh (stubbed on non-Apple platforms). It compiles everywhere.
#include "nlp/addons/rectifier_addon.hh"
#include "nlp/nlp_engine.hh"
#include "nlp/3rdparty/stb_image.h"
#include "image_decode.hh"

#ifdef __APPLE__
#  include "keychain_mac.hh"
#endif

namespace fs  = std::filesystem;
using     json = nlohmann::json;

namespace pce::dms {


template <typename T>
[[nodiscard]] inline std::string ok_json(const T& data) {
    return nlohmann::json({{"ok", true}, {"data", data}}).dump();
}
[[nodiscard]] inline std::string err_json(const std::string& err) {
    return nlohmann::json({{"ok", false}, {"error", err}}).dump();
}

// All helpers (MIME, text utils, hashing, crypto, fs utils, math, schema)
// are provided by the internal/ headers included above.

/**
 * @class DMSHandle
 * @brief Facade owning shared DMS infrastructure; delegates to service modules.
 *
 * Owns the database connections, NLP engine reference, ONNX embedding service,
 * and background bulk-index thread.  Every method declaration here has its
 * implementation in @c dms_bindings.hh (which pulls in @c bindings/ sub-headers).
 */
struct DMSHandle {
    struct AsyncTransferTask {
        std::atomic<bool> cancel_requested{false};
        std::string operation;
        std::string dest_dir;
        std::vector<std::string> sources;
    };

    // JSON helpers
    template <typename T>
    [[nodiscard]] static std::string ok_str(const T& data) {
        return nlohmann::json({{"ok",true},{"data",data}}).dump();
    }
    [[nodiscard]] static std::string err_str(const std::string& err) {
        return nlohmann::json({{"ok",false},{"error",err}}).dump();
    }

    pce::db::Database                                    db;
    std::optional<pce::db::Database>                     zone_db;
    std::string                                          active_zone_name{"global"};
    mutable std::mutex                                   db_mutex;
    std::atomic<bool>                                    bulk_active{false};
    std::jthread                                         bulk_thread;
    std::atomic<int64_t>                                 transfer_task_seq{0};
    mutable std::mutex                                   transfer_tasks_mutex;
    std::unordered_map<std::string, std::shared_ptr<AsyncTransferTask>> transfer_tasks;
    pce::nlp::NLPEngine*                                 engine{nullptr};
    std::shared_ptr<pce::nlp::onnx::IOnnxService>        embed_svc;
    /** Perspective-rectification addon. Null onnx_ → platform-only path (macOS) or no-op. */
    std::shared_ptr<pce::nlp::RectifierAddon>            rectifier;
    std::atomic<saucer::webview*>                        wv_ptr{nullptr};

    DocumentLifecycleService lifecycle_svc_;
    IndexService       index_svc_;
    SearchService      search_svc_;
    ZoneStorageService storage_svc_;   ///< stateless; no ctor args needed

    //  Construction
    explicit DMSHandle(pce::nlp::NLPEngine& eng,
                       std::shared_ptr<pce::nlp::onnx::IOnnxService> embed = nullptr,
                       std::shared_ptr<pce::nlp::RectifierAddon>     rect  = nullptr)
        : db(open_db_()), engine(&eng),
          embed_svc(embed),
          rectifier(std::move(rect))
          , lifecycle_svc_([this]() -> pce::db::Database& { return active_db(); },
                           [this]() -> std::string { return active_zone_name; },
                           db_mutex)
          // Services receive lambdas so they always resolve through active_db()
          , index_svc_([this]() -> pce::db::Database& { return active_db(); },
                       db_mutex, &eng, embed, &lifecycle_svc_)
          , search_svc_([this]() -> pce::db::Database& { return active_db(); },
                         db_mutex, embed)
    {
        bootstrap_global_schema(db);
        bootstrap_dms_schema(db);
        pce::db::bootstrap_nlp_schema(db);
        bootstrap_palette_schema(db);
        bootstrap_bookmark_schema(db);
        bootstrap_fts_schema(db);
        bootstrap_chunks_schema(db);
        bootstrap_workspace_schema(db);
        bootstrap_sdm_schema(db);
        bootstrap_recent_exports_schema(db);
        bootstrap_media_projects_schema(db);
        bootstrap_document_lifecycle_schema(db);
        pce::db::migration::apply(db, kDmsMigrations);
        discard(scan_dir("data", false));
        std::print("[dms] global database ready: '{}' (schema v{})\n",
                   fs::absolute(db_path_()).string(),
                   pce::db::migration::current_schema_version(db));
    }
    DMSHandle(const DMSHandle&) = delete;
    DMSHandle& operator=(const DMSHandle&) = delete;
    DMSHandle(DMSHandle&&) = delete;
    DMSHandle& operator=(DMSHandle&&) = delete;
    ~DMSHandle() {
        wv_ptr.store(nullptr, std::memory_order_release);
        bulk_thread.request_stop();
        std::lock_guard lk{transfer_tasks_mutex};
        for (auto& [_, task] : transfer_tasks) {
            if (task) task->cancel_requested.store(true, std::memory_order_release);
        }
    }

    //  Active DB
    pce::db::Database& active_db() { return zone_db ? *zone_db : db; }

    std::string get_active_in_path() {
        if (active_zone_name == "global" || active_zone_name.empty()) return "data";
        std::lock_guard lk{db_mutex};
        auto row = db
                       .from("dms_zones").where("name = ?", active_zone_name).first();
        return row ? row->get<std::string>("in_path") : "data";
    }

    [[nodiscard]] Expected<json> scan_dir(std::string_view path_str, bool recursive=false);
    [[nodiscard]] Expected<json> read_file(std::string_view path_str);
    [[nodiscard]] Expected<json> index_document(std::string_view path_str);
    [[nodiscard]] Expected<json> bulk_index_start(std::string_view dir_path);
    void                         bulk_index_stop() noexcept { bulk_thread.request_stop(); }
    [[nodiscard]] Expected<json> search(std::string_view query, int top_k=10);
    [[nodiscard]] Expected<json> index_status();
    [[nodiscard]] json           record_recent_export(std::string_view path,
                                                      std::string_view doc_uuid,
                                                      std::string_view title,
                                                      std::string_view zone_name,
                                                      std::string_view kind,
                                                      std::optional<int64_t> file_size = std::nullopt);
    [[nodiscard]] Expected<json> get_metadata(std::string_view path_str);
    [[nodiscard]] Expected<json> get_document_lifecycle(std::string_view ref);
    [[nodiscard]] Expected<json> get_document_timeline(std::string_view ref, int limit = 50);
    [[nodiscard]] Expected<json> transition_document_state(std::string_view ref,
                                                           std::string_view next_state,
                                                           std::string_view actor = "user",
                                                           std::string_view reason = "",
                                                           std::string_view source = "ui");
    [[nodiscard]] Expected<json> get_zone_workflow(std::string_view zone_name = "");
    [[nodiscard]] Expected<json> save_zone_workflow(std::string_view zone_name,
                                                    std::string_view payload_json);
    [[nodiscard]] Expected<json> transition_document_workflow(std::string_view ref,
                                                              std::string_view next_state_key,
                                                              std::string_view actor = "user",
                                                              std::string_view reason = "",
                                                              std::string_view source = "ui");
    [[nodiscard]] Expected<json> add_document_link(std::string_view source_ref,
                                                   std::string_view target_ref,
                                                   std::string_view link_type,
                                                   std::string_view note = "");
    [[nodiscard]] Expected<json> get_document_links(std::string_view ref, int limit = 20);
    [[nodiscard]] Expected<json> get_folder_dashboard(std::string_view path_str, int limit = 12);
    [[nodiscard]] Expected<json> rectify_document(std::string_view path_str,
                                                     std::optional<std::string> out);
    [[nodiscard]] Expected<json> get_zones();
    [[nodiscard]] Expected<json> upsert_zone(std::string_view name,
                                              std::string_view in_path,
                                              std::string_view out_path,
                                              std::optional<std::string> password={},
                                              std::string_view description="",
                                              std::string_view taxonomy_domain="General");
    [[nodiscard]] Expected<json> zone_disk_usage(std::string_view zone_name);
    [[nodiscard]] Expected<pce::db::Database> open_zone_db(
        std::string_view zone_name,
        std::optional<std::string> password={});
    [[nodiscard]] Expected<json> import_to_zone(std::string path,
                                                 std::string zone_name,
                                                 bool compress=false, bool scan=false);
    [[nodiscard]] Expected<json> file_to_zone(std::string path, std::string zone_name);

    /// Collect all SVG files from a directory, returning their name + inline content.
    [[nodiscard]] Expected<json> collect_svgs(std::string_view folder_path) noexcept;

    std::string ocr_document(std::string path, std::string zone_name="");

    /// Add a bookmark to a zone. `root` selects the base area inside the zone,
    /// while `target` is relative to that root and may include a `?<from>:<to>`
    /// suffix for file line ranges.
    [[nodiscard]] Expected<json> bookmark_add(std::string_view zone_name,
                                               std::string_view root,
                                               std::string_view label,
                                               std::string_view target);
    /// List all bookmarks for a zone, ordered by sort_order ASC, id ASC.
    [[nodiscard]] Expected<json> bookmark_list(std::string_view zone_name);
    /// Delete a single bookmark by id.
    [[nodiscard]] Expected<json> bookmark_delete(int64_t id);
    /// Update root, label, target, and/or sort_order of an existing bookmark.
    [[nodiscard]] Expected<json> bookmark_update(int64_t id,
                                                  std::string_view root,
                                                  std::string_view label,
                                                  std::string_view target,
                                                  int64_t sort_order);
    /// Resolve a bookmark root + relative `target` to an absolute filesystem path.
    /// Returns { "abs_path": "…", "line_from": n, "line_to": n, "kind": "…" }
    [[nodiscard]] Expected<json> bookmark_resolve(std::string_view zone_name,
                                                   std::string_view root,
                                                   std::string_view target);

    // ── Media project persistence (video & audio) ────────────────────────────
    /// Save or replace a media project (kind='video'|'audio') by name+zone.
    [[nodiscard]] Expected<json> media_save_project(std::string_view kind,
                                                    std::string_view name,
                                                    std::string_view zone_name,
                                                    const json&      data);
    /// Load a media project by name+zone. Returns {id, name, zone_name, data, updated_at}.
    [[nodiscard]] Expected<json> media_load_project(std::string_view kind,
                                                    std::string_view name,
                                                    std::string_view zone_name);
    /// List all projects of a given kind in a zone, newest first.
    [[nodiscard]] Expected<json> media_list_projects(std::string_view kind,
                                                     std::string_view zone_name);
    /// Delete a media project by name+zone. Returns {deleted: bool}.
    [[nodiscard]] Expected<json> media_delete_project(std::string_view kind,
                                                      std::string_view name,
                                                      std::string_view zone_name);
    /// Typed export: deserialise VideoProject JSON → ExportProject → call backend.
    [[nodiscard]] Expected<json> video_export_project(std::string_view project_json,
                                                      std::string_view output_path);

    /// Synchronously load a preference value from the global DB.
    /// Returns std::nullopt when the key does not exist or on DB error.
    [[nodiscard]] std::optional<std::string> load_preference_sync(std::string_view key) {
        try {
            std::lock_guard lk{db_mutex};
            auto row = db
                           .from("app_preferences")
                           .where("key = ?", std::string{key})
                           .first();
            if (!row) return std::nullopt;
            return row->get<std::string>("value");
        } catch (...) {
            return std::nullopt;
        }
    }
    /// Synchronously save a preference value to the global DB.
    void save_preference_sync(std::string_view key, std::string_view value) {
        try {
            const auto now = pce::db::now_unix();
            std::lock_guard lk{db_mutex};
            discard(db.insert_into("app_preferences")
                     .value("key",        std::string{key})
                     .value("value",      std::string{value})
                     .value("updated_at", now)
                     .on_conflict_replace()
                     .execute());
        } catch (...) {}
    }

    void push_progress_(nlohmann::json ev) const;
    static std::string ocr_quality(const std::string& text);

    [[nodiscard]] static fs::path db_path_() {
        if (const char* v=std::getenv("DMS_DB_PATH"); v&&*v) return {v};
        if (const char* v=std::getenv("NLP_DATA_DIR"); v&&*v) return fs::path{v}/"syngrafo.db";
        return fs::path{"data"}/"syngrafo.db";
    }
    [[nodiscard]] static pce::db::Database open_db_() {
        const auto p=db_path_(); std::error_code ec;
        fs::create_directories(p.parent_path(),ec);
        return pce::db::Database::open(p.string());
    }
};

inline json DMSHandle::record_recent_export(std::string_view path,
                                            std::string_view doc_uuid,
                                            std::string_view title,
                                            std::string_view zone_name,
                                            std::string_view kind,
                                            std::optional<int64_t> file_size) {
    std::error_code ec;
    const auto resolved_size = file_size.value_or([&]() -> int64_t {
        const auto raw_size = fs::file_size(fs::path{path}, ec);
        return ec ? int64_t{0} : static_cast<int64_t>(raw_size);
    }());
    const auto now = pce::db::now_unix();

    std::lock_guard lk{db_mutex};

    const int rows = db.insert_into("dms_recent_exports")
        .value("doc_uuid",    std::string{doc_uuid})
        .value("title",       std::string{title})
        .value("path",        std::string{path})
        .value("kind",        std::string{kind})
        .value("zone_name",   std::string{zone_name})
        .value("exported_at", now)
        .value("file_size",   resolved_size)
        .execute();

    if (rows <= 0) {
        throw std::runtime_error(std::format("failed to record export: {}", path));
    }

    return json{
        {"path",        std::string{path}},
        {"exported_at", now},
        {"file_size",   resolved_size},
    };
}

} // namespace pce::dms
