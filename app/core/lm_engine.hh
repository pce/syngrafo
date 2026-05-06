#pragma once
/**
 * @file core/lm_engine.hh
 * @author Patrick Engel
 * @brief C++23 language-model inference engine for Syngrafo (SGF_WITH_LM guard).
 *
 * ## Architecture
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │  pce::lm                                                       │
 *   │                                                                │
 *   │  WorkQueue<Req,Res>   — generic MPSC queue backed by jthread   │
 *   │    ├─ submit(Req) → Expected<Ticket{cancel_id, future<Res>}>   │
 *   │    └─ cancel(cancel_id) → bool   (per-slot atomic cancelled)   │
 *   │                                                                │
 *   │  LMEngine                                                      │
 *   │    ├─ load(path)   → VoidResult    (resets queue, loads model) │
 *   │    ├─ unload()     → void noexcept (drains queue, frees model) │
 *   │    ├─ chat(req)    → Expected<InferenceTicket>                 │
 *   │    ├─ cancel(id)   → bool                                      │
 *   │    └─ status()     → LMStatus noexcept                         │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Conditional compilation:
 *   - With    SGF_WITH_LM: real llama.cpp backend
 *   - Without SGF_WITH_LM: zero-cost stub — all types still exist,
 *     methods return std::unexpected("LM support not compiled in …")
 *
 * @code{.cpp}
 *   pce::lm::LMEngine engine;
 *   if (auto r = engine.load("/models/mistral.gguf"); !r)
 *       std::print("[app] load failed: {}\n", r.error());
 *
 *   auto ticket = engine.chat({.messages = {{.role="user",
 *                                            .content="Hello!"}},
 *                               .max_tokens = 256});
 *   if (ticket) {
 *       auto result = ticket->future.get(); // blocks until done
 *       std::print("{}\n", result.text);
 *   }
 * @endcode
 */

#include "../dms_monadic.hh"   // pce::dms::Expected<T>, pce::dms::VoidResult

#include <atomic>
#include <condition_variable>
#include <deque>
#include <format>
#include <functional>
#include <future>
#include <memory>
#include <mutex>
#include <optional>
#include <print>
#include <stop_token>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#ifdef SGF_WITH_LM
#  include <llama.h>
#endif

namespace pce::lm {

using pce::dms::Expected;
using pce::dms::VoidResult;

// ─── WorkQueue<Req,Res> ───────────────────────────────────────────────────────
//
// Reusable MPSC (multiple-producer, single-consumer) work queue.
//
// Member declaration order is deliberate:
//   handler_, mu_, cv_, queue_, worker_
// jthread is declared LAST so its destructor (which calls request_stop +
// join) runs BEFORE all other members are destroyed, guaranteeing the
// consumer thread never touches a dangling deque.
//
// On destruction / stop-request: the worker breaks its wait loop and calls
// queue_.clear(), which destroys every remaining Slot.  Each Slot owns a
// std::promise; destroying it without set_value/set_exception causes the
// associated future to throw std::future_error(broken_promise) — the
// intended "abandoned request" signal to the caller.

template <typename Req, typename Res>
class WorkQueue {
public:
    // ── Ticket ───────────────────────────────────────────────────────────────
    struct Ticket {
        std::string       cancel_id;
        std::future<Res>  future;
    };

private:
    // ── Slot  ────────────────────────────────────────────────────────────────
    struct Slot {
        Req                request;
        std::promise<Res>  promise;
        std::string        cancel_id;
        std::atomic<bool>  cancelled{false};

        Slot() = default;
        Slot(const Slot&)            = delete;
        Slot& operator=(const Slot&) = delete;
        Slot(Slot&&)                 = delete;
        Slot& operator=(Slot&&)      = delete;
    };

    using Handler = std::function<Res(const Req&, std::stop_token)>;

    // ── Members — declared in spec order; worker_ is LAST ────────────────────
    Handler                                   handler_;
    mutable std::mutex                        mu_;
    std::condition_variable                   cv_;
    std::atomic<uint64_t>                     next_id_{0};
    std::deque<std::shared_ptr<Slot>>         queue_;
    std::jthread                              worker_;     // ← joins first on dtor

