/**
 * ocr_addon_tesseract.cpp — cross-platform OCR via libtesseract.
 *
 * Compiled on non-Apple platforms when Tesseract is found by CMake.
 * Implements pce::nlp::platform::extract_text() with multi-language support.
 *
 * Supported languages by default (if tessdata files are present):
 *   eng — English
 *   deu — German  (apt: tesseract-ocr-deu  | brew: tesseract-lang)
 *   ell — Greek   (apt: tesseract-ocr-ell)
 *
 * tessdata lookup order:
 *   1. TESSDATA_PREFIX environment variable
 *   2. <exe_dir>/../share/tessdata          (bundled layout)
 *   3. <source_dir>/../../../data/tessdata  (dev layout)
 *   4. /usr/share/tesseract-ocr/5/tessdata  (Ubuntu 22+)
 *   5. /usr/share/tessdata                  (older Linux)
 *   6. nullptr (let Tesseract use its compiled-in default)
 */

#include "platform_services.hh"

#include <tesseract/baseapi.h>
#include <leptonica/allheaders.h>

#include <cstdlib>
#include <filesystem>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace pce::nlp::platform {

namespace {

/// Walk candidate tessdata locations and return the first that exists.
std::optional<std::string> find_tessdata() {
    namespace fs = std::filesystem;

    // 1. Explicit env override
    if (const char* env = std::getenv("TESSDATA_PREFIX")) {
        if (fs::exists(env)) return std::string(env);
    }

    // 2. Bundled next to this shared-lib/executable via relative path from __FILE__.
    //    __FILE__ is .../external/nlp/addons/ocr_addon_tesseract.cpp
    //    Bundled layout: <install>/share/tessdata
    {
        const fs::path src_dir = fs::path(__FILE__).parent_path();  // addons/
        const fs::path dev_layout = src_dir / ".." / ".." / ".." / "data" / "tessdata";
        if (fs::exists(dev_layout)) return fs::canonical(dev_layout).string();
    }

    // 3. System paths (Linux distributions)
    for (const char* candidate : {
            "/usr/share/tesseract-ocr/5/tessdata",
            "/usr/share/tesseract-ocr/4/tessdata",
            "/usr/share/tessdata",
            "/usr/local/share/tessdata"}) {
        if (fs::exists(candidate)) return std::string(candidate);
    }

    return std::nullopt;  // let Tesseract use its compiled-in default
}

/// Return an initialised TessBaseAPI* or nullptr on failure.
/// Uses thread_local storage — one instance per worker thread.
tesseract::TessBaseAPI* get_tess() {
    thread_local tesseract::TessBaseAPI* api = nullptr;
    thread_local bool tried = false;

    if (tried) return api;
    tried = true;

    static const std::optional<std::string> tessdata = find_tessdata();
    const char* data_dir = tessdata ? tessdata->c_str() : nullptr;

    // Build a '+'-joined language string from all .traineddata files found in
    // the tessdata directory.  This means every language the user downloaded
    // is automatically used — no hardcoding required.
    auto build_lang_string = [&]() -> std::string {
        // Preferred ordering: Latin-script languages first, then CJK, then others.
        // Tesseract selects the best match per-word when using multiple languages,
        // so order doesn't affect accuracy but does affect init time slightly.
        static const std::vector<std::string> PRIORITY_ORDER = {
            "eng", "deu", "fra", "spa", "ita", "por", "nld", "pol",
            "rus", "ukr", "bel", "ell", "bul", "hrv", "ces", "slk",
            "hun", "ron", "swe", "nor", "dan", "fin",
            "jpn", "jpn_vert",
            "chi_sim", "chi_sim_vert", "chi_tra", "chi_tra_vert",
            "kor", "kor_vert",
            "ara", "heb", "hin", "ben", "tam", "tel", "kan", "mal",
            "tha", "vie", "ind", "msa",
            "tur", "lat", "enm"
        };

        if (!tessdata) return "eng";  // no tessdata dir — Tesseract will use compiled-in default

        namespace fs = std::filesystem;
        std::set<std::string> found_langs;
        std::error_code ec;
        for (const auto& entry : fs::directory_iterator(fs::path{*tessdata}, ec)) {
            const auto fname = entry.path().filename().string();
            if (fname.ends_with(".traineddata")) {
                found_langs.insert(fname.substr(0, fname.size() - 12)); // strip ".traineddata"
            }
        }

        if (found_langs.empty()) return "eng";

        // Start with priority-ordered languages, then append any remaining found ones.
        std::string lang_str;
        std::set<std::string> appended;
        for (const auto& l : PRIORITY_ORDER) {
            if (found_langs.count(l)) {
                if (!lang_str.empty()) lang_str += '+';
                lang_str += l;
                appended.insert(l);
            }
        }
        for (const auto& l : found_langs) {
            if (!appended.count(l)) {
                if (!lang_str.empty()) lang_str += '+';
                lang_str += l;
            }
        }
        return lang_str.empty() ? "eng" : lang_str;
    };

    static const std::string lang_str = build_lang_string();

    api = new tesseract::TessBaseAPI();
    if (api->Init(data_dir, lang_str.c_str(), tesseract::OEM_LSTM_ONLY) == 0) {
        api->SetPageSegMode(tesseract::PSM_AUTO);
        return api;
    }
    // Fallback: English only (always available on any Tesseract install)
    if (api->Init(data_dir, "eng", tesseract::OEM_LSTM_ONLY) == 0) {
        api->SetPageSegMode(tesseract::PSM_AUTO);
        return api;
    }

    delete api;
    api = nullptr;
    return nullptr;
}

}  // namespace

std::string extract_text(const std::string& input_path) {
    tesseract::TessBaseAPI* tess = get_tess();
    if (!tess) {
        return "[OCR error: Tesseract initialisation failed — "
               "make sure tessdata files are installed "
               "(run: python3 scripts/download_models.py download --models tessdata)]";
    }

    Pix* pix = pixRead(input_path.c_str());
    if (!pix) {
        return "[OCR error: could not read image " + input_path + "]";
    }

    tess->SetImage(pix);
    char* raw = tess->GetUTF8Text();
    std::string result = raw ? raw : "";
    delete[] raw;

    tess->Clear();  // release image data, keep model loaded
    pixDestroy(&pix);

    // Trim trailing newlines that Tesseract appends
    while (!result.empty() && (result.back() == '\n' || result.back() == '\r')) {
        result.pop_back();
    }

    return result;
}

std::string extract_text_from_pdf(const std::string& input_path) {
    // Use Leptonica pixRead() which can decode a single-page or first-page PDF
    // when Ghostscript (gs) is installed on the system.
    // For multi-page PDFs only the first page is read this way.
    // A proper multi-page solution requires a PDF page-rendering library (future work).
    return extract_text(input_path);
}

} // namespace pce::nlp::platform

