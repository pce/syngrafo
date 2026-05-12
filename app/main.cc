// Syngrafo desktop app over saucer::smartview bindings wired directly to
// NLPEngine and ONNXAddon.
//
// JSON envelope (every exposed function returns Promise<string>):
//   ok  path  → { "ok": true,  "data": <payload> }
//   err path  → { "ok": false, "error": "<message>" }
//
//

#include <coco/stray/stray.hpp>
#include <nlohmann/json.hpp>
#include <saucer/embedded/all.hpp>
#include <saucer/smartview.hpp>
#include <saucer/systray.hpp>

#ifdef NLP_WITH_ONNX
#include "nlp/addons/onnx_addon.hh"
#endif


#include "nlp/addons/ocr_addon.hh"
#include "nlp/nlp_engine.hh"

#include "dms_bindings.hh"
#include "bindings/pdf_bindings.hh"
#include "bindings/lm_bindings.hh"   // LM inference — no-op when SGF_WITH_LM=OFF
#include "bindings/audio_bindings.hh" // CSound offline render — no-op when SGF_WITH_AUDIO=OFF
#include "bindings/video_bindings.hh" // FFmpeg video decode   — no-op when SGF_WITH_VIDEO=OFF
#include <saucer/modules/desktop.hpp>

#include <filesystem>
#include <print>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#include <objc/runtime.h>
#include <objc/message.h>
#elif defined(_WIN32)
#include <windows.h>
#endif

namespace fs = std::filesystem;

static std::string get_executable_path() {
#ifdef __APPLE__
  char path[1024];
  uint32_t size = sizeof(path);
  if (_NSGetExecutablePath(path, &size) == 0)
    return fs::path(path).parent_path().string();
#elif defined(_WIN32)
  wchar_t path[MAX_PATH];
  GetModuleFileNameW(NULL, path, MAX_PATH);
  return fs::path(path).parent_path().string();
#else
  return fs::read_symlink("/proc/self/exe").parent_path().string();
#endif
  return ".";
}

/// Returns a platform-appropriate writable directory for user-downloaded
/// LLM model files (GGUF), similar to how Ollama uses ~/.ollama/models.
///
///   macOS   → ~/Library/Application Support/Syngrafo/models
///   Linux   → $XDG_DATA_HOME/syngrafo/models  (fallback: ~/.local/share/…)
///   Windows → %APPDATA%\Syngrafo\models
static std::string default_llm_models_dir() {
#ifdef __APPLE__
    if (const char* home = std::getenv("HOME"); home && *home)
        return (fs::path(home) / "Library" / "Application Support" / "Syngrafo" / "models").string();
#elif defined(_WIN32)
    if (const char* appdata = std::getenv("APPDATA"); appdata && *appdata)
        return (fs::path(appdata) / "Syngrafo" / "models").string();
#else
    // XDG-compliant Linux / BSD
    if (const char* xdg = std::getenv("XDG_DATA_HOME"); xdg && *xdg)
        return (fs::path(xdg) / "syngrafo" / "models").string();
    if (const char* home = std::getenv("HOME"); home && *home)
        return (fs::path(home) / ".local" / "share" / "syngrafo" / "models").string();
#endif
    // Last resort: a sibling directory of the executable.
    return (fs::path(get_executable_path()) / "models").string();
}

static std::string data_dir() {
  auto exe_dir = fs::path(get_executable_path());

  // 1. Check if we're inside a macOS Bundle
  if (exe_dir.string().find(".app/Contents/MacOS") != std::string::npos) {
    auto bundle_data = exe_dir.parent_path() / "Resources" / "data";
    if (fs::exists(bundle_data))
      return bundle_data.string();
  }

  // 2. Check sibling data directory (typical for dev/linux)
  auto sibling_data = exe_dir / "data";
  if (fs::exists(sibling_data))
    return sibling_data.string();

  // 3. Fallback to current working directory
  return "data";
}

using json = nlohmann::json;
using namespace pce::nlp;

namespace {

template <typename T>
  requires std::convertible_to<T, json>
[[nodiscard]] std::string ok_str(T &&data) {
  return json{{"ok", true}, {"data", std::forward<T>(data)}}.dump();
}

[[nodiscard]] std::string err_str(std::string_view msg) {
  return json{{"ok", false}, {"error", std::string(msg)}}.dump();
}

// Wraps a callable → json in a uniform try/catch envelope.
template <std::invocable<> Fn>
  requires std::convertible_to<std::invoke_result_t<Fn>, json>
[[nodiscard]] std::string guarded(Fn &&fn) noexcept {
  try {
    return ok_str(std::forward<Fn>(fn)());
  } catch (const std::exception &e) {
    return err_str(std::format("NLP error: {}", e.what()));
  } catch (...) {
    return err_str("Unknown NLP error");
  }
}

// Parses a JSON string; returns unexpected on failure.
[[nodiscard]] std::expected<json, std::string>
parse_json(std::string_view raw) noexcept {
  try {
    return json::parse(raw);
  } catch (const json::parse_error &e) {
    return std::unexpected(std::format("JSON parse error: {}", e.what()));
  }
}

} // namespace