    // ── Consumer thread ───────────────────────────────────────────────────────
    void drain(std::stop_token st) {
        while (!st.stop_requested()) {
            std::shared_ptr<Slot> slot;
            {
                std::unique_lock lock(mu_);
                cv_.wait(lock, [&] {
                    return !queue_.empty() || st.stop_requested();
                });
                if (st.stop_requested()) break;
                slot = std::move(queue_.front());
                queue_.pop_front();
            }

            if (slot->cancelled.load(std::memory_order_relaxed)) {
                // Slot goes out of scope here → promise destroyed without value
                // → future throws broken_promise when get() is called.
                continue;
            }

            try {
                slot->promise.set_value(handler_(slot->request, st));
            } catch (...) {
                try { slot->promise.set_exception(std::current_exception()); }
                catch (...) { /* promise already satisfied — ignore */ }
            }
        }

        // Abandon everything still in the queue.  Destroying each Slot
        // destroys its promise without satisfying it → broken_promise.
        std::lock_guard lock(mu_);
        queue_.clear();
    }

public:
    explicit WorkQueue(Handler h)
        : handler_(std::move(h))
        , worker_([this](std::stop_token st) { drain(std::move(st)); })
    {}

    ~WorkQueue() {
        worker_.request_stop();
        cv_.notify_all();
        // worker_ joins here (declared last → destroyed first)
    }

    WorkQueue(const WorkQueue&)            = delete;
    WorkQueue& operator=(const WorkQueue&) = delete;
    WorkQueue(WorkQueue&&)                 = delete;
    WorkQueue& operator=(WorkQueue&&)      = delete;

    // ── submit ────────────────────────────────────────────────────────────────
    [[nodiscard("check error")]]
    Expected<Ticket> submit(Req req) {
        auto slot = std::make_shared<Slot>();
        slot->cancel_id = std::format("lm-{:x}",
                          next_id_.fetch_add(1, std::memory_order_relaxed));
        slot->request   = std::move(req);

        std::future<Res> fut = slot->promise.get_future();
        std::string      cid = slot->cancel_id;

        {
            std::lock_guard lock(mu_);
            queue_.push_back(std::move(slot));
        }
        cv_.notify_one();

        return Ticket{std::move(cid), std::move(fut)};
    }

    // ── cancel ────────────────────────────────────────────────────────────────
    bool cancel(std::string_view cancel_id) {
        std::lock_guard lock(mu_);
        for (auto& s : queue_) {
            if (s->cancel_id == cancel_id) {
                s->cancelled.store(true, std::memory_order_relaxed);
                return true;
            }
        }
        return false;
    }

