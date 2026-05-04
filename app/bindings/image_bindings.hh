#pragma once
/**
 * @file bindings/image_bindings.hh
 * @author Patrick Engel
 * @brief Image-domain bindings — value layer separation, no logic in the binding.
 *
 *  Every exposed function follows: parse args → call pure domain fn → serialize result.
 *  All image algorithms live in core/image.hh and core/mesh.hh.
 *
 * Exposed bindings:
 *   dms_image_to_svg          JSON{ path, palette?, smooth? }       → { outPath, palette, colors }
 *   dms_image_to_svg_poly     JSON{ path, palette?, smooth? }       → { outPath, palette, colors }
 *   dms_image_to_svg_tri      JSON{ path, palette?, smooth?, gridSize? } → { outPath, … }
 *   dms_image_analyze         JSON{ path, palette? }                → { width, height, palette[], histogram }
 *   dms_image_to_mesh         JSON{ path, mode?, gridSize?, depthScale?, useVertexColors? } → { outPath, … }
 *   dms_ocr_document          (path: string, zone: string)          → { text, cached, quality }
 *   dms_get_exif              (path: string)                        → ExifData
 *   dms_rectify_document      (path: string, outPath?: string)      → { success, outPath }
 *   dms_export_pdf            (srcPath: string, outPath: string)    → stub — pending saucer/pdf integration
 *   dms_extract_pdf_text      (path: string)                        → stub — pending saucer/pdf integration
 *
 * NOTE: PDF extraction and export use the saucer/pdf library (https://github.com/saucer/pdf).
 *       Process-spawning (sips, pdftotext, pdftoppm) is explicitly forbidden in this codebase.
 *       macOS uses Vision AI (VNRecognizeTextRequest) and CoreImage where possible.
 */

#include "../dms_handle.hh"
#include "../core/image.hh"
#include "../core/mesh.hh"
#include "../core/pipeline.hh"
#include "../core/image_ops.hh"
#include "../core/gltf.hh"
#include "../media/topology.hh"

#include <algorithm>
#include <array>
#include <fstream>
#include <format>

#ifdef NLP_WITH_ONNX
#  include "../nlp/addons/platform_services.hh"
#endif

namespace pce::dms {
namespace topology = ::pce::media::topology;

namespace svg_detail {

/// Greedy width-then-height rect merge → compact SVG `<rect>` elements.
inline void write_svg_rects(std::ofstream& f, const std::vector<int>& pidx,
                             const pal::Palette& pal_, int w, int h) {
    std::vector<uint8_t> vis(static_cast<size_t>(w) * h, 0);
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            const size_t base = static_cast<size_t>(y) * w + x;
            if (vis[base]) continue;
            const int ci = pidx[base];
            if (ci < 0) { vis[base] = 1; continue; }
            int rW = 1;
            while (x + rW < w && !vis[base + rW] && pidx[base + rW] == ci) ++rW;
            int rH = 1;
            while (y + rH < h) {
                bool ok = true;
                for (int k = 0; k < rW && ok; ++k) {
                    const size_t p2 = static_cast<size_t>(y + rH) * w + (x + k);
                    if (vis[p2] || pidx[p2] != ci) ok = false;
                }
                if (ok) ++rH; else break;
            }
            for (int j = 0; j < rH; ++j)
                for (int i = 0; i < rW; ++i)
                    vis[static_cast<size_t>(y+j)*w + (x+i)] = 1;
            const auto& c = pal_[static_cast<size_t>(ci)];
            f << "<rect x=\"" << x << "\" y=\"" << y
              << "\" width=\"" << rW << "\" height=\"" << rH
              << "\" fill=\"rgb(" << (int)c.r << ',' << (int)c.g << ',' << (int)c.b << ")\"/>\n";
        }
    }
}

