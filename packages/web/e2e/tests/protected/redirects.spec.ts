import { test, expect } from "../../fixtures/auth.fixture";
import { TEST_USERS } from "../../fixtures/test-users";

/**
 * Protected Route Redirect Tests
 *
 * Verifies that:
 * 1. Unauthenticated users are redirected to signin
 * 2. Authenticated users can access protected routes
 * 3. Home page behavior differs by auth state
 */
test.describe("Protected Route Redirects", () => {
  const protectedRoutes = ["/profile", "/chat", "/contacts"];

  test.describe("Unauthenticated access", () => {
    // /profile and /contacts redirect to /signin
    // /chat redirects to / (landing page)
    test("/profile redirects to signin", async ({ page }) => {
      // Clear auth state completely
      await page.goto("/");
      await page.evaluate(() => {
        localStorage.clear();
      });
      await page.reload();
      await page.waitForLoadState("networkidle");
      await page.goto("/profile");
      await expect(page).toHaveURL(/\/signin/, { timeout: 10000 });
    });

    test("/contacts redirects to signin", async ({ page }) => {
      await page.goto("/");
      await page.evaluate(() => {
        localStorage.clear();
      });
      await page.reload();
      await page.waitForLoadState("networkidle");
      await page.goto("/contacts");
      await expect(page).toHaveURL(/\/signin/, { timeout: 10000 });
    });

    test("/chat redirects to landing page", async ({ page }) => {
      await page.goto("/");
      await page.evaluate(() => {
        localStorage.clear();
      });
      await page.reload();
      await page.waitForLoadState("networkidle");
      await page.goto("/chat");
      // /chat redirects to "/" (landing page), not signin
      await expect(page).toHaveURL("/", { timeout: 10000 });
      await expect(
        page.getByRole("button", { name: "Start Secure Meeting" })
      ).toBeVisible();
    });
  });

  test.describe("Authenticated access", () => {
    for (const route of protectedRoutes) {
      test(`${route} is accessible when authenticated`, async ({
        page,
        loginAsUser,
      }) => {
        await loginAsUser(
          TEST_USERS.standard.email,
          TEST_USERS.standard.password
        );

        await page.goto(route);

        // Wait a moment to ensure no redirect happens
        await page.waitForTimeout(2000);

        // Should NOT redirect to signin
        expect(page.url()).not.toContain("/signin");

        // Should contain the route segment
        const routeSegment = route.split("/")[1];
        expect(page.url()).toContain(routeSegment);
      });
    }
  });

  test.describe("Home page behavior", () => {
    test("authenticated users are redirected to chat", async ({
      page,
      loginAsUser,
    }) => {
      await loginAsUser(
        TEST_USERS.standard.email,
        TEST_USERS.standard.password
      );

      await page.goto("/");

      // Authenticated users should be redirected to /chat
      await expect(page).toHaveURL(/\/chat/, { timeout: 10000 });
    });

    test("unauthenticated users see landing page", async ({ page }) => {
      // Start with clean slate
      await page.goto("/");
      await page.evaluate(() => {
        localStorage.clear();
      });
      // Reload to ensure Zustand picks up the cleared state
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Wait for the landing page to fully render
      // The page should show either the landing content or the Start Secure Meeting button
      await expect(
        page.getByRole("button", { name: "Start Secure Meeting" })
      ).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe("Auth state transitions", () => {
    test("logging out from protected route redirects appropriately", async ({
      page,
      loginAsUser,
      logout,
    }) => {
      await loginAsUser(
        TEST_USERS.standard.email,
        TEST_USERS.standard.password
      );

      // Navigate to a protected route
      await page.goto("/chat");
      await expect(page).toHaveURL(/\/chat/);

      // Logout
      await logout();

      // Try to access protected route again
      await page.goto("/profile");

      // Should redirect to signin
      await expect(page).toHaveURL("/signin", { timeout: 10000 });
    });

    test("token removal triggers redirect on next navigation", async ({
      page,
      loginAsUser,
    }) => {
      await loginAsUser(
        TEST_USERS.standard.email,
        TEST_USERS.standard.password
      );

      // Navigate to chat
      await page.goto("/chat");
      await expect(page).toHaveURL(/\/chat/);

      // Remove token without full logout - clear all auth state
      await page.evaluate(() => {
        localStorage.clear();
      });

      // Reload to force Zustand to re-hydrate from localStorage
      await page.reload();

      // Chat redirects to "/" (landing page) when unauthenticated
      await expect(page).toHaveURL("/", { timeout: 10000 });
      await expect(
        page.getByRole("button", { name: "Start Secure Meeting" })
      ).toBeVisible();
    });
  });

  test.describe("Direct URL access", () => {
    test("deep linking to protected route when authenticated", async ({
      browser,
    }) => {
      // Create a new context to simulate fresh browser
      const context = await browser.newContext();
      const page = await context.newPage();

      try {
        // Login first
        await page.goto("/signin");
        await page.getByLabel("Email").fill(TEST_USERS.standard.email);
        await page.getByLabel("Password").fill(TEST_USERS.standard.password);
        await page.getByRole("button", { name: "Sign In", exact: true }).click();
        await page.waitForURL(/\/chat/, { timeout: 15000 });

        // Get the token
        const token = await page.evaluate(() => localStorage.getItem("token"));

        // Open new page in same context (simulates new tab)
        const newPage = await context.newPage();

        // The token should be shared in the same browser context
        // Navigate directly to protected route
        await newPage.goto("/profile");

        // Should access profile (token is in localStorage)
        await expect(
          newPage.getByText("Profile Photo", { exact: true })
        ).toBeVisible({ timeout: 15000 });
      } finally {
        await context.close();
      }
    });
  });
});
