// mac_systray_adapter.hh — macOS CRTP adapter (pure C++ interface)
//
// Obj-C / AppKit types are fully hidden behind Impl so this header can be
// included from any C++ translation unit without touching ObjC++.
//
// The Impl struct is defined in src/mac_systray_adapter.mm.

#pragma once

#include "systray_core.hpp"
#include <memory>

namespace saucer::systray
{
    class MacSystrayAdapter final : public SystrayAdapter<MacSystrayAdapter>
    {
    public:

        MacSystrayAdapter();
        ~MacSystrayAdapter();

        // Move-only (NSStatusItem cannot be copied meaningfully)
        MacSystrayAdapter(MacSystrayAdapter&&) noexcept;
        MacSystrayAdapter& operator=(MacSystrayAdapter&&) noexcept;

        MacSystrayAdapter(const MacSystrayAdapter&)            = delete;
        MacSystrayAdapter& operator=(const MacSystrayAdapter&) = delete;

        // CRTP hook — called by SystrayAdapter::apply()
        //
        // Pushes the full canonical state to the AppKit layer on the main thread.
        // Idempotent: calling with the same visible=false is a no-op.
        void apply_impl(const SystrayState& state);

    private:
        struct Impl;
        std::unique_ptr<Impl> impl_;
    };

} // namespace saucer::systray

