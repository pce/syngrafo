#pragma once

// =============================================================================
// pce::db::Database  —  LINQ-style fluent query builder for SQLite / SQLCipher
// =============================================================================
//
// Header-only.  No generated code, no macros, no schema registration.
// Requires C++23.  Link against sqlite3 or sqlcipher:
//
//   target_link_libraries(<target> PRIVATE SQLite::SQLite3)   # plain
//   target_link_libraries(<target> PRIVATE sqlcipher)         # encrypted
//
// ── Quick-start
// ───────────────────────────────────────────────────────────────
//
//   auto db = db::Database::open("app.db");          // plain
//   auto db = db::Database::open_encrypted(          // SQLCipher
//                 "app.db", passphrase);
//
//   // SELECT ─────────────────────────────────────────────────────────────────
//   auto rows = db.from("accounts")
//                 .where("industry = ?", "fintech")
//                 .where("active = ?", true)
//                 .order_by("name")
//                 .limit(20)
//                 .execute();
//
//   for (auto& r : rows)
//       std::println("{} — {}", r.get<int64_t>("id"),
//       r.get<std::string>("name"));
//
//   // Typed projection via map<T> ──────────────────────────────────────────
//   struct Account { int64_t id; std::string name; std::string industry; };
//
//   auto accounts = db.from("accounts")
//                     .where("industry = ?", "fintech")
//                     .map<Account>([](const db::Row& r) {
//                         return Account{
//                             r.get<int64_t>    ("id"),
//                             r.get<std::string>("name"),
//                             r.get<std::string>("industry"),
//                         };
//                     });
//
//   // BETWEEN ─────────────────────────────────────────────────────────────
//   auto recent = db.from("nlp_notes")
//                   .where("created_at BETWEEN ? AND ?", t0, t1)
//                   .order_by("created_at", /*asc=*/false)
//                   .execute();
//
//   // JOIN ────────────────────────────────────────────────────────────────
//   auto rows = db.from("projects")
//                 .left_join("nlp_notes",
//                            "nlp_notes.row_id = projects.id"
//                            " AND nlp_notes.row_type = 'project'")
//                 .select({"projects.id", "projects.title",
//                 "nlp_notes.sentiment"}) .where("projects.account_id = ?",
//                 account_id) .execute();
//
//   // INSERT OR REPLACE ───────────────────────────────────────────────────
//   db.insert_into("nlp_embeddings")
//     .value("row_type",   "account")
//     .value("row_id",     account_id)
//     .value("text_hash",  hash)
//     .value("vector",     blob)          // std::vector<uint8_t>
//     .value("updated_at", now_unix())
//     .on_conflict_replace()
//     .execute();
//
//   // UPDATE ──────────────────────────────────────────────────────────────
//   db.update("accounts")
//     .set("sentiment_score", 0.73)
//     .set("updated_at",      now_unix())
//     .where("id = ?",        account_id)
//     .execute();
//
//   // DELETE ──────────────────────────────────────────────────────────────
//   db.delete_from("nlp_embeddings")
//     .where("row_type = ?", "contact")
//     .where("row_id = ?",   contact_id)
//     .execute();
//
//   // TRANSACTION ─────────────────────────────────────────────────────────
//   {
//       auto tx = db.transaction();          // BEGIN
//       db.insert_into("accounts").value("name", "Acme").execute();
//       db.insert_into("projects").value("account_id", 1) .execute();
//       tx.commit();                         // COMMIT on scope exit otherwise
//       ROLLBACK
//   }
//
// ── Performance
// ───────────────────────────────────────────────────────────────
//
//   Prepared statements are compiled once per unique SQL shape and cached
//   inside Database.  On each reuse the statement is reset + rebound —
//   no re-parsing, no re-planning.  All values go through '?' placeholders
//   so the SQL string is the cache key regardless of the bound values.
//
//   execute() collects the full result set into a vector<Row> snapshot so
//   the sqlite3_stmt* is returned to the cache immediately.  For a desktop
//   CRM with < 10 K rows this is the right trade-off.  Use each() for lazy
//   row-by-row iteration when memory matters.
//
// ── Thread safety
// ─────────────────────────────────────────────────────────────
//
//   Database is NOT thread-safe.  Create one Database per thread, or guard
//   access with a mutex.  This matches the typical Saucer desktop-app pattern
//   where all DB access happens on the UI / work thread.
//
// =============================================================================

#include <sqlite3.h>

#include <algorithm>
#include <cassert>
#include <chrono>
#include <cstdint>
#include <functional>
#include <initializer_list>
#include <optional>
#include <print>
#include <stdexcept>
#include <string>
#include <string_view>
#include <type_traits>
#include <unordered_map>
#include <variant>
#include <vector>

