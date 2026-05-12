#pragma once
/**
 * @file bindings/pdf_bindings.hh
 * @brief SDM document persistence and export bindings.
 *
 * Writes to two tables introduced in migrations v17/v18:
 *   sdm_documents     — block-editor documents; stored in active DB (global or zone).
 *   dms_recent_exports — global export audit log; always written to the global DB.
 *
 * Exposed JS functions:
 *   dms_document_save        uuid, title, blocks_json, styles_json, page_json, zone_name
 *   dms_document_load        uuid
 *   dms_document_list        zone_name, limit
 *   dms_document_delete      uuid
 *   dms_save_pdf             doc_uuid, title, zone_name, export_path
 *   dms_save_html            doc_uuid, title, html_content, zone_name, export_path
 *   dms_get_recent_exports   limit
 *   dms_open_path            path
 */

#include "../dms_handle.hh"
#include "../dms_monadic.hh"
#include <saucer/modules/desktop.hpp>
#include <saucer/modules/pdf.hpp>

#include <chrono>
#include <filesystem>
#include <fstream>

namespace pce::dms {

namespace {

/**
 * @brief Sanitise a document title for use as a filename.
 * @note  Windows is the most restrictive target: `/\\:*?"<>|` are forbidden
 *        and names may not end with a dot or space.
 */
[[nodiscard]] std::string sanitise_filename(std::string_view title) {
    constexpr std::string_view kIllegal = R"(/\:*?"<>|)";
    std::string out;
    out.reserve(title.size());
    for (unsigned char c : title) {
        if (c < 0x20) continue;
        if (kIllegal.find(static_cast<char>(c)) != std::string_view::npos) continue;
        out.push_back(static_cast<char>(c));
    }
    while (!out.empty() && (out.back() == '.' || out.back() == ' '))
        out.pop_back();
    return out;
}

[[nodiscard]] std::string fallback_stem() {
    const auto ymd = std::chrono::year_month_day{
        std::chrono::floor<std::chrono::days>(std::chrono::system_clock::now())};
    return std::format("Draft {:04d}-{:02d}-{:02d}",
        static_cast<int>(ymd.year()),
        static_cast<unsigned>(ymd.month()),
        static_cast<unsigned>(ymd.day()));
}

/**
 * @brief Resolve the output filesystem path for a document export.
 *
 * Priority: (1) @p explicit_path verbatim → (2) @p zone_out_dir base dir →
 * (3) ~/Documents/Syngrafo/ (USERPROFILE on Windows; data/exports/ as last resort).
 *
 * Appends ` (N)` to the stem when a collision is detected.
 */
[[nodiscard]] fs::path resolve_export_path(
    std::string_view title,
    std::string_view ext,
    std::string_view explicit_path,
    std::string_view zone_out_dir)
{
    if (!explicit_path.empty())
        return fs::path{explicit_path};

    fs::path dir;
    if (!zone_out_dir.empty()) {
        dir = fs::path{zone_out_dir};
    } else {
        const char* home = std::getenv("HOME");
        if (!home) home = std::getenv("USERPROFILE");
        dir = home ? fs::path{home} / "Documents" / "Syngrafo"
                   : fs::path{"data"} / "exports";
    }
    std::error_code ec;
    fs::create_directories(dir, ec);

    auto stem = sanitise_filename(title);
    if (stem.empty()) stem = fallback_stem();

    fs::path candidate = dir / (stem + std::string{ext});
    for (int n = 2; fs::exists(candidate); ++n)
        candidate = dir / (stem + " (" + std::to_string(n) + ")" + std::string{ext});
    return candidate;
}

/**
 * @brief  Fetch a zone's out_path from the global DB.
 * @pre    Caller must hold dms.db_mutex.
 * @return The zone's out_path, or an empty string if not found.
 */
[[nodiscard]] std::string fetch_zone_out_path(
    pce::db::Database& db, std::string_view zone_name)
{
    if (zone_name.empty() || zone_name == "global") return {};
    try {
        const auto row = db.from("dms_zones")
                           .where("name = ?", std::string{zone_name})
                           .first();
        return row ? row->get<std::string>("out_path") : std::string{};
    } catch (...) { return {}; }
}

} // namespace

