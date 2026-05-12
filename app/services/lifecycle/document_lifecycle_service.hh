#pragma once
/**
 * @file services/lifecycle/document_lifecycle_service.hh
 * @brief Event-sourced document lifecycle + immutable blob catalog service.
 */

#include "../../core/document_state.hh"
#include "../../db/database.hh"
#include "../../dms_monadic.hh"
#include "../../internal/fs_utils.hh"
#include "../../internal/hashing.hh"

#include <filesystem>
#include <format>
#include <functional>
#include <mutex>
#include <optional>
#include <random>
#include <string>

#include <nlohmann/json.hpp>

namespace pce::dms {

namespace fs = std::filesystem;
using json   = nlohmann::json;

class DocumentLifecycleService {
public:
    using ActiveDbFn   = std::function<pce::db::Database&()>;
    using ActiveZoneFn = std::function<std::string()>;

    explicit DocumentLifecycleService(ActiveDbFn active_db,
                                      ActiveZoneFn active_zone,
                                      std::mutex& db_mutex)
        : active_db_(std::move(active_db))
        , active_zone_(std::move(active_zone))
        , db_mutex_(db_mutex)
    {}

    [[nodiscard]] Expected<std::string>
    ensure_document(const DocumentRegistration& reg,
                    std::string_view actor = "system",
                    std::string_view source = "system");

    [[nodiscard]] Expected<json> snapshot(std::string_view ref);
    [[nodiscard]] Expected<json> timeline(std::string_view ref, int limit = 50);
    [[nodiscard]] Expected<json> transition_state(std::string_view ref,
                                                  DocumentState next_state,
                                                  std::string_view actor = "user",
                                                  std::string_view reason = "",
                                                  std::string_view source = "ui");

    [[nodiscard]] Expected<std::string> record_text_extraction(
        std::string_view ref,
        const TextContentVersion& version,
        std::string_view actor = "system",
        std::string_view source = "indexer");

private:
    struct EventInsertResult {
        int64_t event_id{0};
        int64_t event_no{0};
    };

    ActiveDbFn   active_db_;
    ActiveZoneFn active_zone_;
    std::mutex&  db_mutex_;

    [[nodiscard]] static std::string generate_uid();
    [[nodiscard]] static json parse_payload(std::string_view raw) noexcept;
    [[nodiscard]] static fs::path blob_store_root();
    [[nodiscard]] static fs::path blob_path_for(std::string_view blob_hash);
    [[nodiscard]] static std::string relative_blob_key(std::string_view blob_hash);

    [[nodiscard]] Expected<std::optional<pce::db::Row>>
    find_registry_locked(std::string_view ref);

