import { test, expect } from "../../fixtures/auth.fixture";
import { TEST_USERS } from "../../fixtures/test-users";

/**
 * Session Persistence Tests
 *
 * Verifies that:
 * 1. Auth session persists across page reloads
 * 2. Logout properly clears session
 * 3. Zustand auth store hydrates correctly
 * 4. Token is properly stored and retrieved
 */
test.describe("Session Persistence", () => {
  test.describe("Page reload persistence", () => {
    test("session persists across page reloads", async ({
      page,
      loginAsUser,
    }) => {
      await loginAsUser(
        TEST_USERS.standard.email,
        TEST_USERS.standard.password
      );

      // Verify we're on chat
      await expect(page).toHaveURL(/\/chat/);

      // Get the token before reload
      const tokenBefore = await page.evaluate(() =>
        localStorage.getItem("token")
      );
      expect(tokenBefore).toBeTruthy();

      // Reload the page
      await page.reload();

      // Should still be authenticated and on chat
      await expect(page).toHaveURL(/\/chat/, { timeout: 15000 });

      // Token should still be in localStorage
      const tokenAfter = await page.evaluate(() =>
        localStorage.getItem("token")
      );
      expect(tokenAfter).toBeTruthy();
      expect(tokenAfter).toBe(tokenBefore);
    });

    test("can access protected routes after reload", async ({
      page,
      loginAsUser,
    }) => {
      await loginAsUser(
        TEST_USERS.standard.email,
        TEST_USERS.standard.password
      );

      // Navigate to profile
      await page.goto("/profile");
      await expect(
        page.getByText("Profile Photo", { exact: true })
      ).toBeVisible({ timeout: 15000 });

      // Reload
      await page.reload();

      // Should still have access to profile
      await expect(
        page.getByText("Profile Photo", { exact: true })
      ).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe("Logout behavior", () => {
    test("logout clears token from localStorage", async ({
      page,
      loginAsUser,
      logout,
    }) => {
      await loginAsUser(
        TEST_USERS.standard.email,
        TEST_USERS.standard.password
      );

      // Verify token exists
      const tokenBefore = await page.evaluate(() =>
        localStorage.getItem("token")
      );
      expect(tokenBefore).toBeTruthy();

      // Logout
      await logout();

      // Token should be cleared
      const tokenAfter = await page.evaluate(() =>
        localStorage.getItem("token")
      );
      expect(tokenAfter).toBeNull();
    });

    test("logout clears auth store", async ({ page, loginAsUser, logout }) => {
      await loginAsUser(
        TEST_USERS.standard.email,
        TEST_USERS.standard.password
      );

      // Logout
      await logout();

      // Auth store should show unauthenticated state
      const authState = await page.evaluate(() => {
        const store = localStorage.getItem("nochat-auth");
        return store ? JSON.parse(store) : null;
      });

      // Either store is cleared or shows not authenticated
      if (authState?.state) {
        expect(authState.state.isAuthenticated).toBeFalsy();
        expect(authState.state.token).toBeFalsy();
      }
    });

    test("navigating to protected route after logout redirects", async ({
      page,
      loginAsUser,
      logout,
    }) => {
      await loginAsUser(
        TEST_USERS.standard.email,
        TEST_USERS.standard.password
      );

      await logout();

      // Try to access protected route
      await page.goto("/profile");

      // Should redirect to signin
      await expect(page).toHaveURL("/signin", { timeout: 10000 });
    });
  });

  test.describe("Zustand store hydration", () => {
    test("auth store hydrates correctly after login", async ({
      page,
      loginAsUser,
    }) => {
      await loginAsUser(
        TEST_USERS.standard.email,
        TEST_USERS.standard.password
      );

      // Token should be in localStorage (this is what persists)
      const token = await page.evaluate(() => localStorage.getItem("token"));
      expect(token).toBeTruthy();

      // Auth store should have persisted state
      const authState = await page.evaluate(() => {
        const store = localStorage.getItem("nochat-auth");
        return store ? JSON.parse(store) : null;
      });

      expect(authState).toBeTruthy();
      // Check persisted state (not _hasHydrated which is runtime-only)
      expect(authState?.state?.isAuthenticated).toBe(true);
      expect(authState?.state?.token).toBeTruthy();
    });

    test("hydration completes after page reload", async ({
      page,
      loginAsUser,
    }) => {
      await loginAsUser(
        TEST_USERS.standard.email,
        TEST_USERS.standard.password
      );

      // Reload
      await page.reload();

      // Wait for page to be ready - check that we're still on chat
      // (this indicates auth was restored)
      await expect(page).toHaveURL(/\/chat/, { timeout: 15000 });

      // Auth state should be preserved
      const token = await page.evaluate(() => localStorage.getItem("token"));
      expect(token).toBeTruthy();

      const authState = await page.evaluate(() => {
        const store = localStorage.getItem("nochat-auth");
        return store ? JSON.parse(store) : null;
      });

      expect(authState?.state?.isAuthenticated).toBe(true);
      expect(authState?.state?.token).toBeTruthy();
    });
  });

  test.describe("Token validation", () => {
    test("invalid token is cleared on API rejection", async ({
      page,
      loginAsUser,
    }) => {
      await loginAsUser(
        TEST_USERS.standard.email,
        TEST_USERS.standard.password
      );

      // Navigate to profile to establish valid session
      await page.goto("/profile");
      await expect(
        page.getByText("Profile Photo", { exact: true })
      ).toBeVisible({ timeout: 15000 });

      // Corrupt the token
      await page.evaluate(() => {
        localStorage.setItem("token", "corrupted-invalid-token");
      });

      // Reload to force the app to use the invalid token
      await page.reload();

      // Wait for the API to reject the token
      await page.waitForTimeout(3000);

      // Token should be cleared after API rejection
      const token = await page.evaluate(() => localStorage.getItem("token"));
      expect(token).toBeFalsy();

      // Now trying to navigate to profile should redirect to signin
      await page.goto("/profile");
      await expect(page).toHaveURL(/\/signin/, { timeout: 10000 });
    });
  });

  test.describe("Multiple sessions", () => {
    test("session is isolated per browser context", async ({ browser }) => {
      // Create two separate contexts (like incognito windows)
      const context1 = await browser.newContext();
      const context2 = await browser.newContext();

      const page1 = await context1.newPage();
      const page2 = await context2.newPage();

      try {
        // Login in context1
        await page1.goto("/signin");
        await page1.getByLabel("Email").fill(TEST_USERS.standard.email);
        await page1.getByLabel("Password").fill(TEST_USERS.standard.password);
        await page1.getByRole("button", { name: "Sign In", exact: true }).click();
        await page1.waitForURL(/\/chat/, { timeout: 15000 });

        // Context2 should not have the token
        await page2.goto("/");
        const token2 = await page2.evaluate(() =>
          localStorage.getItem("token")
        );
        expect(token2).toBeNull();

        // Context2 should be redirected from protected routes
        await page2.goto("/profile");
        await expect(page2).toHaveURL("/signin", { timeout: 10000 });
      } finally {
        await context1.close();
        await context2.close();
      }
    });
  });
});
