#pragma once

#include "types.hh"
#include <map>
#include <vector>
#include <optional>
#include <iostream>

namespace sgf::cli {

    class Registry {
        std::map<std::string_view, Command> commands;

    public:
        void register_command(Command cmd) {
            commands[cmd.name] = std::move(cmd);
        }

        void print_help(const Context& ctx) const {
            if (ctx.format == OutputFormat::Json) {
                std::cout << "{ \"error\": \"Help text is not available in JSON format.\" }\n";
                return;
            }

            std::cout << ctx.color(terminal::bold) << "Syngrafo0 CLI\n\n" << ctx.color(terminal::reset)
                      << "Usage: syngrafo [command] [args...] [--json] [--no-color]\n\n"
                      << ctx.color(terminal::bold) << "Commands:\n" << ctx.color(terminal::reset);

            for (const auto& [name, cmd] : commands) {
                std::cout << "  " << ctx.color(terminal::green) << name << ctx.color(terminal::reset)
                          << "\t- " << cmd.description << '\n';
            }
        }

        std::optional<int> dispatch(int argc, char** argv, Context& ctx) {
            if (argc <= 1) return std::nullopt; // Boot GUI

            ctx.use_color = terminal::supports_color();
            ctx.format = OutputFormat::Text;

            std::vector<std::string_view> raw_args(argv + 1, argv + argc);
            std::vector<std::string_view> command_args;

            for (auto arg : raw_args) {
                if (arg == "--json") {
                    ctx.format = OutputFormat::Json;
                    ctx.use_color = false;
                } else if (arg == "--no-color") {
                    ctx.use_color = false;
                } else {
                    command_args.push_back(arg);
                }
            }

            if (command_args.empty()) {
                // E.g. `./syngrafo --json` (no command given) -> print help, but maybe just boot GUI?
                // Let's print help since arguments were passed.
                print_help(ctx);
                return 0;
            }

            std::string_view target_cmd = command_args[0];

            if (target_cmd == "-h" || target_cmd == "--help" || target_cmd == "help") {
                print_help(ctx);
                return 0;
            }

            if (auto it = commands.find(target_cmd); it != commands.end()) {
                return it->second.execute(ctx, ArgsSpan(command_args).subspan(1));
            }

            if (ctx.format == OutputFormat::Json) {
                std::cerr << "{ \"error\": \"Unknown command\", \"command\": \"" << target_cmd << "\" }\n";
            } else {
                std::cerr << ctx.color(terminal::red) << "Error:" << ctx.color(terminal::reset)
                          << " Unknown command '" << target_cmd << "'\n";
                print_help(ctx);
            }
            return 1;
        }
    };

} // namespace sgf::cli
