#pragma once
/**
 * @file dms_handle.hh
 * @author Patrick Engel
 * @brief DMSHandle — central DMS state.  Extracted from dms_bindings.hh
 *        so binding sub-headers can include it without pulling in the
 *        entire 4000-line monolith.
 *
 * Owns:
 *   - SQLite database + mutex serialising all DB access
 *   - NLPEngine reference  (keywords / entities / sentiment)
 *   - IOnnxService reference (semantic embeddings; null if ONNX unavailable)
 *   - jthread for background bulk indexing
 *   - atomic webview* for pushing progress events to the frontend
 */

#include "db/database.hh"
#include "dms_monadic.hh"
#include "platform.hh"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <format>
#include <fstream>
#include <memory>
#include <mutex>
#include <optional>
#include <print>
#include <string>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include <nlohmann/json.hpp>
#include <saucer/modules/desktop.hpp>

#ifdef NLP_WITH_ONNX
#  include "nlp/addons/ocr_addon.hh"
#  include "nlp/addons/onnx_addon.hh"
#  include "nlp/addons/platform_services.hh"
#  include "nlp/addons/rectifier_addon.hh"
#endif
#include "nlp/nlp_engine.hh"
#include "nlp/3rdparty/stb_image.h"
#include "image_decode.hh"

#ifdef __APPLE__
#  include <CommonCrypto/CommonKeyDerivation.h>
#  include "keychain_mac.hh"
#endif

namespace fs  = std::filesystem;
using     json = nlohmann::json;

namespace pce::dms {

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: JSON envelope
// ─────────────────────────────────────────────────────────────────────────────

template <typename T>
[[nodiscard]] inline std::string ok_json(const T& data) {
    return nlohmann::json({{"ok", true}, {"data", data}}).dump();
}
[[nodiscard]] inline std::string err_json(const std::string& err) {
    return nlohmann::json({{"ok", false}, {"error", err}}).dump();
}

/// §0  ZoneRow - Zone history / persistence
struct ZoneRow {
    std::string name;
    std::string in_path;
    std::string out_path;
    int64_t     last_visited{};
    std::string description;
    std::string taxonomy_domain;
};

inline void bootstrap_zone_schema(pce::db::Database& db) {
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_zones (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT    NOT NULL,
            in_path          TEXT    NOT NULL UNIQUE,
            out_path         TEXT    NOT NULL,
            last_visited     INTEGER NOT NULL DEFAULT 0,
            password_hashed  TEXT,
            is_encrypted     INTEGER NOT NULL DEFAULT 0,
            description      TEXT    NOT NULL DEFAULT '',
            taxonomy_domain  TEXT    NOT NULL DEFAULT 'General'
        );
    )sql");
    // Additive migrations
    for (const char* sql : {
        "ALTER TABLE dms_zones ADD COLUMN password_hashed TEXT;",
        "ALTER TABLE dms_zones ADD COLUMN is_encrypted INTEGER NOT NULL DEFAULT 0;",
        "ALTER TABLE dms_zones ADD COLUMN description TEXT NOT NULL DEFAULT '';",
        "ALTER TABLE dms_zones ADD COLUMN taxonomy_domain TEXT NOT NULL DEFAULT 'General';",
        "ALTER TABLE dms_zones ADD COLUMN salt_hex TEXT NOT NULL DEFAULT '';"
    }) {
        try { db.exec(sql); } catch (...) {}
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_zones_visited "
            "ON dms_zones (last_visited DESC);");
}

/// §1  MIME / kind helpers

