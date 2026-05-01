/**
 * @file nlp_engine.hh
 * @brief Core NLP processing components and linguistic model management.
 */

#pragma once

#ifndef PAPIERE_EXTERNAL_NLP_HH
#define PAPIERE_EXTERNAL_NLP_HH

#include <mutex>
#include <shared_mutex>
#include <string>
#include <vector>
#include <map>
#include <memory>
#include <unordered_map>
#include <optional>
#include <nlohmann/json.hpp>

#include "nlp/version.hh"
#include "addons/onnx/onnx_service.hh"
#include "addons/onnx/inference_result.hh"
#include "addons/onnx/classifier_service.hh"

#include "addons/ocr_addon.hh"

namespace pce::nlp {

class OCRAddon;

/** @brief Alias for the embedding/tagging service interface. */
using OnnxService       = onnx::IOnnxService;

/** @brief Alias for the text-classification service interface. */
using ClassifierService = onnx::IClassifierService;

using json = nlohmann::json;

class GraphAddon;


struct Correction {
  std::string original;
  std::string suggested;
  float confidence;
  std::string reason;
};

struct Keyword {
  std::string term;
  float frequency;
  float tfidf_score;
  std::string pos;
};

struct Entity {
  std::string text;
  std::string type;
  size_t position;
  float confidence;
};

struct ReadabilityMetrics {
  float flesch_kincaid_grade;
  float readability_score;
  std::string complexity;
  std::vector<std::string> suggestions;
  int word_count;
  int sentence_count;
  float avg_sentence_length;
};

struct SummaryResult {
  std::string summary;
  std::vector<size_t> selected_sentences;
  float ratio;
  int original_length;
  int summary_length;
};

/**
 * @struct SemanticMatch
 * @brief A single result from semantic_search(): a document with its cosine
 *        similarity score relative to the query embedding.
 *
 * Results are returned sorted by score descending so callers can simply
 * take the first N entries.
 */
struct SemanticMatch {
  std::string text;      ///< The matched document / sentence.
  float       score;     ///< Cosine similarity to query — range [-1, 1].
  size_t      index;     ///< Original index in the input collection.
};

/**
 * @struct SchemaField
 * @brief A single field descriptor used by extract_schema().
 *
 * Supply a JSON object whose keys are field names and whose values are
 * plain-text descriptions of what to look for, e.g.:
 *   { "company": "name of the hiring company",
 *     "title":   "job title or role",
 *     "salary":  "compensation or salary range" }
 *
 * The engine embeds each description and each candidate sentence, then
 * picks the best-matching sentence per field.
 */
struct SchemaField {
  std::string name;        ///< Field key, e.g. "company".
  std::string description; ///< Natural-language hint for semantic matching.
};

struct LanguageProfile {
  std::string language;
  float confidence;
  std::map<std::string, float> script_distribution;
};

struct SentimentResult {
  float score;
  std::string label;
  float confidence;
};

struct ToxicityResult {
  bool is_toxic;
  float score;
  std::vector<std::string> triggers;
  std::string category;
};

struct DocumentStructure {
  std::string doc_type;
  std::vector<std::string> sections;
  std::vector<std::string> headings;
  int estimated_reading_time;
  float estimated_complexity;
};

// ============ Data Model ============

/**
 * @class NLPModel
 * @brief Manages the loading and storage of linguistic resources (dictionaries, lexicons).
 *
 * Separating data from logic allows for resource sharing between multiple engines
 * and simplifies cross-platform path management. This class is designed to be
 * read-only after initialization to ensure thread safety across multiple engine instances.
 */
class NLPModel {
public:
  /**
   * @brief Default constructor.
   */
  NLPModel() = default;

  /**
   * @brief Create a ready model with empty data — no files required.
   *
   * All accessors return empty containers.  Classical NLP methods degrade
   * gracefully to fallback results.  Use this when only ONNX services will
   * be loaded and dictionary-based features are not needed.
   */
  static std::shared_ptr<NLPModel> create_empty();