namespace pce::db {

// =============================================================================
// Value  —  type-safe, type-erased SQL column value
// =============================================================================

/// Maps every SQLite storage class to a C++ type.
///   std::monostate          →  NULL
///   int64_t                 →  INTEGER
///   double                  →  REAL
///   std::string             →  TEXT
///   std::vector<uint8_t>    →  BLOB
using Value = std::variant<std::monostate, int64_t, double, std::string,
                           std::vector<uint8_t>>;

/// Convenience NULL constant.
inline constexpr Value null_value{std::monostate{}};

// =============================================================================
// to_db_value  —  implicit conversion from C++ types to Value
// =============================================================================
//
// Called by every query builder method that accepts a binding parameter.
// Covers all types you'd naturally pass to a WHERE / SET / VALUES clause.

template <typename T> [[nodiscard]] Value to_db_value(T &&v) {
  using D = std::decay_t<T>;

  if constexpr (std::is_same_v<D, Value>)
    return std::forward<T>(v);

  else if constexpr (std::is_same_v<D, std::monostate> ||
                     std::is_null_pointer_v<D>)
    return std::monostate{};

  // bool must come before the generic integral check
  else if constexpr (std::is_same_v<D, bool>)
    return int64_t{v ? 1 : 0};

  else if constexpr (std::is_integral_v<D>)
    return static_cast<int64_t>(v);

  else if constexpr (std::is_floating_point_v<D>)
    return static_cast<double>(v);

  else if constexpr (std::is_same_v<D, std::string>)
    return std::forward<T>(v);

  else if constexpr (std::is_same_v<D, std::string_view>)
    return std::string{v};

  // const char* / char* / string literals
  else if constexpr (std::is_same_v<D, const char *> ||
                     std::is_same_v<D, char *>)
    return v ? std::string{v} : Value{std::monostate{}};

  else if constexpr (std::is_same_v<D, std::vector<uint8_t>>)
    return std::forward<T>(v);

  // Catch-all — fails at compile time with a clear message
  else
    static_assert(!sizeof(D), "to_db_value: unsupported SQL binding type");
}

// =============================================================================
// Row  —  owned snapshot of one result row
// =============================================================================
//
// A Row owns all its data (no sqlite3_stmt* pointer).  It is safe to store,
// copy, and pass across thread boundaries after execute() returns.

class Row {
public:
  Row() = default;

  // ── Column access by 0-based index ───────────────────────────────────────

  [[nodiscard]] const Value &at(int col) const {
    if (col < 0 || static_cast<size_t>(col) >= values_.size())
      throw std::out_of_range("Row: column index " + std::to_string(col) +
                              " out of range");
    return values_[static_cast<size_t>(col)];
  }

  [[nodiscard]] const Value &operator[](int col) const { return at(col); }

  // ── Column access by name (case-sensitive) ────────────────────────────────

  [[nodiscard]] const Value &at(std::string_view name) const {
    auto it = index_.find(std::string{name});
    if (it == index_.end())
      throw std::invalid_argument("Row: unknown column '" + std::string{name} +
                                  "'");
    return values_[it->second];
  }

  [[nodiscard]] const Value &operator[](std::string_view name) const {
    return at(name);
  }

  // ── Typed extraction — returns std::nullopt for NULL ──────────────────────

  template <typename T> [[nodiscard]] std::optional<T> try_get(int col) const {
    const auto &v = at(col);
    if (std::holds_alternative<std::monostate>(v))
      return std::nullopt;
    return coerce<T>(v);
  }

  template <typename T>
  [[nodiscard]] std::optional<T> try_get(std::string_view name) const {
    const auto &v = at(name);
    if (std::holds_alternative<std::monostate>(v))
      return std::nullopt;
    return coerce<T>(v);
  }

  // ── Typed extraction with fallback on NULL ────────────────────────────────

  template <typename T> [[nodiscard]] T get(int col, T fallback = {}) const {
    return try_get<T>(col).value_or(std::move(fallback));
  }

  template <typename T>
  [[nodiscard]] T get(std::string_view name, T fallback = {}) const {
    return try_get<T>(name).value_or(std::move(fallback));
  }

  // ── Introspection ─────────────────────────────────────────────────────────

  [[nodiscard]] int column_count() const noexcept {
    return static_cast<int>(values_.size());
  }

  [[nodiscard]] const std::vector<std::string> &column_names() const noexcept {
    return names_;
  }

  [[nodiscard]] bool is_null(int col) const {
    return std::holds_alternative<std::monostate>(at(col));
  }
  [[nodiscard]] bool is_null(std::string_view name) const {
    return std::holds_alternative<std::monostate>(at(name));
  }

  // ── Internal: used by Database::read_row() ────────────────────────────────

  void push(std::string name, Value value) {
    index_[name] = values_.size();
    names_.push_back(std::move(name));
    values_.push_back(std::move(value));
  }

private:
  std::vector<Value> values_;
  std::vector<std::string> names_;
  std::unordered_map<std::string, size_t> index_;

