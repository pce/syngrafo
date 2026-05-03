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

    for (const auto& m : source.migrations()) {
        const bool already = db.from("schema_migrations")
                               .where("version = ?", m.version)
                               .exists();
        if (already) continue;

        if (!m.sql.empty())
            db.exec(m.sql);

        db.insert_into("schema_migrations")
          .value("version",    m.version)
          .value("name",       m.name)
          .value("applied_at", detail::now_unix())
          .execute();
    }
}

} // namespace pce::db::migration
#endif //PCE_DB_RUNNER_HH
