#include "nlp_engine_async.hh"
#include "addons/markov_addon.hh"
#include "addons/fractal_addon.hh"
#include "addons/dedupe_addon.hh"
#include "addons/onnx/onnx_service.hh"
#include "addons/onnx/inference_result.hh"
#ifdef NLP_WITH_ONNX
#include "addons/onnx_addon.hh"
#endif
#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <pybind11/functional.h>
#include <memory>
#include <nlohmann/json.hpp>

namespace py = pybind11;
using namespace pybind11::literals;
using namespace pce::nlp;

/**
 * @class PythonAsyncNLPEngine
 * @brief Python-friendly wrapper for the C++ AsyncNLPEngine.
 */
class PythonAsyncNLPEngine {
private:
    std::shared_ptr<NLPModel>           model_;
    std::unique_ptr<AsyncNLPEngine>     engine_;
    std::shared_ptr<onnx::IOnnxService> onnx_;   ///< Optional; null until load_onnx_model() is called.

    /// Create a synchronous NLPEngine, wiring in the ONNX service when present.
    NLPEngine make_engine() const {
        if (onnx_) return NLPEngine(model_, onnx_);
        return NLPEngine(model_);
    }

public:
    PythonAsyncNLPEngine() {
        model_ = std::make_shared<NLPModel>();
        engine_ = std::make_unique<AsyncNLPEngine>(model_);
        // Explicitly initialize so status checks pass immediately in Python
        engine_->initialize();
    }

    ~PythonAsyncNLPEngine() {
        shutdown();
    }

    void initialize() {
        if (engine_) engine_->initialize();
    }

    void shutdown() {
        if (engine_) engine_->shutdown();
    }

    bool load_model(const std::string& path) {
        return model_ && model_->load_from(path);
    }


    /**
     * @brief Load an ONNX model and attach the inference service to this engine.
     *
     * @param model_path  Path to the .onnx file (e.g. all-MiniLM-L6-v2.onnx).
     * @param vocab_path  Path to the matching vocab.txt file.
     * @return true if the model loaded successfully.
     */
    bool load_onnx_model(const std::string& model_path,
                         const std::string& vocab_path) {
#ifdef NLP_WITH_ONNX
        auto addon = std::make_shared<onnx::ONNXAddon>();
        onnx::ONNXAddon::Config cfg;
        cfg.model_path       = model_path;
        cfg.vocab_path       = vocab_path;
        cfg.use_mean_pooling = true;
        if (!addon->load_model(cfg)) return false;
        onnx_ = addon;
        return true;
#else
        (void)model_path; (void)vocab_path;
        return false;  // built with -DDISABLE_ONNX=ON
#endif
    }

    /** @brief True when an ONNX model has been loaded successfully. */
    bool has_onnx() const noexcept {
        return onnx_ != nullptr && onnx_->is_loaded();
    }

    /**
     * @brief Directly register a MarkovAddon instance from Python.
     */
    bool register_markov_addon(std::shared_ptr<MarkovAddon> addon, const std::string& name = "") {
        if (!engine_ || !addon) return false;
        if (!name.empty()) {
            // We need a way to override the name for the engine's map
            // Since name() is virtual, we can't easily change it without a wrapper
            // But AsyncNLPEngine uses the addon->name() by default.
            // For now, we'll implement a name override in AsyncNLPEngine if needed,
            // or assume the addon instance is already configured.
        }
        return engine_->add_addon(addon);
    }

    /**
     * @brief Register a Fractal generator addon and link its dependencies.
     */
    bool register_fractal_addon(std::shared_ptr<FractalAddon> addon, const std::string& markov_name = "") {
        if (!engine_ || !addon) return false;
        sync_fractal_dependencies(addon, markov_name);
        return engine_->add_addon(addon);
    }

