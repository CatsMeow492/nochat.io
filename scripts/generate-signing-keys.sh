#!/bin/bash
# NoChat Desktop - Generate Tauri Signing Keys
#
# This script generates the key pair used for signing auto-updates.
# The private key MUST be kept secret and stored in CI secrets.
# The public key is embedded in tauri.conf.json.
#
# Usage:
#   ./scripts/generate-signing-keys.sh [output-dir]

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Output directory
OUTPUT_DIR="${1:-$HOME/.tauri}"
mkdir -p "$OUTPUT_DIR"

PRIVATE_KEY_PATH="$OUTPUT_DIR/nochat.key"
PUBLIC_KEY_PATH="$OUTPUT_DIR/nochat.key.pub"

# Check if keys already exist
if [ -f "$PRIVATE_KEY_PATH" ]; then
    log_warning "Private key already exists at $PRIVATE_KEY_PATH"
    read -p "Overwrite? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Keeping existing keys"
        exit 0
    fi
fi

# Check if cargo-tauri is installed
if ! command -v cargo-tauri &> /dev/null; then
    log_info "Installing tauri-cli..."
    cargo install tauri-cli
fi

log_info "Generating signing key pair..."

# Generate keys using tauri signer
# The password can be empty for CI usage, or set for extra security
OUTPUT=$(cargo tauri signer generate -w "$PRIVATE_KEY_PATH" 2>&1)

# Extract public key from output
PUBLIC_KEY=$(echo "$OUTPUT" | grep -A1 "Public key" | tail -1 | tr -d ' ')

if [ -z "$PUBLIC_KEY" ]; then
    log_error "Failed to extract public key from output"
fi

# Save public key
echo "$PUBLIC_KEY" > "$PUBLIC_KEY_PATH"

# Set restrictive permissions on private key
chmod 600 "$PRIVATE_KEY_PATH"

log_success "Keys generated successfully!"
echo ""
echo "Private Key: $PRIVATE_KEY_PATH"
echo "Public Key:  $PUBLIC_KEY_PATH"
echo ""
echo "Public Key (for tauri.conf.json):"
echo "  $PUBLIC_KEY"
echo ""

log_warning "IMPORTANT SECURITY INSTRUCTIONS:"
echo ""
echo "1. Add the PUBLIC KEY to tauri.conf.json:"
echo ""
echo "   \"plugins\": {"
echo "     \"updater\": {"
echo "       \"pubkey\": \"$PUBLIC_KEY\","
echo "       ..."
echo "     }"
echo "   }"
echo ""
echo "2. Store the PRIVATE KEY in GitHub Secrets as TAURI_PRIVATE_KEY"
echo "   - Go to: Repository Settings > Secrets and variables > Actions"
echo "   - Create secret: TAURI_PRIVATE_KEY"
echo "   - Paste the contents of: $PRIVATE_KEY_PATH"
echo ""
echo "3. NEVER commit the private key to version control!"
echo "   - Add to .gitignore: ~/.tauri/"
echo ""
echo "4. Keep a secure backup of the private key."
echo "   - If lost, you'll need to generate new keys and update all clients."
echo ""
