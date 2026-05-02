#pragma once
/**
 * @file core/document.hh
 * @author Patrick Engel
 * @brief DMS Document + Block value types — NLP and Document Editor are
 *        first-class citizens.  No virtuals, no inheritance.
 *
 * Block mirrors the TypeScript editor model exactly:
 *   h1|h2|h3|p|ul|ol|li|img|figure|figcaption|hr|hbox|vbox|table|code|pagebreak
 *
 * Layer map:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  Document  (identity + content + structure + NLP)       │
 *   │    ├─ std::vector<Block>  ← Document Editor             │
 *   │    └─ NLPResult           ← NLP Engine                  │
 *   └─────────────────────────────────────────────────────────┘
 *
 * NLP operations on a Document stay near the NLP engine — they are declared
 * here as free functions so any layer can call them without pulling in the
 * NLPEngine or DMSHandle.  Implementations live in dms_bindings.hh / nlp layer.
 *
 * @code{.cpp}
 *   Document doc = Document::from_text("/inbox/report.md", content);
 *   auto entities = extract_entities(doc);    // Expected<std::vector<Entity>>
 *   auto summary  = summarize(doc, engine);   // Expected<std::string>
 *
 *   // Traverse structure
 *   for (const auto& b : doc.blocks)
 *       if (b.type == BlockType::H1) show_heading(b.content);
 * @endcode
 */

#include <cstdint>
#include <optional>
#include <string>
#include <unordered_map>
#include <variant>
#include <vector>

namespace pce::dms {

// ─── BlockType ────────────────────────────────────────────────────────────────

/// Mirrors the TypeScript `BlockType` union in the frontend editor.
enum class BlockType : uint8_t {
    // Typography
    H1, H2, H3, P,
    // Lists
    UL, OL, LI,
    // Media
    Img, Figure, Figcaption,
    // Layout containers (flex)
    HBox, VBox,
    // Structural
    HR, Table, Code,
    /// Hard page-break — forces a new PDF page.
    PageBreak,
    /// Catch-all for forward-compat / custom blocks.
    Custom,
};

/// Human-readable round-trip string for a BlockType.
[[nodiscard]] constexpr std::string_view block_type_name(BlockType t) noexcept {
    switch (t) {
        case BlockType::H1:         return "h1";
        case BlockType::H2:         return "h2";
        case BlockType::H3:         return "h3";
        case BlockType::P:          return "p";
        case BlockType::UL:         return "ul";
        case BlockType::OL:         return "ol";
        case BlockType::LI:         return "li";
        case BlockType::Img:        return "img";
        case BlockType::Figure:     return "figure";
        case BlockType::Figcaption: return "figcaption";
        case BlockType::HBox:       return "hbox";
        case BlockType::VBox:       return "vbox";
        case BlockType::HR:         return "hr";
        case BlockType::Table:      return "table";
        case BlockType::Code:       return "code";
        case BlockType::PageBreak:  return "pagebreak";
        case BlockType::Custom:     return "custom";
    }
    return "custom";
}

[[nodiscard]] inline BlockType block_type_from_string(std::string_view s) noexcept {
    if (s=="h1")          return BlockType::H1;
    if (s=="h2")          return BlockType::H2;
    if (s=="h3")          return BlockType::H3;
    if (s=="p")           return BlockType::P;
    if (s=="ul")          return BlockType::UL;
    if (s=="ol")          return BlockType::OL;
    if (s=="li")          return BlockType::LI;
    if (s=="img")         return BlockType::Img;
    if (s=="figure")      return BlockType::Figure;
    if (s=="figcaption")  return BlockType::Figcaption;
    if (s=="hbox")        return BlockType::HBox;
    if (s=="vbox")        return BlockType::VBox;
    if (s=="hr")          return BlockType::HR;
    if (s=="table")       return BlockType::Table;
    if (s=="code")        return BlockType::Code;
    if (s=="pagebreak")   return BlockType::PageBreak;
    return BlockType::Custom;
}

// ─── BlockMetadata ────────────────────────────────────────────────────────────

/// Arbitrary per-block metadata as a string→string map.
/// Typed helpers cover the most common fields.
struct BlockMetadata {
    std::unordered_map<std::string, std::string> fields;

