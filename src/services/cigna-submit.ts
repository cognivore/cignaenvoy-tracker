/**
 * Cigna Envoy Claim Submitter
 *
 * Selenium-based automation for submitting new claims.
 */

import { Builder, By, Key, until, WebDriver, WebElement } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
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

export interface SubmitterConfig {
  cignaId: string;
  password: string;
  totpSecret?: string;
  /** Run browser in headless mode (default: false - visible) */
  headless?: boolean;
  /** Fill everything but pause before final submit (default: true) */
  pauseBeforeSubmit?: boolean;
}

export interface ClaimSubmissionDocument {
  filePath: string;
  fileName?: string;
}

export interface ClaimSubmissionInput {
  claimType: string;
  country: string;
  symptoms: string[];
  providerName?: string;
  providerAddress?: string;
  providerCountry?: string;
  progressReport?: string;
  treatmentDate?: string;
  totalAmount?: number;
  currency?: string;
  patientName?: string;
  documents: ClaimSubmissionDocument[];
}

export interface SubmissionResult {
  cignaClaimId?: string;
  submissionNumber?: string;
  submissionUrl?: string;
  claimUrl?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

export class CignaSubmitter {
  private driver: WebDriver | null = null;
  private config: Required<Omit<SubmitterConfig, 'totpSecret'>> & { totpSecret?: string };

  constructor(config: SubmitterConfig) {
    this.config = {
      ...config,
      headless: config.headless ?? false, // Default: visible browser
      pauseBeforeSubmit: config.pauseBeforeSubmit ?? true, // Default: pause for review
    };
  }

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

