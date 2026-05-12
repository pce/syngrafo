#pragma once
/**
 * @file dms_bindings.hh
 * @author Patrick Engel
 * @brief DMS C++23 bindings — thin orchestrator.
 *
 * Wires DMSHandle into saucer::smartview by delegating to four domain modules:
 *
 *   bindings/file_bindings.hh    — scan/read/write/copy/move/delete/picker
 *   bindings/image_bindings.hh   — SVG, mesh, OCR, EXIF, rectify, PDF
 *   bindings/nlp_bindings.hh       — index, search, zones, bulk-index
 *   bindings/lifecycle_bindings.hh — workflow, timeline, folder dashboard
 *   bindings/archive_bindings.hh — create_archive, compress_file
 *
 * Core value types (no webview, no JSON, no DB):
 *   core/image.hh     — Image, ImageView, pal:: palette helpers
 *   core/mesh.hh      — MeshVertex, MeshData, MeshMode, builders, PLY writer
 *   core/document.hh  — Document, Block, NLPResult
 *   core/zone.hh      — Zone pure value type
 *   core/pipeline.hh  — C++23 pipe operator for Expected<T> chains
 *
 * JSON envelope (every exposed function returns Promise<string>):
 *   { "ok": true,  "data": <payload> }  // success
 *   { "ok": false, "error": "<msg>"  }  // failure
 *
 * @note Include only from app/main.cc — application-internal header.
 */

#include "dms_handle.hh"

#include "bindings/file_bindings.hh"
#include "bindings/image_bindings.hh"
#include "bindings/nlp_bindings.hh"
#include "bindings/lifecycle_bindings.hh"
#include "bindings/archive_bindings.hh"
#include "bindings/palette_bindings.hh"
#include "bindings/model_bindings.hh"
#include "bindings/bookmark_bindings.hh"
#include "bindings/netmon_bindings.hh"

#include <chrono>
#include <map>
#include <set>

// DMSHandle method implementations (split by domain)
#include "bindings/impl/workflow_helpers.hh"
#include "bindings/impl/scan_impl.hh"
#include "bindings/impl/meta_impl.hh"
#include "bindings/impl/zone_impl.hh"
#include "bindings/impl/ocr_impl.hh"
#include "bindings/impl/lifecycle_impl.hh"
#include "bindings/impl/bookmark_impl.hh"
#include "bindings/impl/video_impl.hh"

namespace pce::dms {

/** @brief Wires all DMS C++ functions into the saucer smartview as JS-callable bindings. */
inline void register_dms_bindings(saucer::smartview&                           wv,
                                   DMSHandle&                                   dms,
                                   saucer::modules::desktop&                    desk,
                                   saucer::model_downloader::ModelDownloader&   dl) {
    dms.wv_ptr.store(static_cast<saucer::webview*>(&wv), std::memory_order_release);
    register_file_bindings    (wv, dms, desk);
    register_image_bindings   (wv, dms, desk);
    register_nlp_bindings     (wv, dms, desk);
    register_lifecycle_bindings(wv, dms, desk);
    register_archive_bindings (wv, dms, desk);
    register_palette_bindings (wv, dms, desk);
    register_model_bindings   (wv, dl,  dms);
    register_bookmark_bindings(wv, dms);
    pce::netmon::register_netmon_bindings(wv);
}

} // namespace pce::dms
