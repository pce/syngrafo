/**
 * @file query.hh
 * @brief Zero-copy fluent query builder for SQLite.
 *
 * Bindings are held as `DbValueView` (non-owning views) and bound with
 * `SQLITE_STATIC`; caller buffers must remain alive until `stream()` / `each()`
 * returns.  Row iteration via `stream<Fn>` passes a `RowView` — column data is
 * read directly from the statement buffer without heap allocation.
 *
 * @see database.hh for the owning `Database` / `Row` alternative.
 */
#ifndef PCE_DB_QUERY_HH
#define PCE_DB_QUERY_HH

#include "bind.hh"
#include "concepts.hh"
#include "row.hh"
#include "value.hh"
#include "value_convert.hh"

#include <sqlite3.h>

#include <functional>
#include <optional>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace pce::db {

class ZeroQuery;

class StatementCache {
public:
    explicit StatementCache(sqlite3* db) noexcept : db_(db) {}

    ~StatementCache() noexcept { clear(); }

    StatementCache(const StatementCache&) = delete;
    StatementCache& operator=(const StatementCache&) = delete;

    StatementCache(StatementCache&& o) noexcept
        : db_(o.db_), cache_(std::move(o.cache_)) { o.db_ = nullptr; }

    StatementCache& operator=(StatementCache&& o) noexcept {
        if (this != &o) { clear(); db_ = o.db_; cache_ = std::move(o.cache_); o.db_ = nullptr; }
        return *this;
    }

    /// Fetch a compiled+reset statement, or compile and cache it.
    [[nodiscard]] sqlite3_stmt* get(const std::string& sql) {
        auto it = cache_.find(sql);
        if (it != cache_.end()) {
            sqlite3_reset(it->second);
            sqlite3_clear_bindings(it->second);
            return it->second;
        }
        sqlite3_stmt* stmt = nullptr;
        if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK)
            throw std::runtime_error(
                "db: failed to prepare SQL:\n  " + sql +
                "\n  " + sqlite3_errmsg(db_));
        return cache_[sql] = stmt;
    }

    void clear() noexcept {
        for (auto& [_, s] : cache_) sqlite3_finalize(s);
        cache_.clear();
    }

    [[nodiscard]] sqlite3* handle() const noexcept { return db_; }

private:
    sqlite3* db_ = nullptr;
    std::unordered_map<std::string, sqlite3_stmt*> cache_;
};

class ZeroSelectQuery {
public:
    ZeroSelectQuery(StatementCache& cache, std::string table)
        : cache_(cache), table_(std::move(table)) {}

    ZeroSelectQuery& select(std::initializer_list<std::string_view> cols) {
        for (auto c : cols) columns_.emplace_back(c);
        return *this;
    }

    ZeroSelectQuery& distinct() { distinct_ = true; return *this; }

    ZeroSelectQuery& join(std::string_view tbl, std::string_view on) {
        joins_.emplace_back("INNER JOIN " + std::string{tbl} + " ON " + std::string{on});
        return *this;
    }

    ZeroSelectQuery& left_join(std::string_view tbl, std::string_view on) {
        joins_.emplace_back("LEFT JOIN " + std::string{tbl} + " ON " + std::string{on});
        return *this;
    }

    ZeroSelectQuery& where(std::string_view condition) {
        conditions_.emplace_back(condition);
        return *this;
    }

    /// @param args Caller storage must outlive the terminal call.
    template <DbBindable... Args>
        requires(sizeof...(Args) > 0)
    ZeroSelectQuery& where(std::string_view condition, Args&&... args) {
        conditions_.emplace_back(condition);
        (bindings_.emplace_back(to_db_value_view(std::forward<Args>(args))), ...);
        return *this;
    }

    ZeroSelectQuery& where_null(std::string_view column) {
        conditions_.emplace_back(std::string{column} + " IS NULL");
        return *this;
    }

    ZeroSelectQuery& where_not_null(std::string_view column) {
        conditions_.emplace_back(std::string{column} + " IS NOT NULL");
        return *this;
    }

    ZeroSelectQuery& order_by(std::string_view column, bool asc = true) {
        order_.emplace_back(std::string{column} + (asc ? " ASC" : " DESC"));
        return *this;
    }

    ZeroSelectQuery& limit(int64_t n)  { limit_  = n; return *this; }
    ZeroSelectQuery& offset(int64_t n) { offset_ = n; return *this; }

    /// Hot path — template parameter lets the compiler inline `f` into the step loop.
    /// `RowView` data is valid only inside `f`; do not store `string_view` members.
    template <typename Fn>
    void stream(Fn&& f) {
        auto sql   = build_sql();
        auto* stmt = cache_.get(sql);
        bind_all(stmt);
        while (sqlite3_step(stmt) == SQLITE_ROW)
            f(RowView{stmt});
    }