[[nodiscard]] inline std::string mime_for_extension(std::string_view ext) {
    static const std::unordered_map<std::string, std::string> kMap{
        {".txt","text/plain"},{".text","text/plain"},{".md","text/markdown"},
        {".markdown","text/markdown"},{".rst","text/x-rst"},{".csv","text/csv"},
        {".tsv","text/tab-separated-values"},{".html","text/html"},{".htm","text/html"},
        {".xml","text/xml"},{".svg","image/svg+xml"},{".json","application/json"},
        {".yaml","text/yaml"},{".yml","text/yaml"},{".toml","text/toml"},
        {".ini","text/plain"},{".cfg","text/plain"},{".conf","text/plain"},
        {".env","text/plain"},{".log","text/plain"},{".diff","text/x-diff"},
        {".patch","text/x-diff"},{".pdf","application/pdf"},
        {".doc","application/msword"},
        {".docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
        {".jpg","image/jpeg"},{".jpeg","image/jpeg"},{".png","image/png"},
        {".gif","image/gif"},{".bmp","image/bmp"},{".tiff","image/tiff"},
        {".tif","image/tiff"},{".webp","image/webp"},{".ico","image/x-icon"},
        {".heic","image/heic"},{".heif","image/heif"},{".avif","image/avif"},
        {".tga","image/x-tga"},{".mp3","audio/mpeg"},{".wav","audio/wav"},
        {".ogg","audio/ogg"},{".oga","audio/ogg"},{".flac","audio/flac"},
        {".m4a","audio/mp4"},{".aac","audio/aac"},{".opus","audio/ogg; codecs=opus"},
        {".weba","audio/webm"},{".mp4","video/mp4"},{".webm","video/webm"},
        {".ogv","video/ogg"},{".mov","video/quicktime"},
        {".cpp","text/x-c++src"},{".cc","text/x-c++src"},{".cxx","text/x-c++src"},
        {".c","text/x-csrc"},{".h","text/x-chdr"},{".hh","text/x-c++hdr"},
        {".hpp","text/x-c++hdr"},{".py","text/x-python"},{".js","text/javascript"},
        {".ts","text/typescript"},{".jsx","text/jsx"},{".tsx","text/tsx"},
        {".rs","text/x-rustsrc"},{".go","text/x-go"},{".java","text/x-java"},
        {".swift","text/x-swift"},{".kt","text/x-kotlin"},{".rb","text/x-ruby"},
        {".sh","text/x-shellscript"},{".bash","text/x-shellscript"},
        {".zsh","text/x-shellscript"},{".sql","text/x-sql"},{".r","text/x-rsrc"},
        {".tex","text/x-tex"},{".adoc","text/x-asciidoc"},
        {".asciidoc","text/x-asciidoc"},{".css","text/css"},
        {".scss","text/x-scss"},{".sass","text/x-sass"},{".less","text/x-less"},
        {".zip","application/zip"},{".tar","application/x-tar"},
        {".gz","application/gzip"},{".tgz","application/x-compressed-tar"},
        {".bz2","application/x-bzip2"},{".xz","application/x-xz"},
        {".7z","application/x-7z-compressed"},{".rar","application/vnd.rar"},
        {".ttf","font/ttf"},{".otf","font/otf"},{".woff","font/woff"},
        {".woff2","font/woff2"},
    };
    std::string lower;
    lower.reserve(ext.size());
    std::ranges::transform(ext, std::back_inserter(lower),
                           [](unsigned char c){ return (char)std::tolower(c); });
    const auto it = kMap.find(lower);
    return it != kMap.end() ? it->second : "application/octet-stream";
}

[[nodiscard]] inline std::string kind_for_extension(std::string_view ext) {
    std::string e{ext};
    for (auto& c : e) c = (char)std::tolower((unsigned char)c);
    if (e == ".svg") return "vector";
    static const std::unordered_set<std::string> kImage{
        ".jpg",".jpeg",".png",".gif",".bmp",".tiff",".tif",".webp",
        ".heic",".heif",".avif",".tga",".ico"};
    if (kImage.count(e)) return "image";
    static const std::unordered_set<std::string> kVideo{
        ".mp4",".mov",".m4v",".webm",".mkv",".avi",".ogv",".flv",".wmv"};
    if (kVideo.count(e)) return "video";
    static const std::unordered_set<std::string> kAudio{
        ".mp3",".wav",".flac",".m4a",".ogg",".aac",".opus",".wma",".aiff"};
    if (kAudio.count(e)) return "audio";
    static const std::unordered_set<std::string> kDoc{
        ".pdf",".docx",".odt",".rtf",".doc",".pages",".key",".pptx",".xlsx",".odp",".ods"};
    if (kDoc.count(e)) return "document";
    static const std::unordered_set<std::string> kMarkup{".html",".htm",".xhtml",".xml"};
    if (kMarkup.count(e)) return "markup";
    static const std::unordered_set<std::string> kStyle{".css",".scss",".sass",".less"};
    if (kStyle.count(e)) return "style";
    static const std::unordered_set<std::string> kData{
        ".json",".yaml",".yml",".toml",".csv",".sql",".ini",".cfg",".conf",".env"};
    if (kData.count(e)) return "data";
    static const std::unordered_set<std::string> kCode{
        ".cpp",".cc",".cxx",".c",".h",".hh",".hpp",".py",".js",".ts",".jsx",".tsx",
        ".rs",".go",".java",".swift",".kt",".rb",".sh",".bash",".zsh",".r",".tex",
        ".vue",".svelte",".lua",".pl",".php"};
    if (kCode.count(e)) return "code";
    static const std::unordered_set<std::string> kArchive{
        ".zip",".tar",".gz",".tgz",".bz2",".xz",".7z",".rar",".tbz2"};
    if (kArchive.count(e)) return "archive";
    static const std::unordered_set<std::string> kText{
        ".txt",".md",".markdown",".rst",".log",".readme"};
    if (kText.count(e)) return "text";
    return "other";
}

[[nodiscard]] constexpr bool is_indexable_text(std::string_view mime) noexcept {
    return mime.starts_with("text/")
        || mime == "application/json"
        || mime == "application/xml"
        || mime == "image/svg+xml";
}

// ─────────────────────────────────────────────────────────────────────────────
// §2  Text helpers
// ─────────────────────────────────────────────────────────────────────────────

inline std::string strip_html_tags(const std::string& html) {
    std::string result;
    result.reserve(html.size());
    bool in_tag = false;
    for (char c : html) {
        if      (c == '<') { in_tag = true;  result += ' '; }
        else if (c == '>') { in_tag = false; }
        else if (!in_tag)  { result += c; }
    }
    const std::pair<std::string_view, char> ents[] = {
        {"&amp;",'&'},{"&lt;",'<'},{"&gt;",'>'},{"&quot;",'"'},
        {"&apos;","'"[0]},{"&nbsp;",' '}
    };
    for (auto& [seq, ch] : ents) {
        std::string out; out.reserve(result.size());
        std::string_view sv{result}; size_t pos=0, found;
        while ((found=sv.find(seq,pos))!=std::string_view::npos) {
            out.append(sv,pos,found-pos); out+=ch; pos=found+seq.size();
        }
        out.append(sv,pos); result=std::move(out);
    }
    std::string compact; compact.reserve(result.size()); bool prev=true;
    for (char c : result) {
        if (std::isspace((unsigned char)c)) { if (!prev){compact+=' ';prev=true;} }
        else { compact+=c; prev=false; }
    }
    return compact;
}

inline std::string extract_svg_text(const std::string& svg) {
    std::string result;
    static const std::string_view tags[]{"text","tspan","title","desc"};
    for (std::string_view tag : tags) {
        const std::string op = "<" + std::string{tag};
        const std::string cl = "</" + std::string{tag} + ">";
        size_t pos=0, found;
        while ((found=svg.find(op,pos))!=std::string::npos) {
            const size_t te=svg.find('>',found); if(te==std::string::npos) break;
            const size_t cs=te+1, cp=svg.find(cl,cs); if(cp==std::string::npos) break;
            const std::string stripped=strip_html_tags(svg.substr(cs,cp-cs));
            if (!stripped.empty() && !std::all_of(stripped.begin(),stripped.end(),
                [](char c){return std::isspace((unsigned char)c);}))
                result += stripped + ' ';
            pos=cp+cl.size();
        }
    }
    return result.empty() ? "(no text content)" : result;
}

// ─────────────────────────────────────────────────────────────────────────────
// §3  Hash / snippet
// ─────────────────────────────────────────────────────────────────────────────

[[nodiscard]] constexpr uint64_t fnv1a_64(std::string_view s) noexcept {
    constexpr uint64_t kBasis = 14695981039346656037ULL;
    constexpr uint64_t kPrime = 1099511628211ULL;
    uint64_t h = kBasis;
    for (unsigned char c : s) { h ^= uint64_t{c}; h *= kPrime; }
    return h;
}
[[nodiscard]] inline std::string hash_hex(std::string_view s) {
    return std::format("{:016x}", fnv1a_64(s));
}
[[nodiscard]] inline std::string make_snippet(std::string_view content,
                                               size_t max=280) noexcept {
    const auto first = content.find_first_not_of(" \t\r\n");
    if (first==std::string_view::npos) return {};
    content = content.substr(first);
    if (content.size()<=max) return std::string{content};
    auto v = content.substr(0,max);
    if (const auto p=v.rfind(' '); p!=std::string_view::npos) v=v.substr(0,p);
    return std::string{v}+"…";
}

// ─────────────────────────────────────────────────────────────────────────────
// §4  Crypto helpers
// ─────────────────────────────────────────────────────────────────────────────

[[nodiscard]] inline std::string generate_zone_salt() {
    uint8_t buf[32]={};
#ifdef __APPLE__
    arc4random_buf(buf, sizeof(buf));
#else
    std::ifstream f("/dev/urandom",std::ios::binary);
    if (f) f.read(reinterpret_cast<char*>(buf),sizeof(buf));
    else {
        auto tp=std::chrono::high_resolution_clock::now().time_since_epoch().count();
        uint64_t s=static_cast<uint64_t>(tp);
        for (int i=0;i<4;++i){s=s*6364136223846793005ULL+1442695040888963407ULL;std::memcpy(buf+i*8,&s,8);}
    }
#endif
    char hex[65]={};
    for (int i=0;i<32;++i) std::snprintf(hex+i*2,3,"%02x",buf[i]);
    return {hex,64};
}

[[nodiscard]] inline std::string derive_zone_key(std::string_view password,
                                                  std::string_view salt_hex) {
#ifdef __APPLE__
    uint8_t salt[32]={};
    const size_t slen = std::min(salt_hex.size()/2, sizeof(salt));
    for (size_t i=0;i<slen;++i){unsigned bv=0;std::sscanf(salt_hex.data()+i*2,"%02x",&bv);salt[i]=(uint8_t)bv;}
    uint8_t key[32]={};
    CCKeyDerivationPBKDF(kCCPBKDF2,password.data(),password.size(),
                         salt,std::max(slen,size_t{1}),kCCPRFHmacAlgSHA256,200'000,key,sizeof(key));
    char hex[65]={};
    for (int i=0;i<32;++i) std::snprintf(hex+i*2,3,"%02x",key[i]);
    return {hex,64};
#else
    (void)salt_hex;
    uint64_t h=fnv1a_64(password);
    for (int i=0;i<200'000;++i) h=h*6364136223846793005ULL+1442695040888963407ULL;
    const uint64_t b=h^0xdeadbeefcafebabeULL;
    char hex[65]={};
    std::snprintf(hex,   17,"%016llx",(unsigned long long)h);
    std::snprintf(hex+16,17,"%016llx",(unsigned long long)b);
    std::snprintf(hex+32,17,"%016llx",(unsigned long long)(h^b));
    std::snprintf(hex+48,17,"%016llx",(unsigned long long)(h+b));
    return {hex,64};
#endif
}

// §5  File I/O helpers

[[nodiscard]] inline int64_t file_mtime_unix(const fs::path& p) noexcept {
    std::error_code ec;
    const auto ft = fs::last_write_time(p,ec);
    if (ec) return 0;
    // clock_cast is C++20 but not yet in all libc++ builds (e.g. Apple Clang).
    // Portable workaround: compute the delta from file_clock::now() and apply
    // it to system_clock::now().  Accurate to within a few microseconds.
    const auto sys = std::chrono::system_clock::now() +
        std::chrono::duration_cast<std::chrono::system_clock::duration>(
            ft - fs::file_time_type::clock::now());
    return std::chrono::duration_cast<std::chrono::seconds>(
        sys.time_since_epoch()).count();
}

[[nodiscard]] inline Expected<std::string>
safe_read_text(const fs::path& p, size_t max=1u<<20) {
    std::error_code ec;
    const auto sz = fs::file_size(p,ec);
    if (ec) return std::unexpected(std::format("stat '{}': {}",p.string(),ec.message()));
    std::ifstream f{p,std::ios::binary};
    if (!f) return std::unexpected(std::format("open '{}': permission denied",p.string()));
    const size_t rsz = std::min((size_t)sz,max);
    std::string buf(rsz,'\0');
    f.read(buf.data(),(std::streamsize)rsz);
    buf.resize((size_t)f.gcount());
    return buf;
}

[[nodiscard]] inline Expected<std::vector<uint8_t>>
safe_read_binary(const fs::path& p, size_t max=50u*1024u*1024u) {
    std::error_code ec;
    const auto sz = fs::file_size(p,ec);
    if (ec) return std::unexpected(std::format("stat '{}': {}",p.string(),ec.message()));
    if ((size_t)sz>max) return std::unexpected(std::format("'{}' exceeds blob size limit",p.string()));
    std::ifstream f{p,std::ios::binary};
    if (!f) return std::unexpected(std::format("open '{}': permission denied",p.string()));
    std::vector<uint8_t> buf((size_t)sz);
    f.read(reinterpret_cast<char*>(buf.data()),(std::streamsize)sz);
    buf.resize((size_t)f.gcount());
    return buf;
}

// §6  Vector math

[[nodiscard]] inline float
cosine_similarity(std::span<const float> a, std::span<const float> b) noexcept {
    const size_t n = std::min(a.size(),b.size());
    if (!n) return 0.f;
    float dot{},na{},nb{};
    for (size_t i=0;i<n;++i){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}
    const float d=std::sqrt(na)*std::sqrt(nb);
    return d>1e-9f ? dot/d : 0.f;
}

// §7  Schema bootstrap

inline void bootstrap_preferences_schema(pce::db::Database& db) {
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS app_preferences (
            key        TEXT    PRIMARY KEY,
            value      TEXT    NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL DEFAULT 0
        );
    )sql");
}

inline void bootstrap_global_schema(pce::db::Database& db) {
    bootstrap_zone_schema(db);
    bootstrap_preferences_schema(db);
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_ocr_cache (
            path        TEXT    PRIMARY KEY,
            text        TEXT    NOT NULL,
            mtime       INTEGER NOT NULL,
            created_at  INTEGER NOT NULL
        );
    )sql");
}

inline void bootstrap_dms_schema(pce::db::Database& db) {
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_documents (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            path        TEXT    NOT NULL UNIQUE,
            filename    TEXT    NOT NULL DEFAULT '',
            extension   TEXT    NOT NULL DEFAULT '',
            size_bytes  INTEGER NOT NULL DEFAULT 0,
            mtime       INTEGER NOT NULL DEFAULT 0,
            mime_type   TEXT    NOT NULL DEFAULT 'text/plain',
            indexed_at  INTEGER NOT NULL DEFAULT 0,
            text_hash   TEXT    NOT NULL DEFAULT '',
            snippet     TEXT    NOT NULL DEFAULT '',
            origin_path TEXT,
            is_transformed INTEGER DEFAULT 0,
            transform_meta TEXT,
            content_blob BLOB
        );
    )sql");
    for (const char* sql : {
        "ALTER TABLE dms_documents ADD COLUMN content_blob BLOB;",
        "ALTER TABLE dms_documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'other';"
    }) { try { db.exec(sql); } catch (...) {} }

    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_kind    ON dms_documents(kind);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_path    ON dms_documents(path);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_indexed ON dms_documents(indexed_at DESC);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_mime    ON dms_documents(mime_type);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_mtime   ON dms_documents(mtime DESC);");
}