  /**
   * @brief Destructor.
   */
  ~NLPModel() = default;

  /**
   * @brief Load all resources from a specific directory.
   *
   * Expects a directory structure containing language-specific files (e.g., 'en_stopwords.txt')
   * and global sentiment lexicons.
   *
   * @param base_path Path to the directory containing .txt resource files.
   * @return true if critical resources were successfully loaded.
   */
  bool load_from(const std::string& base_path);

  /**
   * @brief Retrieves stopword list for a specific language.
   * @param lang Language code (e.g., "en", "de", "fr").
   * @return Vector of stopword strings.
   */
  const std::vector<std::string>& get_stopwords(const std::string& lang) const;

  /**
   * @brief Retrieves dictionary word list for a specific language.
   * @param lang Language code.
   * @return Vector of valid dictionary words.
   */
  const std::vector<std::string>& get_dictionary(const std::string& lang) const;

  /**
   * @brief Gets the positive sentiment lexicon.
   * @return Map of word to positive sentiment score.
   */
  const std::map<std::string, float>& get_positive_lexicon() const { return positive_words_; }

  /**
   * @brief Gets the negative sentiment lexicon.
   * @return Map of word to negative sentiment score.
   */
  const std::map<std::string, float>& get_negative_lexicon() const { return negative_words_; }

  /**
   * @brief Gets patterns used for toxicity detection.
   * @return Vector of regex or keyword patterns.
   */
  const std::vector<std::string>& get_toxic_patterns() const { return toxic_patterns_; }

  /**
   * @brief Checks if the model has been successfully loaded.
   */
  bool is_ready() const { return is_ready_; }

  /**
   * @brief Returns the absolute path from which resources were loaded.
   */
  std::string get_current_path() const { return current_path_; }

  /**
   * @struct DataModel
   * @brief Internal storage for all linguistic resources.
   */
  struct DataModel {
    std::map<std::string, std::vector<std::string>> stopwords;    ///< Map of language codes to lists of stop words.
    std::map<std::string, std::vector<std::string>> dictionaries;  ///< Map of language codes to full dictionary word lists.
    std::map<std::string, float> positive_lexicon;                ///< Map of words to positive sentiment scores.
    std::map<std::string, float> negative_lexicon;                ///< Map of words to negative sentiment scores.
    std::vector<std::string> toxic_patterns;                      ///< List of patterns/words used for toxicity detection.
  };

  const DataModel& get_data() const { return data_; }

private:
  bool is_ready_ = false;
  std::string current_path_;

  DataModel data_;

  // Language Resources (cached view for legacy getters)
  std::vector<std::string> en_stopwords_, de_stopwords_, fr_stopwords_;
  std::vector<std::string> en_dict_, de_dict_, fr_dict_;

  // Sentiment & Toxicity Resources (cached view for legacy getters)
  std::map<std::string, float> positive_words_;
  std::map<std::string, float> negative_words_;
  std::vector<std::string> toxic_patterns_;

  // Internal Loader Helpers
  bool load_file_to_vec(const std::string& path, std::vector<std::string>& target);
  bool load_lexicon_to_map(const std::string& path, std::map<std::string, float>& target);
};


/**
 * @class NLPEngine
 * @brief Stateless processing logic for NLP tasks.
 *
 * Requires an NLPModel to perform language-aware operations.
 */
/**
 * @class NLPEngine
 * @brief Stateless processing logic for NLP tasks.
 *
 * Requires an NLPModel to perform language-aware operations.
 * Designed for high-performance synchronous execution.
 */
class NLPEngine {
public:
  /**
   * @brief Construct engine with a shared model.
   * @param model Non-null pointer to an NLPModel (need not be loaded yet).
   * @throws std::invalid_argument if model is null.
   */
  /**
   * @brief Construct with an empty model so no data files are required.
   *
   * Equivalent to `NLPEngine(NLPModel::create_empty())`.  Classical features
   * degrade gracefully; attach ONNX service slots for neural coverage.
   */
  NLPEngine();