    /// Type-erased overload; prefer `stream()` for hot paths.
    void each(std::function<void(RowView)> f) {
        stream(std::move(f));
    }

    /// Map each row to T via a zero-overhead template projection.
    template <typename T, typename Fn>
    [[nodiscard]] std::vector<T> map(Fn&& f) {
        std::vector<T> out;
        stream([&](RowView rv) { out.push_back(f(rv)); });
        return out;
    }

    /// Collect all rows as owning snapshots. Use `stream()` to avoid the allocation.
    [[nodiscard]] std::vector<std::vector<DbValue>> collect() {
        std::vector<std::vector<DbValue>> out;
        stream([&](RowView rv) { out.push_back(rv.own()); });
        return out;
    }

    [[nodiscard]] std::optional<std::vector<DbValue>> first() {
        const auto saved = limit_;
        limit_ = 1;
        std::optional<std::vector<DbValue>> result;
        stream([&](RowView rv) { result = rv.own(); });
        limit_ = saved;
        return result;
    }

    template <typename T, typename Fn>
    [[nodiscard]] std::optional<T> first(Fn&& f) {
        std::optional<T> result;
        const auto saved = limit_;
        limit_ = 1;
        stream([&](RowView rv) { result = f(rv); });
        limit_ = saved;
        return result;
    }

    /// COUNT(*) reusing the current WHERE / JOIN clauses.
    [[nodiscard]] int64_t count() {
        const auto saved = columns_;
        columns_ = {"COUNT(*) AS _cnt"};
        auto sql  = build_sql();
        columns_  = saved;

        auto* stmt = cache_.get(sql);
        bind_all(stmt);

        if (sqlite3_step(stmt) == SQLITE_ROW)
            return sqlite3_column_int64(stmt, 0);
        return 0;
    }

    [[nodiscard]] bool exists() { return count() > 0; }

    [[nodiscard]] std::string to_sql() const { return build_sql(); }

private:
    StatementCache& cache_;
    std::string     table_;
    std::vector<std::string>     columns_;
    std::vector<std::string>     joins_;
    std::vector<std::string>     conditions_;
    std::vector<DbValueView>     bindings_;
    std::vector<std::string>     order_;
    std::optional<int64_t>       limit_;
    std::optional<int64_t>       offset_;
    bool distinct_ = false;

    void bind_all(sqlite3_stmt* stmt) const {
        for (int i = 0; i < static_cast<int>(bindings_.size()); ++i)
            db::bind(stmt, i + 1, bindings_[i]);
    }

    static std::string join_sv(const std::vector<std::string>& v, std::string_view sep) {
        std::string out;
        for (size_t i = 0; i < v.size(); ++i) {
            if (i) out.append(sep);
            out.append(v[i]);
        }
        return out;
    }

    [[nodiscard]] std::string build_sql() const {
        std::string sql = "SELECT ";
        if (distinct_) sql += "DISTINCT ";
        sql += columns_.empty() ? "*" : join_sv(columns_, ", ");
        sql += " FROM " + table_;
        for (const auto& j : joins_)   sql += " " + j;
        if (!conditions_.empty())       sql += " WHERE " + join_sv(conditions_, " AND ");
        if (!order_.empty())            sql += " ORDER BY " + join_sv(order_, ", ");
        if (limit_.has_value())         sql += " LIMIT "  + std::to_string(*limit_);
        if (offset_.has_value())        sql += " OFFSET " + std::to_string(*offset_);
        return sql;
    }
};

class ZeroInsertQuery {
public:
    ZeroInsertQuery(StatementCache& cache, std::string table)
        : cache_(cache), table_(std::move(table)) {}

    template <DbBindable T>
    ZeroInsertQuery& value(std::string_view column, T&& v) {
        columns_.emplace_back(column);
        bindings_.emplace_back(to_db_value_view(std::forward<T>(v)));
        return *this;
    }

    ZeroInsertQuery& on_conflict_replace() { mode_ = Mode::replace; return *this; }
    ZeroInsertQuery& on_conflict_ignore()  { mode_ = Mode::ignore;  return *this; }

    [[nodiscard]] int64_t execute() {
        if (columns_.empty())
            throw std::logic_error("ZeroInsertQuery: no values specified");

        auto sql   = build_sql();
        auto* stmt = cache_.get(sql);
        for (int i = 0; i < static_cast<int>(bindings_.size()); ++i)
            db::bind(stmt, i + 1, bindings_[i]);

        const int rc = sqlite3_step(stmt);
        if (rc != SQLITE_DONE && rc != SQLITE_ROW)
            throw std::runtime_error(
                "ZeroInsertQuery::execute: " +
                std::string{sqlite3_errmsg(cache_.handle())} + "\n  SQL: " + sql);

        return sqlite3_last_insert_rowid(cache_.handle());
    }

private:
    enum class Mode { plain, replace, ignore };

