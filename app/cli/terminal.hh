#pragma once

#include <string_view>

#if defined(_WIN32)
#include <windows.h>
#include <io.h>
#else
#include <unistd.h>
#endif

namespace sgf::cli::terminal {

    inline bool supports_color() {
#if defined(_WIN32)
        if (!_isatty(_fileno(stdout))) return false;

        HANDLE hOut = GetStdHandle(STD_OUTPUT_HANDLE);
        DWORD dwMode = 0;
        if (!GetConsoleMode(hOut, &dwMode)) return false;
        dwMode |= ENABLE_VIRTUAL_TERMINAL_PROCESSING;
        return SetConsoleMode(hOut, dwMode) != 0;
#else
        return isatty(fileno(stdout)) != 0;
#endif
    }

    constexpr std::string_view reset = "\033[0m";
    constexpr std::string_view bold  = "\033[1m";
    constexpr std::string_view red   = "\033[31m";
    constexpr std::string_view green = "\033[32m";

} // namespace sgf::cli::terminal