  explicit NLPEngine(std::shared_ptr<NLPModel> model);

  /**
   * @brief Construct engine with a model and a pre-built ONNX service.
   *
   * Convenience overload so callers do not need a separate set_onnx_service()
   * call when they already have an ONNXAddon ready.
   *
   * @param model  Non-null NLPModel.
   * @param onnx   Loaded IOnnxService (e.g. an ONNXAddon with load_model() called).
   * @throws std::invalid_argument if model is null.
   */
  NLPEngine(std::shared_ptr<NLPModel> model,
            std::shared_ptr<OnnxService> onnx);

  ~NLPEngine() = default;


  /**
   * @brief Attach (or replace) the ONNX inference service.
   *
   * Thread-safety: call this before the engine is shared across threads.
   * The engine stores a shared_ptr so the service lifetime is managed
   * automatically.
   *
   * @param svc  A loaded IOnnxService, or nullptr to detach.
   */
  /** @brief Attach the sentence-embedding service (all-MiniLM-L6-v2). */
  void set_onnx_service(std::shared_ptr<OnnxService> svc) noexcept {
    onnx_ = std::move(svc);
  }

  /**
   * @brief Attach a sentiment classifier (e.g. DistilBERT SST-2).
   *
   * When set, analyze_sentiment() uses this model instead of the lexicon.
   * Expected labels in id2label order: NEGATIVE (0), POSITIVE (1).
   */
  void set_sentiment_service(std::shared_ptr<ClassifierService> svc) noexcept {
    sentiment_ = std::move(svc);
  }

  /**
   * @brief Attach a toxicity classifier (e.g. Toxic-BERT).
   *
   * When set, detect_toxicity() uses this model instead of the word list.
   * Supports both softmax (binary) and sigmoid (multi-label) classifiers.
   */
  void set_toxicity_service(std::shared_ptr<ClassifierService> svc) noexcept {
    toxicity_ = std::move(svc);
  }

  /**
   * @brief Attach a NER service (e.g. bert-base-NER).
   *
   * When set, extract_entities() uses IOnnxService::tag() with BIO labels
   * instead of the regex and capitalisation heuristics.
   */
  void set_ner_service(std::shared_ptr<OnnxService> svc) noexcept;
  void set_ocr_service(std::shared_ptr<OCRAddon> svc) noexcept;


  /**
   * @brief Returns true when an ONNX service is attached and loaded.
   *
   * Gate all semantic methods behind this check when building on top of
   * NLPEngine — they return empty / fallback results when it is false.
   */
  /** @brief True when the embedding service is attached and loaded. */
  [[nodiscard]] bool has_onnx() const noexcept {
    return onnx_ != nullptr && onnx_->is_loaded();
  }

  /** @brief True when the sentiment classifier is attached and loaded. */
  [[nodiscard]] bool has_sentiment_model() const noexcept {
    return sentiment_ != nullptr && sentiment_->is_loaded();
  }

  /** @brief True when the NER service is attached and loaded. */
  [[nodiscard]] bool has_ner_model() const noexcept {
    return ner_ != nullptr && ner_->is_loaded();
  }

  /** @brief True when the toxicity classifier is attached and loaded. */
  [[nodiscard]] bool has_toxicity_model() const noexcept {
    return toxicity_ != nullptr && toxicity_->is_loaded();
  }

  /** @brief True when the OCR service is attached and ready. */
  [[nodiscard]] bool has_ocr() const noexcept;



  /**
   * @brief Detects the primary language of the input text.
   * @param text Input text.
   * @return LanguageProfile including language code and confidence.
   */
  LanguageProfile detect_language(const std::string& text);

  /**
   * @brief Tokenizes text into individual words or punctuation marks.
   */
  std::vector<std::string> tokenize(const std::string& text);

  /**
   * @brief Tokenizes text while preserving original case and removing punctuation.
   */
  std::vector<std::string> tokenize_with_case(const std::string& text);

  /**
   * @brief Splits a document into individual sentences.
   */
  std::vector<std::string> split_sentences(const std::string& text);

