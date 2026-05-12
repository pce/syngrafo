#pragma once
/**
 * @file internal/schema.hh
 * @brief Bootstrap helpers and versioned migrations for the DMS SQLite schema.
 * @note Application-internal.
 */

#include "../db/database.hh"
#include "../db/migration/runner.hh"
#include "../db/migration/source_static.hh"

#include <print>
#include <string>

namespace pce::dms {



struct ZoneRow {
    std::string name;
    std::string in_path;
    std::string out_path;
    int64_t     last_visited{};
    std::string description;
    std::string taxonomy_domain;
};



inline void bootstrap_zone_schema(pce::db::Database& db) {
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_zones (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT    NOT NULL,
            in_path          TEXT    NOT NULL UNIQUE,
            out_path         TEXT    NOT NULL,
            last_visited     INTEGER NOT NULL DEFAULT 0,
            password_hashed  TEXT,
            is_encrypted     INTEGER NOT NULL DEFAULT 0,
            description      TEXT    NOT NULL DEFAULT '',
            taxonomy_domain  TEXT    NOT NULL DEFAULT 'General'
        );
    )sql");
    for (const char* sql : {
        "ALTER TABLE dms_zones ADD COLUMN password_hashed TEXT;",
        "ALTER TABLE dms_zones ADD COLUMN is_encrypted INTEGER NOT NULL DEFAULT 0;",
        "ALTER TABLE dms_zones ADD COLUMN description TEXT NOT NULL DEFAULT '';",
        "ALTER TABLE dms_zones ADD COLUMN taxonomy_domain TEXT NOT NULL DEFAULT 'General';",
        "ALTER TABLE dms_zones ADD COLUMN salt_hex TEXT NOT NULL DEFAULT '';"
    }) {
        try { db.exec(sql); } catch (...) {}
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_zones_visited "
            "ON dms_zones (last_visited DESC);");
}

inline void bootstrap_preferences_schema(pce::db::Database& db) {
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS app_preferences (
            key        TEXT    PRIMARY KEY,
            value      TEXT    NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL DEFAULT 0
        );
    )sql");
}

inline void bootstrap_global_schema(pce::db::Database& db) {
    bootstrap_zone_schema(db);
    bootstrap_preferences_schema(db);
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_ocr_cache (
            path        TEXT    PRIMARY KEY,
            text        TEXT    NOT NULL,
            mtime       INTEGER NOT NULL,
            created_at  INTEGER NOT NULL
        );
    )sql");
}

inline void bootstrap_dms_schema(pce::db::Database& db) {
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_documents (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            path        TEXT    NOT NULL UNIQUE,
            filename    TEXT    NOT NULL DEFAULT '',
            extension   TEXT    NOT NULL DEFAULT '',
            size_bytes  INTEGER NOT NULL DEFAULT 0,
            mtime       INTEGER NOT NULL DEFAULT 0,
            mime_type   TEXT    NOT NULL DEFAULT 'text/plain',
            indexed_at  INTEGER NOT NULL DEFAULT 0,
            text_hash   TEXT    NOT NULL DEFAULT '',
            snippet     TEXT    NOT NULL DEFAULT '',
            origin_path TEXT,
            is_transformed INTEGER DEFAULT 0,
            transform_meta TEXT,
            content_blob BLOB
        );
    )sql");
    for (const char* sql : {
        "ALTER TABLE dms_documents ADD COLUMN content_blob BLOB;",
        "ALTER TABLE dms_documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'other';"
    }) { try { db.exec(sql); } catch (...) {} }

    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_kind    ON dms_documents(kind);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_path    ON dms_documents(path);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_indexed ON dms_documents(indexed_at DESC);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_mime    ON dms_documents(mime_type);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_mtime   ON dms_documents(mtime DESC);");
}

inline void bootstrap_bookmark_schema(pce::db::Database& db) {
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS zone_bookmarks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            zone_name   TEXT    NOT NULL,
            label       TEXT    NOT NULL DEFAULT '',
            root        TEXT    NOT NULL DEFAULT 'workspace',
            target      TEXT    NOT NULL,
            kind        TEXT    NOT NULL DEFAULT 'file',
            line_from   INTEGER NOT NULL DEFAULT 0,
            line_to     INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL DEFAULT 0,
            updated_at  INTEGER NOT NULL DEFAULT 0,
            sort_order  INTEGER NOT NULL DEFAULT 0
        );
    )sql");
    try { db.exec("ALTER TABLE zone_bookmarks ADD COLUMN root TEXT NOT NULL DEFAULT 'workspace';"); }
    catch (...) {}
    db.exec("CREATE INDEX IF NOT EXISTS idx_zone_bookmarks_zone "
            "ON zone_bookmarks (zone_name, sort_order);");
}

