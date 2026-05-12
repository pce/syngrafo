#pragma once
#include "../../dms_handle.hh"

namespace pce::dms {

inline std::string DMSHandle::ocr_document(std::string path, std::string zone_name) {
    struct OcrPayload {
        fs::path    path;
        long long   mtime{};
        std::string text;
        bool        was_cached{false};
    };

    const fs::path p{path};
    if (!fs::exists(p)) return err_str("File not found: " + path);

    const long long mtime = (long long)fs::last_write_time(p).time_since_epoch().count();

    auto result =
        OcrPayload{p, mtime}

        | stage([&](OcrPayload pl) -> Expected<OcrPayload> {
            auto cached = db.from("dms_ocr_cache").select({"text"})
                             .where("path = ? AND mtime = ?", pl.path.string(), pl.mtime)
                             .first();
            if (cached) {
                pl.text       = cached->get<std::string>("text");
                pl.was_cached = true;
                return pl;
            }
            if (!engine || !engine->has_ocr())
                return std::unexpected(std::string{"OCR engine not available"});

            pl.text = engine->extract_text_from_image(pl.path.string());
            if (pl.text.empty())
                return std::unexpected(std::string{"OCR failed to extract any text"});
            if (pl.text.starts_with("[Error:") || pl.text.starts_with("[error:"))
                return std::unexpected("OCR failed: " + pl.text);

            const auto trimmed = [](std::string s) {
                s.erase(0, s.find_first_not_of(" \t\r\n"));
                const auto e = s.find_last_not_of(" \t\r\n");
                if (e != std::string::npos) s.erase(e + 1);
                return s;
            }(pl.text);
            if (trimmed.size() < 4)
                return std::unexpected(std::string{"__empty__"});

            return pl;
        })

        | stage([&](OcrPayload pl) -> Expected<OcrPayload> {
            if (!pl.was_cached) {
                const auto created = (long long)std::chrono::system_clock::now()
                                         .time_since_epoch().count();
                discard(db.insert_into("dms_ocr_cache")
                             .value("path",       pl.path.string())
                             .value("text",       pl.text)
                             .value("mtime",      pl.mtime)
                             .value("created_at", created)
                             .on_conflict_replace()
                             .execute());
            }
            return pl;
        })

        | stage([&](OcrPayload pl) -> Expected<OcrPayload> {
            discard(index_svc_.index_one(pl.path, pl.text, "ocr"));

            if (!zone_name.empty()) {
                std::optional<pce::db::Row> zr;
                {
                    std::lock_guard lk{db_mutex};
                    zr = db.from("dms_zones").where("name = ?", zone_name).first();
                }
                if (zr) {
                    const fs::path od{zr->get<std::string>("out_path")};
                    if (fs::exists(od) && fs::is_directory(od)) {
                        const fs::path of = od / (p.stem().string() + ".ocr.txt");
                        if (std::ofstream ofs{of}; ofs) {
                            ofs << pl.text;
                            discard(index_document(of.string()));
                        }
                    }
                }
            }
            return pl;
        });

    // The "__empty__" sentinel encodes a clean empty-text result (not an error)
    if (!result && result.error() == "__empty__")
        return ok_str(json{{"text", ""}, {"cached", false}});
    if (!result)
        return err_str(result.error());

    const auto quality = IndexService::ocr_quality(result->text);
    return ok_str(json{
        {"text",     result->text},
        {"cached",   result->was_cached},
        {"quality",  quality},
    });
}

/**
 * @brief Perspective-rectify a document image and re-index the result.
 *
 * Works on all platforms:
 *   - macOS: Apple Vision detects corners; CoreImage or C++ warp applies the transform.
 *   - Linux/Windows + ONNX model loaded: segmentation model detects corners.
 *   - Linux/Windows without ONNX: fails gracefully — no corner detection available.
 */
inline Expected<json> DMSHandle::rectify_document(std::string_view path_str,
                                                    std::optional<std::string> out_path_opt) {
    const fs::path src{path_str};
    std::error_code ec;
    return require(fs::exists(src, ec), std::format("'{}' does not exist", path_str))
        .and_then([&]() -> Expected<json> {
            fs::path out_path;
            if (out_path_opt && !out_path_opt->empty())
                out_path = *out_path_opt;
            else
                out_path = src.parent_path() / (src.stem().string() + ".rectified.jpg");
            if (!rectifier)
                return std::unexpected(std::string{"Rectifier addon not loaded"});
            if (!rectifier->rectify(src.string(), out_path.string()))
                return std::unexpected(std::string{"Rectification failed (no document corners detected)"});
            discard(index_document(out_path.string()));
            return json{{"success", true}, {"outPath", out_path.string()}};
        });
}

} // namespace pce::dms