    [[nodiscard]] Expected<BlobRecord> register_blob(const DocumentRegistration& reg);
    [[nodiscard]] Expected<EventInsertResult> append_event_locked(
        std::string_view document_uid,
        std::string_view event_type,
        std::string_view state_from,
        std::string_view state_to,
        std::string_view actor,
        std::string_view source,
        const json& payload,
        int64_t now);
};

inline std::string DocumentLifecycleService::generate_uid() {
    static constexpr char kHex[] = "0123456789abcdef";
    std::random_device rd;
    std::mt19937_64 gen(rd());
    std::uniform_int_distribution<uint32_t> dist(0, 15);
    std::string out(32, '0');
    for (char& ch : out) ch = kHex[dist(gen)];
    return out;
}

inline json DocumentLifecycleService::parse_payload(std::string_view raw) noexcept {
    try {
        if (raw.empty()) return json::object();
        return json::parse(raw);
    } catch (...) {
        return json{{"raw", std::string{raw}}};
    }
}

inline fs::path DocumentLifecycleService::blob_store_root() {
    if (const char* v = std::getenv("DMS_DB_PATH"); v && *v)
        return fs::path{v}.parent_path() / "blobs";
    if (const char* v = std::getenv("NLP_DATA_DIR"); v && *v)
        return fs::path{v} / "blobs";
    return fs::path{"data"} / "blobs";
}

inline fs::path DocumentLifecycleService::blob_path_for(std::string_view blob_hash) {
    const std::string prefix = blob_hash.size() >= 2 ? std::string{blob_hash.substr(0, 2)} : "00";
    return blob_store_root() / "fnv1a64" / prefix / std::string{blob_hash};
}

inline std::string DocumentLifecycleService::relative_blob_key(std::string_view blob_hash) {
    const std::string prefix = blob_hash.size() >= 2 ? std::string{blob_hash.substr(0, 2)} : "00";
    return (fs::path{"fnv1a64"} / prefix / std::string{blob_hash}).string();
}

inline Expected<std::optional<pce::db::Row>>
DocumentLifecycleService::find_registry_locked(std::string_view ref) {
    try {
        auto row = active_db_().from("dms_document_registry")
            .where("document_uid = ? OR path = ? OR source_path = ?", std::string{ref},
                   std::string{ref}, std::string{ref})
            .first();
        return row;
    } catch (const std::exception& e) {
        return std::unexpected(std::string{e.what()});
    }
}

inline Expected<BlobRecord>
DocumentLifecycleService::register_blob(const DocumentRegistration& reg) {
    if (reg.path.empty() || !fs::exists(fs::path{reg.path}))
        return std::unexpected("blob source file does not exist: " + reg.path);

    const std::string blob_hash = hash_file_hex(fs::path{reg.path});
    if (blob_hash.empty())
        return std::unexpected("failed to hash blob: " + reg.path);

    const auto now       = pce::db::now_unix();
    const auto blob_path = blob_path_for(blob_hash);
    std::error_code ec;
    fs::create_directories(blob_path.parent_path(), ec);
    if (ec)
        return std::unexpected(std::format("failed to create blob dir: {}", ec.message()));
    if (!fs::exists(blob_path)) {
        fs::copy_file(fs::path{reg.path}, blob_path, fs::copy_options::skip_existing, ec);
        if (ec)
            return std::unexpected(std::format("failed to materialize blob '{}': {}", reg.path, ec.message()));
    }

    return BlobRecord{
        .blob_hash   = blob_hash,
        .algorithm   = "fnv1a64",
        .storage_key = relative_blob_key(blob_hash),
        .mime_type   = reg.mime_type,
        .size_bytes  = reg.size_bytes,
    };
}

inline Expected<DocumentLifecycleService::EventInsertResult>
DocumentLifecycleService::append_event_locked(std::string_view document_uid,
                                              std::string_view event_type,
                                              std::string_view state_from,
                                              std::string_view state_to,
                                              std::string_view actor,
                                              std::string_view source,
                                              const json& payload,
                                              int64_t now) {
    auto current = active_db_().from("dms_document_states")
        .where("document_uid = ?", std::string{document_uid})
        .first();
    if (!current)
        return std::unexpected("document state not found for event append");

    const int64_t next_no = current->try_get<int64_t>("latest_event_no").value_or(0) + 1;
    discard(active_db_().insert_into("dms_document_events")
        .value("document_uid", std::string{document_uid})
        .value("event_no",     next_no)
        .value("event_type",   std::string{event_type})
        .value("state_from",   std::string{state_from})
        .value("state_to",     std::string{state_to})
        .value("actor",        std::string{actor})
        .value("source",       std::string{source})
        .value("payload_json", payload.dump())
        .value("created_at",   now)
        .execute());
    const auto event_id = active_db_().last_insert_rowid();
    discard(active_db_().update("dms_document_states")
        .set("latest_event_no", next_no)
        .set("updated_at", now)
        .where("document_uid = ?", std::string{document_uid})
        .execute());
    return EventInsertResult{.event_id = event_id, .event_no = next_no};
}

inline Expected<std::string>
DocumentLifecycleService::ensure_document(const DocumentRegistration& reg,
                                          std::string_view actor,
                                          std::string_view source) {
    if (reg.path.empty())
        return std::unexpected("document path is required");

    try {
        std::lock_guard lk{db_mutex_};
        const int64_t now = pce::db::now_unix();
        std::optional<pce::db::Row> existing = active_db_().from("dms_document_registry")
            .where("path = ?", reg.path)
            .first();
        if (!existing && reg.doc_id > 0) {
            existing = active_db_().from("dms_document_registry")
                .where("doc_id = ?", reg.doc_id)
                .first();
        }

        // Blob storage is deferred: files are not copied to the blob store
        // automatically on every index/ensure call. The register_blob() helper
        // and dms_blob_store table remain available for explicit archiving
        // operations (e.g. future "archive to zone" workflows).
        const auto zone_name = reg.zone_name.empty() ? active_zone_() : reg.zone_name;
        if (existing) {
            const auto uid = existing->get<std::string>("document_uid");
            discard(active_db_().update("dms_document_registry")
                .set("doc_id", reg.doc_id)
                .set("path", reg.path)
                .set("source_path", reg.source_path)
                .set("zone_name", zone_name)
                .set("kind", reg.kind)
                .set("mime_type", reg.mime_type)
                .set("size_bytes", reg.size_bytes)
                .set("mtime", reg.mtime)
                .set("current_blob_hash", existing->try_get<std::string>("current_blob_hash").value_or(""))
                .set("updated_at", now)
                .where("document_uid = ?", uid)
                .execute());

            return uid;
        }

        const std::string uid = generate_uid();
        discard(active_db_().insert_into("dms_document_registry")
            .value("document_uid", uid)
            .value("doc_id", reg.doc_id)
            .value("path", reg.path)
            .value("source_path", reg.source_path)
            .value("zone_name", zone_name)
            .value("kind", reg.kind)
            .value("mime_type", reg.mime_type)
            .value("size_bytes", reg.size_bytes)
            .value("mtime", reg.mtime)
            .value("current_blob_hash", std::string{})
            .value("created_at", now)
            .value("updated_at", now)
            .execute());

        discard(active_db_().insert_into("dms_document_states")
            .value("document_uid", uid)
            .value("state", std::string{document_state_name(DocumentState::Input)})
            .value("review_status", std::string{""})
            .value("latest_event_no", int64_t{0})
            .value("latest_content_version", int64_t{0})
            .value("title", fs::path{reg.path}.filename().string())
            .value("tags_json", std::string{"[]"})
            .value("metadata_json", json{
                {"path", reg.path},
                {"source_path", reg.source_path},
                {"mime_type", reg.mime_type},
                {"kind", reg.kind},
            }.dump())
            .value("created_at", now)
            .value("updated_at", now)
            .value("archived_at", int64_t{0})
            .execute());

        auto created = append_event_locked(
            uid,
            "CREATED",
            "",
            document_state_name(DocumentState::Input),
            actor,
            source,
            json{
                {"path", reg.path},
                {"source_path", reg.source_path},
                {"kind", reg.kind},
                {"mime_type", reg.mime_type},
                {"size_bytes", reg.size_bytes},
                {"mtime", reg.mtime},
                {"zone_name", zone_name},
            },
            now
        );
        if (!created) return std::unexpected(created.error());

        return uid;
    } catch (const std::exception& e) {
        return std::unexpected(std::string{e.what()});
    }
}

inline Expected<json> DocumentLifecycleService::snapshot(std::string_view ref) {
    try {
        std::lock_guard lk{db_mutex_};
        auto reg = find_registry_locked(ref);
        if (!reg) return std::unexpected(reg.error());
        if (!*reg) return std::unexpected("document not found: " + std::string{ref});

        auto state = active_db_().from("dms_document_states")
            .where("document_uid = ?", (*reg)->get<std::string>("document_uid"))
            .first();
        if (!state)
            return std::unexpected("document state not found: " + std::string{ref});

        return json{
            {"document_uid", (*reg)->get<std::string>("document_uid")},
            {"doc_id", (*reg)->try_get<int64_t>("doc_id").value_or(0)},
            {"path", (*reg)->get<std::string>("path")},
            {"source_path", (*reg)->try_get<std::string>("source_path").value_or("")},
            {"zone_name", (*reg)->try_get<std::string>("zone_name").value_or("global")},
            {"kind", (*reg)->try_get<std::string>("kind").value_or("other")},
            {"mime_type", (*reg)->try_get<std::string>("mime_type").value_or("application/octet-stream")},
            {"size_bytes", (*reg)->try_get<int64_t>("size_bytes").value_or(0)},
            {"mtime", (*reg)->try_get<int64_t>("mtime").value_or(0)},
            {"current_blob_hash", (*reg)->try_get<std::string>("current_blob_hash").value_or("")},
            {"state", state->try_get<std::string>("state").value_or(std::string{document_state_name(DocumentState::Input)})},
            {"review_status", state->try_get<std::string>("review_status").value_or("")},
            {"latest_event_no", state->try_get<int64_t>("latest_event_no").value_or(0)},
            {"latest_content_version", state->try_get<int64_t>("latest_content_version").value_or(0)},
            {"title", state->try_get<std::string>("title").value_or("")},
            {"tags", parse_payload(state->try_get<std::string>("tags_json").value_or("[]"))},
            {"metadata", parse_payload(state->try_get<std::string>("metadata_json").value_or("{}"))},
            {"created_at", state->try_get<int64_t>("created_at").value_or(0)},
            {"updated_at", state->try_get<int64_t>("updated_at").value_or(0)},
            {"archived_at", state->try_get<int64_t>("archived_at").value_or(0)},
        };
    } catch (const std::exception& e) {
        return std::unexpected(std::string{e.what()});
    }
}

inline Expected<json> DocumentLifecycleService::timeline(std::string_view ref, int limit) {
    try {
        std::lock_guard lk{db_mutex_};
        auto reg = find_registry_locked(ref);
        if (!reg) return std::unexpected(reg.error());
        if (!*reg) return std::unexpected("document not found: " + std::string{ref});
        const auto uid = (*reg)->get<std::string>("document_uid");

        json items = json::array();
        auto rows = active_db_().from("dms_document_events")
            .where("document_uid = ?", uid)
            .order_by("event_no", false)
            .limit(limit > 0 ? limit : 50)
            .execute();
        for (const auto& row : rows) {
            items.push_back(json{
                {"id", row.try_get<int64_t>("id").value_or(0)},
                {"event_no", row.try_get<int64_t>("event_no").value_or(0)},
                {"event_type", row.try_get<std::string>("event_type").value_or("")},
                {"state_from", row.try_get<std::string>("state_from").value_or("")},
                {"state_to", row.try_get<std::string>("state_to").value_or("")},
                {"actor", row.try_get<std::string>("actor").value_or("system")},
                {"source", row.try_get<std::string>("source").value_or("system")},
                {"payload", parse_payload(row.try_get<std::string>("payload_json").value_or("{}"))},
                {"created_at", row.try_get<int64_t>("created_at").value_or(0)},
            });
        }
        return json{{"document_uid", uid}, {"events", std::move(items)}};
    } catch (const std::exception& e) {
        return std::unexpected(std::string{e.what()});
    }
}

inline Expected<json> DocumentLifecycleService::transition_state(std::string_view ref,
                                                                 DocumentState next_state,
                                                                 std::string_view actor,
                                                                 std::string_view reason,
                                                                 std::string_view source) {
    try {
        std::string uid;
        {
            std::lock_guard lk{db_mutex_};
            auto reg = find_registry_locked(ref);
            if (!reg) return std::unexpected(reg.error());
            if (!*reg) return std::unexpected("document not found: " + std::string{ref});

            uid = (*reg)->get<std::string>("document_uid");
            auto state_row = active_db_().from("dms_document_states")
                .where("document_uid = ?", uid)
                .first();
            if (!state_row)
                return std::unexpected("document state not found: " + uid);

            const auto now        = pce::db::now_unix();
            const auto before     = state_row->try_get<std::string>("state").value_or(std::string{document_state_name(DocumentState::Input)});
            const auto after      = std::string{document_state_name(next_state)};
            if (before != after) {
                auto ev = append_event_locked(
                    uid,
                    "STATE_CHANGED",
                    before,
                    after,
                    actor,
                    source,
                    json{{"reason", std::string{reason}}},
                    now
                );
                if (!ev) return std::unexpected(ev.error());

                auto upd = active_db_().update("dms_document_states")
                    .set("state", after)
                    .set("updated_at", now);
                if (next_state == DocumentState::Archived)
                    upd.set("archived_at", now);
                else if (before == std::string{document_state_name(DocumentState::Archived)})
                    upd.set("archived_at", int64_t{0});
                discard(upd.where("document_uid = ?", uid).execute());
            }
        }
        return snapshot(uid);
    } catch (const std::exception& e) {
        return std::unexpected(std::string{e.what()});
    }
}

inline Expected<std::string>
DocumentLifecycleService::record_text_extraction(std::string_view ref,
                                                 const TextContentVersion& version,
                                                 std::string_view actor,
                                                 std::string_view source) {
    try {
        std::lock_guard lk{db_mutex_};
        auto reg = find_registry_locked(ref);
        if (!reg) return std::unexpected(reg.error());
        if (!*reg) return std::unexpected("document not found: " + std::string{ref});

        const auto uid = (*reg)->get<std::string>("document_uid");
        auto state_row = active_db_().from("dms_document_states")
            .where("document_uid = ?", uid)
            .first();
        if (!state_row)
            return std::unexpected("document state not found: " + uid);

        const auto now    = pce::db::now_unix();
        const auto before = state_row->try_get<std::string>("state").value_or(std::string{document_state_name(DocumentState::Input)});
        auto latest_text = active_db_().from("dms_document_content_versions")
            .where("document_uid = ? AND content_kind = 'TEXT_EXTRACTED'", uid)
            .order_by("version_no", false)
            .limit(1)
            .first();

        int64_t next_version = state_row->try_get<int64_t>("latest_content_version").value_or(0);
        bool should_insert_version = true;
        if (latest_text && latest_text->try_get<std::string>("text_hash").value_or("") == version.text_hash)
            should_insert_version = false;

        auto ev = append_event_locked(
            uid,
            "TEXT_EXTRACTED",
            before,
            before,
            actor,
            source,
            json{
                {"extractor", version.extractor},
                {"text_hash", version.text_hash},
                {"mime_type", version.mime_type},
                {"details", parse_payload(version.payload_json)},
            },
            now
        );
        if (!ev) return std::unexpected(ev.error());

        if (should_insert_version) {
            ++next_version;
            discard(active_db_().insert_into("dms_document_content_versions")
                .value("document_uid", uid)
                .value("version_no", next_version)
                .value("content_kind", std::string{"TEXT_EXTRACTED"})
                .value("text_hash", version.text_hash)
                .value("blob_hash", std::string{""})
                .value("mime_type", version.mime_type)
                .value("payload_json", version.payload_json)
                .value("created_at", now)
                .value("source_event_no", ev->event_no)
                .execute());
            discard(active_db_().update("dms_document_states")
                .set("latest_content_version", next_version)
                .set("updated_at", now)
                .where("document_uid = ?", uid)
                .execute());
        }

        const auto indexed_name = std::string{document_state_name(DocumentState::Indexed)};
        if (before != indexed_name) {
            auto state_ev = append_event_locked(
                uid,
                "STATE_CHANGED",
                before,
                indexed_name,
                actor,
                source,
                json{{"reason", std::string{"content indexed"}}},
                now
            );
            if (!state_ev) return std::unexpected(state_ev.error());
            discard(active_db_().update("dms_document_states")
                .set("state", indexed_name)
                .set("updated_at", now)
                .where("document_uid = ?", uid)
                .execute());
        }

        return uid;
    } catch (const std::exception& e) {
        return std::unexpected(std::string{e.what()});
    }
}

} // namespace pce::dms
