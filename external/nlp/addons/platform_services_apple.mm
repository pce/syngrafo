/**
 * @file platform_services_apple.mm
 * @brief macOS native file-manager reveal via @c NSWorkspace.
 *
 * Implements @c pce::nlp::platform::reveal_in_file_manager for Apple targets.
 * The other @c platform functions live in @c rectifier_addon_apple.mm
 * and @c exif_addon_apple.mm.
 */

#include "platform_services.hh"
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

namespace pce::nlp::platform {

bool reveal_in_file_manager(const std::string& path) {
    @autoreleasepool {
        NSString* nsPath = [NSString stringWithUTF8String:path.c_str()];
        NSURL*    url    = [NSURL fileURLWithPath:nsPath];
        if (!url) return false;
        [[NSWorkspace sharedWorkspace] activateFileViewerSelectingURLs:@[url]];
        return true;
    }
}

} // namespace pce::nlp::platform