  // Coerce a stored Value to the requested C++ type.
  // The Value is guaranteed non-null by the try_get callers above.
  template <typename T> static T coerce(const Value &v) {
    // bool — stored as int64_t
    if constexpr (std::is_same_v<T, bool>)
      return static_cast<bool>(std::get<int64_t>(v));

    // any integer type — stored as int64_t
    else if constexpr (std::is_integral_v<T>)
      return static_cast<T>(std::get<int64_t>(v));

    // any floating-point type — stored as double
    else if constexpr (std::is_floating_point_v<T>)
      return static_cast<T>(std::get<double>(v));

    // std::string
    else if constexpr (std::is_same_v<T, std::string>)
      return std::get<std::string>(v);

    // BLOB
    else if constexpr (std::is_same_v<T, std::vector<uint8_t>>)
      return std::get<std::vector<uint8_t>>(v);

    else
      static_assert(!sizeof(T), "Row::get: unsupported extraction type");
  }
};

// =============================================================================
// Forward declarations (query builders reference Database)
// =============================================================================

class SelectQuery;
class InsertQuery;
class UpdateQuery;
class DeleteQuery;

// =============================================================================
// Database  —  connection handle + statement cache
// =============================================================================

class Database {
public:
  // ── Constructors / rule-of-5 ──────────────────────────────────────────────

  Database() = default;

  ~Database() { close(); }

  Database(const Database &) = delete;
  Database &operator=(const Database &) = delete;

  Database(Database &&o) noexcept : db_(o.db_), cache_(std::move(o.cache_)) {
    o.db_ = nullptr;
  }

  Database &operator=(Database &&o) noexcept {
    if (this != &o) {
      close();
      db_ = o.db_;
      cache_ = std::move(o.cache_);
      o.db_ = nullptr;
    }
    return *this;
  }

  // ── Factory methods ───────────────────────────────────────────────────────

  /// Open a plain SQLite database at *path*.  Creates the file if absent.
  static Database open(const std::string &path, bool create_if_missing = true) {
    Database db;
    const int flags =
        SQLITE_OPEN_READWRITE | (create_if_missing ? SQLITE_OPEN_CREATE : 0);
    if (sqlite3_open_v2(path.c_str(), &db.db_, flags, nullptr) != SQLITE_OK) {
      throw std::runtime_error("Database::open(\"" + path +
                               "\"): " + sqlite3_errmsg(db.db_));
    }
    db.configure();
    return db;
  }

  /// Open an in-memory database — useful for unit tests.
  static Database open_memory() { return open(":memory:"); }