    // ── depth — number of items still queued (not counting in-progress) ───────
    [[nodiscard]] std::size_t depth() const {
        std::lock_guard lock(mu_);
        return queue_.size();
    }
};


// ─── Domain types ─────────────────────────────────────────────────────────────

/// A single turn in a chat conversation.
struct LMMessage {
    std::string role;     ///< "system" | "user" | "assistant"
    std::string content;
};

/// Input to one inference call.
struct InferenceRequest {
    std::vector<LMMessage> messages;
    int32_t                max_tokens  = 512;
    float                  temperature = 0.7f;
    std::string            cancel_id;  ///< caller-supplied tag for cancellation
};

/// Output of one inference call.
struct InferenceResult {
    std::string text;
    int32_t     prompt_tokens     = 0;
    int32_t     completion_tokens = 0;
    bool        truncated         = false;  ///< true if prompt was front-truncated
};

/// Engine availability snapshot.
struct LMStatus {
    bool        has_lm      = false;
    std::string loaded_path;
    bool        is_busy     = false;
    std::size_t queue_depth = 0;
};

/// Convenience alias — the ticket type returned by LMEngine::chat().
using InferenceTicket = WorkQueue<InferenceRequest, InferenceResult>::Ticket;


// ─── LMEngine ─────────────────────────────────────────────────────────────────

#ifdef SGF_WITH_LM

// ── Internal helpers (not part of the public API) ────────────────────────────
namespace detail {

/// Two-pass llama_chat_apply_template with ChatML fallback.
///
/// First call measures the required buffer size; second call fills it.
/// Falls back to manual ChatML if llama_chat_apply_template returns <= 0
/// (unsupported template, missing BOS, etc.).
inline std::string build_prompt(llama_model*                  model,
                                 const std::vector<LMMessage>& messages)
{
    // Convert domain messages to llama_chat_message (non-owning views —
    // the strings in LMMessage outlive this call).
    std::vector<llama_chat_message> chat;
    chat.reserve(messages.size());
    for (const auto& m : messages)
        chat.push_back({m.role.c_str(), m.content.c_str()});

    // ── Pass 1: measure ───────────────────────────────────────────────────────
    const int32_t needed = llama_chat_apply_template(
        model, nullptr,
        chat.data(), chat.size(),
        /*add_ass=*/true,
        nullptr, 0);

    if (needed > 0) {
        // ── Pass 2: fill ─────────────────────────────────────────────────────
        std::string buf(static_cast<std::size_t>(needed), '\0');
        llama_chat_apply_template(
            model, nullptr,
            chat.data(), chat.size(),
            /*add_ass=*/true,
            buf.data(), needed);
        return buf;
    }

    // ── Fallback: ChatML ─────────────────────────────────────────────────────
    std::string out;
    out.reserve(256u * messages.size() + 32u);
    for (const auto& m : messages) {
        out += "<|im_start|>";
        out += m.role;
        out += '\n';
        out += m.content;
        out += "<|im_end|>\n";
    }
    out += "<|im_start|>assistant\n";
    return out;
}


/// Run a single inference request on `model`.
///
/// Called from the WorkQueue handler (worker thread).  The stop_token
/// `st` belongs to the queue's jthread; a stop request causes the
/// generation loop to exit early (used during engine unload / reload).
inline InferenceResult run_inference(llama_model*            model,
                                      const InferenceRequest& req,
                                      std::stop_token         st)
{
    std::print("[lm] inference begin  cancel_id={}\n", req.cancel_id);

    const std::string prompt    = build_prompt(model, req.messages);
    const int32_t     prompt_sz = static_cast<int32_t>(prompt.size());

    // ── Tokenise ──────────────────────────────────────────────────────────────
    //
    // The prompt_limit is a soft cap: we reserve n_ctx/2 for the prompt
    // and n_ctx/2 for generation.  If the first llama_tokenize call returns
    // a negative value (buffer too small), we re-tokenize into a full-size
    // buffer and truncate from the front to keep the most-recent context.

    constexpr int32_t prompt_limit = 4096;

    std::vector<llama_token> tokens(static_cast<std::size_t>(prompt_limit));
    int32_t n_tokens = llama_tokenize(
        model, prompt.c_str(), prompt_sz,
        tokens.data(), prompt_limit,
        /*add_special=*/true, /*parse_special=*/true);

    bool truncated = false;

    if (n_tokens < 0) {
        // Buffer too small — tokenise fully, then truncate from the front.
        const int32_t needed = -n_tokens;
        std::vector<llama_token> full(static_cast<std::size_t>(needed));
        llama_tokenize(model, prompt.c_str(), prompt_sz,
                       full.data(), needed, true, true);
        // Keep the LAST prompt_limit tokens (most recent context).
        std::copy(full.cend() - prompt_limit, full.cend(), tokens.begin());
        n_tokens  = prompt_limit;
        truncated = true;
    }
    tokens.resize(static_cast<std::size_t>(n_tokens));
    const int32_t n_prompt = n_tokens;

    std::print("[lm] prompt tokens={}{}\n",
               n_prompt, truncated ? " (front-truncated)" : "");

    // ── Create context (fresh per request, RAII-guarded) ─────────────────────
    llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = static_cast<uint32_t>(n_prompt + req.max_tokens + 32u);

    llama_context* ctx = llama_init_from_model(model, ctx_params);
    if (!ctx) {
        std::print("[lm] error: failed to create context\n");
        return InferenceResult{};
    }
    auto ctx_guard = std::unique_ptr<llama_context, decltype(&llama_free)>(
        ctx, llama_free);

    // ── Prefill batch ─────────────────────────────────────────────────────────
    {
        llama_batch batch = llama_batch_init(n_prompt, /*embd=*/0, /*n_seq_max=*/1);
        batch.n_tokens = n_prompt;

        for (int32_t i = 0; i < n_prompt; ++i) {
            batch.token[i]     = tokens[static_cast<std::size_t>(i)];
            batch.pos[i]       = i;
            batch.n_seq_id[i]  = 1;
            batch.seq_id[i][0] = 0;
            // Request logits only for the last token — that is what we sample.
            batch.logits[i]    = (i == n_prompt - 1) ? 1 : 0;
        }

        const int rc = llama_decode(ctx, batch);
        llama_batch_free(batch);

        if (rc != 0) {
            std::print("[lm] error: prefill decode failed (rc={})\n", rc);
            return InferenceResult{};
        }
    }

    // ── Sampler chain ─────────────────────────────────────────────────────────
    {
        auto chain_params   = llama_sampler_chain_default_params();
        llama_sampler* smpl = llama_sampler_chain_init(chain_params);
        auto smpl_guard     = std::unique_ptr<llama_sampler,
                                              decltype(&llama_sampler_free)>(
                                  smpl, llama_sampler_free);

        if (req.temperature < 1e-6f) {
            // Greedy decoding
            llama_sampler_chain_add(smpl, llama_sampler_init_greedy());
        } else {
            // Temperature + categorical distribution (seed=42 for reproducibility)
            llama_sampler_chain_add(smpl, llama_sampler_init_temp(req.temperature));
            llama_sampler_chain_add(smpl, llama_sampler_init_dist(42u));
        }

        // ── Generation loop ───────────────────────────────────────────────────
        std::string output;
        output.reserve(static_cast<std::size_t>(req.max_tokens) * 4u);

        int32_t pos   = n_prompt;  // position of the next token in KV cache
        int32_t n_gen = 0;
        char    piece[256];

        while (!st.stop_requested() && n_gen < req.max_tokens) {
            // Sample from the most recently decoded logits (idx=-1 = last).
            const llama_token tok = llama_sampler_sample(smpl, ctx, -1);
            llama_sampler_accept(smpl, tok);

            if (llama_token_is_eog(model, tok))
                break;

            // Decode token to UTF-8 text piece (zero-copy: reuse stack buffer).
            const int32_t n_piece = llama_token_to_piece(
                model, tok, piece, static_cast<int32_t>(sizeof(piece)),
                /*lstrip=*/0, /*special=*/false);
            if (n_piece > 0)
                output.append(piece, static_cast<std::size_t>(n_piece));

            ++n_gen;

            // Per-step: forward the generated token to get logits for the next.
            llama_batch step = llama_batch_init(1, 0, 1);
            step.n_tokens     = 1;
            step.token[0]     = tok;
            step.pos[0]       = pos++;
            step.n_seq_id[0]  = 1;
            step.seq_id[0][0] = 0;
            step.logits[0]    = 1;   // must produce logits for next sample

            const int step_rc = llama_decode(ctx, step);
            llama_batch_free(step);

            if (step_rc != 0) {
                std::print("[lm] error: generation decode failed at token {}\n", n_gen);
                break;
            }
        }

        std::print("[lm] inference end  generated={} truncated={}\n",
                   n_gen, truncated);

        return InferenceResult{
            .text               = std::move(output),
            .prompt_tokens      = n_prompt,
            .completion_tokens  = n_gen,
            .truncated          = truncated,
        };
    }
}

} // namespace detail


// ─── LMEngine — real backend ──────────────────────────────────────────────────

class LMEngine {
public:
    LMEngine() {
        llama_backend_init();
        std::print("[lm] backend initialised\n");
    }

