#pragma once
/**
 * @file bindings/palette_bindings.hh
 * @author Patrick Engel
 * @brief ColorPalette domain bindings — zone/project/brand color sets.
 *
 * Palette types:
 *   builtin  — db8 / db16 / db32 / spectrumN (read-only, never in DB)
 *   project  — per-zone palettes  e.g. MY8, MY16, MY32 (content generation)
 *   brand    — brand identity colors surfaced in ColorPickers / Filters
 *
 * Exposed bindings:
 *   dms_get_palettes()                  → PaletteList (builtin + zone)
 *   dms_get_palette(id)                 → ColorPalette
 *   dms_upsert_palette(json)            → { ok, id }
 *   dms_delete_palette(id)              → { ok, deleted }
 *   dms_get_palette_as_css(id)          → { css: "--pal-0: #rrggbb; …" }
 *
 * Integration with image pipeline:
 *   Pass colors_json directly to dms_image_to_svg / dms_image_analyze / etc.
 *   as the "palette" argument — the binding layer resolves JSON arrays inline.
 *
 *   Example (frontend):
 *     const pal = await dms_get_palette("acme_brand");
 *     const json_colors = JSON.stringify(pal.colors);  // [{r,g,b},…]
 *     await dms_image_to_svg(JSON.stringify({ path, palette: json_colors }));
 */

#include "../dms_handle.hh"
#include "../core/palette.hh"

