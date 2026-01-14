/**
 * Cigna Envoy Claim Scraper
 *
 * Selenium-based scraper for extracting claims from Cigna Envoy portal.
 * Updated based on actual page structure inspection (Jan 2026).
 */

import { Builder, WebDriver, By, until, WebElement } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import crypto from "crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ScrapedClaim,
  ScrapedLineItem,
  ScrapedClaimStatus,
  CreateScrapedClaimInput,
} from "../types/scraped-claim.js";
import {
  createScrapedClaim,
  findClaimByCignaNumber,
  updateScrapedClaim,
} from "../storage/claims.js";
import { ensureStorageDirs } from "../storage/index.js";

/** Cigna Envoy portal URLs */
const CIGNA_URLS = {
  login: "https://customer.cignaenvoy.com/CustomLogin",
  home: "https://customer.cignaenvoy.com/s/",
  claims: "https://customer.cignaenvoy.com/s/claiminvoicesummary",
} as const;

/** Default timeouts */
const TIMEOUTS = {
  pageLoad: 20000,
  elementWait: 15000,
  spinnerWait: 30000,
} as const;

/** Salesforce/SPA spinner selectors */
const SPINNER_SELECTORS = [
  ".slds-spinner",
  "[role='progressbar']",
  ".slds-spinner_container",
  ".loading-indicator",
  ".forceSpinner",
] as const;

/** Debug artifacts directory */
const DEBUG_DIR = "./data/debug";

/**
 * Generate TOTP code from base32 secret.
 */
function generateTOTP(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.toUpperCase()) {
    const idx = alphabet.indexOf(c);
    if (idx >= 0) bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  const key = Buffer.from(bytes);

  const counter = Math.floor(Date.now() / 30000);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code =
    (((hmac[offset]! & 0x7f) << 24) |
      (hmac[offset + 1]! << 16) |
      (hmac[offset + 2]! << 8) |
      hmac[offset + 3]!) %
    1000000;

  return code.toString().padStart(6, "0");
}

/**
 * Sleep helper.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a date string from Cigna format (e.g., "10 Nov 2025" or "10 November 2025").
 * Returns undefined if parsing fails instead of invalid Date.
 */
function parseCignaDate(dateStr: string): Date | undefined {
  if (!dateStr || typeof dateStr !== "string") return undefined;

  const shortMonths: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  const longMonths: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };

  const parts = dateStr.trim().split(/\s+/);
  if (parts.length !== 3) return undefined;

  const day = parseInt(parts[0]!, 10);
  if (isNaN(day) || day < 1 || day > 31) return undefined;

  const monthStr = parts[1]!.toLowerCase();
  const month = shortMonths[monthStr.slice(0, 3)] ?? longMonths[monthStr];
  if (month === undefined) return undefined;

  const year = parseInt(parts[2]!, 10);
  if (isNaN(year) || year < 1900 || year > 2100) return undefined;

  const date = new Date(year, month, day);
  // Validate date is valid (e.g., not Feb 31)
  if (date.getDate() !== day || date.getMonth() !== month) return undefined;

  return date;
}

/**
 * Parse an amount string (e.g., "160.00 EUR", "€145.07", "1,234.56 GBP").
 * Returns undefined for value if parsing fails instead of 0.
 */
function parseAmount(amountStr: string): { value: number | undefined; currency: string } {
  if (!amountStr || typeof amountStr !== "string") {
    return { value: undefined, currency: "EUR" };
  }

  const cleaned = amountStr.trim();

  // Map currency symbols to codes
  const symbolMap: Record<string, string> = {
    "€": "EUR", "£": "GBP", "$": "USD", "CHF": "CHF",
  };

  // Try to extract currency from symbol at start
  let currency = "EUR";
  let numStr = cleaned;

  // Check for leading currency symbol
  for (const [symbol, code] of Object.entries(symbolMap)) {
    if (cleaned.startsWith(symbol)) {
      currency = code;
      numStr = cleaned.slice(symbol.length).trim();
      break;
    }
  }

  // Check for trailing currency code (e.g., "160.00 EUR")
  const trailingMatch = numStr.match(/^([0-9.,\s]+)\s*([A-Z]{3})$/);
  if (trailingMatch) {
    numStr = trailingMatch[1]!;
    currency = trailingMatch[2]!;
  }

  // Normalize number: remove all group separators (spaces, commas used as thousands)
  // Handle both 1,234.56 (US) and 1.234,56 (EU) formats
  // If last separator is comma with 2-3 digits after, treat comma as decimal
  numStr = numStr.replace(/\s/g, "");

  if (numStr.match(/,\d{2,3}$/) && !numStr.includes(".")) {
    // EU format: 1.234,56 -> 1234.56
    numStr = numStr.replace(/\./g, "").replace(",", ".");
  } else {
    // US format: 1,234.56 -> 1234.56
    numStr = numStr.replace(/,/g, "");
  }

  const value = parseFloat(numStr);
  if (isNaN(value) || value < 0) {
    return { value: undefined, currency };
  }

  return { value, currency };
}

/**
 * Parse claim status from text.
 */
function parseClaimStatus(statusText: string): ScrapedClaimStatus {
  const normalized = statusText.toLowerCase();
  if (normalized.includes("processed") || normalized.includes("paid")) {
    return "processed";
  }
  if (normalized.includes("reject")) {
    return "rejected";
  }
  return "pending";
}

/**
 * Configuration for the scraper.
 */
export interface ScraperConfig {
  /** Cigna Healthcare ID */
  cignaId: string;
  /** Password/PIN */
  password: string;
  /** TOTP secret (base32) for MFA */
  totpSecret?: string;
  /** Run in headless mode */
  headless?: boolean;
}

/**
 * Claim summary extracted from list page.
 */
interface ClaimSummary {
  claimNumber: string;
  submissionNumber: string;
  memberName: string;
  treatmentDate: string;
  claimAmount: string;
  status: string;
}

/**
 * Claim details extracted from detail view.
 */
interface ClaimDetails {
  amountPaid?: string;
  claimAmount?: string;
  submissionDate?: string;
  treatmentDate?: string;
  memberName?: string;
  status?: string;
  lineItems: Array<{
    description: string;
    treatmentDate: string;
    claimAmount: string;
    amountPaid: string;
    status: string;
  }>;
}