    // ── Typed accessors ───────────────────────────────────────────────────────
    [[nodiscard]] std::string get(std::string_view key,
                                   std::string_view def = "") const {
        const auto it = fields.find(std::string{key});
        return it != fields.end() ? it->second : std::string{def};
    }
    void set(std::string_view key, std::string_view val) {
        fields[std::string{key}] = std::string{val};
    }
    [[nodiscard]] bool has(std::string_view key) const {
        return fields.count(std::string{key}) > 0;
    }

    // Common well-known fields ─────────────────────────────────────────────────
    [[nodiscard]] std::string parent_id()       const { return get("parentId"); }
    [[nodiscard]] std::string width()           const { return get("width"); }
    [[nodiscard]] std::string height()          const { return get("height"); }
    [[nodiscard]] std::string max_width()       const { return get("maxWidth"); }
    [[nodiscard]] std::string gap()             const { return get("gap"); }
    [[nodiscard]] std::string align_items()     const { return get("alignItems"); }
    [[nodiscard]] std::string justify_content() const { return get("justifyContent"); }

    [[nodiscard]] bool empty() const noexcept { return fields.empty(); }
};

// ─── StyleRef ─────────────────────────────────────────────────────────────────

/// Reference to a named CSS-class style + optional inline overrides.
struct StyleRef {
    std::string style_id;    ///< e.g. "body", "heading-1", "caption"
    std::string overrides;   ///< inline CSS (serialised as JSON string)
};

// ─── Block ────────────────────────────────────────────────────────────────────

/// A structural unit inside a Document.
/// Mirrors the TypeScript `Block` class in the frontend editor, but as a plain
/// value type: no signals, no heap churn beyond the vectors.
struct Block {
    std::string    id;                          ///< Unique block identifier
    BlockType      type   { BlockType::P };     ///< Block kind
    std::string    content;                     ///< Plain-text or HTML content
    StyleRef       style_ref;                   ///< CSS class + inline overrides
    BlockMetadata  metadata;                    ///< Structured per-block data
    std::vector<Block> children;                ///< Nested blocks (hbox/vbox/li/…)

    // ── Convenience predicates ────────────────────────────────────────────────
    [[nodiscard]] bool is_layout_container() const noexcept {
        return type == BlockType::HBox || type == BlockType::VBox;
    }
    [[nodiscard]] bool is_heading() const noexcept {
        return type == BlockType::H1 || type == BlockType::H2 || type == BlockType::H3;
    }
    [[nodiscard]] bool is_image() const noexcept {
        return type == BlockType::Img || type == BlockType::Figure;
    }
    [[nodiscard]] bool is_list() const noexcept {
        return type == BlockType::UL || type == BlockType::OL;
    }
    [[nodiscard]] int heading_level() const noexcept {
        if (type == BlockType::H1) return 1;
        if (type == BlockType::H2) return 2;
        if (type == BlockType::H3) return 3;
        return 0;
    }
};

// ─── NLPResult ────────────────────────────────────────────────────────────────

/// Lightweight result of NLP analysis on a document's text.
/// Produced by DMSHandle::index_one_file_ and stored in nlp_notes.
/// JSON arrays are kept serialised to avoid pulling in nlohmann here.
struct NLPResult {
    std::string              keywords_json    {"[]"};
    std::string              entities_json    {"[]"};
    double                   sentiment        {0.0};
    std::string              sentiment_label  {"neutral"};
    std::string              lang             {"en"};
    std::optional<std::vector<float>> embedding;  ///< Dense vector (nullopt when not computed)
};

// ─── Entity / Keyword value types ─────────────────────────────────────────────

/// A single extracted named entity.
struct Entity {
    std::string text;   ///< Surface form
    std::string label;  ///< "PERSON" | "ORG" | "DATE" | "PLACE" | …
    int         start{};///< Character offset in source text
    int         end{};  ///< Character offset end
};

/// A single extracted keyword with relevance score.
struct Keyword {
    std::string text;
    float       score{0.f};
};

// ─── Document ────────────────────────────────────────────────────────────────

/// A rich document: filesystem identity + plain text + block structure + NLP.
///
/// The three layers are cleanly separated:
///   Identity  — path, filename, mime_type, kind
///   Content   — text, snippet, blocks (for document editor)
///   NLP       — optional NLPResult (populated by indexing pipeline)
struct Document {
    // ── Identity ──────────────────────────────────────────────────────────────
    std::string  path;
    std::string  filename;
    std::string  extension;
    std::string  mime_type;
    std::string  kind;          ///< "text" | "code" | "image" | "document" | …

