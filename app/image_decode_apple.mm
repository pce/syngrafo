/**
 * @file image_decode_apple.mm
 * @brief Apple ImageIO backend for decode_image_to_rgba().
 *
 * Uses CGImageSource to decode any format the macOS / iOS Image I/O
 * framework supports (JPEG, PNG, GIF, BMP, TGA, WebP, HEIC/HEIF, AVIF,
 * TIFF, …).  The output is always RGBA8888, row-major.
 */

#include "image_decode.hh"

#import <CoreFoundation/CoreFoundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>

#include <format>

namespace pce {

RGBAImage decode_image_to_rgba(const std::string& path) {
    RGBAImage result;

    @autoreleasepool {
        // Build a file:// URL from the path string.
        NSString* ns_path =
            [NSString stringWithUTF8String:path.c_str()];
        NSURL* url = [NSURL fileURLWithPath:ns_path];
        if (!url) {
            result.error = std::format("ImageIO: invalid path '{}'", path);
            return result;
        }

        // Create an image source from the file URL.
        CGImageSourceRef source =
            CGImageSourceCreateWithURL((__bridge CFURLRef)url, nullptr);
        if (!source) {
            result.error = std::format(
                "ImageIO: cannot open '{}' (unsupported format or file missing)",
                path);
            return result;
        }

        // Decode the primary image (index 0).
        CGImageRef image =
            CGImageSourceCreateImageAtIndex(source, 0, nullptr);
        CFRelease(source);
        if (!image) {
            result.error = std::format(
                "ImageIO: failed to decode image at '{}'", path);
            return result;
        }

        const size_t w = CGImageGetWidth(image);
        const size_t h = CGImageGetHeight(image);
        if (w == 0 || h == 0) {
            CGImageRelease(image);
            result.error = std::format(
                "ImageIO: image '{}' has zero dimensions", path);
            return result;
        }

        // Allocate the output RGBA buffer.
        result.pixels.resize(w * h * 4);
        result.width  = static_cast<int>(w);
        result.height = static_cast<int>(h);

        // Create a CGBitmapContext targeting the output buffer.
        // kCGBitmapByteOrder32Big | kCGImageAlphaPremultipliedLast
        // produces RGBA bytes in memory (R=byte0, G=byte1, B=byte2, A=byte3)
        // on all Apple platforms, matching what stb_image returns.
        //
        // Use a C-style cast to combine the two CGBitmapInfo enum values.
        // The bitwise OR of kCGBitmapByteOrder32Big (CGBitmapInfo) with
        // kCGImageAlphaPremultipliedLast (CGImageAlphaInfo) triggers a
        // "bitwise op between different enum types" warning in C++17/23.
        // Casting to the wider uint32_t avoids the warning without changing
        // the generated code.
        const CGBitmapInfo bitmapInfo =
            static_cast<CGBitmapInfo>(kCGBitmapByteOrder32Big)
            | static_cast<CGBitmapInfo>(kCGImageAlphaPremultipliedLast);
        CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
        CGContextRef ctx   = CGBitmapContextCreate(
            result.pixels.data(),
            w, h,
            8,           // bits per component
            w * 4,       // bytes per row
            cs,
            bitmapInfo);
        CGColorSpaceRelease(cs);

        if (!ctx) {
            CGImageRelease(image);
            result.error = "ImageIO: failed to create RGBA bitmap context";
            return result;
        }

        // Render the image into the context (and therefore into result.pixels).
        CGContextDrawImage(ctx, CGRectMake(0, 0,
                                           static_cast<CGFloat>(w),
                                           static_cast<CGFloat>(h)),
                           image);
        CGContextRelease(ctx);
        CGImageRelease(image);

        result.ok = true;
    } // @autoreleasepool

    return result;
}

} // namespace pce
