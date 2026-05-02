// mac_systray_adapter.mm — macOS (Cocoa / AppKit) CRTP adapter
//
// Implements MacSystrayAdapter::apply_impl via a full-state rebuild approach:
// every apply() call is the single source of truth — show, hide, tooltip, icon
// and the entire menu are derived from the SystrayState passed in.
//
// All AppKit calls are marshalled to the main thread.  apply_impl is
// synchronous when already on the main thread; asynchronous otherwise (the
// state is captured by value so it is valid after the call returns).

#import <AppKit/AppKit.h>
#include <saucer/mac_systray_adapter.hh>

#include <vector>
#include <functional>

// ── Obj-C delegate — bridges NSMenuItem selector back to C++ callbacks ────────
//
// The delegate is owned by Impl and holds a raw pointer to the callbacks vector
// that also lives in Impl.  Both have the same lifetime so the raw pointer is
// safe.

@interface SystrayMenuDelegate : NSObject
{
@public
    std::vector<std::function<void()>>* callbacks; // non-owning
}
- (void)menuItemClicked:(NSMenuItem*)sender;
@end

@implementation SystrayMenuDelegate

- (void)menuItemClicked:(NSMenuItem*)sender
{
    if (!callbacks) return;
    NSInteger tag = sender.tag;
    if (tag >= 0 && tag < static_cast<NSInteger>(callbacks->size()))
        (*callbacks)[static_cast<std::size_t>(tag)]();
}

@end


// ── Impl ─────────────────────────────────────────────────────────────────────

namespace saucer::systray
{
    struct MacSystrayAdapter::Impl
    {
        NSStatusItem*         status_item = nil;
        NSMenu*               menu        = nil;
        SystrayMenuDelegate*  delegate    = nil;

        // One entry per Action item in insertion order (maps NSMenuItem.tag → cb)
        std::vector<std::function<void()>> callbacks;

        // ── Helpers ───────────────────────────────────────────────────────────

        static NSImage* load_icon(const std::string& path)
        {
            if (path.empty()) return nil;
            NSString* p = [NSString stringWithUTF8String:path.c_str()];
            NSImage*  img = [[NSImage alloc] initWithContentsOfFile:p];
            if (img) img.size = NSMakeSize(18, 18);
            return img;
        }

        static NSImage* fallback_icon()
        {
            NSImage* img = nil;
            if (@available(macOS 11.0, *))
                img = [NSImage imageWithSystemSymbolName:@"doc.fill"
                                 accessibilityDescription:nil];
            if (!img)
                img = [NSImage imageNamed:NSImageNameApplicationIcon];
            if (img) img.size = NSMakeSize(18, 18);
            return img;
        }

        // ── Full-state rebuild (must run on main thread) ───────────────────────

        void rebuild(const SystrayState& s)
        {
            // ── Visibility ────────────────────────────────────────────────────
            if (s.visible && !status_item)
            {
                status_item = [[NSStatusBar systemStatusBar]
                               statusItemWithLength:NSVariableStatusItemLength];
            }
            else if (!s.visible && status_item)
            {
                [[NSStatusBar systemStatusBar] removeStatusItem:status_item];
                status_item = nil;
                return; // nothing else to update when hidden
            }

            if (!status_item) return; // still invisible — nothing to do

            // ── Tooltip ───────────────────────────────────────────────────────
            status_item.button.toolTip =
                [NSString stringWithUTF8String:s.tooltip.c_str()];

            // ── Icon ──────────────────────────────────────────────────────────
            NSImage* img = load_icon(s.icon_path);
            if (!img) img = fallback_icon();
            if (img) [img setTemplate:YES]; // adapts to light/dark menu bar
            status_item.button.image = img;

            // ── Menu ──────────────────────────────────────────────────────────
            if (!menu) menu = [[NSMenu alloc] init];
            [menu removeAllItems];
            callbacks.clear();

            NSInteger tag = 0;
            for (const auto& mi : s.items)
            {
                if (mi.type == MenuItemType::Separator)
                {
                    [menu addItem:[NSMenuItem separatorItem]];
                    continue;
                }

                NSString*   title = [NSString stringWithUTF8String:mi.label.c_str()];
                NSMenuItem* item  = [[NSMenuItem alloc]
                                       initWithTitle:title
                                              action:@selector(menuItemClicked:)
                                       keyEquivalent:@""];
                item.target  = delegate;
                item.tag     = tag++;
                item.enabled = mi.enabled ? YES : NO;
                callbacks.push_back(mi.on_click);
                [menu addItem:item];
            }

            status_item.menu = menu;
        }
    };

    // ── MacSystrayAdapter ─────────────────────────────────────────────────────

    MacSystrayAdapter::MacSystrayAdapter()
        : impl_(std::make_unique<Impl>())
    {
        auto* p = impl_.get();
        auto init_delegate = [p] {
            p->delegate           = [[SystrayMenuDelegate alloc] init];
            p->delegate->callbacks = &p->callbacks;
            p->menu               = [[NSMenu alloc] init];
        };

        if ([NSThread isMainThread])
            init_delegate();
        else
            dispatch_sync(dispatch_get_main_queue(), init_delegate);
    }

    MacSystrayAdapter::~MacSystrayAdapter()
    {
        if (!impl_) return;
        auto* p = impl_.get();

        auto cleanup = [p] {
            if (p->status_item)
            {
                [[NSStatusBar systemStatusBar] removeStatusItem:p->status_item];
                p->status_item = nil;
            }
            p->menu     = nil;
            p->delegate = nil;
        };

        if ([NSThread isMainThread])
            cleanup();
        else
            dispatch_sync(dispatch_get_main_queue(), cleanup);
    }

    MacSystrayAdapter::MacSystrayAdapter(MacSystrayAdapter&&) noexcept  = default;
    MacSystrayAdapter& MacSystrayAdapter::operator=(MacSystrayAdapter&&) noexcept = default;

    // ── CRTP hook ─────────────────────────────────────────────────────────────

    void MacSystrayAdapter::apply_impl(const SystrayState& state)
    {
        // Capture by value — safe to call from any thread
        SystrayState s   = state;
        auto*        impl = impl_.get();

        auto do_apply = [impl, s = std::move(s)]() mutable {
            impl->rebuild(s);
        };

        if ([NSThread isMainThread])
            do_apply();
        else
            dispatch_async(dispatch_get_main_queue(), do_apply);
    }

} // namespace saucer::systray



