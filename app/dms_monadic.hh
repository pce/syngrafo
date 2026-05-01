#pragma once
// =============================================================================
// app/dms_monadic.hh  —  Monadic helpers for std::expected<T,std::string>
// =============================================================================
//
// Mirrors the Adapters::Utils pattern shown in the project brief and extends
// it with DMS-specific lifters.  Every helper is noexcept where the type
// system allows so they compose without hidden throw points.
//
// Typical usage (monadic .and_then / .transform chains):
//
//   return require(fs::exists(p), std::format("'{}' not found", p.string()))
//       .and_then([&]() -> Expected<std::string> {
//           return safe_read_text(p);
//       })
//       .and_then([&](std::string content) -> Expected<json> {
//           return index_one_file_(p, content);
//       })
//       .transform([](json j) { return ok_str(j); })
//       .value_or(err_str("index failed"));
//
// =============================================================================

#include <concepts>
#include <expected>
#include <filesystem>
#include <format>
#include <functional>
#include <optional>
#include <string>
#include <type_traits>
#include <utility>

namespace pce::dms {

// ─── Core aliases
// ──────────────────────────────────────────────────────────────

/// Every DMS operation fails with a human-readable std::string message.
template <typename T> using Expected = std::expected<T, std::string>;

/// Void-valued expected — for precondition checks with no output.
using VoidResult = std::expected<void, std::string>;

// ─── require ─────────────────────────────────────────────────────────────────

/// Returns VoidResult{} when cond is true, std::unexpected(msg) when false.
/// Drop-in guard to replace   if (!cond) return err_str(…);
[[nodiscard]] inline VoidResult require(bool cond, std::string msg) noexcept {
  if (cond)
    return {};
  return std::unexpected(std::move(msg));
}

/// Overload that accepts a string literal / string_view and promotes to string.
[[nodiscard]] inline VoidResult require(bool cond,
                                        std::string_view msg) noexcept {
  if (cond)
    return {};
  return std::unexpected(std::string{msg});
}

// ─── require_nonnull ─────────────────────────────────────────────────────────

/// Wraps a nullable pointer into Expected<std::reference_wrapper<T>>.
/// Returns std::ref(*ptr) on success, std::unexpected(msg) when ptr == nullptr.
///
/// @tparam T   Pointee type (deduced).
template <typename T>
[[nodiscard]] inline Expected<std::reference_wrapper<T>>
require_nonnull(T *ptr, std::string msg) noexcept(
    std::is_nothrow_move_constructible_v<std::string>) {
  if (ptr)
    return std::ref(*ptr);
  return std::unexpected(std::move(msg));
}

// ─── value_or_error ──────────────────────────────────────────────────────────

/// Lifts std::optional<T> into Expected<T>.
/// Returns the contained value on success, std::unexpected(msg) when empty.
///
/// @tparam T   Value type (deduced).
template <typename T>
[[nodiscard]] inline Expected<T> value_or_error(
    std::optional<T> opt,
    std::string msg) noexcept(std::is_nothrow_move_constructible_v<T>) {
  if (opt)
    return std::move(*opt);
  return std::unexpected(std::move(msg));
}

// ─── try_invoke ──────────────────────────────────────────────────────────────

/// Wraps a callable F() -> T into Expected<T>, catching std::exception.
/// std::unexpected holds e.what() when an exception is thrown.
///
/// Works with any nullary invocable (lambda, std::function, free function, …).
/// The return type is deduced: try_invoke([]{ return 42; })  →  Expected<int>
template <std::invocable Fn>
  requires(!std::is_void_v<std::invoke_result_t<Fn>>)
[[nodiscard]] auto try_invoke(Fn &&fn) -> Expected<std::invoke_result_t<Fn>> {
  try {
    return std::forward<Fn>(fn)();
  } catch (const std::exception &e) {
    return std::unexpected(std::string{e.what()});
  } catch (...) {
    return std::unexpected(std::string{"unknown exception"});
  }
}

/// Void specialisation of try_invoke — returns VoidResult.
template <std::invocable Fn>
  requires std::is_void_v<std::invoke_result_t<Fn>>
[[nodiscard]] VoidResult try_invoke(Fn &&fn) noexcept {
  try {
    std::forward<Fn>(fn)();
    return {};
  } catch (const std::exception &e) {
    return std::unexpected(std::string{e.what()});
  } catch (...) {
    return std::unexpected(std::string{"unknown exception"});
  }
}

// ─── from_filesystem_error ───────────────────────────────────────────────────

/// Lifts a std::error_code into VoidResult.
/// Returns VoidResult{} when ec is not set, std::unexpected when it is.
[[nodiscard]] inline VoidResult
from_ec(std::error_code ec, std::string_view context = "") noexcept {
  if (!ec)
    return {};
  return context.empty()
             ? std::unexpected(ec.message())
             : std::unexpected(std::format("{}: {}", context, ec.message()));
}

// ─── map_error ───────────────────────────────────────────────────────────────

/// Transforms the error message of an Expected<T> without touching the value.
/// Useful for adding context to an error that bubbled up from a lower layer:
///
///   return read_file(p)
///       .transform_error([&](std::string e) {
///           return std::format("scan_dir: {}", e);
///       });
///
/// (This is just a typed reminder; std::expected::transform_error already does
///  this — the helper exists for discoverability.)
template <typename T, std::invocable<std::string> ErrFn>
  requires std::convertible_to<std::invoke_result_t<ErrFn, std::string>,
                               std::string>
[[nodiscard]] inline Expected<T> map_error(Expected<T> r, ErrFn &&fn) {
  return std::move(r).transform_error(std::forward<ErrFn>(fn));
}

// ─── flatten ─────────────────────────────────────────────────────────────────

/// Collapses Expected<Expected<T>> → Expected<T>.
/// Produced naturally when .and_then chains return an Expected themselves and
/// an extra layer of wrapping sneaks in.
template <typename T>
[[nodiscard]] inline Expected<T> flatten(Expected<Expected<T>> nested) {
  if (!nested)
    return std::unexpected(std::move(nested).error());
  return std::move(*nested);
}

} // namespace pce::dms
