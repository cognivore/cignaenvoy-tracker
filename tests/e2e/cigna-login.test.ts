import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { execSync } from "child_process";
import { WebDriver, By, until } from "selenium-webdriver";
import {
  createDriver,
  captureBrowserErrors,
  sleep,
  generateTOTP,
} from "./setup.js";

interface Credentials {
  username: string;
  password: string;
}

/**
 * Retrieve credentials from passveil.
 * Returns { username, password } or throws if unavailable.
 */
function getCredentials(): Credentials {
  const raw = execSync("passveil show customer.cignaenvoy.com/tracker-credentials", {
    encoding: "utf-8",
    timeout: 10000,
  }).trim();

  const lines = raw.split("\n");
  if (lines.length < 2) {
    throw new Error("Expected 2 lines from passveil (username, password)");
  }

  return {
    username: lines[0]!.trim(),
    password: lines[1]!.trim(),
  };
}

/**
 * Retrieve TOTP secret from passveil.
 */
function getTotpSecret(): string {
  const secret = execSync("passveil show customer.cignaenvoy.com/totp-secret", {
    encoding: "utf-8",
    timeout: 10000,
  }).trim();

  return secret;
}

/**
 * Dismiss OneTrust cookie consent banner if present.
 */
async function dismissCookieBanner(driver: WebDriver): Promise<void> {
  try {
    // Try to find and click "Accept All Cookies" button
    const acceptButton = await driver.findElement(
      By.id("onetrust-accept-btn-handler")
    );
    await acceptButton.click();
    await sleep(500);
    console.log("✓ Cookie consent banner dismissed");
  } catch {
    // Banner not present or already dismissed - continue
  }
}

describe("Cigna Envoy Portal E2E Tests", () => {
  let driver: WebDriver;
  let credentials: Credentials;
  let totpSecret: string;
  const baseUrl = "https://customer.cignaenvoy.com";

  beforeAll(async () => {
    credentials = getCredentials();
    totpSecret = getTotpSecret();
    driver = await createDriver();
  }, 30000);

  afterAll(async () => {
    if (driver) {
      const browserErrors = await captureBrowserErrors(driver);
      browserErrors.logSummary();
      await driver.quit();
    }
  }, 10000);

  it("should load the Cigna Envoy login page", async () => {
    await driver.get(baseUrl);
    await sleep(3000); // Salesforce Lightning / Okta takes time to render

    const title = await driver.getTitle();
    console.log(`Page title: ${title}`);

    expect(title).toBe("Login");

    // Dismiss cookie banner for subsequent tests
    await dismissCookieBanner(driver);
  }, 30000);

  it("should have login form with Okta elements", async () => {
    // Okta Sign-In Widget element IDs
    const usernameField = await driver.wait(
      until.elementLocated(By.id("okta-signin-username")),
      10000,
      "Okta username field not found"
    );
    expect(usernameField).toBeTruthy();

    const passwordField = await driver.findElement(By.id("okta-signin-password"));
    expect(passwordField).toBeTruthy();

    const loginButton = await driver.findElement(By.id("okta-signin-submit"));
    const buttonValue = await loginButton.getAttribute("value");
    expect(buttonValue).toBe("Login");
  }, 15000);

  it("should complete full login with MFA and reach dashboard", async () => {
    // Ensure cookie banner is dismissed
    await dismissCookieBanner(driver);

    // Fill in credentials using Okta element IDs
    const usernameField = await driver.findElement(By.id("okta-signin-username"));
    await usernameField.clear();
    await usernameField.sendKeys(credentials.username);

    const passwordField = await driver.findElement(By.id("okta-signin-password"));
    await passwordField.clear();
    await passwordField.sendKeys(credentials.password);

    // Click login
    const loginButton = await driver.findElement(By.id("okta-signin-submit"));
    await loginButton.click();

    // Wait for MFA page
    await sleep(5000);

    const mfaUrl = await driver.getCurrentUrl();
    console.log(`MFA page URL: ${mfaUrl}`);

    expect(
      mfaUrl.includes("login.cigna.com") && mfaUrl.includes("verify")
    ).toBeTruthy();

    // Generate and enter TOTP code
    const totpCode = generateTOTP(totpSecret);
    console.log(`Generated TOTP code: ${totpCode}`);

    // Find the TOTP input field - Okta Identity Engine uses various selectors
    // Try multiple approaches for resilience against UI changes
    const totpSelectors = [
      'input[name="credentials.passcode"]',           // Okta Identity Engine
      'input[data-se="credentials.passcode"]',        // OIE data-se attribute
      'input[name="answer"]',                         // Classic Okta MFA
      'input[name="verifyCode"]',                     // Alternative OIE
      'input[autocomplete="one-time-code"]',          // Standard OTP autocomplete
      'input[inputmode="numeric"][type="text"]',      // Numeric input
      'input.otp-input',                              // Common OTP class
      'input[aria-label*="code" i]',                  // Aria label containing "code"
      'input[aria-label*="passcode" i]',              // Aria label containing "passcode"
      'input[placeholder*="code" i]',                 // Placeholder containing "code"
    ];

    let totpInput = null;
    for (const selector of totpSelectors) {
      try {
        totpInput = await driver.wait(
          until.elementLocated(By.css(selector)),
          2000
        );
        if (totpInput) {
          console.log(`Found TOTP input with selector: ${selector}`);
          break;
        }
      } catch {
        // Try next selector
      }
    }

    if (!totpInput) {
      // Last resort: find any visible text input on the page
      const allInputs = await driver.findElements(By.css('input[type="text"], input[type="tel"], input:not([type])'));
      for (const input of allInputs) {
        if (await input.isDisplayed()) {
          totpInput = input;
          console.log("Found TOTP input via fallback (first visible text input)");
          break;
        }
      }
    }

    if (!totpInput) {
      throw new Error("TOTP input field not found with any known selector");
    }

    await totpInput.clear();
    await totpInput.sendKeys(totpCode);

    // Click Verify button - try multiple selectors
    const verifySelectors = [
      'input[type="submit"][value="Verify"]',
      'button[type="submit"]',
      'input[type="submit"]',
      'button[data-se="submit"]',
      'input[data-se="submit"]',
      'button.button-primary',
    ];

    let verifyButton = null;
    for (const selector of verifySelectors) {
      try {
        verifyButton = await driver.findElement(By.css(selector));
        if (verifyButton && await verifyButton.isDisplayed()) {
          console.log(`Found Verify button with selector: ${selector}`);
          break;
        }
      } catch {
        // Try next selector
      }
    }

    if (!verifyButton) {
      throw new Error("Verify button not found with any known selector");
    }

    await verifyButton.click();

    // Wait for dashboard to load
    await sleep(8000);

    const dashboardUrl = await driver.getCurrentUrl();
    const dashboardTitle = await driver.getTitle();
    console.log(`After MFA - URL: ${dashboardUrl}`);
    console.log(`After MFA - Title: ${dashboardTitle}`);

    // Verify we reached the dashboard (not stuck on login/MFA)
    const isOnDashboard =
      !dashboardUrl.includes("login.cigna.com") &&
      !dashboardUrl.includes("CustomLogin") &&
      (dashboardUrl.includes("cignaenvoy.com") || dashboardUrl.includes("/s/"));

    expect(isOnDashboard).toBeTruthy();
    console.log("✓ Successfully logged in and reached dashboard!");
  }, 60000);
});
