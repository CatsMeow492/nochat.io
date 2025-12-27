# NoChat Desktop - Windows Release Script
#
# This script builds, signs, and prepares Windows releases.
#
# Prerequisites:
# - Azure Key Vault with code signing certificate (for EV signing)
# - OR local OV certificate with signtool
# - TAURI_PRIVATE_KEY environment variable set
# - AzureSignTool installed (dotnet tool install --global AzureSignTool)
#
# Usage:
#   .\scripts\release-win.ps1 [-Version "1.0.0"]

param(
    [Parameter(Mandatory=$false)]
    [string]$Version
)

$ErrorActionPreference = "Stop"

# Colors
function Write-Info { Write-Host "[INFO] $args" -ForegroundColor Blue }
function Write-Success { Write-Host "[SUCCESS] $args" -ForegroundColor Green }
function Write-Warn { Write-Host "[WARNING] $args" -ForegroundColor Yellow }
function Write-Err { Write-Host "[ERROR] $args" -ForegroundColor Red; exit 1 }

# Paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$DesktopDir = Join-Path $ProjectRoot "packages\desktop"
$TauriDir = Join-Path $DesktopDir "src-tauri"

# Get version from Cargo.toml if not provided
if (-not $Version) {
    $CargoToml = Get-Content (Join-Path $TauriDir "Cargo.toml") -Raw
    if ($CargoToml -match 'version\s*=\s*"([^"]+)"') {
        $Version = $Matches[1]
    } else {
        Write-Err "Could not determine version from Cargo.toml"
    }
}

Write-Info "Building NoChat Desktop v$Version for Windows..."

# Check required environment variables
$RequiredEnvVars = @{
    "TAURI_PRIVATE_KEY" = "Tauri updater private key"
}

# Azure signing (preferred for EV certificates)
$UseAzure = $false
if ($env:AZURE_KEY_VAULT_URL) {
    $RequiredAzureVars = @{
        "AZURE_KEY_VAULT_URL" = "Azure Key Vault URL"
        "AZURE_CLIENT_ID" = "Azure Service Principal Client ID"
        "AZURE_CLIENT_SECRET" = "Azure Service Principal Client Secret"
        "AZURE_CERT_NAME" = "Certificate name in Key Vault"
    }

    $MissingAzure = $false
    foreach ($var in $RequiredAzureVars.Keys) {
        if (-not [Environment]::GetEnvironmentVariable($var)) {
            Write-Warn "Missing $var for Azure signing"
            $MissingAzure = $true
        }
    }

    if (-not $MissingAzure) {
        $UseAzure = $true
        Write-Info "Using Azure Key Vault for code signing"
    }
}

# Local signing fallback
$UseLocal = $false
if (-not $UseAzure -and $env:WINDOWS_CERT_PATH) {
    if (Test-Path $env:WINDOWS_CERT_PATH) {
        $UseLocal = $true
        Write-Info "Using local certificate for code signing"
    }
}

if (-not $UseAzure -and -not $UseLocal) {
    Write-Warn "No code signing configured. The installer will show SmartScreen warnings."
    Write-Warn "Set AZURE_KEY_VAULT_URL or WINDOWS_CERT_PATH to enable signing."
}

# Verify Tauri private key
if (-not $env:TAURI_PRIVATE_KEY) {
    Write-Err "TAURI_PRIVATE_KEY environment variable is required for auto-updater signing"
}

# Build
Write-Info "Installing frontend dependencies..."
Set-Location $DesktopDir
npm install

Write-Info "Building frontend..."
npm run build:frontend

Write-Info "Building Tauri application..."
cargo tauri build

# Find installer
$BundleDir = Join-Path $TauriDir "target\release\bundle"
$NsisDir = Join-Path $BundleDir "nsis"
$Installer = Get-ChildItem -Path $NsisDir -Filter "*.exe" | Select-Object -First 1

if (-not $Installer) {
    Write-Err "Installer not found in $NsisDir"
}

$InstallerPath = $Installer.FullName
Write-Success "Build completed: $InstallerPath"

# Code signing
if ($UseAzure) {
    Write-Info "Signing with Azure Key Vault..."

    # Check if AzureSignTool is installed
    if (-not (Get-Command AzureSignTool -ErrorAction SilentlyContinue)) {
        Write-Info "Installing AzureSignTool..."
        dotnet tool install --global AzureSignTool
    }

    AzureSignTool sign `
        --azure-key-vault-url $env:AZURE_KEY_VAULT_URL `
        --azure-key-vault-client-id $env:AZURE_CLIENT_ID `
        --azure-key-vault-client-secret $env:AZURE_CLIENT_SECRET `
        --azure-key-vault-certificate $env:AZURE_CERT_NAME `
        --timestamp-rfc3161 "http://timestamp.digicert.com" `
        --description "NoChat Desktop" `
        --description-url "https://nochat.io" `
        $InstallerPath

    Write-Success "Azure signing completed"
}
elseif ($UseLocal) {
    Write-Info "Signing with local certificate..."

    $SignArgs = @(
        "sign",
        "/f", $env:WINDOWS_CERT_PATH,
        "/t", "http://timestamp.digicert.com",
        "/d", "NoChat Desktop",
        "/du", "https://nochat.io"
    )

    if ($env:WINDOWS_CERT_PASSWORD) {
        $SignArgs += "/p", $env:WINDOWS_CERT_PASSWORD
    }

    $SignArgs += $InstallerPath

    & signtool @SignArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Signtool failed with exit code $LASTEXITCODE"
    }

    Write-Success "Local signing completed"
}

# Verify signature
if ($UseAzure -or $UseLocal) {
    Write-Info "Verifying signature..."
    & signtool verify /pa $InstallerPath
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Signature verification returned non-zero exit code"
    } else {
        Write-Success "Signature verified"
    }
}

# Sign for Tauri updater
Write-Info "Signing for Tauri auto-updater..."

$SignatureOutput = & cargo tauri signer sign --private-key $env:TAURI_PRIVATE_KEY $InstallerPath 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Err "Tauri signer failed: $SignatureOutput"
}

$SignaturePath = "$InstallerPath.sig"
$SignatureOutput | Out-File -FilePath $SignaturePath -Encoding utf8 -NoNewline

Write-Success "Updater signature created"

# Rename with version
$FinalName = "NoChat_${Version}_x64-setup.exe"
$FinalPath = Join-Path (Split-Path $InstallerPath) $FinalName
if ($InstallerPath -ne $FinalPath) {
    Move-Item -Force $InstallerPath $FinalPath
    Move-Item -Force $SignaturePath "$FinalPath.sig"
    $InstallerPath = $FinalPath
    $SignaturePath = "$FinalPath.sig"
}

# Summary
Write-Host ""
Write-Success "Windows release build completed successfully!"
Write-Host ""
Write-Host "Artifacts:"
Write-Host "  Installer: $InstallerPath"
Write-Host "  Signature: $SignaturePath"
Write-Host ""
Write-Host "Upload these files to your release server or GitHub Releases."