    ensureStorageDirs();
  }

  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.quit();
      this.driver = null;
    }
  }

  private async waitVisible(locator: By, timeout: number = TIMEOUTS.elementWait): Promise<WebElement> {
    if (!this.driver) throw new Error("Driver not initialized");
    const el = await this.driver.wait(until.elementLocated(locator), timeout);
    await this.driver.wait(until.elementIsVisible(el), timeout);
    return el;
  }

  private async waitSpinnersGone(timeout: number = TIMEOUTS.spinnerWait): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    const selector = SPINNER_SELECTORS.join(", ");
    await this.driver.wait(async () => {
      const spinners = await this.driver!.findElements(By.css(selector));
      if (spinners.length === 0) return true;
      const visibleChecks = await Promise.all(
        spinners.map(async (el) => {
          try {
            return await el.isDisplayed();
          } catch {
            return false;
          }
        })
      );
      return visibleChecks.every((v) => !v);
    }, timeout);
  }

  private async safeClick(element: WebElement): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    await this.driver.wait(until.elementIsVisible(element), TIMEOUTS.elementWait);
    await this.driver.wait(until.elementIsEnabled(element), TIMEOUTS.elementWait);
    await element.click();
  }

  private async dismissCookieConsent(): Promise<void> {
    if (!this.driver) return;
    const selectors = [
      "button#onetrust-accept-btn-handler",
      "button[aria-label='Accept All Cookies']",
    ];
    for (const selector of selectors) {
      try {
        const btn = await this.driver.findElement(By.css(selector));
        if (await btn.isDisplayed()) {
          await this.safeClick(btn);
          await sleep(1000);
          return;
        }
      } catch {
        // ignore
      }
    }
  }

  private async captureDebugArtifacts(tag: string): Promise<void> {
    if (!this.driver) return;
    try {
      fs.mkdirSync(DEBUG_DIR, { recursive: true });
      const screenshot = await this.driver.takeScreenshot();
      fs.writeFileSync(path.join(DEBUG_DIR, `${tag}.png`), screenshot, "base64");
      const html = await this.driver.getPageSource();
      fs.writeFileSync(path.join(DEBUG_DIR, `${tag}.html`), html, "utf-8");
    } catch {
      // best effort
    }
  }

  async login(): Promise<boolean> {
    if (!this.driver) throw new Error("Driver not initialized");

    try {
      await this.driver.get(CIGNA_URLS.login);
      await this.waitSpinnersGone(TIMEOUTS.pageLoad);
      await this.dismissCookieConsent();

      const idInput = await this.waitVisible(
        By.xpath(
          "//input[@type='text' and (contains(@id, 'username') or contains(@name, 'username') or contains(@placeholder, 'ID') or contains(@aria-label, 'ID'))]"
        ),
        TIMEOUTS.elementWait
      );
      await idInput.clear();
      await idInput.sendKeys(this.config.cignaId);

      const passwordInput = await this.waitVisible(By.css('input[type="password"]'), TIMEOUTS.elementWait);
      await passwordInput.clear();
      await passwordInput.sendKeys(this.config.password);

      const loginBtn = await this.waitVisible(
        By.xpath("//button[contains(text(), 'Login')] | //input[@type='submit' and @value='Login']"),
        TIMEOUTS.elementWait
      );
      await this.safeClick(loginBtn);

      await this.waitSpinnersGone(TIMEOUTS.pageLoad);

      if (this.config.totpSecret) {
        try {
          const totpInput = await this.driver.wait(
            until.elementLocated(
              By.css('input[name="answer"], input[name="otp"], input[type="tel"][autocomplete="off"]')
            ),
            TIMEOUTS.elementWait
          );
          await this.driver.wait(until.elementIsVisible(totpInput), TIMEOUTS.elementWait);
          await totpInput.click();
          await sleep(200);
          await totpInput.clear();
          await totpInput.sendKeys(generateTOTP(this.config.totpSecret));

          const verifyBtn = await this.driver.wait(
            until.elementLocated(By.css('input[type="submit"][value="Verify"], button[data-type="save"]')),
            TIMEOUTS.elementWait
          );
          await this.safeClick(verifyBtn);
          await this.waitSpinnersGone(TIMEOUTS.pageLoad);
        } catch (err) {
          console.log("MFA handling issue:", err);
        }
      }

      const finalUrl = await this.driver.getCurrentUrl();
      return finalUrl.includes("/s/");
    } catch (err) {
      console.error("Login failed with error:", err);
      await this.captureDebugArtifacts("submit-login-error");
      return false;
    }
  }

  private async navigateToSubmitClaim(): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    await this.driver.get(CIGNA_URLS.claims);
    await this.waitSpinnersGone(TIMEOUTS.pageLoad);
    await this.dismissCookieConsent();

    const submitSelectors = [
      "//a[contains(text(), 'Submit') and contains(text(), 'Claim')]",
      "//button[contains(text(), 'Submit') and contains(text(), 'Claim')]",
      "//a[contains(text(), 'New') and contains(text(), 'Claim')]",
      "//button[contains(text(), 'New') and contains(text(), 'Claim')]",
    ];

    for (const xpath of submitSelectors) {
      try {
        const btn = await this.waitVisible(By.xpath(xpath), TIMEOUTS.elementWait);
        await this.safeClick(btn);
        await this.waitSpinnersGone(TIMEOUTS.pageLoad);
        return;
      } catch {
        // try next
      }
    }

    throw new Error("Unable to locate Submit Claim button");
  }

  private async setInputByLabel(labelText: string, value?: string): Promise<void> {
    if (!this.driver || !value) return;

    const label = await this.driver.findElement(
      By.xpath(`//label[contains(normalize-space(.), '${labelText}')]`)
    );
    const forId = await label.getAttribute("for");
    let input: WebElement | null = null;

    if (forId) {
      input = await this.driver.findElement(By.id(forId));
    } else {
      const candidate = await label.findElements(By.css("input, textarea, select"));
      if (candidate.length > 0) input = candidate[0];
    }

    if (!input) {
      input = await this.driver.findElement(
        By.xpath(`//label[contains(normalize-space(.), '${labelText}')]/following::input[1]`)
      );
    }

    await input.clear();
    await input.sendKeys(value);
  }

  private async setMultiSelectByLabel(labelText: string, values: string[]): Promise<void> {
    if (!this.driver || values.length === 0) return;
    const input = await this.driver.findElement(
      By.xpath(`//*[contains(text(), '${labelText}')]/following::input[1]`)
    );
    await input.click();
    for (const value of values) {
      await input.sendKeys(value, Key.ENTER);
      await sleep(200);
    }
  }

  private async uploadDocuments(documents: ClaimSubmissionDocument[]): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    if (documents.length === 0) return;

    const fileInput = await this.waitVisible(By.css("input[type='file']"), TIMEOUTS.elementWait);
    const paths = documents.map((doc) => doc.filePath);
    await fileInput.sendKeys(paths.join("\n"));
    await this.waitSpinnersGone(TIMEOUTS.spinnerWait);
  }

  private async confirmAndSubmit(): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");

    const submitSelectors = [
      "//button[contains(text(), 'Submit')]",
      "//button[contains(text(), 'Confirm')]",
      "//input[@type='submit' and contains(@value, 'Submit')]",
    ];

    // If pauseBeforeSubmit is enabled, highlight the button and wait for user
    if (this.config.pauseBeforeSubmit) {
      console.log("\n" + "=".repeat(60));
      console.log("🛑 PAUSED BEFORE SUBMIT - Review the form in the browser");
      console.log("=".repeat(60));
      console.log("\nThe browser is ready for submission.");
      console.log("Please review all fields, then CLICK THE SUBMIT BUTTON YOURSELF.");
      console.log("\nAfter you submit, the script will capture the result.");
      console.log("Waiting for submission confirmation page...\n");

      // Try to highlight the submit button
      for (const xpath of submitSelectors) {
        try {
          const btn = await this.driver.findElement(By.xpath(xpath));
          await this.driver.executeScript(
            `arguments[0].style.border = '4px solid red'; arguments[0].style.boxShadow = '0 0 20px red';`,
            btn
          );
          break;
        } catch {
          // continue
        }
      }

      // Wait for URL to change (indicates form was submitted)
      const currentUrl = await this.driver.getCurrentUrl();
      await this.driver.wait(async () => {
        const newUrl = await this.driver!.getCurrentUrl();
        return newUrl !== currentUrl;
      }, 300000); // 5 minute timeout for user to review and submit

      console.log("✅ Detected page change - capturing submission result...\n");
      await this.waitSpinnersGone(TIMEOUTS.pageLoad);
      return;
    }

    // Auto-submit mode
    for (const xpath of submitSelectors) {
      try {
        const btn = await this.waitVisible(By.xpath(xpath), TIMEOUTS.elementWait);
        await this.safeClick(btn);
        await this.waitSpinnersGone(TIMEOUTS.pageLoad);
        return;
      } catch {
        // try next
      }
    }

    throw new Error("Unable to locate Submit/Confirm button");
  }

  private async extractSubmissionResult(): Promise<SubmissionResult> {
    if (!this.driver) throw new Error("Driver not initialized");
    const result: SubmissionResult = { submissionUrl: await this.driver.getCurrentUrl() };

    const claimNumberSelectors = [
      "//span[contains(text(), 'Claim Number')]/following::span[1]",
      "//*[contains(text(), 'Claim Number')]/following::*[1]",
    ];
    for (const xpath of claimNumberSelectors) {
      try {
        const el = await this.driver.findElement(By.xpath(xpath));
        const text = await el.getText();
        if (text) {
          result.cignaClaimId = text.trim();
          break;
        }
      } catch {
        // ignore
      }
    }

    const submissionNumberSelectors = [
      "//span[contains(text(), 'Submission')]/following::span[1]",
      "//*[contains(text(), 'Submission')]/following::*[1]",
    ];
    for (const xpath of submissionNumberSelectors) {
      try {
        const el = await this.driver.findElement(By.xpath(xpath));
        const text = await el.getText();
        if (text) {
          result.submissionNumber = text.trim();
          break;
        }
      } catch {
        // ignore
      }
    }

    result.claimUrl = result.submissionUrl;
    return result;
  }

  async submitClaim(input: ClaimSubmissionInput): Promise<SubmissionResult> {
    if (!this.driver) throw new Error("Driver not initialized");

    await this.navigateToSubmitClaim();

    await this.setInputByLabel("Claim Type", input.claimType);
    await this.setInputByLabel("Country", input.country);
    await this.setMultiSelectByLabel("Symptoms", input.symptoms);
    await this.setInputByLabel("Provider Name", input.providerName);
    await this.setInputByLabel("Provider Address", input.providerAddress);
    await this.setInputByLabel("Provider Country", input.providerCountry);
    await this.setInputByLabel("Progress Report", input.progressReport);
    await this.setInputByLabel("Treatment Date", input.treatmentDate);

    await this.uploadDocuments(input.documents);

    await this.confirmAndSubmit();

    return this.extractSubmissionResult();
  }

  async run(input: ClaimSubmissionInput): Promise<SubmissionResult> {
    console.log("\n🚀 Starting Cigna Envoy claim submission...");
    console.log(`   Headless: ${this.config.headless}`);
    console.log(`   Pause before submit: ${this.config.pauseBeforeSubmit}\n`);

    try {
      await this.init();
      console.log("✓ Browser initialized");

      const loggedIn = await this.login();
      if (!loggedIn) {
        throw new Error("Failed to log in to Cigna Envoy");
      }
      console.log("✓ Logged in successfully");

      const result = await this.submitClaim(input);
      console.log("\n✅ Claim submitted successfully!");
      if (result.cignaClaimId) console.log(`   Cigna Claim ID: ${result.cignaClaimId}`);
      if (result.submissionNumber) console.log(`   Submission #: ${result.submissionNumber}`);
      
      return result;
    } catch (err) {
      console.error("\n❌ Submission failed:", err);
      await this.captureDebugArtifacts("submit-claim-error");

      // Keep browser open on error in non-headless mode so user can debug
      if (!this.config.headless) {
        console.log("\n⚠️  Browser kept open for debugging. Close it manually when done.");
        // Don't close - let user investigate
        throw err;
      }
      throw err;
    } finally {
      // Only auto-close in headless mode or on success
      if (this.config.headless) {
        await this.close();
      }
    }
  }

  /** Manually close the browser (call after run() in non-headless mode) */
  async cleanup(): Promise<void> {
    await this.close();
  }
}

export function createSubmitterFromEnv(): CignaSubmitter {
  const cignaId = process.env.CIGNA_ID;
  const password = process.env.CIGNA_PASSWORD;
  const totpSecret = process.env.CIGNA_TOTP_SECRET;

  if (!cignaId || !password) {
    throw new Error("CIGNA_ID and CIGNA_PASSWORD must be set");
  }

  return new CignaSubmitter({
    cignaId,
    password,
    ...(totpSecret && { totpSecret }),
  });
}
