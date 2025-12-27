# NoChat Auto-Update Testing Guide

This guide covers how to thoroughly test the desktop app auto-update system.

## Prerequisites

- macOS with the NoChat desktop app installed
- Access to GitHub releases
- Terminal access for logs

## Test Matrix

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Update Detection | App detects newer version available | Notification appears within 30s of launch |
| Version Comparison | Correctly identifies newer vs older | Only shows update for higher versions |
| Signature Verification | Validates update authenticity | Rejects tampered/unsigned updates |
| Download Progress | Shows download status | Progress bar updates during download |
| Installation | Installs update successfully | App ready to restart after install |
| Restart Flow | App restarts with new version | New version running after restart |
| Rollback Protection | Rejects downgrade attempts | No notification for older versions |

## Testing Methods

### Method 1: Install Older Version and Wait

1. **Download an older release** (e.g., v1.0.13):
   ```bash
   # Download v1.0.13
   curl -L "https://github.com/kindlyrobotics/nochat/releases/download/desktop-v1.0.13/NoChat_1.0.13_universal.dmg" -o NoChat_old.dmg
   ```

2. **Install the older version**:
   - Open the DMG
   - Drag to Applications (replace existing if needed)
   - Launch NoChat

3. **Wait for update check** (30 seconds after launch)

4. **Expected**: Blue banner appears saying "NoChat v1.0.15 is available!"

5. **Click "Install Now"** and verify:
   - Download progress bar appears
   - After download, green banner says "Update installed! Restart..."
   - After restart, app is on v1.0.15

### Method 2: Check Logs in Real-Time

1. **Open Terminal and tail the app logs**:
   ```bash
   # Find the log file location
   ls ~/Library/Logs/io.nochat.desktop/

   # Tail the logs
   tail -f ~/Library/Logs/io.nochat.desktop/*.log
   ```

2. **Launch the app** and watch for:
   ```
   INFO: Checking for updates...
   INFO: Update available: 1.0.13 -> 1.0.15
   ```

3. **If no update found**, you'll see:
   ```
   INFO: No updates available
   ```

### Method 3: Manual Update Check via Console

1. **Open the app** and navigate to any page

2. **Open Developer Tools** (Cmd+Option+I or View > Toggle Developer Tools)

3. **In Console, check for update events**:
   ```javascript
   // The app emits events when updates are found
   // Look for: "update-available" event in console logs
   ```

### Method 4: Build a Test Version Locally

For development testing with custom version numbers:

1. **Modify version to simulate old version**:
   ```bash
   cd packages/desktop/src-tauri

   # Edit tauri.conf.json - set version to something old like "1.0.0"
   # Edit Cargo.toml - set version to "1.0.0"
   ```

2. **Build locally**:
   ```bash
   cd packages/desktop
   npm run build:frontend
   npx tauri build --bundles app
   ```

3. **Run the built app**:
   ```bash
   open target/release/bundle/macos/NoChat.app
   ```

4. **The app should detect v1.0.15 as an available update**

### Method 5: Verify Update Endpoint Directly

```bash
# Check the latest.json is accessible and well-formed
curl -sL "https://github.com/kindlyrobotics/nochat/releases/latest/download/latest.json" | jq .

# Verify signature format (should be base64, no CLI output text)
curl -sL "https://github.com/kindlyrobotics/nochat/releases/latest/download/latest.json" | jq -r '.platforms."darwin-aarch64".signature' | head -c 100
# Should start with: dW50cnVzdGVkIGNvbW1lbnQ6

# Check that DMG is downloadable
curl -sIL "https://github.com/kindlyrobotics/nochat/releases/download/desktop-v1.0.15/NoChat_1.0.15_universal.dmg" | grep "HTTP/"
# Should show: HTTP/2 200
```

## Automated E2E Test (Future)

Add to `packages/desktop/tests/updater.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Auto-Updater', () => {
  test('should show update notification when newer version available', async ({ page }) => {
    // Mock the update endpoint to return a newer version
    await page.route('**/releases/latest/download/latest.json', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: '99.0.0',
          notes: 'Test update',
          pub_date: new Date().toISOString(),
          platforms: {
            'darwin-aarch64': {
              signature: 'test-sig',
              url: 'https://example.com/test.dmg'
            }
          }
        })
      });
    });

    // Wait for update check (or trigger manually)
    await page.waitForTimeout(35000);

    // Verify update banner appears
    await expect(page.locator('text=is available!')).toBeVisible();
  });

  test('should not show update for same/older version', async ({ page }) => {
    // Mock endpoint to return same version
    await page.route('**/releases/latest/download/latest.json', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: '1.0.0', // Same or older
          notes: 'Old version',
          pub_date: new Date().toISOString(),
          platforms: {}
        })
      });
    });

    await page.waitForTimeout(35000);

    // Verify NO update banner
    await expect(page.locator('text=is available!')).not.toBeVisible();
  });
});
```

## Troubleshooting

### Update not showing?

1. **Check version**: Ensure installed version < latest release version
2. **Check network**: Ensure GitHub is accessible
3. **Check logs**: Look for errors in `~/Library/Logs/io.nochat.desktop/`
4. **Wait long enough**: Initial check happens 30s after launch

### Signature verification failed?

1. **Check signature format**: Should be pure base64, no CLI text
2. **Check public key**: Must match the key in tauri.conf.json
3. **Check release**: Ensure .sig files were uploaded correctly

### Download stuck?

1. **Check network connection**
2. **Check disk space**
3. **Try restarting the app**

## Release Checklist for Updates

Before releasing a new version, verify:

- [ ] Version bumped in `tauri.conf.json`
- [ ] Version bumped in `Cargo.toml`
- [ ] Tag pushed: `git tag desktop-vX.Y.Z && git push origin desktop-vX.Y.Z`
- [ ] GitHub Actions workflow completed successfully
- [ ] `latest.json` has correct version and clean signatures
- [ ] All platform assets uploaded (.dmg, .exe, .AppImage)
- [ ] All signature files uploaded (.sig files)
