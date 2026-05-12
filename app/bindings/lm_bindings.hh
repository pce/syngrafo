/**
 * @file bindings/lm_bindings.hh
 * @brief Saucer IPC bindings for local GGUF inference via LMEngine.
 *
 * Registers five JS-callable functions on the saucer smartview.
 * All bindings compile and return `{ok:false}` when @c SGF_WITH_LM is off —
 * the stub LMEngine in lm_engine.hh handles that transparently.
 *
 * | Binding          | Behaviour                                              |
 * |------------------|--------------------------------------------------------|
 * | lm_status()      | Engine snapshot: has_lm, loaded_model, is_busy, depth |
 * | lm_load(id)      | Resolve id→path via ModelDownloader, mmap model        |
 * | lm_unload()      | Drain queue, free model                                |
 * | lm_chat_start(…) | Enqueue inference, return request_id immediately       |
 * | lm_cancel(id)    | Mark pending job cancelled before it starts            |
 *
 * @par Push model
 * @c lm_chat_start returns a @c request_id synchronously; the actual result
 * arrives later as a JS push:
 * @code
 *   window.__lm_result(request_id, text, prompt_tokens, completion_tokens)
 *   window.__lm_error (request_id, error_message)
 * @endcode
 */

#pragma once

#include "../core/lm_engine.hh"
#include "../dms_handle.hh"

#include <nlohmann/json.hpp>
#include <saucer/model_downloader.hpp>
#include <saucer/smartview.hpp>
#include <saucer/webview.hpp>

#include <algorithm>
#include <atomic>
#include <format>
#include <print>
#include <string>
#include <thread>