inline void register_pdf_bindings(
    saucer::smartview& wv,
    DMSHandle& dms,
    saucer::modules::pdf& pdf,
    saucer::modules::desktop& desk)
{
    using std::string;

    wv.expose("dms_document_save",
        [&dms](string uuid, string title,
               string blocks_json, string styles_json, string page_json,
               string zone_name) -> string
    {
        try {
            const auto now = pce::db::now_unix();
            std::lock_guard lk{dms.db_mutex};
            auto& db = dms.active_db();
            if (db.from("sdm_documents").where("uuid = ?", uuid).exists()) {
                const int updated = db.update("sdm_documents")
                  .set("title",       title)
                  .set("blocks_json", blocks_json)
                  .set("styles_json", styles_json)
                  .set("page_json",   page_json)
                  .set("zone_name",   zone_name)
                  .set("updated_at",  now)
                  .where("uuid = ?", uuid)
                  .execute();
                if (updated == 0)
                    throw std::runtime_error("document disappeared during update: " + uuid);
            } else {
                const int inserted = db.insert_into("sdm_documents")
                  .value("uuid",        uuid)
                  .value("title",       title)
                  .value("blocks_json", blocks_json)
                  .value("styles_json", styles_json)
                  .value("page_json",   page_json)
                  .value("zone_name",   zone_name)
                  .value("created_at",  now)
                  .value("updated_at",  now)
                  .execute();
                if (inserted <= 0)
                    throw std::runtime_error("insert failed for document: " + uuid);
            }
            return DMSHandle::ok_str(json{{"uuid", uuid}, {"updated_at", now}});
        } catch (const std::exception& e) {
            return DMSHandle::err_str(e.what());
        }
    });

    wv.expose("dms_document_load", [&dms](string uuid) -> string {
        try {
            std::lock_guard lk{dms.db_mutex};
            const auto row = dms.active_db()
                                .from("sdm_documents")
                                .where("uuid = ?", uuid)
                                .first();
            if (!row) return DMSHandle::err_str("document not found: " + uuid);
            return DMSHandle::ok_str(json{
                {"uuid",        row->get<string>("uuid")},
                {"title",       row->get<string>("title")},
                {"blocks_json", row->get<string>("blocks_json")},
                {"styles_json", row->get<string>("styles_json")},
                {"page_json",   row->get<string>("page_json")},
                {"zone_name",   row->get<string>("zone_name")},
                {"created_at",  row->get<int64_t>("created_at")},
                {"updated_at",  row->get<int64_t>("updated_at")},
            });
        } catch (const std::exception& e) {
            return DMSHandle::err_str(e.what());
        }
    });

    wv.expose("dms_document_list", [&dms](string zone_name, int limit) -> string {
        try {
            std::lock_guard lk{dms.db_mutex};
            auto q = dms.active_db().from("sdm_documents").order_by("updated_at", false);
            if (!zone_name.empty() && zone_name != "all")
                q.where("zone_name = ?", zone_name);
            if (limit > 0)
                q.limit(static_cast<int64_t>(limit));
            json out = json::array();
            for (const auto& r : q.execute())
                out.push_back({
                    {"uuid",       r.get<string>("uuid")},
                    {"title",      r.get<string>("title")},
                    {"zone_name",  r.get<string>("zone_name")},
                    {"created_at", r.get<int64_t>("created_at")},
                    {"updated_at", r.get<int64_t>("updated_at")},
                });
            return DMSHandle::ok_str(out);
        } catch (const std::exception& e) {
            return DMSHandle::err_str(e.what());
        }
    });

    wv.expose("dms_document_delete", [&dms](string uuid) -> string {
        try {
            std::lock_guard lk{dms.db_mutex};
            const int n = dms.active_db().delete_from("sdm_documents")
                                         .where("uuid = ?", uuid)
                                         .execute();
            if (n == 0) return DMSHandle::err_str("document not found: " + uuid);
            return DMSHandle::ok_str(json{{"deleted", true}});
        } catch (const std::exception& e) {
            return DMSHandle::err_str(e.what());
        }
    });

    /**
     * @remarks pdf.save() triggers an async WebView snapshot and returns immediately,
     *          before the file has been committed to disk.  The export record is
     *          inserted with file_size = 0 as a sentinel; the frontend can poll the
     *          actual size via dms_open_path or a follow-up stat call once the file
     *          appears.
     *
     * @param width_mm   Physical page width  in millimetres (passed from JS doc.page).
     * @param height_mm  Physical page height in millimetres.
     * @param orientation_str  "portrait" or "landscape" (anything else → portrait).
     *
     * All three have sane defaults so existing callers that omit them continue
     * to work (A4 portrait fallback).
     */
    wv.expose("dms_save_pdf",
        [&dms, &pdf](string doc_uuid, string title, string zone_name, string export_path,
                     double width_mm, double height_mm, string orientation_str) -> string
    {
        try {
            const auto out_dir = [&] {
                std::lock_guard lk{dms.db_mutex};
                return fetch_zone_out_path(dms.db, zone_name);
            }();
            const auto out = resolve_export_path(title, ".pdf", export_path, out_dir);
            {
                std::error_code ec;
                fs::create_directories(out.parent_path(), ec);
            }
            // Convert mm → inches (saucer_pdf uses inches on all backends).
            // Fall back to A4 portrait when the caller supplies zero/negative values.
            constexpr double kMmPerInch = 25.4;
            const double w_in = (width_mm  > 0) ? width_mm  / kMmPerInch : 210.0 / kMmPerInch;
            const double h_in = (height_mm > 0) ? height_mm / kMmPerInch : 297.0 / kMmPerInch;
            const auto layout = (orientation_str == "landscape")
                                    ? saucer::modules::pdf::layout::landscape
                                    : saucer::modules::pdf::layout::portrait;
            pdf.save({
                .file        = out,
                .size        = {.w = w_in, .h = h_in},
                .orientation = layout,
            });
            return DMSHandle::ok_str(
                dms.record_recent_export(out.string(), doc_uuid, title, zone_name, "pdf", int64_t{0})
            );
        } catch (const std::exception& e) {
            return DMSHandle::err_str(e.what());
        }
    });

    wv.expose("dms_save_html",
        [&dms](string doc_uuid, string title, string html_content,
               string zone_name, string export_path) -> string
    {
        try {
            const auto out_dir = [&] {
                std::lock_guard lk{dms.db_mutex};
                return fetch_zone_out_path(dms.db, zone_name);
            }();
            const auto out = resolve_export_path(title, ".html", export_path, out_dir);
            {
                std::error_code ec;
                fs::create_directories(out.parent_path(), ec);
                std::ofstream ofs{out, std::ios::binary};
                if (!ofs) return DMSHandle::err_str("cannot open for writing: " + out.string());
                ofs << html_content;
            }
            std::error_code ec;
            const auto file_size = static_cast<int64_t>(fs::file_size(out, ec));
            return DMSHandle::ok_str(
                dms.record_recent_export(out.string(), doc_uuid, title, zone_name, "html", file_size)
            );
        } catch (const std::exception& e) {
            return DMSHandle::err_str(e.what());
        }
    });

    wv.expose("dms_get_recent_exports", [&dms](int limit) -> string {
        try {
            std::lock_guard lk{dms.db_mutex};
            // Always reads from the global DB — recent exports span all zones.
            auto q = dms.db.from("dms_recent_exports").order_by("exported_at", false);
            if (limit > 0)
                q.limit(static_cast<int64_t>(limit));
            json out = json::array();
            for (const auto& r : q.execute())
                out.push_back({
                    {"id",          r.get<int64_t>("id")},
                    {"doc_uuid",    r.get<string>("doc_uuid")},
                    {"title",       r.get<string>("title")},
                    {"path",        r.get<string>("path")},
                    {"kind",        r.get<string>("kind")},
                    {"zone_name",   r.get<string>("zone_name")},
                    {"exported_at", r.get<int64_t>("exported_at")},
                    {"file_size",   r.get<int64_t>("file_size")},
                });
            return DMSHandle::ok_str(out);
        } catch (const std::exception& e) {
            return DMSHandle::err_str(e.what());
        }
    });

    /**
     * @brief Record a file-based export in the dms_recent_exports audit log.
     *
     * Call this after writing a .sdoc (or any other) export to disk so it
     * appears in the "Recent Exports" list in the UI.
     *
     * @param path       Absolute path to the written file.
     * @param doc_uuid   Document UUID.
     * @param title      Human-readable document title.
     * @param zone_name  Zone name ("global" when not zone-specific).
     * @param kind       Export kind tag, e.g. "sdoc", "html", "pdf".
     *
     * Returns { path, exported_at, file_size } on success.
     */
    wv.expose("dms_record_export",
        [&dms](string path, string doc_uuid, string title,
               string zone_name, string kind) -> string
    {
        using namespace pce::dms;

        // try_invoke wraps a plain-value lambda (returns json, throws on error)
        // so the outer Expected<json> is produced by try_invoke itself — never
        // nest Expected<Expected<T>> by returning Expected from inside.
        return try_invoke([&]() -> json {
            return dms.record_recent_export(path, doc_uuid, title, zone_name, kind);
        })
        .transform([](const json& j) { return DMSHandle::ok_str(j); })
        .value_or(DMSHandle::err_str("record export failed"));
    });

    wv.expose("dms_open_path", [&desk](string path) -> string {
        try {
            // desk.open() takes an RFC 3986 URI; convert bare filesystem paths.
            std::string uri;
            if (path.starts_with("file://") ||
                path.starts_with("http://") ||
                path.starts_with("https://")) {
                uri = path;
            } else {
                auto abs = fs::absolute(fs::path{path}).string();
#ifdef _WIN32
                for (auto& c : abs) if (c == '\\') c = '/';
                uri = "file:///" + abs;
#else
                uri = "file://" + abs;
#endif
            }
            desk.open(uri);
            return DMSHandle::ok_str(json{{"opened", true}});
        } catch (const std::exception& e) {
            return DMSHandle::err_str(e.what());
        }
    });
}

} // namespace pce::dms