  /// Open a SQLCipher AES-256 encrypted database.
  ///
  /// Link against sqlcipher (not sqlite3) to activate encryption.
  /// Without sqlcipher the call succeeds but the file is unencrypted and
  /// a warning is printed so you notice during development.
  static Database open_encrypted(const std::string &path,
                                 const std::string &passphrase) {
    Database db;
    if (sqlite3_open_v2(path.c_str(), &db.db_,
                        SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
                        nullptr) != SQLITE_OK) {
      throw std::runtime_error("Database::open_encrypted(\"" + path +
                               "\"): " + sqlite3_errmsg(db.db_));
    }

#if defined(SQLITE_HAS_CODEC) || defined(SQLCIPHER_CRYPTO_OPENSSL)
    if (sqlite3_key(db.db_, passphrase.c_str(),
                    static_cast<int>(passphrase.size())) != SQLITE_OK) {
      throw std::runtime_error(
          "Database::open_encrypted: key rejected by SQLCipher");
    }
#else
    (void)passphrase;
    std::print(stderr,
               "[db] WARNING: '{}' opened without SQLCipher — "
               "at-rest encryption is inactive.\n"
               "     Link against sqlcipher to enable AES-256 encryption.\n",
               path);
#endif
    db.configure();
    return db;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  void close() noexcept {
    for (auto &[sql, stmt] : cache_)
      sqlite3_finalize(stmt);
    cache_.clear();
    if (db_) {
      sqlite3_close(db_);
      db_ = nullptr;
    }
  }

  [[nodiscard]] bool is_open() const noexcept { return db_ != nullptr; }

  // ── Raw DDL / PRAGMA execution ────────────────────────────────────────────

  /// Execute raw SQL that does not return rows (CREATE, DROP, PRAGMA, …).
  void exec(std::string_view sql) {
    char *err = nullptr;
    if (sqlite3_exec(db_, std::string{sql}.c_str(), nullptr, nullptr, &err) !=
        SQLITE_OK) {
      std::string msg = err ? err : "unknown error";
      sqlite3_free(err);
      throw std::runtime_error("Database::exec: " + msg);
    }
  }

  // ── Transactions ──────────────────────────────────────────────────────────

  void begin() { exec("BEGIN"); }
  void commit() { exec("COMMIT"); }
  void rollback() { exec("ROLLBACK"); }

  /// RAII transaction scope.  Commits on explicit tx.commit(); otherwise
  /// rolls back when the Transaction goes out of scope.
  ///
  ///   auto tx = db.transaction();
  ///   db.insert_into("foo").value("x", 1).execute();
  ///   tx.commit();
  struct Transaction {
    explicit Transaction(Database &db) : db_(db) { db_.begin(); }

    ~Transaction() noexcept {
      if (!committed_) {
        try {
          db_.rollback();
        } catch (...) {
        }
      }
    }

    Transaction(const Transaction &) = delete;
    Transaction &operator=(const Transaction &) = delete;

    void commit() {
      db_.commit();
      committed_ = true;
    }

  private:
    Database &db_;
    bool committed_ = false;
  };

  [[nodiscard]] Transaction transaction() { return Transaction{*this}; }

  // ── Schema helpers ────────────────────────────────────────────────────────

  [[nodiscard]] bool
  table_exists(std::string_view table); // defined after SelectQuery

  [[nodiscard]] int64_t last_insert_rowid() const noexcept {
    return sqlite3_last_insert_rowid(db_);
  }

  [[nodiscard]] int changes() const noexcept { return sqlite3_changes(db_); }

  // ── Query entry points ────────────────────────────────────────────────────
  // Implementations are defined after the query classes below.

  [[nodiscard]] SelectQuery from(std::string_view table);
  [[nodiscard]] InsertQuery insert_into(std::string_view table);
  [[nodiscard]] UpdateQuery update(std::string_view table);
  [[nodiscard]] DeleteQuery delete_from(std::string_view table);

  // ── Internal helpers used by query builders ───────────────────────────────

  /// Return a compiled, reset statement from the cache (or compile + cache).
  sqlite3_stmt *prepare_cached(const std::string &sql) {
    auto it = cache_.find(sql);
    if (it != cache_.end()) {
      sqlite3_reset(it->second);
      sqlite3_clear_bindings(it->second);
      return it->second;
    }
    sqlite3_stmt *stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
      throw std::runtime_error("Database: failed to prepare SQL:\n  " + sql +
                               "\n  " + sqlite3_errmsg(db_));
    }
    return cache_[sql] = stmt;
  }

  /// Snapshot the current row of a stepped statement into an owned Row.
  static Row read_row(sqlite3_stmt *stmt) {
    Row row;
    const int n = sqlite3_column_count(stmt);
    for (int i = 0; i < n; ++i) {
      const char *raw_name = sqlite3_column_name(stmt, i);
      row.push(raw_name ? raw_name : "", read_column(stmt, i));
    }
    return row;
  }

  /// Bind a Value to parameter *idx* (1-based, as sqlite3 expects).
  static void bind(sqlite3_stmt *stmt, int idx, const Value &v) {
    std::visit(
        [&](auto &&val) {
          using T = std::decay_t<decltype(val)>;
          if constexpr (std::is_same_v<T, std::monostate>)
            sqlite3_bind_null(stmt, idx);
          else if constexpr (std::is_same_v<T, int64_t>)
            sqlite3_bind_int64(stmt, idx, val);
          else if constexpr (std::is_same_v<T, double>)
            sqlite3_bind_double(stmt, idx, val);
          else if constexpr (std::is_same_v<T, std::string>)
            sqlite3_bind_text(stmt, idx, val.c_str(), -1, SQLITE_TRANSIENT);
          else if constexpr (std::is_same_v<T, std::vector<uint8_t>>)
            sqlite3_bind_blob(stmt, idx, val.data(),
                              static_cast<int>(val.size()), SQLITE_TRANSIENT);
        },
        v);
  }

  [[nodiscard]] sqlite3 *handle() noexcept { return db_; }

private:
  sqlite3 *db_ = nullptr;
  std::unordered_map<std::string, sqlite3_stmt *> cache_;

  /// Apply recommended PRAGMAs for a new connection.
  void configure() {
    // WAL: concurrent readers + writers; no full-database lock on write.
    sqlite3_exec(db_, "PRAGMA journal_mode=WAL;", nullptr, nullptr, nullptr);
    // Enforce foreign key constraints (off by default in SQLite).
    sqlite3_exec(db_, "PRAGMA foreign_keys=ON;", nullptr, nullptr, nullptr);
    // NORMAL sync: safe after WAL, faster than FULL.
    sqlite3_exec(db_, "PRAGMA synchronous=NORMAL;", nullptr, nullptr, nullptr);
    // Keep temp tables in memory.
    sqlite3_exec(db_, "PRAGMA temp_store=MEMORY;", nullptr, nullptr, nullptr);
    // 8 MB page cache (default is 2 MB).
    sqlite3_exec(db_, "PRAGMA cache_size=-8000;", nullptr, nullptr, nullptr);
  }

