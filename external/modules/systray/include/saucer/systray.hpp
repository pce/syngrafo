#pragma once

/**
 * saucer::systray  — System-tray / notification-area icon module (C++23)
 *
 * Architecture (zero overhead — no vtable, no heap indirection):
 *
 *   SystrayCore   (systray_core.hpp)
 *     ├── SystrayState  — single source of truth (POD-like aggregate)
 *     ├── MenuItem      — menu entry description
 *     └── SystrayAdapter<Derived>  — CRTP adapter base
 *
 *   SystrayController<Derived>  (systray_controller.hpp)
 *     └── CRTP mixin: owns SystrayState, exposes mutation methods,
 *         calls Derived::sync() after each mutation
 *
 *   Systray<Adapter>  (this header)
 *     ├── inherits SystrayController<Systray<Adapter>>
 *     ├── owns  Adapter   by value  (no heap indirection)
 *     └── implements sync()  →  adapter_.apply(state_)
 *
 * Platform aliases:
 *   NativeSystray  =  Systray<MacSystrayAdapter>   (macOS)
 *                  =  Systray<Win32SystrayAdapter>  (Windows)
 *                  =  Systray<LinuxSystrayAdapter>  (Linux)
 *
 * Usage example:
 *   #include <saucer/systray.hpp>
 *
 *   saucer::systray::NativeSystray tray;
 *   tray.set_tooltip("PDF Editor");
 *   tray.add_or_update({ .id="open", .label="Open",
 *                        .on_click = [&]{ window->show(); } });
 *   tray.add_or_update({ .id="sep",  .type=MenuItemType::Separator });
 *   tray.add_or_update({ .id="quit", .label="Quit",
 *                        .on_click = [&]{ app->quit(); } });
 *   tray.set_on_activate([&]{ window->show(); tray.hide(); });
 *   tray.show();
 *
 *   // Hide to tray on window close:
 *   webview->on<saucer::window_event::close>([&]() -> bool {
 *       window->hide();
 *       tray.show();
 *       return true; // suppress actual close
 *   });
 */

#include "systray_core.hpp"
#include "systray_controller.hpp"

namespace saucer::systray
{
    // ── Systray<Adapter> ──────────────────────────────────────────────────────
    //
    // The public API:  owns the canonical SystrayState (via SystrayController)
    // and a concrete Adapter instance by value.
    //
    // template parameter Adapter :
    //   • must be a concrete final class derived from SystrayAdapter<Adapter>
    //   • must be default-constructible
    //   • must implement  void apply_impl(const SystrayState&)

    template <typename Adapter>
    class Systray : public SystrayController<Systray<Adapter>>
    {
        Adapter adapter_;

    public:
        // ── Adapter synchronisation ───────────────────────────────────────────

        /// Push the current state to the adapter.  Called automatically by
        /// every mutation method inherited from SystrayController.
        void sync()
        {
            adapter_.apply(this->state_);
        }

        // ── Visibility ────────────────────────────────────────────────────────

        void show()
        {
            this->state_.visible = true;
            sync();
        }

        void hide()
        {
            this->state_.visible = false;
            sync();
        }

        //  Direct state accessor (read-only) ─────────────────────────────────
        // (is_visible() and state() are inherited from SystrayController)
    };

} // namespace saucer::systray


// ── Platform adapter headers ──────────────────────────────────────────────────
//
// Each header defines the concrete adapter class and is self-contained (no
// Obj-C / Win32 / GTK types leak into pure-C++ translation units).

#if defined(__APPLE__)
#   include "mac_systray_adapter.hh"
namespace saucer::systray {
    using NativeSystray = Systray<MacSystrayAdapter>;
}

#elif defined(_WIN32)
#   include "win32_systray_adapter.hh"
namespace saucer::systray {
    using NativeSystray = Systray<Win32SystrayAdapter>;
}

#else
#   include "linux_systray_adapter.hh"
namespace saucer::systray {
    using NativeSystray = Systray<LinuxSystrayAdapter>;
}
#endif