namespace pce::dms {

inline void register_palette_bindings(saucer::smartview& wv, DMSHandle& dms,
                                       saucer::modules::desktop& /*desk*/) {
    using std::string;

    // ── dms_get_palettes ──────────────────────────────────────────────────────
    // Returns: { builtin: [...], custom: [...] }
    // builtin  — db8, db16, db32 (generated, not from DB)
    // custom   — project + brand palettes stored in active zone DB
    wv.expose("dms_get_palettes", [&dms]() -> string {
        // Built-ins
        json builtin_arr = json::array();
        for (const auto& p : builtin_palettes())
            builtin_arr.push_back(p.to_json());

        // Zone custom palettes
        json custom_arr = json::array();
        try {
            std::vector<pce::db::Row> rows;
            {
                std::lock_guard lk{dms.db_mutex};
                rows = dms.active_db()
                           .from("zone_palettes")
                           .order_by("kind").order_by("name")
                           .execute();
            }
            for (const auto& row : rows) {
                ColorPalette p;
                p.id          = row.get<std::string>("id");
                p.name        = row.get<std::string>("name");
                p.kind        = palette_kind_from_string(
                                    row.try_get<std::string>("kind").value_or("project"));
                p.description = row.try_get<std::string>("description").value_or("");
                p.created_at  = row.try_get<int64_t>("created_at").value_or(0);
                p.updated_at  = row.try_get<int64_t>("updated_at").value_or(0);
                p.colors      = ColorPalette::colors_from_json(
                                    row.try_get<std::string>("colors_json").value_or("[]"));
                custom_arr.push_back(p.to_json());
            }
        } catch (const std::exception& e) {
            std::print(stderr, "[palette] get_palettes: {}\n", e.what());
        }

        return DMSHandle::ok_str(json{{"builtin", builtin_arr}, {"custom", custom_arr}});
    });

    // ── dms_get_palette ───────────────────────────────────────────────────────
    // id: "db8" | "db16" | "db32" | user-defined slug
    wv.expose("dms_get_palette", [&dms](string id) -> string {
        // Check built-ins first
        for (const auto& p : builtin_palettes())
            if (p.id == id) return DMSHandle::ok_str(p.to_json());

        // Zone DB lookup
        std::optional<pce::db::Row> row;
        {
            std::lock_guard lk{dms.db_mutex};
            row = dms.active_db()
                      .from("zone_palettes").where("id = ?", id).first();
        }
        if (!row) return DMSHandle::err_str(std::format("Palette '{}' not found", id));

        ColorPalette p;
        p.id          = row->get<std::string>("id");
        p.name        = row->get<std::string>("name");
        p.kind        = palette_kind_from_string(
                            row->try_get<std::string>("kind").value_or("project"));
        p.description = row->try_get<std::string>("description").value_or("");
        p.created_at  = row->try_get<int64_t>("created_at").value_or(0);
        p.updated_at  = row->try_get<int64_t>("updated_at").value_or(0);
        p.colors      = ColorPalette::colors_from_json(
                            row->try_get<std::string>("colors_json").value_or("[]"));
        return DMSHandle::ok_str(p.to_json());
    });

    // ── dms_upsert_palette ────────────────────────────────────────────────────
    // arg: JSON { id, name, kind?, description?, colors: [{r,g,b,name?},…] }
    // Colors can also be given as a flat array: [{r,g,b},…]
    // Returns: { ok: true, id, size }
    wv.expose("dms_upsert_palette", [&dms](string arg) -> string {
        ColorPalette p;
        try {
            const auto j = json::parse(arg);
            p = ColorPalette::from_json(j);
        } catch (const std::exception& e) {
            return DMSHandle::err_str(std::format("Invalid palette JSON: {}", e.what()));
        }

        if (p.id.empty())
            return DMSHandle::err_str("palette 'id' is required");
        if (p.name.empty())
            return DMSHandle::err_str("palette 'name' is required");
        if (p.kind == PaletteKind::BuiltIn)
            return DMSHandle::err_str("Cannot overwrite a built-in palette");
        if (p.colors.empty())
            return DMSHandle::err_str("palette must have at least one color");
        if (p.colors.size() > 256)
            return DMSHandle::err_str("palette exceeds 256 color limit");

        // Sanitize ID: lowercase slug, alphanumeric + _ + -
        for (auto& c : p.id)
            c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));

        const auto now = pce::db::now_unix();
        if (p.created_at == 0) p.created_at = now;
        p.updated_at = now;

        try {
            std::lock_guard lk{dms.db_mutex};
            discard(dms.active_db().insert_into("zone_palettes")
                .value("id",          p.id)
                .value("name",        p.name)
                .value("kind",        std::string{palette_kind_name(p.kind)})
                .value("colors_json", p.colors_to_json())
                .value("description", p.description)
                .value("created_at",  p.created_at)
                .value("updated_at",  p.updated_at)
                .on_conflict_replace()
                .execute());
        } catch (const std::exception& e) {
            return DMSHandle::err_str(std::format("DB error: {}", e.what()));
        }

        return DMSHandle::ok_str(json{
            {"ok",   true},
            {"id",   p.id},
            {"size", static_cast<int>(p.colors.size())},
        });
    });

    // ── dms_delete_palette ────────────────────────────────────────────────────
    wv.expose("dms_delete_palette", [&dms](string id) -> string {
        // Guard built-ins
        for (const auto& p : builtin_palettes())
            if (p.id == id)
                return DMSHandle::err_str("Cannot delete a built-in palette");

        int64_t changes = 0;
        try {
            std::lock_guard lk{dms.db_mutex};
            discard(dms.active_db().delete_from("zone_palettes")
                .where("id = ?", id).execute());
            changes = dms.active_db().changes();
        } catch (const std::exception& e) {
            return DMSHandle::err_str(std::format("DB error: {}", e.what()));
        }
        return DMSHandle::ok_str(json{{"ok", true}, {"deleted", changes > 0}});
    });

    // dms_get_palette_as_css
    // Returns a CSS custom-property block for the palette, useful for
    // injecting style colors directly into the webview document style.
    //
    // Example output for a 4-color palette named "acme":
    //   --pal-acme-0: #006aff; --pal-acme-1: #ff6b00; …
    //
    wv.expose("dms_get_palette_as_css", [&dms](string id) -> string {
        // Try built-in
        ColorPalette p;
        bool found = false;
        for (const auto& bp : builtin_palettes())
            if (bp.id == id) { p = bp; found = true; break; }

        if (!found) {
            std::optional<pce::db::Row> row;
            {
                std::lock_guard lk{dms.db_mutex};
                row = dms.active_db().from("zone_palettes").where("id = ?", id).first();
            }
            if (!row) return DMSHandle::err_str(std::format("Palette '{}' not found", id));
            p.id     = row->get<std::string>("id");
            p.colors = ColorPalette::colors_from_json(
                           row->try_get<std::string>("colors_json").value_or("[]"));
        }

        std::string css;
        for (size_t i = 0; i < p.colors.size(); ++i) {
            const auto& c = p.colors[i];
            css += std::format("--pal-{}-{}: {};", p.id, i, c.hex());
            if (!c.name.empty())
                css += std::format(" /* {} */", c.name);
            css += ' ';
        }

        return DMSHandle::ok_str(json{{"id", p.id}, {"css", css},
                                       {"size", static_cast<int>(p.colors.size())}});
    });
}

} // namespace pce::dms

