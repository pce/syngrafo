#pragma once
/**
 * @file internal/mime.hh
 * @brief MIME type and document-kind resolution by file extension.
 *
 * @note Application-internal. Do not include from external headers.
 */

#include <algorithm>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>

namespace pce::dms {

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

} // namespace pce::dms

