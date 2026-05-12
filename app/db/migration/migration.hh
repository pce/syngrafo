#pragma once
/**
 * @file migration.hh
 * @brief Core migration descriptor — no SQLite dependency.
 *
 * A `Migration` is a plain-old-data record that binds a monotonically
 * increasing version number to a human-readable name and a SQL statement.
 * Both `name` and `sql` are non-owning views; their backing storage must
 * outlive the migration source that produced them.
 *
 * @see StaticSource  compile-time array of embedded migrations
 * @see FileSource    runtime loader from `data/sql/migrations/`
 * @see apply()       runner that stamps applied versions into `schema_migrations`
 */

#include <string_view>
#include <cstdint>

namespace pce::db::migration {

    struct Migration {
        int64_t          version;  ///< Monotonically increasing schema version.
        std::string_view name;     ///< Human-readable identifier (e.g. "001_init").
        std::string_view sql;      ///< DDL/DML to execute; may be empty for no-op markers.
    };

}