  /**
   * @brief Removes common stop words from a token stream.
   * @param tokens Vector of tokens.
   * @param lang Language code.
   */
  std::vector<std::string> remove_stopwords(const std::vector<std::string>& tokens, const std::string& lang = "en");

  /**
   * @brief Normalizes text (lowercasing, punctuation cleanup).
   */
  std::string normalize(const std::string& text);

  /**
   * @brief Checks spelling and provides corrections for a text.
   */
  std::vector<Correction> spell_check(const std::string& text, const std::string& lang = "en");

  /**
   * @brief Gets similar words for a given misspelled word.
   */
  std::vector<std::string> get_spelling_suggestions(const std::string& word, int max_dist = 2, const std::string& lang = "en");

  /**
   * @brief Calculates edit distance between two strings.
   */
  static int levenshtein_distance(const std::string& s1, const std::string& s2);

  /**
   * @brief Generates an extractive summary of the text.
   *
   * When an ONNX service is attached the sentences are ranked by their
   * cosine similarity to the centroid of the whole document (semantic
   * extractive summarisation).  Without ONNX it falls back to the
   * TF-IDF sentence scorer already in the engine.
   *
   * @param ratio  Fraction of sentences to keep (0.1 – 1.0).
   * @param query  Optional focus query. When non-empty the summary is
   *               biased toward sentences semantically close to the query
   *               rather than the document centroid.
   */
  SummaryResult summarize(const std::string& text, float ratio = 0.3,
                          std::string_view query = {});

  /**
   * @brief Calculates term frequency - inverse document frequency scores.
   * @param lang ISO-639-1 language code used for stopword filtering (default "en").
   */
  std::map<std::string, float> calculate_tfidf(const std::string& text,
                                                const std::string& lang = "en");

  /**
   * @brief Extracts the most relevant keywords from a text.
   */
  std::vector<Keyword> extract_keywords(const std::string& text, int max_keywords = 10, const std::string& lang = "en");

  /**
   * @brief Identifies technical or domain-specific terminology using POS and capitalization heuristics.
   */
  std::vector<std::string> extract_terminology(const std::string& text, const std::string& lang = "en");

  /**
   * @brief Performs Part-of-Speech tagging (Noun, Verb, etc.).
   */
  std::vector<std::pair<std::string, std::string>> pos_tag(const std::vector<std::string>& tokens, const std::string& lang = "en");

  /**
   * @brief Reduces a word to its linguistic stem.
   */
  std::string stem(const std::string& word, const std::string& lang = "en");

  /**
   * @brief Extracts named entities (Names, Locations, Dates).
   */
  std::vector<Entity> extract_entities(const std::string& text, const std::string& lang = "en");

  // Semantic / ONNX-powered methods
  // All methods below require has_onnx() == true.  When called without an
  // attached service they return empty containers or a zeroed-out result so
  // callers never crash — they just get no semantic enrichment.

  /**
   * @brief Encode text to a dense L2-normalised embedding vector.
   *
   * Thin delegation to IOnnxService::embed(). Provided here so higher-level
   * code only needs to hold an NLPEngine reference.
   *
   * @param text  Input sentence or passage (UTF-8).
   * @return EmbeddingResult; check `.success` before consuming `.vector`.
   */
  [[nodiscard]] inference::EmbeddingResult
  embed(std::string_view text);

  /**
   * @brief Rank a collection of documents by semantic similarity to a query.
   *
   * Each document is embedded once; the query is embedded once; results are
   * sorted by cosine similarity descending.  The caller can take the top-k
   * entries for retrieval-augmented tasks.
   *
   * @param query     Natural-language query string.
   * @param documents Collection of texts to rank.
   * @param top_k     Maximum number of results to return (0 = all).
   * @return Vector of SemanticMatch, sorted best-first.
   */
  [[nodiscard]] std::vector<SemanticMatch>
  semantic_search(std::string_view query,
                  const std::vector<std::string>& documents,
                  size_t top_k = 0);

