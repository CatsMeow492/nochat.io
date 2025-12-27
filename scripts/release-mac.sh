#!/bin/bash
# NoChat Desktop - macOS Release Script
#
# This script builds, signs, notarizes, and prepares macOS releases.
#
# Prerequisites:
# - Apple Developer ID Application certificate in keychain
# - TAURI_PRIVATE_KEY environment variable set
# - xcrun notarytool credentials configured
#
# Usage:
#   ./scripts/release-mac.sh [version]
#
# Example:
#   ./scripts/release-mac.sh 1.0.0
#   ./scripts/release-mac.sh  # Uses version from Cargo.toml

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DESKTOP_DIR="$PROJECT_ROOT/packages/desktop"
TAURI_DIR="$DESKTOP_DIR/src-tauri"

# Get version from Cargo.toml if not provided
if [ -n "${1:-}" ]; then
    VERSION="$1"
else
    VERSION=$(grep '^version' "$TAURI_DIR/Cargo.toml" | head -1 | sed 's/.*= *"\([^"]*\)".*/\1/')
fi

log_info "Building NoChat Desktop v$VERSION for macOS..."

# Required environment variables
: "${APPLE_SIGNING_IDENTITY:?Environment variable APPLE_SIGNING_IDENTITY is required}"
: "${APPLE_ID:?Environment variable APPLE_ID is required}"
: "${APPLE_PASSWORD:?Environment variable APPLE_PASSWORD is required (app-specific password)}"
: "${APPLE_TEAM_ID:?Environment variable APPLE_TEAM_ID is required}"
: "${TAURI_PRIVATE_KEY:?Environment variable TAURI_PRIVATE_KEY is required}"

# Verify signing identity exists
log_info "Verifying signing identity..."
if ! security find-identity -v -p codesigning | grep -q "$APPLE_SIGNING_IDENTITY"; then
    log_error "Signing identity '$APPLE_SIGNING_IDENTITY' not found in keychain"
fi
log_success "Signing identity found"

# Build the app
log_info "Building universal binary (arm64 + x86_64)..."
cd "$DESKTOP_DIR"

# Install frontend dependencies and build
npm install
npm run build:frontend

# Build Tauri for both architectures
cargo tauri build --target universal-apple-darwin

# Find built artifacts
APP_BUNDLE="$TAURI_DIR/target/universal-apple-darwin/release/bundle/macos/NoChat.app"
DMG_DIR="$TAURI_DIR/target/universal-apple-darwin/release/bundle/dmg"

if [ ! -d "$APP_BUNDLE" ]; then
    log_error "App bundle not found at $APP_BUNDLE"
fi

log_success "Build completed"

# Sign the app bundle
log_info "Signing app bundle with hardened runtime..."
codesign --deep --force --verify --verbose \
    --sign "$APPLE_SIGNING_IDENTITY" \
    --options runtime \
    --entitlements "$TAURI_DIR/entitlements.plist" \
    "$APP_BUNDLE"

# Verify signature
log_info "Verifying signature..."
codesign --verify --verbose=2 "$APP_BUNDLE"
spctl --assess --verbose=2 "$APP_BUNDLE" || {
    log_warning "spctl assessment failed - this is expected before notarization"
}

log_success "Code signing completed"

# Find or create DMG
DMG_PATH=$(find "$DMG_DIR" -name "*.dmg" -type f 2>/dev/null | head -1)

if [ -z "$DMG_PATH" ]; then
    log_info "Creating DMG..."
    # DMG should have been created by Tauri build
    log_error "DMG not found. Tauri should have created it during build."
fi

DMG_NAME="NoChat_${VERSION}_universal.dmg"
FINAL_DMG="$DMG_DIR/$DMG_NAME"

if [ "$DMG_PATH" != "$FINAL_DMG" ]; then
    mv "$DMG_PATH" "$FINAL_DMG"
fi

# Sign DMG
log_info "Signing DMG..."
codesign --sign "$APPLE_SIGNING_IDENTITY" --options runtime "$FINAL_DMG"

log_success "DMG signed"

# Notarize
log_info "Submitting to Apple for notarization..."
log_info "This may take several minutes..."

NOTARIZE_OUTPUT=$(xcrun notarytool submit "$FINAL_DMG" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait 2>&1)

echo "$NOTARIZE_OUTPUT"

if ! echo "$NOTARIZE_OUTPUT" | grep -q "status: Accepted"; then
    log_error "Notarization failed. Check the output above for details."
fi

log_success "Notarization accepted"

# Staple notarization ticket
log_info "Stapling notarization ticket..."
xcrun stapler staple "$FINAL_DMG"

# Verify stapling
xcrun stapler validate "$FINAL_DMG"
log_success "Notarization ticket stapled"

# Sign for Tauri updater
log_info "Signing for Tauri auto-updater..."
SIGNATURE=$(echo "$TAURI_PRIVATE_KEY" | cargo tauri signer sign --private-key-stdin "$FINAL_DMG" 2>&1)
echo "$SIGNATURE" > "${FINAL_DMG}.sig"

log_success "Updater signature created"

# Final verification
log_info "Final verification..."
spctl --assess --verbose=2 "$FINAL_DMG"
log_success "Gatekeeper verification passed"

# Summary
echo ""
log_success "macOS release build completed successfully!"
echo ""
echo "Artifacts:"
echo "  DMG: $FINAL_DMG"
echo "  Signature: ${FINAL_DMG}.sig"
echo ""
echo "Upload these files to your release server or GitHub Releases."
