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
            target      TEXT    NOT NULL,
            kind        TEXT    NOT NULL DEFAULT 'file',
            line_from   INTEGER NOT NULL DEFAULT 0,
            line_to     INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL DEFAULT 0,
            updated_at  INTEGER NOT NULL DEFAULT 0,
            sort_order  INTEGER NOT NULL DEFAULT 0
        );
    )sql");
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



inline constexpr pce::db::migration::StaticSource<16> kDmsMigrations{{{
    {1,  "baseline",                        ""},
    {2,  "dms_documents: content_blob",
         "ALTER TABLE dms_documents ADD COLUMN content_blob BLOB;"},
    {3,  "dms_documents: kind",
         "ALTER TABLE dms_documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'other';"},
    {4,  "dms_zones: salt_hex",
         "ALTER TABLE dms_zones ADD COLUMN salt_hex TEXT NOT NULL DEFAULT '';"},
    {5,  "zone_palettes",
         R"sql(
         CREATE TABLE IF NOT EXISTS zone_palettes (
             id           TEXT    PRIMARY KEY,
             name         TEXT    NOT NULL DEFAULT '',
             kind         TEXT    NOT NULL DEFAULT 'project',
             colors_json  TEXT    NOT NULL DEFAULT '[]',
             description  TEXT    NOT NULL DEFAULT '',
             created_at   INTEGER NOT NULL DEFAULT 0,
             updated_at   INTEGER NOT NULL DEFAULT 0
         );
         )sql"},
    {6,  "zone_palettes: kind index",
         "CREATE INDEX IF NOT EXISTS idx_zone_palettes_kind ON zone_palettes (kind);"},
    {7,  "dms_zones: description",
         "ALTER TABLE dms_zones ADD COLUMN description TEXT NOT NULL DEFAULT '';"},
    {8,  "dms_zones: taxonomy_domain",
         "ALTER TABLE dms_zones ADD COLUMN taxonomy_domain TEXT NOT NULL DEFAULT 'General';"},
    {9,  "dms_documents: indices",
         R"sql(
         CREATE INDEX IF NOT EXISTS idx_dms_doc_kind    ON dms_documents(kind);
         CREATE INDEX IF NOT EXISTS idx_dms_doc_path    ON dms_documents(path);
         CREATE INDEX IF NOT EXISTS idx_dms_doc_indexed ON dms_documents(indexed_at DESC);
         CREATE INDEX IF NOT EXISTS idx_dms_doc_mime    ON dms_documents(mime_type);
         CREATE INDEX IF NOT EXISTS idx_dms_doc_mtime   ON dms_documents(mtime DESC);
         )sql"},
    {10, "app_preferences",
         R"sql(
         CREATE TABLE IF NOT EXISTS app_preferences (
             key        TEXT    PRIMARY KEY,
             value      TEXT    NOT NULL DEFAULT '',
             updated_at INTEGER NOT NULL DEFAULT 0
         );
         )sql"},
    {11, "zone_bookmarks",
         R"sql(
         CREATE TABLE IF NOT EXISTS zone_bookmarks (
             id          INTEGER PRIMARY KEY AUTOINCREMENT,
             zone_name   TEXT    NOT NULL,
             label       TEXT    NOT NULL DEFAULT '',
             target      TEXT    NOT NULL,
             kind        TEXT    NOT NULL DEFAULT 'file',
             line_from   INTEGER NOT NULL DEFAULT 0,
             line_to     INTEGER NOT NULL DEFAULT 0,
             created_at  INTEGER NOT NULL DEFAULT 0,
             updated_at  INTEGER NOT NULL DEFAULT 0,
             sort_order  INTEGER NOT NULL DEFAULT 0
         );
         )sql"},
    {12, "zone_bookmarks: zone index",
         "CREATE INDEX IF NOT EXISTS idx_zone_bookmarks_zone "
         "ON zone_bookmarks (zone_name, sort_order);"},
    {13, "dms_fts",
         R"sql(
         CREATE VIRTUAL TABLE IF NOT EXISTS dms_fts USING fts5(
             filename,
             keywords,
             body,
             tokenize = 'unicode61'
         );
         )sql"},
    {14, "dms_chunks",
         R"sql(
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
         CREATE INDEX IF NOT EXISTS idx_dms_chunks_doc ON dms_chunks (doc_id, position);
         )sql"},
    {15, "workspaces",
         R"sql(
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
         CREATE INDEX IF NOT EXISTS idx_workspaces_pinned
             ON workspaces (is_pinned DESC, sort_order);
         )sql"},
    {16, "workspace_items",
         R"sql(
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
         CREATE INDEX IF NOT EXISTS idx_workspace_items_ws
             ON workspace_items (workspace_id, position);
         )sql"},
}}};

} // namespace pce::dms
