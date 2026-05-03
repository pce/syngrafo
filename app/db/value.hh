/**
 * @file value.hh
 * @brief SQLite storage-class variants — non-owning views and owning copies.
 */
#ifndef PCE_DB_VALUE_HH
#define PCE_DB_VALUE_HH
#include <cstdint>
#include <span>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace pce::db {

using Blob     = std::vector<uint8_t>;
using Text     = std::string;
using BlobView = std::span<const uint8_t>;
using TextView = std::string_view;

/// Non-owning view into SQLite statement buffers. Valid only within the current step.
using DbValueView = std::variant<std::monostate, int64_t, double, TextView, BlobView>;

/// Owning row value; safe to store beyond the iteration callback.
using DbValue = std::variant<std::monostate, int64_t, double, Text, Blob>;

}
#endif //PCE_DB_VALUE_HH
