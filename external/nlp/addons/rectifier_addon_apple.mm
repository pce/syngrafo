#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <AppKit/AppKit.h>
#import <CoreImage/CoreImage.h>
#include <string>
#include <vector>
#include <iostream>
#include "platform_services.hh"

namespace pce::nlp::platform {


/**
 * @brief Uses Apple Vision to detect document/rectangle corners.
 * Returns 4 corners in normalized coordinates (0-1).
 */
std::vector<Point2D> detect_document_corners(const std::string& input_path) {
    @autoreleasepool {
        NSString* path = [NSString stringWithUTF8String:input_path.c_str()];
        NSURL* url = [NSURL fileURLWithPath:path];

        if (![[NSFileManager defaultManager] fileExistsAtPath:path]) {
            return {};
        }

        NSError* error = nil;
        VNImageRequestHandler* handler = [[VNImageRequestHandler alloc] initWithURL:url options:@{}];
        if (!handler) return {};

        __block std::vector<Point2D> corners;
        VNDetectRectanglesRequest* request = [[VNDetectRectanglesRequest alloc] initWithCompletionHandler:^(VNRequest * _Nonnull request, NSError * _Nullable error) {
            if (error) return;

            NSArray* results = [request results];
            if ([results count] > 0) {
                // Take the largest/most prominent rectangle
                VNRectangleObservation* observation = [results firstObject];

                // Vision coordinates are normalized (0-1), origin bottom-left.
                corners.push_back({(float)observation.topLeft.x, (float)observation.topLeft.y});
                corners.push_back({(float)observation.topRight.x, (float)observation.topRight.y});
                corners.push_back({(float)observation.bottomRight.x, (float)observation.bottomRight.y});
                corners.push_back({(float)observation.bottomLeft.x, (float)observation.bottomLeft.y});
            }
        }];

        // Configure request
        request.minimumAspectRatio = 0.2;
        request.maximumObservations = 1;

        if (![handler performRequests:@[request] error:&error]) {
            return {};
        }

        return corners;
    }
}

/**
 * @brief Performs perspective warping and saves the result using CIImage.
 */
bool rectify_image(const std::string& input_path, const std::string& output_path, const std::vector<Point2D>& corners) {
    if (corners.size() != 4) return false;

    @autoreleasepool {
        NSString* inPath = [NSString stringWithUTF8String:input_path.c_str()];
        CIImage* inputImage = [CIImage imageWithContentsOfURL:[NSURL fileURLWithPath:inPath]];
        if (!inputImage) return false;

        CGRect extent = [inputImage extent];
        float w = extent.size.width;
        float h = extent.size.height;

        // Convert normalized Vision coordinates (0-1, bottom-left) to Image coordinates (top-left for CoreImage? No, CI is also bottom-left)
        CIVector* tl = [CIVector vectorWithX:corners[0].x * w Y:corners[0].y * h];
        CIVector* tr = [CIVector vectorWithX:corners[1].x * w Y:corners[1].y * h];
        CIVector* br = [CIVector vectorWithX:corners[2].x * w Y:corners[2].y * h];
        CIVector* bl = [CIVector vectorWithX:corners[3].x * w Y:corners[3].y * h];

        CIFilter* warp = [CIFilter filterWithName:@"CIPerspectiveCorrection"];
        [warp setValue:inputImage forKey:kCIInputImageKey];
        [warp setValue:tl forKey:@"inputTopLeft"];
        [warp setValue:tr forKey:@"inputTopRight"];
        [warp setValue:br forKey:@"inputBottomRight"];
        [warp setValue:bl forKey:@"inputBottomLeft"];

        CIImage* outputImage = [warp outputImage];
        if (!outputImage) return false;

        NSBitmapImageRep* rep = [[NSBitmapImageRep alloc] initWithCIImage:outputImage];
        NSDictionary* props = [NSDictionary dictionaryWithObject:[NSNumber numberWithFloat:0.8] forKey:NSImageCompressionFactor];
        NSData* data = [rep representationUsingType:NSBitmapImageFileTypeJPEG properties:props];

        return [data writeToFile:[NSString stringWithUTF8String:output_path.c_str()] atomically:YES];
    }
}

} // namespace pce::nlp::platform
