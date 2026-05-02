#pragma once
/**
 * @file core/mesh.hh
 * @author Patrick Engel
 * @brief DMS C++23 Mesh value type + Image → Mesh pipeline.
 *
 * No virtuals. No heap churn beyond the vertex/index vectors.
 * All builders are free functions that take ImageView + parameters, return MeshData.
 *
 * Pipeline usage:
 * @code{.cpp}
 *   MeshExportOptions opts{ .mode = MeshMode::Solid, .gridSize = 8, .depthScale = 50.0f };
 *
 *   auto result = Image::load("photo.jpg")
 *       | stage([&](Image img) -> Expected<MeshData> {
 *             return build_mesh(ImageView::from(img), opts);
 *         })
 *       | stage([&](MeshData mesh) -> Expected<std::string> {
 *             const auto out = "photo.ply";
 *             save_as_ply(mesh, out, opts);
 *             return out;
 *         });
 * @endcode
 */

#include "image.hh"
#include "../dms_monadic.hh"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace pce::dms {

// ─── Mesh primitives ──────────────────────────────────────────────────────────

/// Single vertex: position + normal + UV + RGBA colour.
struct MeshVertex {
    float    x  = 0.f,  y  = 0.f,  z  = 0.f;   // position
    float    nx = 0.f,  ny = 0.f,  nz = 1.f;   // surface normal
    float    u  = 0.f,  v  = 0.f;               // texture coords (reserved)
    uint8_t  r  = 255,  g  = 255,  b  = 255,  a = 255;  // vertex colour
};

/// Mesh payload: indexed triangle / edge list.
struct MeshData {
    std::vector<MeshVertex>  vertices;
    std::vector<uint32_t>    indices;   // triangles (3/face) or edges (2/edge)
                                        // depending on the mode used to build it
    [[nodiscard]] bool empty() const noexcept { return vertices.empty(); }
};

// ─── Mesh build modes ─────────────────────────────────────────────────────────

enum class MeshMode : uint8_t {
    Solid        = 0,   ///< Triangle grid with depth-map Z displacement
    Wireframe    = 1,   ///< Edge list (line list) version of the grid
    LoPoly       = 2,   ///< (reserved — placeholder for future Delaunay mode)
    PixelPerfect = 3,   ///< Extruded voxel prisms, merged by colour
};

// ─── Export options ───────────────────────────────────────────────────────────