/// Directed boundary-edge polygon tracing — one `<path>` per palette colour.
/// Uses Ramer–Douglas–Peucker to simplify contours (replaces collinearity-only pass).
inline void write_svg_poly(std::ofstream& f, std::vector<int>& pidx,
                            const pal::Palette& pal_, int w, int h,
                            float rdp_epsilon = 1.5f) {
    using Pt = topology::Vec2i;
    using EM = std::unordered_map<int64_t, Pt>;
    const int np = (int)pal_.size();
    auto enc = [](int x, int y) -> int64_t {
        return (int64_t(uint32_t(x)) << 32) | int64_t(uint32_t(y));
    };
    std::vector<EM> em(static_cast<size_t>(np));
    auto nbr = [&](int x, int y) -> int {
        if (x<0||x>=w||y<0||y>=h) return -3;
        return pidx[static_cast<size_t>(y)*w+x];
    };
    for (int y=0; y<h; ++y)
        for (int x=0; x<w; ++x) {
            const int lbl = pidx[static_cast<size_t>(y)*w+x];
            if (lbl<0) continue;
            auto& e = em[static_cast<size_t>(lbl)];
            if (nbr(x,   y-1)!=lbl) e[enc(x,  y  )]={x+1,y  };
            if (nbr(x+1, y  )!=lbl) e[enc(x+1,y  )]={x+1,y+1};
            if (nbr(x,   y+1)!=lbl) e[enc(x+1,y+1)]={x,  y+1};
            if (nbr(x-1, y  )!=lbl) e[enc(x,  y+1)]={x,  y  };
        }
    pidx.clear(); pidx.shrink_to_fit();

    for (int ci=0; ci<np; ++ci) {
        auto& emap = em[static_cast<size_t>(ci)];
        if (emap.empty()) continue;
        std::string d;
        while (!emap.empty()) {
            auto it = emap.begin();
            const Pt start{(int)(it->first>>32),(int)(uint32_t(it->first))};
            std::vector<Pt> ring{start};
            Pt cur = it->second; emap.erase(it);
            for (int step=0; step<200'000 && cur!=start && !emap.empty(); ++step) {
                ring.push_back(cur);
                auto ni = emap.find(enc(cur.x,cur.y));
                if (ni==emap.end()) break;
                cur = ni->second; emap.erase(ni);
            }
            // RDP simplification — replaces old collinearity-only pass
            const auto s = topology::rdp_simplify(ring, rdp_epsilon);
            if (s.size()<3) continue;
            d += std::format("M{},{}", s[0].x, s[0].y);
            for (size_t j=1; j<s.size(); ++j) d += std::format(" L{},{}", s[j].x, s[j].y);
            d += " Z";
        }
        if (!d.empty()) {
            const auto& c = pal_[static_cast<size_t>(ci)];
            f << "<path d=\"" << d
              << "\" fill=\"rgb(" << (int)c.r << ',' << (int)c.g << ',' << (int)c.b << ")\"/>\n";
        }
    }
}

/// Triangle-grid lo-poly — dominant colour per triangle half-cell.
inline void write_svg_tri(std::ofstream& f, const std::vector<int>& pidx,
                           const pal::Palette& pal_, int w, int h, int gs) {
    const int np = (int)pal_.size();
    std::vector<std::string> paths(static_cast<size_t>(np));
    for (int cellY=0; cellY<h; cellY+=gs) {
        for (int cellX=0; cellX<w; cellX+=gs) {
            const int gW=std::min(gs,w-cellX), gH=std::min(gs,h-cellY);
            std::vector<int> cA(static_cast<size_t>(np),0), cB(static_cast<size_t>(np),0);
            for (int dy=0; dy<gH; ++dy)
                for (int dx=0; dx<gW; ++dx) {
                    const int v=pidx[static_cast<size_t>(cellY+dy)*w+(cellX+dx)];
                    if (v<0) continue;
                    (dx*gH+dy*gW<gW*gH ? cA : cB)[static_cast<size_t>(v)]++;
                }
            auto dom=[](const std::vector<int>& c)->int{
                return (int)(std::max_element(c.begin(),c.end())-c.begin());};
            const int ca=dom(cA), cb=dom(cB);
            const int x1=cellX,y1=cellY,x2=cellX+gW,y2=cellY+gH;
            paths[static_cast<size_t>(ca)] += std::format("M{},{} L{},{} L{},{} Z",x1,y1,x2,y1,x1,y2);
            paths[static_cast<size_t>(cb)] += std::format("M{},{} L{},{} L{},{} Z",x2,y1,x2,y2,x1,y2);
        }
    }
    for (int ci=0; ci<np; ++ci) {
        if (paths[static_cast<size_t>(ci)].empty()) continue;
        const auto& c = pal_[static_cast<size_t>(ci)];
        f << "<path d=\"" << paths[static_cast<size_t>(ci)]
          << "\" fill=\"rgb(" << (int)c.r << ',' << (int)c.g << ',' << (int)c.b << ")\"/>\n";
    }
}