namespace pce::dms {

/** @cond INTERNAL — lm push helpers and input validation */
namespace lm_detail {

inline void push_result(saucer::webview*   wv,
                         std::string_view   request_id,
                         std::string_view   text,
                         int32_t            prompt_tokens,
                         int32_t            completion_tokens) {
    if (!wv) return;
    using json = nlohmann::json;
    const std::string js = std::format(
        "typeof window.__lm_result==='function'"
        " && window.__lm_result({},{},{},{})",
        json(request_id).dump(),
        json(text).dump(),
        prompt_tokens,
        completion_tokens);
    try { wv->execute(js); } catch (...) {}
}

inline void push_error(saucer::webview*   wv,
                        std::string_view   request_id,
                        std::string_view   message) {
    if (!wv) return;
    using json = nlohmann::json;
    const std::string js = std::format(
        "typeof window.__lm_error==='function'"
        " && window.__lm_error({},{})",
        json(request_id).dump(),
        json(message).dump());
    try { wv->execute(js); } catch (...) {}
}

/**
 * @brief Spawn a detached thread that blocks on @p ticket.future and pushes
 *        the result (or error) to the page when inference completes.
 *
 * Uses @p wv_ptr (atomic pointer) rather than a reference so the thread can
 * safely detect when the webview has been torn down (pointer set to null in
 * ~DMSHandle) and skip the execute() call instead of accessing a dangling ref.
 */
inline void watch_and_push(std::atomic<saucer::webview*>& wv_ptr, pce::lm::InferenceTicket ticket) {
    std::thread([&wv_ptr, t = std::move(ticket)]() mutable {
        try {
            auto result = t.future.get();
            push_result(wv_ptr.load(std::memory_order_acquire), t.cancel_id,
                        result.text,
                        result.prompt_tokens,
                        result.completion_tokens);
        } catch (const std::future_error& fe) {
            push_error(wv_ptr.load(std::memory_order_acquire), t.cancel_id,
                fe.code() == std::future_errc::broken_promise
                    ? "request cancelled"
                    : fe.what());
        } catch (const std::exception& e) {
            push_error(wv_ptr.load(std::memory_order_acquire), t.cancel_id, e.what());
        } catch (...) {
            push_error(wv_ptr.load(std::memory_order_acquire), t.cancel_id, "unknown inference error");
        }
    }).detach();
}

/// Role allow-list — anything else is rejected to avoid prompt-injection surprises.
constexpr std::string_view kAllowedRoles[] = {"system", "user", "assistant"};

constexpr std::size_t kMaxMessages      = 200;
constexpr std::size_t kMaxContentBytes  = 200'000;
constexpr int         kMaxTokensHard    = 8'192;
constexpr float       kTemperatureMin   = 0.0f;
constexpr float       kTemperatureMax   = 2.0f;

/**
 * @brief Parse and validate a JSON message array from the frontend.
 *
 * Enforces the role allow-list, message count cap, and per-message content
 * size cap before the data reaches the inference queue.
 */
[[nodiscard]] inline Expected<std::vector<pce::lm::LMMessage>>
parse_messages(std::string_view json_str) {
    using json = nlohmann::json;
    return try_invoke([&]() -> std::vector<pce::lm::LMMessage> {
        const json arr = json::parse(json_str);
        if (!arr.is_array())
            throw std::runtime_error{"messages must be a JSON array"};
        if (arr.size() > kMaxMessages)
            throw std::runtime_error{std::format(
                "too many messages: {} (max {})", arr.size(), kMaxMessages)};

        std::vector<pce::lm::LMMessage> msgs;
        msgs.reserve(arr.size());
        for (const auto& el : arr) {
            auto role    = el.at("role").get<std::string>();
            auto content = el.at("content").get<std::string>();

            const bool role_ok = std::any_of(
                std::begin(kAllowedRoles), std::end(kAllowedRoles),
                [&](std::string_view allowed){ return role == allowed; });
            if (!role_ok)
                throw std::runtime_error{std::format(
                    "invalid role '{}': must be system, user, or assistant", role)};

            if (content.size() > kMaxContentBytes)
                throw std::runtime_error{std::format(
                    "message content too long: {} bytes (max {})",
                    content.size(), kMaxContentBytes)};

            msgs.push_back({ .role = std::move(role), .content = std::move(content) });
        }
        return msgs;
    });
}

} // namespace lm_detail
/** @endcond */

/**
 * @brief Register all LM inference IPC bindings on @p wv.
 *
 * @param wv        Saucer smartview that owns the page JS context.
 * @param engine    LMEngine instance (stub no-ops when SGF_WITH_LM is off).
 * @param model_dl  ModelDownloader used by @c lm_load to resolve catalog ids
 *                  to on-disk GGUF paths.
 * @param shared_wv Atomic webview pointer from DMSHandle; used by the
 *                  watch_and_push thread to detect teardown safely.
 */
inline void register_lm_bindings(
    saucer::smartview&                             wv,
    pce::lm::LMEngine&                             engine,
    saucer::model_downloader::ModelDownloader&     model_dl,
    std::atomic<saucer::webview*>&                 shared_wv)
{
    using json   = nlohmann::json;
    using string = std::string;

    wv.expose("lm_status", [&engine]() -> string {
        const auto st = engine.status();
        return ok_json(json{
            {"has_lm",       st.has_lm},
            {"loaded_model", st.loaded_path.empty() ? json{nullptr} : json{st.loaded_path}},
            {"is_busy",      st.is_busy},
            {"queue_depth",  static_cast<int>(st.queue_depth)},
        });
    });

    // lm_load blocks — model mmap can take several seconds on first load.
    // saucer::expose() runs on a thread-pool thread so blocking is acceptable.
    wv.expose("lm_load", [&engine, &model_dl](string model_id) -> string {
        const string path = model_dl.get_model_path(model_id);
        if (path.empty())
            return err_json(std::format(
                "model '{}' not downloaded — use model_start() first", model_id));
        const auto r = engine.load(path);
        return r ? ok_json(json{{"loaded_model", path}}) : err_json(r.error());
    });

    wv.expose("lm_unload", [&engine]() -> string {
        engine.unload();
        return ok_json(json{{"unloaded", true}});
    });

    wv.expose("lm_chat_start",
        [&engine, &shared_wv](string messages_json, int max_tokens, float temperature) -> string {
            auto msgs = lm_detail::parse_messages(messages_json);
            if (!msgs)
                return err_json(msgs.error());

            pce::lm::InferenceRequest req{
                .messages    = std::move(*msgs),
                .max_tokens  = std::clamp(max_tokens, 1, lm_detail::kMaxTokensHard),
                .temperature = std::clamp(temperature,
                                          lm_detail::kTemperatureMin,
                                          lm_detail::kTemperatureMax),
            };

            auto ticket_result = engine.chat(std::move(req));
            if (!ticket_result)
                return err_json(ticket_result.error());

            const auto rid = ticket_result->cancel_id;
            lm_detail::watch_and_push(shared_wv, std::move(*ticket_result));

            std::print("[lm] chat_start: request_id={}\n", rid);
            return ok_json(json{{"request_id", rid}});
        });

    wv.expose("lm_cancel", [&engine](string request_id) -> string {
        return ok_json(json{{"cancelled", engine.cancel(request_id)}});
    });

    std::print("[lm] bindings registered (SGF_WITH_LM={})\n",
#ifdef SGF_WITH_LM
               "ON"
#else
               "OFF"
#endif
    );
}

} // namespace pce::dms
