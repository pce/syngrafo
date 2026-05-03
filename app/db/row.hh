/**
 * @file row.hh
 * @brief Zero-copy view into the current sqlite3_stmt row.
 *
 * All `string_view` / `span` columns point into memory owned by SQLite and are
 * valid only while the statement has not been stepped or reset.  Call `own()`
 * to obtain an owning snapshot when the data must outlive the callback.
 */
#ifndef PCE_DB_ROW_HH
#define PCE_DB_ROW_HH

#include "value.hh"
#include <sqlite3.h>

#include <cassert>
#include <optional>
#include <string_view>
#include <span>
#include <stdexcept>
#include <type_traits>
#include <vector>

namespace pce::db {

class RowView {
public:
    explicit RowView(sqlite3_stmt* stmt) noexcept : stmt_(stmt) {
        assert(stmt_);
    }

    [[nodiscard]] int column_count() const noexcept {
        return sqlite3_column_count(stmt_);
    }

    /// Column name at *col*. Pointer lifetime matches the prepared statement.
    [[nodiscard]] std::string_view column_name(int col) const noexcept {
        return sqlite3_column_name(stmt_, col);
    }

    [[nodiscard]] DbValueView at(int col) const {
        if (col < 0 || col >= column_count())
            throw std::out_of_range("RowView: column index out of range");
        return read_column(col);
    }

    [[nodiscard]] DbValueView operator[](int col) const { return at(col); }

    [[nodiscard]] DbValueView at(std::string_view name) const {
        const int n = column_count();
        for (int i = 0; i < n; ++i) {
            if (column_name(i) == name)
                return read_column(i);
        }
        throw std::invalid_argument("RowView: unknown column '" +
                                    std::string{name} + "'");
    }

    [[nodiscard]] DbValueView operator[](std::string_view name) const {
        return at(name);
    }

    template <typename T>
    [[nodiscard]] std::optional<T> try_get(int col) const {
        auto v = at(col);
        if (std::holds_alternative<std::monostate>(v))
            return std::nullopt;
        return coerce<T>(v);
    }

    template <typename T>
    [[nodiscard]] std::optional<T> try_get(std::string_view name) const {
        auto v = at(name);
        if (std::holds_alternative<std::monostate>(v))
            return std::nullopt;
        return coerce<T>(v);
    }

    template <typename T>
    [[nodiscard]] T get(int col, T fallback = {}) const {
        return try_get<T>(col).value_or(std::move(fallback));
    }

    template <typename T>
    [[nodiscard]] T get(std::string_view name, T fallback = {}) const {
        return try_get<T>(name).value_or(std::move(fallback));
    }

    [[nodiscard]] bool is_null(int col) const {
        return sqlite3_column_type(stmt_, col) == SQLITE_NULL;
    }
    [[nodiscard]] bool is_null(std::string_view name) const {
        return std::holds_alternative<std::monostate>(at(name));
    }

    /// Deep-copy the current row into an owned snapshot.
    [[nodiscard]] std::vector<DbValue> own() const {
        const int n = column_count();
        std::vector<DbValue> out;
        out.reserve(static_cast<size_t>(n));
        for (int i = 0; i < n; ++i)
            out.push_back(own_column(i));
        return out;
    }

private:
    sqlite3_stmt* stmt_;

    [[nodiscard]] DbValueView read_column(int col) const noexcept {
        switch (sqlite3_column_type(stmt_, col)) {
        case SQLITE_NULL:    return std::monostate{};
        case SQLITE_INTEGER: return sqlite3_column_int64(stmt_, col);
        case SQLITE_FLOAT:   return sqlite3_column_double(stmt_, col);
        case SQLITE_TEXT: {
            const auto* p = reinterpret_cast<const char*>(sqlite3_column_text(stmt_, col));
            return TextView{p, static_cast<size_t>(sqlite3_column_bytes(stmt_, col))};
        }
        case SQLITE_BLOB: {
            const auto* p = static_cast<const uint8_t*>(sqlite3_column_blob(stmt_, col));
            return BlobView{p, static_cast<size_t>(sqlite3_column_bytes(stmt_, col))};
        }
        default: return std::monostate{};
        }
    }

    [[nodiscard]] DbValue own_column(int col) const {
        switch (sqlite3_column_type(stmt_, col)) {
        case SQLITE_INTEGER: return sqlite3_column_int64(stmt_, col);
        case SQLITE_FLOAT:   return sqlite3_column_double(stmt_, col);
        case SQLITE_TEXT: {
            const auto* p = reinterpret_cast<const char*>(sqlite3_column_text(stmt_, col));
            return Text{p, static_cast<size_t>(sqlite3_column_bytes(stmt_, col))};
        }
        case SQLITE_BLOB: {
            const auto* p = static_cast<const uint8_t*>(sqlite3_column_blob(stmt_, col));
            const int   n = sqlite3_column_bytes(stmt_, col);
            return Blob{p, p + n};
        }
        default: return std::monostate{};
        }
    }

    template <typename T>
    static T coerce(const DbValueView& v) {
        if constexpr (std::is_same_v<T, bool>)
            return static_cast<bool>(std::get<int64_t>(v));
        else if constexpr (std::is_integral_v<T>)
            return static_cast<T>(std::get<int64_t>(v));
        else if constexpr (std::is_floating_point_v<T>)
            return static_cast<T>(std::get<double>(v));
        else if constexpr (std::is_same_v<T, std::string_view>)
            return std::get<TextView>(v);
        else if constexpr (std::is_same_v<T, std::string>)
            return std::string{std::get<TextView>(v)};
        else if constexpr (std::is_same_v<T, BlobView>)
            return std::get<BlobView>(v);
        else if constexpr (std::is_same_v<T, Blob>) {
            auto sv = std::get<BlobView>(v);
            return Blob{sv.begin(), sv.end()};
        }
        else
            static_assert(!sizeof(T), "RowView::get: unsupported extraction type");
    }
};

} // namespace pce::db
#endif // PCE_DB_ROW_HH