/**
 * Full region-graph SVG emitter.
 *
 * Pipeline:
 *   pidx → build_label_field (union-find CC)
 *        → per-component boundary-edge walk
 *        → RDP simplification
 *        → SVG `<path>` grouped by palette colour
 *
 * Unlike `write_svg_poly` (which traces once per palette colour globally),
 * this function traces per **connected component**, so disjoint patches of the
 * same colour produce independent paths.
 */
inline void write_svg_regions(std::ofstream& f, const std::vector<int>& pidx,
                               const pal::Palette& pal_, int w, int h,
                               float rdp_epsilon = 1.5f) {
    const int np = (int)pal_.size();
    const auto rmap = topology::build_label_field(pidx, w, h);

    std::vector<std::string> paths(static_cast<size_t>(np));

    for (int rid = 0; rid < rmap.component_count; ++rid) {
        const int ci = rmap.label_of[rid];
        if (ci < 0 || ci >= np) continue;
        // inline svg_path_for_region: extract rings → rdp → SVG d= string
        std::string path_d;
        for (auto& ring : topology::extract_rings(rmap, rid)) {
            const auto s = topology::rdp_simplify(ring, rdp_epsilon);
            if (s.size() < 3) continue;
            path_d += std::format("M{},{}", s[0].x, s[0].y);
            for (size_t j = 1; j < s.size(); ++j)
                path_d += std::format(" L{},{}", s[j].x, s[j].y);
            path_d += " Z";
        }
        if (!path_d.empty()) paths[static_cast<size_t>(ci)] += path_d;
    }

    for (int ci = 0; ci < np; ++ci) {
        if (paths[static_cast<size_t>(ci)].empty()) continue;
        const auto& c = pal_[static_cast<size_t>(ci)];
        f << "<path d=\"" << paths[static_cast<size_t>(ci)]
          << "\" fill=\"rgb(" << (int)c.r << ',' << (int)c.g << ',' << (int)c.b << ")\"/>\n";
    }
}

struct SvgArgs {
    std::string path;
    std::string palette    {"db16"};
    bool        smooth     {true};
    int         gridSize   {8};
    float       rdpEpsilon {1.5f};
    bool        useLab     {false};
    // pre-pass
    int         maxDim     {512};   ///< normalize: cap max(w,h) to this; 0 = off
    float       blurSigma  {0.5f}; ///< gaussian blur sigma before quantisation; 0 = off
    bool        edgeMode   {false}; ///< burn Sobel contours into image
    float       edgeWeight {0.4f}; ///< edge intensity [0..1]
    int         pixelBlock {0};     ///< pixelate block size; 0/1 = off
};

[[nodiscard]] inline SvgArgs parse_svg_args(const std::string& raw) {
    SvgArgs a;
    try {
        auto j       = json::parse(raw);
        a.path       = j.value("path",        std::string{});
        a.palette    = j.value("palette",     std::string{"db16"});
        a.smooth     = j.value("smooth",      true);
        a.gridSize   = j.value("gridSize",    8);
        a.rdpEpsilon = float(j.value("rdpEpsilon", 1.5));
        a.useLab     = j.value("useLab",      false);
        a.maxDim     = j.value("maxDim",      512);
        a.blurSigma  = float(j.value("blurSigma",  0.5));
        a.edgeMode   = j.value("edgeMode",    false);
        a.edgeWeight = float(j.value("edgeWeight", 0.4));
        a.pixelBlock = j.value("pixelBlock",  0);
    } catch (...) {}
    if (a.path.empty()) a.path = raw;
    a.gridSize   = std::clamp(a.gridSize,   2,    64);
    a.rdpEpsilon = std::clamp(a.rdpEpsilon, 0.1f, 20.f);
    a.maxDim     = std::clamp(a.maxDim,     0,    4096);
    a.blurSigma  = std::clamp(a.blurSigma,  0.0f, 10.f);
    a.edgeWeight = std::clamp(a.edgeWeight, 0.0f, 1.0f);
    a.pixelBlock = std::clamp(a.pixelBlock, 0,    64);
    return a;
}

