/**
 * @file platform_services_windows.cpp
 * @brief Windows native file-manager reveal via the Shell API.
 *
 * Implements @c pce::nlp::platform for WIN32 targets.
 * @c reveal_in_file_manager selects the item in Explorer without spawning a child process.
 * All other @c platform functions are no-ops on Windows.
 */

#include "platform_services.hh"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shlobj.h>
#include <objbase.h>

namespace pce::nlp::platform {

std::vector<Point2D> detect_document_corners(const std::string&) { return {}; }
bool rectify_image(const std::string&, const std::string&, const std::vector<Point2D>&) { return false; }
std::string extract_exif(const std::string&) { return "{}"; }

bool reveal_in_file_manager(const std::string& path) {
    int wlen = MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, nullptr, 0);
    if (wlen <= 0) return false;
    std::wstring wpath(static_cast<size_t>(wlen - 1), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, wpath.data(), wlen);

    // CoInitializeEx is not strictly required by SHOpenFolderAndSelectItems but
    // ensures consistent COM apartment state across all Windows configurations.
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_SPEED_OVER_MEMORY);

    PIDLIST_ABSOLUTE pidl = ILCreateFromPathW(wpath.c_str());
    if (!pidl) { CoUninitialize(); return false; }

    HRESULT hr = SHOpenFolderAndSelectItems(pidl, 0, nullptr, 0);
    ILFree(pidl);
    CoUninitialize();
    return SUCCEEDED(hr);
}

} // namespace pce::nlp::platform