    /**
     * @brief Internal helper to sync fractal dependencies.
     */
    void sync_fractal_dependencies(std::shared_ptr<FractalAddon> fractal, const std::string& markov_name = "") {
        if (!engine_ || !fractal) return;

        auto addons = engine_->get_all_addons();

        // Link Markov Source
        std::string target = markov_name.empty() ? "markov_generator" : markov_name;
        if (addons.count(target)) {
            auto markov = std::dynamic_pointer_cast<MarkovAddon>(addons.at(target));
            if (markov) fractal->set_markov_source(markov);
        }

        // Link Vector Engine
        if (addons.count("vector_engine")) {
            auto vec = std::dynamic_pointer_cast<VectorAddon>(addons.at("vector_engine"));
            if (vec) fractal->set_vector_engine(vec);
        }
    }

    /**
     * @brief Returns a map of all addons to Python.
     */
    std::unordered_map<std::string, std::shared_ptr<INLPAddon>> get_all_addons() {
        if (engine_) return engine_->get_all_addons();
        return {};
    }

    /**
     * @brief Register a Deduplication addon and link its dependencies.
     */
    bool register_dedupe_addon(std::shared_ptr<DeduplicationAddon> addon) {
        if (!engine_ || !addon) return false;

        // Link to Vector engine if available for semantic replacement
        auto addons = engine_->get_all_addons();
        if (addons.count("vector_engine")) {
            auto vec = std::dynamic_pointer_cast<VectorAddon>(addons.at("vector_engine"));
            if (vec) addon->set_vector_engine(vec);
        }

        return engine_->add_addon(addon);
    }

    /**
     * @brief Convenience method to load and register a Markov model in one shot.
     */
    bool load_markov_model(const std::string& model_path, const std::string& name = "") {
        if (!engine_) return false;
        auto markov = std::make_shared<MarkovAddon>();
        if (markov->load_knowledge_pack(model_path)) {
            if (!name.empty()) {
                markov->set_name(name);
            }
            return engine_->add_addon(markov);
        }
        return false;
    }

    std::string process_sync(
        const std::string& text,
        const std::string& method,
        const std::unordered_map<std::string, std::string>& options = {},
        const std::string& session_id = ""
    ) {
        // Intercept ONNX-aware methods so they use the wired service when present.
        if (method == "summarize" || method == "extract_summary") {
            float ratio = options.count("ratio") ? std::stof(options.at("ratio")) : 0.3f;
            std::string query = options.count("query") ? options.at("query") : "";
            auto eng = make_engine();
            return eng.summary_to_json(eng.summarize(text, ratio, query)).dump();
        }
        if (method == "embed" || method == "semantic_embed") {
            auto eng = make_engine();
            auto r = eng.embed(text);
            nlohmann::json j;
            j["success"]    = r.success;
            j["dimensions"] = r.dimensions;
            j["vector"]     = r.vector;
            j["input_text"] = r.input_text;
            if (!r.success) j["error"] = r.error;
            return j.dump();
        }

        if (engine_) return engine_->process_sync(text, method, options, session_id);
        return "{\"error\": \"Engine not initialized\"}";
    }


    /**
     * @brief Embed a single text to a dense vector.
     * @return JSON string: {success, dimensions, vector, input_text, error?}
     */
    std::string embed(const std::string& text) {
        auto eng = make_engine();
        auto r   = eng.embed(text);
        nlohmann::json j;
        j["success"]    = r.success;
        j["dimensions"] = r.dimensions;
        j["vector"]     = r.vector;
        j["input_text"] = r.input_text;
        if (!r.success) j["error"] = r.error;
        return j.dump();
    }

    /**
     * @brief Rank documents by semantic similarity to a query.
     * @return JSON string: [{text, score, index}, …] sorted best-first.
     */
    std::string semantic_search(const std::string& query,
                                const std::vector<std::string>& documents,
                                size_t top_k = 5) {
        auto eng     = make_engine();
        auto matches = eng.semantic_search(query, documents, top_k);
        nlohmann::json arr = nlohmann::json::array();
        for (const auto& m : matches)
            arr.push_back({{"text", m.text}, {"score", m.score}, {"index", m.index}});
        return arr.dump();
    }

