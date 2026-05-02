#include <catch2/catch_test_macros.hpp>
#include <saucer/systray.hpp>

using namespace saucer::systray;

// ── SystrayState — POD defaults ───────────────────────────────────────────────

TEST_CASE("SystrayState: defaults are sane", "[systray][core]")
{
    SystrayState s;
    REQUIRE(s.tooltip.empty());
    REQUIRE(s.icon_path.empty());
    REQUIRE(s.items.empty());
    REQUIRE_FALSE(s.visible);
    REQUIRE_FALSE(s.on_activate);
}

// ── MenuItem ──────────────────────────────────────────────────────────────────

TEST_CASE("MenuItem: default type is Action", "[systray][menu]")
{
    MenuItem mi;
    REQUIRE(mi.type    == MenuItemType::Action);
    REQUIRE(mi.enabled == true);
    REQUIRE_FALSE(mi.on_click);
}

// ── Systray<Adapter> construction ─────────────────────────────────────────────
//
// On CI / headless builds AppKit / AppIndicator may not be available.
// We only verify that the object can be constructed and destroyed and that the
// state accessors return consistent values — no actual tray icon is shown.

TEST_CASE("NativeSystray: constructs and destroys without crash", "[systray]")
{
    REQUIRE_NOTHROW([]{ NativeSystray t; }());
}

TEST_CASE("NativeSystray: is_visible starts false", "[systray]")
{
    NativeSystray t;
    REQUIRE_FALSE(t.is_visible());
}

TEST_CASE("NativeSystray: set_on_activate stores callback (no crash)", "[systray]")
{
    NativeSystray t;
    bool called = false;
    REQUIRE_NOTHROW([&]{ t.set_on_activate([&]{ called = true; }); }());
    // Callback is stored in state but not triggered here
    REQUIRE_FALSE(called);
}

TEST_CASE("NativeSystray: set_tooltip updates state", "[systray]")
{
    NativeSystray t;
    t.set_tooltip("Hello");
    REQUIRE(t.state().tooltip == "Hello");
}

TEST_CASE("NativeSystray: set_icon updates state", "[systray]")
{
    NativeSystray t;
    t.set_icon("/tmp/icon.png");
    REQUIRE(t.state().icon_path == "/tmp/icon.png");
}

// ── SystrayController mutations ───────────────────────────────────────────────

TEST_CASE("NativeSystray: add_or_update inserts new item", "[systray][menu]")
{
    NativeSystray t;
    t.add_or_update({ .id="open", .label="Open" });
    REQUIRE(t.state().items.size() == 1);
    REQUIRE(t.state().items[0].label == "Open");
}

TEST_CASE("NativeSystray: add_or_update replaces existing item by id", "[systray][menu]")
{
    NativeSystray t;
    t.add_or_update({ .id="open", .label="Open" });
    t.add_or_update({ .id="open", .label="Open PDF" }); // same id
    REQUIRE(t.state().items.size() == 1);
    REQUIRE(t.state().items[0].label == "Open PDF");
}

TEST_CASE("NativeSystray: remove deletes item by id", "[systray][menu]")
{
    NativeSystray t;
    t.add_or_update({ .id="a", .label="A" });
    t.add_or_update({ .id="b", .label="B" });
    t.remove("a");
    REQUIRE(t.state().items.size() == 1);
    REQUIRE(t.state().items[0].id == "b");
}

TEST_CASE("NativeSystray: clear empties all items", "[systray][menu]")
{
    NativeSystray t;
    t.add_or_update({ .id="a", .label="A" });
    t.add_or_update({ .id="b", .label="B" });
    t.clear();
    REQUIRE(t.state().items.empty());
}


