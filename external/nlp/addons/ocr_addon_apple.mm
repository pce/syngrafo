#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <AppKit/AppKit.h>
#include <string>
#include <vector>
#include "platform_services.hh"

namespace pce::nlp::platform {

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

} // namespace pce::nlp::platform