    /**
     * @brief Extract structured fields from text using a schema dict.
     *
     * @param text        Source document.
     * @param schema_json JSON object string: {"field": "description", …}
     * @return JSON object with extracted values and _scores confidence map.
     */
    std::string extract_schema(const std::string& text,
                               const std::string& schema_json) {
        nlohmann::json schema;
        try { schema = nlohmann::json::parse(schema_json); }
        catch (...) { return "{\"_error\": \"Invalid schema JSON\"}"; }

        auto eng = make_engine();
        return eng.extract_schema(text, schema).dump();
    }

    /**
     * @brief Extractive summarisation with optional semantic query focus.
     * @return JSON string: {summary, ratio, original_length, summary_length}
     */
    std::string summarize(const std::string& text,
                          float ratio = 0.3f,
                          const std::string& query = "") {
        auto eng = make_engine();
        return eng.summary_to_json(eng.summarize(text, ratio, query)).dump();
    }


    /** @brief Async embed — returns task_id immediately. */
    std::string embed_async(const std::string& text) {
        if (!engine_) return "";
        auto onnx  = onnx_;
        auto model = model_;
        return engine_->submit_task([onnx, model, text]() -> AsyncResult {
            NLPEngine eng = onnx ? NLPEngine(model, onnx) : NLPEngine(model);
            auto r = eng.embed(text);
            nlohmann::json j;
            j["success"]    = r.success;
            j["dimensions"] = r.dimensions;
            j["vector"]     = r.vector;
            j["input_text"] = r.input_text;
            if (!r.success) j["error"] = r.error;
            return AsyncResult{j.dump(), r.success, r.error, ""};
        });
    }

    /** @brief Async semantic search — returns task_id immediately. */
    std::string semantic_search_async(const std::string& query,
                                      const std::vector<std::string>& documents,
                                      size_t top_k = 5) {
        if (!engine_) return "";
        auto onnx  = onnx_;
        auto model = model_;
        return engine_->submit_task([onnx, model, query, documents, top_k]() -> AsyncResult {
            NLPEngine eng = onnx ? NLPEngine(model, onnx) : NLPEngine(model);
            auto matches  = eng.semantic_search(query, documents, top_k);
            nlohmann::json arr = nlohmann::json::array();
            for (const auto& m : matches)
                arr.push_back({{"text", m.text}, {"score", m.score}, {"index", m.index}});
            std::string out = arr.dump();
            return AsyncResult{out, true, "", ""};
        });
    }

    /** @brief Async schema extraction — returns task_id immediately. */
    std::string extract_schema_async(const std::string& text,
                                     const std::string& schema_json) {
        if (!engine_) return "";
        auto onnx  = onnx_;
        auto model = model_;
        return engine_->submit_task([onnx, model, text, schema_json]() -> AsyncResult {
            nlohmann::json schema;
            try { schema = nlohmann::json::parse(schema_json); }
            catch (...) { return AsyncResult{"{\"_error\":\"Invalid schema JSON\"}", false, "bad json", ""}; }
            NLPEngine eng = onnx ? NLPEngine(model, onnx) : NLPEngine(model);
            std::string out = eng.extract_schema(text, schema).dump();
            return AsyncResult{out, true, "", ""};
        });
    }

    /** @brief Async summarise — returns task_id immediately. */
    std::string summarize_async(const std::string& text,
                                float ratio = 0.3f,
                                const std::string& query = "") {
        if (!engine_) return "";
        auto onnx  = onnx_;
        auto model = model_;
        return engine_->submit_task([onnx, model, text, ratio, query]() -> AsyncResult {
            NLPEngine eng = onnx ? NLPEngine(model, onnx) : NLPEngine(model);
            auto result   = eng.summarize(text, ratio, query);
            std::string out = eng.summary_to_json(result).dump();
            return AsyncResult{out, true, "", ""};
        });
    }