/// Apply the optional image pre-pass according to SvgArgs.
/// Runs: normalize → blur → edge_overlay → pixelate (each skipped when disabled).
[[nodiscard]] inline Expected<Image> preprocess(Expected<Image> img, const SvgArgs& a) {
    if (a.maxDim > 0)     img = std::move(img) | stage(ops::normalize(a.maxDim));
    if (a.blurSigma > 0)  img = std::move(img) | stage(ops::gaussian_blur(a.blurSigma));
    if (a.edgeMode)       img = std::move(img) | stage(ops::edge_overlay(a.blurSigma, a.edgeWeight));
    if (a.pixelBlock > 1) img = std::move(img) | stage(ops::pixelate(a.pixelBlock));
    return img;
}

[[nodiscard]] inline fs::path unique_out(const fs::path& src,
                                          std::string_view suffix, std::string_view ext) {
    fs::path out = src.parent_path()/(src.stem().string()+std::string{suffix}+std::string{ext});
    for (int n=2; fs::exists(out)&&n<1000; ++n)
        out = src.parent_path()/(src.stem().string()+std::string{suffix}+std::to_string(n)+std::string{ext});
    return out;
}

/// Reconstruct an Image where every pixel is replaced by its mapped palette color.
/// Used to palette-quantise before mesh building so vertex colors match the palette.
[[nodiscard]] inline Image recolor(const Image& img,
                                    const pal::Palette& palette,
                                    const std::vector<int>& pidx) {
    Image out;
    out.width = img.width; out.height = img.height;
    out.pixels.resize(img.pixels.size(), 0);
    const int n = img.width * img.height;
    for (int i = 0; i < n; ++i) {
        const int ci = pidx[i];
        if (ci >= 0 && ci < static_cast<int>(palette.size())) {
            const auto& c = palette[static_cast<size_t>(ci)];
            out.pixels[static_cast<size_t>(i)*4+0] = c.r;
            out.pixels[static_cast<size_t>(i)*4+1] = c.g;
            out.pixels[static_cast<size_t>(i)*4+2] = c.b;
            out.pixels[static_cast<size_t>(i)*4+3] = 255u;
        }
    }
    return out;
}

/// Returns a short suffix string for the given MeshMode.
[[nodiscard]] inline std::string_view mode_suffix(MeshMode m) noexcept {
    switch (m) {
        case MeshMode::Wireframe:    return "_wfr";
        case MeshMode::PixelPerfect: return "_pxl";
        default:                     return "_solid";
    }
}

} // namespace svg_detail