/**
 * Cigna Envoy claim scraper.
 */
export class CignaScraper {
  private driver: WebDriver | null = null;
  private config: ScraperConfig;

  constructor(config: ScraperConfig) {
    this.config = {
      ...config,
      headless: config.headless ?? true,
    };
  }

  /**
   * Initialize the WebDriver.
   */
  async init(): Promise<void> {
    const options = new chrome.Options();
    options.addArguments(
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1600,1200"
    );

    if (this.config.headless) {
      options.addArguments("--headless=new");
    }

    this.driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(options as chrome.Options)
      .build();

    // Ensure storage directories exist
    ensureStorageDirs();
  }

  /**
   * Close the WebDriver.
   */
  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.quit();
      this.driver = null;
    }
  }

  // ============================================================
  // ROBUST HELPER METHODS
  // ============================================================

  /**
   * Wait for element to be located and visible.
   * Returns the visible element.
   */
  private async waitVisible(locator: By, timeout: number = TIMEOUTS.elementWait): Promise<WebElement> {
    if (!this.driver) throw new Error("Driver not initialized");
    const el = await this.driver.wait(until.elementLocated(locator), timeout);
    await this.driver.wait(until.elementIsVisible(el), timeout);
    return el;
  }

  /**
   * Wait for all spinners/loaders to disappear.
   * Uses multiple common spinner selectors for Salesforce SPAs.
   */
  private async waitSpinnersGone(timeout: number = TIMEOUTS.spinnerWait): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");

    const selector = SPINNER_SELECTORS.join(", ");
    await this.driver.wait(async () => {
      const spinners = await this.driver!.findElements(By.css(selector));
      if (spinners.length === 0) return true;

      // Check if any are actually visible
      const visibleChecks = await Promise.all(
        spinners.map(async (el) => {
          try {
            return await el.isDisplayed();
          } catch {
            return false; // Element gone (stale)
          }
        })
      );
      return visibleChecks.every((v) => !v);
    }, timeout);
  }

  /**
   * Safe click: scroll into view, wait for visible/enabled, try click with JS fallback.
   */
  private async safeClick(el: WebElement): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");

    // Scroll element into view (centered)
    await this.driver.executeScript(
      "arguments[0].scrollIntoView({block:'center', inline:'center'});",
      el
    );

    // Wait for element to be visible and enabled
    await this.driver.wait(until.elementIsVisible(el), TIMEOUTS.elementWait);
    await this.driver.wait(until.elementIsEnabled(el), TIMEOUTS.elementWait);

    try {
      await el.click();
    } catch {
      // Fallback: JS click if Selenium click is intercepted
      console.log("  Click intercepted, using JS click fallback...");
      await this.driver.executeScript("arguments[0].click();", el);
    }
  }

  /**
   * Capture debug artifacts (screenshot + HTML) on failure.
   * Saves to DEBUG_DIR/{context}-{timestamp}/
   */
  private async captureDebugArtifacts(context: string): Promise<string | null> {
    if (!this.driver) return null;

    try {
      const timestamp = Date.now();
      const dirName = `${context.replace(/[^a-z0-9]/gi, "_")}-${timestamp}`;
      const dirPath = path.join(DEBUG_DIR, dirName);

      fs.mkdirSync(dirPath, { recursive: true });

      // Save screenshot
      const screenshot = await this.driver.takeScreenshot();
      fs.writeFileSync(path.join(dirPath, "screenshot.png"), screenshot, "base64");

      // Save page HTML
      const html = await this.driver.getPageSource();
      fs.writeFileSync(path.join(dirPath, "page.html"), html, "utf-8");

      // Save current URL
      const url = await this.driver.getCurrentUrl();
      fs.writeFileSync(path.join(dirPath, "url.txt"), url, "utf-8");

      console.log(`  Debug artifacts saved to: ${dirPath}`);
      return dirPath;
    } catch (err) {
      console.error("Failed to capture debug artifacts:", err);
      return null;
    }
  }

  /**
   * Wait for page to be ready: spinners gone + anchor element visible.
   */
  private async waitPageReady(anchorLocator: By, timeout = TIMEOUTS.pageLoad): Promise<WebElement> {
    await this.waitSpinnersGone(timeout);
    return await this.waitVisible(anchorLocator, timeout);
  }

  // ============================================================
  // END HELPER METHODS
  // ============================================================

  /**
   * Dismiss cookie consent popup if present.
   * Handles both OneTrust (login page) and Cigna portal consent banners.
   */
  async dismissCookieConsent(): Promise<void> {
    if (!this.driver) return;

    try {
      console.log("Checking for cookie consent popup...");

      // Different consent button selectors for various banner types
      const consentSelectors = [
        // OneTrust selectors (login page)
        'button#onetrust-accept-btn-handler',
        'button#onetrust-reject-all-handler',
        'button.onetrust-close-btn-handler',
        'button[title="Accept"]',
        'button[title="Accept All"]',
        // Cigna portal consent banner (uses different format)
        'button:has-text("Accept All Cookies")',
        'button:has-text("Accept all")',
      ];

      // Also try XPath for text-based buttons
      const xpathSelectors = [
        "//button[contains(text(), 'Accept All Cookies')]",
        "//button[contains(text(), 'Accept all')]",
        "//button[contains(text(), 'Accept All')]",
      ];

      // Try CSS selectors first
      for (const selector of consentSelectors) {
        try {
          const btn = await this.driver.findElement(By.css(selector));
          if (await btn.isDisplayed()) {
            console.log(`Found consent button: ${selector}, clicking...`);
            await this.safeClick(btn);
            await sleep(1000);
            return;
          }
        } catch {
          // Button not found, try next
        }
      }

      // Try XPath selectors
      for (const xpath of xpathSelectors) {
        try {
          const btn = await this.driver.findElement(By.xpath(xpath));
          if (await btn.isDisplayed()) {
            console.log(`Found consent button via XPath, clicking...`);
            await this.safeClick(btn);
            await sleep(1000);
            return;
          }
        } catch {
          // Button not found, try next
        }
      }

      console.log("No cookie consent popup found or already dismissed");
    } catch {
      // Consent handling is optional, don't fail
    }
  }

  /**
   * Log into Cigna Envoy portal.
   * Uses scoped selectors and deterministic waits.
   */
  async login(): Promise<boolean> {
    if (!this.driver) throw new Error("Driver not initialized");

    try {
      console.log(`Navigating to ${CIGNA_URLS.login}...`);
      await this.driver.get(CIGNA_URLS.login);

      // Wait for login form to appear (not just any element)
      await this.waitSpinnersGone();
      const loginForm = await this.waitVisible(
        By.css("main, form, [role='main']"),
        TIMEOUTS.pageLoad
      );

      const currentUrl = await this.driver.getCurrentUrl();
      console.log(`Current URL: ${currentUrl}`);

      // Dismiss cookie consent popup if present
      await this.dismissCookieConsent();

      // Find login form container to scope our queries
      console.log("Looking for username input within login form...");

      // Scoped selector: find input by specific attributes, within form context
      const idInput = await this.waitVisible(
        By.xpath("//input[@type='text' and (contains(@id, 'username') or contains(@name, 'username') or contains(@placeholder, 'ID') or contains(@aria-label, 'ID'))]"),
        TIMEOUTS.elementWait
      );
      console.log("Found username input, entering ID...");
      await idInput.clear();
      await idInput.sendKeys(this.config.cignaId);

      // Find password input (scoped - password type is specific enough)
      console.log("Looking for password input...");
      const passwordInput = await this.waitVisible(
        By.css('input[type="password"]'),
        TIMEOUTS.elementWait
      );
      console.log("Found password input, entering password...");
      await passwordInput.clear();
      await passwordInput.sendKeys(this.config.password);

      // Click login button using safeClick
      console.log("Looking for login button...");
      const loginBtn = await this.waitVisible(
        By.xpath("//button[contains(text(), 'Login')] | //input[@type='submit' and @value='Login']"),
        TIMEOUTS.elementWait
      );
      console.log("Clicking login button...");
      await this.safeClick(loginBtn);

      // Wait for navigation: either home page OR MFA page
      await this.waitSpinnersGone(TIMEOUTS.pageLoad);

      // Handle MFA if needed
      if (this.config.totpSecret) {
        try {
          console.log("Checking for MFA prompt...");

          // Wait for MFA page to fully load
          await this.waitSpinnersGone();

          // Find TOTP input - Okta uses name="answer" and type="tel"
          const totpInput = await this.driver.wait(
            until.elementLocated(
              By.css('input[name="answer"], input[name="otp"], input[type="tel"][autocomplete="off"]')
            ),
            TIMEOUTS.elementWait
          );

          // Wait for element to be visible and interactable
          await this.driver.wait(until.elementIsVisible(totpInput), TIMEOUTS.elementWait);
          await this.driver.wait(until.elementIsEnabled(totpInput), TIMEOUTS.elementWait);

          const code = generateTOTP(this.config.totpSecret);
          // SECURITY: Don't log the actual TOTP code
          console.log("Entering TOTP code...");

          // Click to focus the input first
          await totpInput.click();
          await sleep(200);

          // Clear and send keys
          await totpInput.clear();
          await totpInput.sendKeys(code);

          // Verify the value was entered (Okta may have JS validation)
          const enteredValue = await totpInput.getAttribute("value");
          if (!enteredValue || enteredValue.length !== 6) {
            console.log("  sendKeys may have failed, trying JS fallback...");
            await this.driver.executeScript(
              `arguments[0].value = arguments[1]; arguments[0].dispatchEvent(new Event('input', { bubbles: true }));`,
              totpInput,
              code
            );
          }

          // Wait for Verify button to become enabled
          // Okta enables it only when a valid 6-digit code is entered
          console.log("Waiting for Verify button to enable...");
          const verifyBtn = await this.driver.wait(
            until.elementLocated(By.css('input[type="submit"][value="Verify"], button[data-type="save"]')),
            TIMEOUTS.elementWait
          );

          // Wait up to 5 seconds for button to become enabled
          try {
            await this.driver.wait(until.elementIsEnabled(verifyBtn), 5000);
          } catch {
            console.log("  Verify button still disabled, clicking anyway...");
          }

          console.log("Submitting TOTP...");
          await this.safeClick(verifyBtn);

          // Wait for MFA to complete - should redirect away from login.cigna.com
          await this.driver.wait(
            async () => {
              const url = await this.driver!.getCurrentUrl();
              return !url.includes("login.cigna.com") && !url.includes("signin/verify");
            },
            TIMEOUTS.pageLoad
          );
          console.log("MFA verification complete");
        } catch (mfaErr) {
          console.log("MFA handling issue:", mfaErr);
        }
      }

      // Verify login success: wait for home page indicator
      // The home page should have "/s/" in URL and show navigation
      const finalUrl = await this.driver.getCurrentUrl();
      console.log(`Final URL: ${finalUrl}`);

      const loggedIn = finalUrl.includes("/s/");
      if (loggedIn) {
        // Additional validation: wait for some home page element
        try {
          await this.waitVisible(
            By.xpath("//nav | //a[contains(@href, 'claims')] | //*[contains(text(), 'Welcome')]"),
            TIMEOUTS.elementWait
          );
          console.log("Login successful - home page confirmed");
        } catch {
          console.log("Login appears successful but couldn't confirm home page");
        }
      } else {
        console.log("Login failed - not on expected URL");
        await this.captureDebugArtifacts("login-failed");
      }

      return loggedIn;
    } catch (err) {
      console.error("Login failed with error:", err);
      await this.captureDebugArtifacts("login-error");
      return false;
    }
  }

  /**
   * Navigate to claims page.
   * Waits for spinners, dismisses cookie consent, and verifies page loaded.
   */
  async navigateToClaims(): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");

    console.log(`Navigating to claims page: ${CIGNA_URLS.claims}`);
    await this.driver.get(CIGNA_URLS.claims);

    // Wait for spinners to finish
    await this.waitSpinnersGone(TIMEOUTS.pageLoad);

    // Dismiss any cookie consent that may appear on the portal
    await this.dismissCookieConsent();

    // Wait for claims page indicator: heading OR claim cards OR "no claims" message
    try {
      await this.driver.wait(
        async () => {
          const indicators = [
            By.xpath("//*[contains(text(), 'Claim number')]"),
            By.xpath("//h1[contains(text(), 'Claims')]"),
            By.xpath("//*[contains(text(), 'No claims')]"),
            By.xpath("//*[contains(text(), 'You have no claims')]"),
          ];
          for (const loc of indicators) {
            const els = await this.driver!.findElements(loc);
            if (els.length > 0) {
              const visible = await els[0]!.isDisplayed().catch(() => false);
              if (visible) return true;
            }
          }
          return false;
        },
        TIMEOUTS.pageLoad
      );
      console.log("Claims page loaded");
    } catch {
      console.log("Claims page load uncertain, capturing debug...");
      await this.captureDebugArtifacts("claims-page-uncertain");
    }

    // Wait for content to fully render (SPA loading)
    await this.waitSpinnersGone();
  }

  /**
   * Extract text from element safely.
   */
  private async getTextSafe(element: WebElement): Promise<string> {
    try {
      return (await element.getText()).trim();
    } catch {
      return "";
    }
  }

  /**
   * Find value element following a label.
   * Cigna uses: <generic>Label</generic><generic>Value</generic> pattern
   */
  private async findValueAfterLabel(container: WebElement, label: string): Promise<string> {
    try {
      // Try to find label and get next sibling's text
      const labelEl = await container.findElement(
        By.xpath(`.//*[contains(text(), '${label}')]`)
      );

      // Get the parent and then find the value sibling
      const parent = await labelEl.findElement(By.xpath("./.."));
      const siblings = await parent.findElements(By.xpath("./*"));

      for (let i = 0; i < siblings.length; i++) {
        const text = await this.getTextSafe(siblings[i]!);
        if (text.includes(label) && i + 1 < siblings.length) {
          return await this.getTextSafe(siblings[i + 1]!);
        }
      }

      // Alternative: value might be in a child of the same container
      const valueEl = await container.findElement(
        By.xpath(`.//*[contains(text(), '${label}')]/following-sibling::*[1]`)
      );
      return await this.getTextSafe(valueEl);
    } catch {
      return "";
    }
  }

  /**
   * Collect all claim numbers by scrolling through the list.
   * Handles pagination/infinite scroll.
   */
  private async collectAllClaimNumbers(): Promise<Set<string>> {
    if (!this.driver) throw new Error("Driver not initialized");

    const claimNumbers = new Set<string>();
    let stableIterations = 0;
    const MAX_STABLE = 3;

    console.log("Collecting all claim numbers (handling scroll/pagination)...");

    // First, wait for any initial content to load
    await this.waitSpinnersGone();
    // Give SPA time to render claim cards
    await sleep(3000);

    while (stableIterations < MAX_STABLE) {
      // Wait for any loading to complete
      await this.waitSpinnersGone();

      // Find all visible claim numbers
      const headings = await this.driver.findElements(
        By.xpath("//*[contains(text(), 'Claim number')]")
      );

      const prevSize = claimNumbers.size;

      for (const h of headings) {
        try {
          const text = await this.getTextSafe(h);
          const match = text.match(/Claim number\s*(\d+)/i);
          if (match) {
            claimNumbers.add(match[1]!);
          }
        } catch {
          // Element might be stale
        }
      }

      if (claimNumbers.size === prevSize) {
        stableIterations++;
      } else {
        stableIterations = 0;
        console.log(`  Found ${claimNumbers.size} claims so far...`);
      }

      // Try to scroll to load more
      try {
        await this.driver.executeScript("window.scrollTo(0, document.body.scrollHeight);");
        // Brief wait for any lazy-load to trigger
        await this.waitSpinnersGone(3000).catch(() => { });
      } catch {
        break;
      }

      // Check for "Load more" button
      try {
        const loadMore = await this.driver.findElement(
          By.xpath("//button[contains(text(), 'Load more') or contains(text(), 'Show more')]")
        );
        if (await loadMore.isDisplayed()) {
          await this.safeClick(loadMore);
          await this.waitSpinnersGone();
          stableIterations = 0; // Reset since we loaded more
        }
      } catch {
        // No load more button
      }
    }

    console.log(`Collected ${claimNumbers.size} total claim numbers`);
    return claimNumbers;
  }

  /**
   * Find claim card container element by claim number.
   * Returns the clickable card element.
   */
  private async findClaimCard(claimNumber: string): Promise<WebElement | null> {
    if (!this.driver) return null;

    // Find the claim number element and traverse up to find card container
    const selectors = [
      // Most specific: find the strong/heading containing claim number, go up to card
      `//strong[contains(text(), '${claimNumber}')]/ancestor::*[@role='article' or contains(@class, 'card') or contains(@class, 'Block')][1]`,
      `//*[contains(text(), 'Claim number ${claimNumber}')]/ancestor::*[5]`,
      `//h3[contains(., '${claimNumber}')]/ancestor::*[5]`,
    ];

    for (const xpath of selectors) {
      try {
        const el = await this.driver.findElement(By.xpath(xpath));
        if (await el.isDisplayed()) {
          return el;
        }
      } catch {
        // Try next selector
      }
    }

    return null;
  }

  /**
   * Extract data from a single claim card using DOM traversal.
   * Card-first approach: given a card element, extract its fields.
   */
  private async extractClaimFromCard(card: WebElement, claimNumber: string): Promise<ClaimSummary> {
    const summary: ClaimSummary = {
      claimNumber,
      submissionNumber: "",
      memberName: "",
      treatmentDate: "",
      claimAmount: "",
      status: "pending",
    };

    try {
      // Get card text for regex fallback
      const cardText = await this.getTextSafe(card);

      // Extract status
      if (cardText.toLowerCase().includes("processed") || cardText.toLowerCase().includes("paid")) {
        summary.status = "processed";
      } else if (cardText.toLowerCase().includes("rejected")) {
        summary.status = "rejected";
      }

      // Try DOM-first extraction for each field using label/value pattern
      const fields = [
        { label: "Member", key: "memberName" as const },
        { label: "Treatment date", key: "treatmentDate" as const },
        { label: "Claim amount", key: "claimAmount" as const },
        { label: "Submission number", key: "submissionNumber" as const },
      ];

      for (const { label, key } of fields) {
        // Try to find value via DOM traversal
        const value = await this.findValueAfterLabel(card, label);
        if (value) {
          summary[key] = value;
        }
      }

      // Regex fallback for any missing fields
      if (!summary.memberName) {
        const m = cardText.match(/Member\s*\n?\s*([A-Za-z][A-Za-z\s'-]+)/i);
        if (m) summary.memberName = m[1]!.trim();
      }
      if (!summary.treatmentDate) {
        const m = cardText.match(/Treatment date\s*\n?\s*(\d{1,2}\s+\w+\s+\d{4})/i);
        if (m) summary.treatmentDate = m[1]!.trim();
      }
      if (!summary.claimAmount) {
        const m = cardText.match(/Claim amount\s*\n?\s*([0-9.,]+\s*[A-Z]{3})/i);
        if (m) summary.claimAmount = m[1]!.trim();
      }
      if (!summary.submissionNumber) {
        const m = cardText.match(/Submission number\s*\n?\s*"?(\d+)"?/i);
        if (m) summary.submissionNumber = m[1]!.trim();
      }
    } catch (err) {
      console.error(`  Error extracting from card ${claimNumber}:`, err);
    }

    return summary;
  }

  /**
   * Extract claim summaries from the claims list page.
   * Card-first approach with pagination support.
   */
  async extractClaimSummaries(): Promise<ClaimSummary[]> {
    if (!this.driver) throw new Error("Driver not initialized");

    const summaries: ClaimSummary[] = [];

    try {
      console.log("Extracting claim summaries (card-first approach)...");

      // Wait for page to be ready
      await this.waitSpinnersGone();

      // Collect all claim numbers first (handles pagination)
      const claimNumbers = await this.collectAllClaimNumbers();

      if (claimNumbers.size === 0) {
        console.log("No claims found on page - capturing debug...");
        await this.captureDebugArtifacts("no-claims-found");
        return summaries;
      }

      // For each claim number, find its card and extract data
      for (const claimNumber of claimNumbers) {
        console.log(`  Processing claim ${claimNumber}...`);

        const card = await this.findClaimCard(claimNumber);
        if (!card) {
          console.log(`    Could not find card for claim ${claimNumber}`);
          // Still add it with minimal info
          summaries.push({
            claimNumber,
            submissionNumber: "",
            memberName: "",
            treatmentDate: "",
            claimAmount: "",
            status: "pending",
          });
          continue;
        }

        const summary = await this.extractClaimFromCard(card, claimNumber);
        console.log(`    Extracted:`, summary);
        summaries.push(summary);
      }

      console.log(`Extracted ${summaries.length} claim summaries`);
    } catch (err) {
      console.error("Failed to extract claim summaries:", err);
      await this.captureDebugArtifacts("extract-summaries-error");
    }

    return summaries;
  }

  /**
   * Click on a claim to view its details.
   * Includes post-click validation to ensure navigation succeeded.
   */
  async viewClaimDetails(claimNumber: string): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");

    console.log(`Viewing details for claim ${claimNumber}...`);

    // Find the claim card using our helper
    const card = await this.findClaimCard(claimNumber);
    if (!card) {
      throw new Error(`Could not find card for claim ${claimNumber}`);
    }

    // Store current URL to detect navigation
    const urlBefore = await this.driver.getCurrentUrl();

    // Click the card using safeClick
    console.log(`  Clicking claim card...`);
    await this.safeClick(card);

    // Wait for navigation or detail view to appear
    await this.waitSpinnersGone(TIMEOUTS.pageLoad);

    // Post-click validation: verify we're on details page
    // Look for indicators that detail view loaded
    try {
      await this.driver.wait(
        async () => {
          // Check for detail page indicators
          const indicators = [
            // Heading with "Claim Number:"
            By.xpath(`//*[contains(text(), 'Claim Number') and contains(text(), ':')]`),
            // Back button or breadcrumb
            By.xpath(`//*[contains(text(), 'Back') or contains(text(), 'Claims')]`),
            // Detail-specific elements (line items)
            By.xpath(`//*[contains(text(), 'Amount paid')]`),
          ];

          for (const loc of indicators) {
            const els = await this.driver!.findElements(loc);
            if (els.length > 0) {
              try {
                if (await els[0]!.isDisplayed()) return true;
              } catch {
                // Stale element
              }
            }
          }

          // Also check URL changed
          const urlAfter = await this.driver!.getCurrentUrl();
          if (urlAfter !== urlBefore) return true;

          return false;
        },
        TIMEOUTS.pageLoad
      );
      console.log(`  Detail view loaded for claim ${claimNumber}`);
    } catch {
      console.log(`  Warning: Could not confirm detail view loaded`);
      await this.captureDebugArtifacts(`view-details-uncertain-${claimNumber}`);
    }
  }

  /**
   * Extract a field value by finding the label element and its following sibling.
   * DOM-first approach using normalize-space for exact matching.
   */
  private async extractFieldByLabel(container: WebElement, label: string): Promise<string> {
    try {
      // Try exact label match with following sibling
      const xpaths = [
        `.//*[normalize-space(.)='${label}']/following-sibling::*[1]`,
        `.//*[normalize-space(.)='${label}']/following::*[1]`,
        `.//*[contains(text(), '${label}')]/following-sibling::*[1]`,
      ];

      for (const xpath of xpaths) {
        try {
          const el = await container.findElement(By.xpath(xpath));
          const text = await this.getTextSafe(el);
          if (text && text !== label) {
            return text;
          }
        } catch {
          // Try next
        }
      }
    } catch {
      // Fall through to return empty
    }
    return "";
  }

  /**
   * Extract line items using DOM traversal.
   * Finds line item containers and extracts fields from each.
   */
  private async extractLineItemsFromDOM(): Promise<ClaimDetails["lineItems"]> {
    if (!this.driver) return [];

    const items: ClaimDetails["lineItems"] = [];

    try {
      // Line items are typically in repeated card/container structures
      // Look for containers that have both "Treatment date" and treatment descriptions

      // Strategy: Find all "Processed" or "Pending" status badges that are part of line items
      const statusBadges = await this.driver.findElements(
        By.xpath("//*[normalize-space(.)='Processed' or normalize-space(.)='Pending' or normalize-space(.)='Rejected']")
      );

      console.log(`  Found ${statusBadges.length} status badges for line items`);

      for (const badge of statusBadges) {
        try {
          // Find the container for this line item (go up to parent card)
          let container: WebElement | null = null;
          for (let level = 3; level <= 8; level++) {
            try {
              container = await badge.findElement(By.xpath(`./ancestor::*[${level}]`));
              const text = await this.getTextSafe(container);
              // Valid container should have Treatment date AND a treatment description
              if (text.includes("Treatment date") && text.includes("Claim amount")) {
                break;
              }
              container = null;
            } catch {
              continue;
            }
          }

          if (!container) continue;

          const containerText = await this.getTextSafe(container);

          // Skip if this is the main claim header (has "Claim number")
          if (containerText.includes("Claim number") && containerText.includes("Submission date")) {
            continue;
          }

          // Extract status
          const badgeText = await this.getTextSafe(badge);
          const status = badgeText.toLowerCase().includes("processed") ? "processed" :
            badgeText.toLowerCase().includes("rejected") ? "rejected" : "pending";

          // Extract treatment description - look for treatment type headings
          // Usually in h3/strong like "INDIVIDUAL PSYCHOTHERAPY"
          let description = "";
          try {
            const descEl = await container.findElement(
              By.xpath(".//h3//strong | .//strong[string-length(normalize-space(.)) > 10]")
            );
            const descText = await this.getTextSafe(descEl);
            // Filter out "Claim number" headings
            if (descText && !descText.includes("Claim number")) {
              description = descText;
            }
          } catch {
            // Fallback: regex from container text
            const lines = containerText.split("\n").map(l => l.trim());
            for (const line of lines) {
              if (/^[A-Z][A-Z\s]+[A-Z]$/.test(line) && line.length > 10) {
                if (!line.includes("Claim number") && !["PROCESSED", "PENDING", "REJECTED"].includes(line)) {
                  description = line;
                  break;
                }
              }
            }
          }

          if (!description) continue;

          // Extract fields using DOM traversal
          const treatmentDate = await this.extractFieldByLabel(container, "Treatment date");
          const claimAmount = await this.extractFieldByLabel(container, "Claim amount");
          const amountPaid = await this.extractFieldByLabel(container, "Amount paid");

          // Fallback to regex if DOM extraction failed
          const dateRegex = containerText.match(/Treatment date\s*\n?\s*(\d{1,2}\s+\w+\s+\d{4})/i);
          const amountRegex = containerText.match(/Claim amount\s*\n?\s*([0-9.,]+\s*[A-Z]{3})/i);
          const paidRegex = containerText.match(/Amount paid\s*\n?\s*([0-9.,]+\s*[A-Z]{3})/i);

          items.push({
            description,
            treatmentDate: treatmentDate || (dateRegex ? dateRegex[1]!.trim() : ""),
            claimAmount: claimAmount || (amountRegex ? amountRegex[1]!.trim() : ""),
            amountPaid: amountPaid || (paidRegex ? paidRegex[1]!.trim() : ""),
            status,
          });
        } catch {
          // Skip this badge
        }
      }
    } catch (err) {
      console.error("  Error extracting line items from DOM:", err);
    }

    return items;
  }

  /**
   * Extract detailed claim data from the detail view.
   * DOM-first approach with regex fallback.
   */
  async extractClaimDetails(): Promise<ClaimDetails> {
    if (!this.driver) throw new Error("Driver not initialized");

    const details: ClaimDetails = { lineItems: [] };

    try {
      console.log("Extracting claim details (DOM-first)...");

      // Wait for detail view spinner to finish
      await this.waitSpinnersGone(TIMEOUTS.pageLoad);

      // Wait for actual content to appear (not just the header)
      console.log("  Waiting for detail content to load...");
      try {
        await this.driver.wait(
          async () => {
            // Wait for key content indicators
            const indicators = [
              By.xpath("//*[contains(text(), 'Member')]"),
              By.xpath("//*[contains(text(), 'Treatment date')]"),
              By.xpath("//*[contains(text(), 'Claim amount')]"),
            ];
            for (const loc of indicators) {
              const els = await this.driver!.findElements(loc);
              if (els.length > 1) { // Need multiple, not just header
                return true;
              }
            }
            return false;
          },
          TIMEOUTS.pageLoad
        );
        console.log("  Detail content loaded");
      } catch {
        console.log("  Detail content may not have loaded fully");
        await this.captureDebugArtifacts("detail-content-incomplete");
      }

      // Give SPA a moment to finish rendering
      await sleep(2000);

      // Find the main content area
      const body = await this.driver.findElement(By.tagName("body"));

      // DOM-first: try to extract fields using label/value pattern
      const summaryFields = [
        { label: "Member", key: "memberName" as const },
        { label: "Treatment date", key: "treatmentDate" as const },
        { label: "Claim amount", key: "claimAmount" as const },
        { label: "Amount paid", key: "amountPaid" as const },
        { label: "Submission date", key: "submissionDate" as const },
      ];

      for (const { label, key } of summaryFields) {
        const value = await this.extractFieldByLabel(body, label);
        if (value) {
          // Type-safe assignment
          switch (key) {
            case "memberName": details.memberName = value; break;
            case "treatmentDate": details.treatmentDate = value; break;
            case "claimAmount": details.claimAmount = value; break;
            case "amountPaid": details.amountPaid = value; break;
            case "submissionDate": details.submissionDate = value; break;
          }
          console.log(`  ${label}: ${value}`);
        }
      }

      // Get page text for regex fallback and status extraction
      const pageText = await this.getTextSafe(body);

      // Regex fallback for any missing fields
      if (!details.memberName) {
        const m = pageText.match(/Member\s*\n?\s*([A-Za-z][A-Za-z\s'-]+[A-Za-z])/i);
        if (m) {
          details.memberName = m[1]!.trim().replace(/\s*(Treatment|Claim|Amount).*$/i, "").trim();
          console.log(`  Member (fallback): ${details.memberName}`);
        }
      }
      if (!details.treatmentDate) {
        const m = pageText.match(/Treatment date\s*\n?\s*(\d{1,2}\s+\w+\s+\d{4})/i);
        if (m) {
          details.treatmentDate = m[1]!.trim();
          console.log(`  Treatment date (fallback): ${details.treatmentDate}`);
        }
      }
      if (!details.claimAmount) {
        const m = pageText.match(/Claim amount\s*\n?\s*([0-9.,]+\s*[A-Z]{3})/i);
        if (m) {
          details.claimAmount = m[1]!.trim();
          console.log(`  Claim amount (fallback): ${details.claimAmount}`);
        }
      }
      if (!details.amountPaid) {
        const m = pageText.match(/Amount paid\s*\n?\s*([0-9.,]+\s*[A-Z]{3})/i);
        if (m) {
          details.amountPaid = m[1]!.trim();
          console.log(`  Amount paid (fallback): ${details.amountPaid}`);
        }
      }
      if (!details.submissionDate) {
        const m = pageText.match(/Submission date\s*\n?\s*(\d{1,2}\s+\w+\s+\d{4})/i);
        if (m) {
          details.submissionDate = m[1]!.trim();
          console.log(`  Submission date (fallback): ${details.submissionDate}`);
        }
      }

      // Extract status
      if (pageText.toLowerCase().includes("claim processed") || pageText.toLowerCase().includes("processed")) {
        details.status = "processed";
      } else if (pageText.toLowerCase().includes("rejected")) {
        details.status = "rejected";
      } else {
        details.status = "pending";
      }
      console.log(`  Status: ${details.status}`);

      // Extract line items using DOM traversal
      details.lineItems = await this.extractLineItemsFromDOM();

      // If DOM extraction found nothing, try text-based fallback
      if (details.lineItems.length === 0) {
        console.log("  Line item DOM extraction found nothing, trying text fallback...");
        const sections = pageText.split(/(?=\n(?:Processed|Pending|Rejected)\n)/i);

        for (let i = 1; i < sections.length; i++) {
          const section = sections[i]!;

          // Skip header section
          if (section.includes("Claim number") && section.includes("Submission date")) continue;

          const status = section.toLowerCase().startsWith("processed") ? "processed" :
            section.toLowerCase().startsWith("rejected") ? "rejected" : "pending";

          // Find description
          let description = "";
          const lines = section.split("\n").map(l => l.trim()).filter(Boolean);
          for (const line of lines) {
            if (/^(Processed|Pending|Rejected|Action required|Confidential|View details)$/i.test(line)) continue;
            if (/^\d/.test(line)) continue;
            if (/^[A-Z][A-Z\s]+[A-Z]$/.test(line) && line.length > 10 && !line.includes("Claim number")) {
              description = line;
              break;
            }
          }

          if (!description) continue;

          const dateMatch = section.match(/Treatment date\s*\n?\s*(\d{1,2}\s+\w+\s+\d{4})/i);
          const amountMatch = section.match(/Claim amount\s*\n?\s*([0-9.,]+\s*[A-Z]{3})/i);
          const paidMatch = section.match(/Amount paid\s*\n?\s*([0-9.,]+\s*[A-Z]{3})/i);

          details.lineItems.push({
            description,
            treatmentDate: dateMatch ? dateMatch[1]!.trim() : "",
            claimAmount: amountMatch ? amountMatch[1]!.trim() : "",
            amountPaid: paidMatch ? paidMatch[1]!.trim() : "",
            status,
          });
        }
      }

      console.log(`  Extracted ${details.lineItems.length} line items`);

      // Log line items for debugging
      for (const item of details.lineItems) {
        console.log(`    - ${item.description}: ${item.treatmentDate}, ${item.claimAmount}, ${item.amountPaid}`);
      }

    } catch (err) {
      console.error("Failed to extract claim details:", err);
      await this.captureDebugArtifacts("extract-details-error");
    }

    return details;
  }

  /**
   * Validate claim data before saving.
   * Returns array of validation errors, empty if valid.
   */
  private validateClaimData(
    claimNumber: string,
    claimAmount: number | undefined,
    treatmentDate: Date | undefined,
    submissionDate: Date | undefined,
    lineItems: ScrapedLineItem[]
  ): string[] {
    const errors: string[] = [];

    // Claim number must be valid digits
    if (!claimNumber || !/^\d+$/.test(claimNumber)) {
      errors.push(`Invalid claim number: ${claimNumber}`);
    }

    // Claim amount must be positive
    if (claimAmount === undefined || claimAmount < 0) {
      errors.push(`Invalid claim amount: ${claimAmount}`);
    }

    // Treatment date must be valid and not in the future
    if (!treatmentDate || isNaN(treatmentDate.getTime())) {
      errors.push("Missing or invalid treatment date");
    } else {
      const now = new Date();
      if (treatmentDate > now) {
        errors.push(`Treatment date is in the future: ${treatmentDate.toISOString()}`);
      }
    }

    // Submission date must be valid
    if (!submissionDate || isNaN(submissionDate.getTime())) {
      errors.push("Missing or invalid submission date");
    }

    // Line items should have valid dates (warn but don't fail)
    for (let i = 0; i < lineItems.length; i++) {
      const li = lineItems[i]!;
      if (!li.treatmentDate || isNaN(li.treatmentDate.getTime())) {
        errors.push(`Line item ${i + 1} has invalid treatment date`);
      }
      if (li.claimAmount === undefined || li.claimAmount < 0) {
        errors.push(`Line item ${i + 1} has invalid claim amount`);
      }
    }

    return errors;
  }

  /**
   * Scrape all claims and save to storage.
   * Includes validation and never defaults to current date.
   */
  async scrapeAllClaims(): Promise<ScrapedClaim[]> {
    const scrapedClaims: ScrapedClaim[] = [];

    // Get summaries from list page
    const summaries = await this.extractClaimSummaries();
    console.log(`\nFound ${summaries.length} claims to process`);

    for (const summary of summaries) {
      try {
        console.log(`\n${"=".repeat(50)}`);
        console.log(`Processing claim ${summary.claimNumber}...`);

        // Check if already exists
        const existing = await findClaimByCignaNumber(summary.claimNumber);
        if (existing) {
          console.log(`  Claim already exists (${existing.id}), will update`);
        }

        // Click to view details
        await this.viewClaimDetails(summary.claimNumber);

        // Extract detailed information
        const details = await this.extractClaimDetails();

        // Combine summary and details (prefer detail values as they're more complete)
        const memberName = details.memberName || summary.memberName || "";
        const treatmentDateStr = details.treatmentDate || summary.treatmentDate || "";
        const claimAmountStr = details.claimAmount || summary.claimAmount || "";
        const amountPaidStr = details.amountPaid || "";
        const submissionDateStr = details.submissionDate || "";
        const statusStr = details.status || summary.status || "pending";

        // Parse amounts - now returns undefined for invalid values
        const claimAmountParsed = parseAmount(claimAmountStr);
        const amountPaidParsed = parseAmount(amountPaidStr);

        // Parse dates - now returns undefined for invalid values
        const treatmentDate = treatmentDateStr ? parseCignaDate(treatmentDateStr) : undefined;
        const submissionDate = submissionDateStr ? parseCignaDate(submissionDateStr) : undefined;

        // Parse line items - filter out items with invalid dates
        const lineItems: ScrapedLineItem[] = [];
        for (const li of details.lineItems) {
          const liDate = li.treatmentDate ? parseCignaDate(li.treatmentDate) : undefined;
          const liAmount = parseAmount(li.claimAmount);
          const liPaid = parseAmount(li.amountPaid);

          // Skip line items with missing critical data
          if (!liDate) {
            console.log(`  Warning: Skipping line item "${li.description}" - missing date`);
            continue;
          }
          if (liAmount.value === undefined) {
            console.log(`  Warning: Skipping line item "${li.description}" - missing amount`);
            continue;
          }

          const lineItem: ScrapedLineItem = {
            treatmentDescription: li.description,
            treatmentDate: liDate,
            claimAmount: liAmount.value,
            claimCurrency: liAmount.currency,
            status: parseClaimStatus(li.status),
          };
          // Only add optional fields if they have values
          if (liPaid.value !== undefined) lineItem.amountPaid = liPaid.value;
          if (liPaid.currency) lineItem.paymentCurrency = liPaid.currency;
          lineItems.push(lineItem);
        }

        // Validate before saving
        const validationErrors = this.validateClaimData(
          summary.claimNumber,
          claimAmountParsed.value,
          treatmentDate,
          submissionDate,
          lineItems
        );

        if (validationErrors.length > 0) {
          console.error(`  Validation failed for claim ${summary.claimNumber}:`);
          for (const err of validationErrors) {
            console.error(`    - ${err}`);
          }
          await this.captureDebugArtifacts(`validation-failed-${summary.claimNumber}`);

          // If critical fields are missing, skip this claim
          if (!treatmentDate || !submissionDate || claimAmountParsed.value === undefined) {
            console.error(`  Skipping claim ${summary.claimNumber} due to missing critical fields`);
            await this.navigateToClaims();
            continue;
          }
        }

        // Now we know the dates are valid
        const claimInput: CreateScrapedClaimInput = {
          cignaClaimNumber: summary.claimNumber,
          submissionNumber: summary.submissionNumber,
          memberName,
          treatmentDate: treatmentDate!,
          claimAmount: claimAmountParsed.value!,
          claimCurrency: claimAmountParsed.currency,
          status: parseClaimStatus(statusStr),
          submissionDate: submissionDate!,
          lineItems,
        };
        // Only add optional fields if they have values
        if (amountPaidParsed.value !== undefined) claimInput.amountPaid = amountPaidParsed.value;
        if (amountPaidParsed.currency) claimInput.paymentCurrency = amountPaidParsed.currency;

        console.log(`  Final data:`, {
          claimNumber: summary.claimNumber,
          memberName,
          treatmentDate: treatmentDate?.toISOString().split("T")[0],
          submissionDate: submissionDate?.toISOString().split("T")[0],
          claimAmount: `${claimAmountParsed.value} ${claimAmountParsed.currency}`,
          amountPaid: amountPaidParsed.value ? `${amountPaidParsed.value} ${amountPaidParsed.currency}` : "N/A",
          status: statusStr,
          lineItems: lineItems.length,
        });

        // Save or update
        let claim: ScrapedClaim;
        if (existing) {
          claim = (await updateScrapedClaim(existing.id, claimInput))!;
          console.log(`  ✓ Updated claim ${claim.id}`);
        } else {
          claim = await createScrapedClaim(claimInput);
          console.log(`  ✓ Created claim ${claim.id}`);
        }

        scrapedClaims.push(claim);

        // Navigate back to claims list for next claim
        await this.navigateToClaims();
      } catch (err) {
        console.error(`Failed to scrape claim ${summary.claimNumber}:`, err);
        await this.captureDebugArtifacts(`scrape-failed-${summary.claimNumber}`);

        // Try to navigate back for next claim
        try {
          await this.navigateToClaims();
        } catch {
          // ignore navigation failure
        }
      }
    }

    return scrapedClaims;
  }

  /**
   * Run the full scrape workflow.
   */
  async run(): Promise<ScrapedClaim[]> {
    try {
      await this.init();

      const loggedIn = await this.login();
      if (!loggedIn) {
        throw new Error("Failed to log in to Cigna Envoy");
      }

      await this.navigateToClaims();
      const claims = await this.scrapeAllClaims();

      return claims;
    } finally {
      await this.close();
    }
  }
}

/**
 * Create a scraper from environment variables.
 */
export function createScraperFromEnv(): CignaScraper {
  const cignaId = process.env.CIGNA_ID;
  const password = process.env.CIGNA_PASSWORD;
  const totpSecret = process.env.CIGNA_TOTP_SECRET;

  if (!cignaId || !password) {
    throw new Error("CIGNA_ID and CIGNA_PASSWORD environment variables required");
  }

  return new CignaScraper({
    cignaId,
    password,
    ...(totpSecret && { totpSecret }),
    headless: process.env.HEADLESS !== "false",
  });
}
