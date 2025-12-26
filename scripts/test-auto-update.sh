#!/bin/bash
# NoChat Auto-Update Infrastructure Test Script
# Run this to verify the update system is working correctly

set -e

echo "========================================"
echo "NoChat Auto-Update Infrastructure Test"
echo "========================================"
echo ""

LATEST_JSON_URL="https://github.com/CatsMeow492/nochat.io/releases/latest/download/latest.json"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; exit 1; }
warn() { echo -e "${YELLOW}⚠ WARN${NC}: $1"; }

echo "1. Testing Update Endpoint Accessibility..."
if curl -sIL "$LATEST_JSON_URL" | grep -q "HTTP/2 200"; then
    pass "Update endpoint is accessible"
else
    fail "Cannot reach update endpoint"
fi

echo ""
echo "2. Fetching latest.json..."
LATEST_JSON=$(curl -sL "$LATEST_JSON_URL")
if [ -z "$LATEST_JSON" ]; then
    fail "Failed to fetch latest.json"
fi
pass "Successfully fetched latest.json"

echo ""
echo "3. Validating JSON structure..."
VERSION=$(echo "$LATEST_JSON" | jq -r '.version' 2>/dev/null)
if [ -z "$VERSION" ] || [ "$VERSION" = "null" ]; then
    fail "Missing or invalid version field"
fi
pass "Version: $VERSION"

echo ""
echo "4. Checking platform support..."
PLATFORMS=$(echo "$LATEST_JSON" | jq -r '.platforms | keys[]' 2>/dev/null)
EXPECTED_PLATFORMS=("darwin-aarch64" "darwin-x86_64" "windows-x86_64" "linux-x86_64")
for platform in "${EXPECTED_PLATFORMS[@]}"; do
    if echo "$PLATFORMS" | grep -q "$platform"; then
        pass "Platform supported: $platform"
    else
        warn "Platform missing: $platform"
    fi
done

echo ""
echo "5. Validating signatures..."
for platform in darwin-aarch64 windows-x86_64 linux-x86_64; do
    SIG=$(echo "$LATEST_JSON" | jq -r ".platforms.\"$platform\".signature" 2>/dev/null)
    if [ -z "$SIG" ] || [ "$SIG" = "null" ]; then
        warn "Missing signature for $platform"
        continue
    fi

    # Check signature format (should start with base64 of "untrusted comment:")
    if echo "$SIG" | grep -q "^dW50cnVzdGVk"; then
        # Check it doesn't contain CLI output text
        if echo "$SIG" | grep -q "Your file was signed"; then
            fail "Signature for $platform contains CLI output (malformed)"
        else
            pass "Signature valid for $platform (${#SIG} chars)"
        fi
    else
        fail "Signature for $platform has invalid format"
    fi
done

echo ""
echo "6. Checking download URLs..."
for platform in darwin-aarch64 windows-x86_64 linux-x86_64; do
    URL=$(echo "$LATEST_JSON" | jq -r ".platforms.\"$platform\".url" 2>/dev/null)
    if [ -z "$URL" ] || [ "$URL" = "null" ]; then
        warn "Missing URL for $platform"
        continue
    fi

    # Check URL is valid and returns 302 (GitHub redirect)
    HTTP_CODE=$(curl -sIL -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null | tail -1)
    if [ "$HTTP_CODE" = "200" ]; then
        pass "Download URL valid for $platform"
    else
        fail "Download URL returns $HTTP_CODE for $platform"
    fi
done

echo ""
echo "7. Checking macOS DMG signature file..."
DMG_SIG_URL="https://github.com/CatsMeow492/nochat.io/releases/download/desktop-v${VERSION}/NoChat_${VERSION}_universal.dmg.sig"
DMG_SIG=$(curl -sL "$DMG_SIG_URL" 2>/dev/null)
if echo "$DMG_SIG" | grep -q "^dW50cnVzdGVk"; then
    if echo "$DMG_SIG" | grep -q "Your file was signed"; then
        fail "DMG .sig file contains CLI output"
    else
        pass "DMG .sig file is correctly formatted"
    fi
else
    fail "DMG .sig file has invalid format or is missing"
fi

echo ""
echo "8. Verifying GitHub API returns expected version..."
API_VERSION=$(curl -s "https://api.github.com/repos/CatsMeow492/nochat.io/releases" | jq -r '[.[] | select(.tag_name | startswith("desktop-v"))] | sort_by(.tag_name | ltrimstr("desktop-v") | split(".") | map(tonumber)) | reverse | .[0].tag_name' 2>/dev/null)
if [ "$API_VERSION" = "desktop-v$VERSION" ]; then
    pass "GitHub API highest version matches: $API_VERSION"
else
    warn "GitHub API version mismatch: got $API_VERSION, expected desktop-v$VERSION"
fi

echo ""
echo "========================================"
echo "All tests passed! Auto-update infrastructure is healthy."
echo "========================================"
echo ""
echo "Current release: v$VERSION"
echo ""
echo "To test the full update flow:"
echo "1. Install an older version (e.g., v1.0.13)"
echo "2. Launch the app and wait 30 seconds"
echo "3. You should see an update notification"
echo ""
