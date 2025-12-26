/**
 * Test user credentials for E2E tests
 * These users should be seeded in the test database before tests run
 */
export const TEST_USERS = {
  standard: {
    email: "e2e-test@nochat.io",
    password: "TestPassword123!",
    username: "e2e-tester",
  },
  secondary: {
    email: "e2e-test-2@nochat.io",
    password: "TestPassword456!",
    username: "e2e-tester-2",
  },
  // User that doesn't exist - for testing error states
  invalid: {
    email: "nonexistent@nochat.io",
    password: "WrongPassword123!",
  },
};

/**
 * Generate a unique test email for signup tests
 */
export function generateTestEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@nochat.io`;
}

/**
 * Generate a unique test username for signup tests
 */
export function generateTestUsername(): string {
  return `e2e-${Date.now().toString(36)}`;
}
