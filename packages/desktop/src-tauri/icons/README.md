# App Icons

This folder contains the application icons for NoChat Desktop.

## Source File

The source icon is `icon.svg` (copied from `packages/web/resources/icon.svg`).

## Generating Icons

To generate all required icon formats from the SVG source, use Tauri's icon generator:

```bash
# From the packages/desktop directory
npx @tauri-apps/cli icon src-tauri/icons/icon.svg
```

This will generate:
- `32x32.png` - Small icon
- `128x128.png` - Medium icon
- `128x128@2x.png` - Medium icon (Retina)
- `icon.icns` - macOS app icon
- `icon.ico` - Windows app icon
- `icon.png` - Linux icon

## Manual Generation

If the Tauri CLI icon generator doesn't work, you can manually generate icons using:

### Using ImageMagick

```bash
# Install ImageMagick if not already installed
# macOS: brew install imagemagick
# Ubuntu: sudo apt install imagemagick

# Generate PNG files
convert -background none -resize 32x32 icon.svg 32x32.png
convert -background none -resize 128x128 icon.svg 128x128.png
convert -background none -resize 256x256 icon.svg 128x128@2x.png
convert -background none -resize 1024x1024 icon.svg icon.png

# Generate ICO (Windows)
convert icon.svg -define icon:auto-resize=256,128,64,48,32,16 icon.ico

# Generate ICNS (macOS) - requires iconutil on macOS
mkdir icon.iconset
sips -z 16 16 icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32 icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32 icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64 icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128 icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256 icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256 icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512 icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512 icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset
rm -rf icon.iconset
```

## Required Files

Before building, ensure these files exist:
- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.icns` (for macOS)
- `icon.ico` (for Windows)
- `icon.png` (for Linux)
