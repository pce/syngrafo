/**
 * @file source.hh
 * @brief MigrationSource concept — the single contract every source must satisfy.
 *
 * Any type that exposes a `migrations()` member returning
 * `std::span<const Migration>` qualifies as a `MigrationSource` and can be
 * passed directly to `apply()`.  The two built-in implementations are:
 *
 * | Type           | Backing storage          | Typical use              |
 * |----------------|--------------------------|--------------------------|
 * | `StaticSource` | `std::array` in binary   | production / unit tests  |
 * | `FileSource`   | heap, loaded from disk   | dev-mode hot-reload      |
 */

#ifndef PCE_DB_SOURCE_HH
#define PCE_DB_SOURCE_HH

#include "migration.hh"
#include <span>

namespace pce::db::migration {

    template<typename T>
    concept MigrationSource = requires(T t) {
        { t.migrations() } -> std::same_as<std::span<const Migration>>;
    };

}

#endif //PCE_DB_SOURCE_HH
