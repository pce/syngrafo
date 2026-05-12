#pragma once
/**
 * @file core/document_state.hh
 * @brief Document lifecycle value types for event-sourced state tracking.
 *
 * Keeps the lifecycle vocabulary typed and reusable across DB/services/bindings.
 */

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace pce::dms {

enum class DocumentState : uint8_t {
    Input,
    Processing,
    Indexed,
    Review,
    Active,
    Archived,
    Finished,
    Error,
};

[[nodiscard]] constexpr std::string_view document_state_name(DocumentState s) noexcept {
    switch (s) {
        case DocumentState::Input:      return "INPUT";
        case DocumentState::Processing: return "PROCESSING";
        case DocumentState::Indexed:    return "INDEXED";
        case DocumentState::Review:     return "REVIEW";
        case DocumentState::Active:     return "ACTIVE";
        case DocumentState::Archived:   return "ARCHIVED";
        case DocumentState::Finished:   return "FINISHED";
        case DocumentState::Error:      return "ERROR";
    }
    return "INPUT";
}

[[nodiscard]] inline std::optional<DocumentState>
document_state_from_string(std::string_view raw) noexcept {
    if (raw == "INPUT")      return DocumentState::Input;
    if (raw == "PROCESSING") return DocumentState::Processing;
    if (raw == "INDEXED")    return DocumentState::Indexed;
    if (raw == "REVIEW")     return DocumentState::Review;
    if (raw == "ACTIVE")     return DocumentState::Active;
    if (raw == "ARCHIVED")   return DocumentState::Archived;
    if (raw == "FINISHED")   return DocumentState::Finished;
    if (raw == "ERROR")      return DocumentState::Error;
    return std::nullopt;
}

struct BlobRecord {
    std::string blob_hash;
    std::string algorithm{"fnv1a64"};
    std::string storage_key;
    std::string mime_type{"application/octet-stream"};
    int64_t     size_bytes{0};
};

struct DocumentRegistration {
    int64_t     doc_id{0};
    std::string path;
    std::string source_path;
    std::string zone_name{"global"};
    std::string kind{"other"};
    std::string mime_type{"application/octet-stream"};
    int64_t     size_bytes{0};
    int64_t     mtime{0};
};

struct TextContentVersion {
    std::string extractor{"text"};
    std::string text_hash;
    std::string mime_type{"text/plain"};
    std::string payload_json{"{}"};
};

} // namespace pce::dms
