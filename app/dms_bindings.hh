#pragma once
/**
 * @file dms_bindings.hh
 * @brief DMS C++23 bindings: scan_dir, read_file, index_document, bulk_index,
 *        search, status and all related JS <-> C++ glue.
 *
 * Provides:
 *   - `pce::dms::DMSHandle`  — owns SQLite DB, NLP refs, and background jthread
 *   - `pce::dms::register_dms_bindings(wv, dms, desk)` — wires bindings via saucer expose()
 *
 * JSON envelope (every exposed function returns `Promise<string>`):
 * @code{.json}
 *   { "ok": true,  "data": <payload> }   // success
 *   { "ok": false, "error": "<message>"} // failure
 * @endcode
 *
 * Exposed bindings:
 *   - `dms_scan_dir(path, recursive)`  -> DirListing
 *   - `dms_read_file(path)`            -> FileContent
 *   - `dms_index_document(path)`       -> IndexResult
 *   - `dms_bulk_index(dir)`            -> { task_id, total_files }
 *   - `dms_bulk_stop()`                -> { stopped: true }
 *   - `dms_search(query, top_k)`       -> SearchResults
 *   - `dms_index_status()`             -> { total_docs, bulk_active, last_indexed_at }
 *   - `dms_get_metadata(path)`         -> DocumentMetadata
 *
 * @note Include only from `app/main.cc` — this is an application-internal header.
 */

#include "db/database.hh"
#include "dms_monadic.hh"
#include "platform.hh"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <unordered_map>
#include <unordered_set>
#include <memory>
#include <nlohmann/json.hpp>
#include <saucer/modules/desktop.hpp>
#include <sstream>
#include <thread>
#include <vector>

#ifdef NLP_WITH_ONNX
#include "nlp/addons/ocr_addon.hh"
#include "nlp/addons/onnx_addon.hh"
#include "nlp/addons/platform_services.hh"
#include "nlp/addons/rectifier_addon.hh"
#endif

#include "nlp/nlp_engine.hh"

// stb_image declaration — implementation is in external/nlp/nlp_engine.cpp
// which defines STB_IMAGE_IMPLEMENTATION before including this header.
#include "nlp/3rdparty/stb_image.h"

// Platform image decoder: decodes any supported format to RGBA8888.
// Apple backend uses ImageIO; non-Apple backend uses stb_image.
#include "image_decode.hh"

#ifdef __APPLE__
#  include <CommonCrypto/CommonKeyDerivation.h>
#endif

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace pce::dms {

// Helper to wrap results in { ok: true, data: T } or { ok: false, error: string
// }
template <typename T> struct nlp_envelope {
  bool ok;
  std::optional<T> data;
  std::optional<std::string> error;

  static nlp_envelope success(T val) {
    return {true, std::move(val), std::nullopt};
  }
  static nlp_envelope fail(std::string err) {
    return {false, std::nullopt, std::move(err)};
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// §0  Zone history and persistence
// ─────────────────────────────────────────────────────────────────────────────

struct Zone {
  std::string name;
  std::string in_path;
  std::string out_path;
  int64_t last_visited;
  std::string description;
  std::string taxonomy_domain;
};

inline void bootstrap_zone_schema(pce::db::Database &db) {
  db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_zones (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT    NOT NULL,
            in_path      TEXT    NOT NULL UNIQUE,
            out_path     TEXT    NOT NULL,
            last_visited INTEGER NOT NULL DEFAULT 0,
            password_hashed TEXT,
            is_encrypted INTEGER NOT NULL DEFAULT 0,
            description      TEXT    NOT NULL DEFAULT '',
            taxonomy_domain  TEXT    NOT NULL DEFAULT 'General'
        );
    )sql");

  // Migration: Add is_encrypted and password_hashed if they don't exist
  try {
    db.exec("ALTER TABLE dms_zones ADD COLUMN password_hashed TEXT;");
  } catch (...) {
  }
  try {
    db.exec("ALTER TABLE dms_zones ADD COLUMN is_encrypted INTEGER NOT NULL "
            "DEFAULT 0;");
  } catch (...) {
  }
  try {
    db.exec("ALTER TABLE dms_zones ADD COLUMN description TEXT NOT NULL "
            "DEFAULT '';");
  } catch (...) {
  }
  try {
    db.exec("ALTER TABLE dms_zones ADD COLUMN taxonomy_domain TEXT NOT NULL "
            "DEFAULT 'General';");
  } catch (...) {
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_dms_zones_visited "
          "ON dms_zones (last_visited DESC);");
}

// ─────────────────────────────────────────────────────────────────────────────
// §1  MIME type helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Extension (any case, with leading dot) → canonical MIME type string.
/// Falls back to "application/octet-stream" for unknown extensions.
[[nodiscard]] inline std::string mime_for_extension(std::string_view ext) {
  static const std::unordered_map<std::string, std::string> kMap{
      // Plain text / markup
      {".txt", "text/plain"},
      {".text", "text/plain"},
      {".md", "text/markdown"},
      {".markdown", "text/markdown"},
      {".rst", "text/x-rst"},
      {".csv", "text/csv"},
      {".tsv", "text/tab-separated-values"},
      {".html", "text/html"},
      {".htm", "text/html"},
      {".xml", "text/xml"},
      {".svg", "image/svg+xml"},
      // Data / config
      {".json", "application/json"},
      {".yaml", "text/yaml"},
      {".yml", "text/yaml"},
      {".toml", "text/toml"},
      {".ini", "text/plain"},
      {".cfg", "text/plain"},
      {".conf", "text/plain"},
      {".env", "text/plain"},
      {".log", "text/plain"},
      {".diff", "text/x-diff"},
      {".patch", "text/x-diff"},
      // Documents (binary — metadata only)
      {".pdf", "application/pdf"},
      {".doc", "application/msword"},
      {".docx", "application/vnd.openxmlformats-officedocument"
                ".wordprocessingml.document"},
      // Images (binary)
      {".jpg", "image/jpeg"},
      {".jpeg", "image/jpeg"},
      {".png", "image/png"},
      {".gif", "image/gif"},
      {".bmp", "image/bmp"},
      {".tiff", "image/tiff"},
      {".tif", "image/tiff"},
      {".webp", "image/webp"},
      {".ico", "image/x-icon"},
      {".heic", "image/heic"},
      {".heif", "image/heif"},
      {".avif", "image/avif"},
      {".tga",  "image/x-tga"},
      // Audio
      {".mp3",  "audio/mpeg"},
      {".wav",  "audio/wav"},
      {".ogg",  "audio/ogg"},
      {".oga",  "audio/ogg"},
      {".flac", "audio/flac"},
      {".m4a",  "audio/mp4"},
      {".aac",  "audio/aac"},
      {".opus", "audio/ogg; codecs=opus"},
      {".weba", "audio/webm"},
      // Video
      {".mp4",  "video/mp4"},
      {".webm", "video/webm"},
      {".ogv",  "video/ogg"},
      {".mov",  "video/quicktime"},
      // Source code — treated as indexable text
      {".cpp", "text/x-c++src"},
      {".cc", "text/x-c++src"},
      {".cxx", "text/x-c++src"},
      {".c", "text/x-csrc"},
      {".h", "text/x-chdr"},
      {".hh", "text/x-c++hdr"},
      {".hpp", "text/x-c++hdr"},
      {".py", "text/x-python"},
      {".js", "text/javascript"},
      {".ts", "text/typescript"},
      {".jsx", "text/jsx"},
      {".tsx", "text/tsx"},
      {".rs", "text/x-rustsrc"},
      {".go", "text/x-go"},
      {".java", "text/x-java"},
      {".swift", "text/x-swift"},
      {".kt", "text/x-kotlin"},
      {".rb", "text/x-ruby"},
      {".sh", "text/x-shellscript"},
      {".bash", "text/x-shellscript"},
      {".zsh", "text/x-shellscript"},
      {".sql", "text/x-sql"},
      {".r", "text/x-rsrc"},
      {".tex", "text/x-tex"},
      {".adoc", "text/x-asciidoc"},
      {".asciidoc", "text/x-asciidoc"},
      // Styles (CSS family)
      {".css",  "text/css"},
      {".scss", "text/x-scss"},
      {".sass", "text/x-sass"},
      {".less", "text/x-less"},
      // Archives
      {".zip",  "application/zip"},
      {".tar",  "application/x-tar"},
      {".gz",   "application/gzip"},
      {".tgz",  "application/x-compressed-tar"},
      {".bz2",  "application/x-bzip2"},
      {".xz",   "application/x-xz"},
      {".7z",   "application/x-7z-compressed"},
      {".rar",  "application/vnd.rar"},
      // Fonts
      {".ttf",  "font/ttf"},
      {".otf",  "font/otf"},
      {".woff", "font/woff"},
      {".woff2","font/woff2"},
  };

  std::string lower;
  lower.reserve(ext.size());
  std::ranges::transform(ext, std::back_inserter(lower), [](unsigned char c) {
    return static_cast<char>(std::tolower(c));
  });

  const auto it = kMap.find(lower);
  return it != kMap.end() ? it->second : "application/octet-stream";
}

/// Extension (any case, with leading dot) → file-kind category string.
/// Matches the FileKind union in the frontend dms-service.ts.
[[nodiscard]] inline std::string kind_for_extension(std::string_view ext) {
  std::string e{ext};
  for (auto &c : e) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));

  if (e == ".svg")  return "vector";

  static const std::unordered_set<std::string> kImage{
    ".jpg",".jpeg",".png",".gif",".bmp",".tiff",".tif",
    ".webp",".heic",".heif",".avif",".tga",".ico"};
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

  static const std::unordered_set<std::string> kMarkup{
    ".html",".htm",".xhtml",".xml"};
  if (kMarkup.count(e)) return "markup";

  static const std::unordered_set<std::string> kStyle{
    ".css",".scss",".sass",".less"};
  if (kStyle.count(e)) return "style";

  static const std::unordered_set<std::string> kData{
    ".json",".yaml",".yml",".toml",".csv",".sql",".ini",".cfg",".conf",".env"};
  if (kData.count(e)) return "data";

  static const std::unordered_set<std::string> kCode{
    ".cpp",".cc",".cxx",".c",".h",".hh",".hpp",
    ".py",".js",".ts",".jsx",".tsx",".rs",".go",
    ".java",".swift",".kt",".rb",".sh",".bash",".zsh",
    ".r",".tex",".vue",".svelte",".lua",".pl",".php"};
  if (kCode.count(e)) return "code";

  static const std::unordered_set<std::string> kArchive{
    ".zip",".tar",".gz",".tgz",".bz2",".xz",".7z",".rar",".tbz2"};
  if (kArchive.count(e)) return "archive";

  static const std::unordered_set<std::string> kText{
    ".txt",".md",".markdown",".rst",".log",".readme"};
  if (kText.count(e)) return "text";

  return "other";
}

// ── Text preprocessing helpers ───────────────────────────────────────────────

/// Strip HTML/XML tags and decode common entities.
/// Replaces every <tag> with a space to preserve word boundaries.
inline std::string strip_html_tags(const std::string& html) {
  std::string result;
  result.reserve(html.size());
  bool in_tag = false;
  for (char c : html) {
    if      (c == '<') { in_tag = true;  result += ' '; }
    else if (c == '>') { in_tag = false; }
    else if (!in_tag)  { result += c; }
  }
  // Decode the five XML predefined entities
  const std::pair<std::string_view, char> ents[] = {
    {"&amp;", '&'}, {"&lt;", '<'}, {"&gt;", '>'}, {"&quot;", '"'}, {"&apos;", '\''},
    {"&nbsp;", ' '}
  };
  for (auto& [seq, ch] : ents) {
    std::string out;
    out.reserve(result.size());
    std::string_view sv{result};
    size_t pos = 0, found;
    while ((found = sv.find(seq, pos)) != std::string_view::npos) {
      out.append(sv, pos, found - pos);
      out += ch;
      pos = found + seq.size();
    }
    out.append(sv, pos);
    result = std::move(out);
  }
  // Collapse runs of whitespace
  std::string compact;
  compact.reserve(result.size());
  bool prev_ws = true;
  for (char c : result) {
    if (std::isspace(static_cast<unsigned char>(c))) {
      if (!prev_ws) { compact += ' '; prev_ws = true; }
    } else { compact += c; prev_ws = false; }
  }
  return compact;
}

/// Extract human-readable text from SVG:
/// collects content of <text>, <tspan>, <title>, <desc> elements.
inline std::string extract_svg_text(const std::string& svg) {
  std::string result;
  static const std::string_view tags[] = {"text", "tspan", "title", "desc"};
  for (std::string_view tag : tags) {
    const std::string open  = "<" + std::string{tag};
    const std::string close = "</" + std::string{tag} + ">";
    size_t pos = 0, found;
    while ((found = svg.find(open, pos)) != std::string::npos) {
      const size_t tag_end = svg.find('>', found);
      if (tag_end == std::string::npos) break;
      const size_t content_start = tag_end + 1;
      const size_t close_pos     = svg.find(close, content_start);
      if (close_pos == std::string::npos) break;
      const std::string raw = svg.substr(content_start, close_pos - content_start);
      const std::string stripped = strip_html_tags(raw);
      if (!stripped.empty() &&
          !std::all_of(stripped.begin(), stripped.end(),
                       [](char c){ return std::isspace(static_cast<unsigned char>(c)); }))
        result += stripped + ' ';
      pos = close_pos + close.size();
    }
  }
  return result.empty() ? "(no text content)" : result;
}

/// True for MIME types whose content is UTF-8 text and can be NLP-indexed.
/// HTML and SVG are also accepted — they are pre-processed by the helpers above.
[[nodiscard]] constexpr bool is_indexable_text(std::string_view mime) noexcept {
  return mime.starts_with("text/")
      || mime == "application/json"
      || mime == "application/xml"
      || mime == "image/svg+xml";   // SVG: text extracted before indexing
}

// ─────────────────────────────────────────────────────────────────────────────
// §2  Hash and snippet helpers
// ─────────────────────────────────────────────────────────────────────────────

/// FNV-1a 64-bit hash — dependency-free, constant-time per byte.
[[nodiscard]] constexpr uint64_t fnv1a_64(std::string_view s) noexcept {
  constexpr uint64_t kBasis = 14695981039346656037ULL;
  constexpr uint64_t kPrime = 1099511628211ULL;
  uint64_t h = kBasis;
  for (const unsigned char c : s) {
    h ^= uint64_t{c};
    h *= kPrime;
  }
  return h;
}

/// Format FNV-1a hash as a 16-character lowercase hex string.
[[nodiscard]] inline std::string hash_hex(std::string_view s) {
  return std::format("{:016x}", fnv1a_64(s));
}

