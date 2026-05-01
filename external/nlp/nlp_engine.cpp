/**
 * @file nlp_engine.cpp
 * @brief Implementation of NLPModel and NLPEngine classes for ICALL.
 */

#include "nlp_engine.hh"
#include "unicode/unicode_utils.hh"
#include "addons/graph_addon.hh"
#include "addons/ocr_addon.hh"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <regex>
#include <sstream>
#include <unordered_map>
#include <unordered_set>
#include <fstream>

#define STB_IMAGE_IMPLEMENTATION
#include "3rdparty/stb_image.h"
#define STB_IMAGE_RESIZE_IMPLEMENTATION
#include "3rdparty/stb_image_resize2.h"
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "3rdparty/stb_image_write.h"

namespace pce::nlp {

// ============ NLPModel Implementation ============

bool NLPModel::load_from(const std::string& base_path) {
    current_path_ = base_path;
    if (!current_path_.empty() && current_path_.back() != '/' && current_path_.back() != '\\') {
#ifdef _WIN32
        current_path_ += '\\';
#else
        current_path_ += '/';
#endif
    }

    bool success = true;

    // Load Stopwords
    success &= load_file_to_vec(current_path_ + "stopwords_en.txt", data_.stopwords["en"]);
    success &= load_file_to_vec(current_path_ + "stopwords_de.txt", data_.stopwords["de"]);
    success &= load_file_to_vec(current_path_ + "stopwords_fr.txt", data_.stopwords["fr"]);

    // Load Dictionaries
    success &= load_file_to_vec(current_path_ + "dictionary_en.txt", data_.dictionaries["en"]);
    success &= load_file_to_vec(current_path_ + "dictionary_de.txt", data_.dictionaries["de"]);
    success &= load_file_to_vec(current_path_ + "dictionary_fr.txt", data_.dictionaries["fr"]);

    // Load Sentiment Lexicons
    success &= load_lexicon_to_map(current_path_ + "sentiment_positive.txt", data_.positive_lexicon);
    success &= load_lexicon_to_map(current_path_ + "sentiment_negative.txt", data_.negative_lexicon);

    // Load Toxicity Patterns
    success &= load_file_to_vec(current_path_ + "toxic_words.txt", data_.toxic_patterns);

    // Sync legacy views for backward compatibility
    en_stopwords_ = data_.stopwords["en"];
    de_stopwords_ = data_.stopwords["de"];
    fr_stopwords_ = data_.stopwords["fr"];
    en_dict_ = data_.dictionaries["en"];
    de_dict_ = data_.dictionaries["de"];
    fr_dict_ = data_.dictionaries["fr"];
    positive_words_ = data_.positive_lexicon;
    negative_words_ = data_.negative_lexicon;
    toxic_patterns_ = data_.toxic_patterns;

    is_ready_ = success;
    return is_ready_;
}

const std::vector<std::string>& NLPModel::get_stopwords(const std::string& lang) const {
    auto it = data_.stopwords.find(lang);
    if (it != data_.stopwords.end()) {
        return it->second;
    }
    static const std::vector<std::string> empty;
    return empty;
}

const std::vector<std::string>& NLPModel::get_dictionary(const std::string& lang) const {
    auto it = data_.dictionaries.find(lang);
    if (it != data_.dictionaries.end()) {
        return it->second;
    }
    static const std::vector<std::string> empty;
    return empty;
}

bool NLPModel::load_file_to_vec(const std::string& path, std::vector<std::string>& target) {
    std::ifstream file(path);
    if (!file.is_open()) return false;
    target.clear();
    std::string line;
    while (std::getline(file, line)) {
        if (!line.empty() && line[0] != '#') {
            target.push_back(line);
        }
    }
    return true;
}

bool NLPModel::load_lexicon_to_map(const std::string& path, std::map<std::string, float>& target) {
    std::ifstream file(path);
    if (!file.is_open()) return false;
    std::string line;
    while (std::getline(file, line)) {
        if (!line.empty() && line[0] != '#') {
            target[line] = 1.0f; // Default intensity
        }
    }
    return true;
}

// ============ NLPModel::create_empty ============

std::shared_ptr<NLPModel> NLPModel::create_empty() {
    auto m      = std::make_shared<NLPModel>();
    m->is_ready_ = true;
    return m;
}

// ============ NLPEngine Implementation ============

NLPEngine::NLPEngine()
    : model_(NLPModel::create_empty()) {}

NLPEngine::NLPEngine(std::shared_ptr<NLPModel> model) : model_(std::move(model)) {
    if (!model_) throw std::invalid_argument("NLPEngine: model must not be null");
}

NLPEngine::NLPEngine(std::shared_ptr<NLPModel> model,
                     std::shared_ptr<OnnxService> onnx)
    : model_(std::move(model)), onnx_(std::move(onnx)) {
    if (!model_) throw std::invalid_argument("NLPEngine: model must not be null");
}

void NLPEngine::set_ocr_service(std::shared_ptr<OCRAddon> svc) noexcept {
    ocr_ = std::move(svc);
}

void NLPEngine::set_ner_service(std::shared_ptr<OnnxService> svc) noexcept {
    ner_ = std::move(svc);
}

bool NLPEngine::has_ocr() const noexcept {
    return ocr_ != nullptr && ocr_->is_ready();
}

std::string NLPEngine::extract_text_from_image(const std::string& path) {
    if (!has_ocr()) return "";
    return ocr_->extract_text(path);
}

LanguageProfile NLPEngine::detect_language(const std::string& text) {
    LanguageProfile profile{.language = "en", .confidence = 0.0f};
    if (text.empty() || !model_) return profile;

    std::map<std::string, int> scores = {{"en", 0}, {"de", 0}, {"fr", 0}};
    auto tokens = tokenize(text);

    // Create unordered sets for O(1) stopword lookup
    std::unordered_set<std::string> en_stops(model_->get_stopwords("en").begin(), model_->get_stopwords("en").end());
    std::unordered_set<std::string> de_stops(model_->get_stopwords("de").begin(), model_->get_stopwords("de").end());
    std::unordered_set<std::string> fr_stops(model_->get_stopwords("fr").begin(), model_->get_stopwords("fr").end());

    for (const auto& token : tokens) {
        std::string lower_token = unicode::UnicodeUtils::fold_case(token);
        if (en_stops.count(lower_token)) scores["en"]++;
        if (de_stops.count(lower_token)) scores["de"]++;
        if (fr_stops.count(lower_token)) scores["fr"]++;
    }

    std::string best_lang = "en";
    int max_hits = -1;
    int total_hits = 0;

    for (auto const& [lang, count] : scores) {
        total_hits += count;
        if (count > max_hits) {
            max_hits = count;
            best_lang = lang;
        }
    }

    profile.language = (total_hits > 0) ? best_lang : "en";
    profile.confidence = (total_hits > 0) ? (float)max_hits / total_hits : 0.5f;
    return profile;
}

std::vector<std::string> NLPEngine::tokenize(const std::string& text) {
    if (text.empty()) return {};

    // 1. Fold the entire string ONCE (O(1) conversion instead of O(Words))
    std::string folded = unicode::UnicodeUtils::fold_case(text);
    std::vector<std::string> tokens;

    // 2. Use a fast-path scanner
    unicode::UnicodeUtils::CodePointIterator it(folded);
    std::string current_token;
    current_token.reserve(16);

    while (it.has_next()) {
        char32_t cp = it.next();

        // Optimized boundary check: ASCII fast-path + Unicode ranges
        bool is_split = unicode::UnicodeUtils::is_whitespace(cp) ||
                        (cp < 128 && std::ispunct(static_cast<int>(cp))) ||
                        (cp >= 0x00A1 && cp <= 0x00BF) ||
                        (cp >= 0x2000 && cp <= 0x206F) ||
                        (cp >= 0x3000 && cp <= 0x303F);

        if (is_split) {
            if (!current_token.empty()) {
                tokens.push_back(std::move(current_token));
                current_token.clear();
                current_token.reserve(16);
            }
            continue;
        }

        // Append UTF-8 bytes efficiently (ASCII fast-path)
        if (cp < 0x80) {
            current_token += static_cast<char>(cp);
        } else {
            char buf[4];
            size_t len = simdutf::convert_utf32_to_utf8(&cp, 1, buf);
            current_token.append(buf, len);
        }
    }

    if (!current_token.empty()) {
        tokens.push_back(std::move(current_token));
    }

    return tokens;
}

std::vector<std::string> NLPEngine::tokenize_with_case(const std::string& text) {
    if (text.empty()) return {};

    std::vector<std::string> tokens;
    unicode::UnicodeUtils::CodePointIterator it(text);
    std::string current_token;
    current_token.reserve(16);

    while (it.has_next()) {
        char32_t cp = it.next();

        bool is_split = unicode::UnicodeUtils::is_whitespace(cp) ||
                        (cp < 128 && std::ispunct(static_cast<int>(cp))) ||
                        (cp >= 0x00A1 && cp <= 0x00BF) ||
                        (cp >= 0x2000 && cp <= 0x206F) ||
                        (cp >= 0x3000 && cp <= 0x303F);

        if (is_split) {
            if (!current_token.empty()) {
                tokens.push_back(std::move(current_token));
                current_token.clear();
                current_token.reserve(16);
            }
            continue;
        }

        if (cp < 0x80) {
            current_token += static_cast<char>(cp);
        } else {
            char buf[4];
            size_t len = simdutf::convert_utf32_to_utf8(&cp, 1, buf);
            current_token.append(buf, len);
        }
    }

    if (!current_token.empty()) {
        tokens.push_back(std::move(current_token));
    }

    return tokens;
}

std::vector<std::string> NLPEngine::split_sentences(const std::string& text) {
    std::vector<std::string> sentences;
    std::string current;
    bool in_double_quote = false;
    bool in_single_quote = false;

    for (size_t i = 0; i < text.length(); ++i) {
        char c = text[i];
        current += c;

        if (c == '"' && !in_single_quote) in_double_quote = !in_double_quote;
        else if (c == '\'' && !in_double_quote) in_single_quote = !in_single_quote;

        bool in_any_quote = in_double_quote || in_single_quote;

        if (!in_any_quote && (c == '.' || c == '!' || c == '?')) {
            // Check if we are at the end of the string or followed by whitespace
            if (i + 1 == text.length() || std::isspace(static_cast<unsigned char>(text[i + 1]))) {
                size_t first = current.find_first_not_of(" \t\n\r");
                if (first != std::string::npos) {
                    std::string segment = current.substr(first);
                    // Trim trailing whitespace
                    size_t last = segment.find_last_not_of(" \t\n\r");
                    if (last != std::string::npos) {
                        sentences.push_back(segment.substr(0, last + 1));
                    }
                }
                current.clear();
            }
        }
    }

    if (!current.empty()) {
        size_t first = current.find_first_not_of(" \t\n\r");
        if (first != std::string::npos) {
            std::string segment = current.substr(first);
            size_t last = segment.find_last_not_of(" \t\n\r");
            if (last != std::string::npos) {
                sentences.push_back(segment.substr(0, last + 1));
            }
        }
    }
    return sentences;
}

std::vector<std::string> NLPEngine::remove_stopwords(const std::vector<std::string>& tokens, const std::string& lang) {
    if (!model_) return tokens;
    const auto& stopwords = model_->get_stopwords(lang);
    std::unordered_set<std::string> stop_set(stopwords.begin(), stopwords.end());
    std::vector<std::string> filtered;
    for (const auto& t : tokens) {
        if (stop_set.find(t) == stop_set.end()) filtered.push_back(t);
    }
    return filtered;
}

std::string NLPEngine::normalize(const std::string& text) {
    std::string folded = unicode::UnicodeUtils::fold_case(text);
    std::string res;
    res.reserve(folded.size());

    unicode::UnicodeUtils::CodePointIterator it(folded);
    while (it.has_next()) {
        char32_t cp = it.next();
        if (unicode::UnicodeUtils::is_whitespace(cp) ||
            (cp >= 0x21 && cp <= 0x2F) || (cp >= 0x3A && cp <= 0x40) ||
            (cp >= 0x5B && cp <= 0x60) || (cp >= 0x7B && cp <= 0x7E) ||
            (cp >= 0x00A1 && cp <= 0x00BF) || (cp >= 0x2000 && cp <= 0x206F) ||
            (cp >= 0x3000 && cp <= 0x303F)) {
            res += ' ';
        } else {
            char buf[4];
            size_t len = simdutf::convert_utf32_to_utf8(&cp, 1, buf);
            res.append(buf, len);
        }
    }

    // Trim and collapse multiple spaces
    std::string trimmed;
    std::istringstream iss(res);
    std::string word;
    bool first = true;
    while (iss >> word) {
        if (!first) trimmed += " ";
        trimmed += word;
        first = false;
    }
    return trimmed;
}

std::vector<Correction> NLPEngine::spell_check(const std::string& text, const std::string& lang) {
    std::vector<Correction> corrections;
    if (!model_) return corrections;
    auto tokens = tokenize(text);
    const auto& dict = model_->get_dictionary(lang);
    std::unordered_set<std::string> dict_set(dict.begin(), dict.end());

    for (const auto& token : tokens) {
        if (token.length() > 1 && dict_set.find(token) == dict_set.end()) {
            // Collect candidates with their edit distances
            std::vector<std::pair<std::string, int>> candidates;
            for (const auto& dw : dict) {
                int d = levenshtein_distance(token, dw);
                if (d <= 2) candidates.push_back({dw, d});
            }
            if (candidates.empty()) continue;
            std::sort(candidates.begin(), candidates.end(),
                      [](const auto& a, const auto& b) { return a.second < b.second; });
            int best_dist     = candidates[0].second;
            float confidence  = best_dist == 1 ? 0.9f : 0.7f;
            corrections.push_back({token, candidates[0].first, confidence, "Not in dictionary"});
        }
    }
    return corrections;
}

std::vector<std::string> NLPEngine::get_spelling_suggestions(const std::string& word, int max_dist, const std::string& lang) {
    std::vector<std::string> suggestions;
    if (!model_) return suggestions;
    std::vector<std::pair<std::string, int>> candidates;
    const auto& dict = model_->get_dictionary(lang);

    for (const auto& dw : dict) {
        int d = levenshtein_distance(word, dw);
        if (d <= max_dist) candidates.push_back({dw, d});
    }
    std::sort(candidates.begin(), candidates.end(), [](const auto& a, const auto& b) { return a.second < b.second; });
    for (size_t i = 0; i < std::min(size_t(3), candidates.size()); ++i) suggestions.push_back(candidates[i].first);
    return suggestions;
}

int NLPEngine::levenshtein_distance(const std::string& s1, const std::string& s2) {
    size_t n = s1.length(), m = s2.length();
    std::vector<std::vector<int>> d(n + 1, std::vector<int>(m + 1));
    for (size_t i = 0; i <= n; ++i) d[i][0] = i;
    for (size_t j = 0; j <= m; ++j) d[0][j] = j;
    for (size_t i = 1; i <= n; ++i) {
        for (size_t j = 1; j <= m; ++j) {
            int cost = (s1[i - 1] == s2[j - 1]) ? 0 : 1;
            d[i][j] = std::min({d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost});
        }
    }
    return d[n][m];
}

SummaryResult NLPEngine::summarize(const std::string& text, float ratio,
                                    std::string_view query) {
    auto sentences = split_sentences(text);
    if (sentences.empty()) return {{}, {}, ratio, (int)text.length(), 0};

    std::vector<std::pair<size_t, float>> scores;
    scores.reserve(sentences.size());

    // ── Semantic path: ONNX available ────────────────────────────────────────
    std::shared_ptr<OnnxService> onnx_ptr;
    {
        std::shared_lock lock(engine_mutex_);
        if (onnx_ && onnx_->is_loaded()) {
            onnx_ptr = onnx_;
        }
    }

    if (onnx_ptr) {
        // Embed all sentences in one batch for efficiency.
        std::vector<std::string> inputs(sentences.begin(), sentences.end());
        auto embeddings = onnx_ptr->embed_batch(inputs);

        // Determine the anchor: query embedding OR document centroid.
        inference::EmbeddingResult anchor;
        if (!query.empty()) {
            anchor = onnx_ptr->embed(std::string(query));
        } else {
            // Centroid: element-wise mean of all successful embeddings.
            std::vector<float> centroid;
            size_t dims = 0;
            int    valid = 0;
            for (const auto& e : embeddings) {
                if (!e.success) continue;
                if (centroid.empty()) { centroid.resize(e.vector.size(), 0.0f); dims = e.vector.size(); }
                for (size_t d = 0; d < dims; ++d) centroid[d] += e.vector[d];
                ++valid;
            }
            if (valid > 0) {
                float inv = 1.0f / static_cast<float>(valid);
                for (auto& v : centroid) v *= inv;
                // L2-normalise the centroid so dot-product == cosine similarity.
                float norm = 0.0f;
                for (float v : centroid) norm += v * v;
                norm = std::sqrt(norm);
                if (norm > 1e-9f) for (auto& v : centroid) v /= norm;
                anchor.vector  = std::move(centroid);
                anchor.success = true;
            }
        }

        if (anchor.success) {
            for (size_t i = 0; i < embeddings.size(); ++i) {
                float sim = anchor.cosine_similarity(embeddings[i]);
                scores.push_back({i, sim});
            }
        }
    }

    // ── TF-IDF fallback (or ONNX unavailable / all embeddings failed) ────────
    if (scores.empty()) {
        auto tfidf = calculate_tfidf(text);
        for (size_t i = 0; i < sentences.size(); ++i)
            scores.push_back({i, calculate_sentence_score(sentences[i], tfidf)});
    }

    std::sort(scores.begin(), scores.end(),
              [](const auto& a, const auto& b) { return a.second > b.second; });

    size_t count = std::max(size_t(1), size_t(sentences.size() * ratio));
    std::vector<size_t> selected;
    for (size_t i = 0; i < std::min(count, scores.size()); ++i)
        selected.push_back(scores[i].first);
    std::sort(selected.begin(), selected.end());

    std::string summary;
    for (auto idx : selected) { summary += sentences[idx]; summary += ' '; }
    if (!summary.empty() && summary.back() == ' ') summary.pop_back();

    return {std::move(summary), std::move(selected), ratio,
            (int)text.length(), (int)summary.length()};
}

std::map<std::string, float> NLPEngine::calculate_tfidf(const std::string& text,
                                                         const std::string& lang) {
    auto sentences = split_sentences(text);
    auto tokens = tokenize(text);
    auto filtered = remove_stopwords(tokens, lang);
    if (filtered.empty()) return {};

    std::unordered_map<std::string, int> term_counts;
    for (const auto& t : filtered) term_counts[t]++;

    std::map<std::string, float> tfidf;
    for (const auto& [term, count] : term_counts) {
        float tf = (float)count / filtered.size();
        int df = 0;
        for (const auto& s : sentences) {
            std::string ls = unicode::UnicodeUtils::fold_case(s);
            // Search for whole word to avoid partial matches
            size_t pos = ls.find(term);
            if (pos != std::string::npos) {
                // Simple boundary check
                bool start_ok = (pos == 0 || !std::isalnum(static_cast<unsigned char>(ls[pos - 1])));
                bool end_ok = (pos + term.length() == ls.length() || !std::isalnum(static_cast<unsigned char>(ls[pos + term.length()])));
                if (start_ok && end_ok) df++;
            }
        }
        // Use smooth IDF to avoid log(0) and division by zero
        float idf = std::log((float)sentences.size() / (1.0f + df)) + 1.0f;
        tfidf[term] = tf * idf;
    }
    return tfidf;
}

std::vector<Keyword> NLPEngine::extract_keywords(const std::string& text, int max_keywords, const std::string& lang) {
    auto tfidf = calculate_tfidf(text, lang);
    std::vector<Keyword> keywords;
    for (const auto& [term, score] : tfidf) keywords.push_back({term, 0.0f, score, ""});
    std::sort(keywords.begin(), keywords.end(), [](const auto& a, const auto& b) { return a.tfidf_score > b.tfidf_score; });
    if (keywords.size() > (size_t)max_keywords) keywords.resize(max_keywords);
    return keywords;
}

std::vector<std::string> NLPEngine::extract_terminology(const std::string& text, const std::string& lang) {
    std::vector<std::string> terms;
    auto tokens = tokenize_with_case(text);
    if (tokens.empty()) return terms;

    auto tagged = pos_tag(tokens, lang);

    // Heuristic 1: Acronyms (IBM, NASA, etc.) - All caps, length > 1
    for (const auto& token : tokens) {
        if (token.length() > 1 && std::all_of(token.begin(), token.end(), [](unsigned char c) { return std::isupper(c); })) {
            if (std::find(terms.begin(), terms.end(), token) == terms.end()) {
                terms.push_back(token);
            }
        }
    }

    // Heuristic 2: Multi-word Proper Nouns (Noun + Noun where both are capitalized)
    // We look for sequences of Proper Nouns (NNP equivalent in our basic tagger)
    for (size_t i = 0; i < tagged.size(); ++i) {
        if (tagged[i].second == "NNP") {
            std::string compound = tagged[i].first;
            size_t j = i + 1;
            while (j < tagged.size() && tagged[j].second == "NNP") {
                compound += " " + tagged[j].first;
                j++;
            }

            if (j > i + 1) { // It's a compound
                if (std::find(terms.begin(), terms.end(), compound) == terms.end()) {
                    terms.push_back(compound);
                }
                i = j - 1; // Skip the words we just consumed
            } else {
                // Single NNP (like "Linux" or "Apple")
                if (std::find(terms.begin(), terms.end(), compound) == terms.end()) {
                    terms.push_back(compound);
                }
            }
        }
    }

    // Heuristic 3: Technical Noun Phrases (Adjective + Noun)
    for (size_t i = 0; i < tagged.size() - 1; ++i) {
        if (tagged[i].second == "JJ" && tagged[i + 1].second == "NN") {
            std::string phrase = tagged[i].first + " " + tagged[i + 1].first;
            if (std::find(terms.begin(), terms.end(), phrase) == terms.end()) {
                terms.push_back(phrase);
            }
        }
    }

    return terms;
}

std::vector<std::pair<std::string, std::string>> NLPEngine::pos_tag(const std::vector<std::string>& tokens, const std::string& lang) {
    std::vector<std::pair<std::string, std::string>> tagged;
    if (!model_) return tagged;
    const auto& stops = model_->get_stopwords(lang);
    std::unordered_set<std::string> stop_set;
    for (const auto& s : stops) stop_set.insert(unicode::UnicodeUtils::fold_case(s));

    for (size_t i = 0; i < tokens.size(); ++i) {
        const std::string& t = tokens[i];
        std::string lower_t = unicode::UnicodeUtils::fold_case(t);
        std::string tag = "NN"; // Default to Noun

        // Check if it's a stopword/determiner
        if (stop_set.count(lower_t)) {
            tag = "DET";
        }
        // Heuristic for Proper Nouns: Capitalized and not at start of sentence, or All Caps
        else if (!t.empty() && std::isupper(static_cast<unsigned char>(t[0]))) {
            bool is_all_caps = std::all_of(t.begin(), t.end(), [](unsigned char c) { return std::isupper(c); });
            if (is_all_caps || i > 0) {
                tag = "NNP";
            } else {
                // If it's the first word, it might just be capitalized because of the sentence.
                // If it's not in the dictionary as a common word, treat as NNP.
                const auto& dict = model_->get_dictionary(lang);
                if (std::find(dict.begin(), dict.end(), lower_t) == dict.end()) {
                    tag = "NNP";
                }
            }
        }
        // Adverbs ending in -ly
        else if (t.length() > 3 && t.substr(t.length() - 2) == "ly") {
            tag = "ADV";
        }
        // Adjectives ending in -al, -ic, -ive, -ous
        else if (t.length() > 4) {
            std::string suffix2 = t.substr(t.length() - 2);
            std::string suffix3 = t.substr(t.length() - 3);
            if (suffix2 == "al" || suffix2 == "ic" || suffix3 == "ive" || suffix3 == "ous") {
                tag = "JJ";
            }
        }

        tagged.push_back({t, tag});
    }
    return tagged;
}

std::string NLPEngine::stem(const std::string& word, const std::string& lang) {
    std::string s = to_lower(word);
    if (s.length() <= 3) return s;
    if (lang == "en" && s.back() == 's') return s.substr(0, s.length() - 1);
    if (lang == "de" && s.size() > 5 && s.substr(s.size()-2) == "en") return s.substr(0, s.size()-2);
    return s;
}

std::vector<Entity> NLPEngine::extract_entities(const std::string& text, const std::string& lang) {
    std::shared_ptr<OnnxService> ner_ptr;
    {
        std::shared_lock lock(engine_mutex_);
        if (ner_ && ner_->is_loaded()) {
            ner_ptr = ner_;
        }
    }

    if (ner_ptr) {
        const inference::TagResult tag_result = ner_ptr->tag(text);
        if (tag_result.success) {
            std::vector<Entity> entities;
            std::string current_text;
            std::string current_type;
            size_t      current_offset = 0;
            float       current_conf   = 0.0f;
            int         tag_count      = 0;

            for (const auto& t : tag_result.tags) {
                if (t.label.starts_with("B-")) {
                    if (!current_text.empty())
                        entities.push_back({current_text, current_type,
                                            current_offset,
                                            tag_count > 0 ? current_conf / tag_count : 0.8f});
                    current_text   = t.token;
                    current_type   = t.label.substr(2);
                    current_offset = t.offset;
                    current_conf   = t.confidence;
                    tag_count      = 1;
                } else if (t.label.starts_with("I-") && !current_text.empty()) {
                    current_text += " " + t.token;
                    current_conf += t.confidence;
                    ++tag_count;
                } else {
                    if (!current_text.empty()) {
                        entities.push_back({current_text, current_type,
                                            current_offset,
                                            tag_count > 0 ? current_conf / tag_count : 0.8f});
                        current_text.clear();
                        tag_count = 0;
                    }
                }
            }
            if (!current_text.empty())
                entities.push_back({current_text, current_type,
                                    current_offset,
                                    tag_count > 0 ? current_conf / tag_count : 0.8f});
            return entities;
        }
    }

    std::vector<Entity> entities;
    std::regex email_regex(R"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})");
    std::regex capitalized_regex(R"(\b[A-Z][A-Za-z0-9&'-]*(?:\s+[A-Z][A-Za-z0-9&'-]*)*\b)");
    std::regex biomedical_regex(R"(\b(?:DNA|RNA|mRNA|CRISPR|genomics|proteomics|transcriptomics|metabolomics|epigenetics|bioinformatics|biomarker|biomarkers|protein|proteins|genome|genomes|sequence|sequencing)\b)", std::regex_constants::icase);
    std::smatch match;
    std::string::const_iterator search_start(text.cbegin());

    while (std::regex_search(search_start, text.cend(), match, email_regex)) {
        entities.push_back({match[0], "email", (size_t)std::distance(text.cbegin(), match[0].first), 0.95f});
        search_start = match.suffix().first;
    }

    search_start = text.cbegin();
    while (std::regex_search(search_start, text.cend(), match, capitalized_regex)) {
        std::string entity_text = match[0];
        if (entity_text.size() >= 2) {
            entities.push_back({entity_text, "entity", (size_t)std::distance(text.cbegin(), match[0].first), 0.75f});
        }
        search_start = match.suffix().first;
    }

    search_start = text.cbegin();
    while (std::regex_search(search_start, text.cend(), match, biomedical_regex)) {
        std::string entity_text = match[0];
        if (entity_text.size() >= 2) {
            entities.push_back({entity_text, "biomedical", (size_t)std::distance(text.cbegin(), match[0].first), 0.85f});
        }
        search_start = match.suffix().first;
    }

    return entities;
}

void NLPEngine::build_knowledge_graph(const std::string& text, GraphAddon& graph, int window_size) {
    auto entities = extract_entities(text);
    if (entities.empty()) return;

    std::sort(entities.begin(), entities.end(),
              [](const Entity& a, const Entity& b) { return a.position < b.position; });

    // Link entities that appear within a sliding proximity window.
    // This intentionally creates denser, cluster-friendly links so graph
    // community detection can group related entities more reliably.
    const size_t max_distance = static_cast<size_t>(std::max(1, window_size)) * 60;
    for (size_t i = 0; i < entities.size(); ++i) {
        for (size_t j = i + 1; j < entities.size(); ++j) {
            size_t distance = entities[j].position - entities[i].position;
            if (distance > max_distance) {
                break;
            }

            float weight = 1.0f;

            // Prefer nearby entities and slightly strengthen direct co-occurrence.
            if (distance < 120) {
                weight += 0.5f;
            }
            if (entities[i].type == entities[j].type) {
                weight += 0.25f;
            }

            graph.add_relationship(entities[i].text, entities[i].type,
                                   entities[j].text, entities[j].type, weight);
        }
    }
}

ReadabilityMetrics NLPEngine::analyze_readability(const std::string& text) {
    auto sentences = split_sentences(text);
    auto tokens = tokenize(text);
    int words = static_cast<int>(tokens.size());
    int sents = std::max(1, static_cast<int>(sentences.size()));
    if (words == 0) return {0.0f, 0.0f, "unknown", {}, 0, sents, 0.0f};

    int syllables = 0;
    for (const auto& t : tokens) syllables += count_syllables(t);

    float avg_sent = static_cast<float>(words) / sents;
    float avg_syl  = static_cast<float>(syllables) / words;
    float score    = 206.835f - 1.015f * avg_sent - 84.6f * avg_syl;
    float grade    = 0.39f   * avg_sent + 11.8f * avg_syl - 15.59f;
    std::string complexity = score > 70.0f ? "easy" : (score < 40.0f ? "hard" : "medium");

    return {grade, score, std::move(complexity), {}, words, sents, avg_sent};
}

SentimentResult NLPEngine::analyze_sentiment(const std::string& text, const std::string& lang) {
    std::shared_ptr<ClassifierService> sentiment_ptr;
    {
        std::shared_lock lock(engine_mutex_);
        if (sentiment_ && sentiment_->is_loaded()) {
            sentiment_ptr = sentiment_;
        }
    }

    if (sentiment_ptr) {
        auto labels = sentiment_ptr->classify(text);
        if (!labels.empty()) {
            const std::string name_lower = to_lower(labels[0].name);
            float score = name_lower == "positive"  ?  labels[0].score
                        : name_lower == "negative"  ? -labels[0].score
                        : 0.0f;
            std::string label = name_lower == "positive" ? "positive"
                              : name_lower == "negative" ? "negative"
                              : "neutral";
            return {score, std::move(label), labels[0].score};
        }
    }

    if (!model_) return {0.0f, "neutral", 0.0f};
    auto tokens = tokenize(text);
    int pos = 0, neg = 0;
    const auto& pos_lex = model_->get_positive_lexicon();
    const auto& neg_lex = model_->get_negative_lexicon();
    for (const auto& t : tokens) {
        if (pos_lex.count(t)) pos++;
        if (neg_lex.count(t)) neg++;
    }
    int total = pos + neg;
    if (total == 0) return {0.0f, "neutral", 0.0f};
    float score      = static_cast<float>(pos - neg) / total;
    float confidence = static_cast<float>(std::max(pos, neg)) / total;
    std::string label = score > 0.1f ? "positive" : (score < -0.1f ? "negative" : "neutral");
    return {score, std::move(label), confidence};
}

ToxicityResult NLPEngine::detect_toxicity(const std::string& text, const std::string& lang) {
    std::shared_ptr<ClassifierService> toxicity_ptr;
    {
        std::shared_lock lock(engine_mutex_);
        if (toxicity_ && toxicity_->is_loaded()) {
            toxicity_ptr = toxicity_;
        }
    }

    if (toxicity_ptr) {
        auto labels = toxicity_ptr->classify(text);
        ToxicityResult res{false, 0.0f, {}, "none"};
        float max_score = 0.0f;
        for (const auto& l : labels) {
            max_score = std::max(max_score, l.score);
            if (l.score > 0.5f) {
                res.is_toxic = true;
                res.triggers.push_back(l.name);
            }
        }
        res.score    = max_score;
        res.category = res.is_toxic ? "neural" : "none";
        return res;
    }

    ToxicityResult res{false, 0.0f, {}, "none"};
    if (!model_) return res;
    std::string lower = unicode::UnicodeUtils::fold_case(text);
    for (const auto& p : model_->get_toxic_patterns()) {
        if (lower.find(p) != std::string::npos) {
            res.is_toxic = true;
            res.triggers.push_back(p);
            res.score = std::min(1.0f, res.score + 0.4f);
            res.category = "offensive";
        }
    }
    return res;
}

// --- Internal Helpers ---

std::string NLPEngine::to_lower(const std::string& str) {
    return unicode::UnicodeUtils::fold_case(str);
}

std::string NLPEngine::remove_punctuation(const std::string& str) {
    std::string res;
    unicode::UnicodeUtils::CodePointIterator it(str);
    while (it.has_next()) {
        char32_t cp = it.next();
        if (!((cp >= 0x21 && cp <= 0x2F) || (cp >= 0x3A && cp <= 0x40) ||
              (cp >= 0x5B && cp <= 0x60) || (cp >= 0x7B && cp <= 0x7E) ||
              (cp >= 0x00A1 && cp <= 0x00BF) || (cp >= 0x2000 && cp <= 0x206F) ||
              (cp >= 0x3000 && cp <= 0x303F))) {
            char buf[4];
            size_t len = simdutf::convert_utf32_to_utf8(&cp, 1, buf);
            res.append(buf, len);
        }
    }
    return res;
}

int NLPEngine::count_syllables(const std::string& word) {
    int count = 0;
    bool last_vowel = false;
    std::string w = word;
    std::transform(w.begin(), w.end(), w.begin(), [](unsigned char c) { return std::tolower(c); });
    for (char c : w) {
        bool is_vowel = (c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'u' || c == 'y');
        if (is_vowel && !last_vowel) count++;
        last_vowel = is_vowel;
    }
    if (w.length() > 2 && w.back() == 'e') count--;
    return std::max(1, count);
}

float NLPEngine::calculate_sentence_score(const std::string& sentence, const std::map<std::string, float>& scores) {
    auto tokens = tokenize(sentence);
    float sum = 0;
    int count = 0;
    for (const auto& t : tokens) {
        auto it = scores.find(t);
        if (it != scores.end()) { sum += it->second; count++; }
    }
    return count > 0 ? sum / count : 0;
}

// --- Serialization ---

json NLPEngine::corrections_to_json(const std::vector<Correction>& corrections) {
    json j = json::array();
    for (const auto& c : corrections) {
        j.push_back({
            {"original",   c.original},
            {"suggested",  c.suggested},
            {"confidence", c.confidence},
            {"reason",     c.reason},
        });
    }
    return j;
}

json NLPEngine::keywords_to_json(const std::vector<Keyword>& keywords) {
    json j = json::array();
    for (const auto& k : keywords) {
        j.push_back({
            {"term",        k.term},
            {"frequency",   k.frequency},
            {"tfidf_score", k.tfidf_score},
            {"pos",         k.pos},
        });
    }
    return j;
}

json NLPEngine::entities_to_json(const std::vector<Entity>& entities) {
    json j = json::array();
    for (const auto& e : entities) {
        j.push_back({
            {"text",       e.text},
            {"type",       e.type},
            {"position",   e.position},
            {"confidence", e.confidence},
        });
    }
    return j;
}

json NLPEngine::language_to_json(const LanguageProfile& profile) {
    json dist = json::object();
    for (const auto& [script, pct] : profile.script_distribution)
        dist[script] = pct;
    return {
        {"language",            profile.language},
        {"confidence",          profile.confidence},
        {"script_distribution", std::move(dist)},
    };
}

json NLPEngine::readability_to_json(const ReadabilityMetrics& metrics) {
    return {
        {"flesch_kincaid_grade",  metrics.flesch_kincaid_grade},
        {"readability_score",     metrics.readability_score},
        {"complexity",            metrics.complexity},
        {"word_count",            metrics.word_count},
        {"sentence_count",        metrics.sentence_count},
        {"avg_sentence_length",   metrics.avg_sentence_length},
        {"suggestions",           metrics.suggestions},
    };
}

json NLPEngine::summary_to_json(const SummaryResult& s) {
    return {
        {"summary",            s.summary},
        {"selected_sentences", s.selected_sentences},
        {"ratio",              s.ratio},
        {"original_length",    s.original_length},
        {"summary_length",     s.summary_length},
    };
}

json NLPEngine::sentiment_to_json(const SentimentResult& s) {
    return {
        {"score",      s.score},
        {"label",      s.label},
        {"confidence", s.confidence},
    };
}

json NLPEngine::toxicity_to_json(const ToxicityResult& t) {
    return {
        {"is_toxic", t.is_toxic},
        {"score",    t.score},
        {"triggers", t.triggers},
        {"category", t.category},
    };
}

// ── ONNX-powered semantic methods ────────────────────────────────────────────

inference::EmbeddingResult NLPEngine::embed(std::string_view text) {
    std::shared_ptr<OnnxService> onnx_ptr;
    {
        std::shared_lock lock(engine_mutex_);
        onnx_ptr = onnx_;
    }

    if (!onnx_ptr || !onnx_ptr->is_loaded()) {
        inference::EmbeddingResult r;
        r.success = false;
        r.error   = "No ONNX service attached — call set_onnx_service() first.";
        return r;
    }
    return onnx_ptr->embed(std::string(text));
}

std::vector<SemanticMatch> NLPEngine::semantic_search(
        std::string_view query,
        const std::vector<std::string>& documents,
        size_t top_k) {

    std::shared_ptr<OnnxService> onnx_ptr;
    {
        std::shared_lock lock(engine_mutex_);
        if (onnx_ && onnx_->is_loaded()) {
            onnx_ptr = onnx_;
        }
    }

    if (!onnx_ptr || documents.empty()) return {};

    // Embed query once.
    auto q_emb = onnx_ptr->embed(std::string(query));
    if (!q_emb.success) return {};

    // Embed all documents in a single batch.
    auto doc_embs = onnx_ptr->embed_batch(documents);

    std::vector<SemanticMatch> results;
    results.reserve(doc_embs.size());

    for (size_t i = 0; i < doc_embs.size(); ++i) {
        if (!doc_embs[i].success) continue;
        float score = q_emb.cosine_similarity(doc_embs[i]);
        results.push_back({documents[i], score, i});
    }

    std::sort(results.begin(), results.end(),
              [](const SemanticMatch& a, const SemanticMatch& b) {
                  return a.score > b.score;
              });

    if (top_k > 0 && results.size() > top_k)
        results.resize(top_k);

    return results;
}

json NLPEngine::extract_schema(const std::string& text,
                                const json& schema,
                                const std::vector<SchemaField>& fields) {
    json result;
    json scores_obj;

    std::shared_ptr<OnnxService> onnx_ptr;
    {
        std::shared_lock lock(engine_mutex_);
        if (onnx_ && onnx_->is_loaded()) {
            onnx_ptr = onnx_;
        }
    }

    if (!onnx_ptr) {
        result["_error"] = "No ONNX service attached.";
        return result;
    }

    // Build field list: explicit override takes priority over schema JSON.
    std::vector<SchemaField> field_list = fields;
    if (field_list.empty()) {
        for (auto it = schema.begin(); it != schema.end(); ++it) {
            std::string desc = it.value().is_string()
                               ? it.value().get<std::string>()
                               : it.key();  // Fallback: use key as hint.
            field_list.push_back({it.key(), desc});
        }
    }

    if (field_list.empty()) {
        result["_error"] = "Schema is empty.";
        return result;
    }

    // Split text into candidate sentences.
    auto sentences = split_sentences(text);
    if (sentences.empty()) return result;

    // Embed all sentences once — shared across all fields.
    auto sent_embs = onnx_ptr->embed_batch(
        std::vector<std::string>(sentences.begin(), sentences.end()));

    // For each schema field: embed the description, find the best sentence.
    for (const auto& field : field_list) {
        auto field_emb = onnx_ptr->embed(field.description);
        if (!field_emb.success) {
            result[field.name]          = nullptr;
            scores_obj[field.name]      = 0.0f;
            continue;
        }

        size_t best_idx   = 0;
        float  best_score = -2.0f;

        for (size_t i = 0; i < sent_embs.size(); ++i) {
            if (!sent_embs[i].success) continue;
            float sim = field_emb.cosine_similarity(sent_embs[i]);
            if (sim > best_score) {
                best_score = sim;
                best_idx   = i;
            }
        }

        result[field.name]     = (best_score > -2.0f) ? sentences[best_idx] : "";
        scores_obj[field.name] = best_score;
    }

    result["_scores"] = std::move(scores_obj);
    return result;
}

} // namespace pce::nlp