  /**
   * @brief Extract structured data from free text using a JSON schema template.
   *
   * ### How it works
   * 1. The `schema` JSON object is walked to collect field descriptors
   *    (key = field name, value = plain-text hint about what to extract).
   * 2. Each field description is embedded with ONNX.
   * 3. The source text is split into sentences; each sentence is embedded.
   * 4. The best-matching sentence per field is selected by cosine similarity
   *    and returned in a JSON object that mirrors the schema shape.
   *
   * ### Example
   * ```cpp
   * json schema = {
   *   {"company",     "name of the hiring company or employer"},
   *   {"title",       "job title or position name"},
   *   {"salary",      "compensation, pay, or salary range"},
   *   {"location",    "city, country, or remote status"},
   *   {"description", "role responsibilities or job duties"}
   * };
   * json result = engine.extract_schema(resume_text, schema);
   * // result["company"] == "Acme Corp", result["title"] == "Senior Engineer", …
   * ```
   *
   * @param text    Source document (UTF-8).
   * @param schema  JSON object whose keys are field names and values are
   *                plain-text descriptions used as semantic anchors.
   * @param fields  Optional override list of SchemaField descriptors. When
   *                non-empty this takes precedence over `schema`.
   * @return JSON object with the same keys as `schema`, each mapped to the
   *         best-matching extracted string.  A `"_scores"` sub-object with
   *         per-field cosine similarities is always included so callers can
   *         threshold low-confidence extractions.
   */
  [[nodiscard]] json
  extract_schema(const std::string& text,
                 const json& schema,
                 const std::vector<SchemaField>& fields = {});

  /**
   * @brief Builds an Entity-Relationship Graph from the text.
   * @param text Input source text.
   * @param graph The GraphAddon instance to populate.
   * @param window_size Number of tokens to look ahead for relationships.
   */
  void build_knowledge_graph(const std::string& text, GraphAddon& graph, int window_size = 10);

  /**
   * @brief Calculates readability scores like Flesch-Kincaid.
   */
  ReadabilityMetrics analyze_readability(const std::string& text);

  /**
   * @brief Analyzes the sentiment of the text (Positive, Negative, Neutral).
   */
  SentimentResult analyze_sentiment(const std::string& text, const std::string& lang = "en");

  /**
   * @brief Detects toxic or offensive content.
   */
  ToxicityResult detect_toxicity(const std::string& text, const std::string& lang = "en");


  json corrections_to_json(const std::vector<Correction>& corrections);
  json language_to_json(const LanguageProfile& profile);
  json keywords_to_json(const std::vector<Keyword>& keywords);
  json entities_to_json(const std::vector<Entity>& entities);
  json readability_to_json(const ReadabilityMetrics& metrics);
  json summary_to_json(const SummaryResult& summary);
  json sentiment_to_json(const SentimentResult& sentiment);
  json toxicity_to_json(const ToxicityResult& toxicity);

  /** @name OCR methods */
  std::string extract_text_from_image(const std::string& path);

private:
  mutable std::shared_mutex        engine_mutex_; ///< Protects service pointers
  std::shared_ptr<NLPModel>        model_;
  std::shared_ptr<OnnxService>     onnx_;       ///< Embeddings — all-MiniLM-L6-v2
  std::shared_ptr<ClassifierService> sentiment_; ///< Sentiment — DistilBERT SST-2
  std::shared_ptr<ClassifierService> toxicity_;  ///< Toxicity  — Toxic-BERT
  std::shared_ptr<OnnxService>     ner_;         ///< NER       — bert-base-NER
  std::shared_ptr<OCRAddon>     ocr_;

  std::string to_lower(const std::string& str);
  std::string remove_punctuation(const std::string& str);
  static int count_syllables(const std::string& word);
  float calculate_sentence_score(const std::string& sentence, const std::map<std::string, float>& word_scores);
  int estimate_reading_time(int word_count);
  std::string detect_document_type(const std::string& text);
};

} // namespace pce::nlp

#endif
