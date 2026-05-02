//
// Created by Patrick Engel on 02.05.26.
//

#pragma once

#include <functional>
#include <string>
#include <vector>

namespace saucer::systray
{
    /// Menu item types
    enum class MenuItemType
    {
        Action,
        Separator
    };

    struct MenuItem
    {
        std::string              id;
        std::string              label;
        MenuItemType             type    = MenuItemType::Action;
        bool                     enabled = true;
        std::function<void()>    on_click;
    };

    // Canonical tray state — single source of truth, passed as const&

    struct SystrayState
    {
        std::string              tooltip;
        std::string              icon_path;
        std::vector<MenuItem>    items;
        std::function<void()>    on_activate;
        bool                     visible = false;
    };

    // CRTP adapter base — zero overhead, no vtable
    //
    // Platform adapters inherit from SystrayAdapter<Derived> and implement
    // apply_impl(const SystrayState&).  The base dispatches through the static
    // type so that the call is resolved at compile time with no virtual dispatch.
    //
    // Example:
    //   class MacSystrayAdapter : public SystrayAdapter<MacSystrayAdapter> {
    //   public:
    //       void apply_impl(const SystrayState& state) { ... }
    //   };

    template <typename Derived>
    class SystrayAdapter
    {
    public:
        /// Push the full tray state to the platform backend.
        void apply(const SystrayState& state)
        {
            static_cast<Derived*>(this)->apply_impl(state);
        }
    };

} // namespace saucer::systray
