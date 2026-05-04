#pragma once
/**
 * @file bindings/netmon_bindings.hh
 * @brief Exposes `netmon_health` — a zero-allocation snapshot of local network state.
 *
 * Baseline fingerprints are captured on the first call (app startup).
 * Each subsequent call compares current state against that baseline so the
 * "changed" flags reflect drift from the normal startup state, not from the
 * last poll.
 *
 * Platform support:
 *   macOS / Linux  — getifaddrs, /etc/resolv.conf mtime, sysctl / /proc/net/route
 *   Windows        — GetAdaptersAddresses, GetTcpTable2
 */

#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <string>
#include <string_view>

#ifdef _WIN32
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
#  include <iphlpapi.h>
#  include <vector>
#else
#  include <arpa/inet.h>
#  include <ifaddrs.h>
#  include <netinet/in.h>
#  include <sys/socket.h>
#  include <sys/stat.h>
#endif

#ifdef __APPLE__
#  include <net/if.h>
#  include <net/route.h>
#  include <sys/sysctl.h>
#endif

#ifdef __linux__
#  include <fstream>
#endif

#include <nlohmann/json.hpp>
#include <saucer/smartview.hpp>

namespace pce::netmon {

using json = nlohmann::json;

// ── helpers ───────────────────────────────────────────────────────────────────

static int64_t now_ms() noexcept {
    using namespace std::chrono;
    return duration_cast<milliseconds>(
        system_clock::now().time_since_epoch()
    ).count();
}

/** FNV-1a 64-bit step. */
static constexpr uint64_t fnv_step(uint64_t h, uint64_t v) noexcept {
    return (h ^ v) * 1099511628211ULL;
}

// ── network fingerprints ──────────────────────────────────────────────────────

/** Hash the current interface list (name + flags + IPv4/IPv6 addresses). */
static uint64_t iface_fingerprint() noexcept {
#if defined(__APPLE__) || defined(__linux__)
    struct ifaddrs* ifa = nullptr;
    if (getifaddrs(&ifa) != 0) return 0;

    uint64_t h = 14695981039346656037ULL;
    for (const auto* p = ifa; p; p = p->ifa_next) {
        if (!p->ifa_name) continue;
        for (unsigned char c : std::string_view(p->ifa_name))
            h = fnv_step(h, c);
        h = fnv_step(h, static_cast<uint64_t>(p->ifa_flags));

        if (p->ifa_addr) {
            if (p->ifa_addr->sa_family == AF_INET) {
                const auto* s4 =
                    reinterpret_cast<const struct sockaddr_in*>(p->ifa_addr);
                h = fnv_step(h, static_cast<uint64_t>(s4->sin_addr.s_addr));
            } else if (p->ifa_addr->sa_family == AF_INET6) {
                const auto* s6 =
                    reinterpret_cast<const struct sockaddr_in6*>(p->ifa_addr);
                const uint8_t* a = s6->sin6_addr.s6_addr;
                for (int i = 0; i < 16; i += 4) {
                    uint64_t w = static_cast<uint64_t>(a[i])
                               | (static_cast<uint64_t>(a[i+1]) << 8)
                               | (static_cast<uint64_t>(a[i+2]) << 16)
                               | (static_cast<uint64_t>(a[i+3]) << 24);
                    h = fnv_step(h, w);
                }
            }
        }
    }
    freeifaddrs(ifa);
    return h;

#elif defined(_WIN32)
    constexpr ULONG flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST;
    ULONG sz = 0;
    GetAdaptersAddresses(AF_UNSPEC, flags, nullptr, nullptr, &sz);
    if (sz == 0) return 0;
    std::vector<uint8_t> buf(sz);
    auto* head = reinterpret_cast<PIP_ADAPTER_ADDRESSES>(buf.data());
    if (GetAdaptersAddresses(AF_UNSPEC, flags, nullptr, head, &sz) != NO_ERROR)
        return 0;
    uint64_t h = 14695981039346656037ULL;
    for (const auto* p = head; p; p = p->Next) {
        for (auto c : std::wstring_view(p->Description))
            h = fnv_step(h, static_cast<uint64_t>(c));
        h = fnv_step(h, static_cast<uint64_t>(p->OperStatus));
        h = fnv_step(h, static_cast<uint64_t>(p->IfIndex));
    }
    return h;
#else
    return 0;
#endif
}

/** Modification time of the DNS resolver config — proxy for DNS server change. */
static int64_t dns_mtime() noexcept {
#if defined(__APPLE__) || defined(__linux__)
    struct stat st{};
    if (stat("/etc/resolv.conf", &st) == 0)     return static_cast<int64_t>(st.st_mtime);
    if (stat("/var/run/resolv.conf", &st) == 0) return static_cast<int64_t>(st.st_mtime);
#endif
    return 0;
}

/**
 * Routing-table fingerprint.
 *   macOS  — byte size of the full routing-table dump via sysctl.
 *   Linux  — mtime ^ size of /proc/net/route.
 * Either value changes whenever the routing table changes.
 */
static uint64_t route_fingerprint() noexcept {
#ifdef __APPLE__
    int mib[6] = {CTL_NET, PF_ROUTE, 0, AF_UNSPEC, NET_RT_DUMP, 0};
    size_t needed = 0;
    ::sysctl(mib, 6, nullptr, &needed, nullptr, 0);
    return static_cast<uint64_t>(needed);
#elif defined(__linux__)
    struct stat st{};
    if (stat("/proc/net/route", &st) == 0)
        return (static_cast<uint64_t>(st.st_mtime) << 32)
             ^ static_cast<uint64_t>(st.st_size);
    return 0;
#else
    return 0;
#endif
}

/** Count established local TCP sockets. */
static uint32_t tcp_count() noexcept {
#ifdef __APPLE__
    int count = 0;
    size_t len = sizeof(count);
    if (::sysctlbyname("net.inet.tcp.pcbcount", &count, &len, nullptr, 0) == 0)
        return static_cast<uint32_t>(count);
    return 0;
#elif defined(__linux__)
    uint32_t n = 0;
    if (std::ifstream f("/proc/net/tcp"); f) {
        std::string line;
        std::getline(f, line); // skip header
        while (std::getline(f, line)) ++n;
    }
    // Also count IPv6 TCP
    if (std::ifstream f6("/proc/net/tcp6"); f6) {
        std::string line;
        std::getline(f6, line);
        while (std::getline(f6, line)) ++n;
    }
    return n;
#elif defined(_WIN32)
    DWORD sz = 0;
    GetTcpTable2(nullptr, &sz, FALSE);
    if (sz == 0) return 0;
    std::vector<uint8_t> buf(sz);
    auto* tbl = reinterpret_cast<PMIB_TCPTABLE2>(buf.data());
    if (GetTcpTable2(tbl, &sz, FALSE) == NO_ERROR)
        return static_cast<uint32_t>(tbl->dwNumEntries);
    return 0;
#else
    return 0;
#endif
}

// ── binding registration ──────────────────────────────────────────────────────

/**
 * Exposes `netmon_health` to the WebView.
 *
 * Returns `{ ok: true, data: NetSnapshot }` where NetSnapshot mirrors the
 * TypeScript `NetSnapshot` interface in `services/netmon-service.ts`:
 *   interface_changed  — interface list differs from startup baseline
 *   dns_changed        — DNS resolver config mtime differs from startup
 *   route_changed      — routing table fingerprint differs from startup
 *   local_socket_count — current TCP socket/PCB count
 *   timestamp          — Unix epoch milliseconds
 */
inline void register_netmon_bindings(saucer::smartview& wv) {
    wv.expose("netmon_health", []() -> std::string {
        struct Baseline {
            std::once_flag flag;
            uint64_t       iface = 0;
            int64_t        dns   = 0;
            uint64_t       route = 0;
        };
        static Baseline bl;

        const uint64_t cur_iface  = iface_fingerprint();
        const int64_t  cur_dns    = dns_mtime();
        const uint64_t cur_route  = route_fingerprint();
        const uint32_t sockets    = tcp_count();

        // Capture baseline exactly once (startup state = "normal").
        std::call_once(bl.flag, [&] {
            bl.iface = cur_iface;
            bl.dns   = cur_dns;
            bl.route = cur_route;
        });

        json snap = {
            {"interface_changed",  cur_iface != bl.iface},
            {"dns_changed",        cur_dns   != bl.dns  },
            {"route_changed",      cur_route != bl.route},
            {"local_socket_count", static_cast<int>(sockets)},
            {"timestamp",          now_ms()},
        };
        return json{{"ok", true}, {"data", snap}}.dump();
    });
}

} // namespace pce::netmon