    /**
     * @brief Poll a previously submitted async task.
     * @param task_id   ID returned by any *_async method.
     * @param wait      If true, block until the task finishes.
     * @return JSON string with task result, or {done:false} if still running.
     */
    std::string get_task_result(const std::string& task_id, bool wait = false) {
        if (!engine_) return "{\"error\": \"Engine not initialized\"}";
        AsyncResult r = engine_->get_task_result(task_id);
        if (!r.success && r.result.empty()) {
            // Task still running or not found
            nlohmann::json j;
            j["done"]     = false;
            j["task_id"]  = task_id;
            j["error"]    = r.error;
            return j.dump();
        }
        // Wrap the result in a task envelope so callers can always check "done"
        nlohmann::json envelope;
        envelope["done"]    = true;
        envelope["success"] = r.success;
        envelope["task_id"] = task_id;
        // Embed the inner JSON directly if parseable; otherwise wrap as string.
        try {
            envelope["result"] = nlohmann::json::parse(r.result);
        } catch (...) {
            envelope["result"] = r.result;
        }
        if (!r.error.empty()) envelope["error"] = r.error;
        return envelope.dump();
    }

    std::string process_text_async(
        const std::string& text,
        const std::string& addon_name,
        const std::unordered_map<std::string, std::string>& options = {},
        const std::string& session_id = ""
    ) {
        if (!engine_) return "";
        return engine_->process_text_async(text, addon_name, nullptr, options, session_id);
    }

    void stream_text(
        const std::string& text,
        const std::string& addon_name,
        py::function callback,
        const std::unordered_map<std::string, std::string>& options = {},
        const std::string& session_id = ""
    ) {
        auto stream_callback = [callback](const std::string& chunk, bool is_final) {
            py::gil_scoped_acquire acquire;
            try {
                callback(py::str(chunk), is_final);
            } catch (const py::error_already_set&) {
                try {
                    py::bytes b(chunk);
                    callback(b.attr("decode")("utf-8", "replace"), is_final);
                } catch (...) {
                    callback(" [Data Error] ", is_final);
                }
            }
        };

        py::gil_scoped_release release;
        engine_->stream_text(text, addon_name, stream_callback, options, session_id);
    }

    void clear_session(const std::string& session_id) {
        if (engine_) engine_->clear_context(session_id);
    }

    bool has_addon(const std::string& name) {
        return engine_ && engine_->has_addon(name);
    }

    bool remove_addon(const std::string& name) {
        return engine_ && engine_->remove_addon(name);
    }

    bool is_ready() {
        return engine_ != nullptr && model_ != nullptr && model_->is_ready();
    }

    bool train_markov_model(const std::string& source_path, const std::string& output_path, size_t ngram_size = 2) {
        auto markov = std::make_shared<MarkovAddon>();
        markov->set_ngram_size(ngram_size);
        return markov->train(source_path, output_path);
    }

    bool is_task_done(const std::string& task_id) {
        if (!engine_) return false;
        // Probe with wait=false; if the result envelope contains done:true the task finished.
        std::string raw = get_task_result(task_id, false);
        try {
            auto j = nlohmann::json::parse(raw);
            return j.value("done", false);
        } catch (...) { return false; }
    }
};