    StatementCache&          cache_;
    std::string              table_;
    std::vector<std::string> columns_;
    std::vector<DbValueView> bindings_;
    Mode                     mode_ = Mode::plain;

    [[nodiscard]] std::string build_sql() const {
        const std::string_view verb =
            mode_ == Mode::replace  ? "INSERT OR REPLACE" :
            mode_ == Mode::ignore   ? "INSERT OR IGNORE"  : "INSERT";

        std::string cols, ph;
        for (size_t i = 0; i < columns_.size(); ++i) {
            if (i) { cols += ", "; ph += ", "; }
            cols += columns_[i]; ph += "?";
        }
        return std::string{verb} + " INTO " + table_ +
               " (" + cols + ") VALUES (" + ph + ")";
    }
};

class ZeroUpdateQuery {
public:
    ZeroUpdateQuery(StatementCache& cache, std::string table)
        : cache_(cache), table_(std::move(table)) {}

    template <DbBindable T>
    ZeroUpdateQuery& set(std::string_view column, T&& v) {
        set_clauses_.emplace_back(std::string{column} + " = ?");
        set_bindings_.emplace_back(to_db_value_view(std::forward<T>(v)));
        return *this;
    }

    ZeroUpdateQuery& where(std::string_view condition) {
        conditions_.emplace_back(condition);
        return *this;
    }

    template <DbBindable... Args>
        requires(sizeof...(Args) > 0)
    ZeroUpdateQuery& where(std::string_view condition, Args&&... args) {
        conditions_.emplace_back(condition);
        (where_bindings_.emplace_back(to_db_value_view(std::forward<Args>(args))), ...);
        return *this;
    }

    [[nodiscard]] int execute() {
        if (set_clauses_.empty())
            throw std::logic_error("ZeroUpdateQuery: no SET clauses specified");

        auto sql   = build_sql();
        auto* stmt = cache_.get(sql);

        int idx = 1;
        for (const auto& v : set_bindings_)   db::bind(stmt, idx++, v);
        for (const auto& v : where_bindings_)  db::bind(stmt, idx++, v);

        const int rc = sqlite3_step(stmt);
        if (rc != SQLITE_DONE && rc != SQLITE_ROW)
            throw std::runtime_error(
                "ZeroUpdateQuery::execute: " +
                std::string{sqlite3_errmsg(cache_.handle())} + "\n  SQL: " + sql);

        return sqlite3_changes(cache_.handle());
    }

private:
    StatementCache&          cache_;
    std::string              table_;
    std::vector<std::string> set_clauses_;
    std::vector<DbValueView> set_bindings_;
    std::vector<std::string> conditions_;
    std::vector<DbValueView> where_bindings_;

    [[nodiscard]] std::string build_sql() const {
        static auto join = [](const std::vector<std::string>& v, std::string_view s) {
            std::string o; for (size_t i = 0; i < v.size(); ++i) { if (i) o.append(s); o.append(v[i]); } return o;
        };
        std::string sql = "UPDATE " + table_ + " SET " + join(set_clauses_, ", ");
        if (!conditions_.empty()) sql += " WHERE " + join(conditions_, " AND ");
        return sql;
    }
};

class ZeroDeleteQuery {
public:
    ZeroDeleteQuery(StatementCache& cache, std::string table)
        : cache_(cache), table_(std::move(table)) {}

    ZeroDeleteQuery& where(std::string_view condition) {
        conditions_.emplace_back(condition);
        return *this;
    }

    template <DbBindable... Args>
        requires(sizeof...(Args) > 0)
    ZeroDeleteQuery& where(std::string_view condition, Args&&... args) {
        conditions_.emplace_back(condition);
        (bindings_.emplace_back(to_db_value_view(std::forward<Args>(args))), ...);
        return *this;
    }

    [[nodiscard]] int execute() {
        auto sql   = build_sql();
        auto* stmt = cache_.get(sql);
        for (int i = 0; i < static_cast<int>(bindings_.size()); ++i)
            db::bind(stmt, i + 1, bindings_[i]);

        const int rc = sqlite3_step(stmt);
        if (rc != SQLITE_DONE && rc != SQLITE_ROW)
            throw std::runtime_error(
                "ZeroDeleteQuery::execute: " +
                std::string{sqlite3_errmsg(cache_.handle())} + "\n  SQL: " + sql);

        return sqlite3_changes(cache_.handle());
    }

private:
    StatementCache&          cache_;
    std::string              table_;
    std::vector<std::string> conditions_;
    std::vector<DbValueView> bindings_;

