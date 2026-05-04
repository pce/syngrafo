/**
 * @file runner.hh
 * @brief Schema migration runner — applies pending migrations to a database.
 *
 * `apply()` creates a `schema_migrations` table on first use and then
 * iterates over every `Migration` in the source, skipping versions that have
 * already been recorded.  It is templated over the database type so it works
 * with both `ZeroDatabase` (query.hh) and the legacy `Database` (database.hh).
 *
 * @code{.cpp}
 * // Static (fastest — SQL embedded in binary):
 * migration::apply(db, MIGRATIONS);
 *
 * // File-based (dev mode — reload SQL without recompiling):
 * migration::FileSource fs{"data/sql/migrations"};
 * migration::apply(db, fs);
 * @endcode
 */

#ifndef PCE_DB_RUNNER_HH
#define PCE_DB_RUNNER_HH

#include "source.hh"
#include <chrono>

namespace pce::db::migration {

namespace detail {
    [[nodiscard]] inline int64_t now_unix() {
        return std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count();
    }
}

template<typename Db, MigrationSource Source>
void apply(Db& db, const Source& source) {
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT    NOT NULL,
            applied_at INTEGER NOT NULL
        );
    )sql");

    // Rename legacy 'description' column created by the old apply_migrations helper.
    try { db.exec("ALTER TABLE schema_migrations RENAME COLUMN description TO name;"); }
    catch (...) {}

    for (const auto& m : source.migrations()) {
        const bool already = db.from("schema_migrations")
                               .where("version = ?", m.version)
                               .exists();
        if (already) continue;

        if (!m.sql.empty())
            db.exec(m.sql);

        (void)db.insert_into("schema_migrations")
          .value("version",    m.version)
          .value("name",       m.name)
          .value("applied_at", detail::now_unix())
          .execute();
    }
}

/// Returns the highest migration version already recorded in
/// `schema_migrations`, or 0 when the table does not exist or is empty.
template<typename Db>
[[nodiscard]] inline int64_t current_schema_version(Db& db) noexcept {
    try {
        const auto rows = db.from("schema_migrations")
                              .order_by("version", false)
                              .limit(1)
                              .execute();
        if (!rows.empty())
            return rows[0].template try_get<int64_t>("version").value_or(0);
    } catch (...) {}
    return 0;
}

} // namespace pce::db::migration

#endif //PCE_DB_RUNNER_HH