struct MeshExportOptions {
    MeshMode mode            = MeshMode::Solid;
    uint32_t gridSize        = 8;      ///< Pixels per grid cell (1–64)
    float    depthScale      = 50.0f;  ///< Z multiplier applied to [0,1] depth
    bool     useVertexColors = true;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────
namespace detail {

[[nodiscard]] inline size_t sample_w(int imgW, uint32_t grid) noexcept {
    return (static_cast<size_t>(imgW) + grid - 1u) / grid;
}
[[nodiscard]] inline size_t sample_h(int imgH, uint32_t grid) noexcept {
    return (static_cast<size_t>(imgH) + grid - 1u) / grid;
}

[[nodiscard]] inline float clamp01(float v) noexcept {
    return v < 0.f ? 0.f : (v > 1.f ? 1.f : v);
}
[[nodiscard]] inline uint32_t clampu(uint32_t v, uint32_t lo, uint32_t hi) noexcept {
    return v < lo ? lo : (v > hi ? hi : v);
}

inline uint32_t push_vertex(MeshData& mesh,
                             float x, float y, float z,
                             float nx_, float ny_, float nz_,
                             uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
    MeshVertex vtx{};
    vtx.x = x; vtx.y = y; vtx.z = z;
    vtx.nx = nx_; vtx.ny = ny_; vtx.nz = nz_;
    vtx.r = r; vtx.g = g; vtx.b = b; vtx.a = a;
    mesh.vertices.push_back(vtx);
    return static_cast<uint32_t>(mesh.vertices.size() - 1u);
}

inline void push_quad(MeshData& mesh,
                       uint32_t i0, uint32_t i1, uint32_t i2, uint32_t i3) {
    mesh.indices.push_back(i0); mesh.indices.push_back(i1); mesh.indices.push_back(i2);
    mesh.indices.push_back(i0); mesh.indices.push_back(i2); mesh.indices.push_back(i3);
}

/// Emit a depth prism (top face + 4 sides + bottom).
inline void emit_prism(MeshData& mesh,
                        float x0, float y0, float x1, float y1,
                        float z0, float z1,
                        uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
    const uint32_t t0 = push_vertex(mesh, x0,y0,z1, 0,0,1, r,g,b,a);
    const uint32_t t1 = push_vertex(mesh, x1,y0,z1, 0,0,1, r,g,b,a);
    const uint32_t t2 = push_vertex(mesh, x1,y1,z1, 0,0,1, r,g,b,a);
    const uint32_t t3 = push_vertex(mesh, x0,y1,z1, 0,0,1, r,g,b,a);
    const uint32_t b0 = push_vertex(mesh, x0,y0,z0, 0,0,-1, r,g,b,a);
    const uint32_t b1 = push_vertex(mesh, x1,y0,z0, 0,0,-1, r,g,b,a);
    const uint32_t b2 = push_vertex(mesh, x1,y1,z0, 0,0,-1, r,g,b,a);
    const uint32_t b3 = push_vertex(mesh, x0,y1,z0, 0,0,-1, r,g,b,a);
    push_quad(mesh, t0,t1,t2,t3);  // top
    push_quad(mesh, b3,b2,b1,b0);  // bottom
    push_quad(mesh, b0,b1,t1,t0);  // front
    push_quad(mesh, b1,b2,t2,t1);  // right
    push_quad(mesh, b2,b3,t3,t2);  // back
    push_quad(mesh, b3,b0,t0,t3);  // left
}

struct PixelCell {
    uint8_t r{}, g{}, b{}, a{};
    float   depth{};
    bool    valid{};
};

struct MergeRect {
    uint32_t  x{}, y{}, w{}, h{};
    PixelCell cell{};
};

[[nodiscard]] inline bool build_merged_rects(std::span<const PixelCell> cells,
                                              uint32_t sW, uint32_t sH,
                                              std::vector<MergeRect>& out) {
    out.clear();
    if (sW == 0 || sH == 0) return false;
    if (cells.size() != static_cast<size_t>(sW) * sH) return false;

    std::vector<uint8_t> visited(cells.size(), 0);
    auto idx = [sW](uint32_t x, uint32_t y) noexcept -> size_t {
        return static_cast<size_t>(y) * sW + x;
    };
    auto same = [](const PixelCell& a, const PixelCell& b) noexcept {
        return a.valid == b.valid && a.r == b.r && a.g == b.g
                                 && a.b == b.b && a.a == b.a;
    };

    for (uint32_t y = 0; y < sH; ++y) {
        for (uint32_t x = 0; x < sW; ++x) {
            const size_t i0 = idx(x, y);
            if (visited[i0]) continue;
            const auto& seed = cells[i0];
            visited[i0] = 1;
            if (!seed.valid) continue;

            uint32_t w = 1;
            while (x + w < sW && !visited[idx(x+w,y)] && same(cells[idx(x+w,y)], seed)) ++w;

            uint32_t h = 1;
            while (y + h < sH) {
                bool ok = true;
                for (uint32_t dx = 0; dx < w && ok; ++dx) {
                    const auto ci = idx(x+dx, y+h);
                    if (visited[ci] || !same(cells[ci], seed)) ok = false;
                }
                if (!ok) break;
                ++h;
            }
            for (uint32_t dy = 0; dy < h; ++dy)
                for (uint32_t dx = 0; dx < w; ++dx)
                    visited[idx(x+dx, y+dy)] = 1;

            out.push_back({x, y, w, h, seed});
        }
    }
    return true;
}

} // namespace detail

// ─── Depth map generation ─────────────────────────────────────────────────────

/// Generate a grayscale-luminance depth map from an RGBA8 image.
/// Output: sampleW × sampleH floats in [0,1], row-major.
[[nodiscard]] inline std::vector<float>
generate_depth_map(const ImageView& view, uint32_t gridSize) {
    const size_t sW = detail::sample_w(view.width, gridSize);
    const size_t sH = detail::sample_h(view.height, gridSize);
    std::vector<float> out(sW * sH, 0.f);
    for (size_t sy = 0; sy < sH; ++sy) {
        const uint32_t pxY = detail::clampu(
            static_cast<uint32_t>(sy * gridSize + gridSize / 2),
            0u, static_cast<uint32_t>(view.height - 1));
        for (size_t sx = 0; sx < sW; ++sx) {
            const uint32_t pxX = detail::clampu(
                static_cast<uint32_t>(sx * gridSize + gridSize / 2),
                0u, static_cast<uint32_t>(view.width - 1));
            uint8_t r=255, g=255, b=255, a=255;
            if (view.read_pixel(static_cast<int>(pxX), static_cast<int>(pxY), r,g,b,a) && a > 0)
                out[sy * sW + sx] = (0.299f * r + 0.587f * g + 0.114f * b) / 255.f;
        }
    }
    return out;
}

// ─── Mesh builders ────────────────────────────────────────────────────────────

/// Build a solid triangle-grid mesh with depth-map Z displacement.
[[nodiscard]] inline Expected<MeshData>
build_solid_mesh(const ImageView& view, std::span<const float> depthMap,
                 uint32_t gridSize, float depthScale) {
    if (!view.valid())       return std::unexpected("invalid image view");
    if (gridSize == 0)       return std::unexpected("gridSize must be > 0");
    if (depthScale == 0.f)   return std::unexpected("depthScale must be non-zero");

    const size_t sW = detail::sample_w(view.width,  gridSize);
    const size_t sH = detail::sample_h(view.height, gridSize);
    if (depthMap.size() != sW * sH) return std::unexpected("depth map size mismatch");
    if (sW < 2 || sH < 2)          return std::unexpected("image too small for grid");

    MeshData mesh;
    mesh.vertices.resize(sW * sH);
    mesh.indices.reserve((sW - 1u) * (sH - 1u) * 6u);

    for (size_t sy = 0; sy < sH; ++sy) {
        const float fv = (sH > 1) ? static_cast<float>(sy) / (sH - 1.f) : 0.f;
        const uint32_t pxY = detail::clampu(
            static_cast<uint32_t>(sy * gridSize), 0u,
            static_cast<uint32_t>(view.height - 1));
        for (size_t sx = 0; sx < sW; ++sx) {
            const float fu = (sW > 1) ? static_cast<float>(sx) / (sW - 1.f) : 0.f;
            const uint32_t pxX = detail::clampu(
                static_cast<uint32_t>(sx * gridSize), 0u,
                static_cast<uint32_t>(view.width - 1));
            const size_t vi = sy * sW + sx;
            const float z = depthMap[vi] * depthScale;
            uint8_t r=255, g=255, b=255, a=255;
            view.read_pixel(static_cast<int>(pxX), static_cast<int>(pxY), r,g,b,a);
            auto& vtx = mesh.vertices[vi];
            vtx.x=static_cast<float>(pxX); vtx.y=static_cast<float>(pxY); vtx.z=z;
            vtx.u=fu; vtx.v=fv;
            vtx.r=r; vtx.g=g; vtx.b=b; vtx.a=a;
        }
    }
    auto vi = [sW](size_t x, size_t y) { return static_cast<uint32_t>(y*sW+x); };
    for (size_t y = 0; y+1 < sH; ++y)
        for (size_t x = 0; x+1 < sW; ++x) {
            const uint32_t i0=vi(x,y), i1=vi(x+1,y), i2=vi(x+1,y+1), i3=vi(x,y+1);
            mesh.indices.insert(mesh.indices.end(), {i0,i1,i2, i0,i2,i3});
        }
    // Compute gradient-based normals
    for (size_t sy = 0; sy < sH; ++sy)
        for (size_t sx = 0; sx < sW; ++sx) {
            const size_t vi2 = sy * sW + sx;
            const size_t xm = (sx>0)?sx-1:sx, xp = (sx+1<sW)?sx+1:sx;
            const size_t ym = (sy>0)?sy-1:sy, yp = (sy+1<sH)?sy+1:sy;
            const float hl = depthMap[sy*sW+xm]*depthScale, hr = depthMap[sy*sW+xp]*depthScale;
            const float hd = depthMap[ym*sW+sx]*depthScale, hu = depthMap[yp*sW+sx]*depthScale;
            float nx_ = hl-hr, ny_ = hd-hu, nz_ = 2.f;
            const float len = std::sqrt(nx_*nx_ + ny_*ny_ + nz_*nz_);
            if (len > 0.f) { nx_/=len; ny_/=len; nz_/=len; }
            mesh.vertices[vi2].nx=nx_; mesh.vertices[vi2].ny=ny_; mesh.vertices[vi2].nz=nz_;
        }
    return mesh;
}

/// Build a wireframe edge-list mesh (use MeshMode::Wireframe).
[[nodiscard]] inline Expected<MeshData>
build_wireframe_mesh(const ImageView& view, std::span<const float> depthMap,
                     uint32_t gridSize, float depthScale) {
    if (!view.valid())       return std::unexpected("invalid image view");
    if (gridSize == 0)       return std::unexpected("gridSize must be > 0");
    if (depthScale == 0.f)   return std::unexpected("depthScale must be non-zero");

    const size_t sW = detail::sample_w(view.width,  gridSize);
    const size_t sH = detail::sample_h(view.height, gridSize);
    if (depthMap.size() != sW * sH) return std::unexpected("depth map size mismatch");
    if (sW < 2 || sH < 2)          return std::unexpected("image too small for grid");

    MeshData mesh;
    mesh.vertices.resize(sW * sH);
    mesh.indices.reserve((sW-1u) * sH * 2u + sW * (sH-1u) * 2u);

    for (size_t sy = 0; sy < sH; ++sy) {
        const float fv = (sH>1) ? static_cast<float>(sy)/(sH-1.f) : 0.f;
        const uint32_t pxY = detail::clampu(
            static_cast<uint32_t>(sy * gridSize), 0u, static_cast<uint32_t>(view.height-1));
        for (size_t sx = 0; sx < sW; ++sx) {
            const float fu = (sW>1) ? static_cast<float>(sx)/(sW-1.f) : 0.f;
            const uint32_t pxX = detail::clampu(
                static_cast<uint32_t>(sx * gridSize), 0u, static_cast<uint32_t>(view.width-1));
            uint8_t r=255,g=255,b=255,a=255;
            view.read_pixel(static_cast<int>(pxX), static_cast<int>(pxY), r,g,b,a);
            auto& vtx = mesh.vertices[sy*sW+sx];
            vtx.x=static_cast<float>(pxX); vtx.y=static_cast<float>(pxY);
            vtx.z=depthMap[sy*sW+sx]*depthScale;
            vtx.u=fu; vtx.v=fv;
            vtx.r=r; vtx.g=g; vtx.b=b; vtx.a=a;
        }
    }
    auto vi = [sW](size_t x, size_t y){ return static_cast<uint32_t>(y*sW+x); };
    for (size_t y = 0; y < sH; ++y)
        for (size_t x = 0; x+1 < sW; ++x) {
            mesh.indices.push_back(vi(x,y)); mesh.indices.push_back(vi(x+1,y));
        }
    for (size_t y = 0; y+1 < sH; ++y)
        for (size_t x = 0; x < sW; ++x) {
            mesh.indices.push_back(vi(x,y)); mesh.indices.push_back(vi(x,y+1));
        }
    return mesh;
}

/// Build a PixelPerfect extruded-prism mesh.
[[nodiscard]] inline Expected<MeshData>
build_pixel_perfect_mesh(const ImageView& view, std::span<const float> depthMap,
                          uint32_t gridSize, float depthScale) {
    if (!view.valid())     return std::unexpected("invalid image view");
    if (gridSize == 0)     return std::unexpected("gridSize must be > 0");
    if (depthScale == 0.f) return std::unexpected("depthScale must be non-zero");

    const size_t sW = detail::sample_w(view.width,  gridSize);
    const size_t sH = detail::sample_h(view.height, gridSize);
    if (depthMap.size() != sW * sH) return std::unexpected("depth map size mismatch");

    // Build per-cell colour+depth table
    std::vector<detail::PixelCell> cells(sW * sH);
    for (size_t sy = 0; sy < sH; ++sy) {
        const uint32_t pxY = detail::clampu(
            static_cast<uint32_t>(sy*gridSize + gridSize/2), 0u,
            static_cast<uint32_t>(view.height-1));
        for (size_t sx = 0; sx < sW; ++sx) {
            const uint32_t pxX = detail::clampu(
                static_cast<uint32_t>(sx*gridSize + gridSize/2), 0u,
                static_cast<uint32_t>(view.width-1));
            auto& cell = cells[sy*sW+sx];
            view.read_pixel(static_cast<int>(pxX), static_cast<int>(pxY),
                             cell.r, cell.g, cell.b, cell.a);
            cell.valid = (cell.a != 0);
            if (cell.valid) cell.depth = detail::clamp01(depthMap[sy*sW+sx]);
        }
    }

    std::vector<detail::MergeRect> rects;
    if (!detail::build_merged_rects(cells, static_cast<uint32_t>(sW),
                                     static_cast<uint32_t>(sH), rects))
        return std::unexpected("merged rect build failed");

    MeshData mesh;
    mesh.vertices.reserve(rects.size() * 8u);
    mesh.indices.reserve(rects.size() * 36u);

    for (const auto& rect : rects) {
        const float x0 = static_cast<float>(rect.x * gridSize);
        const float y0 = static_cast<float>(rect.y * gridSize);
        const float x1 = static_cast<float>((rect.x + rect.w) * gridSize);
        const float y1 = static_cast<float>((rect.y + rect.h) * gridSize);
        detail::emit_prism(mesh, x0, y0, x1, y1,
                            0.f, rect.cell.depth * depthScale,
                            rect.cell.r, rect.cell.g, rect.cell.b, rect.cell.a);
    }
    return mesh;
}

/// Dispatch to the correct builder based on MeshExportOptions::mode.
[[nodiscard]] inline Expected<MeshData>
build_mesh(const ImageView& view, const MeshExportOptions& opts) {
    auto depth = generate_depth_map(view, opts.gridSize);
    switch (opts.mode) {
        case MeshMode::Solid:
            return build_solid_mesh(view, depth, opts.gridSize, opts.depthScale);
        case MeshMode::Wireframe:
            return build_wireframe_mesh(view, depth, opts.gridSize, opts.depthScale);
        case MeshMode::PixelPerfect:
            return build_pixel_perfect_mesh(view, depth, opts.gridSize, opts.depthScale);
        case MeshMode::LoPoly:
            return std::unexpected("LoPoly mode not yet implemented");
    }
    return std::unexpected("unknown mesh mode");
}

// ─── PLY writer ───────────────────────────────────────────────────────────────

/// Write MeshData to a PLY ASCII file.
[[nodiscard]] inline Expected<std::string>
save_as_ply(const MeshData& mesh, std::string_view out_path,
            const MeshExportOptions& opts) {
    if (mesh.empty()) return std::unexpected("mesh is empty");
    const bool isWireframe = (opts.mode == MeshMode::Wireframe);
    if (isWireframe) {
        if ((mesh.indices.size() % 2u) != 0u)
            return std::unexpected("wireframe requires even index count");
    } else {
        if ((mesh.indices.size() % 3u) != 0u)
            return std::unexpected("solid mesh requires index count divisible by 3");
    }

    std::ofstream file(std::string{out_path}, std::ios::out | std::ios::trunc);
    if (!file) return std::unexpected(std::format("cannot open '{}'", out_path));

    file << "ply\nformat ascii 1.0\ncomment generated by pce::dms\n"
         << "element vertex " << mesh.vertices.size() << "\n"
         << "property float x\nproperty float y\nproperty float z\n"
         << "property float nx\nproperty float ny\nproperty float nz\n"
         << "property uchar red\nproperty uchar green\n"
         << "property uchar blue\nproperty uchar alpha\n";

    if (isWireframe) {
        file << "element edge " << (mesh.indices.size() / 2u) << "\n"
             << "property int vertex1\nproperty int vertex2\n";
    } else {
        file << "element face " << (mesh.indices.size() / 3u) << "\n"
             << "property list uchar int vertex_indices\n";
    }
    file << "end_header\n";

    for (const auto& v : mesh.vertices) {
        const uint8_t r = opts.useVertexColors ? v.r : 255u;
        const uint8_t g = opts.useVertexColors ? v.g : 255u;
        const uint8_t b = opts.useVertexColors ? v.b : 255u;
        const uint8_t a = opts.useVertexColors ? v.a : 255u;
        file << v.x << ' ' << v.y << ' ' << v.z << ' '
             << v.nx << ' ' << v.ny << ' ' << v.nz << ' '
             << int(r) << ' ' << int(g) << ' ' << int(b) << ' ' << int(a) << '\n';
    }
    if (isWireframe) {
        for (size_t i = 0; i+1 < mesh.indices.size(); i += 2)
            file << mesh.indices[i] << ' ' << mesh.indices[i+1] << '\n';
    } else {
        for (size_t i = 0; i+2 < mesh.indices.size(); i += 3)
            file << "3 " << mesh.indices[i] << ' '
                 << mesh.indices[i+1] << ' ' << mesh.indices[i+2] << '\n';
    }

    if (!file) return std::unexpected("I/O error writing PLY");
    return std::string{out_path};
}

} // namespace pce::dms

