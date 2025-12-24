# NoChat Desktop Release Setup

This document explains how to set up automated builds for the desktop application.

## GitHub Secrets Required

Go to your GitHub repository → Settings → Secrets and variables → Actions, and add the following secrets:

### Required for macOS Code Signing & Notarization

1. **APPLE_CERTIFICATE**
   - Your Developer ID Application certificate exported as a .p12 file, then base64 encoded
   - To export:
     1. Open Keychain Access
     2. Find "Developer ID Application: TAYLOR EDWARD,CLARK MOHNEY (5CA5T4YZ48)"
     3. Right-click → Export → Save as .p12 with a password
     4. Encode: `base64 -i certificate.p12 | pbcopy` (copies to clipboard)

2. **APPLE_CERTIFICATE_PASSWORD**
   - The password you set when exporting the .p12 file

3. **APPLE_SIGNING_IDENTITY**
   - Value: `Developer ID Application: TAYLOR EDWARD,CLARK MOHNEY (5CA5T4YZ48)`

4. **APPLE_ID**
   - Value: `taylormohney@icloud.com`

5. **APPLE_PASSWORD**
   - Your app-specific password (generate at appleid.apple.com)
   - Current: `drgr-zvur-fksb-txbk`

6. **APPLE_TEAM_ID**
   - Value: `5CA5T4YZ48`

### Required for Tauri Updater (Auto-Updates)

7. **TAURI_PRIVATE_KEY**
   - Value (already generated):
   ```
   dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5ClJXUlRZMEl5RUJybDIwbDNpeEVCVmJkQzFtdGY0ZCs5RTVhcUZlRUpia1pOcGFycVkrd0FBQkFBQUFBQUFBQUFBQUlBQUFBQWJPUUlVZTJYMjVPNW1rdTBhMS9wNEpiQUIrVy9ua3Q5OEZudllUQkhJaHJncWJpR3V6M0lZZGh3UDNvMWRWZzZrZ0RUbW4rNmtPZ2FPTk4rYWh1LzM1bDFBMCt1RnpOOG1SWWNBU1RUcUlnOUVibFBzL24ybTZqd1ZkUE8wbmpRaGRXY3p6WVp6RzA9Cg==
   ```
   - Backup stored at: `~/.tauri/nochat.key`

The public key is already configured in `packages/desktop/src-tauri/tauri.conf.json`.

### Optional: Windows Code Signing (Azure Key Vault)

8. **AZURE_KEY_VAULT_URL** - Azure Key Vault URL
9. **AZURE_CLIENT_ID** - Azure Service Principal client ID
10. **AZURE_CLIENT_SECRET** - Azure Service Principal secret
11. **AZURE_CERT_NAME** - Certificate name in Key Vault

## Triggering a Release

### Option 1: Push a Tag
```bash
git tag desktop-v1.0.1
git push origin desktop-v1.0.1
```

### Option 2: Manual Workflow Dispatch
1. Go to GitHub Actions
2. Select "Desktop Release" workflow
3. Click "Run workflow"
4. Enter the version number (e.g., `1.0.1`)

## Build Outputs

The workflow produces:
- **macOS**: `NoChat_{version}_universal.dmg` (signed + notarized)
- **Windows**: `NoChat_{version}_x64-setup.exe`
- **Linux**: `NoChat_{version}_amd64.AppImage`

All artifacts are uploaded to GitHub Releases automatically.

## Frontend Download Links

The landing page at `packages/web/src/app/page.tsx` automatically fetches the latest release from GitHub and displays platform-specific download buttons.

The download component (`packages/web/src/components/download-buttons.tsx`):
- Fetches releases from GitHub API
- Detects user's platform (macOS/Windows/Linux)
- Shows primary download button for user's platform
- Shows secondary links for other platforms
- Displays version number and file size
