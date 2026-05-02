#pragma once
/**
 * @file keychain_mac.hh
 * @brief macOS Keychain helpers — store / load / remove a zone key.
 *
 * Uses Security.framework's SecItem* CF API so this header can be included
 * from plain C++ translation units (no Objective-C syntax required).
 *
 * Every zone key is stored as a kSecClassGenericPassword item:
 *   service : "org.pce.syngrafo"
 *   account : "zone.<zone_name>"
 *   data    : 64-char lowercase hex key string
 *
 * On non-Apple platforms the header compiles to nothing.
 */

#ifdef __APPLE__

#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <optional>
#include <print>
#include <string>
#include <string_view>

namespace pce::keychain {

static constexpr std::string_view kService = "org.pce.syngrafo";

/// Synthesise the Keychain account string for a zone: "zone.<name>"
[[nodiscard]] inline std::string zone_account(std::string_view zone_name) {
    return "zone." + std::string{zone_name};
}

// ── Internal helper — build a CFStringRef from a std::string_view ────────────
namespace detail {
[[nodiscard]] inline CFStringRef make_cf_str(std::string_view sv) {
    return CFStringCreateWithBytes(
        kCFAllocatorDefault,
        reinterpret_cast<const UInt8*>(sv.data()),
        static_cast<CFIndex>(sv.size()),
        kCFStringEncodingUTF8,
        /*isExternalRepresentation=*/false);
}
[[nodiscard]] inline CFDataRef make_cf_data(std::string_view sv) {
    return CFDataCreate(
        kCFAllocatorDefault,
        reinterpret_cast<const UInt8*>(sv.data()),
        static_cast<CFIndex>(sv.size()));
}
} // namespace detail

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Store (or replace) a key in the macOS Keychain.
 *
 * The item is accessible whenever the device is unlocked
 * (kSecAttrAccessibleWhenUnlocked).  It is NOT synchronized to iCloud
 * (no kSecAttrSynchronizable = YES) so it stays local to the machine.
 *
 * @param account  Keychain account string, typically zone_account(name).
 * @param key_hex  64-char lowercase hex key to store.
 * @returns true on success.
 */
[[nodiscard]] inline bool store(std::string_view account,
                                std::string_view key_hex) {
    CFStringRef svc  = detail::make_cf_str(kService);
    CFStringRef acct = detail::make_cf_str(account);
    CFDataRef   data = detail::make_cf_data(key_hex);

    // ── 1. Try to update an existing item ────────────────────────────────────
    const void* qk[] = { kSecClass, kSecAttrService, kSecAttrAccount };
    const void* qv[] = { kSecClassGenericPassword, svc, acct };
    CFDictionaryRef query = CFDictionaryCreate(
        kCFAllocatorDefault, qk, qv, 3,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);

    const void* uk[] = { kSecValueData };
    const void* uv[] = { data };
    CFDictionaryRef update_attrs = CFDictionaryCreate(
        kCFAllocatorDefault, uk, uv, 1,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);

    OSStatus st = SecItemUpdate(query, update_attrs);
    CFRelease(update_attrs);
    CFRelease(query);

    if (st == errSecItemNotFound) {
        // ── 2. Item not found — add it ───────────────────────────────────────
        const void* ak[] = {
            kSecClass, kSecAttrService, kSecAttrAccount,
            kSecValueData, kSecAttrAccessible,
        };
        const void* av[] = {
            kSecClassGenericPassword, svc, acct,
            data, kSecAttrAccessibleWhenUnlocked,
        };
        CFDictionaryRef add_query = CFDictionaryCreate(
            kCFAllocatorDefault, ak, av, 5,
            &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
        st = SecItemAdd(add_query, /*result=*/nullptr);
        CFRelease(add_query);
    }

    CFRelease(data);
    CFRelease(acct);
    CFRelease(svc);

    if (st != errSecSuccess) {
        std::print(stderr,
            "[keychain] store('{}') failed: OSStatus {}\n",
            account, static_cast<int>(st));
    }
    return st == errSecSuccess;
}

/**
 * Retrieve a key from the Keychain.
 * @returns the 64-char hex key string, or std::nullopt if not found.
 */
[[nodiscard]] inline std::optional<std::string> load(std::string_view account) {
    CFStringRef svc  = detail::make_cf_str(kService);
    CFStringRef acct = detail::make_cf_str(account);

    const void* qk[] = {
        kSecClass, kSecAttrService, kSecAttrAccount,
        kSecReturnData, kSecMatchLimit,
    };
    const void* qv[] = {
        kSecClassGenericPassword, svc, acct,
        kCFBooleanTrue, kSecMatchLimitOne,
    };
    CFDictionaryRef query = CFDictionaryCreate(
        kCFAllocatorDefault, qk, qv, 5,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);

    CFTypeRef result = nullptr;
    OSStatus st = SecItemCopyMatching(query, &result);
    CFRelease(query);
    CFRelease(acct);
    CFRelease(svc);

    if (st != errSecSuccess || !result) return std::nullopt;

    const auto* bytes = CFDataGetBytePtr(static_cast<CFDataRef>(result));
    const auto  len   = CFDataGetLength(static_cast<CFDataRef>(result));
    std::string key{reinterpret_cast<const char*>(bytes),
                    static_cast<std::size_t>(len)};
    CFRelease(result);
    return key;
}

/**
 * Delete a key from the Keychain.
 * @returns true on success or if the item was already absent.
 */
inline bool remove(std::string_view account) {
    CFStringRef svc  = detail::make_cf_str(kService);
    CFStringRef acct = detail::make_cf_str(account);

    const void* qk[] = { kSecClass, kSecAttrService, kSecAttrAccount };
    const void* qv[] = { kSecClassGenericPassword, svc, acct };
    CFDictionaryRef query = CFDictionaryCreate(
        kCFAllocatorDefault, qk, qv, 3,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);

    OSStatus st = SecItemDelete(query);
    CFRelease(query);
    CFRelease(acct);
    CFRelease(svc);

    return st == errSecSuccess || st == errSecItemNotFound;
}

} // namespace pce::keychain

#endif // __APPLE__