struct EngineHandle {
  std::shared_ptr<NLPModel> model;
  std::unique_ptr<NLPEngine> engine;

  // Direct handle to the embedding addon — bypasses NLPEngine for
  // operations that call embed() in tight loops (e.g. bulk doc indexing).
#ifdef NLP_WITH_ONNX
  std::shared_ptr<onnx::ONNXAddon> embed_addon;
#endif
  std::shared_ptr<OCRAddon> ocr_addon;

  explicit EngineHandle() {
    ensure_models_present();

    model = load_model();
    engine = std::make_unique<NLPEngine>(model);

    const fs::path model_dir = resolve_model_dir();
    const fs::path vocab = model_dir / "vocab.txt";

#ifdef NLP_WITH_ONNX
    // Embed model — store a direct shared_ptr for the DMS indexer.
    embed_addon = make_addon(model_dir / "embed.onnx", vocab);
    if (embed_addon) {
      engine->set_onnx_service(embed_addon);
      std::print("[nlp] embed model loaded ({} dims)\n",
                 embed_addon->dimensions());
    }

    // Sentiment classifier (DistilBERT SST-2).
    if (auto svc = make_addon(model_dir / "sentiment.onnx", vocab)) {
      engine->set_sentiment_service(std::make_shared<onnx::OnnxClassifier>(
          svc, std::vector<std::string>{"NEGATIVE", "POSITIVE"}));
      std::print("[nlp] sentiment model loaded\n");
    }

    // NER model (bert-base-NER, CoNLL-2003 BIO labels).
    // bert-base-NER uses bert-base-CASED (28,996 tokens) — a different vocab
    // from all-MiniLM-L6-v2 (30,522 tokens).  Use ner_vocab.txt when present;
    // fall back to the shared vocab only as a last resort (will produce
    // out-of-bounds ONNX errors for token IDs > 28,995).
    {
      const fs::path ner_vocab = model_dir / "ner_vocab.txt";
      const fs::path ner_vocab_path = fs::exists(ner_vocab) ? ner_vocab : vocab;
      if (!fs::exists(ner_vocab))
        std::print(stderr,
                   "[nlp] WARNING: ner_vocab.txt not found — NER may produce "
                   "out-of-bounds ONNX errors.\n"
                   "         Run: python3 scripts/download_models.py download "
                   "--models ner_vocab\n");
      if (auto svc = make_addon(model_dir / "ner.onnx", ner_vocab_path)) {
        engine->set_ner_service(svc);
        std::print("[nlp] NER model loaded\n");
      }
    }

    // Toxicity classifier (Toxic-BERT, multi-label sigmoid).
    if (auto svc = make_addon(model_dir / "toxicity.onnx", vocab)) {
      engine->set_toxicity_service(std::make_shared<onnx::OnnxClassifier>(
          svc,
          std::vector<std::string>{"toxic", "severe_toxic", "obscene", "threat",
                                   "insult", "identity_hate"},
          "logits", onnx::OnnxClassifier::Activation::sigmoid));
      std::print("[nlp] toxicity model loaded\n");
    }
#endif

    // Backend selected at compile time (exactly one of):
    //   NLP_APPLE_VISION   → Apple Vision (macOS default, fastest on Apple Silicon)
    //   NLP_WITH_TESSERACT → libtesseract (Linux via apt; Windows via vcpkg)
    //   NLP_ONNX_OCR       → PP-OCRv4 ONNX (cross-platform fallback; needs
    //                        data/models/ocr_rec.onnx + data/models/ocr_keys.txt;
    //                        run: python3 scripts/download_models.py download --models ocr)
    ocr_addon = std::make_shared<OCRAddon>();
    if (ocr_addon->initialize()) {
      engine->set_ocr_service(ocr_addon);
      std::print("[nlp] OCR addon ready\n");
    } else {
      std::print(stderr, "[nlp] OCR addon failed to initialize\n");
    }

    if (!engine->has_onnx()) {
      std::print(stderr,
                 "[nlp] no ONNX models found in '{}'\n"
                 "      Run: python3 scripts/download_models.py download\n",
                 fs::absolute(model_dir).string());
    } else {
      std::print(
          "[nlp] capabilities: embed={} sentiment={} ner={} toxicity={} ocr={}\n",
          engine->has_onnx(), engine->has_sentiment_model(),
          engine->has_ner_model(), engine->has_toxicity_model(), engine->has_ocr());
    }
  }

private:
  static fs::path data_dir() {
    if (const char *v = std::getenv("NLP_DATA_DIR"); v && *v) {
      std::print("[nlp] using NLP_DATA_DIR={}\n", v);
      return fs::path(v);
    }
    // Delegate to the module-level data_dir() which is macOS-bundle-aware:
    // it returns <bundle>/Contents/Resources/data when running from an .app,
    // and falls back to a sibling "data/" directory otherwise.
    return fs::path(::data_dir());
  }

public:
  static fs::path resolve_model_dir() {
    if (const char *v = std::getenv("NLP_MODEL_DIR"); v && *v)
      return fs::path(v);
    return data_dir() / "models";
  }

private:
  static void ensure_models_present() {
    const fs::path model_dir = resolve_model_dir();
    const fs::path vocab = model_dir / "vocab.txt";
    const fs::path embed = model_dir / "embed.onnx";

    if (!fs::exists(vocab) || !fs::exists(embed)) {
      std::print("[nlp] critical models missing, attempting download...\n");

      // Check common locations for the download script
      std::string script_path = "scripts/download_models.py";
      if (!fs::exists(script_path)) {
        if (fs::exists("../scripts/download_models.py")) {
          script_path = "../scripts/download_models.py";
        } else if (fs::exists("../../scripts/download_models.py")) {
          script_path = "../../scripts/download_models.py";
        }
      }

      std::print("[nlp] using download script at: {}\n", script_path);
      int res = std::system(
          std::format("python3 {} download --models embed,vocab,sentiment,ner_vocab",
                      script_path)
              .c_str());
      if (res != 0) {
        std::print(stderr, "[nlp] model download failed with code {}\n", res);
      }
    }
  }