    [[nodiscard]] std::string build_sql() const {
        std::string sql = "DELETE FROM " + table_;
        if (!conditions_.empty()) {
            sql += " WHERE ";
            for (size_t i = 0; i < conditions_.size(); ++i) {
                if (i) sql += " AND ";
                sql += conditions_[i];
            }
        }
        return sql;
    }
};

class ZeroDatabase {
public:
    ZeroDatabase() = default;
    ~ZeroDatabase() { close(); }

    ZeroDatabase(const ZeroDatabase&) = delete;
    ZeroDatabase& operator=(const ZeroDatabase&) = delete;

    ZeroDatabase(ZeroDatabase&& o) noexcept
        : db_(o.db_), cache_(std::move(o.cache_)) { o.db_ = nullptr; }

    ZeroDatabase& operator=(ZeroDatabase&& o) noexcept {
        if (this != &o) {
            close();
            db_    = o.db_;
            cache_ = std::move(o.cache_);
            o.db_  = nullptr;
        }
        return *this;
    }

    static ZeroDatabase open(const std::string& path, bool create_if_missing = true) {
        ZeroDatabase db;
        const int flags =
            SQLITE_OPEN_READWRITE | (create_if_missing ? SQLITE_OPEN_CREATE : 0);
        if (sqlite3_open_v2(path.c_str(), &db.db_, flags, nullptr) != SQLITE_OK)
            throw std::runtime_error("ZeroDatabase::open(\"" + path +
                                     "\"): " + sqlite3_errmsg(db.db_));
        db.cache_.emplace(db.db_);
        db.configure();
        return db;
    }

    static ZeroDatabase open_memory() { return open(":memory:"); }

    void close() noexcept {
        cache_.reset();
        if (db_) { sqlite3_close(db_); db_ = nullptr; }
    }

    [[nodiscard]] bool is_open() const noexcept { return db_ != nullptr; }

    void exec(std::string_view sql) {
        char* err = nullptr;
        if (sqlite3_exec(db_, std::string{sql}.c_str(), nullptr, nullptr, &err) != SQLITE_OK) {
            std::string msg = err ? err : "unknown error";
            sqlite3_free(err);
            throw std::runtime_error("ZeroDatabase::exec: " + msg);
        }
    }

    void begin()    { exec("BEGIN"); }
    void commit()   { exec("COMMIT"); }
    void rollback() { exec("ROLLBACK"); }

    /// RAII transaction — commits on `tx.commit()`, rolls back on destruction.
    struct Transaction {
        explicit Transaction(ZeroDatabase& db) : db_(db) { db_.begin(); }
        ~Transaction() noexcept {
            if (!committed_) try { db_.rollback(); } catch (...) {}
        }
        Transaction(const Transaction&) = delete;
        Transaction& operator=(const Transaction&) = delete;
        void commit() { db_.commit(); committed_ = true; }
    private:
        ZeroDatabase& db_;
        bool committed_ = false;
    };

    [[nodiscard]] Transaction transaction() { return Transaction{*this}; }

    [[nodiscard]] bool table_exists(std::string_view table) {
        return from("sqlite_master")
            .where("type = ?", std::string_view{"table"})
            .where("name = ?", table)
            .exists();
    }

    [[nodiscard]] int64_t last_insert_rowid() const noexcept {
        return sqlite3_last_insert_rowid(db_);
    }

    [[nodiscard]] int changes() const noexcept { return sqlite3_changes(db_); }

    [[nodiscard]] ZeroSelectQuery from(std::string_view table) {
        return ZeroSelectQuery{*cache_, std::string{table}};
    }

    [[nodiscard]] ZeroInsertQuery insert_into(std::string_view table) {
        return ZeroInsertQuery{*cache_, std::string{table}};
    }

    [[nodiscard]] ZeroUpdateQuery update(std::string_view table) {
        return ZeroUpdateQuery{*cache_, std::string{table}};
    }

    [[nodiscard]] ZeroDeleteQuery delete_from(std::string_view table) {
        return ZeroDeleteQuery{*cache_, std::string{table}};
    }

    [[nodiscard]] sqlite3* handle() noexcept { return db_; }

private:
    sqlite3* db_ = nullptr;
    std::optional<StatementCache> cache_;

    void configure() {
        sqlite3_exec(db_, "PRAGMA journal_mode=WAL;",     nullptr, nullptr, nullptr);
        sqlite3_exec(db_, "PRAGMA foreign_keys=ON;",      nullptr, nullptr, nullptr);
        sqlite3_exec(db_, "PRAGMA synchronous=NORMAL;",   nullptr, nullptr, nullptr);
        sqlite3_exec(db_, "PRAGMA temp_store=MEMORY;",    nullptr, nullptr, nullptr);
        sqlite3_exec(db_, "PRAGMA cache_size=-8000;",     nullptr, nullptr, nullptr);
    }
};

} // namespace pce::db
#endif // PCE_DB_QUERY_HH

