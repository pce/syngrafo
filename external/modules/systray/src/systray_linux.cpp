// linux_systray_adapter.cpp — Linux (libayatana-appindicator / libappindicator3)
// CRTP adapter implementation.
//
// Falls back to a no-op stub when neither indicator library is available so
// the project still builds on minimal Linux environments.
//
// Requires one of:
//   libayatana-appindicator3-dev   (preferred, Ubuntu 20.04+)
//   libappindicator3-dev           (legacy)
//
// The CMakeLists.txt uses pkg_check_modules to decide which to link.

#include <saucer/linux_systray_adapter.hh>

#if defined(__linux__)

#if defined(SAUCER_SYSTRAY_USE_APPINDICATOR)
#  if defined(SAUCER_SYSTRAY_AYATANA)
#    include <libayatana-appindicator/app-indicator.h>
#  else
#    include <libappindicator/app-indicator.h>
#  endif
#  include <gtk/gtk.h>
#  define HAS_APPINDICATOR 1
#endif

#include <string>
#include <unordered_map>
#include <vector>
#include <algorithm>
#include <iostream>

namespace saucer::systray
{
    // ── Impl ─────────────────────────────────────────────────────────────────

    struct LinuxSystrayAdapter::Impl
    {
#if HAS_APPINDICATOR
        AppIndicator* indicator = nullptr;
        GtkWidget*    gmenu     = nullptr;
        bool          visible   = false;

        // Static callback: GtkMenuItem data holds a heap-allocated callback copy.
        static void on_menu_item_activate(GtkMenuItem* /*w*/, gpointer data)
        {
            auto* cb = static_cast<std::function<void()>*>(data);
            if (cb && *cb) (*cb)();
        }

        // ── Full rebuild from canonical state ─────────────────────────────────

        void rebuild(const SystrayState& s)
        {
            // Visibility
            if (s.visible && !visible)
            {
                if (!indicator)
                {
                    indicator = app_indicator_new(
                        "saucer-systray",
                        "document-new",
                        APP_INDICATOR_CATEGORY_APPLICATION_STATUS);
                }
                app_indicator_set_status(indicator, APP_INDICATOR_STATUS_ACTIVE);
                visible = true;
            }
            else if (!s.visible && visible)
            {
                app_indicator_set_status(indicator, APP_INDICATOR_STATUS_PASSIVE);
                visible = false;
                return;
            }

            if (!visible) return;

            // Icon
            if (!s.icon_path.empty())
                app_indicator_set_icon_full(indicator,
                                            s.icon_path.c_str(),
                                            s.icon_path.c_str());

            // Tooltip (AppIndicator has no tooltip API — silently ignored)

            // Menu — destroy old, build fresh
            if (gmenu) gtk_widget_destroy(gmenu);
            gmenu = gtk_menu_new();

            for (const auto& mi : s.items)
            {
                GtkWidget* item = nullptr;
                if (mi.type == MenuItemType::Separator)
                {
                    item = gtk_separator_menu_item_new();
                }
                else
                {
                    item = gtk_menu_item_new_with_label(mi.label.c_str());
                    gtk_widget_set_sensitive(item, mi.enabled ? TRUE : FALSE);
                    if (mi.on_click)
                    {
                        // Heap-allocate a copy so the raw pointer stays valid
                        // until the menu item is destroyed.
                        auto* cb = new std::function<void()>(mi.on_click);
                        g_signal_connect(item, "activate",
                                         G_CALLBACK(on_menu_item_activate), cb);
                        g_object_set_data_full(G_OBJECT(item), "cb_ptr", cb,
                            [](gpointer p){ delete static_cast<std::function<void()>*>(p); });
                    }
                }
                gtk_menu_shell_append(GTK_MENU_SHELL(gmenu), item);
            }

            gtk_widget_show_all(gmenu);
            app_indicator_set_menu(indicator, GTK_MENU(gmenu));
        }
#endif // HAS_APPINDICATOR
    };

    // ── LinuxSystrayAdapter ───────────────────────────────────────────────────

    LinuxSystrayAdapter::LinuxSystrayAdapter()
        : impl_(std::make_unique<Impl>())
    {
#if !HAS_APPINDICATOR
        std::cerr << "[Systray] libayatana-appindicator / libappindicator not found "
                     "— systray disabled on this Linux build.\n";
#endif
    }

    LinuxSystrayAdapter::~LinuxSystrayAdapter()
    {
#if HAS_APPINDICATOR
        if (impl_ && impl_->indicator)
        {
            app_indicator_set_status(impl_->indicator,
                                     APP_INDICATOR_STATUS_PASSIVE);
            g_object_unref(impl_->indicator);
            impl_->indicator = nullptr;
        }
#endif
    }

    LinuxSystrayAdapter::LinuxSystrayAdapter(LinuxSystrayAdapter&&) noexcept  = default;
    LinuxSystrayAdapter& LinuxSystrayAdapter::operator=(LinuxSystrayAdapter&&) noexcept = default;

    // ── CRTP hook ─────────────────────────────────────────────────────────────

    void LinuxSystrayAdapter::apply_impl(const SystrayState& state)
    {
#if HAS_APPINDICATOR
        impl_->rebuild(state);
#else
        (void)state;
#endif
    }

} // namespace saucer::systray

#else
// Non-Linux translation unit — provides stubs so the file compiles everywhere.
#include <memory>

namespace saucer::systray
{
    struct LinuxSystrayAdapter::Impl {};

    LinuxSystrayAdapter::LinuxSystrayAdapter()
        : impl_(std::make_unique<Impl>()) {}
    LinuxSystrayAdapter::~LinuxSystrayAdapter() = default;
    LinuxSystrayAdapter::LinuxSystrayAdapter(LinuxSystrayAdapter&&) noexcept  = default;
    LinuxSystrayAdapter& LinuxSystrayAdapter::operator=(LinuxSystrayAdapter&&) noexcept = default;
    void LinuxSystrayAdapter::apply_impl(const SystrayState&) {}
}
#endif // __linux__



