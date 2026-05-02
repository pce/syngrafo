// linux_systray_adapter.hh — Linux CRTP adapter (pure C++ interface)
//
// GTK / AppIndicator types are fully hidden behind Impl so this header can be
// included from any C++ translation unit without pulling in GTK headers.
//
// Falls back gracefully to a no-op stub when libayatana-appindicator /
// libappindicator3 are not available at build time.
//
// The Impl struct is defined in src/linux_systray_adapter.cpp.

#pragma once

#include "systray_core.hpp"
#include <memory>

namespace saucer::systray
{
    class LinuxSystrayAdapter final : public SystrayAdapter<LinuxSystrayAdapter>
    {
    public:

        LinuxSystrayAdapter();
        ~LinuxSystrayAdapter();

        LinuxSystrayAdapter(LinuxSystrayAdapter&&) noexcept;
        LinuxSystrayAdapter& operator=(LinuxSystrayAdapter&&) noexcept;

        LinuxSystrayAdapter(const LinuxSystrayAdapter&)            = delete;
        LinuxSystrayAdapter& operator=(const LinuxSystrayAdapter&) = delete;

        // ── CRTP hook — called by SystrayAdapter::apply() ────────────────────
        void apply_impl(const SystrayState& state);

    private:
        struct Impl;
        std::unique_ptr<Impl> impl_;
    };

} // namespace saucer::systray