    ~LMEngine() {
        unload();
        llama_backend_free();
        std::print("[lm] backend freed\n");
    }

    LMEngine(const LMEngine&)            = delete;
    LMEngine& operator=(const LMEngine&) = delete;
    LMEngine(LMEngine&&)                 = delete;
    LMEngine& operator=(LMEngine&&)      = delete;

    // ── load ──────────────────────────────────────────────────────────────────
    /// Load a GGUF model from `path`.
    ///
    /// Sequence:
    ///   1. Reset (drain) the existing WorkQueue, if any.
    ///   2. Free the previously loaded llama_model*.
    ///   3. Load new model with llama_model_load_from_file.
    ///   4. Emplace a fresh WorkQueue wired to run_inference.
    [[nodiscard("check error")]]
    VoidResult load(std::string_view path) {
        // Step 1 — drain current queue (worker joins inside optional::reset)
        queue_.reset();
        busy_.store(false, std::memory_order_relaxed);

        // Step 2 — free old model
        if (model_) {
            std::print("[lm] unloading previous model: {}\n", loaded_path_);
            llama_model_free(model_);
            model_ = nullptr;
            loaded_path_.clear();
        }

        // Step 3 — load new model
        std::print("[lm] loading model: {}\n", path);
        llama_model_params params = llama_model_default_params();
        model_ = llama_model_load_from_file(std::string{path}.c_str(), params);
        if (!model_)
            return std::unexpected(
                std::format("[lm] failed to load model: {}", path));

        loaded_path_ = std::string{path};

        // Step 4 — emplace WorkQueue with the inference handler
        queue_.emplace(
            [this](const InferenceRequest& req, std::stop_token st)
                -> InferenceResult
            {
                busy_.store(true, std::memory_order_relaxed);
                struct Guard {
                    std::atomic<bool>& flag;
                    ~Guard() { flag.store(false, std::memory_order_relaxed); }
                } g{busy_};
                return detail::run_inference(model_, req, st);
            });

        std::print("[lm] model loaded: {}\n", path);
        return {};
    }

