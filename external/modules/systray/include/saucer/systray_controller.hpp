//
// Created by Patrick Engel on 02.05.26.
//

#pragma once

#include "systray_core.hpp"
#include <algorithm>
#include <string_view>

namespace saucer::systray
{
    // ── CRTP state-management mixin ───────────────────────────────────────────
    //
    // SystrayController<Derived> provides the full set of state-mutation methods.
    // After every mutation it calls Derived::sync() so the adapter is kept in
    // sync automatically.
    //
    // Derived must implement:
    //   void sync();
    //
    // The state is owned here as a protected member so that Derived (Systray<A>)
    // can access it directly for show/hide/is_visible.

    template <typename Derived>
    class SystrayController
    {
    protected:
        SystrayState state_;

        /// Call after every mutation that should be reflected in the adapter.
        void notify_changed()
        {
            static_cast<Derived*>(this)->sync();
        }

    public:
        // ── Scalar fields ─────────────────────────────────────────────────────

        void set_tooltip(std::string t)
        {
            state_.tooltip = std::move(t);
            notify_changed();
        }

        void set_icon(std::string path)
        {
            state_.icon_path = std::move(path);
            notify_changed();
        }

        /// Store the activate-callback without triggering a full sync
        /// (the callback is held in state and passed to the adapter on next sync).
        void set_on_activate(std::function<void()> cb)
        {
            state_.on_activate = std::move(cb);
            // No sync here: pure metadata, does not affect the rendered tray.
        }

        // ── Menu items ────────────────────────────────────────────────────────

        /// Insert a new item or replace the existing one with the same id.
        void add_or_update(MenuItem item)
        {
            auto it = std::find_if(state_.items.begin(), state_.items.end(),
                [&](const auto& x){ return x.id == item.id; });

            if (it != state_.items.end())
                *it = std::move(item);
            else
                state_.items.push_back(std::move(item));

            notify_changed();
        }

        /// Remove the item with the given id (no-op if not found).
        void remove(std::string_view id)
        {
            auto& v = state_.items;
            v.erase(std::remove_if(v.begin(), v.end(),
                        [&](const auto& x){ return x.id == id; }),
                    v.end());
            notify_changed();
        }

        /// Remove all menu items.
        void clear()
        {
            state_.items.clear();
            notify_changed();
        }

        // ── Observers ─────────────────────────────────────────────────────────

        [[nodiscard]] bool is_visible() const noexcept
        {
            return state_.visible;
        }

        [[nodiscard]] const SystrayState& state() const noexcept
        {
            return state_;
        }
    };

} // namespace saucer::systray