  static Value read_column(sqlite3_stmt *stmt, int col) {
    switch (sqlite3_column_type(stmt, col)) {
    case SQLITE_NULL:
      return std::monostate{};
    case SQLITE_INTEGER:
      return sqlite3_column_int64(stmt, col);
    case SQLITE_FLOAT:
      return sqlite3_column_double(stmt, col);
    case SQLITE_TEXT:
      return std::string{
          reinterpret_cast<const char *>(sqlite3_column_text(stmt, col))};
    case SQLITE_BLOB: {
      const auto *p =
          static_cast<const uint8_t *>(sqlite3_column_blob(stmt, col));
      const int n = sqlite3_column_bytes(stmt, col);
      return std::vector<uint8_t>{p, p + n};
    }
    default:
      return std::monostate{};
    }
  }
};

// =============================================================================
// Internal helpers shared by all query builders
// =============================================================================

namespace detail {

[[nodiscard]] inline std::string join_sv(const std::vector<std::string> &parts,
                                         std::string_view sep) {
  std::string out;
  for (size_t i = 0; i < parts.size(); ++i) {
    if (i)
      out.append(sep);
    out.append(parts[i]);
  }
  return out;
}

/// Bind a vector of Values to consecutive parameters starting at *start_idx*.
inline void bind_range(sqlite3_stmt *stmt, int start_idx,
                       const std::vector<Value> &bindings) {
  for (int i = 0; i < static_cast<int>(bindings.size()); ++i)
    Database::bind(stmt, start_idx + i, bindings[i]);
}

} // namespace detail

// =============================================================================
// SelectQuery  —  fluent SELECT / WHERE / JOIN / ORDER / LIMIT / OFFSET
// =============================================================================

class SelectQuery {
public:
  explicit SelectQuery(Database &db, std::string table)
      : db_(db), table_(std::move(table)) {}

  // ── Projection ────────────────────────────────────────────────────────────

  SelectQuery &select(std::initializer_list<std::string_view> cols) {
    for (auto c : cols)
      columns_.emplace_back(c);
    return *this;
  }

  SelectQuery &distinct() {
    distinct_ = true;
    return *this;
  }

  // ── Joins ─────────────────────────────────────────────────────────────────

  SelectQuery &join(std::string_view tbl, std::string_view on) {
    joins_.emplace_back("INNER JOIN " + std::string{tbl} + " ON " +
                        std::string{on});
    return *this;
  }

  SelectQuery &left_join(std::string_view tbl, std::string_view on) {
    joins_.emplace_back("LEFT JOIN " + std::string{tbl} + " ON " +
                        std::string{on});
    return *this;
  }

  // ── Filtering — plain (no bindings) ──────────────────────────────────────

  SelectQuery &where(std::string_view condition) {
    conditions_.emplace_back(condition);
    return *this;
  }

  /// WHERE with one OR MORE bound parameters (covers single values, BETWEEN,
  /// and any other multi-parameter condition).
  ///
  ///   .where("status = ?",                  "active")
  ///   .where("created_at BETWEEN ? AND ?",  t0, t1)
  template <typename... Args>
    requires(sizeof...(Args) > 0)
  SelectQuery &where(std::string_view condition, Args &&...args) {
    conditions_.emplace_back(condition);
    (bindings_.emplace_back(to_db_value(std::forward<Args>(args))), ...);
    return *this;
  }

  /// WHERE column IN (v1, v2, …).  Empty container becomes 0=1 (no rows).
  template <typename Container>
  SelectQuery &where_in(std::string_view column, const Container &vals) {
    if (vals.empty()) {
      conditions_.emplace_back("0 = 1");
      return *this;
    }
    std::string ph;
    for (size_t i = 0; i < vals.size(); ++i) {
      if (i)
        ph += ", ";
      ph += "?";
    }
    conditions_.emplace_back(std::string{column} + " IN (" + ph + ")");
    for (const auto &v : vals)
      bindings_.emplace_back(to_db_value(v));
    return *this;
  }

  SelectQuery &where_null(std::string_view column) {
    conditions_.emplace_back(std::string{column} + " IS NULL");
    return *this;
  }

  SelectQuery &where_not_null(std::string_view column) {
    conditions_.emplace_back(std::string{column} + " IS NOT NULL");
    return *this;
  }

  // ── Ordering ──────────────────────────────────────────────────────────────

  SelectQuery &order_by(std::string_view column, bool ascending = true) {
    order_.emplace_back(std::string{column} + (ascending ? " ASC" : " DESC"));
    return *this;
  }

  // ── Pagination ────────────────────────────────────────────────────────────

  SelectQuery &limit(int64_t n) {
    limit_ = n;
    return *this;
  }
  SelectQuery &offset(int64_t n) {
    offset_ = n;
    return *this;
  }

  // ── Terminal operations ───────────────────────────────────────────────────