PYBIND11_MODULE(nlp_engine, m) {
    m.doc() = "NLP Engine with Addon support for Python (pce::nlp)";

    m.def("version", []() { return "0.9.0"; });
    m.def("has_onnx_support", []() {
#ifdef NLP_WITH_ONNX
        return true;
#else
        return false;
#endif
    }, "Returns True when the module was compiled with ONNX Runtime support.");

    //  Context Bindings
    py::class_<AddonContext, std::shared_ptr<AddonContext>>(m, "AddonContext")
        .def_readwrite("session_id", &AddonContext::session_id)
        .def_readwrite("metadata", &AddonContext::metadata)
        .def_readwrite("history", &AddonContext::history);

    //  Markov Addon Bindings
    //  Fractal Addon Bindings
    py::class_<FractalAddon, std::shared_ptr<FractalAddon>>(m, "FractalAddon")
        .def(py::init<>())
        .def_property_readonly("name", &FractalAddon::name)
        .def("is_ready", &FractalAddon::is_ready)
        .def("process", [](FractalAddon& self, const std::string& input,
                           const std::unordered_map<std::string, std::string>& options,
                           std::shared_ptr<AddonContext> context) {
            auto result = self.process(input, options, context);
            py::dict d;
            if (!result.has_value()) {
                d["success"] = false;
                d["error"] = result.error();
                return d;
            }
            const auto& resp = result.value();
            d["output"] = resp.output;
            d["success"] = true;
            d["metadata"] = resp.metadata;
            d["metrics"] = resp.metrics;
            return d;
        }, py::arg("input"),
           py::arg("options") = std::unordered_map<std::string, std::string>(),
           py::arg("context") = nullptr);

    //  Deduplication Addon Bindings
    py::class_<DeduplicationAddon, std::shared_ptr<DeduplicationAddon>>(m, "DeduplicationAddon")
        .def(py::init<>())
        .def_property_readonly("name", &DeduplicationAddon::name)
        .def("is_ready", &DeduplicationAddon::is_ready)
        .def("process", [](DeduplicationAddon& self, const std::string& input,
                           const std::unordered_map<std::string, std::string>& options,
                           std::shared_ptr<AddonContext> context) {
            auto result = self.process(input, options, context);
            py::dict d;
            if (!result.has_value()) {
                d["success"] = false;
                d["error"] = result.error();
                return d;
            }
            const auto& resp = result.value();
            d["output"] = resp.output;
            d["success"] = true;
            d["metadata"] = resp.metadata;
            d["metrics"] = resp.metrics;
            return d;
        }, py::arg("input"),
           py::arg("options") = std::unordered_map<std::string, std::string>(),
           py::arg("context") = nullptr);

    py::class_<MarkovAddon, std::shared_ptr<MarkovAddon>>(m, "MarkovAddon")
        .def(py::init<>())
        .def_property_readonly("name", &MarkovAddon::name)
        .def_property_readonly("version", &MarkovAddon::version)
        .def("is_ready", &MarkovAddon::is_ready)
        .def("load_knowledge_pack", &MarkovAddon::load_knowledge_pack, py::arg("path"),
             "Load a pre-trained JSON Knowledge Pack")
        .def("train", &MarkovAddon::train, py::arg("source_path"), py::arg("output_path"),
             "Train a new model from a text file")
        .def("set_ngram_size", &MarkovAddon::set_ngram_size, py::arg("n"),
             "Set the N-Gram context size. 2 = Bigram, 3 = Trigram.")
        .def("get_training_progress", &MarkovAddon::get_training_progress)
        .def("process", [](MarkovAddon& self, const std::string& input,
                           const std::unordered_map<std::string, std::string>& options,
                           std::shared_ptr<AddonContext> context) {
            auto result = self.process(input, options, context);
            py::dict d;
            if (!result.has_value()) {
                d["success"] = false;
                d["error"] = result.error();
                return d;
            }
            const auto& resp = result.value();
            d["output"] = resp.output;
            d["success"] = true;
            d["metadata"] = resp.metadata;
            d["metrics"] = resp.metrics;
            return d;
        }, py::arg("input"),
           py::arg("options") = std::unordered_map<std::string, std::string>(),
           py::arg("context") = nullptr);

    //  Main Engine Bindings
    py::class_<PythonAsyncNLPEngine>(m, "AsyncNLPEngine")
        .def(py::init<>())
        .def("load_model", &PythonAsyncNLPEngine::load_model, "Load base linguistic resources")
        .def("initialize", &PythonAsyncNLPEngine::initialize)
        .def("shutdown", &PythonAsyncNLPEngine::shutdown)
        // Addon registration
        .def("register_markov_addon", &PythonAsyncNLPEngine::register_markov_addon,
             py::arg("addon"), py::arg("name") = "",
             "Register a pre-configured MarkovAddon instance")
        .def("register_fractal_addon", &PythonAsyncNLPEngine::register_fractal_addon,
             py::arg("addon"), py::arg("markov_name") = "",
             "Register a FractalAddon and link it to a Markov source")
        .def("get_all_addons", &PythonAsyncNLPEngine::get_all_addons,
             "Get a map of all registered addons")
        .def("register_dedupe_addon", &PythonAsyncNLPEngine::register_dedupe_addon,
             py::arg("addon"),
             "Register a DeduplicationAddon")
        .def("load_markov_model", &PythonAsyncNLPEngine::load_markov_model,
             py::arg("model_path"), py::arg("name") = "",
             "Quick-load and register a Markov model from path")
        // Processing
        .def("process_sync", &PythonAsyncNLPEngine::process_sync,
             py::arg("text"), py::arg("method"),
             py::arg("options") = std::unordered_map<std::string, std::string>(),
             py::arg("session_id") = "")
        .def("process_text_async", &PythonAsyncNLPEngine::process_text_async,
             py::arg("text"), py::arg("addon_name"),
             py::arg("options") = std::unordered_map<std::string, std::string>(),
             py::arg("session_id") = "")
        .def("stream_text", &PythonAsyncNLPEngine::stream_text,
             py::arg("text"), py::arg("addon_name"), py::arg("callback"),
             py::arg("options") = std::unordered_map<std::string, std::string>(),
             py::arg("session_id") = "")
        // Utility
        .def("clear_session", &PythonAsyncNLPEngine::clear_session, py::arg("session_id"))
        .def("has_addon", &PythonAsyncNLPEngine::has_addon)
        .def("remove_addon", &PythonAsyncNLPEngine::remove_addon)
        .def("is_ready", &PythonAsyncNLPEngine::is_ready)
        .def("train_markov_model", &PythonAsyncNLPEngine::train_markov_model,
             py::arg("source_path"), py::arg("output_path"), py::arg("ngram_size") = 2,
             "Train a new Markov model and save to disk")
        // ONNX setup
        .def("load_onnx_model", &PythonAsyncNLPEngine::load_onnx_model,
             py::arg("model_path"), py::arg("vocab_path"),
             "Load an ONNX model (e.g. all-MiniLM-L6-v2.onnx) and its vocab.txt.\n"
             "Returns True on success.  Requires the engine to be built with ONNX support.")
        .def("has_onnx", &PythonAsyncNLPEngine::has_onnx,
             "True when an ONNX model has been loaded and is ready for inference.")
        //  Sync semantic methods (GIL released during inference)
        .def("embed",
             [](PythonAsyncNLPEngine& self, const std::string& text) -> py::object {
                 std::string raw;
                 {
                     py::gil_scoped_release release;
                     raw = self.embed(text);
                 }
                 return py::module_::import("json").attr("loads")(raw);
             },
             py::arg("text"),
             "Embed text to a dense L2-normalised vector.\n"
             "Returns dict: {success, dimensions, vector, input_text, error?}")
        .def("semantic_search",
             [](PythonAsyncNLPEngine& self,
                const std::string& query,
                const std::vector<std::string>& documents,
                size_t top_k) -> py::object {
                 std::string raw;
                 {
                     py::gil_scoped_release release;
                     raw = self.semantic_search(query, documents, top_k);
                 }
                 return py::module_::import("json").attr("loads")(raw);
             },
             py::arg("query"), py::arg("documents"), py::arg("top_k") = 5,
             "Rank documents by semantic similarity to query.\n"
             "Returns list of dicts: [{text, score, index}, …] sorted best-first.")
        .def("extract_schema",
             [](PythonAsyncNLPEngine& self,
                const std::string& text,
                const py::dict& schema) -> py::object {
                 // Convert Python dict → JSON string for the C++ layer.
                 std::string schema_json =
                     py::module_::import("json").attr("dumps")(schema).cast<std::string>();
                 std::string raw;
                 {
                     py::gil_scoped_release release;
                     raw = self.extract_schema(text, schema_json);
                 }
                 return py::module_::import("json").attr("loads")(raw);
             },
             py::arg("text"), py::arg("schema"),
             "Extract structured fields from text using a schema dict.\n\n"
             "schema:  {field_name: 'plain-text description of what to extract', …}\n\n"
             "Example:\n"
             "  engine.extract_schema(cv_text, {\n"
             "      'company':  'name of the hiring company',\n"
             "      'title':    'job title or role',\n"
             "      'salary':   'compensation or salary range',\n"
             "  })\n\n"
             "Returns dict with the same keys plus '_scores' confidence map.")
        .def("summarize",
             [](PythonAsyncNLPEngine& self,
                const std::string& text,
                float ratio,
                const std::string& query) -> py::object {
                 std::string raw;
                 {
                     py::gil_scoped_release release;
                     raw = self.summarize(text, ratio, query);
                 }
                 return py::module_::import("json").attr("loads")(raw);
             },
             py::arg("text"), py::arg("ratio") = 0.3f, py::arg("query") = "",
             "Extractive summarisation.\n"
             "When the engine has ONNX loaded and query != '' the summary is\n"
             "biased toward sentences semantically close to the query.\n"
             "Falls back to TF-IDF ranking when ONNX is unavailable.\n"
             "Returns dict: {summary, ratio, original_length, summary_length}")
        //  Async semantic methods — fire-and-forget, poll get_task_result()
        .def("embed_async",
             [](PythonAsyncNLPEngine& self, const std::string& text) {
                 py::gil_scoped_release release;
                 return self.embed_async(text);
             },
             py::arg("text"),
             "Submit an embed() call asynchronously.\n"
             "Returns a task_id string; use get_task_result(task_id) to retrieve.")
        .def("semantic_search_async",
             [](PythonAsyncNLPEngine& self,
                const std::string& query,
                const std::vector<std::string>& documents,
                size_t top_k) {
                 py::gil_scoped_release release;
                 return self.semantic_search_async(query, documents, top_k);
             },
             py::arg("query"), py::arg("documents"), py::arg("top_k") = 5,
             "Submit a semantic_search() call asynchronously.\n"
             "Returns a task_id string.")
        .def("extract_schema_async",
             [](PythonAsyncNLPEngine& self,
                const std::string& text,
                const py::dict& schema) {
                 std::string schema_json =
                     py::module_::import("json").attr("dumps")(schema).cast<std::string>();
                 py::gil_scoped_release release;
                 return self.extract_schema_async(text, schema_json);
             },
             py::arg("text"), py::arg("schema"),
             "Submit an extract_schema() call asynchronously.\n"
             "Returns a task_id string.")
        .def("summarize_async",
             [](PythonAsyncNLPEngine& self,
                const std::string& text,
                float ratio,
                const std::string& query) {
                 py::gil_scoped_release release;
                 return self.summarize_async(text, ratio, query);
             },
             py::arg("text"), py::arg("ratio") = 0.3f, py::arg("query") = "",
             "Submit a summarize() call asynchronously.\n"
             "Returns a task_id string.")
        //  Task management
        .def("get_task_result",
             [](PythonAsyncNLPEngine& self,
                const std::string& task_id,
                bool wait) -> py::object {
                 std::string raw = self.get_task_result(task_id, wait);
                 return py::module_::import("json").attr("loads")(raw);
             },
             py::arg("task_id"), py::arg("wait") = false,
             "Retrieve the result of an async task.\n\n"
             "Returns dict:\n"
             "  {done: bool, success: bool, task_id: str, result: <payload>, error?: str}\n\n"
             "When done=False the task is still running; call again later.\n"
             "Pass wait=True to block until the task completes.")
        .def("is_task_done", &PythonAsyncNLPEngine::is_task_done,
             py::arg("task_id"),
             "Returns True when the async task identified by task_id has finished.");
}
