/**
 * Cigna Envoy Claim Submitter
 *
 * Selenium-based automation for submitting new claims.
 * 
 * COMPLETELY REWRITTEN based on real browser testing (2026-01-26).
 * See data/INTERNAL_BROWSER_REPORT.md for detailed flow documentation.
 */

import { Builder, By, until, WebDriver, WebElement } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { ensureStorageDirs } from "../storage/index.js";

/** Cigna Envoy portal URLs */
const CIGNA_URLS = {
  login: "https://customer.cignaenvoy.com/CustomLogin",
  home: "https://customer.cignaenvoy.com/s/",
  newClaim: "https://customer.cignaenvoy.com/s/new-submitclaim?LanguageCode=en_GB&language=en_GB",
} as const;

/** 
 * Timeouts and delays - Cigna site is EXTREMELY SLOW
 * These values are based on real browser testing.
 */
const CIGNA_TIMING = {
  pageLoad: 60000,         // 60s max for any page load
  elementWait: 30000,      // 30s to find element
  afterNavigation: 10000,  // 10s after clicking navigation
  afterDropdown: 3000,     // 3s after opening dropdown
  afterDatePicker: 2000,   // 2s after opening date picker
  pollInterval: 2000,      // 2s between polls
} as const;

/** Expected progress values for each step */
const STEP_PROGRESS = {
  patient: 0,
  country: 14,
  claimType: 28,
  details: 42,
  symptoms: 57,
  provider: 71,
  upload: 85,
  review: 100,
} as const;

/** Debug artifacts directory */
const DEBUG_DIR = "./data/debug";

export interface SubmitterConfig {
  cignaId: string;
  password: string;
  totpSecret?: string;
  headless?: boolean;
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
  treatmentType?: string;
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
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 1_000_000).padStart(6, "0");
}

export class CignaSubmitter {
  private driver: WebDriver | null = null;
  private config: SubmitterConfig;

  constructor(config: SubmitterConfig) {
    this.config = {
      ...config,
      headless: config.headless ?? false,
      pauseBeforeSubmit: config.pauseBeforeSubmit ?? true,
    };
  }