  /// Execute and collect all matching rows into a vector<Row> snapshot.
  [[nodiscard]] std::vector<Row> execute() {
    auto sql = build_sql();
    auto *stmt = db_.prepare_cached(sql);
    detail::bind_range(stmt, 1, bindings_);

    std::vector<Row> rows;
    while (sqlite3_step(stmt) == SQLITE_ROW)
      rows.push_back(Database::read_row(stmt));
    return rows;
  }

  /// Execute + map each row to T with a projection lambda.
  ///
  ///   auto accounts = db.from("accounts")
  ///                     .where("active = ?", true)
  ///                     .map<Account>([](const db::Row& r) {
  ///                         return Account{ r.get<int64_t>("id"),
  ///                                         r.get<std::string>("name") };
  ///                     });
  template <typename T>
  [[nodiscard]] std::vector<T> map(std::function<T(const Row &)> f) {
    auto raw = execute();
    std::vector<T> out;
    out.reserve(raw.size());
    for (const auto &r : raw)
      out.push_back(f(r));
    return out;
  }

  /// Execute + call f for each row without collecting results (low memory).
  void each(std::function<void(const Row &)> f) {
    auto sql = build_sql();
    auto *stmt = db_.prepare_cached(sql);
    detail::bind_range(stmt, 1, bindings_);
    while (sqlite3_step(stmt) == SQLITE_ROW)
      f(Database::read_row(stmt));
  }

  /// Return the first matching row, or std::nullopt.
  [[nodiscard]] std::optional<Row> first() {
    const auto saved = limit_;
    limit_ = 1;
    auto rows = execute();
    limit_ = saved;
    if (rows.empty())
      return std::nullopt;
    return std::move(rows.front());
  }

  /// Return the first row projected through f, or std::nullopt.
  template <typename T>
  [[nodiscard]] std::optional<T> first(std::function<T(const Row &)> f) {
    auto r = first();
    if (!r)
      return std::nullopt;
    return f(*r);
  }

  /// COUNT(*) reusing the same WHERE / JOIN / conditions.
  [[nodiscard]] int64_t count() {
    const auto saved = columns_;
    columns_ = {"COUNT(*) AS _cnt"};
    auto sql = build_sql();
    columns_ = saved;

    auto *stmt = db_.prepare_cached(sql);
    detail::bind_range(stmt, 1, bindings_);

    if (sqlite3_step(stmt) == SQLITE_ROW)
      return sqlite3_column_int64(stmt, 0);
    return 0;
  }

  [[nodiscard]] bool exists() { return count() > 0; }

  /// Return the SQL string that will be (or was last) executed.
  [[nodiscard]] std::string to_sql() const { return build_sql(); }

private:
  Database &db_;
  std::string table_;
  std::vector<std::string> columns_;
  std::vector<std::string> joins_;
  std::vector<std::string> conditions_;
  std::vector<Value> bindings_;
  std::vector<std::string> order_;
  std::optional<int64_t> limit_;
  std::optional<int64_t> offset_;
  bool distinct_ = false;

  [[nodiscard]] std::string build_sql() const {
    std::string sql = "SELECT ";
    if (distinct_)
      sql += "DISTINCT ";
    sql += columns_.empty() ? "*" : detail::join_sv(columns_, ", ");
    sql += " FROM " + table_;
    for (const auto &j : joins_)
      sql += " " + j;
    if (!conditions_.empty())
      sql += " WHERE " + detail::join_sv(conditions_, " AND ");
    if (!order_.empty())
      sql += " ORDER BY " + detail::join_sv(order_, ", ");
    if (limit_.has_value())
      sql += " LIMIT " + std::to_string(*limit_);
    if (offset_.has_value())
      sql += " OFFSET " + std::to_string(*offset_);
    return sql;
  }
};

// =============================================================================
// InsertQuery  —  INSERT / INSERT OR REPLACE / INSERT OR IGNORE
// =============================================================================

class InsertQuery {
public:
  explicit InsertQuery(Database &db, std::string table)
      : db_(db), table_(std::move(table)) {}

  /// Bind a column-value pair.
  template <typename T> InsertQuery &value(std::string_view column, T &&v) {
    columns_.emplace_back(column);
    bindings_.emplace_back(to_db_value(std::forward<T>(v)));
    return *this;
  }

  /// INSERT OR REPLACE — upsert by primary-key / unique constraint.
  InsertQuery &on_conflict_replace() {
    mode_ = Mode::replace;
    return *this;
  }

  /// INSERT OR IGNORE — silently discard rows that violate constraints.
  InsertQuery &on_conflict_ignore() {
    mode_ = Mode::ignore;
    return *this;
  }

