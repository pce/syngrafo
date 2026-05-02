// win32_systray_adapter.cpp — Windows (Shell_NotifyIcon) CRTP adapter
//
// Creates a hidden message-only HWND to receive tray notification messages.
// Full state rebuild on every apply_impl() call.

#include <saucer/win32_systray_adapter.hh>

#ifdef _WIN32

#ifndef UNICODE
#  define UNICODE
#endif
#ifndef _UNICODE
#  define _UNICODE
#endif

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <commctrl.h>
#include <string>
#include <unordered_map>
#include <vector>
#include <algorithm>

#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "comctl32.lib")

namespace saucer::systray
{
    static constexpr UINT WM_TRAY_ICON = WM_USER + 100;
    static constexpr UINT TRAY_ID      = 1;

    // ── Impl ─────────────────────────────────────────────────────────────────

    struct Win32SystrayAdapter::Impl
    {
        HWND              hwnd    = nullptr;
        HMENU             hmenu   = nullptr;
        NOTIFYICONDATAW   nid     = {};
        bool              visible = false;

        // command-id → callback
        std::unordered_map<UINT, std::function<void()>> cmd_map;
        UINT next_cmd = 100;

        std::function<void()> on_activate;

        // ── Helpers ───────────────────────────────────────────────────────────

        static std::wstring to_wide(const std::string& s)
        {
            if (s.empty()) return {};
            int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
            std::wstring w(n, L'\0');
            MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, w.data(), n);
            return w;
        }

        static Impl* from_hwnd(HWND h)
        {
            return reinterpret_cast<Impl*>(GetWindowLongPtrW(h, GWLP_USERDATA));
        }

        static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
        {
            if (msg == WM_CREATE)
            {
                auto* cs = reinterpret_cast<CREATESTRUCTW*>(lp);
                SetWindowLongPtrW(hwnd, GWLP_USERDATA,
                                  reinterpret_cast<LONG_PTR>(cs->lpCreateParams));
                return 0;
            }

            auto* impl = from_hwnd(hwnd);
            if (!impl) return DefWindowProcW(hwnd, msg, wp, lp);

            if (msg == WM_TRAY_ICON)
            {
                switch (LOWORD(lp))
                {
                    case WM_LBUTTONDBLCLK:
                        if (impl->on_activate) impl->on_activate();
                        break;
                    case WM_RBUTTONUP:
                    case WM_CONTEXTMENU:
                    {
                        POINT pt{};
                        GetCursorPos(&pt);
                        SetForegroundWindow(hwnd);
                        TrackPopupMenu(impl->hmenu,
                                       TPM_BOTTOMALIGN | TPM_LEFTALIGN | TPM_RIGHTBUTTON,
                                       pt.x, pt.y, 0, hwnd, nullptr);
                        PostMessageW(hwnd, WM_NULL, 0, 0);
                        break;
                    }
                    default: break;
                }
                return 0;
            }

            if (msg == WM_COMMAND)
            {
                UINT cmd = LOWORD(wp);
                auto it  = impl->cmd_map.find(cmd);
                if (it != impl->cmd_map.end() && it->second)
                    it->second();
                return 0;
            }

            return DefWindowProcW(hwnd, msg, wp, lp);
        }

        // ── Full rebuild from canonical state ─────────────────────────────────