  async init(): Promise<void> {
    await ensureStorageDirs();
    fs.mkdirSync(DEBUG_DIR, { recursive: true });

    const options = new chrome.Options();
    if (this.config.headless) {
      options.addArguments("--headless=new");
    }
    options.addArguments(
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,1024",
      "--disable-blink-features=AutomationControlled"
    );
    options.excludeSwitches("enable-automation");

    this.driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(options)
      .build();

    console.log("✓ Browser initialized");
  }

  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.quit();
      this.driver = null;
    }
  }

  /** Alias for close() for backwards compatibility */
  async cleanup(): Promise<void> {
    await this.close();
  }

  private async takeDebugScreenshot(name: string): Promise<string | null> {
    if (!this.driver) return null;
    try {
      const screenshot = await this.driver.takeScreenshot();
      const filename = `${name}-${Date.now()}.png`;
      const filepath = path.join(DEBUG_DIR, filename);
      fs.writeFileSync(filepath, screenshot, "base64");
      
      // Also save HTML
      const html = await this.driver.getPageSource();
      const htmlPath = path.join(DEBUG_DIR, `${name}.html`);
      fs.writeFileSync(htmlPath, html);
      
      return filepath;
    } catch {
      return null;
    }
  }

  /**
   * Poll until page contains specific text
   */
  private async waitForPageText(text: string, timeoutMs = CIGNA_TIMING.pageLoad): Promise<boolean> {
    if (!this.driver) return false;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const hasText = await this.driver.executeScript(
          `return document.body.textContent.includes('${text.replace(/'/g, "\\'")}');`
        );
        if (hasText) return true;
      } catch {}
      await sleep(CIGNA_TIMING.pollInterval);
    }
    return false;
  }

  /**
   * Get current progress percentage from progress bar
   */
  private async getProgress(): Promise<number> {
    if (!this.driver) return -1;
    try {
      const progressText = await this.driver.executeScript(`
        const progressEl = document.querySelector('[role="progressbar"]');
        return progressEl ? progressEl.textContent : '';
      `) as string;
      const match = progressText.match(/Progress:\s*([\d.]+)%/);
      return match ? Math.round(parseFloat(match[1])) : -1;
    } catch {
      return -1;
    }
  }

  /**
   * Wait for progress to reach expected value (with tolerance)
   */
  private async waitForProgress(expected: number, tolerance = 5): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < CIGNA_TIMING.pageLoad) {
      const progress = await this.getProgress();
      if (progress >= expected - tolerance && progress <= expected + tolerance + 20) {
        return true;
      }
      await sleep(CIGNA_TIMING.pollInterval);
    }
    return false;
  }

  /**
   * Type slowly to trigger JS validation (needed for TOTP)
   */
  private async typeSlowly(element: WebElement, text: string): Promise<void> {
    for (const char of text) {
      await element.sendKeys(char);
      await sleep(50);
    }
  }

  /**
   * Dispatch input events (needed for Okta TOTP validation)
   */
  private async dispatchInputEvents(element: WebElement): Promise<void> {
    await this.driver?.executeScript(`
      const el = arguments[0];
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    `, element);
  }

  /**
   * Login to Cigna Envoy
   */
  async login(): Promise<boolean> {
    if (!this.driver) throw new Error("Driver not initialized");
    console.log("  Logging in to Cigna Envoy...");

    await this.driver.get(CIGNA_URLS.login);
    await sleep(3000);

    // Enter credentials
    const idInput = await this.driver.wait(
      until.elementLocated(By.css('input[name="username"], input[type="text"]')),
      CIGNA_TIMING.elementWait
    );
    await idInput.clear();
    await idInput.sendKeys(this.config.cignaId);

    const pwInput = await this.driver.findElement(By.css('input[type="password"]'));
    await pwInput.clear();
    await pwInput.sendKeys(this.config.password);

    // Click login
    const loginBtn = await this.driver.findElement(By.css('button[type="submit"], button'));
    await loginBtn.click();
    console.log("  Credentials entered, waiting for response...");
    await sleep(5000);

    // Handle TOTP if needed
    const currentUrl = await this.driver.getCurrentUrl();
    if (currentUrl.includes("okta") || currentUrl.includes("mfa") || currentUrl.includes("factor")) {
      if (!this.config.totpSecret) {
        console.log("  Waiting for TOTP input...");
        await sleep(60000);
      } else {
        console.log("  Entering TOTP...");
        const totpInput = await this.driver.wait(
          until.elementLocated(By.css('input[type="text"], input[name="answer"]')),
          CIGNA_TIMING.elementWait
        );
        await totpInput.clear();
        await this.typeSlowly(totpInput, generateTOTP(this.config.totpSecret));
        await this.dispatchInputEvents(totpInput);
        await sleep(1000);

        // Click verify
        try {
          const verifyBtn = await this.driver.findElement(
            By.xpath("//button[contains(text(), 'Verify')] | //input[@type='submit']")
          );
          await verifyBtn.click();
        } catch {}
        await sleep(10000);
      }
    }

    // Wait for home page
    await this.driver.wait(until.urlContains(CIGNA_URLS.home), CIGNA_TIMING.pageLoad);
    console.log("  ✓ Logged in successfully");
    return true;
  }

  /**
   * Navigate to new claim form and wait for patient selection page
   */
  private async navigateToNewClaim(): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    console.log("  Navigating to new claim form...");
    
    await this.driver.get(CIGNA_URLS.newClaim);
    await sleep(CIGNA_TIMING.afterNavigation);
    
    // Wait for patient selection page to load
    const loaded = await this.waitForPageText("Who are you claiming for");
    if (!loaded) {
      await this.takeDebugScreenshot("nav-to-claim-failed");
      throw new Error("Failed to navigate to claim form");
    }
    console.log("  ✓ Claim form loaded");
  }

  /**
   * Step 1: Select patient using cursor:pointer detection
   */
  private async selectPatient(patientName = "EMILS PETRACENOKS"): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    console.log(`  Step 1: Selecting patient "${patientName}"...`);

    // Wait for patient cards to be visible
    await sleep(CIGNA_TIMING.afterNavigation);
    
    const loaded = await this.waitForPageText(patientName);
    if (!loaded) {
      await this.takeDebugScreenshot("patient-not-found");
      throw new Error(`Patient "${patientName}" not found on page`);
    }

    // Use JavaScript to find and click the patient card
    // Cards have cursor:pointer style on the clickable container
    const clicked = await this.driver.executeScript(`
      const allDivs = document.querySelectorAll('*');
      for (const div of allDivs) {
        const style = window.getComputedStyle(div);
        const text = div.textContent || '';
        if (style.cursor === 'pointer' && 
            text.includes('${patientName}') && 
            text.includes('Employee')) {
          const rect = div.getBoundingClientRect();
          // Must be a reasonably sized card
          if (rect.width > 200 && rect.height > 50 && rect.height < 200) {
            console.log('Found patient card:', div.tagName, rect.width, rect.height);
            div.click();
            return true;
          }
        }
      }
      return false;
    `);

    if (!clicked) {
      await this.takeDebugScreenshot("patient-click-failed");
      throw new Error("Failed to click patient card");
    }

    console.log("  Clicked patient card, waiting for next step...");
    await sleep(CIGNA_TIMING.afterNavigation);
    
    // Verify we moved to country selection (progress ~14%)
    const moved = await this.waitForPageText("Where did you receive care");
    if (!moved) {
      await this.takeDebugScreenshot("patient-select-no-nav");
      throw new Error("Patient selection did not navigate to next step");
    }
    console.log("  ✓ Patient selected");
  }

  /**
   * Step 2: Select country
   */
  private async selectCountry(country: string): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    console.log(`  Step 2: Selecting country "${country}"...`);

    // Click the country dropdown
    const dropdown = await this.driver.executeScript(`
      const combos = document.querySelectorAll('[role="combobox"]');
      for (const c of combos) {
        if (c.textContent.includes('Select a country') || c.getAttribute('aria-label')?.includes('country')) {
          c.click();
          return true;
        }
      }
      return false;
    `);

    if (!dropdown) {
      throw new Error("Country dropdown not found");
    }
    await sleep(CIGNA_TIMING.afterDropdown);

    // Select the country option
    const selected = await this.driver.executeScript(`
      const options = document.querySelectorAll('[role="option"]');
      for (const opt of options) {
        if (opt.textContent.toUpperCase().includes('${country.toUpperCase()}')) {
          opt.click();
          return true;
        }
      }
      return false;
    `);

    if (!selected) {
      throw new Error(`Country "${country}" not found in dropdown`);
    }
    await sleep(1000);

    // Click Continue
    await this.clickContinueButton();
    await sleep(CIGNA_TIMING.afterNavigation);
    
    const moved = await this.waitForPageText("Claim type");
    if (!moved) {
      await this.takeDebugScreenshot("country-no-nav");
      throw new Error("Country selection did not navigate to next step");
    }
    console.log("  ✓ Country selected");
  }

  /**
   * Step 3: Select claim type
   */
  private async selectClaimType(claimType: string): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    console.log(`  Step 3: Selecting claim type "${claimType}"...`);

    // Click claim type dropdown
    await this.driver.executeScript(`
      const combos = document.querySelectorAll('[role="combobox"]');
      for (const c of combos) {
        if (c.textContent.includes('Claim type') || c.getAttribute('aria-label')?.includes('Claim type')) {
          c.click();
          return true;
        }
      }
      // Try any combobox on the page
      if (combos.length > 0) combos[0].click();
    `);
    await sleep(CIGNA_TIMING.afterDropdown);

    // Select option
    await this.driver.executeScript(`
      const options = document.querySelectorAll('[role="option"]');
      for (const opt of options) {
        if (opt.textContent.toLowerCase().includes('${claimType.toLowerCase()}')) {
          opt.click();
          return true;
        }
      }
    `);
    await sleep(1000);

    await this.clickContinueButton();
    await sleep(CIGNA_TIMING.afterNavigation);
    
    const moved = await this.waitForPageText("outpatient or inpatient");
    if (!moved) {
      await this.takeDebugScreenshot("claim-type-no-nav");
      throw new Error("Claim type selection did not navigate to next step");
    }
    console.log("  ✓ Claim type selected");
  }

  /**
   * Step 4: Fill claim details (outpatient, treatment type, cost, date)
   */
  private async fillClaimDetails(input: ClaimSubmissionInput): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    console.log("  Step 4: Filling claim details...");

    // Select Outpatient
    await this.driver.executeScript(`
      const combos = document.querySelectorAll('[role="combobox"]');
      for (const c of combos) {
        if (c.textContent.includes('outpatient') || c.getAttribute('aria-label')?.includes('outpatient')) {
          c.click();
          return;
        }
      }
      if (combos.length > 0) combos[0].click();
    `);
    await sleep(CIGNA_TIMING.afterDropdown);

    await this.driver.executeScript(`
      const options = document.querySelectorAll('[role="option"]');
      for (const opt of options) {
        if (opt.textContent.toLowerCase().includes('outpatient')) {
          opt.click();
          return;
        }
      }
    `);
    await sleep(3000); // Wait for additional fields to appear

    // Select treatment type by clicking label
    const treatmentType = input.treatmentType || "Consultation with medical practitioner";
    console.log(`    Selecting treatment type: ${treatmentType}`);
    await this.driver.executeScript(`
      const labels = document.querySelectorAll('*');
      for (const label of labels) {
        if (label.textContent && 
            label.textContent.includes('${treatmentType.slice(0, 20)}') &&
            !label.querySelector('input')) {
          label.click();
          return true;
        }
      }
    `);
    await sleep(1000);

    // Select currency
    if (input.currency) {
      console.log(`    Selecting currency: ${input.currency}`);
      await this.driver.executeScript(`
        const combos = document.querySelectorAll('[role="combobox"]');
        for (const c of combos) {
          if (c.textContent.includes('Currency') || c.getAttribute('aria-label')?.includes('Currency')) {
            c.click();
            break;
          }
        }
      `);
      await sleep(CIGNA_TIMING.afterDropdown);

      await this.driver.executeScript(`
        const options = document.querySelectorAll('[role="option"]');
        for (const opt of options) {
          if (opt.textContent.toUpperCase().includes('${input.currency.toUpperCase()}') ||
              opt.textContent.toUpperCase().includes('STERLING')) {
            opt.click();
            return;
          }
        }
      `);
      await sleep(1000);
    }

    // Enter cost
    if (input.totalAmount) {
      console.log(`    Entering cost: ${input.totalAmount}`);
      const costInput = await this.driver.findElement(
        By.xpath("//input[contains(@aria-label, 'cost')] | //input[@placeholder]")
      );
      await costInput.clear();
      await costInput.sendKeys(String(input.totalAmount));
      await sleep(500);
    }

    // Select treatment date using date picker
    if (input.treatmentDate) {
      console.log(`    Selecting date: ${input.treatmentDate}`);
      // Click the Select Date button
      await this.driver.executeScript(`
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          if (btn.textContent.includes('Select Date')) {
            btn.click();
            return true;
          }
        }
      `);
      await sleep(CIGNA_TIMING.afterDatePicker);

      // Parse date and find the cell
      // Expected format: "15/01/2026" or "15 Jan 2026"
      const dateMatch = input.treatmentDate.match(/(\d{1,2})/);
      const dayNum = dateMatch ? dateMatch[1] : "15";
      
      // Click the day cell
      await this.driver.executeScript(`
        const cells = document.querySelectorAll('[role="gridcell"]');
        for (const cell of cells) {
          const text = cell.textContent.trim();
          if (text === '${dayNum}' && !cell.hasAttribute('disabled')) {
            cell.click();
            return true;
          }
        }
      `);
      await sleep(1000);
    }

    await this.clickContinueButton();
    await sleep(CIGNA_TIMING.afterNavigation);
    
    const moved = await this.waitForPageText("symptoms or diagnosis");
    if (!moved) {
      await this.takeDebugScreenshot("details-no-nav");
      throw new Error("Claim details did not navigate to next step");
    }
    console.log("  ✓ Claim details filled");
  }

  /**
   * Step 5: Enter symptoms/diagnosis
   */
  private async enterSymptoms(symptoms: string[]): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    console.log(`  Step 5: Entering symptoms: ${symptoms.join(", ")}...`);

    for (const symptom of symptoms.slice(0, 3)) {
      // Find and click the search combobox
      const searchBox = await this.driver.findElement(
        By.xpath("//input[@role='combobox'] | //input[contains(@placeholder, 'typing')]")
      );
      await searchBox.clear();
      await searchBox.sendKeys(symptom);
      await sleep(2000);

      // Select first result
      await this.driver.executeScript(`
        const options = document.querySelectorAll('[role="option"]');
        if (options.length > 0) {
          options[0].click();
          return true;
        }
      `);
      await sleep(1000);
    }

    await this.clickContinueButton();
    await sleep(CIGNA_TIMING.afterNavigation);
    console.log("  ✓ Symptoms entered");
  }

  /**
   * Click the Continue button
   */
  private async clickContinueButton(): Promise<void> {
    if (!this.driver) return;
    await this.driver.executeScript(`
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        if (btn.textContent.includes('Continue') && !btn.disabled) {
          btn.click();
          return true;
        }
      }
    `);
  }

  /**
   * Upload documents
   */
  private async uploadDocuments(documents: ClaimSubmissionDocument[]): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    console.log(`  Uploading ${documents.length} documents...`);

    for (const doc of documents) {
      if (!fs.existsSync(doc.filePath)) {
        console.log(`    Skipping missing file: ${doc.filePath}`);
        continue;
      }

      try {
        const fileInput = await this.driver.findElement(By.css('input[type="file"]'));
        await fileInput.sendKeys(path.resolve(doc.filePath));
        console.log(`    Uploaded: ${doc.fileName || path.basename(doc.filePath)}`);
        await sleep(3000);
      } catch (err) {
        console.log(`    Failed to upload ${doc.filePath}: ${err}`);
      }
    }
    console.log("  ✓ Documents uploaded");
  }

  /**
   * Final review and submit (or pause before submit)
   */
  private async reviewAndSubmit(): Promise<SubmissionResult> {
    if (!this.driver) throw new Error("Driver not initialized");
    console.log("  Final review...");

    if (this.config.pauseBeforeSubmit) {
      console.log("\n  ⏸️  PAUSED BEFORE SUBMIT");
      console.log("  Review the form in the browser.");
      console.log("  The submit button will be highlighted.");
      
      // Highlight submit button
      await this.driver.executeScript(`
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          if (btn.textContent.toLowerCase().includes('submit')) {
            btn.style.border = '5px solid red';
            btn.style.backgroundColor = 'yellow';
          }
        }
      `);

      console.log("  Waiting 5 minutes for manual review...");
      await sleep(300000);
    }

    // Extract result from current page
    const result: SubmissionResult = {
      submissionUrl: await this.driver.getCurrentUrl(),
    };

    // Try to find claim/submission numbers
    try {
      const pageText = await this.driver.executeScript(`return document.body.textContent;`) as string;
      
      const claimMatch = pageText.match(/[Cc]laim\s*[Nn]umber[:\s]*(\d+)/);
      if (claimMatch) result.cignaClaimId = claimMatch[1];
      
      const subMatch = pageText.match(/[Ss]ubmission\s*[Nn]umber[:\s]*(\d+)/);
      if (subMatch) result.submissionNumber = subMatch[1];
    } catch {}

    return result;
  }

  /**
   * Main submission flow
   */
  async submitClaim(input: ClaimSubmissionInput): Promise<SubmissionResult> {
    if (!this.driver) throw new Error("Driver not initialized");

    await this.navigateToNewClaim();
    await this.selectPatient(input.patientName);
    await this.selectCountry(input.country);
    await this.selectClaimType(input.claimType);
    await this.fillClaimDetails(input);
    await this.enterSymptoms(input.symptoms);
    
    // Provider details step (if applicable)
    // Document upload step
    if (input.documents.length > 0) {
      await this.uploadDocuments(input.documents);
    }

    return await this.reviewAndSubmit();
  }

  /**
   * Full run: init, login, submit, close
   */
  async run(input: ClaimSubmissionInput): Promise<SubmissionResult> {
    try {
      await this.init();
      await this.login();
      return await this.submitClaim(input);
    } finally {
      // Don't close if pausing - let user see the result
      if (!this.config.pauseBeforeSubmit) {
        await this.close();
      }
    }
  }
}
