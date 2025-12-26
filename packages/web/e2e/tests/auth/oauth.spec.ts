import { test, expect } from "../../fixtures/auth.fixture";

/**
 * OAuth Authentication Tests
 *
 * NOTE: Full OAuth flow tests require either:
 * 1. Mock OAuth provider responses
 * 2. Test credentials for sandbox OAuth apps
 * 3. A custom test OAuth provider
 *
 * For now, we test the OAuth callback page logic and UI elements.
 */
test.describe("OAuth Authentication", () => {
  test.describe("OAuth Buttons", () => {
    test("displays all OAuth provider buttons", async ({ page }) => {
      await page.goto("/signin");

      // Check for OAuth buttons (they have sr-only text)
      await expect(
        page.getByRole("button", { name: /google/i })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /github/i })
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /apple/i })).toBeVisible();
      await expect(
        page.getByRole("button", { name: /facebook/i })
      ).toBeVisible();
    });
  });

  test.describe("OAuth Callback Page", () => {
    test("handles missing token in callback", async ({ page }) => {
      // Navigate to callback without token
      await page.goto("/oauth/callback");

      // Should show error state
      await expect(page.getByText(/sign in failed/i)).toBeVisible({
        timeout: 10000,
      });

      // Should have retry button
      await expect(
        page.getByRole("button", { name: /try again/i })
      ).toBeVisible();

      // Should have go home button
      await expect(
        page.getByRole("button", { name: /go home/i })
      ).toBeVisible();
    });

    test("handles error parameter in callback", async ({ page }) => {
      // Navigate to callback with error
      await page.goto("/oauth/callback?error=access_denied");

      // Should show error message
      await expect(page.getByText(/sign in failed/i)).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText(/access_denied/i)).toBeVisible();
    });

    test("handles invalid token in callback", async ({ page }) => {
      // Navigate to callback with invalid token
      await page.goto("/oauth/callback?token=invalid-test-token");

      // Should eventually show error (token validation fails)
      // Note: Loading state "Signing you in..." is transient and may not be visible
      await expect(page.getByText(/sign in failed/i)).toBeVisible({
        timeout: 15000,
      });

      // Should have retry button
      await expect(
        page.getByRole("button", { name: /try again/i })
      ).toBeVisible();
    });

    test("try again button navigates to signin", async ({ page }) => {
      await page.goto("/oauth/callback?error=access_denied");

      // Wait for error state
      await expect(page.getByText(/sign in failed/i)).toBeVisible({
        timeout: 10000,
      });

      // Click try again
      await page.getByRole("button", { name: /try again/i }).click();

      // Should navigate to signin
      await expect(page).toHaveURL("/signin");
    });

    test("go home button navigates to landing", async ({ page }) => {
      await page.goto("/oauth/callback?error=access_denied");

      // Wait for error state
      await expect(page.getByText(/sign in failed/i)).toBeVisible({
        timeout: 10000,
      });

      // Click go home
      await page.getByRole("button", { name: /go home/i }).click();

      // Should navigate to home
      await expect(page).toHaveURL("/");
    });
  });

  // TODO: Full OAuth flow tests
  // These would require:
  // 1. Sandbox OAuth app credentials
  // 2. Test accounts for each provider
  // 3. Potentially mocking the OAuth redirect
  test.describe.skip("Google OAuth Flow", () => {
    test("initiates Google OAuth flow", async ({ page }) => {
      await page.goto("/signin");
      await page.getByRole("button", { name: /google/i }).click();
      // Would verify redirect to Google OAuth
    });
  });

  test.describe.skip("GitHub OAuth Flow", () => {
    test("initiates GitHub OAuth flow", async ({ page }) => {
      await page.goto("/signin");
      await page.getByRole("button", { name: /github/i }).click();
      // Would verify redirect to GitHub OAuth
    });
  });
});