    // ── unload ────────────────────────────────────────────────────────────────
    /// Drain the worker queue, then release the model.
    void unload() noexcept {
        queue_.reset();          // jthread joins here; remaining promises break
        busy_.store(false, std::memory_order_relaxed);
        if (model_) {
            llama_model_free(model_);
            model_ = nullptr;
            loaded_path_.clear();
            std::print("[lm] model unloaded\n");
        }
    }

    // ── chat ──────────────────────────────────────────────────────────────────
    /// Submit an inference request. Returns a Ticket immediately; the caller
    /// blocks on ticket.future.get() when it needs the result.
    [[nodiscard("check error")]]
    Expected<InferenceTicket> chat(InferenceRequest req) {
        if (!queue_)
            return std::unexpected(std::string{"[lm] no model loaded"});
        return queue_->submit(std::move(req));
    }

    // ── cancel ────────────────────────────────────────────────────────────────
    /// Mark a queued (not-yet-started) request as cancelled.
    /// Returns true if the cancel_id was found in the queue.
    bool cancel(std::string_view cancel_id) {
        if (!queue_) return false;
        return queue_->cancel(cancel_id);
    }

    // ── status ────────────────────────────────────────────────────────────────
    [[nodiscard]]
    LMStatus status() noexcept {
        return LMStatus{
            .has_lm      = true,
            .loaded_path = loaded_path_,
            .is_busy     = busy_.load(std::memory_order_relaxed),
            .queue_depth = queue_ ? queue_->depth() : std::size_t{0},
        };
    }

private:
    // model_ is declared first → destroyed LAST.
    // queue_ is declared last  → destroyed FIRST (jthread joins before model_ freed).
    llama_model*                                                model_       = nullptr;
    std::string                                                 loaded_path_;
    std::atomic<bool>                                           busy_        {false};
    std::optional<WorkQueue<InferenceRequest, InferenceResult>> queue_;
};


// ─── LMEngine — no-op stub (SGF_WITH_LM not defined) ─────────────────────────
#else

class LMEngine {
public:
    LMEngine()  = default;
    ~LMEngine() = default;

    LMEngine(const LMEngine&)            = delete;
    LMEngine& operator=(const LMEngine&) = delete;
    LMEngine(LMEngine&&)                 = delete;
    LMEngine& operator=(LMEngine&&)      = delete;

    [[nodiscard("check error")]]
    VoidResult load(std::string_view) {
        return std::unexpected(
            std::string{"LM support not compiled in (SGF_WITH_LM)"});
    }

    void unload() noexcept {}

    [[nodiscard("check error")]]
    Expected<InferenceTicket> chat(InferenceRequest) {
        return std::unexpected(
            std::string{"LM support not compiled in (SGF_WITH_LM)"});
    }

    bool cancel(std::string_view) { return false; }

    [[nodiscard]]
    LMStatus status() noexcept {
        return LMStatus{.has_lm = false};
    }
};

#endif // SGF_WITH_LM

} // namespace pce::lm