        void rebuild(const SystrayState& s)
        {
            // ── Visibility ────────────────────────────────────────────────────
            if (s.visible && !visible)
            {
                nid         = {};
                nid.cbSize  = sizeof(nid);
                nid.hWnd    = hwnd;
                nid.uID     = TRAY_ID;
                nid.uFlags  = NIF_ICON | NIF_TIP | NIF_MESSAGE;
                nid.uCallbackMessage = WM_TRAY_ICON;
                nid.hIcon   = LoadIconW(nullptr, IDI_APPLICATION);

                std::wstring tt = to_wide(s.tooltip);
                wcsncpy_s(nid.szTip, tt.empty() ? L"" : tt.c_str(), _TRUNCATE);

                Shell_NotifyIconW(NIM_ADD, &nid);
                nid.uVersion = NOTIFYICON_VERSION_4;
                Shell_NotifyIconW(NIM_SETVERSION, &nid);
                visible = true;
                on_activate = s.on_activate;
            }
            else if (!s.visible && visible)
            {
                Shell_NotifyIconW(NIM_DELETE, &nid);
                visible = false;
                return;
            }

            if (!visible) return;

            // ── Tooltip ───────────────────────────────────────────────────────
            {
                std::wstring tt = to_wide(s.tooltip);
                wcsncpy_s(nid.szTip, tt.empty() ? L"" : tt.c_str(), _TRUNCATE);
                nid.uFlags |= NIF_TIP;
                Shell_NotifyIconW(NIM_MODIFY, &nid);
            }

            // ── Icon ──────────────────────────────────────────────────────────
            if (!s.icon_path.empty())
            {
                std::wstring wp = to_wide(s.icon_path);
                HICON icon = static_cast<HICON>(
                    LoadImageW(nullptr, wp.c_str(), IMAGE_ICON, 32, 32, LR_LOADFROMFILE));
                if (icon)
                {
                    nid.hIcon   = icon;
                    nid.uFlags |= NIF_ICON;
                    Shell_NotifyIconW(NIM_MODIFY, &nid);
                }
            }

            // ── on_activate ───────────────────────────────────────────────────
            on_activate = s.on_activate;

            // ── Menu ──────────────────────────────────────────────────────────
            if (hmenu) DestroyMenu(hmenu);
            hmenu = CreatePopupMenu();
            cmd_map.clear();

            for (const auto& mi : s.items)
            {
                if (mi.type == MenuItemType::Separator)
                {
                    AppendMenuW(hmenu, MF_SEPARATOR, 0, nullptr);
                    continue;
                }

                UINT cmd   = next_cmd++;
                UINT flags = MF_STRING;
                if (!mi.enabled) flags |= MF_GRAYED;
                std::wstring label = to_wide(mi.label);
                AppendMenuW(hmenu, flags, cmd, label.c_str());

                if (mi.on_click)
                    cmd_map[cmd] = mi.on_click;
            }
        }
    };

    // ── Win32SystrayAdapter ───────────────────────────────────────────────────

    Win32SystrayAdapter::Win32SystrayAdapter()
        : impl_(std::make_unique<Impl>())
    {
        const wchar_t* kClass = L"SaucerSystrayHidden";
        WNDCLASSEXW wc        = {};
        wc.cbSize             = sizeof(wc);
        wc.lpfnWndProc        = Impl::WndProc;
        wc.hInstance          = GetModuleHandleW(nullptr);
        wc.lpszClassName      = kClass;
        RegisterClassExW(&wc); // ignore duplicate-registration failure

        impl_->hwnd = CreateWindowExW(
            0, kClass, L"", 0, 0, 0, 0, 0,
            HWND_MESSAGE, nullptr, GetModuleHandleW(nullptr), impl_.get());
    }

    Win32SystrayAdapter::~Win32SystrayAdapter()
    {
        if (!impl_) return;
        if (impl_->visible)
            Shell_NotifyIconW(NIM_DELETE, &impl_->nid);
        if (impl_->hwnd)  DestroyWindow(impl_->hwnd);
        if (impl_->hmenu) DestroyMenu(impl_->hmenu);
    }

    Win32SystrayAdapter::Win32SystrayAdapter(Win32SystrayAdapter&&) noexcept  = default;
    Win32SystrayAdapter& Win32SystrayAdapter::operator=(Win32SystrayAdapter&&) noexcept = default;

    // ── CRTP hook ─────────────────────────────────────────────────────────────

    void Win32SystrayAdapter::apply_impl(const SystrayState& state)
    {
        impl_->rebuild(state);
    }

} // namespace saucer::systray

#else
// Non-Windows stubs
#include <memory>

namespace saucer::systray
{
    struct Win32SystrayAdapter::Impl {};
    Win32SystrayAdapter::Win32SystrayAdapter()  : impl_(std::make_unique<Impl>()) {}
    Win32SystrayAdapter::~Win32SystrayAdapter() = default;
    Win32SystrayAdapter::Win32SystrayAdapter(Win32SystrayAdapter&&) noexcept  = default;
    Win32SystrayAdapter& Win32SystrayAdapter::operator=(Win32SystrayAdapter&&) noexcept = default;
    void Win32SystrayAdapter::apply_impl(const SystrayState&) {}
}
#endif // _WIN32



