/**
 * @file ocr_addon_apple.mm
 * @brief Apple-platform OCR backend (Apple Vision).
 *
 * - `pce::nlp::backend` — Apple Vision OCR, compiled when `NLP_APPLE_VISION` is defined.
 *
 * OS services (reveal_in_file_manager, detect_document_corners, rectify_image, extract_exif)
 * are implemented in their respective addon files (platform_services_apple.mm, etc.).
 */
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <AppKit/AppKit.h>
#import <PDFKit/PDFKit.h>
#include <cctype>
#include <string>
#include <vector>
#include "platform_services.hh"

#ifdef NLP_APPLE_VISION

namespace pce::nlp::backend {

std::string extract_text(const std::string& input) {
    @autoreleasepool {
        NSString* path = [NSString stringWithUTF8String:input.c_str()];
        NSURL* url = [NSURL fileURLWithPath:path];

        if (![[NSFileManager defaultManager] fileExistsAtPath:path]) {
            return "";
        }

        NSError* error = nil;
        VNImageRequestHandler* handler = [[VNImageRequestHandler alloc] initWithURL:url options:@{}];
        if (!handler) return "";

        __block std::string result_text;
        VNRecognizeTextRequest* request = [[VNRecognizeTextRequest alloc] initWithCompletionHandler:^(VNRequest * _Nonnull request, NSError * _Nullable error) {
            if (error) return;

            NSArray* results = [request results];
            for (VNRecognizedTextObservation* observation in results) {
                NSArray<VNRecognizedText*>* topCandidates = [observation topCandidates:1];
                if ([topCandidates count] > 0) {
                    VNRecognizedText* recText = [topCandidates firstObject];
                    if (recText.confidence < 0.35f) continue;
                    result_text += [recText.string UTF8String];
                    result_text += "\n";
                }
            }
        }];

        [request setRecognitionLevel:VNRequestTextRecognitionLevelAccurate];
        [request setUsesLanguageCorrection:YES];

        if (![handler performRequests:@[request] error:&error]) {
            // Log to stderr but return empty — callers treat "" as "no text found"
            // and must NOT save error strings as OCR content.
            NSLog(@"[ocr_addon] performRequests failed: %@", error.localizedDescription);
            return "";
        }

        return result_text;
    }
}

// extract_text_from_pdf (PDFKit + Vision AI)
// 1. Try native PDFKit text extraction (fast, works for digital PDFs).
// 2. If text is sparse (scanned PDF), render each page at 150 DPI and OCR with Vision AI.
std::string extract_text_from_pdf(const std::string& input_path) {
    @autoreleasepool {
        NSString* nsPath = [NSString stringWithUTF8String:input_path.c_str()];
        NSURL*    url    = [NSURL fileURLWithPath:nsPath];
        if (![[NSFileManager defaultManager] fileExistsAtPath:nsPath]) return "";

        PDFDocument* doc = [[PDFDocument alloc] initWithURL:url];
        if (!doc) return "";

        const NSUInteger pageCount = [doc pageCount];
        if (pageCount == 0) return "";

        // ── Step 1: extract embedded text ────────────────────────────────────
        NSMutableString* embedded = [NSMutableString new];
        for (NSUInteger i = 0; i < pageCount; ++i) {
            PDFPage*  page    = [doc pageAtIndex:i];
            NSString* pageStr = page ? [page string] : nil;
            if (pageStr.length > 0) {
                [embedded appendString:pageStr];
                [embedded appendString:@"\n\n"];
            }
        }
        const char* emb_utf8 = [embedded UTF8String];
        std::string emb_text = emb_utf8 ? emb_utf8 : "";

        // Count alpha characters — ≥ 50 alphas per page means a digital PDF
        size_t alpha = 0;
        for (unsigned char c : emb_text)
            if (std::isalpha(c)) ++alpha;

        if (alpha >= pageCount * 50)
            return emb_text; // good embedded text ─ no OCR needed

        // ── Step 2: scanned PDF — render pages and OCR with Vision AI ─────────
        NSLog(@"[pdf] embedded alpha=%zu/%lu pages — running Vision AI OCR", alpha, (unsigned long)pageCount);

        std::string ocr_result;
        const CGFloat kScale = 150.0 / 72.0; // 150 DPI → readable for Tesseract / Vision AI

        for (NSUInteger i = 0; i < pageCount; ++i) {
            PDFPage* page = [doc pageAtIndex:i];
            if (!page) continue;

            NSRect bounds = [page boundsForBox:kPDFDisplayBoxMediaBox];
            const NSInteger pw = (NSInteger)(bounds.size.width  * kScale);
            const NSInteger ph = (NSInteger)(bounds.size.height * kScale);
            if (pw <= 0 || ph <= 0) continue;

            // Render page into an off-screen bitmap
            NSBitmapImageRep* rep = [[NSBitmapImageRep alloc]
                initWithBitmapDataPlanes:NULL
                pixelsWide:pw
                pixelsHigh:ph
                bitsPerSample:8
                samplesPerPixel:3
                hasAlpha:NO
                isPlanar:NO
                colorSpaceName:NSDeviceRGBColorSpace
                bytesPerRow:0
                bitsPerPixel:0];
            if (!rep) continue;

            [NSGraphicsContext saveGraphicsState];
            NSGraphicsContext* gctx = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
            [NSGraphicsContext setCurrentContext:gctx];

            [[NSColor whiteColor] setFill];
            NSRectFill(NSMakeRect(0, 0, pw, ph));

            CGContextRef cgCtx = gctx.CGContext;
            CGContextScaleCTM(cgCtx, kScale, kScale);
            [page drawWithBox:kPDFDisplayBoxMediaBox toContext:cgCtx];

            [NSGraphicsContext restoreGraphicsState];

            CGImageRef cgImage = rep.CGImage;
            if (!cgImage) continue;

            // Vision OCR on rendered page image
            __block std::string page_text;
            VNImageRequestHandler* handler = [[VNImageRequestHandler alloc]
                initWithCGImage:cgImage options:@{}];

            VNRecognizeTextRequest* req = [[VNRecognizeTextRequest alloc]
                initWithCompletionHandler:^(VNRequest* r, NSError* /*e*/) {
                    for (VNRecognizedTextObservation* obs in r.results) {
                        NSArray<VNRecognizedText*>* cands = [obs topCandidates:1];
                        if (cands.count > 0 && cands.firstObject.confidence >= 0.35f) {
                            page_text += [cands.firstObject.string UTF8String];
                            page_text += "\n";
                        }
                    }
                }];
            req.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
            req.usesLanguageCorrection = YES;

            NSError* err = nil;
            if (![handler performRequests:@[req] error:&err] && i == 0)
                NSLog(@"[pdf_ocr] page 0 failed: %@", err.localizedDescription);

            if (!page_text.empty()) {
                ocr_result += page_text;
                ocr_result += "\n";
            }
        }

        return ocr_result;
    }
}

#endif // NLP_APPLE_VISION

} // namespace pce::nlp::backend
