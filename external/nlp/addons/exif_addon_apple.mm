// exif_addon_apple.mm — EXIF / image-metadata extraction via macOS ImageIO
// Implements platform::extract_exif() declared in platform_services.hh.

#include "platform_services.hh"

#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>

namespace pce::nlp::platform {

static NSString* safe_str(id val) {
    if ([val isKindOfClass:[NSString class]]) return val;
    if ([val isKindOfClass:[NSNumber class]]) return [val stringValue];
    return nil;
}

std::string extract_exif(const std::string& path) {
    @autoreleasepool {
        NSString* ns_path = [NSString stringWithUTF8String:path.c_str()];
        NSURL* url = [NSURL fileURLWithPath:ns_path];
        if (!url) return "{}";

        NSDictionary* opts = @{ (NSString*)kCGImageSourceShouldCache: @NO };
        CGImageSourceRef src = CGImageSourceCreateWithURL(
            (__bridge CFURLRef)url,
            (__bridge CFDictionaryRef)opts);
        if (!src) return "{}";

        CFDictionaryRef raw = CGImageSourceCopyPropertiesAtIndex(src, 0, nullptr);
        CFRelease(src);
        if (!raw) return "{}";

        // CFBridgingRelease transfers CF ownership to Objective-C — correct in
        // both ARC and non-ARC builds (no __bridge_transfer needed).
        NSDictionary* props = (NSDictionary*)CFBridgingRelease(raw);
        NSMutableDictionary* out = [NSMutableDictionary dictionary];

        // ── Basic image properties ────────────────────────────────────────
        auto put = [&](NSString* key, id val) {
            if (val) out[key] = val;
        };

        put(@"width",  props[(NSString*)kCGImagePropertyPixelWidth]);
        put(@"height", props[(NSString*)kCGImagePropertyPixelHeight]);
        put(@"dpiX",   props[(NSString*)kCGImagePropertyDPIWidth]);
        put(@"dpiY",   props[(NSString*)kCGImagePropertyDPIHeight]);
        put(@"colorModel",   props[(NSString*)kCGImagePropertyColorModel]);
        put(@"colorProfile", props[(NSString*)kCGImagePropertyProfileName]);

        NSNumber* orient = props[(NSString*)kCGImagePropertyOrientation];
        if (orient) {
            NSDictionary* orientNames = @{
                @1: @"Normal", @2: @"FlipH", @3: @"Rotate180",
                @4: @"FlipV",  @5: @"Transpose", @6: @"Rotate90CW",
                @7: @"Transverse", @8: @"Rotate90CCW"
            };
            put(@"orientation", orientNames[orient] ?: [orient stringValue]);
        }

        // ── EXIF ──────────────────────────────────────────────────────────
        NSDictionary* exif = props[(NSString*)kCGImagePropertyExifDictionary];
        if (exif) {
            put(@"dateTime",    safe_str(exif[(NSString*)kCGImagePropertyExifDateTimeOriginal]));
            put(@"lensMake",    safe_str(exif[(NSString*)kCGImagePropertyExifLensMake]));
            put(@"lensModel",   safe_str(exif[(NSString*)kCGImagePropertyExifLensModel]));
            put(@"aperture",    exif[(NSString*)kCGImagePropertyExifFNumber]);
            put(@"exposureSec", exif[(NSString*)kCGImagePropertyExifExposureTime]);
            put(@"focalLength", exif[(NSString*)kCGImagePropertyExifFocalLength]);
            put(@"flash",       exif[(NSString*)kCGImagePropertyExifFlash]);

            id iso = exif[(NSString*)kCGImagePropertyExifISOSpeedRatings];
            if ([iso isKindOfClass:[NSArray class]] && [iso count] > 0)
                put(@"iso", [iso firstObject]);
            else
                put(@"iso", iso);

            put(@"exposureBias", exif[(NSString*)kCGImagePropertyExifExposureBiasValue]);
            put(@"whiteBalance", exif[(NSString*)kCGImagePropertyExifWhiteBalance]);
            put(@"colorSpace",   safe_str(exif[(NSString*)kCGImagePropertyExifColorSpace]));

            id pixW = exif[(NSString*)kCGImagePropertyExifPixelXDimension];
            id pixH = exif[(NSString*)kCGImagePropertyExifPixelYDimension];
            if (pixW && pixH) {
                out[@"pixelDimensions"] = [NSString stringWithFormat:@"%@×%@", pixW, pixH];
            }
        }

        // ── TIFF (camera make/model, software) ────────────────────────────
        NSDictionary* tiff = props[(NSString*)kCGImagePropertyTIFFDictionary];
        if (tiff) {
            put(@"cameraMake",  safe_str(tiff[(NSString*)kCGImagePropertyTIFFMake]));
            put(@"cameraModel", safe_str(tiff[(NSString*)kCGImagePropertyTIFFModel]));
            put(@"software",    safe_str(tiff[(NSString*)kCGImagePropertyTIFFSoftware]));
            // Prefer EXIF dateTime but fall back to TIFF
            if (!out[@"dateTime"])
                put(@"dateTime", safe_str(tiff[(NSString*)kCGImagePropertyTIFFDateTime]));
        }

        // ── GPS ───────────────────────────────────────────────────────────
        NSDictionary* gps = props[(NSString*)kCGImagePropertyGPSDictionary];
        if (gps) {
            NSNumber* lat = gps[(NSString*)kCGImagePropertyGPSLatitude];
            NSNumber* lon = gps[(NSString*)kCGImagePropertyGPSLongitude];
            if (lat && lon) {
                NSString* latRef = gps[(NSString*)kCGImagePropertyGPSLatitudeRef]  ?: @"N";
                NSString* lonRef = gps[(NSString*)kCGImagePropertyGPSLongitudeRef] ?: @"E";
                double latV = [lat doubleValue] * ([latRef isEqualToString:@"S"] ? -1.0 : 1.0);
                double lonV = [lon doubleValue] * ([lonRef isEqualToString:@"W"] ? -1.0 : 1.0);
                out[@"gpsLat"] = @(latV);
                out[@"gpsLon"] = @(lonV);
                put(@"gpsAlt", gps[(NSString*)kCGImagePropertyGPSAltitude]);
            }
        }

        // ── Serialise to JSON ─────────────────────────────────────────────
        if (out.count == 0) return "{}";
        NSError* err = nil;
        NSData*  data = [NSJSONSerialization dataWithJSONObject:out
                                                        options:0
                                                          error:&err];
        if (!data) return "{}";
        NSString* json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        return json ? std::string([json UTF8String]) : "{}";
    }
}

} // namespace pce::nlp::platform