    // ── Content ───────────────────────────────────────────────────────────────
    std::string        text;    ///< Full plain-text content
    std::string        snippet; ///< First ~280 chars for display

    /// HTML-like block structure — populated by the Document Editor pipeline.
    /// Empty for plain-text-only documents.
    std::vector<Block> blocks;

    // ── Filesystem metadata ───────────────────────────────────────────────────
    int64_t  size_bytes {0};
    int64_t  mtime      {0};  ///< Last-modified Unix timestamp
    int64_t  indexed_at {0};  ///< When this document was last NLP-indexed

    // ── NLP metadata (first-class citizen) ────────────────────────────────────
    std::optional<NLPResult> nlp;

    // ── Predicates ────────────────────────────────────────────────────────────
    [[nodiscard]] bool has_content()  const noexcept { return !text.empty(); }
    [[nodiscard]] bool is_indexed()   const noexcept { return indexed_at > 0; }
    [[nodiscard]] bool has_blocks()   const noexcept { return !blocks.empty(); }
    [[nodiscard]] bool has_nlp()      const noexcept { return nlp.has_value(); }

    /// Collect all headings in document order (depth-first).
    [[nodiscard]] std::vector<const Block*> headings() const {
        std::vector<const Block*> out;
        std::function<void(const std::vector<Block>&)> walk =
            [&](const std::vector<Block>& bs) {
                for (const auto& b : bs) {
                    if (b.is_heading()) out.push_back(&b);
                    if (!b.children.empty()) walk(b.children);
                }
            };
        walk(blocks);
        return out;
    }

    /// Collect plain text from all blocks (preserves reading order).
    [[nodiscard]] std::string blocks_as_text() const {
        std::string out;
        std::function<void(const std::vector<Block>&)> walk =
            [&](const std::vector<Block>& bs) {
                for (const auto& b : bs) {
                    if (!b.content.empty()) { out += b.content; out += '\n'; }
                    if (!b.children.empty()) walk(b.children);
                }
            };
        walk(blocks);
        return out;
    }

    // ── Factory helpers ───────────────────────────────────────────────────────

    /// Create a minimal Document from a plain-text string (no blocks, no NLP).
    [[nodiscard]] static Document from_text(std::string path_,
                                             std::string text_,
                                             std::string mime_type_ = "text/plain") {
        Document d;
        d.path      = std::move(path_);
        d.text      = std::move(text_);
        d.mime_type = std::move(mime_type_);
        const auto end = d.text.size() > 280 ? d.text.begin() + 280 : d.text.end();
        d.snippet.assign(d.text.begin(), end);
        return d;
    }
};

// ─── NLP operations on Document (declarations) ────────────────────────────────
//
// Implementations live close to the NLP engine.  Declared here so any layer
// can use them without depending on DMSHandle or NLPEngine headers.
//
// Forward-declare the NLPEngine to keep this header dependency-free.
namespace nlp { class NLPEngine; }

/// Run the full NLP pipeline on a document's text, populating doc.nlp.
/// Engine must outlive the call.  Thread-safe (engine holds its own mutex).
///
/// On success sets doc.nlp and returns a reference to it.
/// On failure returns std::unexpected with the error description.
// Expected<NLPResult> analyze_document(Document& doc, nlp::NLPEngine& engine);

/// Extract named entities from doc.text (does not require prior indexing).
// Expected<std::vector<Entity>> extract_entities(const Document& doc,
//                                                 nlp::NLPEngine& engine);

/// Extract keywords from doc.text.
// Expected<std::vector<Keyword>> extract_keywords(const Document& doc,
//                                                  nlp::NLPEngine& engine,
//                                                  int max_n = 15);

/// One-sentence extractive summary (returns the highest-scoring sentence).
// Expected<std::string> summarize(const Document& doc, nlp::NLPEngine& engine);

} // namespace pce::dms

