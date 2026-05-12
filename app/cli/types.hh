#pragma once

#include <span>
#include <string_view>
#include <functional>
#include "terminal.hh"

namespace sgf::cli {

    enum class OutputFormat {
        Text,
        Json
    };

    struct Context {
        OutputFormat format = OutputFormat::Text;
        bool use_color = false;

        std::string_view color(std::string_view ansi_code) const {
            return use_color ? ansi_code : "";
        }
    };

    using ArgsSpan = std::span<const std::string_view>;

    struct Command {
        std::string_view name;
        std::string_view description;
        std::function<int(Context&, ArgsSpan)> execute;
    };

} // namespace sgf::cli
