#include "nlp_engine_async.hh"
#include <chrono>
#include <random>
#include <sstream>
#include <iomanip>
#include <cmath>
#include <thread>
#include <algorithm>
#include "addons/markov_addon.hh"
#include "addons/vector_addon.hh"

namespace pce::nlp {


static std::string generate_task_id() {
    static std::random_device rd;
    static std::mt19937 gen(rd());
    static std::uniform_int_distribution<uint64_t> dis;

    std::stringstream ss;
    ss << "task_" << std::hex << std::setw(16) << std::setfill('0') << dis(gen);
    return ss.str();
}


std::string AsyncTaskManager::submit_task(std::function<AsyncResult()> task) {
    std::lock_guard<std::mutex> lock(tasks_mutex_);
    std::string task_id = generate_task_id();
    tasks_[task_id] = std::async(std::launch::async, [task]() {
        return task();
    });
    return task_id;
}

AsyncResult AsyncTaskManager::get_result(const std::string& task_id, bool wait) {
    std::lock_guard<std::mutex> lock(tasks_mutex_);
    auto it = tasks_.find(task_id);
    if (it == tasks_.end()) {
        return {"", false, "Task not found", task_id};
    }

    if (!wait) {
        auto status = it->second.wait_for(std::chrono::seconds(0));
        if (status != std::future_status::ready) {
            return {"", false, "Task still running", task_id};
        }
    }

    try {
        AsyncResult res = it->second.get();
        tasks_.erase(it);
        return res;
    } catch (const std::exception& e) {
        return {"", false, e.what(), task_id};
    }
}

void AsyncTaskManager::cancel_task(const std::string& task_id) {
    std::lock_guard<std::mutex> lock(tasks_mutex_);
    tasks_.erase(task_id);
}

bool AsyncTaskManager::is_task_complete(const std::string& task_id) {
    std::lock_guard<std::mutex> lock(tasks_mutex_);
    auto it = tasks_.find(task_id);
    if (it == tasks_.end()) return false;
    return it->second.wait_for(std::chrono::seconds(0)) == std::future_status::ready;
}


AsyncNLPEngine::AsyncNLPEngine(std::shared_ptr<NLPModel> model)
    : model_(model), is_running_(false) {
    task_manager_ = std::make_unique<AsyncTaskManager>();
}

AsyncNLPEngine::~AsyncNLPEngine() {
    shutdown();
}

bool AsyncNLPEngine::initialize() {
    is_running_ = true;
    return true;
}

bool AsyncNLPEngine::shutdown() {
    is_running_ = false;
    return true;
}

bool AsyncNLPEngine::add_addon(std::shared_ptr<INLPAddon> addon) {
    if (!addon) return false;
    std::lock_guard<std::mutex> lock(addons_mutex_);
    addons_[addon->name()] = addon;
    return true;
}

bool AsyncNLPEngine::remove_addon(const std::string& name) {
    std::lock_guard<std::mutex> lock(addons_mutex_);
    return addons_.erase(name) > 0;
}

bool AsyncNLPEngine::has_addon(const std::string& name) {
    std::lock_guard<std::mutex> lock(addons_mutex_);
    return addons_.find(name) != addons_.end();
}

std::string AsyncNLPEngine::process_sync(
    const std::string& text,
    const std::string& method,
    const std::unordered_map<std::string, std::string>& options,
    const std::string& session_id
) {
    if (!is_running_) {
        return "{\"error\": \"Engine not running. Call initialize() first.\"}";
    }

    {
        std::shared_ptr<AddonContext> ctx = !session_id.empty() ? get_context(session_id) : nullptr;

        std::lock_guard<std::mutex> lock(addons_mutex_);
        auto it = addons_.find(method);
        if (it != addons_.end()) {
            auto addon = it->second;
            if (!addon || !addon->is_ready()) {
                return "{\"error\": \"Addon '" + method + "' not ready\"}";
            }

            try {
                /**
                 * @brief Execute the addon logic.
                 * "JSON at the Edge" - the addon returns a native C++ std::expected result (C++23).
                 */
                auto result = addon->process(text, options, ctx);

                if (!result.has_value()) {
                    return nlohmann::json({
                        {"success", false},
                        {"error", result.error()},
                        {"status", "error"}
                    }).dump();
                }

                const auto& resp = result.value();

                /**
                 * @brief Serialization Layer (The Edge)
                 * We structure the native C++ result into a standard JSON contract here.
                 */
                nlohmann::json res_json;
                res_json["output"] = resp.output;
                res_json["metadata"] = resp.metadata;
                res_json["metrics"] = resp.metrics;
                res_json["success"] = true;
                res_json["status"] = "success";

                return res_json.dump();
            } catch (const std::exception& e) {
                return nlohmann::json({
                    {"success", false},
                    {"error", std::string(e.what())},
                    {"status", "exception"}
                }).dump();
            }
        }
    }

    if (!model_ || !model_->is_ready()) {
        return "{\"error\": \"Base model not loaded for: " + method + "\"}";
    }

    NLPEngine engine(model_);
    std::string lang = options.count("lang") ? options.at("lang") : "en";

    /**
     * @brief Fallback to Core Linguistic Engine
     * Standardizes core model results into the same JSON contract.
     */
    if (method == "language" || method == "detect_language") {
        return engine.language_to_json(engine.detect_language(text)).dump();
    } else if (method == "sentiment" || method == "analyze_sentiment") {
        return engine.sentiment_to_json(engine.analyze_sentiment(text, lang)).dump();
    } else if (method == "spell_check") {
        return engine.corrections_to_json(engine.spell_check(text, lang)).dump();
    } else if (method == "readability") {
        return engine.readability_to_json(engine.analyze_readability(text)).dump();
    } else if (method == "terminology") {
        nlohmann::json res;
        res["output"] = "";
        res["metadata"] = {{"count", std::to_string(engine.extract_terminology(text, lang).size())}};
        res["metrics"] = {{"terms", static_cast<double>(engine.extract_terminology(text, lang).size())}};
        res["success"] = true;
        return res.dump();
    }

    return nlohmann::json({
        {"success", false},
        {"error", "Unknown method: " + method},
        {"status", "unsupported"}
    }).dump();
}

std::string AsyncNLPEngine::process_text_async(
    const std::string& text,
    const std::string& addon_name,
    StreamCallback stream_callback,
    const std::unordered_map<std::string, std::string>& options,
    const std::string& session_id
) {
    if (!is_running_) return "";

    return task_manager_->submit_task(
        [this, text, addon_name, stream_callback, options, session_id]() -> AsyncResult {
            std::shared_ptr<AddonContext> ctx =
                !session_id.empty() ? get_context(session_id) : nullptr;

            {
                std::lock_guard<std::mutex> lock(addons_mutex_);
                auto it = addons_.find(addon_name);
                if (it != addons_.end()) {
                    auto result = it->second->process(text, options, ctx);
                    if (!result.has_value()) {
                        if (stream_callback) stream_callback("[Error] " + result.error(), true);
                        return AsyncResult{"", false, result.error(), ""};
                    }
                    const auto& resp = result.value();
                    if (stream_callback) stream_callback(resp.output, true);
                    return AsyncResult{resp.output, resp.success, resp.error_message, ""};
                }
            }

            if (stream_callback) stream_callback("Processing complete.\n", true);
            return AsyncResult{"Success", true, "", ""};
        });
}

std::string AsyncNLPEngine::submit_task(
    std::function<AsyncResult()> task,
    const std::string& task_name
) {
    return task_manager_->submit_task(task);
}

AsyncResult AsyncNLPEngine::get_task_result(const std::string& task_id) {
    return task_manager_->get_result(task_id);
}

void AsyncNLPEngine::stream_text(
    const std::string& text,
    const std::string& addon_name,
    StreamCallback callback,
    const std::unordered_map<std::string, std::string>& options,
    const std::string& session_id
) {
    if (!callback) return;

    task_manager_->submit_task([this, text, addon_name, callback, options, session_id]() -> AsyncResult {
        std::shared_ptr<AddonContext> ctx = !session_id.empty() ? get_context(session_id) : nullptr;

        // Specialized path for Markov Streaming
        {
            std::lock_guard<std::mutex> lock(addons_mutex_);
            auto it = addons_.find(addon_name);
            if (it != addons_.end()) {
                // If it's a MarkovAddon, use its dedicated streaming method
                auto markov = std::dynamic_pointer_cast<MarkovAddon>(it->second);
                if (markov) {
                    markov->process_stream_impl(text, callback, options, ctx);
                    return AsyncResult{"Stream Complete", true, "", ""};
                }

                // Fallback for other addons that only implement process()
                auto result = it->second->process(text, options, ctx);
                if (!result.has_value()) {
                    callback("[Error] " + result.error(), true);
                    return AsyncResult{"", false, result.error(), ""};
                }
                const auto& resp = result.value();
                callback(resp.output, true);
                return AsyncResult{resp.output, resp.success, resp.error_message, ""};
            }
        }

        // Default Linguistic Stream
        if (!model_) {
            callback("[Error] Core model missing\n", true);
            return AsyncResult{"Error", false, "Model missing", ""};
        }

        NLPEngine engine(model_);
        try {
            callback("[Log] Starting analysis...\n", false);
            auto lang = engine.detect_language(text);
            callback("Language: " + lang.language + "\n", false);

            auto sentiment = engine.analyze_sentiment(text, lang.language);
            callback("Sentiment: " + sentiment.label + "\n", false);

            if (options.count("terminology") && options.at("terminology") == "true") {
                auto terms = engine.extract_terminology(text, lang.language);
                callback("Terminology count: " + std::to_string(terms.size()) + "\n", false);
            }

            callback("Finished.\n", true);
        } catch (const std::exception& e) {
            callback("[Error] " + std::string(e.what()) + "\n", true);
            return AsyncResult{"Error", false, e.what(), ""};
        }

        return AsyncResult{"Success", true, "", ""};
    });
}

std::shared_ptr<AddonContext> AsyncNLPEngine::get_context(const std::string& session_id) {
    std::lock_guard<std::mutex> lock(contexts_mutex_);
    auto it = contexts_.find(session_id);
    if (it != contexts_.end()) return it->second;

    auto ctx = std::make_shared<AddonContext>();
    ctx->session_id = session_id;
    contexts_[session_id] = ctx;
    return ctx;
}

void AsyncNLPEngine::clear_context(const std::string& session_id) {
    std::lock_guard<std::mutex> lock(contexts_mutex_);
    contexts_.erase(session_id);
}

} // namespace pce::nlp
