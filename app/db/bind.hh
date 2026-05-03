/**
 * @file bind.hh
 * @brief sqlite3_stmt parameter binding for DbValueView.
 */
#ifndef PCE_DB_BIND_HH
#define PCE_DB__BIND_HH
#include "value.hh"
#include <sqlite3.h>

namespace pce::db {

    inline void bind(sqlite3_stmt* stmt, int idx, const DbValueView& v) {
        std::visit([&](auto&& val) {
            using T = std::decay_t<decltype(val)>;

            if constexpr (std::is_same_v<T, std::monostate>)
                sqlite3_bind_null(stmt, idx);

            else if constexpr (std::is_same_v<T, int64_t>)
                sqlite3_bind_int64(stmt, idx, val);

            else if constexpr (std::is_same_v<T, double>)
                sqlite3_bind_double(stmt, idx, val);

            else if constexpr (std::is_same_v<T, std::string_view>)
                sqlite3_bind_text(stmt, idx, val.data(), val.size(), SQLITE_STATIC);

            else if constexpr (std::is_same_v<T, std::span<const uint8_t>>)
                sqlite3_bind_blob(stmt, idx, val.data(), val.size(), SQLITE_STATIC);

        }, v);
    }

}
#endif //PCE_DB__BIND_HH
