#pragma once
/**
 * @file core/gltf.hh
 * @brief MeshData → binary glTF 2.0 (.glb) export.
 *
 * Self-contained.  No external deps beyond nlohmann/json (already in tree).
 * Output is a valid .glb container loadable by Blender, three.js, Babylon.js,
 * and any glTF 2.0 viewer.
 *
 * Buffer layout (non-interleaved, one buffer view per attribute):
 *   POSITION   nv × vec3<f32>
 *   NORMAL     nv × vec3<f32>
 *   TEXCOORD_0 nv × vec2<f32>
 *   COLOR_0    nv × vec4<u8, normalised>   (only when useVertexColors)
 *   indices    ni × u32
 */
#include "mesh.hh"
#include <cstdint>
#include <fstream>
#include <nlohmann/json.hpp>

namespace pce::dms {

[[nodiscard]] inline Expected<std::string>
save_as_gltf(const MeshData& mesh,
             const std::string& out_path,
             const MeshExportOptions& opts)
{
    if (mesh.empty())
        return std::unexpected(std::string{"save_as_gltf: empty mesh"});

    const size_t nv = mesh.vertices.size();
    const size_t ni = mesh.indices.size();
    const bool   wc = opts.useVertexColors;

    // ── binary buffer layout ─────────────────────────────────────────────────
    const size_t pos_off = 0,               pos_len = nv * 3 * 4;
    const size_t nrm_off = pos_off+pos_len, nrm_len = nv * 3 * 4;
    const size_t uv_off  = nrm_off+nrm_len, uv_len  = nv * 2 * 4;
    const size_t col_off = uv_off +uv_len,  col_len = wc ? nv * 4 : 0;
    const size_t col_pad = col_len % 4 ? 4 - col_len % 4 : 0;
    const size_t idx_off = col_off+col_len+col_pad, idx_len = ni * 4;
    const size_t buf_len = idx_off + idx_len;

    std::vector<uint8_t> buf(buf_len, 0);

    float pmin[3] = { 1e38f,  1e38f,  1e38f};
    float pmax[3] = {-1e38f, -1e38f, -1e38f};

    for (size_t i = 0; i < nv; ++i) {
        const auto& v = mesh.vertices[i];

        auto wf3 = [&](size_t base, float a, float b, float c) {
            float* p = reinterpret_cast<float*>(buf.data() + base + i*3*4);
            p[0]=a; p[1]=b; p[2]=c;
        };
        wf3(pos_off, v.x, v.y, v.z);
        wf3(nrm_off, v.nx, v.ny, v.nz);

        float* uv = reinterpret_cast<float*>(buf.data() + uv_off + i*2*4);
        uv[0]=v.u; uv[1]=v.v;

        if (wc) {
            uint8_t* col = buf.data() + col_off + i*4;
            col[0]=v.r; col[1]=v.g; col[2]=v.b; col[3]=v.a;
        }

        pmin[0]=std::min(pmin[0],v.x); pmin[1]=std::min(pmin[1],v.y); pmin[2]=std::min(pmin[2],v.z);
        pmax[0]=std::max(pmax[0],v.x); pmax[1]=std::max(pmax[1],v.y); pmax[2]=std::max(pmax[2],v.z);
    }
    for (size_t i = 0; i < ni; ++i)
        *reinterpret_cast<uint32_t*>(buf.data() + idx_off + i*4) = mesh.indices[i];

    // ── glTF JSON ─────────────────────────────────────────────────────────────
    using json = nlohmann::json;

    json bufferViews = json::array();
    json accessors   = json::array();

    auto make_bv = [&](size_t off, size_t len, int target) -> int {
        const int idx = int(bufferViews.size());
        bufferViews.push_back({{"buffer",0},{"byteOffset",off},
                               {"byteLength",len},{"target",target}});
        return idx;
    };
    auto make_acc = [&](int bv, size_t cnt,
                        const char* type, int comp, bool norm=false) -> int {
        const int idx = int(accessors.size());
        json a = {{"bufferView",bv},{"byteOffset",0},
                  {"count",cnt},{"type",type},{"componentType",comp}};
        if (norm) a["normalized"] = true;
        accessors.push_back(std::move(a));
        return idx;
    };

    const int ac_pos = make_acc(make_bv(pos_off, pos_len, 34962), nv, "VEC3", 5126);
    accessors[ac_pos]["min"] = json::array({pmin[0], pmin[1], pmin[2]});
    accessors[ac_pos]["max"] = json::array({pmax[0], pmax[1], pmax[2]});

    const int ac_nrm = make_acc(make_bv(nrm_off, nrm_len, 34962), nv, "VEC3", 5126);
    const int ac_uv  = make_acc(make_bv(uv_off,  uv_len,  34962), nv, "VEC2", 5126);
    int ac_col = -1;
    if (wc) ac_col = make_acc(make_bv(col_off, col_len, 34962), nv, "VEC4", 5121, true);
    const int ac_idx = make_acc(make_bv(idx_off, idx_len, 34963), ni, "SCALAR", 5125);

    json prim;
    prim["mode"]                     = (opts.mode == MeshMode::Wireframe) ? 1 : 4;
    prim["attributes"]["POSITION"]   = ac_pos;
    prim["attributes"]["NORMAL"]     = ac_nrm;
    prim["attributes"]["TEXCOORD_0"] = ac_uv;
    if (wc) prim["attributes"]["COLOR_0"] = ac_col;
    prim["indices"] = ac_idx;

    json j;
    j["asset"]       = {{"version","2.0"},{"generator","syngrafo"}};
    j["scene"]       = 0;
    j["scenes"]      = json::array({json{{"name","scene"},{"nodes",json::array({0})}}});
    j["nodes"]       = json::array({json{{"name","mesh"},{"mesh",0}}});
    j["meshes"]      = json::array({json{{"name","mesh"},{"primitives",json::array({prim})}}});
    j["accessors"]   = std::move(accessors);
    j["bufferViews"] = std::move(bufferViews);
    j["buffers"]     = json::array({json{{"byteLength", buf_len}}});

    // ── GLB container ─────────────────────────────────────────────────────────
    const std::string json_str = j.dump();
    const size_t json_pad = json_str.size() % 4 ? 4 - json_str.size() % 4 : 0;
    const size_t bin_pad  = buf_len % 4          ? 4 - buf_len % 4          : 0;
    const size_t glb_len  = 12
                          + 8 + json_str.size() + json_pad
                          + 8 + buf_len         + bin_pad;

    std::vector<uint8_t> glb;
    glb.reserve(glb_len);

    auto pu32 = [&](uint32_t v) {
        glb.push_back( v        & 0xFFu);
        glb.push_back((v >>  8) & 0xFFu);
        glb.push_back((v >> 16) & 0xFFu);
        glb.push_back((v >> 24) & 0xFFu);
    };

    pu32(0x46546C67u);              // magic "glTF"
    pu32(2u);                        // version
    pu32(uint32_t(glb_len));

    pu32(uint32_t(json_str.size() + json_pad));
    pu32(0x4E4F534Au);              // chunk type "JSON"
    for (char c : json_str) glb.push_back(uint8_t(c));
    for (size_t i = 0; i < json_pad; ++i) glb.push_back(' ');  // pad with spaces per spec

    pu32(uint32_t(buf_len + bin_pad));
    pu32(0x004E4942u);              // chunk type "BIN\0"
    glb.insert(glb.end(), buf.begin(), buf.end());
    for (size_t i = 0; i < bin_pad; ++i) glb.push_back(0);

    // ── write ─────────────────────────────────────────────────────────────────
    std::ofstream file(out_path, std::ios::binary | std::ios::trunc);
    if (!file)
        return std::unexpected(std::format("Cannot write '{}'", out_path));
    file.write(reinterpret_cast<const char*>(glb.data()),
               static_cast<std::streamsize>(glb.size()));
    if (file.fail())
        return std::unexpected(std::format("I/O error writing '{}'", out_path));
    return out_path;
}

} // namespace pce::dms
