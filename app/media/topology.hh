#pragma once
/**
 * @file media/topology.hh
 * @brief Domain-neutral Intermediate Representation (IR) for the transform layer.
 *
 * @details
 * This is the single breakpoint between **media decoding** and **geometry export**.
 *
 * Pipeline (Asset → Transform → View):
 * @code
 *   pixel label map  (any source: image palette, PDF regions, video frame…)
 *     | build_label_field()  →  LabelField   (union-find connected components)
 *     | build_topology()     →  MediaTopology (shapes + adjacency + simplified contours)
 *     |
 *     ├── SvgView    — reads MediaTopology, writes SVG <path> strings
 *     ├── GltfView   — reads MediaTopology, writes extruded mesh buffers
 *     └── PixelRetro — reads MediaTopology, pixel-art renderer (future)
 * @endcode
 *
 * @remarks
 * Naming is intentionally media-neutral:
 * - No "pixel", "image", "scanline", "palette" in the IR types.
 * - `Shape` ≡ one maximal connected component of a single label.
 * - `MediaTopology` ≡ the set of shapes + adjacency — works for images,
 *   PDF layout analysis, video frames, voxel slices, etc.
 *
 * TODO (next stages):
 *   - LAB-space superpixel seeding (SLIC-style compact superpixels in LabImage)
 *   - Quadtree hierarchical region merging
 *   - DP-optimal refinement on top of RDP-simplified rings
 *   - Hole detection (inner CW rings inside CCW outer boundary)
 */

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <format>
#include <numeric>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace pce::media::topology {

// ─────────────────────────────────────────────────────────────────────────────
// Primitive geometry types
// ─────────────────────────────────────────────────────────────────────────────

/// Integer 2-D point (pixel-corner coordinate).
struct Vec2i {
    int x{}, y{};
    constexpr bool operator==(const Vec2i&) const = default;
};

/// Axis-aligned bounding box in integer pixel space.
struct AABB {
    int x{}, y{}, w{}, h{};
};


// ─────────────────────────────────────────────────────────────────────────────
// LabelField  (internal — input side of the transform)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Union-find connected-component label grid.
 *
 * `labels[y*w+x]` is `-1` for transparent/unlabelled pixels, otherwise a
 * contiguous component ID in `[0, component_count)`.
 * `label_of[id]` maps component → input label (palette index, class id, …).
 *
 * @note This is an internal intermediate; consumers should work with
 *       `MediaTopology` instead.
 */
struct LabelField {
    int w{}, h{};
    int component_count{};
    std::vector<int32_t> labels;    ///< -1 = transparent / no label
    std::vector<int>     label_of;  ///< label_of[component_id] = source label
};


// ─────────────────────────────────────────────────────────────────────────────
// Shape / MediaTopology  (the IR — output side of the transform)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One connected, uniform-label component with pre-extracted boundary.
 *
 * `rings` contains one CCW outer ring, plus optional CW hole rings.
 * Contours are already RDP-simplified and ready for SVG/mesh export.
 */
struct Shape {
    int id{};
    int label{};                          ///< source label (palette index, class, …)
    int pixel_count{};
    std::array<uint8_t, 3> color{};       ///< RGB from the palette (set by caller)
    AABB bounds;
    std::vector<std::vector<Vec2i>> rings; ///< [0] = outer CCW; [1..] = CW holes
    std::vector<int> neighbors;           ///< adjacent shape IDs (4-connected boundary)
};

/**
 * Domain-neutral IR: the complete topology of a processed media frame.
 *
 * This is the **single source of truth** shared by all view exporters.
 * Views must read but never modify this structure.
 */
struct MediaTopology {
    int width{}, height{};
    std::vector<Shape> shapes;

    [[nodiscard]] const Shape* find(int id) const noexcept {
        if (id >= 0 && id < static_cast<int>(shapes.size())) return &shapes[id];
        return nullptr;
    }
};


// ─────────────────────────────────────────────────────────────────────────────
// build_label_field  (stage 1 — connected-component analysis)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a union-find connected-component label grid.
 *
 * Two pixels are in the same component when they share the same `pidx` value
 * and are 4-connected (W/N neighbours in raster order).
 *
 * @param pidx  Per-pixel label array (`-1` = transparent / skip).
 * @param w     Image width in pixels.
 * @param h     Image height in pixels.
 */
