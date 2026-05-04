#pragma once
#include "image.hh"
#include <algorithm>
#include <cmath>
#include <vector>

namespace pce::dms::ops {

namespace detail {

[[nodiscard]] inline Expected<Image> resize_nn(const Image& src, int tw, int th) {
    if (tw <= 0 || th <= 0)
        return std::unexpected(std::string{"resize: invalid dimensions"});
    Image out;
    out.width = tw; out.height = th;
    out.pixels.resize(static_cast<size_t>(tw) * th * 4);
    for (int oy = 0; oy < th; ++oy) {
        const int sy = oy * src.height / th;
        for (int ox = 0; ox < tw; ++ox) {
            const int sx = ox * src.width / tw;
            const auto* s = src.pixels.data()
                + (static_cast<size_t>(sy) * src.width + sx) * 4;
            auto* d = out.pixels.data()
                + (static_cast<size_t>(oy) * tw + ox) * 4;
            d[0]=s[0]; d[1]=s[1]; d[2]=s[2]; d[3]=s[3];
        }
    }
    return out;
}

[[nodiscard]] inline Expected<Image> resize_area(const Image& src, int tw, int th) {
    if (tw <= 0 || th <= 0)
        return std::unexpected(std::string{"resize: invalid dimensions"});
    if (tw >= src.width && th >= src.height)
        return resize_nn(src, tw, th);
    Image out;
    out.width = tw; out.height = th;
    out.pixels.resize(static_cast<size_t>(tw) * th * 4, 0);
    for (int oy = 0; oy < th; ++oy) {
        const int y0 = oy * src.height / th;
        const int y1 = std::max(y0, (oy + 1) * src.height / th - 1);
        for (int ox = 0; ox < tw; ++ox) {
            const int x0 = ox * src.width / tw;
            const int x1 = std::max(x0, (ox + 1) * src.width / tw - 1);
            int sum[4] = {}, n = 0;
            for (int sy = y0; sy <= y1; ++sy)
                for (int sx = x0; sx <= x1; ++sx) {
                    const auto* p = src.pixels.data()
                        + (static_cast<size_t>(sy) * src.width + sx) * 4;
                    sum[0]+=p[0]; sum[1]+=p[1]; sum[2]+=p[2]; sum[3]+=p[3]; ++n;
                }
            auto* d = out.pixels.data() + (static_cast<size_t>(oy) * tw + ox) * 4;
            d[0]=uint8_t(sum[0]/n); d[1]=uint8_t(sum[1]/n);
            d[2]=uint8_t(sum[2]/n); d[3]=uint8_t(sum[3]/n);
        }
    }
    return out;
}

// O(w·h) separable box blur regardless of radius.
[[nodiscard]] inline Expected<Image> box_blur_once(Image img, int r) {
    if (r <= 0) return img;
    const int w = img.width, h = img.height;
    const int div = 2 * r + 1;
    std::vector<uint8_t> tmp(img.pixels.size());

    for (int y = 0; y < h; ++y) {
        const int row = y * w;
        for (int c = 0; c < 4; ++c) {
            int s = 0;
            for (int kx = -r; kx <= r; ++kx)
                s += img.pixels[(static_cast<size_t>(row + std::clamp(kx, 0, w-1))) * 4 + c];
            for (int x = 0; x < w; ++x) {
                tmp[(static_cast<size_t>(row + x)) * 4 + c] = uint8_t(s / div);
                s -= img.pixels[(static_cast<size_t>(row + std::clamp(x-r,   0,w-1)))*4+c];
                s += img.pixels[(static_cast<size_t>(row + std::clamp(x+r+1, 0,w-1)))*4+c];
            }
        }
    }
    for (int x = 0; x < w; ++x) {
        for (int c = 0; c < 4; ++c) {
            int s = 0;
            for (int ky = -r; ky <= r; ++ky)
                s += tmp[(static_cast<size_t>(std::clamp(ky,0,h-1))*w+x)*4+c];
            for (int y = 0; y < h; ++y) {
                img.pixels[(static_cast<size_t>(y)*w+x)*4+c] = uint8_t(s / div);
                s -= tmp[(static_cast<size_t>(std::clamp(y-r,   0,h-1))*w+x)*4+c];
                s += tmp[(static_cast<size_t>(std::clamp(y+r+1, 0,h-1))*w+x)*4+c];
            }
        }
    }
    return img;
}

// Sobel edge detection — returns greyscale RGBA (R=G=B=magnitude, A=255).
[[nodiscard]] inline Expected<Image> sobel(const Image& src) {
    const int w = src.width, h = src.height;
    Image out;
    out.width = w; out.height = h;
    out.pixels.assign(static_cast<size_t>(w) * h * 4, 255u);

    // ITU-R BT.601 luminance (integer, shifted 8 bits)
    auto lum = [&](int x, int y) -> int {
        const auto* p = src.pixels.data()
            + (static_cast<size_t>(std::clamp(y,0,h-1))*w + std::clamp(x,0,w-1)) * 4;
        return (int(p[0])*77 + int(p[1])*150 + int(p[2])*29) >> 8;
    };
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            const int gx = -lum(x-1,y-1) + lum(x+1,y-1)
                           -2*lum(x-1,y)  + 2*lum(x+1,y)
                           -lum(x-1,y+1)  + lum(x+1,y+1);
            const int gy =  lum(x-1,y-1) + 2*lum(x,y-1) + lum(x+1,y-1)
                           -lum(x-1,y+1) - 2*lum(x,y+1) - lum(x+1,y+1);
            const auto v = uint8_t(std::min(255,
                static_cast<int>(std::sqrt(float(gx*gx + gy*gy)))));
            const size_t i = (static_cast<size_t>(y)*w + x) * 4;
            out.pixels[i+0]=v; out.pixels[i+1]=v; out.pixels[i+2]=v;
            // alpha already 255
        }
    }
    return out;
}

} // namespace detail

