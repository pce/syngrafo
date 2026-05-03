#pragma once
/**
 * @file internal/schema.hh
 * @brief SQLite schema bootstrap functions and migration table for the DMS.
 *
 * @note Application-internal. Do not include from external headers.
 */

#include "../db/database.hh"

#include <array>
#include <string>

namespace pce::dms {

// ─── Value types ──────────────────────────────────────────────────────────────

struct ZoneRow {
    std::string name;
    std::string in_path;
    std::string out_path;
    int64_t     last_visited{};
    std::string description;
    std::string taxonomy_domain;
};

// ─── Bootstrap helpers ────────────────────────────────────────────────────────

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

// ─── Versioned migrations ─────────────────────────────────────────────────────

/** Migrations 1–4 cover the old try-catch ALTER TABLE pattern. 5+ are additive. */
inline const std::array<pce::db::Migration, 12> kDmsMigrations{{
    {1, "baseline dms + nlp + zone schema",         nullptr},
    {2, "dms_documents: add content_blob",
        "ALTER TABLE dms_documents ADD COLUMN content_blob BLOB;"},
    {3, "dms_documents: add kind",
        "ALTER TABLE dms_documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'other';"},
    {4, "dms_zones: add salt_hex",
        "ALTER TABLE dms_zones ADD COLUMN salt_hex TEXT NOT NULL DEFAULT '';"},
    {5, "zone_palettes table",
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
    {6, "zone_palettes: kind index",
        "CREATE INDEX IF NOT EXISTS idx_zone_palettes_kind ON zone_palettes (kind);"},
    {7, "dms_zones: add description",
        "ALTER TABLE dms_zones ADD COLUMN description TEXT NOT NULL DEFAULT '';"},
    {8, "dms_zones: add taxonomy_domain",
        "ALTER TABLE dms_zones ADD COLUMN taxonomy_domain TEXT NOT NULL DEFAULT 'General';"},
    {9, "dms_documents: ensure indices",
        R"sql(
        CREATE INDEX IF NOT EXISTS idx_dms_doc_kind    ON dms_documents(kind);
        CREATE INDEX IF NOT EXISTS idx_dms_doc_path    ON dms_documents(path);
        CREATE INDEX IF NOT EXISTS idx_dms_doc_indexed ON dms_documents(indexed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_dms_doc_mime    ON dms_documents(mime_type);
        CREATE INDEX IF NOT EXISTS idx_dms_doc_mtime   ON dms_documents(mtime DESC);
        )sql"},
    {10, "app_preferences table",
        R"sql(
        CREATE TABLE IF NOT EXISTS app_preferences (
            key        TEXT    PRIMARY KEY,
            value      TEXT    NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL DEFAULT 0
        );
        )sql"},
    {11, "zone_bookmarks table",
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
}};

} // namespace pce::dms

