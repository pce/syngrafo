/**
 * @file source_static.hh
 * @brief Compile-time migration source — SQL embedded directly in the binary.
 *
 * Declare a `constexpr StaticSource` holding all migrations and pass it to
 * `apply()`.  Because every string lives in read-only program memory there
 * are zero heap allocations and no I/O at startup.
 *
 * @code{.cpp}
 * #include "app/db/migration/source_static.hh"
 * #include "app/db/migration/runner.hh"
 *
 * constexpr pce::db::migration::StaticSource MIGRATIONS {{
 *     { 1, "001_init",      "CREATE TABLE documents (...);" },
 *     { 2, "002_add_index", "CREATE INDEX ..." },
 * }};
 *
 * // at startup:
 * migration::apply(db, MIGRATIONS);
 * @endcode
 */

#ifndef SYNGRAFO_SOURCE_STATIC_HH
#define SYNGRAFO_SOURCE_STATIC_HH

#include "migration.hh"
#include <array>
#include <span>

namespace pce::db::migration {

    template<size_t N>
    struct StaticSource {
        std::array<Migration, N> data;

        constexpr std::span<const Migration> migrations() const {
            return data;
        }
    };

}

#endif //SYNGRAFO_SOURCE_STATIC_HH