/// Derive a 32-byte AES key from a user password using PBKDF2-HMAC-SHA256.
/// The zone name is used as a deterministic 16-byte salt.
/// Returns a 64-character lowercase hex string suitable for use as a
/// SQLCipher hex passphrase ("x'<64-hex-chars>'").
///
/// @param password   User-supplied password (UTF-8).
/// @param zone_name  Zone name — used as the PBKDF2 salt.
/// @returns 64-char hex key string.
inline std::string derive_zone_key(std::string_view password,
                                   std::string_view zone_name) {
#ifdef __APPLE__
  uint8_t salt[16] = {};
  const size_t salt_copy = std::min(zone_name.size(), sizeof(salt));
  std::memcpy(salt, zone_name.data(), salt_copy);

  uint8_t key[32] = {};
  CCKeyDerivationPBKDF(kCCPBKDF2,
                       password.data(),
                       static_cast<size_t>(password.size()),
                       salt,
                       sizeof(salt),
                       kCCPRFHmacAlgSHA256,
                       100'000,
                       key,
                       sizeof(key));

  char hex[65] = {};
  for (int i = 0; i < 32; ++i)
    std::snprintf(hex + i * 2, 3, "%02x", key[i]);
  return std::string(hex, 64);
#else
  // Non-Apple fallback: iterated FNV-1a expansion.
  // TODO: replace with OpenSSL PKCS5_PBKDF2_HMAC when available.
  (void)zone_name;
  uint64_t h = fnv1a_64(password);
  for (int i = 0; i < 100'000; ++i)
    h = h * 6364136223846793005ULL + 1442695040888963407ULL;
  const uint64_t b = h ^ 0xdeadbeefcafebabeULL;
  char hex[65] = {};
  std::snprintf(hex,      17, "%016llx", (unsigned long long)h);
  std::snprintf(hex + 16, 17, "%016llx", (unsigned long long)b);
  std::snprintf(hex + 32, 17, "%016llx", (unsigned long long)(h ^ b));
  std::snprintf(hex + 48, 17, "%016llx", (unsigned long long)(h + b));
  return std::string(hex, 64);
#endif
}

/// Return at most `max_chars` characters of `content`, snapping to the last
/// word boundary and appending "…" when truncated.
[[nodiscard]] inline std::string
make_snippet(std::string_view content, std::size_t max_chars = 280) noexcept {
  // Strip leading whitespace.
  const auto first = content.find_first_not_of(" \t\r\n");
  if (first == std::string_view::npos)
    return {};
  content = content.substr(first);

  if (content.size() <= max_chars)
    return std::string{content};

  auto v = content.substr(0, max_chars);
  if (const auto pos = v.rfind(' '); pos != std::string_view::npos)
    v = v.substr(0, pos);
  return std::string{v} + "…";
}

// ─────────────────────────────────────────────────────────────────────────────
// §3  File I/O helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Convert fs::file_time_type → Unix seconds since epoch.  Returns 0 on error.
[[nodiscard]] inline int64_t file_mtime_unix(const fs::path &p) noexcept {
  std::error_code ec;
  const auto ft = fs::last_write_time(p, ec);
  if (ec)
    return 0;
  // C++20: file_clock::to_sys() converts to system_clock time_point.
  const auto sys = std::chrono::file_clock::to_sys(ft);
  return std::chrono::duration_cast<std::chrono::seconds>(
             sys.time_since_epoch())
      .count();
}

/// Read a text file up to `max_bytes` into a std::string.
/// Returns Expected<std::string> — an error on stat/open failure.
/// Silently truncates if the file is larger than `max_bytes`.
[[nodiscard]] inline Expected<std::string>
safe_read_text(const fs::path &p,
               std::size_t max_bytes = 1u << 20 /* 1 MiB */) {
  std::error_code ec;
  const auto sz = fs::file_size(p, ec);
  if (ec)
    return std::unexpected(
        std::format("stat '{}': {}", p.string(), ec.message()));

  std::ifstream f{p, std::ios::binary};
  if (!f)
    return std::unexpected(
        std::format("open '{}': permission denied", p.string()));

  const std::size_t read_sz = std::min(static_cast<std::size_t>(sz), max_bytes);
  std::string buf(read_sz, '\0');
  f.read(buf.data(), static_cast<std::streamsize>(read_sz));
  buf.resize(static_cast<std::size_t>(f.gcount()));
  return buf;
}

/// Read a file into a binary vector of bytes.
[[nodiscard]] inline Expected<std::vector<uint8_t>> safe_read_binary(
    const fs::path &p,
    std::size_t max_bytes = 50u * 1024u * 1024u /* 50 MiB threshold */) {
  std::error_code ec;
  const auto sz = fs::file_size(p, ec);
  if (ec)
    return std::unexpected(
        std::format("stat '{}': {}", p.string(), ec.message()));

  if (static_cast<std::size_t>(sz) > max_bytes)
    return std::unexpected(std::format(
        "file '{}' exceeds size limit for blob storage", p.string()));

  std::ifstream f{p, std::ios::binary};
  if (!f)
    return std::unexpected(
        std::format("open '{}': permission denied", p.string()));

  std::vector<uint8_t> buf(static_cast<std::size_t>(sz));
  f.read(reinterpret_cast<char *>(buf.data()),
         static_cast<std::streamsize>(sz));
  buf.resize(static_cast<std::size_t>(f.gcount()));
  return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
// §4  Vector math
// ─────────────────────────────────────────────────────────────────────────────

/// Cosine similarity in [-1, 1].  Mismatched lengths use the shorter span.
/// Returns 0.0f when either norm is near-zero (zero-vector guard).
[[nodiscard]] inline float
cosine_similarity(std::span<const float> a, std::span<const float> b) noexcept {
  const std::size_t n = std::min(a.size(), b.size());
  if (n == 0)
    return 0.0f;

  float dot{}, na{}, nb{};
  for (std::size_t i = 0; i < n; ++i) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const float denom = std::sqrt(na) * std::sqrt(nb);
  return denom > 1e-9f ? dot / denom : 0.0f;
}

// ─────────────────────────────────────────────────────────────────────────────
// §5  DMS SQLite schema bootstrap
// ─────────────────────────────────────────────────────────────────────────────

/// Global-only schema (Zones, OCR Cache, Settings)
inline void bootstrap_global_schema(pce::db::Database &db) {
  bootstrap_zone_schema(db);
  db.exec(R"sql(
        CREATE TABLE IF NOT EXISTS dms_ocr_cache (
            path        TEXT    PRIMARY KEY,
            text        TEXT    NOT NULL,
            mtime       INTEGER NOT NULL,
            created_at  INTEGER NOT NULL
        );
    )sql");
}

/// Create `dms_documents` + indexes if they don't already exist.
/// Safe to call every startup (CREATE TABLE IF NOT EXISTS).
/// Call after pce::db::bootstrap_nlp_schema() to reuse the same Database.
inline void bootstrap_dms_schema(pce::db::Database &db) {
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

  // Migrations: add columns that were introduced after the initial schema.
  try { db.exec("ALTER TABLE dms_documents ADD COLUMN content_blob BLOB;"); }
  catch (...) {}
  try { db.exec("ALTER TABLE dms_documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'other';"); }
  catch (...) {}

  db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_kind ON dms_documents (kind);");

  db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_path    "
          "ON dms_documents (path);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_indexed "
          "ON dms_documents (indexed_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_mime    "
          "ON dms_documents (mime_type);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_dms_doc_mtime   "
          "ON dms_documents (mtime DESC);");
}

// ─────────────────────────────────────────────────────────────────────────────
// §5b  Palette quantization helpers
// ─────────────────────────────────────────────────────────────────────────────
/// Colour-palette helpers for raster → SVG conversion.
/// All functions live in  pce::dms::pal  and are header-only.
namespace pal {

struct RGB3 { uint8_t r, g, b; };
using Palette = std::vector<RGB3>;

// ── DawnBringer 8 ────────────────────────────────────────────────────────────
inline Palette db8() {
  return {
    {0,0,0},{85,65,95},{100,105,100},{215,115,85},
    {80,140,215},{100,185,100},{230,200,110},{220,245,255}
  };
}

// ── DawnBringer 16 ───────────────────────────────────────────────────────────
inline Palette db16() {
  return {
    {20,12,28},{68,36,52},{48,52,109},{78,74,78},
    {133,76,48},{52,101,36},{208,70,72},{117,113,97},
    {89,125,206},{210,125,44},{133,149,161},{109,170,44},
    {210,170,153},{109,194,202},{218,212,94},{222,238,214}
  };
}

// ── DawnBringer 32 ───────────────────────────────────────────────────────────
inline Palette db32() {
  return {
    {0,0,0},{34,32,52},{69,40,60},{102,57,49},
    {143,86,59},{223,113,38},{217,160,102},{238,195,154},
    {251,242,54},{153,229,80},{106,190,48},{55,148,110},
    {75,105,47},{82,75,36},{50,60,57},{63,63,116},
    {48,96,130},{91,110,225},{99,155,255},{95,205,228},
    {203,219,252},{255,255,255},{155,173,183},{132,126,135},
    {105,106,106},{89,86,82},{118,66,138},{172,50,50},
    {217,87,99},{215,123,186},{143,151,74},{138,111,48}
  };
}

// ── Spectrum: N evenly-spaced hues + black + white ───────────────────────────
inline Palette spectrum(int n) {
  Palette p;
  p.reserve(n + 2);
  p.push_back({0,0,0});
  p.push_back({255,255,255});
  for (int i = 0; i < n; ++i) {
    float h = 360.0f * static_cast<float>(i) / static_cast<float>(n);
    float chroma = 1.0f;
    float x = chroma * (1.0f - std::abs(std::fmod(h / 60.0f, 2.0f) - 1.0f));
    float r = 0, g = 0, b = 0;
    if      (h < 60)  { r=chroma; g=x;      }
    else if (h < 120) { r=x;      g=chroma; }
    else if (h < 180) {           g=chroma; b=x;      }
    else if (h < 240) {           g=x;      b=chroma; }
    else if (h < 300) { r=x;                b=chroma; }
    else              { r=chroma;            b=x;      }
    p.push_back({
      static_cast<uint8_t>(r * 255.f + .5f),
      static_cast<uint8_t>(g * 255.f + .5f),
      static_cast<uint8_t>(b * 255.f + .5f)
    });
  }
  return p;
}

// ── Median-cut colour quantization ───────────────────────────────────────────
// Generates a palette of ncolors representative colours from an RGBA image.
// Subsamples to ≤100 k pixels for speed; uses only opaque pixels.
inline Palette median_cut(const uint8_t* rgba, int w, int h, int ncolors) {
  const int total  = w * h;
  const int stride = std::max(1, total / 100'000);
  using C3 = std::array<uint8_t, 3>;
  std::vector<C3> pts;
  pts.reserve(static_cast<size_t>(total / stride + 1));
  for (int i = 0; i < total; i += stride)
    if (rgba[i * 4 + 3] >= 128)
      pts.push_back({rgba[i*4], rgba[i*4+1], rgba[i*4+2]});
  if (pts.empty()) return {{128,128,128}};

  using Bucket = std::vector<C3>;
  std::vector<Bucket> buckets;
  buckets.push_back(std::move(pts));

  while (static_cast<int>(buckets.size()) < ncolors) {
    // Split the bucket with the most points
    int bi = 0;
    for (int i = 1; i < static_cast<int>(buckets.size()); ++i)
      if (buckets[i].size() > buckets[bi].size()) bi = i;
    auto& bkt = buckets[bi];
    if (bkt.size() <= 1) break;

    // Channel with the largest value range
    uint8_t lo[3] = {255,255,255}, hi[3] = {0,0,0};
    for (auto& col : bkt)
      for (int j = 0; j < 3; ++j) {
        lo[j] = std::min(lo[j], col[j]);
        hi[j] = std::max(hi[j], col[j]);
      }
    int axis = 0;
    if (hi[1]-lo[1] > hi[axis]-lo[axis]) axis = 1;
    if (hi[2]-lo[2] > hi[axis]-lo[axis]) axis = 2;

    std::sort(bkt.begin(), bkt.end(),
      [axis](const C3& a, const C3& b){ return a[axis] < b[axis]; });
    const int mid = static_cast<int>(bkt.size()) / 2;
    Bucket half(bkt.begin() + mid, bkt.end());
    bkt.resize(mid);
    buckets.push_back(std::move(half));
  }

  Palette result;
  result.reserve(buckets.size());
  for (auto& bkt : buckets) {
    if (bkt.empty()) continue;
    long sr = 0, sg = 0, sb = 0;
    for (auto& col : bkt) { sr += col[0]; sg += col[1]; sb += col[2]; }
    const int n = static_cast<int>(bkt.size());
    result.push_back({
      static_cast<uint8_t>(sr / n),
      static_cast<uint8_t>(sg / n),
      static_cast<uint8_t>(sb / n)
    });
  }
  return result;
}

// ── Resolve palette from name ─────────────────────────────────────────────────
// Names: "db8" | "db16" | "db32" | "spectrumN" | "autoN" (median-cut).
inline Palette resolve(const std::string& name,
                       const uint8_t* rgba, int w, int h) {
  if (name == "db8")  return db8();
  if (name == "db16") return db16();
  if (name == "db32") return db32();
  if (name.size() >= 8 && name.substr(0, 8) == "spectrum") {
    int n = 14;
    if (name.size() > 8) { try { n = std::stoi(name.substr(8)); } catch (...) {} }
    return spectrum(n);
  }
  // "autoN" (default 16)
  int n = 16;
  if (name.size() > 4 && name.substr(0, 4) == "auto")
    try { n = std::stoi(name.substr(4)); } catch (...) {}
  return median_cut(rgba, w, h, n);
}

// ── Nearest palette colour (min squared Euclidean in RGB) ─────────────────────
inline int nearest(uint8_t r, uint8_t g, uint8_t b, const Palette& p) {
  int best = 0, bestD = INT_MAX;
  for (int i = 0; i < static_cast<int>(p.size()); ++i) {
    const int dr = static_cast<int>(r) - p[i].r;
    const int dg = static_cast<int>(g) - p[i].g;
    const int db = static_cast<int>(b) - p[i].b;
    const int d  = dr*dr + dg*dg + db*db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ── Map every pixel to a palette index (−1 = fully transparent) ──────────────
inline std::vector<int> map_pixels(const uint8_t* rgba,
                                    int w, int h, const Palette& p) {
  const int n = w * h;
  std::vector<int> out(n, -1);
  for (int i = 0; i < n; ++i) {
    if (rgba[i*4 + 3] == 0) continue;
    out[i] = nearest(rgba[i*4], rgba[i*4+1], rgba[i*4+2], p);
  }
  return out;
}

// ── 3×3 majority-vote smoothing ───────────────────────────────────────────────
// Replaces each pixel with the most common palette index in its 3×3
// neighbourhood.  One pass dissolves isolated noise pixels and dramatically
// reduces region count for photographic content.
inline void smooth(std::vector<int>& idx, int w, int h) {
  std::vector<int> out(idx);
  std::unordered_map<int,int> cnt;
  cnt.reserve(64);
  for (int y = 0; y < h; ++y) {
    for (int x = 0; x < w; ++x) {
      if (idx[y*w + x] < 0) continue;
      cnt.clear();
      for (int dy = -1; dy <= 1; ++dy)
        for (int dx = -1; dx <= 1; ++dx) {
          const int nx = x+dx, ny = y+dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const int v = idx[ny*w + nx];
            if (v >= 0) ++cnt[v];
          }
        }
      int best = idx[y*w + x], bestC = 0;
      for (auto& [k, v] : cnt)
        if (v > bestC) { bestC = v; best = k; }
      out[y*w + x] = best;
    }
  }
  idx = std::move(out);
}

} // namespace pal

// ─────────────────────────────────────────────────────────────────────────────
// §6  DMSHandle
// ─────────────────────────────────────────────────────────────────────────────

/// Central DMS state object.  Owns:
///   - SQLite database + mutex serialising all DB access
///   - NLPEngine reference (keyword / entity / sentiment analysis)
///   - IOnnxService reference (semantic embeddings; null if ONNX unavailable)
///   - jthread for background bulk indexing
///   - js_executor callback: set by register_dms_bindings so background tasks
///     can push progress events via webview::execute() (which is thread-safe)
///
/// Thread-safety contract:
///   · Every db.* call acquires db_mutex (pce::db::Database is not
///   thread-safe). · bulk_active is atomic — guards the jthread lifecycle. ·
///   js_executor is written once (at startup) before any background work
///     begins, making it safe to read from the jthread without extra locking.
///   · NLP analysis (engine, embed_svc) is guarded by the respective ONNX
///     addon's internal shared_mutex (see onnx_addon.hh).
struct DMSHandle {
  // Helper functions for common return patterns
  template <typename T> static std::string ok_str(const T &data) {
    return nlohmann::json({{"ok", true}, {"data", data}}).dump();
  }

  static std::string err_str(const std::string &err) {
    return nlohmann::json({{"ok", false}, {"error", err}}).dump();
  }

  // ── Public state ──────────────────────────────────────────────────────────

  pce::db::Database db;                     // Main/Global DB
  std::optional<pce::db::Database> zone_db; // Active Zone DB
  std::string active_zone_name{"global"};
  mutable std::mutex db_mutex;
  std::atomic<bool> bulk_active{false};
  std::jthread bulk_thread;

  /// Non-owning pointer to the application's NLPEngine.
  pce::nlp::NLPEngine *engine{nullptr};

  /// Abstract embedding service
  std::shared_ptr<pce::nlp::onnx::IOnnxService> embed_svc;

  /// Document Rectifier addon
  std::shared_ptr<pce::nlp::RectifierAddon> rectifier;

  /// Raw pointer to the webview — set once by register_dms_bindings()
  /// before any background work starts.  webview::execute() is
  /// [[sc::thread_safe]] so calling it from the bulk-index jthread is safe.
  /// Using a raw pointer avoids std::function's consteval-tainted PCH path.
  std::atomic<saucer::webview *> wv_ptr{nullptr};

  // ── Construction ──────────────────────────────────────────────────────────

  /// @param eng      Reference to the application's NLPEngine (must outlive
  /// this).
  /// @param embed    Optional embedding service (may be nullptr).
  explicit DMSHandle(
      pce::nlp::NLPEngine &eng,
      std::shared_ptr<pce::nlp::onnx::IOnnxService> embed = nullptr,
      std::shared_ptr<pce::nlp::RectifierAddon> rect = nullptr)
      : db(open_db_()), engine(&eng), embed_svc(std::move(embed)),
        rectifier(std::move(rect)) {
    bootstrap_global_schema(db);
    // We only bootstrap document/nlp schemas in the main DB if we want an
    // 'Inbox' that exists in the main DB. The user said main db shouldn't
    // contain indexing for zones. Let's keep a "Global Inbox" in the main DB
    // and Zones isolated.
    bootstrap_dms_schema(db);
    pce::db::bootstrap_nlp_schema(db);

    // Initial scan of the data directory to populate the Global Inbox
    // (This ensures the Inbox starts as the "Input" path)
    (void)scan_dir("data", false);

    std::print("[dms] global database ready: '{}'\n",
               fs::absolute(db_path_()).string());
  }

  // Non-copyable, non-movable (mutex, jthread).
  DMSHandle(const DMSHandle &) = delete;
  DMSHandle &operator=(const DMSHandle &) = delete;
  DMSHandle(DMSHandle &&) = delete;
  DMSHandle &operator=(DMSHandle &&) = delete;

  ~DMSHandle() {
    bulk_thread.request_stop(); // cooperative stop; destructor joins
  }

  /** Get the active database handle (Zone-specific if open, else Global). */
  pce::db::Database &active_db() { return zone_db ? *zone_db : db; }

  /** Get the active input path (Zone-specific in_path if open, else "data"). */
  std::string get_active_in_path() const {
    if (active_zone_name == "global" || active_zone_name.empty()) {
      return "data";
    }
    std::lock_guard lk{db_mutex};
    auto row = const_cast<pce::db::Database &>(db)
                   .from("dms_zones")
                   .where("name = ?", active_zone_name)
                   .first();
    if (row) {
      return row->get<std::string>("in_path");
    }
    return "data";
  }

  /// scan_dir
  /// List one level (or full subtree) of `path_str`.
  /// Entry shape: { name, path, is_dir, size, mtime, mime_type, indexed }
  [[nodiscard]] Expected<json> scan_dir(std::string_view path_str,
                                        bool recursive = false) {
    std::string actual_path{path_str};
    if (actual_path == "global" || actual_path == "input" ||
        actual_path.empty()) {
      actual_path = get_active_in_path();
    }
    const fs::path root{actual_path};

    return require(fs::exists(root),
                   std::format("'{}' does not exist", actual_path))
        .and_then([&]() -> VoidResult {
          return require(fs::is_directory(root),
                         std::format("'{}' is not a directory", path_str));
        })
        .and_then([&]() -> Expected<json> {
          return try_invoke([&]() -> json {
            json items = json::array();
            std::error_code ec;

            // Collect one entry into `items`.
            auto collect = [&](const fs::directory_entry &e) {
              std::error_code e2;
              const bool is_dir = e.is_directory(e2);
              const auto fsize =
                  is_dir ? int64_t{0} : static_cast<int64_t>(e.file_size(e2));
              const auto mtime = file_mtime_unix(e.path());
              const auto ext = e.path().extension().string();
              const auto mime =
                  is_dir ? "inode/directory" : mime_for_extension(ext);

              bool indexed = false;
              if (!is_dir) {
                std::lock_guard lk{db_mutex};
                indexed = active_db()
                              .from("dms_documents")
                              .where("path = ?", e.path().string())
                              .exists();
              }

              items.push_back({
                  {"name", e.path().filename().string()},
                  {"path", e.path().string()},
                  {"is_dir", is_dir},
                  {"size", fsize},
                  {"mtime", mtime},
                  {"mime_type", mime},
                  {"indexed", indexed},
              });
            };

            const auto skip = fs::directory_options::skip_permission_denied;

            if (recursive) {
              for (const auto &e :
                   fs::recursive_directory_iterator(root, skip, ec))
                collect(e);
            } else {
              for (const auto &e : fs::directory_iterator(root, skip, ec))
                collect(e);
            }

            // Directories first, then lexicographic by name.
            // Use std::sort (not std::ranges::sort): nlohmann::json
            // iterators satisfy LegacyRandomAccessIterator but not all
            // std::ranges::sortable requirements on every stdlib version.
            std::sort(items.begin(), items.end(),
                      [](const json &a, const json &b) {
                        const bool is_dir_a = a.value("is_dir", false);
                        const bool is_dir_b = b.value("is_dir", false);
                        if (is_dir_a != is_dir_b)
                          return static_cast<int>(is_dir_a) >
                                 static_cast<int>(is_dir_b);
                        return a.value("name", std::string{}) <
                               b.value("name", std::string{});
                      });

            return json{{"path", root.string()}, {"items", std::move(items)}};
          });
        });
  }

  // ·· read_file ·············································
  // Return file content + metadata.
  // Binary / non-text files: { binary:true, content:null }.
  // Files >10 MiB: { truncated:true }.
  [[nodiscard]] Expected<json> read_file(std::string_view path_str) {
    const fs::path p{path_str};
    std::error_code ec;

    if (!fs::exists(p, ec)) {
      // Attempt to find in database if physical file missing
      std::lock_guard lk{db_mutex};
      auto row = active_db()
                     .from("dms_documents")
                     .where("path = ?", std::string{path_str})
                     .first();
      if (row && !row->is_null("content_blob")) {
        const auto mime = row->get<std::string>("mime_type");
        const auto blob = row->get<std::vector<uint8_t>>("content_blob");
        const bool is_text = is_indexable_text(mime);

        if (!is_text) {
          return json{{"path", std::string{path_str}},
                      {"filename", row->get<std::string>("filename")},
                      {"mime_type", mime},
                      {"size", static_cast<int64_t>(blob.size())},
                      {"mtime", row->get<int64_t>("mtime")},
                      {"content", nullptr},
                      {"line_count", 0},
                      {"truncated", false},
                      {"binary", true},
                      {"from_db", true}};
        }

        std::string content(blob.begin(), blob.end());
        const int lines = static_cast<int>(std::ranges::count(content, '\n') +
                                           (content.empty() ? 0 : 1));
        return json{{"path", std::string{path_str}},
                    {"filename", row->get<std::string>("filename")},
                    {"mime_type", mime},
                    {"size", static_cast<int64_t>(blob.size())},
                    {"mtime", row->get<int64_t>("mtime")},
                    {"content", std::move(content)},
                    {"line_count", lines},
                    {"truncated", false},
                    {"binary", false},
                    {"from_db", true}};
      }

      return std::unexpected(
          std::format("'{}' does not exist on disk or in database", path_str));
    }

    return require(!fs::is_directory(p, ec),
                   std::format("'{}' is a directory", path_str))
        .and_then([&]() -> Expected<json> {
          const auto fsize = static_cast<int64_t>(fs::file_size(p, ec));
          const auto mtime = file_mtime_unix(p);
          const auto mime = mime_for_extension(p.extension().string());

          // Non-text: return metadata only, no content.
          if (!is_indexable_text(mime)) {
            return json{
                {"path", p.string()}, {"filename", p.filename().string()},
                {"mime_type", mime},  {"size", fsize},
                {"mtime", mtime},     {"content", nullptr},
                {"line_count", 0},    {"truncated", false},
                {"binary", true},
            };
          }

          static constexpr std::size_t kMaxRead = 10u * 1024u * 1024u;
          const bool truncated = static_cast<std::size_t>(fsize) > kMaxRead;

          return safe_read_text(p, kMaxRead)
              .transform([&](std::string content) -> json {
                const int lines =
                    static_cast<int>(std::ranges::count(content, '\n') +
                                     (content.empty() ? 0 : 1));
                return json{
                    {"path", p.string()},  {"filename", p.filename().string()},
                    {"mime_type", mime},   {"size", fsize},
                    {"mtime", mtime},      {"content", std::move(content)},
                    {"line_count", lines}, {"truncated", truncated},
                    {"binary", false},
                };
              });
        });
  }

  // ·· index_document ········································
  // Full NLP pipeline for one file: read → analyse → persist → return.
  [[nodiscard]] Expected<json> index_document(std::string_view path_str) {
    const fs::path p{path_str};
    std::error_code ec;
    const auto mime = mime_for_extension(p.extension().string());

    return require(fs::exists(p, ec),
                   std::format("'{}' does not exist", path_str))
        .and_then([&]() -> VoidResult {
          return require(!fs::is_directory(p, ec),
                         std::format("'{}' is a directory", path_str));
        })
        .and_then([&]() -> VoidResult {
          if (is_indexable_text(mime)) return {};
          // Build a helpful, type-specific error message
          std::string hint;
          if (mime.starts_with("image/"))
            hint = std::format("'{}' is an image \u2014 use OCR (\u27f3 button) to extract and index its text.", p.filename().string());
          else if (mime.starts_with("audio/") || mime.starts_with("video/"))
            hint = std::format("'{}' ({}) is a media file and cannot be text-indexed.", p.filename().string(), mime);
          else if (mime == "application/zip" || mime.starts_with("application/x-"))
            hint = std::format("'{}' ({}) is a binary/archive \u2014 extract it first or use Import to register it.", p.filename().string(), mime);
          else
            hint = std::format("'{}' (MIME: {}) is not indexable text.", p.filename().string(), mime);
          return std::unexpected(hint);
        })
        .and_then([&]() -> Expected<json> {
          static constexpr std::size_t kMaxIndex = 1u << 20; // 1 MiB
          return safe_read_text(p, kMaxIndex)
              .and_then([&](std::string content) -> Expected<json> {
                // Pre-process HTML: strip tags before NLP
                std::string processed_content = content;
                if (mime == "text/html" || mime == "text/htm" || mime == "text/xhtml+xml")
                  processed_content = strip_html_tags(content);
                else if (mime == "image/svg+xml")
                  processed_content = extract_svg_text(content);
                return index_one_file_(p, processed_content);
              });
        });
  }

  // ·· bulk_index_start ······································
  // Launch a background jthread that indexes every text file under `dir_path`.
  // Returns immediately with { task_id, total_files }.
  // Progress events are pushed as:
  //   window.__dms_progress({ phase, file, done, total, errors })
  //   phase: "start" | "indexing" | "complete"
  [[nodiscard]] Expected<json> bulk_index_start(std::string_view dir_path) {
    if (bulk_active.exchange(true))
      return std::unexpected(std::string{"bulk index already running"});

    std::string actual_path{dir_path};
    if (actual_path == "global" || actual_path == "input" ||
        actual_path.empty()) {
      actual_path = get_active_in_path();
    }
    const fs::path root{actual_path};
    std::error_code ec;

    if (!fs::exists(root, ec) || !fs::is_directory(root, ec)) {
      bulk_active.store(false);
      return std::unexpected(
          std::format("'{}' is not a directory", actual_path));
    }

    // Enumerate candidate files synchronously (fast — no NLP).
    std::vector<fs::path> candidates;
    const auto skip = fs::directory_options::skip_permission_denied;
    for (const auto &e : fs::recursive_directory_iterator(root, skip, ec)) {
      if (ec) {
        ec.clear();
        continue;
      }
      if (!e.is_regular_file())
        continue;
      if (is_indexable_text(mime_for_extension(e.path().extension().string())))
        candidates.push_back(e.path());
    }

    const int64_t total = static_cast<int64_t>(candidates.size());
    push_progress_(
        {{"phase", "start"}, {"total", total}, {"done", 0}, {"errors", 0}});

    // Launch worker — captures by value so this method can return safely.
    bulk_thread = std::jthread{[this, files = std::move(candidates),
                                total](std::stop_token st) {
      static constexpr std::size_t kMaxIndex = 1u << 20;
      int64_t done{}, errors{};

      for (const auto &p : files) {
        if (st.stop_requested())
          break;

        auto content = safe_read_text(p, kMaxIndex);
        if (!content) {
          ++errors;
          continue;
        }

        if (const auto r = index_one_file_(p, *content); !r) {
          std::print(stderr, "[dms] index '{}': {}\n", p.string(), r.error());
          ++errors;
        }
        ++done;

        // Throttle: emit every 5 files or at end.
        if (done % 5 == 0 || done == total) {
          push_progress_({
              {"phase", "indexing"},
              {"file", p.filename().string()},
              {"done", done},
              {"total", total},
              {"errors", errors},
          });
        }
      }

      push_progress_({
          {"phase", "complete"},
          {"done", done},
          {"total", total},
          {"errors", errors},
      });
      bulk_active.store(false);
    }};

    return json{{"task_id", "bulk_0"}, {"total_files", total}};
  }

  /// Request cooperative cancellation of the current bulk index.
  void bulk_index_stop() noexcept { bulk_thread.request_stop(); }

  // ·· search ················································
  // Semantic search (cosine similarity over stored embeddings) with a
  // keyword LIKE fallback when the ONNX embed model is unavailable.
  //
  // Result shape: { strategy, query, results: SearchResult[] }
  // SearchResult: { doc_id, path, filename, score, snippet,
  //                 mime_type, keywords, sentiment, lang }
  [[nodiscard]] Expected<nlohmann::json> search(std::string_view query_sv,
                                                int top_k = 10) {
    if (top_k <= 0 || top_k > 500)
      top_k = 10;
    const std::string query{query_sv};

    // ── Strategy 1: semantic ─────────────────────────────────────────────
    if (const auto qemb = embed_text_(query_sv); qemb) {
      struct Candidate {
        int64_t doc_id;
        float score;
      };

      // One DB round-trip: load all dms_doc embeddings.
      std::vector<pce::db::Row> emb_rows;
      {
        std::lock_guard lk{db_mutex};
        emb_rows = active_db()
                       .from("nlp_embeddings")
                       .where("row_type = ?", std::string{"dms_doc"})
                       .execute();
      }

      std::vector<Candidate> candidates;
      candidates.reserve(emb_rows.size());
      for (const auto &row : emb_rows) {
        const auto id = row.try_get<int64_t>("row_id").value_or(0);
        const auto vec = pce::db::try_blob_to_floats(row["vector"]);
        if (id == 0 || vec.empty())
          continue;

        candidates.push_back(
            {id, cosine_similarity(std::span{qemb->data(), qemb->size()},
                                   std::span{vec.data(), vec.size()})});
      }

      // Partial-sort: bring the top-k highest scores to the front, O(n log k).
      const auto keep =
          std::min(static_cast<std::size_t>(top_k), candidates.size());
      std::ranges::partial_sort(
          candidates, candidates.begin() + static_cast<std::ptrdiff_t>(keep),
          [](const Candidate &a, const Candidate &b) {
            return a.score > b.score;
          });
      candidates.resize(keep);

      nlohmann::json results = nlohmann::json::array();
      for (const auto &cand : candidates) {
        if (cand.score < 0.10f)
          continue; // noise floor

        std::optional<pce::db::Row> doc_row, note_row;
        {
          std::lock_guard lk{db_mutex};
          doc_row = active_db()
                        .from("dms_documents")
                        .where("id = ?", cand.doc_id)
                        .first();
          note_row = active_db()
                         .from("nlp_notes")
                         .where("row_type = ?", std::string{"dms_doc"})
                         .where("row_id   = ?", cand.doc_id)
                         .order_by("created_at", false)
                         .first();
        }
        if (!doc_row)
          continue;
        results.push_back(
            build_result_json_(cand.doc_id, cand.score, *doc_row, note_row));
      }

      return nlohmann::json({
          {"strategy", "semantic"},
          {"query", query},
          {"results", std::move(results)},
      });
    }

    // ── Strategy 2: keyword LIKE fallback ────────────────────────────────
    std::vector<pce::db::Row> doc_rows;
    {
      std::lock_guard lk{db_mutex};
      doc_rows = active_db()
                     .from("dms_documents")
                     .where("snippet LIKE ?", "%" + query + "%")
                     .limit(static_cast<int64_t>(top_k))
                     .execute();
    }

    nlohmann::json results = nlohmann::json::array();
    for (const auto &row : doc_rows) {
      const auto doc_id = row.try_get<int64_t>("id").value_or(0);
      std::optional<pce::db::Row> note_row;
      {
        std::lock_guard lk{db_mutex};
        note_row = active_db()
                       .from("nlp_notes")
                       .where("row_type = ?", std::string{"dms_doc"})
                       .where("row_id   = ?", doc_id)
                       .order_by("created_at", false)
                       .first();
      }
      results.push_back(build_result_json_(doc_id, 1.0f, row, note_row));
    }

    return nlohmann::json({
        {"strategy", "keyword"},
        {"query", query},
        {"results", std::move(results)},
    });
  }

  // ·· index_status ··········································
  [[nodiscard]] Expected<nlohmann::json> index_status() {
    return try_invoke([&]() -> nlohmann::json {
      int64_t total{}, last_indexed{};
      {
        std::lock_guard lk{db_mutex};
        total = active_db().from("dms_documents").count();

        if (const auto r = active_db()
                               .from("dms_documents")
                               .select({"MAX(indexed_at) AS t"})
                               .first())
          last_indexed = r->try_get<int64_t>("t").value_or(0);
      }
      return nlohmann::json({
          {"total_docs", total},
          {"bulk_active", bulk_active.load()},
          {"last_indexed_at", last_indexed},
          {"active_zone", active_zone_name},
          {"active_in_path", get_active_in_path()},
      });
    });
  }

  // ·· get_metadata ··········································
  // Return all stored metadata for the document at `path_str`.
  [[nodiscard]] Expected<json> get_metadata(std::string_view path_str) {
    std::optional<pce::db::Row> doc_row, note_row, emb_row;
    {
      std::lock_guard lk{db_mutex};
      doc_row = active_db()
                    .from("dms_documents")
                    .where("path = ?", std::string{path_str})
                    .first();

      if (doc_row) {
        const auto id = doc_row->try_get<int64_t>("id").value_or(0);
        note_row = active_db()
                       .from("nlp_notes")
                       .where("row_type = ?", std::string{"dms_doc"})
                       .where("row_id   = ?", id)
                       .order_by("created_at", false)
                       .first();
        emb_row = active_db()
                      .from("nlp_embeddings")
                      .where("row_type = ?", std::string{"dms_doc"})
                      .where("row_id   = ?", id)
                      .first();
      }
    }

    if (!doc_row)
      return std::unexpected(
          std::format("'{}' has not been indexed", path_str));

    const auto id = doc_row->try_get<int64_t>("id").value_or(0);

    auto parse_arr = [](std::string_view s) -> json {
      try {
        return json::parse(s);
      } catch (...) {
        return json::array();
      }
    };

    auto kw_str =
        note_row ? note_row->try_get<std::string>("keywords").value_or("[]")
                 : "[]";
    auto ent_str =
        note_row ? note_row->try_get<std::string>("entities").value_or("[]")
                 : "[]";

    return json{
        {"doc_id", id},
        {"path", doc_row->get<std::string>("path")},
        {"filename", doc_row->get<std::string>("filename")},
        {"extension", doc_row->get<std::string>("extension")},
        {"mime_type", doc_row->get<std::string>("mime_type")},
        {"size_bytes", doc_row->try_get<int64_t>("size_bytes").value_or(0)},
        {"mtime", doc_row->try_get<int64_t>("mtime").value_or(0)},
        {"indexed_at", doc_row->try_get<int64_t>("indexed_at").value_or(0)},
        {"snippet", doc_row->get<std::string>("snippet")},
        {"keywords", parse_arr(kw_str)},
        {"entities", parse_arr(ent_str)},
        {"sentiment",
         note_row ? note_row->try_get<double>("sentiment").value_or(0.0) : 0.0},
        {"sentiment_label",
         note_row ? note_row->try_get<std::string>("sentiment_label")
                        .value_or("neutral")
                  : std::string{"neutral"}},
        {"lang", note_row
                     ? note_row->try_get<std::string>("lang").value_or("en")
                     : std::string{"en"}},
        {"has_embedding", emb_row.has_value()},
        {"dimensions", emb_row
                           ? emb_row->try_get<int64_t>("dimensions").value_or(0)
                           : int64_t{0}},
        {"has_content_blob", doc_row && !doc_row->is_null("content_blob")},
    };
  }

  // ·· rectify_document ·······································
  // Rectify (deskew, denoise) an image document, with optional output path.
  [[nodiscard]] Expected<json>
  rectify_document(std::string_view path_str,
                   std::optional<std::string> out_path_opt) {
    const fs::path src{path_str};
    std::error_code ec;

    return require(fs::exists(src, ec),
                   std::format("'{}' does not exist", path_str))
        .and_then([&]() -> Expected<json> {
          fs::path out_path;
          if (out_path_opt && !out_path_opt->empty()) {
            out_path = *out_path_opt;
          } else {
            // Default: same dir, .rectified.jpg
            out_path =
                src.parent_path() / (src.stem().string() + ".rectified.jpg");
          }

          if (!rectifier) {
            return std::unexpected("Rectifier addon not loaded");
          }

          bool ok = rectifier->rectify(src.string(), out_path.string());
          if (!ok) {
            return std::unexpected("Rectification failed");
          }

          // Index the result
          (void)index_document(out_path.string());

          return json{{"success", true}, {"outPath", out_path.string()}};
        });
  }

  // ·· get_zones ···········································
  [[nodiscard]] Expected<json> get_zones() {
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> json {
      return db.from("dms_zones")
          .order_by("last_visited", false)
          .limit(10)
          .map<json>([](const pce::db::Row &r) {
            return json{
                {"name", r.get<std::string>("name")},
                {"in_path", r.get<std::string>("in_path")},
                {"out_path", r.get<std::string>("out_path")},
                {"last_visited", r.get<int64_t>("last_visited")},
                {"description",
                 r.try_get<std::string>("description").value_or("")},
                {"taxonomy_domain",
                 r.try_get<std::string>("taxonomy_domain").value_or("General")},
                {"is_encrypted",
                 r.try_get<int64_t>("is_encrypted").value_or(0) != 0},
            };
          });
    });
  }

  // ·· upsert_zone ·······································
  [[nodiscard]] Expected<nlohmann::json>
  upsert_zone(std::string_view name, std::string_view in_path,
              std::string_view out_path,
              std::optional<std::string> password = std::nullopt,
              std::string_view description = "",
              std::string_view taxonomy_domain = "General") {
    std::lock_guard lk{db_mutex};
    return try_invoke([&]() -> nlohmann::json {
      const auto now = pce::db::now_unix();
      auto query = db.insert_into("dms_zones")
                       .value("name", std::string{name})
                       .value("in_path", std::string{in_path})
                       .value("out_path", std::string{out_path})
                       .value("last_visited", now)
                       .value("description", std::string{description})
                       .value("taxonomy_domain", std::string{taxonomy_domain});

      if (password && !password->empty()) {
        // Derive a 256-bit key using PBKDF2-HMAC-SHA256 (zone name = salt).
        // The derived hex key is stored as the SQLCipher passphrase so the
        // raw user password never persists on disk.
        const std::string derived = derive_zone_key(*password, name);
        query.value("password_hashed", derived);
        query.value("is_encrypted", 1);
      }

      (void)query.on_conflict_replace().execute();
      return nlohmann::json({{"ok", true}});
    });
  }

  /** Open a zone-specific database. If the zone is encrypted, uses the provided
   * password. */
  [[nodiscard]] Expected<pce::db::Database>
  open_zone_db(std::string_view zone_name,
               std::optional<std::string> password = std::nullopt) {
    if (zone_name == "global" || zone_name == "") {
      // pce::db::Database is move-only. Since this method returns by value,
      // and 'db' is a member that we want to keep, we can't return 'db'
      // directly. However, returning a reference in an Expected is also not
      // ideal. Based on the error, we need to return a Database object. Since
      // Database is move-only and doesn't seem to have a 'clone' or 'copy'
      // functionality (sqlite3* is managed by rule-of-5), we should probably
      // just reopen it using open_db_().
      return open_db_();
    }
    std::optional<pce::db::Row> zone_row;
    {
      std::lock_guard lk{db_mutex};
      zone_row = db.from("dms_zones")
                     .where("name = ?", std::string{zone_name})
                     .first();
    }

    if (!zone_row)
      return std::unexpected(std::format("Zone '{}' not found", zone_name));

    // Zone DB lives in the workspace (out_path), not the source folder (in_path).
    fs::path db_path =
        fs::path{zone_row->get<std::string>("out_path")} / ".papiere.db";

    // Ensure the workspace directory exists before opening.
    {
      std::error_code ec;
      fs::create_directories(db_path.parent_path(), ec);
    }

    bool is_encrypted = zone_row->get<int64_t>("is_encrypted") != 0;

    try {
      if (is_encrypted) {
        std::string key;
        if (password && !password->empty()) {
          // Caller supplied a raw password — re-derive the key so it matches
          // what was stored at creation time.
          key = derive_zone_key(*password,
                                zone_row->get<std::string>("name"));
        } else {
          // Auto-unlock: use the derived key that was stored during creation.
          auto stored =
              zone_row->try_get<std::string>("password_hashed");
          if (!stored || stored->empty()) {
            return std::unexpected(
                std::string{"Encrypted zone has no stored key — "
                            "please provide the password."});
          }
          key = *stored;
        }
        auto zone_db =
            pce::db::Database::open_encrypted(db_path.string(), key);
        bootstrap_dms_schema(zone_db);
        bootstrap_nlp_schema(zone_db);
        return std::move(zone_db);
      } else {
        auto zone_db = pce::db::Database::open(db_path.string());
        bootstrap_dms_schema(zone_db);
        bootstrap_nlp_schema(zone_db);
        return std::move(zone_db);
      }
    } catch (const std::exception &e) {
      return std::unexpected(
          std::format("Failed to open zone DB: {}", e.what()));
    }
  }

  // ── OCR quality helpers ──────────────────────────────────────────────────
  /// Ratio of ASCII letter characters to total non-whitespace characters.
  /// 0.0 = all symbols/digits  1.0 = all letters.
  static float ocr_alpha_ratio(const std::string &text) {
    size_t alpha = 0, total = 0;
    for (unsigned char c : text) {
      if (std::isspace(static_cast<int>(c)))
        continue;
      ++total;
      if (std::isalpha(static_cast<int>(c)))
        ++alpha;
    }
    return total == 0 ? 0.f
                      : static_cast<float>(alpha) / static_cast<float>(total);
  }
  /// "ok" >=0.55 alpha   "low" >=0.30   "garbage" <0.30
  static std::string ocr_quality(const std::string &text) {
    const float r = ocr_alpha_ratio(text);
    if (r >= 0.55f)
      return "ok";
    if (r >= 0.30f)
      return "low";
    return "garbage";
  }

  // ·· ocr_document ·······································
  /** OCR an image file, using cache if available. */
  std::string ocr_document(std::string path, std::string zone_name = "") {
    namespace fs = std::filesystem;
    fs::path p(path);
    if (!fs::exists(p))
      return err_str("File not found: " + path);

    auto mtime = (long long)fs::last_write_time(p).time_since_epoch().count();

    // Check cache
    auto cached = db.from("dms_ocr_cache")
                      .select({"text"})
                      .where("path = ? AND mtime = ?", p.string(), mtime)
                      .first();

    std::string text;
    bool was_cached = false;
    if (cached) {
      text = cached->get<std::string>("text");
      was_cached = true;
      std::print("[dms] OCR cache hit for: {}\n", path);
    } else {
      std::print("[dms] OCR cache miss for: {}, extracting...\n", path);
      if (engine && engine->has_ocr()) {
        text = engine->extract_text_from_image(p.string());
      } else {
        std::print(stderr, "[dms] OCR engine not available\n");
        return err_str("OCR engine not available or not loaded");
      }

      if (text.empty()) {
        std::print(stderr, "[dms] OCR failed (empty result) for: {}\n", path);
        return err_str("OCR failed to extract any text from the image");
      }

      // Guard: discard error-message strings that leaked through the OCR
      // adapter (e.g. "[Error: ...]" from Vision framework failures).
      if (text.rfind("[Error:", 0) == 0 || text.rfind("[error:", 0) == 0) {
        std::print(stderr, "[dms] OCR returned an error string for '{}': {}\n",
                   path, text);
        return err_str("OCR failed: " + text);
      }

      // Require at least a few meaningful characters so we don't index noise
      {
        std::string trimmed = text;
        trimmed.erase(0, trimmed.find_first_not_of(" \t\r\n"));
        trimmed.erase(trimmed.find_last_not_of(" \t\r\n") + 1);
        if (trimmed.size() < 4) {
          std::print(
              "[dms] OCR result too short ({} chars), skipping index for: {}\n",
              trimmed.size(), path);
          return ok_str(json({{"text", ""}, {"cached", false}}));
        }
      }

      std::print("[dms] OCR success, extracted {} chars\n", text.length());

      // Save to cache
      (void)db.insert_into("dms_ocr_cache")
          .value("path", p.string())
          .value("text", text)
          .value("mtime", mtime)
          .value("created_at", (long long)std::chrono::system_clock::now()
                                   .time_since_epoch()
                                   .count())
          .on_conflict_replace()
          .execute();
    }

    // ── Always index the original image using OCR text ────────────────────
    // This ensures get_metadata(original_path) works on every re-open,
    // whether OCR came from cache or was freshly extracted.
    // index_one_file_ is hash-aware: it skips full NLP if content is unchanged.
    if (!text.empty()) {
      (void)index_one_file_(p, text);
    }

    // If zone_name is provided, save the OCR text to the zone's out_path
    if (!zone_name.empty() && !text.empty()) {
      std::optional<pce::db::Row> zone_row;
      {
        std::lock_guard lk{db_mutex};
        zone_row = db.from("dms_zones").where("name = ?", zone_name).first();
      }

      if (zone_row) {
        std::string out_path_str = zone_row->get<std::string>("out_path");
        fs::path out_dir(out_path_str);
        if (fs::exists(out_dir) && fs::is_directory(out_dir)) {
          // Generate output filename: original_name.ocr.txt
          std::string out_name = p.stem().string() + ".ocr.txt";
          fs::path out_file = out_dir / out_name;

          // Write the text to the file
          std::ofstream ofs(out_file);
          if (ofs) {
            ofs << text;
            ofs.close();
            std::print("[dms] OCR saved to: {}\n", out_file.string());

            // Index the new file immediately
            (void)index_document(out_file.string());
          } else {
            std::print(stderr, "[dms] failed to write OCR to {}\n",
                       out_file.string());
          }
        }
      }
    }

    std::string quality = ocr_quality(text);
    std::print("[dms] OCR quality='{}' for: {}\n", quality, path);
    return ok_str(
        json({{"text", text}, {"cached", was_cached}, {"quality", quality}}));
  }

  // ·· import_to_zone ·······································
  /** Strategic move/copy into a zone with optional processing. */
  [[nodiscard]] Expected<json> import_to_zone(std::string path,
                                              std::string zone_name,
                                              bool compress = false,
                                              bool scan = false) {
    namespace fs = std::filesystem;
    fs::path src(path);
    if (!fs::exists(src))
      return std::unexpected(std::format("Source not found: {}", path));

    std::optional<pce::db::Row> zone_row;
    {
      std::lock_guard lk{db_mutex};
      zone_row = db.from("dms_zones").where("name = ?", zone_name).first();
    }
    if (!zone_row)
      return std::unexpected(std::format("Zone '{}' not found", zone_name));

    fs::path out_dir = zone_row->get<std::string>("out_path");
    if (!fs::exists(out_dir))
      fs::create_directories(out_dir);

    fs::path dest = out_dir / src.filename();

    // Strategic move logic: Copy then process
    std::error_code ec;
    fs::copy_file(src, dest, fs::copy_options::overwrite_existing, ec);
    if (ec)
      return std::unexpected(
          std::format("Failed to copy file: {}", ec.message()));

    json meta = json::object();
    meta["import_date"] = pce::db::now_unix();
    meta["original_source"] = path;

    if (scan) {
      // Strategic choice: Use ONNX-based rectifier if available
      std::print("[dms] Applying 'Scan' (rectification) to {}\n",
                 dest.string());
      if (rectifier) {
        // Perform the rectification (replaces old OpenCV-style logic)
        std::string rectified_file =
            (out_dir /
             (src.stem().string() + ".rectified" + src.extension().string()))
                .string();
        if (rectifier->rectify(dest.string(), rectified_file)) {
          // Update destination to point to the rectified one if successful
          fs::remove(dest); // remove original copy if it was just a temp
          dest = fs::path(rectified_file);
          meta["applied_scan"] = true;
        } else {
          std::print(stderr, "[dms] Rectifier failed for: {}\n", dest.string());
        }
      } else {
        std::print(stderr, "[dms] Scan requested but rectifier not loaded\n");
      }
    }

    if (compress) {
      // Placeholder for ffmpeg/ONNX compression
      std::print("[dms] Applying 'Compress' to {}\n", dest.string());
      meta["applied_compression"] = true;
    }

    // Index the imported document
    auto index_res = index_document(dest.string());

    // Update document with origin info if index succeeded
    if (index_res) {
      std::lock_guard lk{db_mutex};
      auto &target_db = active_db();
      (void)target_db.update("dms_documents")
          .set("origin_path", path)
          .set("is_transformed", (compress || scan) ? 1 : 0)
          .set("transform_meta", meta.dump())
          .where("path = ?", dest.string())
          .execute();
    }

    return json({{"ok", true}, {"dest", dest.string()}, {"meta", meta}});
  }

  // ·· file_to_zone ···········································
  /** Move a file from the global Inbox (Global DB) into a specific Zone. */
  [[nodiscard]] Expected<json> file_to_zone(std::string path,
                                            std::string zone_name) {
    namespace fs = std::filesystem;
    fs::path src(path);
    std::error_code ec;

    if (!fs::exists(src, ec))
      return std::unexpected(std::format("Source not found: {}", path));

    // 1. Resolve destination zone info (from Global DB)
    std::optional<pce::db::Row> zone_row;
    {
      std::lock_guard lk{db_mutex};
      zone_row = db.from("dms_zones").where("name = ?", zone_name).first();
    }
    if (!zone_row)
      return std::unexpected(std::format("Zone '{}' not found", zone_name));

    fs::path in_dir = zone_row->get<std::string>("in_path");
    if (!fs::exists(in_dir, ec))
      fs::create_directories(in_dir, ec);

    fs::path dest = in_dir / src.filename();

    // 2. Fetch all metadata from Global DB before moving anything
    std::optional<pce::db::Row> doc_row, note_row, emb_row;
    {
      std::lock_guard lk{db_mutex};
      doc_row = db.from("dms_documents").where("path = ?", path).first();
      if (doc_row) {
        const auto id = doc_row->get<int64_t>("id");
        note_row = db.from("nlp_notes")
                       .where("row_type = 'dms_doc' AND row_id = ?", id)
                       .first();
        emb_row = db.from("nlp_embeddings")
                      .where("row_type = 'dms_doc' AND row_id = ?", id)
                      .first();
      }
    }

    // 3. Move physical file
    fs::rename(src, dest, ec);
    if (ec) {
      // Fallback to copy+delete if rename fails (e.g. across mount points)
      fs::copy_file(src, dest, fs::copy_options::overwrite_existing, ec);
      if (ec)
        return std::unexpected(
            std::format("Failed to move file to zone: {}", ec.message()));
      fs::remove(src, ec);
    }

    // 4. Migrate Database Records (Global DB -> Zone DB)
    auto target_db_res = open_zone_db(zone_name);
    if (!target_db_res)
      return std::unexpected(target_db_res.error());
    auto &target_db = *target_db_res;

    if (doc_row) {
      std::lock_guard lk{db_mutex};
      auto tx = target_db.transaction();

      // Insert into Zone DB
      auto insert_doc =
          target_db.insert_into("dms_documents")
              .value("path", dest.string())
              .value("filename", doc_row->get<std::string>("filename"))
              .value("extension", doc_row->get<std::string>("extension"))
              .value("size_bytes", doc_row->get<int64_t>("size_bytes"))
              .value("mtime", doc_row->get<int64_t>("mtime"))
              .value("mime_type", doc_row->get<std::string>("mime_type"))
              .value("indexed_at", doc_row->get<int64_t>("indexed_at"))
              .value("text_hash", doc_row->get<std::string>("text_hash"))
              .value("snippet", doc_row->get<std::string>("snippet"))
              .value("content_blob",
                     doc_row->try_get<std::vector<uint8_t>>("content_blob")
                         .value_or(std::vector<uint8_t>{}))
              .on_conflict_replace();

      (void)insert_doc.execute();
      int64_t new_id = target_db.last_insert_rowid();

      if (note_row) {
        (void)target_db.insert_into("nlp_notes")
            .value("row_type", "dms_doc")
            .value("row_id", new_id)
            .value("note_text", note_row->get<std::string>("note_text"))
            .value("keywords", note_row->get<std::string>("keywords"))
            .value("entities", note_row->get<std::string>("entities"))
            .value("sentiment", note_row->get<double>("sentiment"))
            .value("sentiment_label",
                   note_row->get<std::string>("sentiment_label"))
            .value("lang", note_row->get<std::string>("lang"))
            .value("created_at", note_row->get<int64_t>("created_at"))
            .execute();
      }

      if (emb_row) {
        (void)target_db.insert_into("nlp_embeddings")
            .value("row_type", "dms_doc")
            .value("row_id", new_id)
            .value("text_hash", emb_row->get<std::string>("text_hash"))
            .value("vector", emb_row->get<std::vector<uint8_t>>("vector"))
            .value("dimensions", emb_row->get<int64_t>("dimensions"))
            .value("snippet", emb_row->get<std::string>("snippet"))
            .value("updated_at", emb_row->get<int64_t>("updated_at"))
            .on_conflict_replace()
            .execute();
      }

      tx.commit();

      // 5. Clean up Global DB
      const auto old_id = doc_row->get<int64_t>("id");
      (void)db.delete_from("dms_documents").where("id = ?", old_id).execute();
      (void)db.delete_from("nlp_notes")
          .where("row_type = 'dms_doc' AND row_id = ?", old_id)
          .execute();
      (void)db.delete_from("nlp_embeddings")
          .where("row_type = 'dms_doc' AND row_id = ?", old_id)
          .execute();
    }

    return json({{"ok", true}, {"dest", dest.string()}});
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /// Attempt to embed `text` using the configured IOnnxService.
  [[nodiscard]] Expected<std::vector<float>>
  embed_text_(std::string_view text) const {
    if (!embed_svc)
      return std::unexpected(std::string{"no embed service configured"});
    if (!embed_svc->is_loaded())
      return std::unexpected(std::string{"embed model not loaded"});
    return try_invoke([&]() -> std::vector<float> {
      auto r = embed_svc->embed(std::string{text});
      if (!r.success || r.vector.empty())
        throw std::runtime_error{"embedding returned empty vector"};
      return std::move(r.vector);
    });
  }

  /// Full NLP pipeline for one file.
  ///
  /// Steps:
  ///   1. Compute content hash; skip expensive NLP re-analysis if unchanged.
  ///   2. Upsert dms_documents.
  ///   3. Extract keywords / entities / sentiment / language (best-effort).
  ///   4. Upsert nlp_notes.
  ///   5. Embed content → upsert nlp_embeddings (if ONNX available).
  ///
  /// All DB writes hold db_mutex for the minimum possible time.
  [[nodiscard]] Expected<json> index_one_file_(const fs::path &p,
                                               std::string_view content) {
    const auto now_ts = pce::db::now_unix();
    const auto hash = hash_hex(content);
    const auto snippet = make_snippet(content);
    const auto mime = mime_for_extension(p.extension().string());

    std::error_code ec;
    const auto fsize = static_cast<int64_t>(fs::file_size(p, ec));
    const auto mtime = file_mtime_unix(p);

    // Read binary content for blob storage
    auto blob_res = safe_read_binary(p);
    std::optional<std::vector<uint8_t>> content_blob;
    if (blob_res) {
      content_blob = std::move(*blob_res);
    }

    // ── Skip re-analysis when content is unchanged ────────────────────────
    {
      std::lock_guard lk{db_mutex};
      const auto existing = active_db()
                                .from("dms_documents")
                                .select({"id", "text_hash"})
                                .where("path = ?", p.string())
                                .first();

      if (existing) {
        const auto stored =
            existing->try_get<std::string>("text_hash").value_or("");
        if (stored == hash) {
          const auto id = existing->try_get<int64_t>("id").value_or(0);
          (void)active_db()
              .update("dms_documents")
              .set("indexed_at", now_ts)
              .where("id = ?", id)
              .execute();
          return json{
              {"doc_id", id},
              {"path", p.string()},
              {"unchanged", true},
          };
        }
      }
    }

    // ── Upsert dms_documents ──────────────────────────────────────────────
    int64_t doc_id = 0;
    {
      std::lock_guard lk{db_mutex};
      auto query = active_db()
                       .insert_into("dms_documents")
                       .value("path", p.string())
                       .value("filename", p.filename().string())
                       .value("extension", p.extension().string())
                       .value("size_bytes", fsize)
                       .value("mtime", mtime)
                       .value("mime_type", mime)
                       .value("kind", kind_for_extension(p.extension().string()))
                       .value("indexed_at", now_ts)
                       .value("text_hash", hash)
                       .value("snippet", snippet);

      if (content_blob) {
        query.value("content_blob", *content_blob);
      }

      (void)query.on_conflict_replace().execute();
      // INSERT OR REPLACE deletes + reinserts → last_insert_rowid is valid.
      doc_id = active_db().last_insert_rowid();
    }
    if (doc_id == 0)
      return std::unexpected(
          std::format("DB upsert failed for '{}'", p.string()));

    // ── NLP analysis — best-effort (individual failures don't abort) ──────
    std::string kw_json = "[]";
    std::string ents_json = "[]";
    double sentiment = 0.0;
    std::string sent_label = "neutral";
    std::string lang = "en";

    if (engine) {
      const std::string text_s{content};

      try {
        kw_json =
            engine->keywords_to_json(engine->extract_keywords(text_s, 15, ""))
                .dump();
      } catch (...) {
      }

      try {
        ents_json =
            engine->entities_to_json(engine->extract_entities(text_s, ""))
                .dump();
      } catch (...) {
      }

      try {
        const auto sr = engine->analyze_sentiment(text_s, "");
        sentiment = static_cast<double>(sr.score);
        sent_label = sr.label;
      } catch (...) {
      }

      try {
        lang = engine->detect_language(text_s).language;
      } catch (...) {
      }
    }

    // ── Upsert nlp_notes ─────────────────────────────────────────────────
    {
      std::lock_guard lk{db_mutex};
      (void)active_db()
          .insert_into("nlp_notes")
          .value("row_type", std::string{"dms_doc"})
          .value("row_id", doc_id)
          .value("note_text", snippet)
          .value("keywords", kw_json)
          .value("entities", ents_json)
          .value("sentiment", sentiment)
          .value("sentiment_label", sent_label)
          .value("lang", lang)
          .value("created_at", now_ts)
          .execute();
    }

    // ── Embed → nlp_embeddings ────────────────────────────────────────────
    std::size_t dims = 0;
    if (const auto emb = embed_text_(content); emb) {
      dims = emb->size();
      const auto blob = pce::db::floats_to_blob(*emb);
      std::lock_guard lk{db_mutex};
      (void)active_db()
          .insert_into("nlp_embeddings")
          .value("row_type", std::string{"dms_doc"})
          .value("row_id", doc_id)
          .value("text_hash", hash)
          .value("vector", blob)
          .value("dimensions", static_cast<int64_t>(dims))
          .value("snippet", snippet)
          .value("updated_at", now_ts)
          .on_conflict_replace()
          .execute();
    }

    // ── Build result JSON ─────────────────────────────────────────────────
    auto parse_arr = [](std::string_view s) -> json {
      try {
        return json::parse(s);
      } catch (...) {
        return json::array();
      }
    };

    return json{
        {"doc_id", doc_id},
        {"path", p.string()},
        {"filename", p.filename().string()},
        {"mime_type", mime},
        {"snippet", snippet},
        {"keywords", parse_arr(kw_json)},
        {"entities", parse_arr(ents_json)},
        {"sentiment", sentiment},
        {"sentiment_label", sent_label},
        {"lang", lang},
        {"dimensions", static_cast<int64_t>(dims)},
        {"indexed_at", now_ts},
        {"unchanged", false},
    };
  }

  /// Build a search-result JSON object from a dms_documents row and an
  /// optional nlp_notes row.  Static so it compiles to a plain call.
  [[nodiscard]] static json
  build_result_json_(int64_t doc_id, float score, const pce::db::Row &doc,
                     const std::optional<pce::db::Row> &note) {
    auto parse_arr = [](std::string_view s) -> json {
      try {
        return json::parse(s);
      } catch (...) {
        return json::array();
      }
    };

    const auto kw_str =
        note ? note->try_get<std::string>("keywords").value_or("[]") : "[]";

    return json{
        {"doc_id", doc_id},
        {"path", doc.get<std::string>("path")},
        {"filename", doc.get<std::string>("filename")},
        {"score", score},
        {"snippet", doc.get<std::string>("snippet")},
        {"mime_type", doc.get<std::string>("mime_type")},
        {"keywords", parse_arr(kw_str)},
        {"sentiment",
         note ? note->try_get<double>("sentiment").value_or(0.0) : 0.0},
        {"lang", note ? note->try_get<std::string>("lang").value_or("en")
                      : std::string{"en"}},
    };
  }

  /// Push a JSON progress event to the webview.
  /// Called from both the main thread and the bulk-index jthread;
  /// webview::execute() is [[sc::thread_safe]] so this is safe.
  void push_progress_(nlohmann::json ev) const {
    saucer::webview *wv = wv_ptr.load(std::memory_order_acquire);
    if (!wv)
      return;
    try {
      wv->execute(std::format("if(typeof window.__dms_progress==='function')"
                              "{{window.__dms_progress({})}}",
                              ev.dump()));
    } catch (...) {
    }
  }

  // ── DB path resolution ────────────────────────────────────────────────────

  /// Resolve the database file path.
  /// Checks $DMS_DB_PATH first, then $NLP_DATA_DIR/syngrafo.db,
  /// then falls back to data/syngrafo.db relative to the working directory.
  [[nodiscard]] static fs::path db_path_() {
    if (const char *v = std::getenv("DMS_DB_PATH"); v && *v)
      return fs::path{v};
    if (const char *v = std::getenv("NLP_DATA_DIR"); v && *v)
      return fs::path{v} / "syngrafo.db";
    return fs::path{"data"} / "syngrafo.db";
  }

  /// Open (or create) the database, ensuring the parent directory exists.
  [[nodiscard]] static pce::db::Database open_db_() {
    const auto p = db_path_();
    std::error_code ec;
    fs::create_directories(p.parent_path(), ec); // best-effort
    return pce::db::Database::open(p.string());
  }
};

// =============================================================================
// §7  register_dms_bindings  —  wire DMSHandle into saucer::smartview
// =============================================================================
//
// Must be called once after the webview is created but before the first
// page load. Sets dms.js_executor so background bulk-index threads can push
// progress events.
//
// All exposed functions follow the same JSON envelope as the nlp_* bindings:
//   success → { "ok": true,  "data": <payload> }
//   failure → { "ok": false, "error": "<message>" }

inline void register_dms_bindings(saucer::smartview &wv, DMSHandle &dms,
                                  saucer::modules::desktop &desk) {
  using std::string;

  // Wire the webview pointer once, before any background work starts.
  // saucer::webview::execute() is [[sc::thread_safe]] — safe from jthread.
  // smartview_base inherits webview, so &wv is a valid webview*.
  dms.wv_ptr.store(&wv, std::memory_order_release);

  // ── dms_scan_dir ──────────────────────────────────────────────────────────
  // dms_scan_dir(path: string, recursive: bool) → DirListing
  // DirListing: { path, items: [ { name, path, is_dir, size, mtime,
  //                                mime_type, indexed } ] }
  wv.expose("dms_scan_dir", [&dms](string path, bool recursive) -> string {
    const auto r = dms.scan_dir(path, recursive);
    if (!r)
      return DMSHandle::err_str(r.error());
    return DMSHandle::ok_str(*r);
  });

  // ── dms_read_file ─────────────────────────────────────────────────────────
  // dms_read_file(path: string) → FileContent
  // FileContent: { path, filename, mime_type, size, mtime, content,
  //                line_count, truncated, binary }
  // binary files: content == null
  wv.expose("dms_read_file", [&dms](string path) -> string {
    const auto r = dms.read_file(path);
    if (!r)
      return DMSHandle::err_str(r.error());
    return DMSHandle::ok_str(*r);
  });

  // Serve a local file as a data: URL (useful for images/PDFs in the frontend).
  // Returns { ok: true, data: "data:<mime>;base64,<...>" } or an error.
  wv.expose("dms_fetch_data_url", [&dms](string path) -> string {
    namespace fs = std::filesystem;
    fs::path p(path);
    if (!fs::exists(p))
      return DMSHandle::err_str(std::format("'{}' does not exist", path));

    // Determine MIME type
    const auto mime = mime_for_extension(p.extension().string());

    // Read file binary
    std::ifstream f(p, std::ios::binary);
    if (!f)
      return DMSHandle::err_str(std::format("failed to open '{}'", path));
    std::string data((std::istreambuf_iterator<char>(f)),
                     std::istreambuf_iterator<char>());

    // Base64 encode
    static const char *tbl =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((data.size() + 2) / 3) * 4);
    size_t i = 0;
    while (i + 2 < data.size()) {
      unsigned a = static_cast<unsigned char>(data[i]);
      unsigned b = static_cast<unsigned char>(data[i + 1]);
      unsigned c = static_cast<unsigned char>(data[i + 2]);
      out.push_back(tbl[(a >> 2) & 0x3F]);
      out.push_back(tbl[((a << 4) | (b >> 4)) & 0x3F]);
      out.push_back(tbl[((b << 2) | (c >> 6)) & 0x3F]);
      out.push_back(tbl[c & 0x3F]);
      i += 3;
    }
    if (i < data.size()) {
      unsigned a = static_cast<unsigned char>(data[i]);
      unsigned b =
          (i + 1 < data.size()) ? static_cast<unsigned char>(data[i + 1]) : 0;
      out.push_back(tbl[(a >> 2) & 0x3F]);
      out.push_back(tbl[((a << 4) | (b >> 4)) & 0x3F]);
      if (i + 1 < data.size()) {
        out.push_back(tbl[((b << 2) & 0x3F)]);
        out.push_back('=');
      } else {
        out.push_back('=');
        out.push_back('=');
      }
    }

    const std::string data_url = std::format("data:{};base64,{}", mime, out);
    return DMSHandle::ok_str(json{{"data_url", data_url}});
  });

  // Extract text from a PDF. First try `pdftotext` (poppler). If unavailable,
  // fall back to rasterising pages with `pdftoppm` and running OCR per page
  // (requires the OCR addon to be available).
  wv.expose("dms_extract_pdf_text", [&dms](string path) -> string {
    namespace fs = std::filesystem;
    fs::path p(path);
    if (!fs::exists(p))
      return DMSHandle::err_str(std::format("'{}' does not exist", path));

    // Try pdftotext -layout <file> -
    std::string output;
    std::string cmd = std::format("pdftotext -layout \"{}\" -", p.string());
    if (FILE *pipe = popen(cmd.c_str(), "r")) {
      std::array<char, 4096> buf;
      while (true) {
        size_t n = fread(buf.data(), 1, buf.size(), pipe);
        if (n == 0)
          break;
        output.append(buf.data(), buf.data() + n);
      }
      int rc = pclose(pipe);
      if (rc == 0 && !output.empty())
        return DMSHandle::ok_str(json{{"text", output}});
    }

    // Fallback: rasterize pages to PNGs using pdftoppm and OCR each page.
    // Requires pdftoppm and the OCR addon.
    if (!dms.engine || !dms.engine->has_ocr())
      return DMSHandle::err_str(
          "pdftotext unavailable and OCR engine not loaded");

    // Create temporary directory
    fs::path tmp = fs::temp_directory_path() /
                   fs::path(std::format(
                       "papiere_pdf_{}",
                       std::to_string(std::hash<std::string>{}(p.string()))));
    fs::create_directories(tmp);
    std::string prefix = (tmp / "page").string();
    std::string cmd2 =
        std::format("pdftoppm -png \"{}\" \"{}\"", p.string(), prefix);
    int rc2 = std::system(cmd2.c_str());
    if (rc2 != 0) {
      // cleanup
      try {
        fs::remove_all(tmp);
      } catch (...) {
      }
      return DMSHandle::err_str("pdftoppm failed to rasterize PDF pages");
    }

    // Collect PNG files
    std::vector<fs::path> pages;
    for (const auto &e : fs::directory_iterator(tmp)) {
      if (e.path().extension() == ".png")
        pages.push_back(e.path());
    }
    std::sort(pages.begin(), pages.end());

    std::string combined;
    for (const auto &img : pages) {
      try {
        const std::string res = dms.ocr_document(img.string());
        // res is a JSON envelope; parse and extract data.text
        try {
          auto j = json::parse(res);
          if (j.contains("ok") && j["ok"].get<bool>()) {
            if (j["data"].contains("text")) {
              combined += j["data"]["text"].get<std::string>();
              combined += "\n\n";
            }
          }
        } catch (...) {
          // ignore parse errors
        }
      } catch (...) {
      }
    }

    try {
      fs::remove_all(tmp);
    } catch (...) {
    }
    if (combined.empty())
      return DMSHandle::err_str("failed to extract text from PDF");
    return DMSHandle::ok_str(json{{"text", combined}});
  });

  // ── dms_file_stats ────────────────────────────────────────────────────────
  // dms_file_stats(path: string) → FileStats
  // FileStats: { path, name, ext, kind, mime, size, mtime, indexed, inDb }
  //
  // Always succeeds for any file that is either on disk or registered in the
  // DB.  DB record is authoritative (handles future blob-only zone files);
  // filesystem stat is the fallback for unregistered files.
  // `indexed` = true only when a full NLP pass has been run (indexed_at > 0).
  wv.expose("dms_file_stats", [&dms](string path_str) -> string {
    namespace fs = std::filesystem;
    const fs::path p{path_str};

    const auto ext  = p.extension().string();
    const auto mime = pce::dms::mime_for_extension(ext);
    const auto kind = pce::dms::kind_for_extension(ext);
    // strip leading dot for the display ext field
    const std::string ext_plain = (!ext.empty() && ext[0] == '.') ? ext.substr(1) : ext;

    // ── 1. Check DB first (authoritative for zone/blob files) ────────────
    std::optional<pce::db::Row> row;
    {
      std::lock_guard lk{dms.db_mutex};
      row = dms.active_db()
                .from("dms_documents")
                .where("path = ?", path_str)
                .first();
    }

    if (row) {
      const int64_t size    = row->try_get<int64_t>("size_bytes").value_or(0);
      const int64_t mtime   = row->try_get<int64_t>("mtime").value_or(0);
      const int64_t idx_at  = row->try_get<int64_t>("indexed_at").value_or(0);
      const std::string db_kind = row->try_get<std::string>("kind").value_or(kind);
      return DMSHandle::ok_str(json{
          {"path",    path_str},
          {"name",    p.filename().string()},
          {"ext",     ext_plain},
          {"kind",    db_kind.empty() ? kind : db_kind},
          {"mime",    mime},
          {"size",    size},
          {"mtime",   mtime},
          {"indexed", idx_at > 0},
          {"inDb",    true},
      });
    }

    // ── 2. Fall back to filesystem stat ──────────────────────────────────
    std::error_code ec;
    if (!fs::exists(p, ec) || !fs::is_regular_file(p, ec))
      return DMSHandle::err_str(
          std::format("'{}' not found on disk or in DB", path_str));

    const int64_t size  = static_cast<int64_t>(fs::file_size(p, ec));
    const int64_t mtime = pce::dms::file_mtime_unix(p);

    return DMSHandle::ok_str(json{
        {"path",    path_str},
        {"name",    p.filename().string()},
        {"ext",     ext_plain},
        {"kind",    kind},
        {"mime",    mime},
        {"size",    size},
        {"mtime",   mtime},
        {"indexed", false},
        {"inDb",    false},
    });
  });

  // ── dms_register_file ────────────────────────────────────────────────────
  // dms_register_file(path: string) → { registered: bool, kind: string }
  //
  // Lightweight DB registration without NLP analysis.  Uses INSERT OR IGNORE
  // so it is idempotent — calling it on an already-indexed file is a no-op.
  // `registered = true`  → newly inserted
  // `registered = false` → record already existed (kind / stats unchanged)
  //
  // Called fire-and-forget from the frontend whenever any file is selected,
  // so that every file that has been viewed is eventually queryable by kind /
  // size / extension even before explicit indexing.
  wv.expose("dms_register_file", [&dms](string path_str) -> string {
    namespace fs = std::filesystem;
    const fs::path p{path_str};
    std::error_code ec;

    if (!fs::exists(p, ec) || !fs::is_regular_file(p, ec)) {
      // May be a DB-only blob — check DB
      std::lock_guard lk{dms.db_mutex};
      auto row = dms.active_db()
                     .from("dms_documents")
                     .where("path = ?", path_str)
                     .first();
      if (row) {
        const std::string k = row->try_get<std::string>("kind")
                                  .value_or(pce::dms::kind_for_extension(
                                      p.extension().string()));
        return DMSHandle::ok_str(
            json{{"registered", false}, {"kind", k}, {"inDb", true}});
      }
      return DMSHandle::err_str(
          std::format("'{}' not found on disk or in DB", path_str));
    }

    const auto ext   = p.extension().string();
    const auto mime  = pce::dms::mime_for_extension(ext);
    const auto kind  = pce::dms::kind_for_extension(ext);
    const int64_t fsize = static_cast<int64_t>(fs::file_size(p, ec));
    const int64_t mtime = pce::dms::file_mtime_unix(p);

    bool newly_registered = false;
    {
      std::lock_guard lk{dms.db_mutex};
      // INSERT OR IGNORE — no-op if path already exists (UNIQUE constraint).
      try {
        (void)dms.active_db()
            .insert_into("dms_documents")
            .value("path",       path_str)
            .value("filename",   p.filename().string())
            .value("extension",  ext)
            .value("size_bytes", fsize)
            .value("mtime",      mtime)
            .value("mime_type",  mime)
            .value("kind",       kind)
            .value("indexed_at", int64_t{0})
            .value("text_hash",  std::string{""})
            .value("snippet",    std::string{""})
            .execute();
        newly_registered = true;
      } catch (...) {
        // Record already existed — that is the expected no-op path.
      }
    }

    return DMSHandle::ok_str(json{
        {"registered", newly_registered},
        {"kind",       kind},
        {"size",       fsize},
        {"mtime",      mtime},
    });
  });

  // ── dms_index_document ────────────────────────────────────────────────────
  // dms_index_document(path: string) → IndexResult
  // IndexResult: { doc_id, path, filename, mime_type, snippet,
  //                keywords[], entities[], sentiment, sentiment_label,
  //                lang, dimensions, indexed_at, unchanged }
  wv.expose("dms_index_document", [&dms](string path) -> string {
    const auto r = dms.index_document(path);
    if (!r)
      return DMSHandle::err_str(r.error());
    return DMSHandle::ok_str(*r);
  });

  // ── dms_bulk_index ────────────────────────────────────────────────────────
  // dms_bulk_index(dir: string) → { task_id, total_files }
  //
  // Returns immediately.  Pushes progress via:
  //   window.__dms_progress({ phase, file, done, total, errors })
  // //   phase: "start" | "indexing" | "complete"
  //
  // To listen: window.__dms_progress = (ev) => { ... }
  // To cancel: call dms_bulk_stop()
  wv.expose("dms_bulk_index", [&dms](string dir) -> string {
    const auto r = dms.bulk_index_start(dir);
    if (!r)
      return DMSHandle::err_str(r.error());
    return DMSHandle::ok_str(*r);
  });

  // ── dms_bulk_index_zone ──────────────────────────────────────────────────────────
  // dms_bulk_index_zone() → { task_id, total_files }
  // Convenience wrapper: triggers bulk indexing on the active zone's out_path.
  // Falls back to the global input path if no zone is active.
  wv.expose("dms_bulk_index_zone", [&dms]() -> string {
    const std::string path = dms.get_active_in_path();
    if (path.empty() || path == "data")
      return DMSHandle::err_str("No active zone — activate a zone first.");
    const auto r = dms.bulk_index_start(path);
    if (!r) return DMSHandle::err_str(r.error());
    return DMSHandle::ok_str(*r);
  });

  // ── dms_bulk_stop ─────────────────────────────────────────────────────────────────
  // dms_bulk_stop() → { stopped: true }
  // Requests cooperative cancellation of the running bulk index.
  wv.expose("dms_bulk_stop", [&dms]() -> string {
    dms.bulk_index_stop();
    return DMSHandle::ok_str(json{{"stopped", true}});
  });

  // ── dms_export_pdf ────────────────────────────────────────────────────────
  // Converts an image to a PDF using platform tools (e.g. sips on macOS).
  wv.expose("dms_export_pdf", [](string src_path, string out_path) -> string {
    namespace fs = std::filesystem;
    fs::path src(src_path);
    if (!fs::exists(src)) {
      return DMSHandle::err_str(std::format("'{}' not found", src_path));
    }

    // On macOS, sips is the easiest way to convert image to pdf without extra
    // deps
#ifdef __APPLE__
    std::string cmd =
        std::format("sips -s format pdf \"{}\" --out \"{}\" > /dev/null 2>&1",
                    src.string(), out_path);
    int rc = std::system(cmd.c_str());
    if (rc == 0 && fs::exists(out_path)) {
      return DMSHandle::ok_str(json{{"success", true}, {"outPath", out_path}});
    }
#endif
    // Fallback or other platforms: if we had a PDF library we'd use it here.
    return DMSHandle::err_str("Export to PDF failed or not supported on this "
                              "platform (requires sips on macOS)");
  });

  // ── dms_image_to_svg ──────────────────────────────────────────────────────
  // dms_image_to_svg(path: string) → { outPath: string }
  // ── dms_image_to_svg ──────────────────────────────────────────────────────
  // dms_image_to_svg(arg) → { outPath, palette, colors }
  //
  // arg: JSON string  { path, palette?, smooth? }  or plain path string.
  //   palette  — "db8" | "db16" | "db32" | "spectrumN" | "autoN"  (default "db16")
  //   smooth   — apply 3×3 majority-vote smoothing pass  (default true)
  //
  // Three-pass pipeline:
  //   1. Quantise : map every pixel to the nearest palette colour.
  //   2. Smooth   : 3×3 majority-vote filter dissolves isolated noise pixels.
  //   3. Render   : greedy width-then-height rect merge; same-colour runs
  //                 collapse into large rectangles → compact SVG output.
  wv.expose("dms_image_to_svg", [](string jsonArg) -> string {
    namespace fs = std::filesystem;

    // ── Parse arguments ────────────────────────────────────────────────────────────
    std::string path;
    std::string paletteName = "db16";
    bool doSmooth = true;
    try {
      auto j   = json::parse(jsonArg);
      path        = j.value("path",    std::string{});
      paletteName = j.value("palette", std::string{"db16"});
      doSmooth    = j.value("smooth",  true);
    } catch (...) {}
    if (path.empty()) path = jsonArg;  // plain-string fallback

    fs::path src(path);
    std::error_code ec;
    if (!fs::exists(src, ec))
      return DMSHandle::err_str(std::format("'{}' does not exist", path));
    if (fs::is_directory(src, ec))
      return DMSHandle::err_str("path is a directory");

    // ── Load image (force RGBA) ───────────────────────────────────────────────────────
    auto img_ = pce::decode_image_to_rgba(src.string());
    if (!img_.ok)
      return DMSHandle::err_str(img_.error);
    const int width    = img_.width;
    const int height   = img_.height;
    const uint8_t* data = img_.pixels.data();
    // No hard pixel-count limit: palette quantisation + greedy rect-merge keeps
    // output compact regardless of input resolution.

    // ── Pass 1 + 2: palette quantisation and smoothing ────────────────────────
    auto palette = pal::resolve(paletteName, data, width, height);
    auto pidx    = pal::map_pixels(data, width, height, palette);
    if (doSmooth) pal::smooth(pidx, width, height);

    // ── Determine output path ───────────────────────────────────────────────────
    // Naming convention: {stem}_rct.svg  (rect mode).
    // If the file already exists, append an incrementing counter.
    fs::path out = src.parent_path() / (src.stem().string() + "_rct.svg");
    for (int _n = 2; fs::exists(out) && _n < 1000; ++_n)
      out = src.parent_path() / (src.stem().string() + "_rct" + std::to_string(_n) + ".svg");

    std::ofstream file(out, std::ios::out | std::ios::trunc);
    if (!file)
      return DMSHandle::err_str(std::format("Cannot write '{}'", out.string()));

    file << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
         << "<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\""
         << " viewBox=\"0 0 " << width << " " << height << "\""
         << " shape-rendering=\"crispEdges\">\n";

    // ── Pass 3: greedy rect merge ───────────────────────────────────────────────
    std::vector<uint8_t> visited(static_cast<size_t>(width) * height, 0);
    for (int y = 0; y < height; ++y) {
      for (int x = 0; x < width; ++x) {
        const size_t base = static_cast<size_t>(y) * width + x;
        if (visited[base]) continue;
        const int ci = pidx[base];
        if (ci < 0) { visited[base] = 1; continue; }  // transparent

        // Greedy width merge
        int rectW = 1;
        while (x + rectW < width
               && !visited[base + rectW]
               && pidx[base + rectW] == ci) ++rectW;

        // Greedy height merge
        int rectH = 1;
        while (y + rectH < height) {
          bool ok = true;
          for (int k = 0; k < rectW && ok; ++k) {
            const size_t ci2 = static_cast<size_t>(y + rectH) * width + (x + k);
            if (visited[ci2] || pidx[ci2] != ci) ok = false;
          }
          if (ok) ++rectH; else break;
        }

        // Mark visited
        for (int j = 0; j < rectH; ++j)
          for (int i = 0; i < rectW; ++i)
            visited[static_cast<size_t>(y + j) * width + (x + i)] = 1;

        const auto& pc = palette[ci];
        file << "<rect x=\"" << x << "\" y=\"" << y
             << "\" width=\""  << rectW << "\" height=\"" << rectH
             << "\" fill=\"rgb(" << static_cast<int>(pc.r) << ','
             << static_cast<int>(pc.g) << ',' << static_cast<int>(pc.b) << ")\"/>\n";
      }
    }

    file << "</svg>\n";
    file.close();
    if (file.fail())
      return DMSHandle::err_str("I/O error writing SVG file");

    return DMSHandle::ok_str(json{
      {"outPath", out.string()},
      {"palette", paletteName},
      {"colors",  static_cast<int>(palette.size())}
    });
  });

  // ── dms_image_to_svg_poly ──────────────────────────────────────────────────────
  // dms_image_to_svg_poly(arg) → { outPath, palette, colors }
  //
  // arg: JSON string  { path, palette?, smooth? }  or plain path string.
  //   palette  — same names as rect mode  (default "db16")
  //   smooth   — apply 3×3 majority-vote smoothing pass  (default true)
  //
  // Three-pass pipeline (same quantise + smooth as rect), then:
  //   3. Render: all pixels sharing one palette index contribute boundary
  //              directed edges to ONE shared edge map per colour.  Every
  //              disconnected island of that colour becomes a sub-path inside
  //              a single <path> element.  Output has at most palette.size()
  //              <path> elements — a dramatic improvement over the old
  //              connected-component approach (one element per region).
  wv.expose("dms_image_to_svg_poly", [](string jsonArg) -> string {
    namespace fs = std::filesystem;

    // ── Parse arguments ────────────────────────────────────────────────────────────
    std::string path;
    std::string paletteName = "db16";
    bool doSmooth = true;
    try {
      auto j   = json::parse(jsonArg);
      path        = j.value("path",    std::string{});
      paletteName = j.value("palette", std::string{"db16"});
      doSmooth    = j.value("smooth",  true);
    } catch (...) {}
    if (path.empty()) path = jsonArg;

    fs::path src(path);
    std::error_code ec;
    if (!fs::exists(src, ec))
      return DMSHandle::err_str(std::format("'{}' does not exist", path));
    if (fs::is_directory(src, ec))
      return DMSHandle::err_str("path is a directory");

    // ── Load image ──────────────────────────────────────────────────────────────────────
    auto img_ = pce::decode_image_to_rgba(src.string());
    if (!img_.ok)
      return DMSHandle::err_str(img_.error);
    const int width    = img_.width;
    const int height   = img_.height;
    const uint8_t* raw = img_.pixels.data();
    // No hard pixel-count limit: palette quantisation + boundary tracing keeps
    // output at most palette.size() <path> elements regardless of image size.

    // ── Pass 1 + 2: palette quantisation and smoothing ───────────────────────
    auto palette = pal::resolve(paletteName, raw, width, height);
    auto pidx    = pal::map_pixels(raw, width, height, palette);
    if (doSmooth) pal::smooth(pidx, width, height);

    const int np = static_cast<int>(palette.size());

    // ── Pass 3a: directed boundary edges, grouped per palette colour ────────
    // Each pixel pair that differ in palette index contributes one directed
    // edge to the boundary of the colour on the interior side.  Because we
    // index by colour (not connected component) every island of the same
    // colour contributes sub-paths to the same edge map.
    using Pt      = std::pair<int, int>;
    using EdgeMap = std::unordered_map<int64_t, Pt>;

    auto enc = [](int x, int y) noexcept -> int64_t {
      return (static_cast<int64_t>(static_cast<uint32_t>(x)) << 32)
           |  static_cast<int64_t>(static_cast<uint32_t>(y));
    };

    std::vector<EdgeMap> emaps(np);

    auto nbr = [&](int x, int y) noexcept -> int {
      if (x < 0 || x >= width || y < 0 || y >= height) return -3;
      return pidx[y * width + x];
    };

    for (int y = 0; y < height; ++y) {
      for (int x = 0; x < width; ++x) {
        const int lbl = pidx[y * width + x];
        if (lbl < 0) continue;
        auto& em = emaps[lbl];
        if (nbr(x,   y-1) != lbl) em[enc(x,   y  )] = {x+1, y  };
        if (nbr(x+1, y  ) != lbl) em[enc(x+1, y  )] = {x+1, y+1};
        if (nbr(x,   y+1) != lbl) em[enc(x+1, y+1)] = {x,   y+1};
        if (nbr(x-1, y  ) != lbl) em[enc(x,   y+1)] = {x,   y  };
      }
    }
    pidx.clear(); pidx.shrink_to_fit();

    // ── Pass 3b: collinear-point removal ─────────────────────────────────────────
    auto simplify = [](const std::vector<Pt>& pts) -> std::vector<Pt> {
      const int n = static_cast<int>(pts.size());
      if (n < 3) return pts;
      std::vector<Pt> out;
      out.reserve(n);
      for (int i = 0; i < n; ++i) {
        const Pt& prev = (i == 0)     ? pts[n - 1] : pts[i - 1];
        const Pt& cur  = pts[i];
        const Pt& next = (i == n - 1) ? pts[0]     : pts[i + 1];
        const bool col =
          (prev.first  == cur.first  && cur.first  == next.first)  ||
          (prev.second == cur.second && cur.second == next.second);
        if (!col) out.push_back(cur);
      }
      return out;
    };

    // ── Write SVG ──────────────────────────────────────────────────────────────────
    // Naming convention: {stem}_ply.svg  (polygon mode).
    fs::path out_path = src.parent_path() / (src.stem().string() + "_ply.svg");
    for (int _n = 2; fs::exists(out_path) && _n < 1000; ++_n)
      out_path = src.parent_path() / (src.stem().string() + "_ply" + std::to_string(_n) + ".svg");

    std::ofstream file(out_path, std::ios::out | std::ios::trunc);
    if (!file)
      return DMSHandle::err_str(std::format("Cannot write '{}'", out_path.string()));

    file << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
         << "<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\""
         << " viewBox=\"0 0 " << width << " " << height << "\""
         << " shape-rendering=\"crispEdges\">\n";

    for (int ci = 0; ci < np; ++ci) {
      auto& em = emaps[ci];
      if (em.empty()) continue;

      const auto& c = palette[ci];
      std::string d;
      d.reserve(em.size() * 10);

      while (!em.empty()) {
        const int64_t start_key = em.begin()->first;
        int64_t cur = start_key;
        std::vector<Pt> poly;
        poly.reserve(32);
        const std::size_t guard = em.size() + 1;
        std::size_t steps = 0;
        do {
          auto it = em.find(cur);
          if (it == em.end()) break;
          poly.push_back({
            static_cast<int>(static_cast<uint32_t>(cur >> 32)),
            static_cast<int>(static_cast<uint32_t>(cur))
          });
          const Pt nxt = it->second;
          em.erase(it);
          cur = enc(nxt.first, nxt.second);
        } while (cur != start_key && ++steps <= guard);

        if (poly.empty()) continue;
        const auto simp = simplify(poly);
        if (simp.empty()) continue;

        d += std::format("M {} {}", simp[0].first, simp[0].second);
        for (std::size_t k = 1; k < simp.size(); ++k)
          d += std::format(" L {} {}", simp[k].first, simp[k].second);
        d += " Z";
      }

      if (d.empty()) continue;

      file << "<path d=\"" << d << "\""
           << " fill=\"rgb(" << static_cast<int>(c.r) << ','
           << static_cast<int>(c.g) << ',' << static_cast<int>(c.b) << ")\""
           << " fill-rule=\"evenodd\"/>\n";
    }

    file << "</svg>\n";
    file.close();
    if (file.fail())
      return DMSHandle::err_str("I/O error writing SVG file");

    return DMSHandle::ok_str(json{
      {"outPath", out_path.string()},
      {"palette", paletteName},
      {"colors",  np}
    });
  });

  // ── dms_image_to_svg_tri ──────────────────────────────────────────────────────
  // dms_image_to_svg_tri(arg) → { outPath, palette, colors, gridSize }
  //
  // Low-poly triangle-grid SVG converter.
  // Divides the image into (gridSize × gridSize) pixel cells; each cell is
  // split into two right triangles.  Every triangle gets the dominant palette
  // colour among its pixels.  Triangles sharing a colour are collected into
  // one <path> element — output has at most palette.size() elements.
  //
  // arg: JSON  { path, palette?, smooth?, gridSize? }
  //   gridSize  — cell size in pixels  (default 8, clamped 2–64)
  wv.expose("dms_image_to_svg_tri", [](string jsonArg) -> string {
    namespace fs = std::filesystem;

    std::string path;
    std::string paletteName = "db16";
    bool doSmooth = true;
    int gridSize  = 8;
    try {
      auto j   = json::parse(jsonArg);
      path        = j.value("path",     std::string{});
      paletteName = j.value("palette",  std::string{"db16"});
      doSmooth    = j.value("smooth",   true);
      gridSize    = j.value("gridSize", 8);
    } catch (...) {}
    if (path.empty()) path = jsonArg;
    gridSize = std::max(2, std::min(64, gridSize));

    fs::path src(path);
    std::error_code ec;
    if (!fs::exists(src, ec))
      return DMSHandle::err_str(std::format("'{}' does not exist", path));
    if (fs::is_directory(src, ec))
      return DMSHandle::err_str("path is a directory");

    auto img_ = pce::decode_image_to_rgba(src.string());
    if (!img_.ok)
      return DMSHandle::err_str(img_.error);
    const int width    = img_.width;
    const int height   = img_.height;
    const uint8_t* data = img_.pixels.data();
    // No hard pixel-count limit: triangle-grid quantisation produces at most
    // palette.size() <path> elements regardless of image resolution.

    auto palette = pal::resolve(paletteName, data, width, height);
    auto pidx    = pal::map_pixels(data, width, height, palette);
    if (doSmooth) pal::smooth(pidx, width, height);

    const int np = static_cast<int>(palette.size());

    // Accumulate sub-path strings per palette colour
    std::vector<std::string> paths(np);
    for (auto& sp : paths) sp.reserve(256);

    for (int cellY = 0; cellY < height; cellY += gridSize) {
      for (int cellX = 0; cellX < width; cellX += gridSize) {
        const int gW = std::min(gridSize, width  - cellX);
        const int gH = std::min(gridSize, height - cellY);

        // Vote: upper-left triangle vs. lower-right triangle
        // Pixel (dx,dy) in cell belongs to upper-left if dx*gH + dy*gW < gW*gH
        std::vector<int> cntA(np, 0), cntB(np, 0);
        for (int dy = 0; dy < gH; ++dy)
          for (int dx = 0; dx < gW; ++dx) {
            const int v = pidx[(cellY+dy)*width + (cellX+dx)];
            if (v < 0) continue;
            if (dx * gH + dy * gW < gW * gH) ++cntA[v];
            else                              ++cntB[v];
          }

        auto dom = [](const std::vector<int>& cnt) -> int {
          return static_cast<int>(
            std::max_element(cnt.begin(), cnt.end()) - cnt.begin());
        };
        const int ca = dom(cntA);
        const int cb = dom(cntB);

        const int x1 = cellX, y1 = cellY;
        const int x2 = cellX + gW, y2 = cellY + gH;
        // Triangle A: top-left, top-right, bottom-left
        paths[ca] += std::format("M{},{} L{},{} L{},{} Z", x1,y1, x2,y1, x1,y2);
        // Triangle B: top-right, bottom-right, bottom-left
        paths[cb] += std::format("M{},{} L{},{} L{},{} Z", x2,y1, x2,y2, x1,y2);
      }
    }

    // Naming convention: {stem}_tri.svg  (triangle mode).
    fs::path out_path = src.parent_path() / (src.stem().string() + "_tri.svg");
    for (int _n = 2; fs::exists(out_path) && _n < 1000; ++_n)
      out_path = src.parent_path() / (src.stem().string() + "_tri" + std::to_string(_n) + ".svg");

    std::ofstream file(out_path, std::ios::out | std::ios::trunc);
    if (!file)
      return DMSHandle::err_str(std::format("Cannot write '{}'", out_path.string()));

    file << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
         << "<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\""
         << " viewBox=\"0 0 " << width << " " << height << "\">\n";

    for (int ci = 0; ci < np; ++ci) {
      if (paths[ci].empty()) continue;
      const auto& c = palette[ci];
      file << "<path d=\"" << paths[ci] << "\""
           << " fill=\"rgb(" << static_cast<int>(c.r) << ','
           << static_cast<int>(c.g) << ',' << static_cast<int>(c.b) << ")\"/>\n";
    }

    file << "</svg>\n";
    file.close();
    if (file.fail())
      return DMSHandle::err_str("I/O error writing SVG file");

    return DMSHandle::ok_str(json{
      {"outPath",  out_path.string()},
      {"palette",  paletteName},
      {"colors",   np},
      {"gridSize", gridSize}
    });
  });

  // ── dms_image_analyze ───────────────────────────────────────────────────────────
  // dms_image_analyze(arg) → ImageAnalysis
  // Extracts colour statistics without saving any file.
  //
  // Returns: { width, height,
  //            palette : [{r,g,b,hex,count,pct},...] sorted by count,
  //            histogram : { r:[256], g:[256], b:[256] } }
  //
  // arg: JSON  { path, palette? }  or plain path string.
  //   palette  — palette for dominant-colour extraction  (default "auto16")
  wv.expose("dms_image_analyze", [](string jsonArg) -> string {
    namespace fs = std::filesystem;

    std::string path;
    std::string paletteName = "auto16";
    try {
      auto j   = json::parse(jsonArg);
      path        = j.value("path",    std::string{});
      paletteName = j.value("palette", std::string{"auto16"});
    } catch (...) {}
    if (path.empty()) path = jsonArg;

    fs::path src(path);
    std::error_code ec;
    if (!fs::exists(src, ec))
      return DMSHandle::err_str(std::format("'{}' does not exist", path));
    if (fs::is_directory(src, ec))
      return DMSHandle::err_str("path is a directory");

    auto img_ = pce::decode_image_to_rgba(src.string());
    if (!img_.ok)
      return DMSHandle::err_str(img_.error);
    const int width    = img_.width;
    const int height   = img_.height;
    const uint8_t* data = img_.pixels.data();

    const int npx = width * height;

    // ── RGB histogram (256 bins per channel) ─────────────────────────────────────────
    std::array<int,256> histR{}, histG{}, histB{};
    histR.fill(0); histG.fill(0); histB.fill(0);
    for (int i = 0; i < npx; ++i)
      if (data[i*4+3] > 0) {
        ++histR[data[i*4]];
        ++histG[data[i*4+1]];
        ++histB[data[i*4+2]];
      }

    // ── Palette quantization + pixel counts ─────────────────────────────────────────
    auto palette = pal::resolve(paletteName, data, width, height);
    auto pidx    = pal::map_pixels(data, width, height, palette);

    const int np = static_cast<int>(palette.size());
    std::vector<int> cnt(np, 0);
    int total_opaque = 0;
    for (int v : pidx)
      if (v >= 0) { ++cnt[v]; ++total_opaque; }

    // ── Build palette JSON array (sorted by count desc) ─────────────────────
    json pal_arr = json::array();
    for (int i = 0; i < np; ++i) {
      const auto& col = palette[i];
      const double pct = total_opaque > 0
          ? std::round(static_cast<double>(cnt[i]) / total_opaque * 1000.0) / 10.0
          : 0.0;
      pal_arr.push_back(json{
        {"r",     static_cast<int>(col.r)},
        {"g",     static_cast<int>(col.g)},
        {"b",     static_cast<int>(col.b)},
        {"hex",   std::format("#{:02x}{:02x}{:02x}", col.r, col.g, col.b)},
        {"count", cnt[i]},
        {"pct",   pct}
      });
    }
    std::sort(pal_arr.begin(), pal_arr.end(),
      [](const json& a, const json& b){
        return a["count"].get<int>() > b["count"].get<int>();
      });

    // ── Build histogram JSON arrays ───────────────────────────────────────────
    json hR = json::array(), hG = json::array(), hB = json::array();
    for (int v : histR) hR.push_back(v);
    for (int v : histG) hG.push_back(v);
    for (int v : histB) hB.push_back(v);

    return DMSHandle::ok_str(json{
      {"width",     width},
      {"height",    height},
      {"palette",   pal_arr},
      {"histogram", json{{"r", hR}, {"g", hG}, {"b", hB}}}
    });
  });

  // ── dms_search ────────────────────────────────────────────────────────────
  // dms_search(query: string, top_k: int) → SearchResults
  // SearchResults: { strategy, query,
  //                  results: [ { doc_id, path, filename, score, snippet,
  //                               mime_type, keywords[], sentiment, lang } ] }
  // strategy: "semantic" (ONNX cosine) | "keyword" (LIKE fallback)
  wv.expose("dms_search", [&dms](string query, int top_k) -> string {
    const auto r = dms.search(query, top_k);
    if (!r)
      return DMSHandle::err_str(r.error());
    return DMSHandle::ok_str(*r);
  });

  // ── dms_index_status ──────────────────────────────────────────────────────
  // dms_index_status() → { total_docs, bulk_active, last_indexed_at }
  wv.expose("dms_index_status", [&dms]() -> string {
    const auto r = dms.index_status();
    if (!r)
      return DMSHandle::err_str(r.error());
    return DMSHandle::ok_str(*r);
  });

  // ── dms_get_metadata ──────────────────────────────────────────────────────
  // dms_get_metadata(path: string) → DocumentMetadata
  // DocumentMetadata: { doc_id, path, filename, extension, mime_type,
  //                     size_bytes, mtime, indexed_at, snippet,
  //                     keywords[], entities[], sentiment, sentiment_label,
  //                     lang, has_embedding, dimensions }
  wv.expose("dms_get_metadata", [&dms](string path) -> string {
    const auto r = dms.get_metadata(path);
    if (!r)
      return DMSHandle::err_str(r.error());
    return DMSHandle::ok_str(*r);
  });

  // ── dms_get_exif ──────────────────────────────────────────────────────────
  // dms_get_exif(path: string) → ExifData  (on-demand, no DB required)
  wv.expose("dms_get_exif", [](string path) -> string {
    namespace fs = std::filesystem;
    if (!fs::exists(fs::path(path)))
      return DMSHandle::err_str("File not found: " + path);
    const std::string json = pce::nlp::platform::extract_exif(path);
    try {
      auto j = json::parse(json);
      return DMSHandle::ok_str(j);
    } catch (...) {
      return DMSHandle::ok_str(json::object());
    }
  });

  // ── dms_rectify_document ──────────────────────────────────────────────────
  wv.expose(
      "dms_rectify_document",
      [&dms](string path, std::optional<string> out_path_opt) -> string {
        namespace fs = std::filesystem;
        fs::path src(path);
        if (!fs::exists(src)) {
          return DMSHandle::err_str(std::format("'{}' does not exist", path));
        }

        fs::path out_path;
        if (out_path_opt && !out_path_opt->empty()) {
          out_path = *out_path_opt;
        } else {
          // Default: same dir, .rectified.jpg
          out_path =
              src.parent_path() / (src.stem().string() + ".rectified.jpg");
        }

        if (!dms.rectifier) {
          return DMSHandle::err_str("Rectifier addon not loaded");
        }

        bool ok = dms.rectifier->rectify(src.string(), out_path.string());
        if (!ok) {
          return DMSHandle::err_str("Rectification failed");
        }

        // Index the result
        (void)dms.index_document(out_path.string());

        return DMSHandle::ok_str(
            json({{"success", true}, {"outPath", out_path.string()}}));
      });

  // ── dms_get_zones ─────────────────────────────────────────────────────────
  wv.expose("dms_get_zones", [&dms]() -> string {
    const auto r = dms.get_zones();
    if (!r)
      return DMSHandle::err_str(r.error());
    return DMSHandle::ok_str(*r);
  });

  // ── dms_upsert_zone ───────────────────────────────────────────────────────
  wv.expose("dms_upsert_zone",
            [&dms](string name, string in_path, string out_path,
                   std::optional<string> password, string description,
                   string taxonomy_domain) -> string {
              const auto r = dms.upsert_zone(name, in_path, out_path, password,
                                             description, taxonomy_domain);
              if (!r)
                return DMSHandle::err_str(r.error());
              return DMSHandle::ok_str(*r);
            });

  /**
   * dms_open_zone_db(zone_name: string, password?: string)
   * Switches the active database to the zone-specific one.
   */
  wv.expose("dms_open_zone_db",
            [&dms](string zone_name, std::optional<string> password) -> string {
              if (zone_name == "global" || zone_name == "") {
                dms.bulk_index_stop();
                std::lock_guard lk{dms.db_mutex};
                dms.zone_db = std::nullopt; // Use std::nullopt to Clear zone_db
                dms.active_zone_name = "global";
                return DMSHandle::ok_str(json{{"status", "reset_to_global"}});
              }

              auto r = dms.open_zone_db(zone_name, password);
              if (!r)
                return DMSHandle::err_str(r.error());

              dms.bulk_index_stop();
              std::lock_guard lk{dms.db_mutex};
              dms.zone_db = std::make_optional(std::move(*r));
              dms.active_zone_name = zone_name;

              return DMSHandle::ok_str(
                  json{{"status", "switched", "zone", zone_name}});
            });

  wv.expose("dms_import_to_zone",
            [&dms](string path, string zone_name, bool compress,
                   bool scan) -> string {
              const auto r =
                  dms.import_to_zone(path, zone_name, compress, scan);
              if (!r)
                return DMSHandle::err_str(r.error());
              return DMSHandle::ok_str(*r);
            });

  // ── dms_ocr_document ──────────────────────────────────────────────────────
  wv.expose("dms_ocr_document",
            [&dms](string path, string zone_name) -> string {
              const auto r = dms.ocr_document(path, zone_name);
              // ocr_document already returns std::string (json)
              return r;
            });

  wv.expose("dms_file_to_zone",
            [&dms](string path, string zone_name) -> string {
              const auto r = dms.file_to_zone(path, zone_name);
              if (!r)
                return DMSHandle::err_str(r.error());
              return DMSHandle::ok_str(*r);
            });

  // ── dms_select_directory ─────────────────────────────────────────────────
  // Uses saucer::modules::desktop — works on macOS, Windows, Linux.
  wv.expose("dms_select_directory", [&desk]() -> string {
    namespace picker = saucer::modules::picker;
    auto res = desk.pick<picker::type::folder>();
    if (!res.has_value())
      return DMSHandle::ok_str(json({{"path", ""}}));
    return DMSHandle::ok_str(json({{"path", res->string()}}));
  });

  // ── dms_select_files ─────────────────────────────────────────────────────
  // Opens a multi-file native picker. Returns JSON { paths: string[] }.
  // Empty array = user cancelled. Each path is an absolute filesystem path.
  wv.expose("dms_select_files", [&desk]() -> string {
    namespace picker = saucer::modules::picker;
    auto res = desk.pick<picker::type::files>();
    json paths = json::array();
    if (res.has_value()) {
      for (const auto &p : *res)
        paths.push_back(p.string());
    }
    return DMSHandle::ok_str(json({{"paths", paths}}));
  });

  // ── dms_path_exists ───────────────────────────────────────────────────────
  // dms_path_exists(path: string) → { exists: bool, is_dir: bool }
  wv.expose("dms_path_exists", [](string path) -> string {
    namespace fs = std::filesystem;
    std::error_code ec;
    const bool exists = fs::exists(fs::path{path}, ec);
    const bool is_dir = exists && fs::is_directory(fs::path{path}, ec);
    return DMSHandle::ok_str(json{{"exists", exists}, {"is_dir", is_dir}});
  });

  // ── dms_create_dir ────────────────────────────────────────────────────────
  // dms_create_dir(path: string) → { created: bool, path: string }
  // Creates the directory (and all parents) if it does not already exist.
  wv.expose("dms_create_dir", [](string path) -> string {
    namespace fs = std::filesystem;
    std::error_code ec;
    if (fs::exists(fs::path{path}, ec))
      return DMSHandle::ok_str(json{{"created", false}, {"path", path}});
    const bool ok = fs::create_directories(fs::path{path}, ec);
    if (!ok || ec)
      return DMSHandle::err_str(
          std::format("failed to create '{}': {}", path, ec.message()));
    return DMSHandle::ok_str(json{{"created", true}, {"path", path}});
  });

  // ── dms_copy_files ────────────────────────────────────────────────────────
  // dms_copy_files(sources_json, destDir, conflict) → { copied, skipped,
  // errors[] } sources_json: JSON array of absolute paths conflict: "replace" |
  // "keep" | "skip"
  wv.expose(
      "dms_copy_files",
      [](string sources_json, string dest_dir, string conflict) -> string {
        namespace fs = std::filesystem;
        std::vector<std::string> sources;
        try {
          for (auto &s : json::parse(sources_json))
            sources.push_back(s.get<std::string>());
        } catch (...) {
          return DMSHandle::err_str("Invalid sources JSON");
        }

        fs::path dest{dest_dir};
        std::error_code ec;
        if (!fs::exists(dest, ec))
          fs::create_directories(dest, ec);
        if (!fs::is_directory(dest, ec))
          return DMSHandle::err_str(
              std::format("'{}' is not a directory", dest_dir));

        int64_t copied = 0, skipped = 0;
        std::vector<std::string> errors;
        for (const auto &src_str : sources) {
          fs::path src{src_str};
          if (!fs::exists(src, ec)) {
            errors.push_back(std::format("'{}' not found", src_str));
            continue;
          }
          fs::path tgt = dest / src.filename();
          if (fs::exists(tgt, ec)) {
            if (conflict == "skip") {
              ++skipped;
              continue;
            } else if (conflict == "keep") {
              auto stem = tgt.stem().string(), ext = tgt.extension().string();
              for (int n = 1; fs::exists(tgt, ec); ++n)
                tgt = dest / std::format("{} ({}){}", stem, n, ext);
            }
            // "replace" → overwrite
          }
          try {
            if (fs::is_directory(src, ec))
              fs::copy(src, tgt,
                       fs::copy_options::recursive |
                           fs::copy_options::overwrite_existing,
                       ec);
            else
              fs::copy_file(src, tgt, fs::copy_options::overwrite_existing, ec);
            if (ec) {
              errors.push_back(
                  std::format("copy '{}': {}", src_str, ec.message()));
              ec.clear();
            } else
              ++copied;
          } catch (const std::exception &e) {
            errors.push_back(std::format("copy '{}': {}", src_str, e.what()));
          }
        }
        return DMSHandle::ok_str(
            json{{"copied", copied}, {"skipped", skipped}, {"errors", errors}});
      });

  // ── dms_move_files ────────────────────────────────────────────────────────
  // dms_move_files(sources_json, destDir, conflict) → { moved, skipped,
  // errors[] }
  wv.expose(
      "dms_move_files",
      [](string sources_json, string dest_dir, string conflict) -> string {
        namespace fs = std::filesystem;
        std::vector<std::string> sources;
        try {
          for (auto &s : json::parse(sources_json))
            sources.push_back(s.get<std::string>());
        } catch (...) {
          return DMSHandle::err_str("Invalid sources JSON");
        }

        fs::path dest{dest_dir};
        std::error_code ec;
        if (!fs::exists(dest, ec))
          fs::create_directories(dest, ec);
        if (!fs::is_directory(dest, ec))
          return DMSHandle::err_str(
              std::format("'{}' is not a directory", dest_dir));

        int64_t moved = 0, skipped = 0;
        std::vector<std::string> errors;
        for (const auto &src_str : sources) {
          fs::path src{src_str};
          if (!fs::exists(src, ec)) {
            errors.push_back(std::format("'{}' not found", src_str));
            continue;
          }
          fs::path tgt = dest / src.filename();
          if (fs::exists(tgt, ec)) {
            if (conflict == "skip") {
              ++skipped;
              continue;
            } else if (conflict == "keep") {
              auto stem = tgt.stem().string(), ext = tgt.extension().string();
              for (int n = 1; fs::exists(tgt, ec); ++n)
                tgt = dest / std::format("{} ({}){}", stem, n, ext);
            }
          }
          try {
            fs::rename(src, tgt, ec);
            if (ec) {
              ec.clear();
              if (fs::is_directory(src, ec))
                fs::copy(src, tgt,
                         fs::copy_options::recursive |
                             fs::copy_options::overwrite_existing,
                         ec);
              else
                fs::copy_file(src, tgt, fs::copy_options::overwrite_existing,
                              ec);
              if (!ec)
                fs::is_directory(tgt, ec) ? (void)fs::remove_all(src, ec)
                                          : (void)fs::remove(src, ec);
            }
            if (ec) {
              errors.push_back(
                  std::format("move '{}': {}", src_str, ec.message()));
              ec.clear();
              continue;
            }
            ++moved;
          } catch (const std::exception &e) {
            errors.push_back(std::format("move '{}': {}", src_str, e.what()));
          }
        }
        return DMSHandle::ok_str(
            json{{"moved", moved}, {"skipped", skipped}, {"errors", errors}});
      });

  // ── dms_delete_files ──────────────────────────────────────────────────────
  // dms_delete_files(paths_json) → { deleted, errors[] }
  wv.expose("dms_delete_files", [](string paths_json) -> string {
    namespace fs = std::filesystem;
    std::vector<std::string> paths;
    try {
      for (auto &p : json::parse(paths_json))
        paths.push_back(p.get<std::string>());
    } catch (...) {
      return DMSHandle::err_str("Invalid paths JSON");
    }

    int64_t deleted = 0;
    std::vector<std::string> errors;
    std::error_code ec;
    for (const auto &p_str : paths) {
      fs::path p{p_str};
      if (!fs::exists(p, ec)) {
        errors.push_back(std::format("'{}' not found", p_str));
        continue;
      }
      try {
        if (fs::is_directory(p, ec))
          fs::remove_all(p, ec);
        else
          fs::remove(p, ec);
        if (ec) {
          errors.push_back(std::format("delete '{}': {}", p_str, ec.message()));
          ec.clear();
        } else
          ++deleted;
      } catch (const std::exception &e) {
        errors.push_back(std::format("delete '{}': {}", p_str, e.what()));
      }
    }
    return DMSHandle::ok_str(json{{"deleted", deleted}, {"errors", errors}});
  });

  // ── dms_create_archive ────────────────────────────────────────────────────
  // dms_create_archive(sources_json, destPath, format) → { path, sizeBytes }
  // format: "zip" | "tar.gz" | "tar.bz2" | "tar.zst"
  wv.expose(
      "dms_create_archive",
      [](string sources_json, string dest_path, string format) -> string {
        namespace fs = std::filesystem;
        std::vector<std::string> sources;
        try {
          for (auto &s : json::parse(sources_json))
            sources.push_back(s.get<std::string>());
        } catch (...) {
          return DMSHandle::err_str("Invalid sources JSON");
        }
        if (sources.empty())
          return DMSHandle::err_str("No sources provided");

        // Build quoted file list
        std::string file_list;
        for (const auto &s : sources)
          file_list += "\"" + s + "\" ";

        std::string cmd;
        if (format == "zip")
          cmd = std::format("zip -r \"{}\" {} >/dev/null 2>&1", dest_path,
                            file_list);
        else if (format == "tar.gz")
          cmd = std::format("tar -czf \"{}\" {} 2>&1", dest_path, file_list);
        else if (format == "tar.bz2")
          cmd = std::format("tar -cjf \"{}\" {} 2>&1", dest_path, file_list);
        else if (format == "tar.zst")
          cmd =
              std::format("tar --use-compress-program=zstd -cf \"{}\" {} 2>&1",
                          dest_path, file_list);
        else
          return DMSHandle::err_str(
              std::format("Unknown archive format: {}", format));

        if (int rc = std::system(cmd.c_str()); rc != 0)
          return DMSHandle::err_str(
              std::format("Archive command failed (exit {})", rc));

        std::error_code ec;
        const int64_t sz =
            static_cast<int64_t>(fs::file_size(fs::path{dest_path}, ec));
        return DMSHandle::ok_str(
            json{{"path", dest_path}, {"sizeBytes", ec ? int64_t{0} : sz}});
      });

  // ── dms_compress_file ──────────────────────────────────────────────────────
  // dms_compress_file(srcPath, destPath, format, level) → { path, sizeBytes,
  // ratio } format: "gz" | "bz2" | "zst"
  wv.expose(
      "dms_compress_file",
      [](string src_path, string dest_path, string format,
         int level) -> string {
        namespace fs = std::filesystem;
        if (!fs::exists(fs::path{src_path}))
          return DMSHandle::err_str(std::format("'{}' not found", src_path));

        level = std::clamp(level, 1, 9);

        std::string cmd;
        if (format == "gz")
          cmd = std::format("gzip -{} -k -c \"{}\" > \"{}\" 2>&1", level,
                            src_path, dest_path);
        else if (format == "bz2")
          cmd = std::format("bzip2 -{} -k -c \"{}\" > \"{}\" 2>&1", level,
                            src_path, dest_path);
        else if (format == "zst")
          cmd = std::format("zstd -{} \"{}\" -o \"{}\" 2>&1", level, src_path,
                            dest_path);
        else
          return DMSHandle::err_str(
              std::format("Unknown compression format: {}", format));

        if (int rc = std::system(cmd.c_str()); rc != 0)
          return DMSHandle::err_str(
              std::format("Compression failed (exit {})", rc));

        std::error_code ec;
        const int64_t orig_sz =
            static_cast<int64_t>(fs::file_size(fs::path{src_path}, ec));
        const int64_t comp_sz =
            static_cast<int64_t>(fs::file_size(fs::path{dest_path}, ec));
        const double ratio =
            orig_sz > 0 ? (1.0 - static_cast<double>(comp_sz) / orig_sz) : 0.0;
        return DMSHandle::ok_str(json{
            {"path", dest_path}, {"sizeBytes", comp_sz}, {"ratio", ratio}});
      });

  // ── dms_write_file ────────────────────────────────────────────────────────
  // dms_write_file(path, content) → { written: bool }
  // Writes a UTF-8 string to a file (create or overwrite). Creates parent dirs.
  wv.expose("dms_write_file", [](string path, string content) -> string {
    namespace fs = std::filesystem;
    std::error_code ec;
    const fs::path p{path};
    // Ensure parent directory exists
    if (p.has_parent_path()) {
      fs::create_directories(p.parent_path(), ec);
      if (ec)
        return DMSHandle::err_str(std::format(
            "failed to create parent dir for '{}': {}", path, ec.message()));
    }
    std::ofstream ofs(p, std::ios::out | std::ios::trunc | std::ios::binary);
    if (!ofs.is_open())
      return DMSHandle::err_str(
          std::format("failed to open '{}' for writing", path));
    ofs.write(content.data(), static_cast<std::streamsize>(content.size()));
    if (!ofs)
      return DMSHandle::err_str(std::format("write error for '{}'", path));
    return DMSHandle::ok_str(json{{"written", true}});
  });

  // ── dms_share_file ────────────────────────────────────────────────────────
  // dms_share_file(path) → { shared: bool }
  // macOS: reveals the file in Finder via `open -R`.
  wv.expose("dms_share_file", [](string path) -> string {
#ifdef __APPLE__
    const auto cmd = std::format("open -R \"{}\" 2>&1", path);
    if (int rc = std::system(cmd.c_str()); rc == 0)
      return DMSHandle::ok_str(json{{"shared", true}});
    return DMSHandle::err_str("Failed to reveal file in Finder");
#else
      return DMSHandle::err_str("Share not supported on this platform");
#endif
  });

  std::print("[dms] {} bindings registered\n",
               32 /* scan_dir, read_file, write_file, fetch_data_url, extract_pdf_text,
                     index_document, bulk_index, bulk_stop, export_pdf, image_to_svg, image_to_svg_poly,
                     search, status, metadata, rectify, get_zones,
                     upsert_zone, open_zone_db, import_to_zone,
                     ocr_document, file_to_zone, select_directory, select_files,
                     path_exists, create_dir,
                     copy_files, move_files, delete_files,
                     create_archive, compress_file, share_file, write_file */);
}

} // namespace pce::dms
