#pragma once
/**
 * @file dms_models.hh
 * @author Patrick Engel
 * @brief DMS model aggregator — single include for all pure value types.
 *
 * Pull in all core/  headers.  No webview, no JSON, no DB, no virtuals.
 * This is the "model layer" — testable, reusable, composable.
 *
 * Value-layer design:
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │  Binding layer    bindings/  — JSON ↔ domain, saucer::expose()     │
 *   │       ↓  delegates to                                               │
 *   │  Handle layer     dms_handle.hh — state (DB, NLP, zone, jthread)  │
 *   │       ↓  operates on                                                │
 *   │  Model layer      core/       — pure value types (this header)     │
 *   │    Image   ImageView   pal::Palette                                 │
 *   │    MeshVertex  MeshData  MeshExportOptions                          │
 *   │    Block   BlockType   BlockMetadata   StyleRef                     │
 *   │    Document   NLPResult   Entity   Keyword                          │
 *   │    Zone   Bookmark                                                   │
 *   │    Stage<F>   pipeline operator|                                    │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * Binding pattern (thin adapters):
 * @code{.cpp}
 *   wv.expose("dms_image_to_mesh", [](string arg) -> string {
 *       return parse_mesh_request(arg)                 //  string → Request
 *           .and_then(Image::load)                     //  Request → Image
 *           .and_then([&](Image img){                  //  Image → MeshData
 *               return build_mesh(ImageView::from(img), opts); })
 *           .and_then([&](MeshData m){                 //  MeshData → path
 *               return save_as_ply(m, out, opts); })
 *           .transform(ok_json)                        //  path → JSON string
 *           .value_or(err_json("mesh failed"));
 *   });
 *
 *   // NLP on Document — first-class
 *   Expected<NLPResult> analyze_document(Document& doc, NLPEngine& engine);
 *   Expected<std::vector<Entity>> extract_entities(const Document& doc, NLPEngine&);
 * @endcode
 */

// Core value types
#include "core/image.hh"      // Image, ImageView, PixelFormat, pal::*
#include "core/mesh.hh"       // MeshVertex, MeshData, MeshMode, MeshExportOptions,
                              //   build_mesh, save_as_ply, generate_depth_map
#include "core/document.hh"   // BlockType, BlockMetadata, StyleRef, Block,
                              //   NLPResult, Entity, Keyword, Document
#include "core/document_state.hh" // DocumentState, BlobRecord, lifecycle DTOs
#include "core/palette.hh"    // PaletteEntry, ColorPalette, PaletteKind,
                              //   builtin_palettes()
#include "core/zone.hh"       // Zone
#include "core/pipeline.hh"   // Stage<F>, stage(), operator|

//  Monadic helpers
#include "dms_monadic.hh"     // Expected<T>, VoidResult, require, try_invoke, …