inline void bootstrap_palette_schema(pce::db::Database& db) {
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS zone_palettes (
            id           TEXT    PRIMARY KEY,
            name         TEXT    NOT NULL DEFAULT '',
            kind         TEXT    NOT NULL DEFAULT 'project',
            colors_json  TEXT    NOT NULL DEFAULT '[]',
            description  TEXT    NOT NULL DEFAULT '',
            created_at   INTEGER NOT NULL DEFAULT 0,
            updated_at   INTEGER NOT NULL DEFAULT 0
        );
    )sql");
    db.exec("CREATE INDEX IF NOT EXISTS idx_zone_palettes_kind "
            "ON zone_palettes (kind);");
}

/// Initialise FTS5 full-text search table. Safe to call on every startup.
/// Silently skips if FTS5 is not compiled into SQLite (falls back to LIKE search).
inline void bootstrap_fts_schema(pce::db::Database& db) {
    try {
        db.exec(R"sql(
            CREATE VIRTUAL TABLE IF NOT EXISTS dms_fts USING fts5(
                filename,
                keywords,
                body,
                tokenize = 'unicode61'
            );
        )sql");
    } catch (const std::exception& e) {
        std::print(stderr, "[dms] FTS5 unavailable — keyword search will use LIKE fallback. ({})\n", e.what());
    }
}

/// Placeholder schema for future chunk-level indexing.
/// Populated by a future chunking pass; schema declared now so migrations are stable.
inline void bootstrap_chunks_schema(pce::db::Database& db) {
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_chunks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_id      INTEGER NOT NULL,
            position    INTEGER NOT NULL DEFAULT 0,
            token_count INTEGER NOT NULL DEFAULT 0,
            chunk_text  TEXT    NOT NULL DEFAULT '',
            embedding   BLOB,
            updated_at  INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (doc_id) REFERENCES dms_documents(id) ON DELETE CASCADE
        );
    )sql");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_chunks_doc "
            "ON dms_chunks (doc_id, position);");
}

/// Initialise SDM editor-authored documents table.  Safe to call on every startup.
/// These are block-structured documents created inside the app, distinct from
/// `dms_documents` which indexes files from the filesystem.
inline void bootstrap_sdm_schema(pce::db::Database& db) {
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS sdm_documents (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid        TEXT    NOT NULL UNIQUE,
            title       TEXT    NOT NULL DEFAULT '',
            blocks_json TEXT    NOT NULL DEFAULT '[]',
            styles_json TEXT    NOT NULL DEFAULT '{}',
            page_json   TEXT    NOT NULL DEFAULT '{}',
            zone_name   TEXT    NOT NULL DEFAULT '',
            created_at  INTEGER NOT NULL DEFAULT 0,
            updated_at  INTEGER NOT NULL DEFAULT 0
        );
    )sql");
    db.exec("CREATE INDEX IF NOT EXISTS idx_sdm_documents_zone "
            "ON sdm_documents (zone_name, updated_at DESC);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_sdm_documents_uuid "
            "ON sdm_documents (uuid);");
}

/// Initialise the global recent-exports audit log.  Safe to call on every startup.
/// Records every PDF/HTML export so the frontend can show a "Recent Files" list.
/// Uses `doc_uuid` (not `doc_id`) because the source document may live in a
/// different (zone) database whose integer row-ids are not portable.
inline void bootstrap_recent_exports_schema(pce::db::Database& db) {
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_recent_exports (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_uuid    TEXT    NOT NULL DEFAULT '',
            title       TEXT    NOT NULL DEFAULT '',
            path        TEXT    NOT NULL,
            kind        TEXT    NOT NULL DEFAULT 'pdf',
            zone_name   TEXT    NOT NULL DEFAULT '',
            exported_at INTEGER NOT NULL DEFAULT 0,
            file_size   INTEGER NOT NULL DEFAULT 0
        );
    )sql");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_recent_exports_date "
            "ON dms_recent_exports (exported_at DESC);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_recent_exports_zone "
            "ON dms_recent_exports (zone_name, exported_at DESC);");
}

/// Initialise media_projects table for persisted video/audio projects.
/// kind = 'video' | 'audio'. Safe to call on every startup.
inline void bootstrap_media_projects_schema(pce::db::Database& db) {
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS media_projects (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            kind        TEXT    NOT NULL,
            name        TEXT    NOT NULL,
            zone_name   TEXT    NOT NULL DEFAULT 'global',
            data_json   TEXT    NOT NULL DEFAULT '{}',
            created_at  INTEGER NOT NULL DEFAULT 0,
            updated_at  INTEGER NOT NULL DEFAULT 0,
            UNIQUE(kind, name, zone_name) ON CONFLICT REPLACE
        );
    )sql");
    db.exec("CREATE INDEX IF NOT EXISTS idx_media_projects_kind_zone "
            "ON media_projects (kind, zone_name, updated_at DESC);");
}