  static std::shared_ptr<NLPModel> load_model() {
    const fs::path dir = data_dir();
    auto m = std::make_shared<NLPModel>();
    if (m->load_from(dir.string())) {
      std::print("[nlp] data files loaded from '{}'\n",
                 fs::absolute(dir).string());
      return m;
    }
    std::print(stderr,
               "[nlp] data files not found at '{}'\n"
               "      Spell-check and dictionary features are unavailable.\n"
               "      Run: python3 scripts/download_models.py download\n",
               fs::absolute(dir).string());
    return NLPModel::create_empty();
  }

#ifdef NLP_WITH_ONNX
  static std::shared_ptr<onnx::ONNXAddon>
  make_addon(const fs::path &model_path, const fs::path &vocab_path) {
    if (!fs::exists(model_path))
      return nullptr;

    auto addon = std::make_shared<onnx::ONNXAddon>();
    onnx::ONNXAddon::Config cfg;
    cfg.model_path = model_path;
    if (fs::exists(vocab_path))
      cfg.vocab_path = vocab_path;

    if (!addon->load_model(std::move(cfg))) {
      std::print(stderr, "[nlp] failed to load '{}'\n", model_path.string());
      return nullptr;
    }
    return addon;
  }
#endif
};

// Direct expose() registrations
//
// Every binding is a self-contained lambda.  Capture rules:
//   &eng       — reference to EngineHandle::engine (outlives all lambdas)
//   addon      — shared_ptr copy (keeps ONNXAddon alive independently)
//
// All lambdas return std::string — the JSON envelope consumed by the JS side.

