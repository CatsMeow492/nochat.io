import { test as base, expect, Page } from "@playwright/test";
import { TEST_USERS } from "./test-users";

/**
 * Authentication fixture types
 */
export type AuthFixtures = {
  /** Page already authenticated with standard test user */
  authenticatedPage: Page;
  /** Login helper function */
  loginAsUser: (email: string, password: string) => Promise<void>;
  /** Anonymous login helper */
  loginAsAnonymous: () => Promise<void>;
  /** Logout helper - clears localStorage */
  logout: () => Promise<void>;
  /** Wait for zustand auth store to hydrate */
  waitForAuthReady: () => Promise<void>;
};

/**
 * Helper: Login via UI
 */
async function loginViaUI(page: Page, email: string, password: string) {
  await page.goto("/signin");

  // Fill in email
  await page.getByLabel("Email").fill(email);

  // Fill in password
  await page.getByLabel("Password").fill(password);

  // Click sign in button (exact match to avoid matching "Sign in with..." buttons)
  await page.getByRole("button", { name: "Sign In", exact: true }).click();

  // Wait for redirect to home or chat
  await page.waitForURL(/\/(chat)?$/, { timeout: 15000 });
}

/**
 * Extended test with authentication fixtures
 */
export const test = base.extend<AuthFixtures>({
  // Fixture: page already authenticated with test user
  authenticatedPage: async ({ page }, use) => {
    await loginViaUI(
      page,
      TEST_USERS.standard.email,
      TEST_USERS.standard.password
    );
    await use(page);
  },

  // Fixture: login helper function
  loginAsUser: async ({ page }, use) => {
    const login = async (email: string, password: string) => {
      await loginViaUI(page, email, password);
    };
    await use(login);
  },

  // Fixture: anonymous login helper
  loginAsAnonymous: async ({ page }, use) => {
    const loginAnon = async () => {
      await page.goto("/signin");
      await page
        .getByRole("button", { name: "Continue Anonymously" })
        .click();
      await page.waitForURL(/\/(chat)?$/, { timeout: 15000 });
    };
    await use(loginAnon);
  },

  // Fixture: logout helper
  logout: async ({ page }, use) => {
    const logoutFn = async () => {
      // Clear localStorage
      await page.evaluate(() => {
        localStorage.removeItem("token");
        localStorage.removeItem("nochat-auth");
      });
      await page.goto("/");
    };
    await use(logoutFn);
  },

  // Fixture: wait for auth state to be ready
  waitForAuthReady: async ({ page }, use) => {
    const waitFn = async () => {
      // Wait for zustand hydration to complete
      await page.waitForFunction(
        () => {
          const authStore = localStorage.getItem("nochat-auth");
          if (!authStore) return true; // No auth = ready
          try {
            const parsed = JSON.parse(authStore);
            return parsed?.state?._hasHydrated !== false;
          } catch {
            return true;
          }
        },
        { timeout: 10000 }
      );
    };
    await use(waitFn);
  },
});

export { expect };
