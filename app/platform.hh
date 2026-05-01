#pragma once
// =============================================================================
// app/platform.hh  —  Cross-platform native OS utilities
//
// Wraps saucer::modules::desktop for file / directory pickers.
// Works on macOS (WebKit), Linux (WebKitGtk) and Windows (WebView2).
// =============================================================================

#include <saucer/modules/desktop.hpp>

#include <filesystem>
#include <string>
#include <vector>

namespace pce::platform {

/**
 * Open a native directory picker and return the selected path as a UTF-8
 * string.  Returns an empty string if the user cancels or an error occurs.
 *
 * @param app  The saucer application instance that owns the event loop.
 *             Obtain via webview.parent() inside a binding lambda, or pass
 *             the app* directly from the start() coroutine.
 */
inline std::string select_directory(saucer::application &app) {
  saucer::modules::desktop desktop(std::addressof(app));
  auto result = desktop.pick<saucer::modules::picker::type::folder>();
  if (!result)
    return "";
  return result->string();
}

/**
 * Open a native single-file picker and return the chosen path.
 * Returns an empty string if the user cancels.
 */
inline std::string
select_file(saucer::application &app,
            const saucer::modules::picker::options &opts = {}) {
  saucer::modules::desktop desktop(std::addressof(app));
  auto result = desktop.pick<saucer::modules::picker::type::file>(opts);
  if (!result)
    return "";
  return result->string();
}

/**
 * Open a native multi-file picker and return all chosen paths.
 * Returns an empty vector if the user cancels.
 */
inline std::vector<std::string>
select_files(saucer::application &app,
             const saucer::modules::picker::options &opts = {}) {
  saucer::modules::desktop desktop(std::addressof(app));
  auto result = desktop.pick<saucer::modules::picker::type::files>(opts);
  if (!result)
    return {};
  std::vector<std::string> paths;
  paths.reserve(result->size());
  for (const auto &p : *result)
    paths.push_back(p.string());
  return paths;
}

} // namespace pce::platform
