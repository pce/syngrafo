#pragma once
/**
 * @file internal/discard.hh
 * @brief Explicit intent: mark a [[nodiscard]] result as intentionally unused.
 *
 * Replaces the C-cast `(void)expr` pattern with typed intent:
 * @code
 *   discard(db.insert_into(...).execute());   // checked by reader: we mean it
 * @endcode
 *
 * The function has no runtime cost; it is purely a vocabulary tool.
 */

namespace pce {

/** Explicitly discard one or more return values without a C-style void-cast.
 *  Available in all pce::* nested namespaces via unqualified lookup. */
constexpr void discard(auto&&...) noexcept {}

} // namespace pce