  /// Execute and return the rowid of the inserted (or replaced) row.
  [[nodiscard]] int64_t execute() {
    if (columns_.empty())
      throw std::logic_error("InsertQuery: no values specified");

    auto sql = build_sql();
    auto *stmt = db_.prepare_cached(sql);
    detail::bind_range(stmt, 1, bindings_);

    const int rc = sqlite3_step(stmt);
    if (rc != SQLITE_DONE && rc != SQLITE_ROW)
      throw std::runtime_error(
          "InsertQuery::execute: " + std::string{sqlite3_errmsg(db_.handle())} +
          "\n  SQL: " + sql);

    return sqlite3_last_insert_rowid(db_.handle());
  }

private:
  enum class Mode { plain, replace, ignore };

  Database &db_;
  std::string table_;
  std::vector<std::string> columns_;
  std::vector<Value> bindings_;
  Mode mode_ = Mode::plain;

  [[nodiscard]] std::string build_sql() const {
    const std::string_view verb = mode_ == Mode::replace  ? "INSERT OR REPLACE"
                                  : mode_ == Mode::ignore ? "INSERT OR IGNORE"
                                                          : "INSERT";

    std::string cols, placeholders;
    for (size_t i = 0; i < columns_.size(); ++i) {
      if (i) {
        cols += ", ";
        placeholders += ", ";
      }
      cols += columns_[i];
      placeholders += "?";
    }
    return std::string{verb} + " INTO " + table_ + " (" + cols + ") VALUES (" +
           placeholders + ")";
  }
};

// =============================================================================
// UpdateQuery  —  UPDATE … SET … WHERE
// =============================================================================

class UpdateQuery {
public:
  explicit UpdateQuery(Database &db, std::string table)
      : db_(db), table_(std::move(table)) {}

  template <typename T> UpdateQuery &set(std::string_view column, T &&v) {
    set_clauses_.emplace_back(std::string{column} + " = ?");
    set_bindings_.emplace_back(to_db_value(std::forward<T>(v)));
    return *this;
  }

  UpdateQuery &where(std::string_view condition) {
    conditions_.emplace_back(condition);
    return *this;
  }

  template <typename... Args>
    requires(sizeof...(Args) > 0)
  UpdateQuery &where(std::string_view condition, Args &&...args) {
    conditions_.emplace_back(condition);
    (where_bindings_.emplace_back(to_db_value(std::forward<Args>(args))), ...);
    return *this;
  }

  /// Execute and return the number of rows updated.
  [[nodiscard]] int execute() {
    if (set_clauses_.empty())
      throw std::logic_error("UpdateQuery: no SET clauses specified");

    auto sql = build_sql();
    auto *stmt = db_.prepare_cached(sql);

    // SET bindings come first, then WHERE bindings
    int idx = 1;
    for (const auto &v : set_bindings_)
      Database::bind(stmt, idx++, v);
    for (const auto &v : where_bindings_)
      Database::bind(stmt, idx++, v);

    const int rc = sqlite3_step(stmt);
    if (rc != SQLITE_DONE && rc != SQLITE_ROW)
      throw std::runtime_error(
          "UpdateQuery::execute: " + std::string{sqlite3_errmsg(db_.handle())} +
          "\n  SQL: " + sql);

    return sqlite3_changes(db_.handle());
  }

private:
  Database &db_;
  std::string table_;
  std::vector<std::string> set_clauses_;
  std::vector<Value> set_bindings_;
  std::vector<std::string> conditions_;
  std::vector<Value> where_bindings_;

  [[nodiscard]] std::string build_sql() const {
    std::string sql =
        "UPDATE " + table_ + " SET " + detail::join_sv(set_clauses_, ", ");
    if (!conditions_.empty())
      sql += " WHERE " + detail::join_sv(conditions_, " AND ");
    return sql;
  }
};

// =============================================================================
// DeleteQuery  —  DELETE FROM … WHERE
// =============================================================================

class DeleteQuery {
public:
  explicit DeleteQuery(Database &db, std::string table)
      : db_(db), table_(std::move(table)) {}

  DeleteQuery &where(std::string_view condition) {
    conditions_.emplace_back(condition);
    return *this;
  }

  template <typename... Args>
    requires(sizeof...(Args) > 0)
  DeleteQuery &where(std::string_view condition, Args &&...args) {
    conditions_.emplace_back(condition);
    (bindings_.emplace_back(to_db_value(std::forward<Args>(args))), ...);
    return *this;
  }

  /// Execute and return the number of rows deleted.
  [[nodiscard]] int execute() {
    auto sql = build_sql();
    auto *stmt = db_.prepare_cached(sql);
    detail::bind_range(stmt, 1, bindings_);

    const int rc = sqlite3_step(stmt);
    if (rc != SQLITE_DONE && rc != SQLITE_ROW)
      throw std::runtime_error(
          "DeleteQuery::execute: " + std::string{sqlite3_errmsg(db_.handle())} +
          "\n  SQL: " + sql);

    return sqlite3_changes(db_.handle());
  }

private:
  Database &db_;
  std::string table_;
  std::vector<std::string> conditions_;
  std::vector<Value> bindings_;

