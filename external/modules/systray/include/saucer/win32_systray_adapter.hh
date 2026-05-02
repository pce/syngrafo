// win32_systray_adapter.hh — Windows CRTP adapter (pure C++ interface)
//
// Win32 / Shell API types are fully hidden behind Impl so this header can be
// included from any C++ translation unit without pulling in <windows.h>.
//
// The Impl struct is defined in src/win32_systray_adapter.cpp.

#pragma once

#include "systray_core.hpp"
#include <memory>

namespace saucer::systray
{
    class Win32SystrayAdapter final : public SystrayAdapter<Win32SystrayAdapter>
    {
    public:

        Win32SystrayAdapter();
        ~Win32SystrayAdapter();

        Win32SystrayAdapter(Win32SystrayAdapter&&) noexcept;
        Win32SystrayAdapter& operator=(Win32SystrayAdapter&&) noexcept;

        Win32SystrayAdapter(const Win32SystrayAdapter&)            = delete;
        Win32SystrayAdapter& operator=(const Win32SystrayAdapter&) = delete;

        //  CRTP hook — called by SystrayAdapter::apply()
        void apply_impl(const SystrayState& state);

    private:
        struct Impl;
        std::unique_ptr<Impl> impl_;
    };

} // namespace saucer::systray

