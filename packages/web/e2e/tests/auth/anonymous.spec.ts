import { test, expect } from "../../fixtures/auth.fixture";

test.describe("Anonymous Authentication", () => {
  test("can sign in anonymously from signin page", async ({ page }) => {
    await page.goto("/signin");

    // Click continue anonymously button
    await page.getByRole("button", { name: "Continue Anonymously" }).click();

    // Should redirect to home or chat
    await page.waitForURL(/\/(chat)?$/, { timeout: 15000 });

    // Token should be stored
    const token = await page.evaluate(() => localStorage.getItem("token"));
    expect(token).toBeTruthy();
  });

  test("anonymous user can access chat", async ({ page, loginAsAnonymous }) => {
    await loginAsAnonymous();

    // Navigate to chat
    await page.goto("/chat");

    // Should stay on chat page (not redirect to signin)
    await expect(page).toHaveURL(/\/chat/);
  });

  test("anonymous user is flagged correctly in auth store", async ({
    page,
  }) => {
    await page.goto("/signin");

    // Click continue anonymously
    await page.getByRole("button", { name: "Continue Anonymously" }).click();

    // Wait for auth to complete
    await page.waitForURL(/\/(chat)?$/, { timeout: 15000 });

    // Check auth store has isAnonymous flag
    const authState = await page.evaluate(() => {
      const store = localStorage.getItem("nochat-auth");
      return store ? JSON.parse(store) : null;
    });

    expect(authState?.state?.user?.isAnonymous).toBe(true);
  });

  test("can start meeting anonymously from landing page", async ({ page }) => {
    await page.goto("/");

    // Click start meeting button
    await page.getByRole("button", { name: "Start Secure Meeting" }).click();

    // Should redirect to a meeting room
    await page.waitForURL(/\/meeting\/[A-Z0-9]+/, { timeout: 15000 });

    // Token should be stored (anonymous user created)
    const token = await page.evaluate(() => localStorage.getItem("token"));
    expect(token).toBeTruthy();
  });
});
