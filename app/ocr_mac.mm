#include <AppKit/AppKit.h>
#include <Foundation/Foundation.h>
#include <Vision/Vision.h>
#include <iostream>

int main(int argc, char *argv[]) {
  if (argc < 2) {
    std::cerr << "Usage: " << argv[0] << " <image-path>" << std::endl;
    return 1;
  }

  @autoreleasepool {
    NSString *path = [NSString stringWithUTF8String:argv[1]];
    NSURL *url = [NSURL fileURLWithPath:path];

    NSError *error = nil;
    VNImageRequestHandler *handler =
        [[VNImageRequestHandler alloc] initWithURL:url options:@{}];

    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc]
        initWithCompletionHandler:^(VNRequest *_Nonnull request,
                                    NSError *_Nullable error) {
          if (error) {
            std::cerr << "Error: " << [[error localizedDescription] UTF8String]
                      << std::endl;
            return;
          }

          NSArray *results = [request results];
          std::cerr << "Found " << [results count] << " text blocks."
                    << std::endl;
          for (VNRecognizedTextObservation *observation in results) {
            NSArray<VNRecognizedText *> *topCandidates =
                [observation topCandidates:1];
            if ([topCandidates count] > 0) {
              VNRecognizedText *text = [topCandidates firstObject];
              std::cout << [[text string] UTF8String] << "\n";
            }
          }
        }];

    [request setRecognitionLevel:VNRequestTextRecognitionLevelAccurate];

    if (![handler performRequests:@[ request ] error:&error]) {
      std::cerr << "Failed to perform request: " <<
          [[error localizedDescription] UTF8String] << std::endl;
      return 1;
    }
  }

  return 0;
}