[[nodiscard]] inline LabelField
build_label_field(const std::vector<int>& pidx, int w, int h) {
    const int n = w * h;

    std::vector<int> parent(n);
    std::iota(parent.begin(), parent.end(), 0);

    auto find = [&](int x) -> int {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    };
    auto unite = [&](int a, int b) {
        a = find(a); b = find(b);
        if (a != b) parent[b] = a;
    };

    for (int y = 0; y < h; ++y)
        for (int x = 0; x < w; ++x) {
            const int i = y * w + x;
            const int l = pidx[i];
            if (l < 0) continue;
            if (x > 0 && pidx[i - 1] == l) unite(i, i - 1);
            if (y > 0 && pidx[i - w] == l) unite(i, i - w);
        }

    std::vector<int> root_to_id(n, -1);
    int next_id = 0;

    LabelField lf;
    lf.w = w; lf.h = h;
    lf.labels.resize(n, -1);

    for (int i = 0; i < n; ++i) {
        if (pidx[i] < 0) continue;
        const int root = find(i);
        if (root_to_id[root] < 0) root_to_id[root] = next_id++;
        lf.labels[i] = root_to_id[root];
    }

    lf.component_count = next_id;
    lf.label_of.assign(lf.component_count, -1);
    for (int i = 0; i < n; ++i)
        if (pidx[i] >= 0 && lf.labels[i] >= 0)
            lf.label_of[lf.labels[i]] = pidx[i];

    return lf;
}


// ─────────────────────────────────────────────────────────────────────────────
// rdp_simplify  (geometry utility — used by build_topology)
// ─────────────────────────────────────────────────────────────────────────────

namespace detail {

/// Squared perpendicular distance from point `p` to segment `[a, b]`.
[[nodiscard]] inline float perp_dist2(Vec2i p, Vec2i a, Vec2i b) noexcept {
    const float dx = float(b.x - a.x), dy = float(b.y - a.y);
    if (dx == 0.f && dy == 0.f) {
        const float ex = float(p.x - a.x), ey = float(p.y - a.y);
        return ex*ex + ey*ey;
    }
    const float t  = std::clamp(((p.x-a.x)*dx + (p.y-a.y)*dy) / (dx*dx+dy*dy), 0.f, 1.f);
    const float ex = p.x - (a.x + t*dx), ey = p.y - (a.y + t*dy);
    return ex*ex + ey*ey;
}

} // namespace detail

/**
 * Ramer–Douglas–Peucker polygon simplification (iterative stack, no recursion).
 *
 * @param pts      Closed polygon ring.
 * @param epsilon  Maximum perpendicular deviation in pixels.
 *                 Typical: 1.0 (pixel-art), 1.5 (default), 3.0 (photos/scans).
 *
 * Reduces path point count 30–70 % versus collinearity-only removal.
 */
[[nodiscard]] inline std::vector<Vec2i>
rdp_simplify(const std::vector<Vec2i>& pts, float epsilon = 1.5f) {
    const int n = static_cast<int>(pts.size());
    if (n < 3) return pts;

    const float eps2 = epsilon * epsilon;
    std::vector<bool> keep(n, false);
    keep[0] = keep[n-1] = true;

    std::vector<std::pair<int,int>> stk;
    stk.reserve(64);
    stk.push_back({0, n-1});

    while (!stk.empty()) {
        auto [lo, hi] = stk.back();
        stk.pop_back();
        if (hi - lo < 2) continue;

        float max_d = 0.f;
        int   max_i = lo;
        for (int i = lo + 1; i < hi; ++i) {
            const float d = detail::perp_dist2(pts[i], pts[lo], pts[hi]);
            if (d > max_d) { max_d = d; max_i = i; }
        }
        if (max_d > eps2) {
            keep[max_i] = true;
            stk.push_back({lo,    max_i});
            stk.push_back({max_i, hi   });
        }
    }

    std::vector<Vec2i> out;
    out.reserve(n);
    for (int i = 0; i < n; ++i)
        if (keep[i]) out.push_back(pts[i]);
    return out;
}