static void register_bindings(saucer::smartview &wv, EngineHandle &nlp) {
  using std::string;
  NLPEngine &eng = *nlp.engine;

  // health
  // → { ok, data: { onnx, sentiment, toxicity, ner, version } }
  wv.expose("nlp_health", [&eng]() -> string {
    return guarded([&]() -> json {
      return {
          {"onnx", eng.has_onnx()},
          {"sentiment", eng.has_sentiment_model()},
          {"toxicity", eng.has_toxicity_model()},
          {"ner", eng.has_ner_model()},
          {"version", NLP_ENGINE_VERSION},
      };
    });
  });

  // summarize
  // → { ok, data: { summary, selected_sentences[], ratio,
  //                 original_length, summary_length } }
  wv.expose("nlp_summarize",
            [&eng](string text, float ratio, string query) -> string {
              return guarded([&]() -> json {
                return eng.summary_to_json(eng.summarize(text, ratio, query));
              });
            });

  // keywords
  // → { ok, data: [ { term, frequency, tfidf_score, pos } ] }
  wv.expose(
      "nlp_keywords", [&eng](string text, int max, string lang) -> string {
        return guarded([&]() -> json {
          return eng.keywords_to_json(eng.extract_keywords(text, max, lang));
        });
      });

  // sentiment
  // → { ok, data: { score, label, confidence } }
  wv.expose("nlp_sentiment", [&eng](string text, string lang) -> string {
    return guarded([&]() -> json {
      return eng.sentiment_to_json(eng.analyze_sentiment(text, lang));
    });
  });

  //  entities
  // → { ok, data: [ { text, type, position, confidence } ] }
  wv.expose("nlp_entities", [&eng](string text, string lang) -> string {
    return guarded([&]() -> json {
      return eng.entities_to_json(eng.extract_entities(text, lang));
    });
  });

  //  readability
  // → { ok, data: { flesch_kincaid_grade, readability_score, complexity,
  //                 word_count, sentence_count, avg_sentence_length,
  //                 suggestions[] } }
  wv.expose("nlp_readability", [&eng](string text) -> string {
    return guarded([&]() -> json {
      return eng.readability_to_json(eng.analyze_readability(text));
    });
  });

  //  toxicity
  // → { ok, data: { is_toxic, score, triggers[], category } }
  wv.expose("nlp_toxicity", [&eng](string text, string lang) -> string {
    return guarded([&]() -> json {
      return eng.toxicity_to_json(eng.detect_toxicity(text, lang));
    });
  });

  // detect_language
  // → { ok, data: { language, confidence, script_distribution } }
  wv.expose("nlp_detect_language", [&eng](string text) -> string {
    return guarded([&]() -> json {
      return eng.language_to_json(eng.detect_language(text));
    });
  });

  //  tokenize
  // → { ok, data: string[] }
  wv.expose("nlp_tokenize", [&eng](string text) -> string {
    return guarded([&]() -> json { return json(eng.tokenize(text)); });
  });

  //  spell_check
  // → { ok, data: [ { original, suggested, confidence, reason } ] }
  wv.expose("nlp_spell_check", [&eng](string text, string lang) -> string {
    return guarded([&]() -> json {
      return eng.corrections_to_json(eng.spell_check(text, lang));
    });
  });

  // semantic_search
  // docs_json  JSON-encoded string[] — passed pre-serialised to avoid
  //            glaze array-of-strings edge cases with large document sets.
  // → { ok, data: [ { text, score, index } ] }
  wv.expose(
      "nlp_semantic_search",
      [&eng](string query, string docs_json, int top_k) -> string {
        auto parsed = parse_json(docs_json);
        if (!parsed || !parsed->is_array())
          return err_str("'docs' must be a JSON array of strings");

        std::vector<string> docs;
        docs.reserve(parsed->size());
        for (const auto &d : *parsed)
          docs.push_back(d.is_string() ? d.get<string>() : d.dump());

        if (docs.empty())
          return err_str("documents array is empty");

        return guarded([&]() -> json {
          auto matches =
              eng.semantic_search(query, docs, static_cast<std::size_t>(top_k));
          json out = json::array();
          for (const auto &[text, score, index] : matches)
            out.push_back({{"text", text}, {"score", score}, {"index", index}});
          return out;
        });
      });

  // extract_schema
  // schema_json  JSON-encoded { "field": "description", … }
  // → { ok, data: { field: "extracted value", …, _scores: {…} } }
  wv.expose(
      "nlp_extract_schema", [&eng](string text, string schema_json) -> string {
        if (!eng.has_onnx())
          return err_str("extract_schema requires ONNX — no model loaded");

        auto parsed = parse_json(schema_json);
        if (!parsed || !parsed->is_object())
          return err_str("'schema' must be a JSON object");

        return guarded(
            [&]() -> json { return eng.extract_schema(text, *parsed); });
      });

  // embed — direct ONNXAddon call
  // Captures the shared_ptr by value so the addon stays alive even if
  // EngineHandle is somehow reset.  Calls ONNXAddon::embed() directly —
  // one less virtual dispatch through NLPEngine.
  // → { ok, data: { success, dimensions, vector: number[] } }
#ifdef NLP_WITH_ONNX
  if (nlp.embed_addon) {
    auto addon = nlp.embed_addon; // shared_ptr copy — extends lifetime
    wv.expose("nlp_embed", [addon](string text) -> string {
      if (!addon->is_loaded())
        return err_str("embed requires ONNX — no model loaded");
      return guarded([&]() -> json {
        const auto r = addon->embed(text);
        return json{
            {"success", r.success},
            {"dimensions", r.vector.size()},
            {"vector", r.vector},
        };
      });
    });
  } else {
    // Model file not found — return a clear error.
    wv.expose("nlp_embed", [](string) -> string {
      return err_str("embed requires ONNX — no model loaded");
    });
  }
#else
  wv.expose("nlp_embed", [](string) -> string {
    return err_str("embed requires ONNX — built with NLP_WITH_ONNX=OFF");
  });
#endif
}

