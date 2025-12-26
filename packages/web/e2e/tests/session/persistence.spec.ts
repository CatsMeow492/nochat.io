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
        page.getByRole("heading", { name: "Profile Photo" })
      ).toBeVisible({ timeout: 15000 });

      // Reload
      await page.reload();

      // Should still have access to profile
      await expect(
        page.getByRole("heading", { name: "Profile Photo" })
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

      // Check store has hydrated
      const authState = await page.evaluate(() => {
        const store = localStorage.getItem("nochat-auth");
        return store ? JSON.parse(store) : null;
      });

      expect(authState).toBeTruthy();
      expect(authState?.state?._hasHydrated).toBe(true);
      expect(authState?.state?.isAuthenticated).toBe(true);
      expect(authState?.state?.token).toBeTruthy();
      expect(authState?.state?.user).toBeTruthy();
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

      // Wait for hydration
      await page.waitForFunction(
        () => {
          const store = localStorage.getItem("nochat-auth");
          if (!store) return false;
          const parsed = JSON.parse(store);
          return parsed?.state?._hasHydrated === true;
        },
        { timeout: 10000 }
      );

      // Auth state should be preserved
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

      // Corrupt the token
      await page.evaluate(() => {
        localStorage.setItem("token", "corrupted-invalid-token");
      });

      // Navigate to a page that will make API calls
      await page.goto("/profile");

      // Should eventually clear the bad token and redirect
      await expect(page).toHaveURL("/signin", { timeout: 15000 });

      // Token should be cleared
      const token = await page.evaluate(() => localStorage.getItem("token"));
      expect(token).toBeNull();
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
        await page1.getByRole("button", { name: "Sign In" }).click();
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