// ─────────────────────────────────────────────────────────────────────────────
// extract_rings  (boundary-edge walk for one component)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Directed boundary half-edge walk for one component in `lf`.
 *
 * Returns CCW outer ring(s) and CW hole ring(s) as closed integer polygons.
 * Each component may have multiple rings when it contains enclosed transparent
 * gaps (holes) or when the label field has disconnected regions of the same ID
 * (shouldn't happen after union-find, but handled defensively).
 *
 * @remarks Safe against large contours — bounded at 400 000 steps per ring.
 */
[[nodiscard]] inline std::vector<std::vector<Vec2i>>
extract_rings(const LabelField& lf, int component_id) {
    const int w = lf.w, h = lf.h;

    auto enc = [](int x, int y) -> int64_t {
        return (int64_t(uint32_t(x)) << 32) | int64_t(uint32_t(y));
    };
    auto lbl = [&](int x, int y) -> int32_t {
        if (x < 0 || x >= w || y < 0 || y >= h) return -1;
        return lf.labels[y * w + x];
    };

    using Pt  = std::pair<int,int>;
    using EM  = std::unordered_map<int64_t, Pt>;
    EM emap;
    emap.reserve(256);

    for (int y = 0; y < h; ++y)
        for (int x = 0; x < w; ++x) {
            if (lf.labels[y * w + x] != component_id) continue;
            if (lbl(x,   y-1) != component_id) emap[enc(x,   y  )] = {x+1, y  };
            if (lbl(x+1, y  ) != component_id) emap[enc(x+1, y  )] = {x+1, y+1};
            if (lbl(x,   y+1) != component_id) emap[enc(x+1, y+1)] = {x,   y+1};
            if (lbl(x-1, y  ) != component_id) emap[enc(x,   y+1)] = {x,   y  };
        }

    std::vector<std::vector<Vec2i>> rings;

    while (!emap.empty()) {
        auto it = emap.begin();
        Vec2i start{ int(it->first >> 32), int(uint32_t(it->first)) };
        std::vector<Vec2i> ring{ start };
        Pt cur = it->second;
        emap.erase(it);

        for (int step = 0; step < 400'000 && !emap.empty(); ++step) {
            Vec2i c{ cur.first, cur.second };
            if (c == start) break;
            ring.push_back(c);
            auto ni = emap.find(enc(c.x, c.y));
            if (ni == emap.end()) break;
            cur = ni->second;
            emap.erase(ni);
        }

        if (ring.size() >= 3) rings.push_back(std::move(ring));
    }

    return rings;
}


// ─────────────────────────────────────────────────────────────────────────────
// build_topology  (stage 2 — assemble the IR)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the complete `MediaTopology` from a `LabelField`.
 *
 * For each connected component this function:
 *  1. Computes bounding box and pixel count.
 *  2. Extracts boundary rings via directed half-edge walk.
 *  3. Simplifies rings with RDP at `simplify_epsilon`.
 *  4. Records 4-connected adjacency between components.
 *
 * @param lf               Label grid produced by `build_label_field`.
 * @param simplify_epsilon RDP maximum deviation in pixels (default 1.5).
 *
 * @note Set `simplify_epsilon = 0` to disable simplification (keep all corners).
 */
[[nodiscard]] inline MediaTopology
build_topology(const LabelField& lf, float simplify_epsilon = 1.5f) {
    const int rc = lf.component_count;
    const int w  = lf.w, h = lf.h;

    MediaTopology topo;
    topo.width  = w;
    topo.height = h;
    topo.shapes.resize(rc);

    for (int i = 0; i < rc; ++i) {
        topo.shapes[i].id    = i;
        topo.shapes[i].label = lf.label_of[i];
    }

    // Bounding box + pixel count
    std::vector<int> min_x(rc, w), max_x(rc, -1);
    std::vector<int> min_y(rc, h), max_y(rc, -1);

    for (int y = 0; y < h; ++y)
        for (int x = 0; x < w; ++x) {
            const int id = lf.labels[y * w + x];
            if (id < 0) continue;
            ++topo.shapes[id].pixel_count;
            min_x[id] = std::min(min_x[id], x); max_x[id] = std::max(max_x[id], x);
            min_y[id] = std::min(min_y[id], y); max_y[id] = std::max(max_y[id], y);
        }

    for (int i = 0; i < rc; ++i) {
        if (min_x[i] > max_x[i]) continue;
        topo.shapes[i].bounds = { min_x[i], min_y[i],
                                  max_x[i] - min_x[i] + 1,
                                  max_y[i] - min_y[i] + 1 };
    }

    // Adjacency (right + below scan)
    std::vector<std::unordered_set<int>> adj(rc);

    for (int y = 0; y < h; ++y)
        for (int x = 0; x < w; ++x) {
            const int id = lf.labels[y * w + x];
            if (id < 0) continue;
            const int offsets[2][2] = {{1,0},{0,1}};
            for (auto& o : offsets) {
                const int nx = x + o[0], ny = y + o[1];
                if (nx >= w || ny >= h) continue;
                const int nid = lf.labels[ny * w + nx];
                if (nid < 0 || nid == id) continue;
                if (adj[id].insert(nid).second) {
                    adj[nid].insert(id);
                    topo.shapes[id].neighbors.push_back(nid);
                    topo.shapes[nid].neighbors.push_back(id);
                }
            }
        }

    // Contour extraction + RDP simplification
    for (int i = 0; i < rc; ++i) {
        for (auto& raw_ring : extract_rings(lf, i)) {
            auto simplified = (simplify_epsilon > 0.f)
                ? rdp_simplify(raw_ring, simplify_epsilon)
                : raw_ring;
            if (simplified.size() >= 3)
                topo.shapes[i].rings.push_back(std::move(simplified));
        }
    }

    return topo;
}

} // namespace pce::media::topology

