#pragma once
/**
 * @file core/palette.hh
 * @author Patrick Engel
 * @brief ColorPalette value type — zone/project/brand color sets
 *        for image stylization, vector reconstruction and content generation.
 *
 * A ColorPalette is a named, typed list of RGB colors that can be:
 *   - stored in the (optionally encrypted) zone database
 *   - used directly by image pipeline functions (to_pal_palette())
 *   - surfaced in the frontend as ColorPicker presets / filter palette selectors
 *
 * No webview. No SQLite. No virtuals.
 *
 * Naming conventions for user-defined palettes:
 *   MY8  / MY16 / MY32  — generic project palettes by size
 *   BRAND_<name>         — brand identity colors
 *   Custom IDs are lowercase slugs e.g. "acme_brand", "project_alpha_8"
 *
 * @code{.cpp}
 *   ColorPalette p{
 *       .id   = "acme_brand",
 *       .name = "Acme Brand Colors",
 *       .kind = PaletteKind::Brand,
 *       .description = "Main brand palette — primary + secondary + neutrals",
 *       .colors = {
 *           {0x00, 0x6A, 0xFF, "Primary Blue"},
 *           {0xFF, 0x6B, 0x00, "Accent Orange"},
 *           {0xF0, 0xF0, 0xF0, "Off White"},
 *           {0x1A, 0x1A, 0x2E, "Dark Navy"},
 *       },
 *   };
 *
 *   // Feed directly into the image pipeline:
 *   auto svg = Image::load(path)
 *       | stage([&p](Image img) -> Expected<pal::Palette> {
 *             return p.to_pal_palette();
 *         })
 *       | stage(...);
 * @endcode
 */

#include "image.hh"      // pal::RGB3, pal::Palette
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

// JSON serialization — used for DB storage and the JSON API envelope.
#include <nlohmann/json.hpp>

namespace pce::dms {

// ─── PaletteKind ──────────────────────────────────────────────────────────────

enum class PaletteKind : uint8_t {
    BuiltIn = 0,  ///< Shipped with the app (db8, db16, db32, …).  Read-only.
    Project = 1,  ///< Per-zone project palette (MY8, MY16, …).
    Brand   = 2,  ///< Brand/identity colors reused across filters + pickers.
};

[[nodiscard]] constexpr std::string_view palette_kind_name(PaletteKind k) noexcept {
    switch (k) {
        case PaletteKind::BuiltIn: return "builtin";
        case PaletteKind::Project: return "project";
        case PaletteKind::Brand:   return "brand";
    }
    return "project";
}

[[nodiscard]] inline PaletteKind palette_kind_from_string(std::string_view s) noexcept {
    if (s == "builtin") return PaletteKind::BuiltIn;
    if (s == "brand")   return PaletteKind::Brand;
    return PaletteKind::Project;
}

// ─── PaletteEntry ─────────────────────────────────────────────────────────────

/// A single color in a named palette.
/// `name` is optional (empty = unnamed swatch); used in ColorPicker labels.
struct PaletteEntry {
    uint8_t     r{};
    uint8_t     g{};
    uint8_t     b{};
    std::string name;   ///< e.g. "Primary Blue", "Highlight"

    [[nodiscard]] std::string hex() const {
        char buf[8];
        std::snprintf(buf, sizeof(buf), "#%02x%02x%02x", r, g, b);
        return buf;
    }

    [[nodiscard]] pal::RGB3 to_rgb3() const noexcept { return {r, g, b}; }

    // ── JSON round-trip ───────────────────────────────────────────────────────
    [[nodiscard]] nlohmann::json to_json() const {
        nlohmann::json j{{"r", r}, {"g", g}, {"b", b}};
        if (!name.empty()) j["name"] = name;
        return j;
    }