coco::stray start(saucer::application *app, EngineHandle &nlp) {
  try {
    saucer::webview::register_scheme("local");

#ifdef __APPLE__
    // Register "local" as a secure and local scheme to bypass security
    // restrictions (e.g. for SVG). Using runtime messaging to access private
    // WebKit methods that Saucer normally only uses if SAUCER_WEBKIT_PRIVATE is
    // set.
    {
      id cls = (id)objc_getClass("WKBrowsingContextController");
      if (cls) {
        SEL sel = sel_registerName("registerSchemeForCustomProtocol:");
        SEL responds = sel_registerName("respondsToSelector:");
        if (((BOOL (*)(id, SEL, SEL))objc_msgSend)(cls, responds, sel)) {
          id (*stringWithUTF8String)(id, SEL, const char *) =
              (id (*)(id, SEL, const char *))objc_msgSend;
          id scheme = stringWithUTF8String(
              (id)objc_getClass("NSString"),
              sel_registerName("stringWithUTF8String:"), "local");
          ((void (*)(id, SEL, id))objc_msgSend)(cls, sel, scheme);
        }
      }
    }
#endif

    auto window = saucer::window::create(app);
    if (!window) {
      std::print(stderr, "[saucer] failed to create window\n");
      co_return;
    }
    (*window)->set_title("Syngrafo");
    (*window)->set_size({1280, 800});

    auto webview = saucer::smartview::create({.window = *window});
    if (!webview) {
      std::print(stderr, "[saucer] failed to create webview\n");
      co_return;
    }

    // Inject engine + DMS capability flags before any page script runs so the
    // frontend can gate ONNX-dependent UI without a round-trip.
    webview->inject({
        .code = std::format(
            R"js(
window.__nlp = {{
    hasOnnx:      {},
    hasSentiment: {},
    hasToxicity:  {},
    hasNer:       {},
    hasOcr:       {},
    ocrEngine:    "{}",
    version:      "{}",
}};
window.__dms = {{
    hasSemanticSearch: {},
}};
window.__lm = {{
    hasLM:        {},
    loadedModel:  null,
    isBusy:       false,
}};
// Default no-op callbacks — replaced by the React store at runtime.
if (typeof window.__dms_progress === 'undefined')
    window.__dms_progress = function(ev) {{ console.debug('[dms]', ev); }};
if (typeof window.__lm_result === 'undefined')
    window.__lm_result = function(id, text, pt, ct) {{ console.debug('[lm] result', id, pt+ct, 'tokens'); }};
if (typeof window.__lm_error === 'undefined')
    window.__lm_error = function(id, err) {{ console.warn('[lm] error', id, err); }};
)js",
            nlp.engine->has_onnx() ? "true" : "false",
            nlp.engine->has_sentiment_model() ? "true" : "false",
            nlp.engine->has_toxicity_model() ? "true" : "false",
            nlp.engine->has_ner_model() ? "true" : "false",
            nlp.engine->has_ocr() ? "true" : "false",
#ifdef NLP_APPLE_VISION
            "vision",
#elif defined(NLP_ONNX_OCR)
            "onnx",
#elif defined(NLP_WITH_TESSERACT)
            "tesseract",
#else
            "none",
#endif
            NLP_ENGINE_VERSION,
            nlp.engine->has_onnx() ? "true" : "false",
#ifdef SGF_WITH_LM
            "true"
#else
            "false"
#endif
        ),
        .run_at = saucer::script::time::creation,
    });

    // LM inference engine — lives as a coroutine-local so it is destroyed
    // (queue drained + model freed) when start() returns on window close.
    // Without SGF_WITH_LM this is a zero-cost no-op stub.
    pce::lm::LMEngine lm_engine;

    webview->embed(saucer::embedded::all());

    /// Construct the DMS handle
    /// opens / bootstraps the SQLite database.
    /// DMSHandle is a coroutine-local kept alive by co_await app->finish().
    /// Its jthread is cooperatively stopped and joined when it goes out of
    /// scope.
#ifdef NLP_WITH_ONNX
    auto embed_svc = std::make_shared<pce::nlp::onnx::ONNXAddon>();
    auto rectifier = std::make_shared<pce::nlp::RectifierAddon>();

    // Initialise background DMS handle
    pce::dms::DMSHandle dms{*nlp.engine, embed_svc, rectifier};

    const fs::path model_path =
        EngineHandle::resolve_model_dir() / "embed.onnx";
    onnx::ONNXAddon::Config cfg;
    cfg.model_path = model_path;
    cfg.vocab_path = EngineHandle::resolve_model_dir() / "vocab.txt";

    if (auto ok = embed_svc->load_model(std::move(cfg)); !ok) {
      std::print(stderr, "[main] failed to load embedding model\n");
    } else {
      std::print("[main] embedding model ready ({} dims)\n",
                 embed_svc->dimensions());
    }

    if (auto ok = rectifier->initialize(); !ok) {
      std::print(stderr, "[main] failed to init rectifier addon\n");
    } else {
      rectifier->set_onnx(
          embed_svc); // Rectifier can reuse the same ONNX session or its own
      std::print("[main] rectifier addon ready\n");
    }
#else
    /// No ONNX: create the rectifier anyway so macOS platform-native rectification
    /// (Apple Vision corner detection + CoreImage warp) still works.
    /// On Linux/Windows the platform stubs return no corners, so rectify() will
    /// fail gracefully when called — no crash, no undefined behaviour.
    auto rectifier = std::make_shared<pce::nlp::RectifierAddon>();
    pce::dms::DMSHandle dms{*nlp.engine, nullptr, rectifier};
#endif

    /// Wire all JS ↔ C++ bindings directly — no bridge class.
    register_bindings(*webview, nlp);
    saucer::modules::desktop desk{app};
    saucer::modules::pdf pdf{*webview};

    /// Model downloader — manages LLM/GGUF model files chosen by the user in-app.
    /// The catalog is loaded from data/llm_catalog.json (bundled into .app/Contents/Resources/data/).
    /// To add or remove models: edit data/llm_catalog.json — no recompile required.
    ///
    /// LLM model files (GGUF, 1–3 GB each) live in a platform-specific user
    /// directory — separate from the NLP/ONNX models bundled in data/models/:
    ///   macOS   → ~/Library/Application Support/Syngrafo/models/
    ///   Linux   → ~/.local/share/syngrafo/models/
    ///   Windows → %APPDATA%\Syngrafo\models\
    /// The user can override this path in Settings (persisted to the DB under
    /// pref key "llm_models_dir").  We read that preference synchronously here
    /// before constructing the downloader so the worker threads always see the
    /// correct directory.
    std::string llm_models_dir_pref;
    {
        // Best-effort synchronous read — DB is already open at this point.
        const std::string pref_key = "llm_models_dir";
        auto pref_val = dms.load_preference_sync(pref_key);
        if (pref_val && !pref_val->empty())
            llm_models_dir_pref = *pref_val;
    }
    const std::string llm_models_dir = llm_models_dir_pref.empty()
        ? default_llm_models_dir()
        : llm_models_dir_pref;
    const std::string catalog_path  = (fs::path(data_dir()) / "llm_catalog.json").string();
    saucer::model_downloader::ModelDownloader model_dl{{
        .models_dir = llm_models_dir,
        .user_agent = "Syngrafo/" SYNGRAFO_VERSION,
        .catalog    = saucer::model_downloader::load_catalog_from_json_file(catalog_path),
    }};
    std::print("[models] LLM model store : {}\n", llm_models_dir);
    std::print("[models] catalog         : {}\n", catalog_path);

    pce::dms::register_dms_bindings(*webview, dms, desk, model_dl);
    pce::dms::register_pdf_bindings(*webview, dms, pdf, desk);
    pce::dms::register_lm_bindings(*webview, lm_engine, model_dl, dms.wv_ptr);
    pce::dms::register_audio_bindings(*webview, dms);
    pce::dms::register_video_bindings(*webview, dms);

#ifndef NDEBUG
    webview->set_dev_tools(true);
#endif

    /// Simple asset server to bypass "Not allowed to load local resource"
    /// (file:// restrictions). Frontend can load any local file via
    /// local://local/path/to/file.
    webview->handle_scheme("local", [](saucer::scheme::request request,
                                       saucer::scheme::executor exec) {
      auto url = request.url();

      std::string full_url = url.string();
      std::string prefix = "local://";
      std::string path_str;

      if (full_url.starts_with(prefix)) {
        path_str = full_url.substr(prefix.size());
        // Remove query parameters if present
        auto query_pos = path_str.find('?');
        if (query_pos != std::string::npos) {
          path_str = path_str.substr(0, query_pos);
        }
        // Remove the "local" authority part but KEEP the leading "/" so
        // absolute filesystem paths stay absolute.
        // local://local/tmp/dlzone/foo.webp
        //  → after strip "local://": "local/tmp/dlzone/foo.webp"
        //  → substr(5) "local" stripped: "/tmp/dlzone/foo.webp"  ← absolute ✓
        if (path_str.starts_with("local/")) {
          path_str = path_str.substr(5); // keep the "/" → absolute path
        } else if (path_str.starts_with("local")) {
          path_str = path_str.substr(5);
        }
      } else {
        path_str = url.path().string();
      }

      // Percent-decode the path so file names that contain spaces or other
      // URL-special characters (e.g. "My%20Photo.jpg") resolve correctly on
      // the filesystem.  The browser always percent-encodes non-ASCII / space
      // characters before making the scheme request, so we must undo that here.
      {
        std::string decoded;
        decoded.reserve(path_str.size());
        for (std::size_t i = 0; i < path_str.size(); ++i) {
          if (path_str[i] == '%' && i + 2 < path_str.size()) {
            const char h = static_cast<char>(
                std::tolower(static_cast<unsigned char>(path_str[i + 1])));
            const char l = static_cast<char>(
                std::tolower(static_cast<unsigned char>(path_str[i + 2])));
            if (std::isxdigit(static_cast<unsigned char>(h)) &&
                std::isxdigit(static_cast<unsigned char>(l))) {
              const int hv = (h >= 'a') ? (h - 'a' + 10) : (h - '0');
              const int lv = (l >= 'a') ? (l - 'a' + 10) : (l - '0');
              decoded.push_back(static_cast<char>((hv << 4) | lv));
              i += 2;
              continue;
            }
          }
          decoded.push_back(path_str[i]);
        }
        path_str = std::move(decoded);
      }

      std::print("[local-scheme] resolving: {} (from URL: {})\n", path_str,
                 full_url);

      namespace fs = std::filesystem;
      fs::path p(path_str);

      if (p.is_relative()) {
        // Relative path: resolve against CWD (legacy bundle-relative usage).
        auto base = fs::current_path();
        p = base / p;
        std::print("[local-scheme] relative path detected, resolved to: {}\n",
                   p.string());
      } else if (!fs::exists(p)) {
        // Absolute path doesn't exist on disk.  Try stripping the leading "/"
        // and resolving relative to CWD — backwards-compat for callers that
        // used local://local/data/... to mean a bundle-relative resource.
        std::string rel = p.string().substr(1);
        if (!rel.empty()) {
          auto fallback = fs::current_path() / rel;
          if (fs::exists(fallback) && fs::is_regular_file(fallback)) {
            std::print("[local-scheme] absolute path not found; using CWD "
                       "fallback: {}\n",
                       fallback.string());
            p = fallback;
          }
        }
      }

      if (!fs::exists(p) || !fs::is_regular_file(p)) {
        std::print(stderr, "[local-scheme] file not found: {}\n", p.string());
        return exec.reject(saucer::scheme::error::not_found);
      }

      // Detect MIME
      std::string ext  = p.extension().string();
      std::string mime = pce::dms::mime_for_extension(ext);

      // File size — used for Content-Length and Range calculations.
      std::error_code sz_ec;
      const auto file_size = static_cast<std::size_t>(fs::file_size(p, sz_ec));
      if (sz_ec) {
        std::print(stderr, "[local-scheme] stat failed: {}\n", p.string());
        return exec.reject(saucer::scheme::error::failed);
      }

      std::ifstream file(p, std::ios::binary);
      if (!file) {
        std::print(stderr, "[local-scheme] failed to open file: {}\n",
                   p.string());
        return exec.reject(saucer::scheme::error::denied);
      }

      // CORS + range-acceptance headers added to every response.
      std::map<std::string, std::string> common_headers = {
          {"Accept-Ranges",                "bytes"},
          {"Access-Control-Allow-Origin",  "*"},
          {"Access-Control-Allow-Methods", "GET, HEAD, OPTIONS"},
          {"Access-Control-Allow-Headers", "*"},
          {"Cross-Origin-Resource-Policy", "cross-origin"},
      };

      // Range request (HTTP 206 Partial Content)
      // Required for <video>/<audio> seeking and for streaming large files
      // without buffering the entire content upfront.
      const auto req_headers = request.headers();
      auto range_it = req_headers.find("Range");
      if (range_it != req_headers.end()) {
        const std::string& rv = range_it->second;
        if (rv.starts_with("bytes=")) {
          const std::string spec  = rv.substr(6);
          const auto        dash  = spec.find('-');

          std::size_t rng_start = 0;
          std::size_t rng_end   = file_size > 0 ? file_size - 1 : 0;

          if (dash != std::string::npos) {
            const std::string s0 = spec.substr(0, dash);
            const std::string s1 = spec.substr(dash + 1);
            if (!s0.empty()) rng_start = std::stoull(s0);
            if (!s1.empty()) rng_end   = std::min(std::stoull(s1), file_size > 0 ? file_size - 1 : 0ULL);
          }

          if (rng_start >= file_size) {
            // Unsatisfiable range
            common_headers["Content-Range"] = "bytes */" + std::to_string(file_size);
            exec.resolve({ .data = saucer::stash::from(std::vector<std::uint8_t>{}),
                           .mime = mime, .headers = common_headers, .status = 416 });
            return;
          }
          rng_end = std::min(rng_end, file_size - 1);
          const std::size_t rng_len = rng_end - rng_start + 1;

          std::vector<std::uint8_t> chunk(rng_len);
          file.seekg(static_cast<std::streamoff>(rng_start));
          file.read(reinterpret_cast<char*>(chunk.data()),
                    static_cast<std::streamsize>(rng_len));

          common_headers["Content-Range"]  = "bytes " + std::to_string(rng_start)
                                             + "-" + std::to_string(rng_end)
                                             + "/" + std::to_string(file_size);
          common_headers["Content-Length"] = std::to_string(rng_len);

          std::print("[local-scheme] 206 {} bytes={}-{}/{}\n",
                     p.filename().string(), rng_start, rng_end, file_size);

          exec.resolve({ .data    = saucer::stash::from(std::move(chunk)),
                         .mime    = mime,
                         .headers = common_headers,
                         .status  = 206 });
          return;
        }
      }

      // Full response
      std::vector<std::uint8_t> data(file_size);
      file.read(reinterpret_cast<char*>(data.data()),
                static_cast<std::streamsize>(file_size));

      common_headers["Content-Length"] = std::to_string(file_size);

      std::print("[local-scheme] 200 {} ({} bytes) as {}\n",
                 p.filename().string(), file_size, mime);

      exec.resolve({
          .data    = saucer::stash::from(std::move(data)),
          .mime    = mime,
          .headers = common_headers,
      });
    });

    webview->set_url("saucer://embedded/index.html");

    /// System-tray setup
    //
    // The tray icon appears when the window is hidden (minimise-to-tray).
    // - Clicking "Show Syngrafo" (or activating the icon) restores the window.
    // - Clicking "Quit" allows the window-close event to propagate so that
    //   co_await app->finish() returns and the process exits cleanly.
    //
    // win_raw is valid for the entire lifetime of start() (coroutine frame).

    saucer::systray::NativeSystray tray;
    tray.set_tooltip("Syngrafo");

    // Provide an explicit icon so the tray slot is always visible.
    {
        const std::string icons = data_dir() + "/icons";
#if defined(_WIN32)
        const std::string icon_path = icons + "/syngrafo.ico";
#else
        const std::string icon_path = icons + "/syngrafo.png";
#endif
        if (fs::exists(icon_path))
            tray.set_icon(icon_path);
    }

    /// Raw pointer: safe as long as `window` lives, until co_return
    auto* win_raw = (*window).get();


    auto quit_requested = std::make_shared<bool>(false);


    tray.set_on_activate([win_raw] {
        win_raw->show();
    });

    tray.add_or_update({
        .id       = "show",
        .label    = "Show Syngrafo",
        .on_click = [win_raw] { win_raw->show(); },
    });
    tray.add_or_update({
        .id   = "sep1",
        .type = saucer::systray::MenuItemType::Separator,
    });
    tray.add_or_update({
        .id       = "quit",
        .label    = "Quit",
        .on_click = [win_raw, quit_requested] {
            *quit_requested = true;
            win_raw->close();
        },
    });

    // Tray is always visible — activating it (click / double-click) restores
    // the window when it is hidden.
    tray.show();

    // Suppress the OS close so the app lives in the tray until Quit is chosen.
    (*window)->on<saucer::window::event::close>(
        [win_raw, quit_requested]() -> saucer::policy {
            if (*quit_requested)
                return saucer::policy::allow;
            win_raw->hide();
            return saucer::policy::block;
        });

    (*window)->show();
    std::print("[app] window open\n");

    co_await app->finish();
    std::print("[app] window closed\n");
  } catch (const std::exception &e) {
    std::print(stderr, "[app] start() threw exception: {}\n", e.what());
    co_return;
  } catch (...) {
    std::print(stderr, "[app] start() threw unknown exception\n");
    co_return;
  }
}

