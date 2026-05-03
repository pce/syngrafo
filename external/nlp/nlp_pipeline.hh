#pragma once
/**
 * @file nlp_pipeline.hh
 * @author Patrick Engel
 * @brief  Composable text-processing pipeline for NLPEngine.
 *
 * Mirrors the pce::dms::stage() / operator| pattern from app/core/pipeline.hh
 * so that both the DMS binding layer and raw NLP callers share the same
 * composable Expected<T> idiom.
 *
 * ## Pipeline stages
 *
 * ```
 * std::string  ──[Stage 0: URL pre-strip]──▶  std::string
 *              ──[Stage 1: tokenize      ]──▶  TokenList
 *              ──[Stage 2: filter        ]──▶  TokenList  (TokenResult)
 * ```
 *
 * ## Quick usage
 *
 * @code{.cpp}
 *   #include "nlp_pipeline.hh"
 *   using pce::nlp::process_text;
 *
 *   // Defaults: EN stopwords, web + extension filters on, repo filter off.
 *   auto result = process_text(engine, raw_text);
 *   if (result)
 *       for (const auto& tok : *result) { ... }
 *
 *   // German prose — no repo-token filter.
 *   auto de = process_text(engine, text, {.lang = "de", .repo = false});
 *
 *   // Developer changelog — enable forge path segment filter.
 *   auto dev = process_text(engine, text, {.lang = "en", .repo = true});
 * @endcode
 *
 * ## Manual Expected<T> chain (using core/pipeline.hh)
 *
 * When running inside the DMS binding layer, the pce::dms::stage()
 * operator| is available via app/core/pipeline.hh:
 *
 * @code{.cpp}
 *   using pce::dms::stage;
 *   using pce::nlp::TokenResult;
 *
 *   auto kw = std::expected<std::string, std::string>{text}
 *       | stage([&](std::string s) -> TokenResult {
 *             auto t = engine.tokenize(s);
 *             if (t.empty()) return std::unexpected("empty tokenisation");
 *             return t;
 *         })
 *       | stage([&](TokenList t) -> TokenResult {
 *             return engine.filter_tokens(t, {.lang = lang});
 *         });
 * @endcode
 */

#include "nlp_engine.hh"
#include <expected>
#include <string>
#include <vector>

namespace pce::nlp {

/// Convenience alias: a filtered / unfiltered list of string tokens.
using TokenList   = std::vector<std::string>;

/// Expected result type used by pipeline stages.
using TokenResult = std::expected<TokenList, std::string>;


// ─────────────────────────────────────────────────────────────────────────────
//  Stage 0 helper: URL pre-strip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @brief Strip bare http(s)/ftp URLs from text before tokenisation.
 *
 * When a document contains inline hyperlinks such as
 *   "See https://github.com/user/repo/blob/main for details."
 * the tokeniser would otherwise split those into isolated tokens
 * ("github", "com", "blob", "main", "md" …).
 *
 * This pass removes entire URL tokens so the disambiguation problem for
 * 2-letter country-code TLDs ("de", "fr", "uk" …) never arises.
 *
 * @param text  UTF-8 input text.
 * @return Copy of text with http(s)://… and ftp://… tokens replaced by a space.
 */
[[nodiscard]] inline std::string strip_urls(const std::string& text) {
    if (text.empty()) return text;
    std::string out;
    out.reserve(text.size());
    size_t i = 0;
    while (i < text.size()) {
        // Fast prefix scan — only branch on 'h' or 'f'.
        const char c = text[i];
        bool is_url = false;
        if (c == 'h') {
            is_url = (text.compare(i, 8, "https://") == 0 ||
                      text.compare(i, 7, "http://")  == 0);
        } else if (c == 'f') {
            is_url = (text.compare(i, 6, "ftp://")   == 0);
        } else if (c == 's') {
            is_url = (text.compare(i, 7, "sftp://")  == 0);
        }

        if (is_url) {
            // Advance past all non-whitespace characters of the URL token.
            while (i < text.size() &&
                   !std::isspace(static_cast<unsigned char>(text[i])))
                ++i;
            out += ' ';
        } else {
            out += text[i++];
        }
    }
    return out;
}


// ─────────────────────────────────────────────────────────────────────────────
//  Full pipeline entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @brief Run the complete text-processing pipeline on a document.
 *
 * Executes three stages in sequence:
 *   0. strip_urls()        — remove bare URL tokens before tokenisation
 *   1. engine.tokenize()   — Unicode word splitter with case-folding
 *   2. engine.filter_tokens() — structural + model-file filter (see FilterConfig)
 *
 * Returns an empty TokenList (not an error) when the input is empty or
 * produces no tokens after filtering.
 *
 * @param engine  NLPEngine instance (model must be loaded for full effect).
 * @param text    Raw UTF-8 input text.
 * @param cfg     Filter configuration — defaults produce the same behaviour
 *                as the old remove_stopwords() call.
 * @return TokenResult (std::expected<TokenList, std::string>).
 */
[[nodiscard]] inline TokenResult
process_text(NLPEngine& engine,
             const std::string& text,
             const FilterConfig& cfg = {})
{
    if (text.empty()) return TokenList{};

    // Stage 0: URL pre-strip
    const std::string clean = strip_urls(text);

    // Stage 1: tokenise
    auto tokens = engine.tokenize(clean);
    if (tokens.empty()) return TokenList{};

    // Stage 2: filter (structural + model-file driven)
    return engine.filter_tokens(tokens, cfg);
}

} // namespace pce::nlp