// ─── Public operators — each returns Image→Expected<Image> for stage() ────────

/// Scale so max(width,height) ≤ max_dim.
/// No-op when max_dim ≤ 0 or the image already fits.
/// nearest=false (default): area-average — best quality for photo→SVG.
/// nearest=true: nearest-neighbour — crisp for pixel art.
[[nodiscard]] inline auto normalize(int max_dim, bool nearest = false) {
    return [=](Image img) -> Expected<Image> {
        if (max_dim <= 0 || std::max(img.width, img.height) <= max_dim)
            return img;
        const int big = std::max(img.width, img.height);
        const int tw  = std::max(1, img.width  * max_dim / big);
        const int th  = std::max(1, img.height * max_dim / big);
        return nearest ? detail::resize_nn(img, tw, th)
                       : detail::resize_area(img, tw, th);
    };
}

/// Approximate Gaussian blur via 3 separable box passes.  O(w·h) always.
/// sigma ≤ 0 is a no-op.
[[nodiscard]] inline auto gaussian_blur(float sigma) {
    return [sigma](Image img) -> Expected<Image> {
        if (sigma <= 0.0f) return img;
        const int r = std::max(1, static_cast<int>(sigma * 1.5f + 0.5f));
        return detail::box_blur_once(std::move(img), r)
            .and_then([r](Image i){ return detail::box_blur_once(std::move(i), r); })
            .and_then([r](Image i){ return detail::box_blur_once(std::move(i), r); });
    };
}

/// Burn Sobel edges into the image at given weight [0..1].
/// Edges are detected on a blurred copy (sigma ≈ pre-blur radius) then
/// darkened into the original pixels — colour survives, contours are preserved.
/// weight ≤ 0 is a no-op.
[[nodiscard]] inline auto edge_overlay(float sigma, float weight) {
    return [sigma, weight](Image img) -> Expected<Image> {
        if (weight <= 0.0f) return img;
        const int r = std::max(1, static_cast<int>(sigma * 1.5f + 0.5f));
        auto blurred = detail::box_blur_once(img, r);   // intentional copy
        if (!blurred) return blurred;
        auto edges = detail::sobel(*blurred);
        if (!edges) return edges;
        const int n = img.width * img.height;
        for (int i = 0; i < n; ++i) {
            const float e = edges->pixels[static_cast<size_t>(i)*4] / 255.0f;
            const float w = 1.0f - weight * e;
            const size_t b = static_cast<size_t>(i) * 4;
            img.pixels[b+0] = uint8_t(img.pixels[b+0] * w);
            img.pixels[b+1] = uint8_t(img.pixels[b+1] * w);
            img.pixels[b+2] = uint8_t(img.pixels[b+2] * w);
        }
        return img;
    };
}

/// Block-average pixelation: reduces image to ⌊w/block⌋ × ⌊h/block⌋.
/// block ≤ 1 is a no-op.
[[nodiscard]] inline auto pixelate(int block) {
    return [block](Image img) -> Expected<Image> {
        if (block <= 1) return img;
        return detail::resize_area(img,
            std::max(1, img.width  / block),
            std::max(1, img.height / block));
    };
}

} // namespace pce::dms::ops
