import { test, expect } from "../../fixtures/auth.fixture";
import { TEST_USERS } from "../../fixtures/test-users";

test.describe("Email Sign In", () => {
  test("displays signin form correctly", async ({ page }) => {
    await page.goto("/signin");

    // Verify form elements are visible
    await expect(
      page.getByText("Welcome Back")
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue Anonymously" })
    ).toBeVisible();
  });

  test("successful signin redirects to chat", async ({ page }) => {
    await page.goto("/signin");

    // Fill in credentials
    await page.getByLabel("Email").fill(TEST_USERS.standard.email);
    await page.getByLabel("Password").fill(TEST_USERS.standard.password);

    // Click sign in
    await page.getByRole("button", { name: "Sign In", exact: true }).click();

    // Should redirect to chat
    await page.waitForURL(/\/chat/, { timeout: 15000 });

    // Verify token is stored in localStorage
    const token = await page.evaluate(() => localStorage.getItem("token"));
    expect(token).toBeTruthy();
  });

  test("invalid credentials shows error", async ({ page }) => {
    await page.goto("/signin");

    // Fill in invalid credentials
    await page.getByLabel("Email").fill(TEST_USERS.invalid.email);
    await page.getByLabel("Password").fill(TEST_USERS.invalid.password);

    // Click sign in
    await page.getByRole("button", { name: "Sign In", exact: true }).click();

    // Should show error message (could be from backend or fallback)
    // Possible messages: "Invalid credentials", "Session expired", "Request failed", etc.
    await expect(
      page.getByText(/invalid|incorrect|unauthorized|expired|failed|error/i)
    ).toBeVisible({ timeout: 10000 });

    // Should stay on signin page
    expect(page.url()).toContain("/signin");

    // Token should not be stored
    const token = await page.evaluate(() => localStorage.getItem("token"));
    expect(token).toBeFalsy();
  });

  test("password visibility toggle works", async ({ page }) => {
    await page.goto("/signin");

    const passwordInput = page.getByLabel("Password");
    await passwordInput.fill("testpassword");

    // Initially should be password type (hidden)
    await expect(passwordInput).toHaveAttribute("type", "password");

    // Find and click the visibility toggle button (eye icon)
    const toggleButton = page.locator("button").filter({
      has: page.locator("svg"),
    });
    // The toggle is inside the password field's container
    await page
      .locator('input[id="password"]')
      .locator("..")
      .locator("button")
      .click();

    // Should now be text type (visible)
    await expect(passwordInput).toHaveAttribute("type", "text");
  });

  test("link to signup page works", async ({ page }) => {
    await page.goto("/signin");

    // Click the sign up link
    await page.getByRole("link", { name: "Sign up" }).click();

    // Should navigate to signup page
    await expect(page).toHaveURL("/signup");
  });

  test("empty form shows validation error", async ({ page }) => {
    await page.goto("/signin");

    // Try to submit empty form
    await page.getByRole("button", { name: "Sign In", exact: true }).click();

    // HTML5 validation should prevent submission
    // The email field has required attribute
    const emailInput = page.getByLabel("Email");
    const validationMessage = await emailInput.evaluate(
      (el: HTMLInputElement) => el.validationMessage
    );
    expect(validationMessage).toBeTruthy();
  });
});