    [[nodiscard]] static PaletteEntry from_json(const nlohmann::json& j) {
        PaletteEntry e;
        e.r    = static_cast<uint8_t>(j.value("r", 0));
        e.g    = static_cast<uint8_t>(j.value("g", 0));
        e.b    = static_cast<uint8_t>(j.value("b", 0));
        e.name = j.value("name", std::string{});
        return e;
    }
};

// ─── ColorPalette ─────────────────────────────────────────────────────────────

/// A named, typed palette stored per zone.
/// BuiltIn palettes are never written to the DB — they are synthesised on read.
struct ColorPalette {
    std::string               id;           ///< Unique slug: "my8", "acme_brand", …
    std::string               name;         ///< Display name
    PaletteKind               kind{PaletteKind::Project};
    std::string               description;
    std::vector<PaletteEntry> colors;
    int64_t                   created_at{0};
    int64_t                   updated_at{0};

    // ── Predicates ────────────────────────────────────────────────────────────
    [[nodiscard]] bool empty()     const noexcept { return colors.empty(); }
    [[nodiscard]] bool is_builtin() const noexcept { return kind == PaletteKind::BuiltIn; }
    [[nodiscard]] int  size()      const noexcept { return static_cast<int>(colors.size()); }

    // ── Image pipeline integration ────────────────────────────────────────────

    /// Convert to a `pal::Palette` (vector of RGB3) for use in the image pipeline.
    [[nodiscard]] pal::Palette to_pal_palette() const {
        pal::Palette p;
        p.reserve(colors.size());
        for (const auto& c : colors) p.push_back(c.to_rgb3());
        return p;
    }

    // ── JSON serialization ────────────────────────────────────────────────────

    /// Serialize colors to a JSON array string (stored in `colors_json` column).
    [[nodiscard]] std::string colors_to_json() const {
        auto arr = nlohmann::json::array();
        for (const auto& c : colors) arr.push_back(c.to_json());
        return arr.dump();
    }

    /// Parse colors from a JSON array string.
    static std::vector<PaletteEntry> colors_from_json(std::string_view json_str) {
        std::vector<PaletteEntry> result;
        try {
            const auto arr = nlohmann::json::parse(json_str);
            for (const auto& j : arr)
                result.push_back(PaletteEntry::from_json(j));
        } catch (...) {}
        return result;
    }

    /// Full serialization for the API envelope.
    [[nodiscard]] nlohmann::json to_json() const {
        auto arr = nlohmann::json::array();
        for (const auto& c : colors) arr.push_back(c.to_json());
        return nlohmann::json{
            {"id",          id},
            {"name",        name},
            {"kind",        std::string{palette_kind_name(kind)}},
            {"description", description},
            {"colors",      arr},
            {"size",        static_cast<int>(colors.size())},
            {"created_at",  created_at},
            {"updated_at",  updated_at},
        };
    }

    [[nodiscard]] static ColorPalette from_json(const nlohmann::json& j) {
        ColorPalette p;
        p.id          = j.value("id",          std::string{});
        p.name        = j.value("name",        std::string{});
        p.kind        = palette_kind_from_string(j.value("kind", std::string{"project"}));
        p.description = j.value("description", std::string{});
        p.created_at  = j.value("created_at",  int64_t{0});
        p.updated_at  = j.value("updated_at",  int64_t{0});
        if (j.contains("colors") && j["colors"].is_array())
            for (const auto& c : j["colors"])
                p.colors.push_back(PaletteEntry::from_json(c));
        return p;
    }
};

// ─── Built-in palette catalog ─────────────────────────────────────────────────

/// Returns the static list of built-in palettes (db8, db16, db32).
/// These are never stored in the DB — synthesised on demand.
[[nodiscard]] inline std::vector<ColorPalette> builtin_palettes() {
    auto make = [](std::string id, std::string name, const pal::Palette& p) {
        ColorPalette cp;
        cp.id   = std::move(id);
        cp.name = std::move(name);
        cp.kind = PaletteKind::BuiltIn;
        cp.colors.reserve(p.size());
        for (const auto& c : p)
            cp.colors.push_back({c.r, c.g, c.b, {}});
        return cp;
    };
    return {
        make("db8",  "DawnBringer 8",  pal::db8()),
        make("db16", "DawnBringer 16", pal::db16()),
        make("db32", "DawnBringer 32", pal::db32()),
    };
}

} // namespace pce::dms

