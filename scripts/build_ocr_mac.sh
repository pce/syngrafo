#!/bin/bash
# Helper script to build the standalone ocr_mac tool for macOS Vision OCR testing.
clang++ -O3 -std=c++23 -objcpp \
    -framework Vision \
    -framework Foundation \
    -framework AppKit \
    -o ocr_mac \
    app/ocr_mac.mm
echo "Successfully built ocr_mac"
