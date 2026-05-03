/**
 * @file source_fs.hh
 * @brief File-system migration source — SQL loaded from `data/sql/migrations/`.
 *
 * Scans a directory for `*.sql` files whose names begin with a zero-padded
 * version number (e.g. `001_init.sql`), reads them into heap storage on
 * first access, and exposes them as a sorted `span<const Migration>`.
 *
 * Intended for **dev mode** where you want to edit SQL files without
 * recompiling.  In production, prefer `StaticSource`.
 *
 * @code{.cpp}
 * #include "app/db/migration/source_fs.hh"
 * #include "app/db/migration/runner.hh"
 *
 * migration::FileSource fs{"data/sql/migrations"};
 * migration::apply(db, fs);
 * @endcode
 *
 * @note `storage_` is pre-reserved to hold exactly `2 × file_count` strings
 *       (name + sql per migration) so that no reallocation ever invalidates
 *       the `string_view` members inside `migrations_`.
 */

#ifndef PCE_DB_SOURCE_FS_HH
#define PCE_DB_SOURCE_FS_HH

#include "migration.hh"
#include <vector>
#include <filesystem>
#include <fstream>

namespace pce::db::migration {

    class FileSource {
    public:
        explicit FileSource(std::filesystem::path dir)
            : dir_(std::move(dir)) {}

        std::span<const Migration> migrations() {
            load();
            return migrations_;
        }

    private:
        std::filesystem::path      dir_;
        std::vector<Migration>     migrations_;
        std::vector<std::string>   storage_;  ///< owns name + sql strings; never reallocated after load()

        void load() {
            if (!migrations_.empty()) return;

            namespace fs = std::filesystem;

            std::vector<fs::path> paths;
            for (const auto& entry : fs::directory_iterator(dir_))
                if (entry.path().extension() == ".sql")
                    paths.push_back(entry.path());

            std::ranges::sort(paths);

            // Pre-reserve so no reallocation occurs — string_view members
            // in migrations_ point into this storage.
            storage_.reserve(paths.size() * 2);
            migrations_.reserve(paths.size());

            for (const auto& p : paths) {
                storage_.push_back(p.filename().string());
                storage_.push_back(read_sql(p));

                const auto& name_ref = storage_[storage_.size() - 2];
                const auto& sql_ref  = storage_[storage_.size() - 1];

                migrations_.push_back({
                    parse_version(name_ref),
                    std::string_view{name_ref},
                    std::string_view{sql_ref}
                });
            }
        }

        static std::string read_sql(const std::filesystem::path& p) {
            std::ifstream in(p);
            return std::string(std::istreambuf_iterator<char>(in),
                               std::istreambuf_iterator<char>{});
        }

        static int64_t parse_version(std::string_view name) {
            return std::stoll(std::string{name});  // "001_init.sql" → 1
        }
    };

}


#endif //PCE_DB_SOURCE_FS_HH
