#ifndef NLP_ADDON_SYSTEM_HH
#define NLP_ADDON_SYSTEM_HH

#include <string>
#include <memory>
#include <vector>
#include <variant>
#include <unordered_map>
#include <optional>
#include <functional>
#include <expected>

/**
 * @file nlp_addon_system.hh
 * @brief Zero-overhead static addon architecture for the NLP engine.
 *
 * This system uses CRTP (Curiously Recurring Template Pattern) and
 * polymorphism to provide a plugin-like architecture without the
 * runtime overhead of heavy virtual registries.
 */

namespace pce::nlp {

/**
 * @struct AddonContext
 * @brief Persistent state for a specific session or document.
 *
 * Used to maintain history or session-specific metadata across multiple
 * calls to the same or different addons.
 */
struct AddonContext {
    /** @brief Unique identifier for the session. */
    std::string session_id;
    /** @brief Key-value store for session-specific metadata. */
    std::unordered_map<std::string, std::string> metadata;
    /** @brief List of previously processed strings or identifiers. */
    std::vector<std::string> history;

    /** @brief Checks if a specific metadata key exists using C++23 contains(). */
    bool has_meta(std::string_view key) const { return metadata.contains(std::string(key)); }
};

/**
 * @struct AddonResponse
 * @brief Standardized result from any NLP Addon operation.
 *
 * This structure follows the "Native-First" pattern. Internal C++ logic
 * populates the native maps (metrics/metadata) for high-performance access,
 * while the AsyncNLPEngine layer handles serialization for external APIs.
 */
struct AddonResponse {
    /** @brief The primary result string (e.g., generated text or cleaned content). */
    std::string output;

    /** @brief Boolean indicating if the operation completed successfully. */
    bool success = false;

    /** @brief Diagnostic information or error details if success is false. */
    std::string error_message;

    /** @brief Numeric performance and logic metrics (e.g., "tokens_generated", "time_ms"). */
    std::unordered_map<std::string, double> metrics;

    /** @brief Structured metadata for the response (e.g., "dup_0_offset", "language"). */
    std::unordered_map<std::string, std::string> metadata;

    /** @brief Internal helper to check if the response contains specific metadata (C++23). */
    bool has_meta(std::string_view key) const { return metadata.contains(std::string(key)); }

    /** @brief Rule of 5: Explicitly declared for clarity and safety. */
    AddonResponse() = default;
    virtual ~AddonResponse() = default;
    AddonResponse(const AddonResponse&) = default;
    AddonResponse& operator=(const AddonResponse&) = default;
    AddonResponse(AddonResponse&&) noexcept = default;
    AddonResponse& operator=(AddonResponse&&) noexcept = default;

    /**
     * @brief Convenient constructor for quick responses.
     */
    AddonResponse(std::string out, bool succ, std::string err = "",
                  std::unordered_map<std::string, double> met = {})
        : output(std::move(out)),
          success(succ),
          error_message(std::move(err)),
          metrics(std::move(met)) {}
};

/**
 * @class INLPAddon
 * @brief Abstract base class to allow pointer-based registration and polymorphism.
 */
class INLPAddon {
public:
    virtual ~INLPAddon() = default;
    /** @brief Get the unique name of the addon. */
    virtual const std::string& name() const = 0;
    /** @brief Get the version string of the addon. */
    virtual const std::string& version() const = 0;
    /** @brief Initialize the addon resources. */
    virtual bool initialize() = 0;
    /** @brief Checks if the addon is initialized and ready for processing. */
    virtual bool is_ready() const = 0;
    /**
     * @brief Process text and return a structured response.
     * @return std::expected containing AddonResponse or an error string (C++23).
     */
    virtual std::expected<AddonResponse, std::string> process(
        const std::string& input,
        const std::unordered_map<std::string, std::string>& options = {},
        std::shared_ptr<AddonContext> context = nullptr) = 0;

    /**
     * @brief Process text asynchronously via a stream callback.
     */
    virtual void process_stream(
        const std::string& input,
        std::function<void(const std::string& chunk, bool is_final)> callback,
        const std::unordered_map<std::string, std::string>& options = {},
        std::shared_ptr<AddonContext> context = nullptr) = 0;
};

/**
 * @class NLPAddon
 * @brief CRTP-based Base class for zero-overhead static Addons.
 *
 * Implements the INLPAddon interface to support shared pointers in maps while
 * preserving the static dispatch benefits of CRTP where possible.
 */
template <typename Derived>
class NLPAddon : public INLPAddon {
public:
    const std::string& name() const override {
        return static_cast<const Derived*>(this)->name_impl();
    }

    const std::string& version() const override {
        return static_cast<const Derived*>(this)->version_impl();
    }

    bool initialize() override {
        return static_cast<Derived*>(this)->init_impl();
    }

    bool is_ready() const override {
        return static_cast<const Derived*>(this)->is_ready_impl();
    }

    std::expected<AddonResponse, std::string> process(
        const std::string& input,
        const std::unordered_map<std::string, std::string>& options = {},
        std::shared_ptr<AddonContext> context = nullptr) override {
        auto resp = static_cast<Derived*>(this)->process_impl(input, options, context);
        if (!resp.success) return std::unexpected(std::string(resp.error_message));
        return resp;
    }

    void process_stream(const std::string& input,
                        std::function<void(const std::string& chunk, bool is_final)> callback,
                        const std::unordered_map<std::string, std::string>& options = {},
                        std::shared_ptr<AddonContext> context = nullptr) override {
        static_cast<Derived*>(this)->process_stream_impl(input, callback, options, context);
    }

protected:
    virtual ~NLPAddon() = default;
};

// --- Addon Collection ---

// Forward declarations
class MarkovAddon;

/**
 * @typedef AddonVariant
 * @brief A type-safe container for any supported NLP Addon.
 *
 * While we use INLPAddon* for registration, this variant remains useful
 * for stack-based visitors or strict type checking.
 */
using AddonVariant = std::variant<
    std::shared_ptr<MarkovAddon>
>;

/**
 * @struct AddonVisitor
 * @brief Specialized visitor to invoke addon logic.
 */
struct AddonVisitor {
    const std::string& input;
    const std::unordered_map<std::string, std::string>& options;

    // Support for the base pointer interface or shared pointers to derived types
    std::expected<AddonResponse, std::string> operator()(const std::shared_ptr<INLPAddon>& addon) const {
        if (!addon || !addon->is_ready()) {
            return std::unexpected(std::string("Addon not ready or null"));
        }
        return addon->process(input, options);
    }
};

/**
 * @interface ITrainable
 * @brief Optional interface for Addons that support the separate Training Pipeline.
 */
class ITrainable {
public:
    virtual ~ITrainable() = default;

    virtual bool train(const std::string& source_path, const std::string& model_output_path) = 0;
    virtual float get_training_progress() const = 0;
};

} // namespace pce::nlp

#endif // NLP_ADDON_SYSTEM_HH
