#pragma once
/**
 * @file core/pipeline.hh
 * @author Patrick Engel
 * @brief C++23 zero-overhead pipeline operator for Expected<T, std::string> chains.
 *
 * No virtuals. No heap churn. Every stage is a value.
 * The compiler inlines the entire chain at -O2.
 *
 * Usage:
 * @code{.cpp}
 *   auto mesh = Image::load("foo.jpg")
 *       | stage(to_grayscale)
 *       | stage(generate_depth_map(8))
 *       | stage(triangulate({.mode = MeshMode::Solid, .gridSize = 8}));
 *
 *   // Also works with plain values (wraps in Expected automatically):
 *   auto svg = image | stage(to_svg({.palette = "db16", .smooth = true}));
 * @endcode
 */

#include <concepts>
#include <expected>
#include <string>
#include <type_traits>
#include <utility>

namespace pce::dms {


/// A named pipeline stage wrapping a single callable transform.
/// Use stage(fn) factory instead of constructing directly.
template <typename F>
struct Stage {
    F fn;
    explicit constexpr Stage(F f)
        noexcept(std::is_nothrow_move_constructible_v<F>)
        : fn(std::move(f)) {}
};

/// Factory: wraps any callable as a typed Stage.
template <typename F>
[[nodiscard]] constexpr auto stage(F&& fn) noexcept {
    return Stage<std::decay_t<F>>{std::forward<F>(fn)};
}


/// Expected<T> | Stage<F>
/// Equivalent to lhs.and_then(fn) — propagates errors, calls fn only on success.
template <typename T, typename F>
[[nodiscard]] constexpr auto
operator|(std::expected<T, std::string> lhs, Stage<F> rhs) {
    return std::move(lhs).and_then(
        [fn = std::move(rhs.fn)](T val) mutable {
            return fn(std::move(val));
        });
}

/// Raw T | Stage<F> — applies fn directly when not already wrapped in Expected.
/// Useful as the first stage in a chain when you have a concrete value.
template <typename T, typename F>
    requires (!requires { std::declval<T>().has_value(); })
[[nodiscard]] constexpr auto
operator|(T lhs, Stage<F> rhs) -> decltype(rhs.fn(std::move(lhs))) {
    return rhs.fn(std::move(lhs));
}

} // namespace pce::dms

