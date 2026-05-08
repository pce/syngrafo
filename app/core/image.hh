#pragma once
/**
 * @file core/image.hh
 * @author Patrick Engel
 * @brief DMS C++23 Image value type — owning RGBA8 pixel buffer + non-owning view.
 *        Palette quantization helpers in pce::dms::pal namespace.
 *
 * No virtuals. No inheritance. Image owns its data; ImageView is a POD span.
 * Compatible with the existing pce::decode_image_to_rgba backend.
 *
 * @code{.cpp}
 *   // Load and inspect
 *   auto img = Image::load("photo.jpg");  // Expected<Image>
 *   auto view = ImageView::from(*img);    // zero-copy view
 *
 *   // Palette quantization pipeline
 *   auto pal  = pal::resolve("db16", img->data(), img->width, img->height);
 *   auto pidx = pal::map_pixels(img->data(), img->width, img->height, pal);
 *   if (smooth) pal::smooth(pidx, img->width, img->height);
 * @endcode
 */

#include "../image_decode.hh"   // pce::decode_image_to_rgba, pce::RGBAImage
#include "../dms_monadic.hh"    // Expected<T>, try_invoke

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace pce::dms {

// ─── PixelFormat ──────────────────────────────────────────────────────────────

enum class PixelFormat : uint8_t { RGBA8 };

// ─── Image ────────────────────────────────────────────────────────────────────

/// Owning RGBA8 raster image with heap-allocated pixel buffer.
/// width * height * 4 bytes, row-major, RGBA channel order.
struct Image {
    int           width  {};
    int           height {};
    PixelFormat   format { PixelFormat::RGBA8 };
    std::vector<uint8_t> pixels;  // width * height * 4 bytes

    [[nodiscard]] bool valid() const noexcept {
        return width > 0 && height > 0
            && pixels.size() == static_cast<size_t>(width) * height * 4u;
    }

    [[nodiscard]] const uint8_t* data() const noexcept { return pixels.data(); }

    /// Load any supported raster image file, decoding to RGBA8.
    /// Returns std::unexpected with the error message on failure.
    [[nodiscard]] static Expected<Image> load(std::string_view path) {
        auto raw = pce::decode_image_to_rgba(std::string{path});
        if (!raw.ok)
            return std::unexpected(
                raw.error.empty() ? std::string{"image decode failed"} : raw.error);
        Image img;
        img.width  = raw.width;
        img.height = raw.height;
        img.pixels = std::move(raw.pixels);
        return img;
    }
};

// ─── ImageView ────────────────────────────────────────────────────────────────

/// Non-owning reference into an RGBA8 pixel buffer.
/// POD struct — pass by value, copy is free.
struct ImageView {
    const uint8_t* data     { nullptr };
    int            width    {};
    int            height   {};
    int            channels { 4 };

    [[nodiscard]] bool valid() const noexcept {
        return data && width > 0 && height > 0;
    }

    [[nodiscard]] static ImageView from(const Image& img) noexcept {
        return { img.data(), img.width, img.height, 4 };
    }

    /// Read a single RGBA pixel via out-params.
    /// Returns false when coordinates are out of bounds; out-params are unchanged.
    /// Return value may be intentionally ignored when the caller pre-clamps coords.
    bool read_pixel(int x, int y,
                    uint8_t& r, uint8_t& g,
                    uint8_t& b, uint8_t& a) const noexcept {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        const auto* p = data + (static_cast<size_t>(y) * width + x) * 4;
        r = p[0]; g = p[1]; b = p[2]; a = p[3];
        return true;
    }
};

// ─── Palette quantization ─────────────────────────────────────────────────────
namespace pal {

struct RGB3 { uint8_t r, g, b; };
using Palette = std::vector<RGB3>;

// ── Built-in palettes ─────────────────────────────────────────────────────────

inline Palette db8() {
    return {
        {0,0,0},{85,65,95},{100,105,100},{215,115,85},
        {80,140,215},{100,185,100},{230,200,110},{220,245,255}
    };
}

inline Palette db16() {
    return {
        {20,12,28},{68,36,52},{48,52,109},{78,74,78},
        {133,76,48},{52,101,36},{208,70,72},{117,113,97},
        {89,125,206},{210,125,44},{133,149,161},{109,170,44},
        {210,170,153},{109,194,202},{218,212,94},{222,238,214}
    };
}

inline Palette db32() {
    return {
        {0,0,0},{34,32,52},{69,40,60},{102,57,49},
        {143,86,59},{223,113,38},{217,160,102},{238,195,154},
        {251,242,54},{153,229,80},{106,190,48},{55,148,110},
        {75,105,47},{82,75,36},{50,60,57},{63,63,116},
        {48,96,130},{91,110,225},{99,155,255},{95,205,228},
        {203,219,252},{255,255,255},{155,173,183},{132,126,135},
        {105,106,106},{89,86,82},{118,66,138},{172,50,50},
        {217,87,99},{215,123,186},{143,151,74},{138,111,48}
    };
}

// ── Spectrum: N evenly-spaced hues + black + white ───────────────────────────
inline Palette spectrum(int n) {
    Palette p;
    p.reserve(static_cast<size_t>(n) + 2);
    p.push_back({0,0,0});
    p.push_back({255,255,255});
    for (int i = 0; i < n; ++i) {
        float h = 360.0f * static_cast<float>(i) / static_cast<float>(n);
        float chroma = 1.0f;
        float x = chroma * (1.0f - std::abs(std::fmod(h / 60.0f, 2.0f) - 1.0f));
        float r = 0, g = 0, b = 0;
        if      (h < 60)  { r=chroma; g=x;      }
        else if (h < 120) { r=x;      g=chroma; }
        else if (h < 180) {           g=chroma; b=x;      }
        else if (h < 240) {           g=x;      b=chroma; }
        else if (h < 300) { r=x;                b=chroma; }
        else              { r=chroma;            b=x;      }
        p.push_back({
            static_cast<uint8_t>(r * 255.f + .5f),
            static_cast<uint8_t>(g * 255.f + .5f),
            static_cast<uint8_t>(b * 255.f + .5f)
        });
    }
    return p;
}

// ── Median-cut colour quantization ───────────────────────────────────────────
inline Palette median_cut(const uint8_t* rgba, int w, int h, int ncolors) {
    const int total  = w * h;
    const int stride = std::max(1, total / 100'000);
    using C3 = std::array<uint8_t, 3>;
    std::vector<C3> pts;
    pts.reserve(static_cast<size_t>(total / stride + 1));
    for (int i = 0; i < total; i += stride)
        if (rgba[i * 4 + 3] >= 128)
            pts.push_back({rgba[i*4], rgba[i*4+1], rgba[i*4+2]});
    if (pts.empty()) return {{128,128,128}};

    using Bucket = std::vector<C3>;
    std::vector<Bucket> buckets;
    buckets.push_back(std::move(pts));

    while (static_cast<int>(buckets.size()) < ncolors) {
        int bi = 0;
        for (int i = 1; i < static_cast<int>(buckets.size()); ++i)
            if (buckets[i].size() > buckets[bi].size()) bi = i;
        auto& bkt = buckets[bi];
        if (bkt.size() <= 1) break;

        uint8_t lo[3] = {255,255,255}, hi[3] = {0,0,0};
        for (auto& col : bkt)
            for (int j = 0; j < 3; ++j) {
                lo[j] = std::min(lo[j], col[j]);
                hi[j] = std::max(hi[j], col[j]);
            }
        int axis = 0;
        if (hi[1]-lo[1] > hi[axis]-lo[axis]) axis = 1;
        if (hi[2]-lo[2] > hi[axis]-lo[axis]) axis = 2;

        std::sort(bkt.begin(), bkt.end(),
            [axis](const C3& a, const C3& b){ return a[axis] < b[axis]; });
        const int mid = static_cast<int>(bkt.size()) / 2;
        Bucket half(bkt.begin() + mid, bkt.end());
        bkt.resize(mid);
        buckets.push_back(std::move(half));
    }

    Palette result;
    result.reserve(buckets.size());
    for (auto& bkt : buckets) {
        if (bkt.empty()) continue;
        long sr = 0, sg = 0, sb = 0;
        for (auto& col : bkt) { sr += col[0]; sg += col[1]; sb += col[2]; }
        const int n = static_cast<int>(bkt.size());
        result.push_back({
            static_cast<uint8_t>(sr / n),
            static_cast<uint8_t>(sg / n),
            static_cast<uint8_t>(sb / n)
        });
    }
    return result;
}

/// Resolve palette by name: "db8" | "db16" | "db32" | "spectrumN" | "autoN".
///
/// Extended: if `name` starts with '[', it is parsed as a JSON array of
/// { r, g, b } objects (inline palette from the frontend / zone DB lookup).
/// This lets the existing SVG/mesh/analyze bindings accept custom palettes
/// without any DB access — the frontend fetches colors once and passes them.
///
/// Example: palette = '[{"r":0,"g":106,"b":255},{"r":255,"g":107,"b":0}]'
inline Palette resolve(const std::string& name, const uint8_t* rgba, int w, int h) {
    // Inline JSON palette
    if (!name.empty() && name.front() == '[') {
        Palette p;
        try {
            // Minimal JSON parse — no nlohmann dep in this header.
            // Format: [{"r":R,"g":G,"b":B},…]  (name field ignored here)
            const std::string& s = name;
            size_t i = 0;
            auto skip = [&]{ while (i<s.size() && (s[i]==' '||s[i]=='\t'||s[i]=='\n'||s[i]=='\r')) ++i; };
            auto expect = [&](char c) -> bool { skip(); if (i<s.size()&&s[i]==c){++i;return true;} return false; };
            auto read_int = [&]() -> int {
                skip(); int v=0,sign=1; if(i<s.size()&&s[i]=='-'){sign=-1;++i;}
                while (i<s.size()&&s[i]>='0'&&s[i]<='9') v=v*10+(s[i++]-'0');
                return v*sign;
            };
            auto read_key = [&]() -> std::string {
                skip(); if(!expect('"')) return {}; std::string k;
                while (i<s.size()&&s[i]!='"') k+=s[i++]; ++i; return k;
            };
            if (!expect('[')) return db16();
            while (i < s.size()) {
                skip(); if (i<s.size()&&s[i]==']') break;
                if (!expect('{')) break;
                RGB3 c{128,128,128};
                while (true) {
                    skip(); if (i<s.size()&&s[i]=='}') { ++i; break; }
                    auto key = read_key();
                    expect(':');
                    const int val = read_int();
                    if      (key=="r") c.r = static_cast<uint8_t>(val);
                    else if (key=="g") c.g = static_cast<uint8_t>(val);
                    else if (key=="b") c.b = static_cast<uint8_t>(val);
                    skip(); if (i<s.size()&&s[i]==',') ++i;
                }
                p.push_back(c);
                skip(); if (i<s.size()&&s[i]==',') ++i;
            }
        } catch (...) {}
        return p.empty() ? db16() : p;
    }
    if (name == "db8")  return db8();
    if (name == "db16") return db16();
    if (name == "db32") return db32();
    if (name.size() >= 8 && name.substr(0, 8) == "spectrum") {
        int n = 14;
        if (name.size() > 8) { try { n = std::stoi(name.substr(8)); } catch (...) {} }
        return spectrum(n);
    }
    // "autoN" (default 16)
    int n = 16;
    if (name.size() > 4 && name.substr(0, 4) == "auto")
        try { n = std::stoi(name.substr(4)); } catch (...) {}
    return median_cut(rgba, w, h, n);
}

/// Nearest palette colour — minimum squared Euclidean in RGB.
[[nodiscard]] inline int nearest(uint8_t r, uint8_t g, uint8_t b, const Palette& p) {
    int best = 0, bestD = INT_MAX;
    for (int i = 0; i < static_cast<int>(p.size()); ++i) {
        const int dr = static_cast<int>(r) - p[i].r;
        const int dg = static_cast<int>(g) - p[i].g;
        const int db = static_cast<int>(b) - p[i].b;
        const int d  = dr*dr + dg*dg + db*db;
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

/// Map every pixel to a palette index (-1 = fully transparent).
[[nodiscard]] inline std::vector<int>
map_pixels(const uint8_t* rgba, int w, int h, const Palette& p) {
    const int n = w * h;
    std::vector<int> out(n, -1);
    for (int i = 0; i < n; ++i) {
        if (rgba[i*4 + 3] == 0) continue;
        out[i] = nearest(rgba[i*4], rgba[i*4+1], rgba[i*4+2], p);
    }
    return out;
}


/// CIE L*a*b* triple (D65 illuminant).  Perceptually uniform — use with
/// `nearest_lab` instead of `nearest` for photos and gradients.
struct Lab3 { float L{}, a{}, b{}; };

/// sRGB (uint8, 0–255) → CIE L*a*b* (D65).
[[nodiscard]] inline Lab3 rgb_to_lab(uint8_t r, uint8_t g, uint8_t b) noexcept {
    // Linearise sRGB (gamma decode)
    auto lin = [](float c) -> float {
        c /= 255.f;
        return c <= 0.04045f ? c / 12.92f
                             : std::pow((c + 0.055f) / 1.055f, 2.4f);
    };
    const float rl = lin(float(r)), gl = lin(float(g)), bl = lin(float(b));

    // Linear sRGB → XYZ (D65, IEC 61966-2-1)
    const float X = rl*0.4124564f + gl*0.3575761f + bl*0.1804375f;
    const float Y = rl*0.2126729f + gl*0.7151522f + bl*0.0721750f;
    const float Z = rl*0.0193339f + gl*0.1191920f + bl*0.9503041f;

    // XYZ → LAB (D65 white point: 0.95047, 1.00000, 1.08883)
    auto f = [](float t) -> float {
        return t > 0.008856f ? std::cbrt(t) : (7.787f * t + 16.f / 116.f);
    };
    const float fx = f(X / 0.95047f);
    const float fy = f(Y);
    const float fz = f(Z / 1.08883f);

    return { 116.f * fy - 16.f, 500.f * (fx - fy), 200.f * (fy - fz) };
}

/// Precompute LAB values for an entire palette (call once, reuse).
[[nodiscard]] inline std::vector<Lab3> palette_to_lab(const Palette& p) {
    std::vector<Lab3> cache(p.size());
    for (int i = 0; i < (int)p.size(); ++i)
        cache[i] = rgb_to_lab(p[i].r, p[i].g, p[i].b);
    return cache;
}

/// Nearest palette colour using perceptual squared-Euclidean distance in LAB.
/// Pass a pre-built `lab_cache` from `palette_to_lab()` to avoid recomputing.
[[nodiscard]] inline int
nearest_lab(uint8_t r, uint8_t g, uint8_t b,
            const Palette& /*p*/, const std::vector<Lab3>& lab_cache) noexcept {
    const Lab3 q = rgb_to_lab(r, g, b);
    int   best  = 0;
    float bestD = 1e30f;
    for (int i = 0; i < (int)lab_cache.size(); ++i) {
        const Lab3& c = lab_cache[i];
        const float dL = q.L - c.L, da = q.a - c.a, db = q.b - c.b;
        const float d  = dL*dL + da*da + db*db;
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

/// Map pixels to palette indices using perceptual LAB distance.
/// Prefer over `map_pixels` for natural photos and gradients.
[[nodiscard]] inline std::vector<int>
map_pixels_lab(const uint8_t* rgba, int w, int h, const Palette& p) {
    const int n = w * h;
    std::vector<int> out(n, -1);
    const auto lab_cache = palette_to_lab(p);
    for (int i = 0; i < n; ++i) {
        if (rgba[i*4 + 3] == 0) continue;
        out[i] = nearest_lab(rgba[i*4], rgba[i*4+1], rgba[i*4+2], p, lab_cache);
    }
    return out;
}

/// 3×3 majority-vote smoothing — dissolves isolated noise pixels.
inline void smooth(std::vector<int>& idx, int w, int h) {
    std::vector<int> out(idx);
    std::unordered_map<int,int> cnt;
    cnt.reserve(64);
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            if (idx[y*w + x] < 0) continue;
            cnt.clear();
            for (int dy = -1; dy <= 1; ++dy)
                for (int dx = -1; dx <= 1; ++dx) {
                    const int nx = x+dx, ny = y+dy;
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        const int v = idx[ny*w + nx];
                        if (v >= 0) ++cnt[v];
                    }
                }
            int best = idx[y*w + x], bestC = 0;
            for (auto& [k, v] : cnt)
                if (v > bestC) { bestC = v; best = k; }
            out[y*w + x] = best;
        }
    }
    idx = std::move(out);
}

} // namespace pal
} // namespace pce::dms
