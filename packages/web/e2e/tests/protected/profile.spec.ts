import { test, expect } from "../../fixtures/auth.fixture";
import { TEST_USERS } from "../../fixtures/test-users";

/**
 * Profile Page Access Tests
 *
 * These tests are critical because they verify the race condition fix
 * where the profile page could show infinite loading or incorrectly
 * redirect to signin when the user was actually authenticated.
 *
 * The fix: Profile page now checks for `token` presence instead of
 * waiting for `isAuthVerified` (which requires /me API to complete).
 */
test.describe("Profile Page Access", () => {
  test.describe("Unauthenticated user", () => {
    test("redirects to signin page", async ({ page }) => {
      // Ensure no auth state
      await page.goto("/");
      await page.evaluate(() => {
        localStorage.clear();
      });
      // Reload to ensure Zustand picks up the cleared state
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Direct navigation to profile without auth
      await page.goto("/profile");

      // Should redirect to signin
      await expect(page).toHaveURL("/signin", { timeout: 10000 });
    });
  });

  test.describe("Authenticated user", () => {
    test("can access profile page after login", async ({
      page,
      loginAsUser,
    }) => {
      // Login first
      await loginAsUser(TEST_USERS.standard.email, TEST_USERS.standard.password);

      // Navigate to profile
      await page.goto("/profile");

      // Should stay on profile page (not redirect)
      await expect(page).toHaveURL("/profile");

      // Profile content should be visible
      await expect(
        page.getByText("Profile Photo", { exact: true })
      ).toBeVisible({ timeout: 10000 });
      await expect(page.getByLabel("Display Name")).toBeVisible();
    });

    /**
     * CRITICAL TEST: Race condition regression test
     *
     * This test catches the bug where profile page would show infinite
     * loading spinner because it waited for isAuthVerified (which requires
     * /me API to complete) before loading profile data.
     *
     * The fix: Use token presence to trigger profile loading, not isAuthVerified.
     */
    test("profile page loads correctly on direct navigation after auth", async ({
      page,
    }) => {
      // Login via UI
      await page.goto("/signin");
      await page.getByLabel("Email").fill(TEST_USERS.standard.email);
      await page.getByLabel("Password").fill(TEST_USERS.standard.password);
      await page.getByRole("button", { name: "Sign In", exact: true }).click();

      // Wait for login to complete
      await page.waitForURL(/\/chat/, { timeout: 15000 });

      // Now directly navigate to profile
      await page.goto("/profile");

      // CRITICAL ASSERTIONS:
      // 1. Profile should NOT show infinite loading spinner
      // 2. Profile should NOT redirect to signin
      // 3. Profile content should be visible within reasonable time

      await expect(
        page.getByText("Profile Photo", { exact: true })
      ).toBeVisible({ timeout: 15000 });

      // Verify we're still on profile
      expect(page.url()).toContain("/profile");
    });

    /**
     * Test that profile persists across page reload
     */
    test("profile page works after page reload", async ({
      page,
      loginAsUser,
    }) => {
      await loginAsUser(TEST_USERS.standard.email, TEST_USERS.standard.password);

      // Go to profile
      await page.goto("/profile");
      await expect(
        page.getByText("Profile Photo", { exact: true })
      ).toBeVisible({ timeout: 15000 });

      // Reload the page (simulates fresh page load with token in localStorage)
      await page.reload();

      // Should still work after reload
      await expect(
        page.getByText("Profile Photo", { exact: true })
      ).toBeVisible({ timeout: 15000 });

      // Should NOT redirect to signin
      expect(page.url()).toContain("/profile");
    });

    /**
     * Test quick navigation from login to profile
     * This is where race conditions are most likely to occur
     */
    test("immediate navigation to profile after login works", async ({
      page,
    }) => {
      await page.goto("/signin");
      await page.getByLabel("Email").fill(TEST_USERS.standard.email);
      await page.getByLabel("Password").fill(TEST_USERS.standard.password);

      // Start navigation to profile immediately after clicking sign in
      // Use Promise.all to simulate rapid navigation
      await Promise.all([
        page.getByRole("button", { name: "Sign In", exact: true }).click(),
        page.waitForURL(/\/chat/, { timeout: 15000 }),
      ]);

      // Immediately navigate to profile
      await page.goto("/profile");

      // Profile should load correctly
      await expect(
        page.getByText("Profile Photo", { exact: true })
      ).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe("Session expiration", () => {
    test("expired token clears auth state", async ({
      page,
      loginAsUser,
    }) => {
      await loginAsUser(TEST_USERS.standard.email, TEST_USERS.standard.password);

      // Navigate to profile first to establish we're authenticated
      await page.goto("/profile");
      await expect(
        page.getByText("Profile Photo", { exact: true })
      ).toBeVisible({ timeout: 15000 });

      // Corrupt the token to simulate expiration
      await page.evaluate(() => {
        localStorage.setItem("token", "invalid-expired-token");
      });

      // Reload to force the app to use the invalid token
      await page.reload();

      // Wait for the page to attempt to load
      // The API will return 401, which should clear the token
      await page.waitForTimeout(3000);

      // After API rejection, token should be cleared from localStorage
      const tokenAfterError = await page.evaluate(() => localStorage.getItem("token"));
      expect(tokenAfterError).toBeFalsy();

      // Now navigating to a protected route should redirect to signin
      await page.goto("/profile");
      await expect(page).toHaveURL(/\/signin/, { timeout: 10000 });
    });
  });

  test.describe("Profile form elements", () => {
    test("profile form has expected fields", async ({
      page,
      loginAsUser,
    }) => {
      await loginAsUser(TEST_USERS.standard.email, TEST_USERS.standard.password);
      await page.goto("/profile");

      // Wait for profile to load
      await expect(
        page.getByText("Profile Photo", { exact: true })
      ).toBeVisible({ timeout: 15000 });

      // Check for expected form fields
      await expect(page.getByLabel("Display Name")).toBeVisible();
      await expect(page.getByLabel("Bio")).toBeVisible();
      await expect(page.getByLabel("Job Title")).toBeVisible();
      await expect(page.getByLabel("Location")).toBeVisible();
    });

    test("back button navigates away from profile", async ({
      page,
      loginAsUser,
    }) => {
      await loginAsUser(TEST_USERS.standard.email, TEST_USERS.standard.password);

      // Navigate to profile from chat
      await page.goto("/chat");
      await page.goto("/profile");

      // Wait for profile to load
      await expect(
        page.getByText("Profile Photo", { exact: true })
      ).toBeVisible({ timeout: 15000 });

      // Click back button
      await page.getByRole("button", { name: "Back" }).click();

      // Should navigate away from profile
      await expect(page).not.toHaveURL("/profile");
    });
  });
});