  [[nodiscard]] std::string build_sql() const {
    std::string sql = "DELETE FROM " + table_;
    if (!conditions_.empty())
      sql += " WHERE " + detail::join_sv(conditions_, " AND ");
    return sql;
  }
};

// =============================================================================
// Database entry-point definitions (after query types are complete)
// =============================================================================

inline SelectQuery Database::from(std::string_view table) {
  return SelectQuery{*this, std::string{table}};
}

inline InsertQuery Database::insert_into(std::string_view table) {
  return InsertQuery{*this, std::string{table}};
}

inline UpdateQuery Database::update(std::string_view table) {
  return UpdateQuery{*this, std::string{table}};
}

inline DeleteQuery Database::delete_from(std::string_view table) {
  return DeleteQuery{*this, std::string{table}};
}

inline bool Database::table_exists(std::string_view table) {
  return from("sqlite_master")
      .where("type = ?", "table")
      .where("name = ?", std::string{table})
      .exists();
}

// =============================================================================
// Convenience: unix timestamp helper (used frequently with updated_at columns)
// =============================================================================

[[nodiscard]] inline int64_t now_unix() noexcept {
  return std::chrono::duration_cast<std::chrono::seconds>(
             std::chrono::system_clock::now().time_since_epoch())
      .count();
}

// =============================================================================
// Convenience: BLOB serialisation helpers for nlp_embeddings.vector
// =============================================================================

/// Serialise a float vector to a BLOB Value (little-endian float32 array).
[[nodiscard]] inline Value floats_to_blob(const std::vector<float> &v) {
  const auto *p = reinterpret_cast<const uint8_t *>(v.data());
  return std::vector<uint8_t>{p, p + v.size() * sizeof(float)};
}

/// Deserialise a BLOB Value back to a float vector.
[[nodiscard]] inline std::vector<float> blob_to_floats(const Value &v) {
  const auto &bytes = std::get<std::vector<uint8_t>>(v);
  const auto *p = reinterpret_cast<const float *>(bytes.data());
  return {p, p + bytes.size() / sizeof(float)};
}

/// Safe version: returns an empty vector if v is not a BLOB.
[[nodiscard]] inline std::vector<float> try_blob_to_floats(const Value &v) {
  const auto *bytes = std::get_if<std::vector<uint8_t>>(&v);
  if (!bytes || bytes->size() % sizeof(float) != 0)
    return {};
  const auto *p = reinterpret_cast<const float *>(bytes->data());
  return {p, p + bytes->size() / sizeof(float)};
}

} // namespace pce::db

// =============================================================================
// NLP-specific schema bootstrap helper
// =============================================================================
// Call once at app startup after opening the database.
//
//   pce::db::bootstrap_nlp_schema(db);
//
// Creates the two tables used by the background enrichment pipeline if they
// do not already exist.  Safe to call on every startup (CREATE TABLE IF NOT
// EXISTS).

namespace pce::db {

inline void bootstrap_nlp_schema(Database &db) {
  db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS nlp_embeddings (
            row_type    TEXT    NOT NULL,
            row_id      INTEGER NOT NULL,
            text_hash   TEXT    NOT NULL,
            vector      BLOB    NOT NULL,
            dimensions  INTEGER NOT NULL DEFAULT 384,
            snippet     TEXT    NOT NULL DEFAULT '',
            updated_at  INTEGER NOT NULL,
            PRIMARY KEY (row_type, row_id)
        );
    )sql");

  db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS nlp_notes (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            row_type        TEXT    NOT NULL,
            row_id          INTEGER NOT NULL,
            note_text       TEXT    NOT NULL DEFAULT '',
            keywords        TEXT    NOT NULL DEFAULT '',
            entities        TEXT    NOT NULL DEFAULT '',
            sentiment       REAL    NOT NULL DEFAULT 0.0,
            sentiment_label TEXT    NOT NULL DEFAULT 'neutral',
            toxicity_score  REAL    NOT NULL DEFAULT 0.0,
            lang            TEXT    NOT NULL DEFAULT 'en',
            created_at      INTEGER NOT NULL
        );
    )sql");

  db.exec("CREATE INDEX IF NOT EXISTS idx_nlp_notes_row "
          "ON nlp_notes (row_type, row_id);");

  db.exec("CREATE INDEX IF NOT EXISTS idx_nlp_notes_created "
          "ON nlp_notes (created_at);");

  db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS custom_vocabulary (
            lang       TEXT    NOT NULL,
            word       TEXT    NOT NULL,
            source     TEXT    NOT NULL DEFAULT 'user',
            created_at INTEGER NOT NULL,
            PRIMARY KEY (lang, word)
        );
    )sql");
}

} // namespace pce::db