// §8  Palette schema + migration list

/// Creates the zone_palettes table (idempotent).
inline void bootstrap_palette_schema(pce::db::Database& db) {
    db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS zone_palettes (
            id           TEXT    PRIMARY KEY,
            name         TEXT    NOT NULL DEFAULT '',
            kind         TEXT    NOT NULL DEFAULT 'project',
            colors_json  TEXT    NOT NULL DEFAULT '[]',
            description  TEXT    NOT NULL DEFAULT '',
            created_at   INTEGER NOT NULL DEFAULT 0,
            updated_at   INTEGER NOT NULL DEFAULT 0
        );
    )sql");
    db.exec("CREATE INDEX IF NOT EXISTS idx_zone_palettes_kind "
            "ON zone_palettes (kind);");
}

/// Versioned migration list — applied at most once per DB (recorded in schema_migrations).
/// Versions 1–4 cover what the old try-catch ALTER TABLE pattern already achieved.
/// Version 5+ introduces new schema objects.
inline const std::array<pce::db::Migration, 10> kDmsMigrations{{
    {1, "baseline dms + nlp + zone schema",         nullptr},
    {2, "dms_documents: add content_blob",
        "ALTER TABLE dms_documents ADD COLUMN content_blob BLOB;"},
    {3, "dms_documents: add kind",
        "ALTER TABLE dms_documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'other';"},
    {4, "dms_zones: add salt_hex",
        "ALTER TABLE dms_zones ADD COLUMN salt_hex TEXT NOT NULL DEFAULT '';"},
    {5, "zone_palettes table",
        R"sql(
        CREATE TABLE IF NOT EXISTS zone_palettes (
            id           TEXT    PRIMARY KEY,
            name         TEXT    NOT NULL DEFAULT '',
            kind         TEXT    NOT NULL DEFAULT 'project',
            colors_json  TEXT    NOT NULL DEFAULT '[]',
            description  TEXT    NOT NULL DEFAULT '',
            created_at   INTEGER NOT NULL DEFAULT 0,
            updated_at   INTEGER NOT NULL DEFAULT 0
        );
        )sql"},
    {6, "zone_palettes: kind index",
        "CREATE INDEX IF NOT EXISTS idx_zone_palettes_kind ON zone_palettes (kind);"},
    {7, "dms_zones: add description",
        "ALTER TABLE dms_zones ADD COLUMN description TEXT NOT NULL DEFAULT '';"},
    {8, "dms_zones: add taxonomy_domain",
        "ALTER TABLE dms_zones ADD COLUMN taxonomy_domain TEXT NOT NULL DEFAULT 'General';"},
    {9, "dms_documents: ensure indices",
        R"sql(
        CREATE INDEX IF NOT EXISTS idx_dms_doc_kind    ON dms_documents(kind);
        CREATE INDEX IF NOT EXISTS idx_dms_doc_path    ON dms_documents(path);
        CREATE INDEX IF NOT EXISTS idx_dms_doc_indexed ON dms_documents(indexed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_dms_doc_mime    ON dms_documents(mime_type);
        CREATE INDEX IF NOT EXISTS idx_dms_doc_mtime   ON dms_documents(mtime DESC);
        )sql"},
    {10, "app_preferences table",
        R"sql(
        CREATE TABLE IF NOT EXISTS app_preferences (
            key        TEXT    PRIMARY KEY,
            value      TEXT    NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL DEFAULT 0
        );
        )sql"},
}};

// §9  DMSHandle

struct DMSHandle {
    // JSON helpers
    template <typename T>
    [[nodiscard]] static std::string ok_str(const T& data) {
        return nlohmann::json({{"ok",true},{"data",data}}).dump();
    }
    [[nodiscard]] static std::string err_str(const std::string& err) {
        return nlohmann::json({{"ok",false},{"error",err}}).dump();
    }

    // State
    pce::db::Database                                    db;
    std::optional<pce::db::Database>                     zone_db;
    std::string                                          active_zone_name{"global"};
    mutable std::mutex                                   db_mutex;
    std::atomic<bool>                                    bulk_active{false};
    std::jthread                                         bulk_thread;
    pce::nlp::NLPEngine*                                 engine{nullptr};
    std::shared_ptr<pce::nlp::onnx::IOnnxService>        embed_svc;
#ifdef NLP_WITH_ONNX
    std::shared_ptr<pce::nlp::RectifierAddon>            rectifier;
#endif
    std::atomic<saucer::webview*>                        wv_ptr{nullptr};

    //  Construction
    explicit DMSHandle(pce::nlp::NLPEngine& eng,
                       std::shared_ptr<pce::nlp::onnx::IOnnxService> embed = nullptr
#ifdef NLP_WITH_ONNX
                       , std::shared_ptr<pce::nlp::RectifierAddon> rect = nullptr
#endif
                       )
        : db(open_db_()), engine(&eng),
          embed_svc(std::move(embed))
#ifdef NLP_WITH_ONNX
          , rectifier(std::move(rect))
#endif
    {
        bootstrap_global_schema(db);
        bootstrap_dms_schema(db);
        pce::db::bootstrap_nlp_schema(db);
        bootstrap_palette_schema(db);
        pce::db::apply_migrations(db, kDmsMigrations);
        (void)scan_dir("data", false);
        std::print("[dms] global database ready: '{}' (schema v{})\n",
                   fs::absolute(db_path_()).string(),
                   pce::db::current_schema_version(db));
    }
    DMSHandle(const DMSHandle&) = delete;
    DMSHandle& operator=(const DMSHandle&) = delete;
    DMSHandle(DMSHandle&&) = delete;
    DMSHandle& operator=(DMSHandle&&) = delete;
    ~DMSHandle() { bulk_thread.request_stop(); }

    //  Active DB
    pce::db::Database& active_db() { return zone_db ? *zone_db : db; }

    std::string get_active_in_path() const {
        if (active_zone_name == "global" || active_zone_name.empty()) return "data";
        std::lock_guard lk{db_mutex};
        auto row = const_cast<pce::db::Database&>(db)
                       .from("dms_zones").where("name = ?", active_zone_name).first();
        return row ? row->get<std::string>("in_path") : "data";
    }

    [[nodiscard]] Expected<json> scan_dir(std::string_view path_str, bool recursive=false);
    [[nodiscard]] Expected<json> read_file(std::string_view path_str);
    [[nodiscard]] Expected<json> index_document(std::string_view path_str);
    [[nodiscard]] Expected<json> bulk_index_start(std::string_view dir_path);
    void                         bulk_index_stop() noexcept { bulk_thread.request_stop(); }
    [[nodiscard]] Expected<json> search(std::string_view query, int top_k=10);
    [[nodiscard]] Expected<json> index_status();
    [[nodiscard]] Expected<json> get_metadata(std::string_view path_str);
    [[nodiscard]] Expected<json> rectify_document(std::string_view path_str,
                                                   std::optional<std::string> out);
    [[nodiscard]] Expected<json> get_zones();
    [[nodiscard]] Expected<json> upsert_zone(std::string_view name,
                                              std::string_view in_path,
                                              std::string_view out_path,
                                              std::optional<std::string> password={},
                                              std::string_view description="",
                                              std::string_view taxonomy_domain="General");
    [[nodiscard]] Expected<pce::db::Database> open_zone_db(
        std::string_view zone_name,
        std::optional<std::string> password={});
    [[nodiscard]] Expected<json> import_to_zone(std::string path,
                                                 std::string zone_name,
                                                 bool compress=false, bool scan=false);
    [[nodiscard]] Expected<json> file_to_zone(std::string path, std::string zone_name);

    std::string ocr_document(std::string path, std::string zone_name="");

    // ── Internal helpers ──────────────────────────────────────────────────────
    [[nodiscard]] Expected<std::vector<float>> embed_text_(std::string_view text) const;
    [[nodiscard]] Expected<json> index_one_file_(const fs::path& p,
                                                  std::string_view content);
    [[nodiscard]] static json build_result_json_(int64_t doc_id, float score,
                                                  const pce::db::Row& doc,
                                                  const std::optional<pce::db::Row>& note);
    void push_progress_(nlohmann::json ev) const;

    // OCR quality
    static float ocr_alpha_ratio(const std::string& text);
    static std::string ocr_quality(const std::string& text);

    // ── DB path ───────────────────────────────────────────────────────────────
    [[nodiscard]] static fs::path db_path_() {
        if (const char* v=std::getenv("DMS_DB_PATH"); v&&*v) return {v};
        if (const char* v=std::getenv("NLP_DATA_DIR"); v&&*v) return fs::path{v}/"syngrafo.db";
        return fs::path{"data"}/"syngrafo.db";
    }
    [[nodiscard]] static pce::db::Database open_db_() {
        const auto p=db_path_(); std::error_code ec;
        fs::create_directories(p.parent_path(),ec);
        return pce::db::Database::open(p.string());
    }
};

} // namespace pce::dms