inline void register_image_bindings(saucer::smartview& wv, DMSHandle& dms,
                                     saucer::modules::desktop& /*desk*/) {
    using std::string;

    wv.expose("dms_image_to_svg", [](string arg) -> string {
        const auto a = svg_detail::parse_svg_args(arg);
        const fs::path src{a.path}; std::error_code ec;
        if (!fs::exists(src,ec)) return DMSHandle::err_str(std::format("'{}' does not exist",a.path));
        if (fs::is_directory(src,ec)) return DMSHandle::err_str("path is a directory");
        auto img = svg_detail::preprocess(Image::load(a.path), a);
        if (!img) return DMSHandle::err_str(img.error());
        const int w=img->width, h=img->height;
        auto palette = pal::resolve(a.palette,img->data(),w,h);
        auto pidx    = a.useLab ? pal::map_pixels_lab(img->data(),w,h,palette)
                                : pal::map_pixels(img->data(),w,h,palette);
        if (a.smooth) pal::smooth(pidx,w,h);
        const auto out = svg_detail::unique_out(src,"_rct",".svg");
        std::ofstream file(out,std::ios::out|std::ios::trunc);
        if (!file) return DMSHandle::err_str(std::format("Cannot write '{}'",out.string()));
        file << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
             << "<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\""
             << " viewBox=\"0 0 " << w << " " << h << "\" shape-rendering=\"crispEdges\">\n";
        svg_detail::write_svg_rects(file,pidx,palette,w,h);
        file << "</svg>\n";
        if (file.fail()) return DMSHandle::err_str("I/O error writing SVG");
        return DMSHandle::ok_str(json{{"outPath",out.string()},{"palette",a.palette},{"colors",(int)palette.size()},{"sourceSize",json{{"w",w},{"h",h}}}});
    });

    wv.expose("dms_image_to_svg_poly", [](string arg) -> string {
        const auto a = svg_detail::parse_svg_args(arg);
        const fs::path src{a.path}; std::error_code ec;
        if (!fs::exists(src,ec)) return DMSHandle::err_str(std::format("'{}' does not exist",a.path));
        if (fs::is_directory(src,ec)) return DMSHandle::err_str("path is a directory");
        auto img = svg_detail::preprocess(Image::load(a.path), a);
        if (!img) return DMSHandle::err_str(img.error());
        const int w=img->width, h=img->height;
        auto palette = pal::resolve(a.palette,img->data(),w,h);
        auto pidx    = a.useLab ? pal::map_pixels_lab(img->data(),w,h,palette)
                                : pal::map_pixels(img->data(),w,h,palette);
        if (a.smooth) pal::smooth(pidx,w,h);
        const auto out = svg_detail::unique_out(src,"_ply",".svg");
        std::ofstream file(out,std::ios::out|std::ios::trunc);
        if (!file) return DMSHandle::err_str(std::format("Cannot write '{}'",out.string()));
        file << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
             << "<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\""
             << " viewBox=\"0 0 " << w << " " << h << "\" shape-rendering=\"crispEdges\">\n";
        svg_detail::write_svg_poly(file,pidx,palette,w,h,a.rdpEpsilon);
        file << "</svg>\n";
        if (file.fail()) return DMSHandle::err_str("I/O error writing SVG");
        return DMSHandle::ok_str(json{{"outPath",out.string()},{"palette",a.palette},{"colors",(int)palette.size()},{"sourceSize",json{{"w",w},{"h",h}}}});
    });

    wv.expose("dms_image_to_svg_tri", [](string arg) -> string {
        const auto a = svg_detail::parse_svg_args(arg);
        const fs::path src{a.path}; std::error_code ec;
        if (!fs::exists(src,ec)) return DMSHandle::err_str(std::format("'{}' does not exist",a.path));
        if (fs::is_directory(src,ec)) return DMSHandle::err_str("path is a directory");
        auto img = svg_detail::preprocess(Image::load(a.path), a);
        if (!img) return DMSHandle::err_str(img.error());
        const int w=img->width, h=img->height;
        auto palette = pal::resolve(a.palette,img->data(),w,h);
        auto pidx    = a.useLab ? pal::map_pixels_lab(img->data(),w,h,palette)
                                : pal::map_pixels(img->data(),w,h,palette);
        if (a.smooth) pal::smooth(pidx,w,h);
        const auto out = svg_detail::unique_out(src,"_tri",".svg");
        std::ofstream file(out,std::ios::out|std::ios::trunc);
        if (!file) return DMSHandle::err_str(std::format("Cannot write '{}'",out.string()));
        file << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
             << "<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\""
             << " viewBox=\"0 0 " << w << " " << h << "\">\n";
        svg_detail::write_svg_tri(file,pidx,palette,w,h,a.gridSize);
        file << "</svg>\n";
        if (file.fail()) return DMSHandle::err_str("I/O error writing SVG");
        return DMSHandle::ok_str(json{{"outPath",out.string()},{"palette",a.palette},
                                       {"colors",(int)palette.size()},{"gridSize",a.gridSize},{"sourceSize",json{{"w",w},{"h",h}}}});
    });

    wv.expose("dms_image_to_svg_region", [](string arg) -> string {
        const auto a = svg_detail::parse_svg_args(arg);
        const fs::path src{a.path}; std::error_code ec;
        if (!fs::exists(src,ec)) return DMSHandle::err_str(std::format("'{}' does not exist",a.path));
        if (fs::is_directory(src,ec)) return DMSHandle::err_str("path is a directory");
        auto img = svg_detail::preprocess(Image::load(a.path), a);
        if (!img) return DMSHandle::err_str(img.error());
        const int w=img->width, h=img->height;
        auto palette = pal::resolve(a.palette,img->data(),w,h);
        auto pidx    = a.useLab ? pal::map_pixels_lab(img->data(),w,h,palette)
                                : pal::map_pixels(img->data(),w,h,palette);
        if (a.smooth) pal::smooth(pidx,w,h);
        const auto out = svg_detail::unique_out(src,"_rgn",".svg");
        std::ofstream file(out,std::ios::out|std::ios::trunc);
        if (!file) return DMSHandle::err_str(std::format("Cannot write '{}'",out.string()));
        file << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
             << "<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\""
             << " viewBox=\"0 0 " << w << " " << h << "\" shape-rendering=\"crispEdges\">\n";
        svg_detail::write_svg_regions(file,pidx,palette,w,h,a.rdpEpsilon);
        file << "</svg>\n";
        if (file.fail()) return DMSHandle::err_str("I/O error writing SVG");
        return DMSHandle::ok_str(json{{"outPath",out.string()},{"palette",a.palette},
                                       {"colors",(int)palette.size()},{"rdpEpsilon",a.rdpEpsilon},{"sourceSize",json{{"w",w},{"h",h}}}});
    });

    wv.expose("dms_image_analyze", [](string arg) -> string {
        std::string path; std::string palName="auto16";
        try { auto j=json::parse(arg); path=j.value("path",std::string{}); palName=j.value("palette",std::string{"auto16"}); }
        catch (...) {}
        if (path.empty()) path=arg;
        const fs::path src{path}; std::error_code ec;
        if (!fs::exists(src,ec)) return DMSHandle::err_str(std::format("'{}' does not exist",path));
        auto img = Image::load(path);
        if (!img) return DMSHandle::err_str(img.error());
        const int w=img->width, h=img->height;
        const uint8_t* data=img->data();
        const int npx=w*h;
        std::array<int,256> hR{},hG{},hB{}; hR.fill(0); hG.fill(0); hB.fill(0);
        for (int i=0; i<npx; ++i)
            if (data[size_t(i)*4+3]>0){++hR[data[size_t(i)*4]];++hG[data[size_t(i)*4+1]];++hB[data[size_t(i)*4+2]];}
        auto palette=pal::resolve(palName,data,w,h);
        auto pidx=pal::map_pixels(data,w,h,palette);
        const int np=(int)palette.size();
        std::vector<int> cnt(size_t(np),0); int total=0;
        for (int v:pidx) if(v>=0){++cnt[size_t(v)];++total;}
        json parr=json::array();
        for (int i=0;i<np;++i){
            const auto& c=palette[size_t(i)];
            const double pct=total>0?std::round(double(cnt[size_t(i)])/total*1000.0)/10.0:0.0;
            parr.push_back(json{{"r",(int)c.r},{"g",(int)c.g},{"b",(int)c.b},
                {"hex",std::format("#{:02x}{:02x}{:02x}",c.r,c.g,c.b)},{"count",cnt[size_t(i)]},{"pct",pct}});
        }
        std::sort(parr.begin(),parr.end(),[](const json& a,const json& b){return a["count"].get<int>()>b["count"].get<int>();});
        json rR=json::array(),rG=json::array(),rB=json::array();
        for (int v:hR) rR.push_back(v); for (int v:hG) rG.push_back(v); for (int v:hB) rB.push_back(v);
        return DMSHandle::ok_str(json{{"width",w},{"height",h},{"palette",parr},
            {"histogram",json{{"r",rR},{"g",rG},{"b",rB}}}});
    });

    // Asset → Transform → View: Image::load | normalize | build_mesh | save_as_ply
    wv.expose("dms_image_to_mesh", [](string arg) -> string {
        std::string path; std::string modeStr="solid"; std::string palette;
        uint32_t gridSize=8; float depthScale=50.f; bool useColors=true;
        bool smooth=false;
        int maxDim=0; float blurSigma=0.0f;
        try {
            auto j=json::parse(arg);
            path      =j.value("path",            std::string{});
            modeStr   =j.value("mode",            std::string{"solid"});
            gridSize  =uint32_t(std::clamp(j.value("gridSize",8),1,64));
            depthScale=float(j.value("depthScale",50.0));
            useColors =j.value("useVertexColors", true);
            palette   =j.value("palette",         std::string{});
            smooth    =j.value("smooth",          false);
            maxDim    =j.value("maxDim",          0);
            blurSigma =float(j.value("blurSigma", 0.0));
        } catch (...) {}
        if (path.empty()) path=arg;
        const fs::path src{path}; std::error_code ec;
        if (!fs::exists(src,ec)) return DMSHandle::err_str(std::format("'{}' does not exist",path));
        MeshMode mode=MeshMode::Solid;
        if      (modeStr=="wireframe")    mode=MeshMode::Wireframe;
        else if (modeStr=="pixelperfect") mode=MeshMode::PixelPerfect;

        // Preprocess step — captures dimensions after normalise/blur
        auto img = Image::load(path);
        if (maxDim > 0)    img = std::move(img) | stage(ops::normalize(maxDim));
        if (blurSigma > 0) img = std::move(img) | stage(ops::gaussian_blur(blurSigma));
        if (!img) return DMSHandle::err_str(img.error());
        const int sw=img->width, sh=img->height;

        // Optional palette quantisation → recolor so vertex colors match palette
        if (!palette.empty() && useColors) {
            auto pal_colors = pal::resolve(palette, img->data(), sw, sh);
            auto pidx       = pal::map_pixels(img->data(), sw, sh, pal_colors);
            if (smooth) pal::smooth(pidx, sw, sh);
            *img = svg_detail::recolor(*img, pal_colors, pidx);
        }

        const MeshExportOptions opts{mode, gridSize, depthScale, useColors};
        const auto out_path = svg_detail::unique_out(src, svg_detail::mode_suffix(mode), ".ply");
        auto mesh = build_mesh(ImageView::from(*img), opts);
        if (!mesh) return DMSHandle::err_str(mesh.error());
        auto saved = save_as_ply(*mesh, out_path.string(), opts);
        if (!saved) return DMSHandle::err_str(saved.error());
        const int64_t sz=(int64_t)fs::file_size(fs::path{*saved},ec);
        return DMSHandle::ok_str(json{{"outPath",*saved},{"sizeBytes",ec?int64_t{0}:sz},
            {"mode",modeStr},{"gridSize",(int)gridSize},{"depthScale",depthScale},
            {"sourceSize",json{{"w",sw},{"h",sh}}}});
    });

    // Image → normalize → build_mesh → save_as_gltf (.glb)
    wv.expose("dms_image_to_gltf", [](string arg) -> string {
        std::string path; std::string modeStr="solid"; std::string palette;
        uint32_t gridSize=8; float depthScale=50.f; bool useColors=true;
        bool smooth=false;
        int maxDim=0; float blurSigma=0.0f;
        try {
            auto j=json::parse(arg);
            path      =j.value("path",            std::string{});
            modeStr   =j.value("mode",            std::string{"solid"});
            gridSize  =uint32_t(std::clamp(j.value("gridSize",8),1,64));
            depthScale=float(j.value("depthScale",50.0));
            useColors =j.value("useVertexColors", true);
            palette   =j.value("palette",         std::string{});
            smooth    =j.value("smooth",          false);
            maxDim    =j.value("maxDim",          0);
            blurSigma =float(j.value("blurSigma", 0.0));
        } catch (...) {}
        if (path.empty()) path=arg;
        const fs::path src{path}; std::error_code ec;
        if (!fs::exists(src,ec)) return DMSHandle::err_str(std::format("'{}' does not exist",path));
        MeshMode mode=MeshMode::Solid;
        if      (modeStr=="wireframe")    mode=MeshMode::Wireframe;
        else if (modeStr=="pixelperfect") mode=MeshMode::PixelPerfect;

        // Preprocess — captures dimensions after normalise/blur
        auto img = Image::load(path);
        if (maxDim > 0)    img = std::move(img) | stage(ops::normalize(maxDim));
        if (blurSigma > 0) img = std::move(img) | stage(ops::gaussian_blur(blurSigma));
        if (!img) return DMSHandle::err_str(img.error());
        const int sw=img->width, sh=img->height;

        // Optional palette quantisation → recolor vertex colors
        if (!palette.empty() && useColors) {
            auto pal_colors = pal::resolve(palette, img->data(), sw, sh);
            auto pidx       = pal::map_pixels(img->data(), sw, sh, pal_colors);
            if (smooth) pal::smooth(pidx, sw, sh);
            *img = svg_detail::recolor(*img, pal_colors, pidx);
        }

        const MeshExportOptions opts{mode, gridSize, depthScale, useColors};
        const auto out_path = svg_detail::unique_out(src, svg_detail::mode_suffix(mode), ".glb");
        auto mesh = build_mesh(ImageView::from(*img), opts);
        if (!mesh) return DMSHandle::err_str(mesh.error());
        auto saved = save_as_gltf(*mesh, out_path.string(), opts);
        if (!saved) return DMSHandle::err_str(saved.error());
        const int64_t sz=(int64_t)fs::file_size(fs::path{*saved},ec);
        return DMSHandle::ok_str(json{{"outPath",*saved},{"sizeBytes",ec?int64_t{0}:sz},
            {"mode",modeStr},{"gridSize",(int)gridSize},{"depthScale",depthScale},
            {"sourceSize",json{{"w",sw},{"h",sh}}}});
    });

    wv.expose("dms_ocr_document", [&dms](string path, string zone) -> string {
        return dms.ocr_document(path, zone);
    });

#ifdef NLP_WITH_ONNX
    wv.expose("dms_get_exif", [](string path) -> string {
        if (!fs::exists(fs::path{path})) return DMSHandle::err_str("File not found: "+path);
        const std::string raw = pce::nlp::platform::extract_exif(path);
        try { return DMSHandle::ok_str(json::parse(raw)); } catch (...) {}
        return DMSHandle::ok_str(json::object());
    });
#else
    wv.expose("dms_get_exif", [](string) -> string {
        return DMSHandle::err_str("EXIF extraction requires NLP_WITH_ONNX build");
    });
#endif

    wv.expose("dms_rectify_document",
              [&dms](string path, std::optional<string> out_path) -> string {
        const auto r = dms.rectify_document(path, out_path);
        if (!r) return DMSHandle::err_str(r.error());
        return DMSHandle::ok_str(*r);
    });

    // TODO: integrate saucer/pdf — https://github.com/saucer/pdf
    //       macOS: PDFKit / CGPDFContext. No process spawning permitted.
    wv.expose("dms_export_pdf", [](string /*src_path*/, string /*out_path*/) -> string {
        return DMSHandle::err_str(
            "PDF export is not yet available — pending saucer/pdf integration. "
            "See: https://github.com/saucer/pdf");
    });

    // TODO: integrate saucer/pdf — https://github.com/saucer/pdf
    //       macOS: PDFKit PDFDocument API. No process spawning permitted.
    wv.expose("dms_extract_pdf_text", [](string /*path*/) -> string {
        return DMSHandle::err_str(
            "PDF text extraction is not yet available — pending saucer/pdf integration. "
            "See: https://github.com/saucer/pdf");
    });
}

} // namespace pce::dms
