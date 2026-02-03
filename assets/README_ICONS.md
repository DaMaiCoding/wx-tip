# Application Icons

This directory contains the icons used for the application packaging.

## Requirements

To ensure the application looks professional on all platforms, please provide the following files:

### Windows
- **File**: `icon.ico`
- **Requirements**: Multi-size ICO containing 256x256, 128x128, 64x64, 48x48, 32x32, 16x16 sizes.
- **Current Status**: A basic `icon.ico` has been generated from `icon.png` for testing. For production, please replace it with a properly generated multi-size ICO file.

### macOS
- **File**: `icon.icns`
- **Requirements**: Apple Icon Image format containing sizes from 16x16 up to 1024x1024 (Retina).
- **Current Status**: Missing. Required only for macOS builds.

### Linux
- **File**: `icon.png`
- **Requirements**: High-resolution PNG (at least 512x512).
- **Current Status**: Present.

## Tools to Generate Icons
You can use online converters (e.g., icoconvert.com, cloudconvert.com) or tools like `ImageMagick` to generate these files from a high-quality source image (1024x1024 PNG recommended).