/// Initialise workspaces and workspace_items tables. Safe to call on every startup.
inline void bootstrap_workspace_schema(pce::db::Database& db) {
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS workspaces (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            description TEXT    NOT NULL DEFAULT '',
            icon        TEXT    NOT NULL DEFAULT 'workspace',
            color       TEXT    NOT NULL DEFAULT '',
            is_pinned   INTEGER NOT NULL DEFAULT 0,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL DEFAULT 0,
            updated_at  INTEGER NOT NULL DEFAULT 0
        );
    )sql");
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS workspace_items (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            doc_id       INTEGER REFERENCES dms_documents(id) ON DELETE SET NULL,
            kind         TEXT    NOT NULL DEFAULT 'document',
            target       TEXT    NOT NULL DEFAULT '',
            note         TEXT    NOT NULL DEFAULT '',
            position     INTEGER NOT NULL DEFAULT 0,
            added_at     INTEGER NOT NULL DEFAULT 0
        );
    )sql");
    db.exec("CREATE INDEX IF NOT EXISTS idx_workspaces_pinned "
            "ON workspaces (is_pinned DESC, sort_order);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_workspace_items_ws "
            "ON workspace_items (workspace_id, position);");
}

inline void bootstrap_document_lifecycle_schema(pce::db::Database& db) {
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_blob_store (
            blob_hash    TEXT    PRIMARY KEY,
            algorithm    TEXT    NOT NULL DEFAULT 'fnv1a64',
            storage_key  TEXT    NOT NULL DEFAULT '',
            mime_type    TEXT    NOT NULL DEFAULT 'application/octet-stream',
            size_bytes   INTEGER NOT NULL DEFAULT 0,
            created_at   INTEGER NOT NULL DEFAULT 0,
            last_seen_at INTEGER NOT NULL DEFAULT 0
        );
    )sql");
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_document_registry (
            document_uid      TEXT    PRIMARY KEY,
            doc_id            INTEGER REFERENCES dms_documents(id) ON DELETE SET NULL,
            path              TEXT    NOT NULL UNIQUE,
            source_path       TEXT    NOT NULL DEFAULT '',
            zone_name         TEXT    NOT NULL DEFAULT 'global',
            kind              TEXT    NOT NULL DEFAULT 'other',
            mime_type         TEXT    NOT NULL DEFAULT 'application/octet-stream',
            size_bytes        INTEGER NOT NULL DEFAULT 0,
            mtime             INTEGER NOT NULL DEFAULT 0,
            current_blob_hash TEXT    NOT NULL DEFAULT '',
            created_at        INTEGER NOT NULL DEFAULT 0,
            updated_at        INTEGER NOT NULL DEFAULT 0
        );
    )sql");
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_document_states (
            document_uid            TEXT    PRIMARY KEY,
            state                   TEXT    NOT NULL DEFAULT 'INPUT',
            workflow_id             TEXT    NOT NULL DEFAULT '',
            workflow_state_key      TEXT    NOT NULL DEFAULT '',
            workflow_updated_at     INTEGER NOT NULL DEFAULT 0,
            review_status           TEXT    NOT NULL DEFAULT '',
            latest_event_no         INTEGER NOT NULL DEFAULT 0,
            latest_content_version  INTEGER NOT NULL DEFAULT 0,
            title                   TEXT    NOT NULL DEFAULT '',
            tags_json               TEXT    NOT NULL DEFAULT '[]',
            metadata_json           TEXT    NOT NULL DEFAULT '{}',
            created_at              INTEGER NOT NULL DEFAULT 0,
            updated_at              INTEGER NOT NULL DEFAULT 0,
            archived_at             INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (document_uid) REFERENCES dms_document_registry(document_uid) ON DELETE CASCADE
        );
    )sql");
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_document_events (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            document_uid TEXT    NOT NULL,
            event_no     INTEGER NOT NULL DEFAULT 0,
            event_type   TEXT    NOT NULL DEFAULT '',
            state_from   TEXT    NOT NULL DEFAULT '',
            state_to     TEXT    NOT NULL DEFAULT '',
            actor        TEXT    NOT NULL DEFAULT 'system',
            reason       TEXT    NOT NULL DEFAULT '',
            source       TEXT    NOT NULL DEFAULT 'system',
            payload_json TEXT    NOT NULL DEFAULT '{}',
            created_at   INTEGER NOT NULL DEFAULT 0,
            UNIQUE (document_uid, event_no),
            FOREIGN KEY (document_uid) REFERENCES dms_document_registry(document_uid) ON DELETE CASCADE
        );
    )sql");
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_document_content_versions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            document_uid    TEXT    NOT NULL,
            version_no      INTEGER NOT NULL DEFAULT 0,
            content_kind    TEXT    NOT NULL DEFAULT 'TEXT_EXTRACTED',
            text_hash       TEXT    NOT NULL DEFAULT '',
            blob_hash       TEXT    NOT NULL DEFAULT '',
            mime_type       TEXT    NOT NULL DEFAULT 'text/plain',
            payload_json    TEXT    NOT NULL DEFAULT '{}',
            created_at      INTEGER NOT NULL DEFAULT 0,
            source_event_no INTEGER NOT NULL DEFAULT 0,
            UNIQUE (document_uid, version_no),
            FOREIGN KEY (document_uid) REFERENCES dms_document_registry(document_uid) ON DELETE CASCADE
        );
    )sql");
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_zone_workflows (
            id          TEXT    PRIMARY KEY,
            zone_name   TEXT    NOT NULL DEFAULT '',
            name        TEXT    NOT NULL DEFAULT '',
            is_default  INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL DEFAULT 0,
            updated_at  INTEGER NOT NULL DEFAULT 0
        );
    )sql");
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_workflow_states (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            workflow_id     TEXT    NOT NULL,
            state_key       TEXT    NOT NULL,
            label           TEXT    NOT NULL DEFAULT '',
            color           TEXT    NOT NULL DEFAULT '',
            category        TEXT    NOT NULL DEFAULT '',
            is_default      INTEGER NOT NULL DEFAULT 0,
            is_terminal     INTEGER NOT NULL DEFAULT 0,
            sort_order      INTEGER NOT NULL DEFAULT 0,
            UNIQUE (workflow_id, state_key)
        );
    )sql");
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_workflow_transitions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            workflow_id     TEXT    NOT NULL,
            from_state_key  TEXT    NOT NULL DEFAULT '',
            to_state_key    TEXT    NOT NULL DEFAULT '',
            label           TEXT    NOT NULL DEFAULT '',
            requires_reason INTEGER NOT NULL DEFAULT 0,
            sort_order      INTEGER NOT NULL DEFAULT 0,
            UNIQUE (workflow_id, from_state_key, to_state_key)
        );
    )sql");
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_document_links (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            zone_name   TEXT    NOT NULL DEFAULT '',
            source_ref  TEXT    NOT NULL DEFAULT '',
            target_ref  TEXT    NOT NULL DEFAULT '',
            link_type   TEXT    NOT NULL DEFAULT 'depends_on',
            note        TEXT    NOT NULL DEFAULT '',
            status      TEXT    NOT NULL DEFAULT 'active',
            created_at  INTEGER NOT NULL DEFAULT 0
        );
    )sql");
    for (const char* sql : {
        "ALTER TABLE dms_document_states ADD COLUMN workflow_id TEXT NOT NULL DEFAULT '';",
        "ALTER TABLE dms_document_states ADD COLUMN workflow_state_key TEXT NOT NULL DEFAULT '';",
        "ALTER TABLE dms_document_states ADD COLUMN workflow_updated_at INTEGER NOT NULL DEFAULT 0;",
        "ALTER TABLE dms_document_events ADD COLUMN reason TEXT NOT NULL DEFAULT '';"
    }) { try { db.exec(sql); } catch (...) {} }
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_blob_store_seen "
            "ON dms_blob_store (last_seen_at DESC);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_registry_doc "
            "ON dms_document_registry (doc_id);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_registry_zone "
            "ON dms_document_registry (zone_name, updated_at DESC);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_states_state "
            "ON dms_document_states (state, updated_at DESC);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_states_workflow "
            "ON dms_document_states (workflow_state_key, workflow_updated_at DESC);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_events_doc "
            "ON dms_document_events (document_uid, event_no DESC);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_events_type "
            "ON dms_document_events (event_type, created_at DESC);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_versions_doc "
            "ON dms_document_content_versions (document_uid, version_no DESC);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_zone_workflows_zone "
            "ON dms_zone_workflows (zone_name, is_default DESC);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_workflow_states_workflow "
            "ON dms_workflow_states (workflow_id, sort_order);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_workflow_transitions_workflow "
            "ON dms_workflow_transitions (workflow_id, from_state_key, sort_order);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_document_links_zone "
            "ON dms_document_links (zone_name, created_at DESC);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_document_links_source "
            "ON dms_document_links (source_ref, created_at DESC);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_document_links_target "
            "ON dms_document_links (target_ref, created_at DESC);");
}



inline constexpr pce::db::migration::StaticSource<1> kDmsMigrations{{{
    // The application bootstraps the full current schema on startup. Keep the
    // static migration source as a minimal baseline marker instead of replaying
    // historical additive steps that are already encoded in the bootstrap path.
    {1, "baseline", ""},
}}};

} // namespace pce::dms