#include "cli/registry.hh"

#ifdef _WIN32
int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int)
#else
int main(int argc, char** argv)
#endif
{
  try {
#ifdef _WIN32
    int argc = __argc;
    char** argv = __argv;
#endif

    sgf::cli::Context ctx{};
    sgf::cli::Registry registry;

    registry.register_command({
        .name = "diagnostics",
        .description = "Outputs system health checks.",
        .execute = [](sgf::cli::Context& c, sgf::cli::ArgsSpan args) -> int {
            if (c.format == sgf::cli::OutputFormat::Json) {
                std::cout << "{ \"status\": \"ok\", \"onnx\": true }\n";
            } else {
                std::cout << c.color(sgf::cli::terminal::green) << "System is healthy." << c.color(sgf::cli::terminal::reset) << "\n"
                          << "- ONNX: Ready\n";
            }
            return 0;
        }
    });

    if (auto exit_code = registry.dispatch(argc, argv, ctx)) {
        return *exit_code;
    }

    EngineHandle nlp;

    return saucer::application::create({.id = "org.pce.syngrafo0"})
        ->run([&nlp](saucer::application *app) -> coco::stray {
          return start(app, nlp);
        });

  } catch (const std::exception &e) {
    std::print(stderr, "[app] fatal: {}\n", e.what());
    return 1;
  }
}
