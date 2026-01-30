/**
 * Cigna Envoy Claim Submitter
 *
 * Selenium-based automation for submitting new claims.
 *
 * COMPLETELY REWRITTEN based on real browser testing (2026-01-26).
 * See data/INTERNAL_BROWSER_REPORT.md for detailed flow documentation.
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
  pauseTimeoutMs?: number;
}

export interface ClaimSubmissionDocument {
  filePath: string;
  fileName?: string;
}

export interface ClaimSubmissionInput {
  claimType: string;
  country: string;
  symptoms: string[];
  symptomMatchMode?: "exact" | "contains" | "free_text";
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
  paused?: boolean;
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
  const lastByte = hmac[hmac.length - 1] ?? 0;
  const offset = lastByte & 0xf;
  const code =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);

  return String(code % 1_000_000).padStart(6, "0");
}

export class CignaSubmitter {
  private driver: WebDriver | null = null;
  private config: SubmitterConfig;
  private keepBrowserOpen = false;

  constructor(config: SubmitterConfig) {
    this.config = {
      ...config,
      headless: config.headless ?? false,
      pauseBeforeSubmit: config.pauseBeforeSubmit ?? true,
      pauseTimeoutMs: config.pauseTimeoutMs ?? 15 * 60 * 1000,
    };
  }

  async init(): Promise<void> {
    await ensureStorageDirs();
    fs.mkdirSync(DEBUG_DIR, { recursive: true });

    const options = new chrome.Options();
    if (this.config.headless) {
      options.addArguments("--headless=new");
    }
    const profileDir = fs.mkdtempSync(path.join(DEBUG_DIR, "chrome-profile-"));
    options.addArguments(`--user-data-dir=${profileDir}`);
    options.setUserPreferences({
      credentials_enable_service: false,
      profile: {
        password_manager_enabled: false,
      },
    });
    options.addArguments(
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,1024",
      "--disable-blink-features=AutomationControlled",
      "--disable-save-password-bubble",
      "--disable-features=PasswordManagerOnboarding,ChromePasswordManager"
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
  private async waitForPageText(text: string, timeoutMs: number = CIGNA_TIMING.pageLoad): Promise<boolean> {
    if (!this.driver) return false;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const hasText = await this.driver.executeScript(
          `return document.body.textContent.includes('${text.replace(/'/g, "\\'")}');`
        );
        if (hasText) return true;
      } catch { }
      await sleep(CIGNA_TIMING.pollInterval);
    }
    return false;
  }

  private async waitForPageTextWithLoading(
    text: string,
    timeoutMs: number = CIGNA_TIMING.pageLoad,
    extraLoadingMs: number = CIGNA_TIMING.pageLoad
  ): Promise<boolean> {
    if (!this.driver) return false;
    const start = Date.now();
    let sawLoading = false;
    const escapedText = text.replace(/'/g, "\\'");
    while (Date.now() - start < timeoutMs) {
      try {
        const bodyText = await this.driver.executeScript(
          "return document.body.textContent || '';"
        );
        if (typeof bodyText === "string") {
          if (bodyText.includes(text)) return true;
          if (bodyText.includes("Loading")) sawLoading = true;
        }
      } catch { }
      await sleep(CIGNA_TIMING.pollInterval);
    }
    if (!sawLoading) return false;
    const extraStart = Date.now();
    while (Date.now() - extraStart < extraLoadingMs) {
      try {
        const hasText = await this.driver.executeScript(
          `return document.body.textContent.includes('${escapedText}');`
        );
        if (hasText) return true;
      } catch { }
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
      const value = match?.[1];
      return value ? Math.round(parseFloat(value)) : -1;
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

  private async captureDebugContext(
    name: string,
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    if (!this.driver) return;
    try {
      const progress = await this.getProgress();
      const labelNeedle = typeof extra.labelText === "string" ? extra.labelText : null;
      const domSnapshot = await this.driver.executeScript(
        `
        function queryAllDeep(root, selector, results = []) {
          results.push(...root.querySelectorAll(selector));
          const elements = root.querySelectorAll('*');
          for (const el of elements) {
            if (el.shadowRoot) queryAllDeep(el.shadowRoot, selector, results);
          }
          return results;
        }
        function normalize(value) {
          return (value || '').replace(/\\*/g, '').replace(/\\s+/g, ' ').trim().toUpperCase();
        }
        function isVisible(el) {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
          }
          if (style.pointerEvents === 'none') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
        const labelNeedle = arguments[0] ? normalize(arguments[0]) : null;
        const listboxes = queryAllDeep(document, '[role="listbox"]').filter(isVisible);
        const listbox = listboxes[0];
        const options = Array.from(queryAllDeep(document, '[role="option"]'))
          .map((opt) => (opt.textContent || '').trim())
          .filter(Boolean);
        const comboboxes = Array.from(queryAllDeep(document, '[role="combobox"], [aria-controls], [aria-owns]'))
          .map((cb) => ({
            text: (cb.textContent || '').trim(),
            ariaLabel: cb.getAttribute('aria-label'),
            ariaLabelledBy: cb.getAttribute('aria-labelledby'),
            ariaControls: cb.getAttribute('aria-controls'),
            ariaOwns: cb.getAttribute('aria-owns'),
            visible: isVisible(cb),
          }))
          .filter((cb) => cb.text || cb.ariaLabel || cb.ariaLabelledBy);
        const labelSelectors = [
          'label',
          '.nds-form-element__label',
          '.slds-form-element__label',
          '.nds-form-element__legend',
          '.slds-form-element__legend',
        ];
        const labelMatches = labelNeedle
          ? queryAllDeep(document, labelSelectors.join(','))
              .filter((el) => normalize(el.textContent) === labelNeedle)
              .map((el) => {
                const rect = el.getBoundingClientRect();
                return {
                  text: (el.textContent || '').trim(),
                  tag: el.tagName,
                  id: el.id || null,
                  className: (el.className || '').toString().slice(0, 120),
                  visible: isVisible(el),
                  rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                };
              })
          : [];
        const textNodeMatches = [];
        if (labelNeedle) {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const text = normalize(node.textContent);
            if (!text || !text.includes(labelNeedle)) continue;
            const parent = node.parentElement;
            if (!parent) continue;
            const rect = parent.getBoundingClientRect();
            textNodeMatches.push({
              text: (node.textContent || '').trim(),
              tag: parent.tagName,
              className: (parent.className || '').toString().slice(0, 120),
              visible: isVisible(parent),
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            });
            if (textNodeMatches.length >= 20) break;
          }
        }
        const controlSelectors = [
          'button',
          '[role="combobox"]',
          '[aria-haspopup="listbox"]',
          '[aria-controls]',
          '[aria-owns]',
          'input',
          '[tabindex]'
        ];
        const controls = Array.from(
          new Set(queryAllDeep(document, controlSelectors.join(',')))
        )
          .map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              tag: el.tagName,
              role: el.getAttribute('role'),
              ariaLabel: el.getAttribute('aria-label'),
              ariaLabelledBy: el.getAttribute('aria-labelledby'),
              ariaControls: el.getAttribute('aria-controls'),
              ariaOwns: el.getAttribute('aria-owns'),
              placeholder: el.getAttribute('placeholder'),
              text: (el.textContent || '').trim().slice(0, 120),
              className: (el.className || '').toString().slice(0, 120),
              visible: isVisible(el),
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            };
          })
          .filter((cb) => cb.ariaLabel || cb.ariaLabelledBy || cb.text || cb.placeholder)
          .slice(0, 120);
        const article = document.querySelector('article');
        return {
          url: window.location.href,
          bodyText: (document.body?.innerText || '').slice(0, 2000),
          listboxHtml: listbox ? listbox.outerHTML.slice(0, 5000) : null,
          options,
          comboboxes,
          labelMatches,
          textNodeMatches,
          controlCandidates: controls,
          articleHtml: article ? article.outerHTML.slice(0, 5000) : null,
        };
      `,
        labelNeedle
      ) as Record<string, unknown>;

      const payload = {
        at: new Date().toISOString(),
        progress,
        ...extra,
        ...domSnapshot,
      };

      const filename = `${name}-${Date.now()}.json`;
      const filepath = path.join(DEBUG_DIR, filename);
      fs.writeFileSync(filepath, JSON.stringify(payload, null, 2));
    } finally {
      await this.takeDebugScreenshot(name);
    }
  }

  private async openComboboxByLabel(labelText: string): Promise<WebElement> {
    if (!this.driver) throw new Error("Driver not initialized");
    const needle = labelText.toUpperCase();
    try {
      const start = Date.now();
      while (Date.now() - start < CIGNA_TIMING.elementWait) {
        const combobox = await this.driver.executeScript(
          `
            function queryAllDeep(root, selector, results = []) {
              results.push(...root.querySelectorAll(selector));
              const elements = root.querySelectorAll('*');
              for (const el of elements) {
                if (el.shadowRoot) queryAllDeep(el.shadowRoot, selector, results);
              }
              return results;
            }
            const normalize = (value) =>
              (value || '')
                .replace(/\\*/g, '')
                .replace(/\\s+/g, ' ')
                .trim()
                .toUpperCase();
            function isVisible(el) {
              if (!el) return false;
              const style = window.getComputedStyle(el);
              if (!style) return false;
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
              }
              if (style.pointerEvents === 'none') return false;
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }
            const needle = normalize(arguments[0]);
            const controlSelectors = [
              '[role="combobox"]',
              '[aria-haspopup="listbox"]',
              '[aria-controls]',
              '[aria-owns]',
              'button',
              'input',
              '[tabindex]'
            ];
            const findClickable = (root) => {
              if (!root) return null;
              const candidates = queryAllDeep(root, controlSelectors.join(','))
                .filter((el) => isVisible(el));
              const labelled = candidates.filter((el) => {
                const ariaLabel = normalize(el.getAttribute('aria-label'));
                const placeholder = normalize(el.getAttribute('placeholder'));
                return ariaLabel.includes(needle) || placeholder.includes(needle);
              });
              if (labelled.length) return labelled[0];
              const preferred = candidates.filter((el) =>
                el.hasAttribute('aria-controls') ||
                el.hasAttribute('aria-owns') ||
                el.getAttribute('role') === 'combobox' ||
                el.getAttribute('aria-haspopup') === 'listbox'
              );
              if (preferred.length) return preferred[0];
              return candidates[0] || null;
            };
            const labelSelectors = [
              'label',
              '.nds-form-element__label',
              '.slds-form-element__label',
              '.nds-form-element__legend',
              '.slds-form-element__legend',
            ];
            const labelNodes = queryAllDeep(document, labelSelectors.join(','))
              .filter((el) => normalize(el.textContent) === needle);

            for (const labelNode of labelNodes) {
              if (labelNode.id) {
                const labelled = queryAllDeep(document, '[aria-labelledby]')
                  .find((el) => {
                    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/);
                    return ids.includes(labelNode.id);
                  });
                if (labelled && isVisible(labelled)) {
                  const clickable = findClickable(labelled) || labelled;
                  return clickable;
                }
              }
              const container =
                labelNode.closest(
                  '.nds-form-element, .slds-form-element, div, section, article, form'
                ) || labelNode.parentElement;
              if (!container) continue;
              const interactive = findClickable(container);
              if (interactive) return interactive;
            }

            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
              const text = normalize(node.textContent);
              if (!text || !text.includes(needle)) continue;
              let el = node.parentElement;
              while (el && el !== document.body) {
                const clickable = findClickable(el);
                if (clickable) return clickable;
                el = el.parentElement;
              }
            }

            const ariaLabelled = queryAllDeep(document, '[aria-label]')
              .find((el) => normalize(el.getAttribute('aria-label')).includes(needle) && isVisible(el));
            if (ariaLabelled) return ariaLabelled;

            const candidates = queryAllDeep(document, controlSelectors.join(','))
              .filter((el) => isVisible(el));
            const preferred = candidates.filter(
              (el) => el.hasAttribute('aria-controls') || el.hasAttribute('aria-owns')
            );
            if (preferred.length === 1) return preferred[0];
            if (candidates.length === 1) return candidates[0];
            return null;
          `,
          needle
        ) as WebElement | null;

        if (combobox) {
          await combobox.click();
          await sleep(CIGNA_TIMING.afterDropdown);
          return combobox;
        }
        await sleep(CIGNA_TIMING.pollInterval);
      }

      await this.captureDebugContext("combobox-not-found", { labelText });
      throw new Error(`Combobox not found for label: ${labelText}`);
    } catch (error) {
      await this.captureDebugContext("combobox-not-found", { labelText, error });
      throw new Error(`Combobox not found for label: ${labelText}`);
    }
  }

  private async selectListboxOption(
    optionText: string,
    matchMode: "equals" | "contains" = "equals"
  ): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    const normalized = optionText.toUpperCase().trim();
    const result = await this.driver.executeScript(
      `
        function queryAllDeep(root, selector, results = []) {
          results.push(...root.querySelectorAll(selector));
          const elements = root.querySelectorAll('*');
          for (const el of elements) {
            if (el.shadowRoot) queryAllDeep(el.shadowRoot, selector, results);
          }
          return results;
        }
        const optionText = arguments[0];
        const matchMode = arguments[1];
        const listboxes = queryAllDeep(document, '[role="listbox"]')
          .filter((listbox) => listbox.offsetParent !== null);
        if (listboxes.length === 0) return { ok: false, reason: 'listbox-not-found' };
        const matches = (text) => {
          const normalized = (text || '').trim().toUpperCase();
          return matchMode === 'contains'
            ? normalized.includes(optionText)
            : normalized === optionText;
        };
        for (let i = 0; i < 40; i++) {
          for (const listbox of listboxes) {
            const options = Array.from(listbox.querySelectorAll('[role="option"]'));
            const match = options.find((opt) => matches(opt.textContent));
            if (match) {
              match.scrollIntoView({ block: 'center' });
              match.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
              match.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
              match.click();
              match.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              return { ok: true, optionCount: options.length };
            }
            listbox.scrollTop += Math.max(40, Math.floor(listbox.clientHeight * 0.6));
          }
        }
        return {
          ok: false,
          reason: 'option-not-found',
          optionCount: listboxes.reduce(
            (total, listbox) => total + listbox.querySelectorAll('[role="option"]').length,
            0
          ),
        };
      `,
      normalized,
      matchMode
    ) as { ok: boolean; reason?: string; optionCount?: number };

    if (!result.ok) {
      await this.captureDebugContext("listbox-option-not-found", {
        optionText: normalized,
        matchMode,
        result,
      });
      throw new Error(`Option "${optionText}" not found in listbox`);
    }
  }

  private async selectListboxOptionForCombobox(
    combobox: WebElement,
    optionText: string,
    matchMode: "equals" | "contains" = "equals",
    labelText?: string
  ): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    const normalized = optionText.toUpperCase().trim();
    const listboxId =
      (await combobox.getAttribute("aria-controls")) ||
      (await combobox.getAttribute("aria-owns")) ||
      undefined;
    const labelledBy = (await combobox.getAttribute("aria-labelledby")) || undefined;

    const result = await this.driver.executeScript(
      `
        function queryAllDeep(root, selector, results = []) {
          results.push(...root.querySelectorAll(selector));
          const elements = root.querySelectorAll('*');
          for (const el of elements) {
            if (el.shadowRoot) queryAllDeep(el.shadowRoot, selector, results);
          }
          return results;
        }
        const listboxId = arguments[0];
        const labelledBy = arguments[1];
        const optionText = arguments[2];
        const matchMode = arguments[3];
        const labelNeedle = arguments[4];
        const matches = (text) => {
          const normalized = (text || '').trim().toUpperCase();
          return matchMode === 'contains'
            ? normalized.includes(optionText)
            : normalized === optionText;
        };

        function isVisible(el) {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
          }
          if (style.pointerEvents === 'none') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        let listbox = null;
        if (listboxId) {
          const byId = document.getElementById(listboxId);
          if (byId && isVisible(byId)) listbox = byId;
        }
        const listboxes = queryAllDeep(document, '[role="listbox"]').filter(isVisible);
        if (!listbox && labelledBy) {
          listbox = listboxes.find((lb) => lb.getAttribute('aria-labelledby') === labelledBy);
        }
        if (!listbox && labelNeedle) {
          const normalize = (value) =>
            (value || '').replace(/\\s+/g, ' ').trim().toUpperCase();
          listbox = listboxes.find((lb) => {
            const labelId = lb.getAttribute('aria-labelledby');
            if (!labelId) return false;
            const labelEl = document.getElementById(labelId);
            return normalize(labelEl?.textContent).includes(labelNeedle);
          });
        }
        if (!listbox) {
          listbox = listboxes.find((lb) => {
            const options = Array.from(lb.querySelectorAll('[role="option"]'));
            return options.some((opt) => matches(opt.textContent));
          }) || null;
        }
        if (!listbox) {
          listbox = listboxes[0] || null;
        }
        if (!listbox) return { ok: false, reason: 'listbox-not-found' };

        const options = Array.from(listbox.querySelectorAll('[role="option"]'));
        const match = options.find((opt) => matches(opt.textContent));
        if (!match) {
          return {
            ok: false,
            reason: 'option-not-found',
            optionCount: options.length,
          };
        }
        match.scrollIntoView({ block: 'center' });
        match.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        match.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        match.click();
        match.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return { ok: true, optionCount: options.length };
      `,
      listboxId ?? null,
      labelledBy ?? null,
      normalized,
      matchMode,
      labelText ? labelText.toUpperCase().trim() : null
    ) as { ok: boolean; reason?: string; optionCount?: number };

    if (!result.ok) {
      await this.captureDebugContext("listbox-option-not-found", {
        optionText: normalized,
        matchMode,
        result,
        listboxId,
        labelledBy,
      });
      throw new Error(`Option "${optionText}" not found in listbox`);
    }
  }

  private async clickCardByText(text: string): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    const needle = text.toUpperCase();
    const clicked = await this.driver.executeScript(
      `
        const needle = arguments[0];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) {
          const content = (node.textContent || '').toUpperCase();
          if (!content.includes(needle)) continue;
          let el = node.parentElement;
          while (el && el !== document.body) {
            const style = window.getComputedStyle(el);
            if (style && style.cursor === 'pointer') {
              el.click();
              return true;
            }
            el = el.parentElement;
          }
        }
        return false;
      `,
      needle
    ) as boolean;

    if (!clicked) {
      await this.captureDebugContext("patient-card-click-failed", { patient: text });
      throw new Error(`Patient card not clickable for: ${text}`);
    }
  }

  private normalizeCountryForCigna(country: string): string {
    const normalized = country.trim().toUpperCase();
    const directMap: Record<string, string> = {
      LONDON: "UNITED KINGDOM",
      UK: "UNITED KINGDOM",
      GB: "UNITED KINGDOM",
      ENGLAND: "UNITED KINGDOM",
      SCOTLAND: "UNITED KINGDOM",
      WALES: "UNITED KINGDOM",
      "NORTHERN IRELAND": "UNITED KINGDOM",
    };
    if (directMap[normalized]) return directMap[normalized];
    if (normalized.includes("UNITED KINGDOM")) return "UNITED KINGDOM";
    return normalized;
  }

  private normalizeCurrencyForCigna(currency: string): string {
    const normalized = currency.trim().toUpperCase();
    const directMap: Record<string, string> = {
      GBP: "UK POUND STERLING",
      STERLING: "UK POUND STERLING",
      POUND: "UK POUND STERLING",
      "POUND STERLING": "UK POUND STERLING",
      "UK POUND STERLING": "UK POUND STERLING",
      EUR: "EURO",
      USD: "UNITED STATES",
    };
    return directMap[normalized] ?? normalized;
  }

  private formatDateForCigna(dateInput: string): string {
    const trimmed = dateInput.trim();
    if (/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(trimmed)) return trimmed;
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slashMatch) {
      const dayPart = slashMatch[1] ?? "1";
      const monthPart = slashMatch[2] ?? "1";
      const yearPart = slashMatch[3] ?? "2000";
      const day = String(parseInt(dayPart, 10)).padStart(2, "0");
      const monthIndex = Math.max(1, Math.min(12, parseInt(monthPart, 10))) - 1;
      let year = parseInt(yearPart, 10);
      if (year < 100) year += 2000;
      return `${day} ${monthNames[monthIndex]} ${year}`;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return trimmed;
    const day = String(parsed.getUTCDate()).padStart(2, "0");
    const month = monthNames[parsed.getUTCMonth()];
    const year = String(parsed.getUTCFullYear());
    return `${day} ${month} ${year}`;
  }

  private async findInputByLabel(labelText: string): Promise<WebElement | null> {
    if (!this.driver) throw new Error("Driver not initialized");
    const input = await this.driver.executeScript(
      `
        function queryAllDeep(root, selector, results = []) {
          results.push(...root.querySelectorAll(selector));
          const elements = root.querySelectorAll('*');
          for (const el of elements) {
            if (el.shadowRoot) queryAllDeep(el.shadowRoot, selector, results);
          }
          return results;
        }
        function normalize(value) {
          return (value || '').replace(/\\*/g, '').replace(/\\s+/g, ' ').trim().toUpperCase();
        }
        function isVisible(el) {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
          }
          if (style.pointerEvents === 'none') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
        function isTextInput(el) {
          if (!el) return false;
          const tag = el.tagName ? el.tagName.toLowerCase() : '';
          if (tag === 'textarea') return true;
          if (tag !== 'input') return false;
          const type = (el.getAttribute('type') || 'text').toLowerCase();
          return !['checkbox', 'radio', 'hidden', 'submit', 'button'].includes(type);
        }
        const labelText = arguments[0];
        const needle = normalize(labelText);

        const direct = queryAllDeep(document, 'input, textarea')
          .filter((el) => isVisible(el))
          .find((el) => normalize(el.getAttribute('aria-label')).includes(needle));
        if (direct && isTextInput(direct)) {
          return direct;
        }

        const labelSelectors = [
          'label',
          '.nds-form-element__label',
          '.slds-form-element__label',
          '.nds-form-element__legend',
          '.slds-form-element__legend',
        ];
        const labelNodes = queryAllDeep(document, labelSelectors.join(','))
          .filter((el) => normalize(el.textContent) === needle);

        for (const labelNode of labelNodes) {
          if (labelNode.id) {
            const labelled = queryAllDeep(document, '[aria-labelledby]')
              .find((el) => {
                const ids = (el.getAttribute('aria-labelledby') || '').split(/\\s+/);
                return ids.includes(labelNode.id);
              });
            if (labelled && isVisible(labelled)) {
              if (isTextInput(labelled)) {
                return labelled;
              }
              const input = queryAllDeep(labelled, 'input, textarea')
                .find((el) => isVisible(el) && isTextInput(el));
              if (input) {
                return input;
              }
            }
          }
          const container =
            labelNode.closest('.nds-form-element, .slds-form-element, div, section, article, form')
            || labelNode.parentElement;
          if (!container) continue;
          const input = queryAllDeep(container, 'input, textarea')
            .find((el) => isVisible(el) && isTextInput(el));
          if (input) {
            return input;
          }
        }

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const text = normalize(node.textContent);
          if (!text || !text.includes(needle)) continue;
          let el = node.parentElement;
          while (el && el !== document.body) {
            const input = queryAllDeep(el, 'input, textarea')
              .find((candidate) => isVisible(candidate) && isTextInput(candidate));
            if (input) {
              return input;
            }
            el = el.parentElement;
          }
        }

        return null;
      `,
      labelText
    ) as WebElement | null;

    return input;
  }

  private async fillInputByLabel(labelText: string, value: string): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    const input = await this.findInputByLabel(labelText);
    if (!input) {
      await this.captureDebugContext("input-not-found", { labelText });
      throw new Error(`Input not found for label: ${labelText}`);
    }
    await this.driver.executeScript(
      `
        const el = arguments[0];
        el.focus();
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      `,
      input
    );
    await this.typeSlowly(input, value);
    await this.dispatchInputEvents(input);
  }

  private async readInputValueByLabel(labelText: string): Promise<string | null> {
    if (!this.driver) throw new Error("Driver not initialized");
    const input = await this.findInputByLabel(labelText);
    if (!input) return null;
    const value = await input.getAttribute("value");
    return value?.trim() ?? null;
  }

  private async findSymptomInput(): Promise<WebElement> {
    if (!this.driver) throw new Error("Driver not initialized");
    const start = Date.now();
    while (Date.now() - start < CIGNA_TIMING.elementWait) {
      const input = await this.driver.executeScript(
        `
          function queryAllDeep(root, selector, results = []) {
            results.push(...root.querySelectorAll(selector));
            const elements = root.querySelectorAll('*');
            for (const el of elements) {
              if (el.shadowRoot) queryAllDeep(el.shadowRoot, selector, results);
            }
            return results;
          }
          function isVisible(el) {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              return false;
            }
            if (style.pointerEvents === 'none') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }
          const needles = ['symptom', 'diagnosis'];
          const inputs = queryAllDeep(document, 'input, textarea').filter(isVisible);
          const isTextInput = (el) => {
            const tag = (el.tagName || '').toLowerCase();
            if (tag === 'textarea') return true;
            if (tag !== 'input') return false;
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            return !['checkbox', 'radio', 'hidden', 'submit', 'button'].includes(type);
          };
          const textInputs = inputs.filter(isTextInput);
          const direct = textInputs.find((el) => {
            const label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').toLowerCase();
            return needles.some((needle) => label.includes(needle));
          });
          if (direct) return direct;
          if (textInputs.length === 1) return textInputs[0];

          const labelSelectors = [
            'label',
            '.nds-form-element__label',
            '.slds-form-element__label',
            '.nds-form-element__legend',
            '.slds-form-element__legend',
          ];
          const labelNodes = queryAllDeep(document, labelSelectors.join(','))
            .filter((el) => (el.textContent || '').toLowerCase().includes('symptom'));
          for (const labelNode of labelNodes) {
            const container =
              labelNode.closest('.nds-form-element, .slds-form-element, div, section, article, form')
              || labelNode.parentElement;
            if (!container) continue;
            const input = queryAllDeep(container, 'input, textarea')
              .find((el) => isVisible(el) && isTextInput(el));
            if (input) return input;
          }

          const comboboxes = queryAllDeep(document, '[role="combobox"]').filter(isVisible);
          const combo = comboboxes.find((el) => {
            const label = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
            return needles.some((needle) => label.includes(needle));
          });
          if (combo) {
            const innerInput = combo.querySelector('input, textarea');
            return innerInput || combo;
          }
          return null;
        `
      ) as WebElement | null;
      if (input) return input;
      await sleep(CIGNA_TIMING.pollInterval);
    }

    await this.captureDebugContext("symptom-input-not-found");
    throw new Error("Symptom input not found");
  }

  private async clickSymptomSearchButton(input: WebElement): Promise<void> {
    if (!this.driver) return;
    await this.driver.executeScript(
      `
        const input = arguments[0];
        const container =
          input.closest('div, section, article, form') || input.parentElement;
        if (!container) return false;
        const candidates = container.querySelectorAll('button, [role="button"]');
        for (const btn of candidates) {
          const label = (btn.getAttribute('aria-label') || btn.title || btn.textContent || '').toLowerCase();
          if (label.includes('search') || label.includes('find')) {
            btn.click();
            return true;
          }
        }
        return false;
      `,
      input
    );
  }

  private async selectSymptomOption(
    label: string,
    matchMode: "exact" | "contains" = "exact"
  ): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    const normalized = label.trim().toUpperCase();
    const start = Date.now();
    while (Date.now() - start < CIGNA_TIMING.elementWait) {
      const result = await this.driver.executeScript(
        `
          function queryAllDeep(root, selector, results = []) {
            results.push(...root.querySelectorAll(selector));
            const elements = root.querySelectorAll('*');
            for (const el of elements) {
              if (el.shadowRoot) queryAllDeep(el.shadowRoot, selector, results);
            }
            return results;
          }
          const optionText = arguments[0];
          const matchMode = arguments[1];
          const options = queryAllDeep(document, '[role="option"]');
          const matches = (text) => {
            const normalized = (text || '').trim().toUpperCase();
            return matchMode === 'contains'
              ? normalized.includes(optionText)
              : normalized === optionText;
          };
          const match = options.find((opt) => {
            const text = opt.textContent || opt.getAttribute('data-label') || opt.getAttribute('title') || '';
            return matches(text);
          });
          if (match) {
            match.scrollIntoView({ block: 'center' });
            match.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            match.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            match.click();
            match.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return { ok: true };
          }

          const allNodes = queryAllDeep(document, 'li, div, span, button, [role="button"]');
          const matchNode = allNodes.find((el) => matches(el.textContent));
          if (!matchNode) {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            while (node = walker.nextNode()) {
              const text = (node.textContent || '').trim().toUpperCase();
              if (!text) continue;
              if (!matches(text)) continue;
              let el = node.parentElement;
              if (el) {
                el.scrollIntoView({ block: 'center' });
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                el.click();
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                return { ok: true };
              }
            }
            return { ok: false };
          }
          let clickable = matchNode;
          while (clickable && clickable !== document.body) {
            const role = clickable.getAttribute?.('role');
            const style = window.getComputedStyle(clickable);
            if (role === 'option' || role === 'button' || style.cursor === 'pointer') {
              break;
            }
            clickable = clickable.parentElement;
          }
          const target = clickable || matchNode;
          target.scrollIntoView({ block: 'center' });
          target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          target.click();
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return { ok: true };
        `,
        normalized,
        matchMode
      ) as { ok: boolean };
      if (result.ok) return;
      await sleep(CIGNA_TIMING.pollInterval);
    }
    await this.captureDebugContext("symptom-option-not-found", { label });
    throw new Error(`Symptom option "${label}" not found`);
  }

  private async selectNotOnListOption(): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    const start = Date.now();
    while (Date.now() - start < CIGNA_TIMING.elementWait) {
      const clicked = await this.driver.executeScript(
        `
          function queryAllDeep(root, selector, results = []) {
            results.push(...root.querySelectorAll(selector));
            const elements = root.querySelectorAll('*');
            for (const el of elements) {
              if (el.shadowRoot) queryAllDeep(el.shadowRoot, selector, results);
            }
            return results;
          }
          const normalize = (value) => (value || '').toLowerCase();
          const options = queryAllDeep(document, '[role="option"]');
          const matchOption = options.find((opt) => {
            const text = normalize(opt.textContent);
            return text.includes('not on the list') || text.includes('not on list');
          });
          if (matchOption) {
            matchOption.scrollIntoView({ block: 'center' });
            matchOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            matchOption.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            matchOption.click();
            matchOption.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return true;
          }

          const allElements = queryAllDeep(document, 'button, [role="button"], a, div, span, li');
          const matchNode = allElements.find((el) => {
            const text = normalize(el.textContent);
            return text.includes('not on the list') || text.includes('not on list');
          });
          if (!matchNode) return false;
          matchNode.scrollIntoView({ block: 'center' });
          matchNode.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          matchNode.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          matchNode.click();
          matchNode.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return true;
        `
      ) as boolean;
      if (clicked) return;
      await sleep(CIGNA_TIMING.pollInterval);
    }
    await this.captureDebugContext("symptom-option-not-found");
    throw new Error('Symptom option "not on the list" not found');
  }

  private async findFileInputElement(): Promise<WebElement | null> {
    if (!this.driver) return null;
    const input = await this.driver.executeScript(
      `
        function findFileInput(root) {
          const inputs = root.querySelectorAll('input[type="file"]');
          if (inputs.length > 0) return inputs[0];
          const elements = root.querySelectorAll('*');
          for (const el of elements) {
            if (el.shadowRoot) {
              const found = findFileInput(el.shadowRoot);
              if (found) return found;
            }
          }
          return null;
        }
        return findFileInput(document);
      `
    ) as WebElement | null;
    return input;
  }

  private async clickUploadFilesButton(): Promise<boolean> {
    if (!this.driver) return false;
    const clicked = await this.driver.executeScript(
      `
        function queryAllDeep(root, selector, results = []) {
          results.push(...root.querySelectorAll(selector));
          const elements = root.querySelectorAll('*');
          for (const el of elements) {
            if (el.shadowRoot) queryAllDeep(el.shadowRoot, selector, results);
          }
          return results;
        }
        const buttons = queryAllDeep(document, 'button, [role="button"]');
        const target = buttons.find((btn) =>
          /upload files/i.test((btn.textContent || '').trim())
        );
        if (!target) return false;
        target.scrollIntoView({ block: 'center' });
        target.click();
        return true;
      `
    );
    return Boolean(clicked);
  }

  private async clickUploadDialogDone(): Promise<boolean> {
    if (!this.driver) return false;
    const clicked = await this.driver.executeScript(
      `
        function queryAllDeep(root, selector, results = []) {
          results.push(...root.querySelectorAll(selector));
          const elements = root.querySelectorAll('*');
          for (const el of elements) {
            if (el.shadowRoot) queryAllDeep(el.shadowRoot, selector, results);
          }
          return results;
        }
        const dialogs = queryAllDeep(document, '[role="dialog"]');
        for (const dialog of dialogs) {
          const buttons = dialog.querySelectorAll('button, [role="button"]');
          for (const btn of buttons) {
            const text = (btn.textContent || '').trim();
            if (text === 'Done') {
              btn.click();
              return true;
            }
          }
        }
        return false;
      `
    );
    return Boolean(clicked);
  }

  private async waitForSymptomsStep(
    timeoutMs: number = CIGNA_TIMING.pageLoad * 2
  ): Promise<boolean> {
    if (!this.driver) return false;
    const start = Date.now();
    let sawLoading = false;
    while (Date.now() - start < timeoutMs) {
      try {
        const bodyText = await this.driver.executeScript(
          "return (document.body.textContent || '').toLowerCase();"
        ) as string;
        if (bodyText.includes("symptom") || bodyText.includes("diagnosis")) {
          return true;
        }
        if (bodyText.includes("loading")) sawLoading = true;
      } catch { }
      const progress = await this.getProgress();
      if (progress >= STEP_PROGRESS.symptoms - 3) return true;
      await sleep(CIGNA_TIMING.pollInterval);
    }
    if (!sawLoading) return false;
    const extraStart = Date.now();
    while (Date.now() - extraStart < CIGNA_TIMING.pageLoad * 2) {
      try {
        const bodyText = await this.driver.executeScript(
          "return (document.body.textContent || '').toLowerCase();"
        ) as string;
        if (bodyText.includes("symptom") || bodyText.includes("diagnosis")) {
          return true;
        }
      } catch { }
      const progress = await this.getProgress();
      if (progress >= STEP_PROGRESS.symptoms - 3) return true;
      await sleep(CIGNA_TIMING.pollInterval);
    }
    return false;
  }

  private async checkCheckboxByLabel(labelText: string): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    const needle = labelText.toUpperCase();
    const checked = await this.driver.executeScript(
      `
        function queryAllDeep(root, selector, results = []) {
          results.push(...root.querySelectorAll(selector));
          const elements = root.querySelectorAll('*');
          for (const el of elements) {
            if (el.shadowRoot) queryAllDeep(el.shadowRoot, selector, results);
          }
          return results;
        }
        const needle = arguments[0];
        const normalize = (value) =>
          (value || '').replace(/\\s+/g, ' ').trim().toUpperCase();
        const candidates = queryAllDeep(document, 'input[type="checkbox"], [role="checkbox"]');

        for (const checkbox of candidates) {
          const ariaLabel = normalize(checkbox.getAttribute?.('aria-label'));
          if (ariaLabel && ariaLabel.includes(needle)) {
            checkbox.click();
            return true;
          }
          const container =
            checkbox.closest('label, div, span, li') || checkbox.parentElement;
          const containerText = normalize(container?.textContent);
          if (containerText && containerText.includes(needle)) {
            checkbox.click();
            return true;
          }
        }

        // Fallback: find text node then locate nearest checkbox
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) {
          const text = normalize(node.textContent);
          if (!text.includes(needle)) continue;
          let el = node.parentElement;
          while (el && el !== document.body) {
            const input = el.querySelector('input[type="checkbox"]');
            if (input) {
              input.click();
              return true;
            }
            el = el.parentElement;
          }
        }
        return false;
      `,
      needle
    ) as boolean;

    if (!checked) {
      await this.captureDebugContext("checkbox-not-found", { labelText });
      throw new Error(`Checkbox not found for label: ${labelText}`);
    }
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
   * Dismiss any cookie consent dialogs - uses JS click since elements may be in shadow DOM
   */
  private async dismissCookieConsent(): Promise<void> {
    if (!this.driver) return;
    console.log("  Checking for cookie consent dialog...");

    // Wait a bit for the dialog to appear
    await sleep(3000);

    try {
      // Try multiple strategies to dismiss cookie consent using JavaScript clicks
      for (let attempt = 0; attempt < 3; attempt++) {
        const dismissed = await this.driver.executeScript(`
          // Strategy 1: Click "Allow All" button in privacy preference center
          const allButtons = document.querySelectorAll('button, [role="button"], a');
          for (const btn of allButtons) {
            const text = (btn.textContent || '').toLowerCase();
            const isVisible = btn.offsetParent !== null || window.getComputedStyle(btn).display !== 'none';
            if (!isVisible) continue;

            if (text.includes('allow all') ||
                text.includes('accept all cookies') ||
                text === 'accept all') {
              console.log('Clicking cookie button:', text);
              btn.click();
              return 'clicked: ' + text.trim();
            }
          }

          // Strategy 2: Try clicking the specific "Allow All" button by aria-label or class
          const allowAllBtns = document.querySelectorAll('[title*="Allow"], [aria-label*="Allow"], .onetrust-accept-btn-handler');
          for (const btn of allowAllBtns) {
            btn.click();
            return 'clicked allow btn';
          }

          // Strategy 3: Close any OneTrust or similar cookie banner
          const bannerCloses = document.querySelectorAll('#onetrust-accept-btn-handler, .onetrust-close-btn-handler, [id*="accept"]');
          for (const btn of bannerCloses) {
            btn.click();
            return 'clicked banner close';
          }

          return null;
        `);

        if (dismissed) {
          console.log(`    Cookie consent: ${dismissed}`);
          await sleep(2000);
          return;
        }

        await sleep(1000);
      }

      // Last resort: press Escape key to close any modal
      try {
        const body = await this.driver.findElement(By.css('body'));
        await body.sendKeys('\uE00C'); // Escape key
        console.log("    Sent Escape key to dismiss dialog");
        await sleep(1000);
      } catch { }

      console.log("    No cookie dialog found or dismissed via Escape");
    } catch (err) {
      console.log("    Cookie dialog handler error:", err);
    }
  }

  /**
   * Login to Cigna Envoy
   */
  async login(): Promise<boolean> {
    if (!this.driver) throw new Error("Driver not initialized");
    console.log("  Logging in to Cigna Envoy...");

    await this.driver.get(CIGNA_URLS.login);
    await sleep(5000);  // Extra wait for slow page

    // Handle cookie consent popup first - may need multiple attempts
    await this.dismissCookieConsent();
    await sleep(2000);
    await this.dismissCookieConsent();  // Second attempt in case first failed

    // Also try clicking outside any modal
    try {
      await this.driver.executeScript(`
        // Click the main content area to dismiss any overlay
        const mainContent = document.querySelector('main, .main-content, body');
        if (mainContent) {
          const rect = mainContent.getBoundingClientRect();
          // Simulate click at the login form area (lower left, away from modal)
          const evt = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: 200,
            clientY: rect.bottom - 100
          });
          mainContent.dispatchEvent(evt);
        }
      `);
    } catch { }
    await sleep(1000);

    // Enter credentials using JavaScript to avoid element not interactable errors
    console.log("  Entering credentials...");
    try {
      await this.driver.executeScript(`
        const usernameInput = document.querySelector('input[name="username"], input[type="text"]:not([type="password"])');
        if (usernameInput) {
          usernameInput.focus();
          usernameInput.value = '${this.config.cignaId}';
          usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
          usernameInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const passwordInput = document.querySelector('input[type="password"]');
        if (passwordInput) {
          passwordInput.focus();
          passwordInput.value = '${this.config.password}';
          passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
          passwordInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      `);
    } catch (err) {
      console.log("  JS credential entry failed, trying Selenium...");
      await this.takeDebugScreenshot("login-js-failed");

      // Fallback to Selenium
      const idInput = await this.driver.wait(
        until.elementLocated(By.css('input[name="username"], input[type="text"]')),
        CIGNA_TIMING.elementWait
      );
      await idInput.clear();
      await idInput.sendKeys(this.config.cignaId);
    }

    await sleep(500);

    // Click login button using JavaScript
    console.log("  Clicking login button...");
    await this.driver.executeScript(`
      const loginBtn = document.querySelector('button[type="submit"], button.login-button, input[type="submit"]');
      if (loginBtn) {
        loginBtn.click();
      } else {
        // Try finding any button that says "Login"
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent.toLowerCase().includes('login') || btn.textContent.toLowerCase().includes('sign in')) {
            btn.click();
            break;
          }
        }
      }
    `);
    console.log("  Credentials entered, waiting for response...");
    await sleep(8000);  // Longer wait for slow site

    // Handle TOTP if needed - check for various MFA/2FA URL patterns
    const currentUrl = await this.driver.getCurrentUrl();
    console.log("  Current URL after login:", currentUrl);

    const needsTOTP = currentUrl.includes("okta") ||
      currentUrl.includes("mfa") ||
      currentUrl.includes("factor") ||
      currentUrl.includes("verify") ||
      currentUrl.includes("totp") ||
      currentUrl.includes("authenticator") ||
      currentUrl.includes("signin");

    if (needsTOTP) {
      if (!this.config.totpSecret) {
        console.log("  No TOTP secret provided, waiting 60s for manual input...");
        await sleep(60000);
      } else {
        console.log("  Entering TOTP code...");
        await sleep(3000);  // Wait for page to fully load

        // Generate TOTP code
        const totpCode = generateTOTP(this.config.totpSecret);
        console.log("  Generated TOTP code:", totpCode);

        // Find the TOTP input - try multiple selectors
        let totpInput;
        try {
          // Try the most common selector first
          totpInput = await this.driver.wait(
            until.elementLocated(By.css('input[type="text"], input[name="code"], input[name="answer"], input[id*="code"], input[placeholder*="code"]')),
            CIGNA_TIMING.elementWait
          );
        } catch {
          console.log("  Couldn't find TOTP input with CSS, trying JS...");
          await this.takeDebugScreenshot("totp-input-not-found");
        }

        if (totpInput) {
          await totpInput.clear();
          await this.typeSlowly(totpInput, totpCode);
          await this.dispatchInputEvents(totpInput);
          await sleep(1000);
        } else {
          // Try using JavaScript to enter the code
          await this.driver.executeScript(`
            const inputs = document.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"]');
            for (const input of inputs) {
              if (input.offsetParent !== null) {  // Is visible
                input.focus();
                input.value = '${totpCode}';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                break;
              }
            }
          `);
          await sleep(1000);
        }

        // Click verify button using JavaScript (more reliable)
        console.log("  Clicking Verify button...");
        await this.driver.executeScript(`
          const buttons = document.querySelectorAll('button, input[type="submit"]');
          for (const btn of buttons) {
            const text = (btn.textContent || btn.value || '').toLowerCase();
            if (text.includes('verify') || text.includes('submit') || text.includes('continue')) {
              btn.click();
              break;
            }
          }
        `);
        await sleep(15000);  // Wait for verification and redirect
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
   * Step 1: Select patient using multiple strategies
   *
   * Patient cards show:
   * - Role: "Employee" (main insured) or "Member" (dependent)
   * - Name in UPPERCASE
   * - Date of birth in "DD MMM YYYY" format
   */
  private async selectPatient(patientName = "EMILS PETRACENOKS"): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    console.log(`  Step 1: Selecting patient "${patientName}"...`);

    await sleep(CIGNA_TIMING.afterNavigation);

    const normalizedName = patientName.toUpperCase();
    const loaded = await this.waitForPageText(normalizedName);
    if (!loaded) {
      await this.captureDebugContext("patient-not-found", { patientName });
      throw new Error(`Patient "${patientName}" not found on page`);
    }

    await this.clickCardByText(patientName);
    await sleep(CIGNA_TIMING.afterNavigation);

    const moved = await this.waitForPageText("Where did you receive care");
    if (!moved) {
      await this.captureDebugContext("patient-select-no-nav", { patientName });
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

    await sleep(CIGNA_TIMING.afterNavigation);

    const onPage = await this.waitForPageText("Where did you receive care");
    if (!onPage) {
      await this.captureDebugContext("country-page-not-found", { country });
      throw new Error("Country selection page not detected");
    }

    const normalizedCountry = this.normalizeCountryForCigna(country);
    const combobox = await this.openComboboxByLabel("Select a country/area");
    await this.selectListboxOptionForCombobox(
      combobox,
      normalizedCountry,
      "equals",
      "Select a country/area"
    );
    await this.clickContinueButton("country");
    await sleep(CIGNA_TIMING.afterNavigation);

    const moved = await this.waitForPageText("Claim type");
    if (!moved) {
      await this.captureDebugContext("country-no-nav", { country: normalizedCountry });
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

    const normalizedClaimType = claimType.toUpperCase();
    const combobox = await this.openComboboxByLabel("Claim type");
    await this.selectListboxOptionForCombobox(
      combobox,
      normalizedClaimType,
      "equals",
      "Claim type"
    );
    await this.clickContinueButton("claim-type");
    await sleep(CIGNA_TIMING.afterNavigation);

    const moved = await this.waitForPageText("outpatient or inpatient");
    if (!moved) {
      await this.captureDebugContext("claim-type-no-nav", { claimType: normalizedClaimType });
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
    const stayCombobox = await this.openComboboxByLabel("outpatient or inpatient");
    await this.selectListboxOptionForCombobox(
      stayCombobox,
      "OUTPATIENT",
      "equals",
      "outpatient"
    );
    await sleep(3000); // Wait for additional fields to appear

    // Select treatment type by clicking label
    const treatmentType =
      input.treatmentType || "Consultation with medical practitioner and specialist";
    console.log(`    Selecting treatment type: ${treatmentType}`);
    await this.checkCheckboxByLabel(treatmentType);
    await sleep(1000);

    // Select currency
    if (input.currency) {
      const normalizedCurrency = this.normalizeCurrencyForCigna(input.currency);
      console.log(`    Selecting currency: ${normalizedCurrency}`);
      const currencyCombobox = await this.openComboboxByLabel("Currency");
      await this.selectListboxOptionForCombobox(
        currencyCombobox,
        normalizedCurrency,
        "contains",
        "Currency"
      );
      await sleep(1000);
    }

    // Enter cost
    if (input.totalAmount) {
      console.log(`    Entering cost: ${input.totalAmount}`);
      await this.fillInputByLabel("What was the cost?", String(input.totalAmount));
      await sleep(500);
      const costValue = await this.readInputValueByLabel("What was the cost?");
      if (!costValue) {
        console.log("    Cost value missing after fill, retrying...");
        await this.fillInputByLabel("What was the cost?", String(input.totalAmount));
        await sleep(500);
      }
    }

    // Enter treatment date directly to avoid date picker issues
    if (input.treatmentDate) {
      const formattedDate = this.formatDateForCigna(input.treatmentDate);
      console.log(`    Entering date: ${formattedDate}`);
      await this.fillInputByLabel("What was the earliest treatment date?", formattedDate);
      await sleep(1000);
      const dateValue = await this.readInputValueByLabel("What was the earliest treatment date?");
      if (!dateValue) {
        console.log("    Date value missing after fill, retrying...");
        await this.fillInputByLabel("What was the earliest treatment date?", formattedDate);
        await sleep(1000);
      }
    }

    // Nudge validation by defocusing inputs
    await this.driver.executeScript(`
      const heading = document.querySelector('h1, h2, h3, .nds-card__header');
      if (heading) heading.click();
    `);
    await sleep(500);

    await this.clickContinueButton("details");
    await sleep(CIGNA_TIMING.afterNavigation);

    const moved = await this.waitForSymptomsStep(CIGNA_TIMING.pageLoad * 2);
    if (!moved) {
      await this.captureDebugContext("details-no-nav");
      throw new Error("Claim details did not navigate to next step");
    }
    console.log("  ✓ Claim details filled");
  }

  /**
   * Step 5: Enter symptoms/diagnosis
   *
   * Based on internal browser testing (2026-01-27):
   * - We must select exact symptom + diagnosis options from the list
   * - No fallbacks: missing options must abort submission
   */
  private async enterSymptoms(symptoms: string[]): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    console.log(`  Step 5: Entering symptoms: ${symptoms.join(", ")}...`);

    const cleanedSymptoms = symptoms
      .map((symptom) => symptom.trim())
      .filter(Boolean)
      .slice(0, 3);

    if (cleanedSymptoms.length === 0) {
      throw new Error("No symptoms provided for submission");
    }

    for (const symptom of cleanedSymptoms) {
      console.log(`    Selecting symptom option: "${symptom}"...`);
      const input = await this.findSymptomInput();
      await this.driver.executeScript(
        `
          const el = arguments[0];
          el.focus();
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        `,
        input
      );
      await this.typeSlowly(input, symptom);
      await this.dispatchInputEvents(input);
      await this.clickSymptomSearchButton(input);
      await sleep(600);
      await this.selectSymptomOption(symptom, "exact");
      await sleep(1500);
    }

    await this.clickContinueButton("symptoms");
    await sleep(CIGNA_TIMING.afterNavigation);

    const moved = await this.waitForPageText("another insurer");
    if (!moved) {
      await this.captureDebugContext("symptoms-no-nav");
    }

    console.log("  ✓ Symptoms entered");
  }

  /**
   * Step 5b: Handle "other insurer liability" question
   * This appears after symptoms: "Could another insurer be liable for all or part of this claim?"
   */
  private async handleOtherInsurer(): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    console.log("  Step 5b: Handling other insurer question...");

    // Check if we're on this page
    const onPage = await this.waitForPageText("another insurer", 10000);
    if (!onPage) {
      console.log("    (Other insurer page not found, skipping)");
      return;
    }

    // Click "No" option - we're not claiming from another insurer
    const clicked = await this.driver.executeScript(
      `
        function queryAllDeep(root, selector, results = []) {
          results.push(...root.querySelectorAll(selector));
          const elements = root.querySelectorAll('*');
          for (const el of elements) {
            if (el.shadowRoot) queryAllDeep(el.shadowRoot, selector, results);
          }
          return results;
        }
        function clickByText(target) {
          const normalized = target.trim().toUpperCase();
          const candidates = queryAllDeep(document, 'button, [role="button"], label, span, div');
          const match = candidates.find((el) => (el.textContent || '').trim().toUpperCase() === normalized);
          if (!match) return false;
          let clickable = match;
          while (clickable && clickable !== document.body) {
            const role = clickable.getAttribute?.('role');
            const style = window.getComputedStyle(clickable);
            if (role === 'button' || style.cursor === 'pointer' || clickable.tagName === 'BUTTON') {
              break;
            }
            clickable = clickable.parentElement;
          }
          const targetEl = clickable || match;
          targetEl.scrollIntoView({ block: 'center' });
          targetEl.click();
          return true;
        }
        return clickByText('No');
      `
    );

    if (!clicked) {
      console.log("    Warning: No button not found");
    }

    await sleep(CIGNA_TIMING.afterNavigation);

    // Some flows require hitting Continue after selecting No.
    const movedDirect = await this.waitForPageText("upload all documents", 8000);
    if (!movedDirect) {
      try {
        await this.clickContinueButton("other-insurer");
        await sleep(CIGNA_TIMING.afterNavigation);
      } catch (err) {
        await this.captureDebugContext("other-insurer-continue-failed");
        throw err;
      }
    }

    const moved = await this.waitForPageText("upload all documents", CIGNA_TIMING.elementWait);
    if (!moved) {
      await this.captureDebugContext("other-insurer-no-nav");
      throw new Error("Other insurer step did not navigate to upload page");
    }

    console.log("  ✓ Other insurer handled (selected No)");
  }

  /**
   * Click the Continue button
   */
  private async clickContinueButton(context: string): Promise<void> {
    if (!this.driver) return;
    const start = Date.now();
    while (Date.now() - start < CIGNA_TIMING.elementWait) {
      const result = await this.driver.executeScript(`
        function queryAllDeep(root, selector, results = []) {
          results.push(...root.querySelectorAll(selector));
          const elements = root.querySelectorAll('*');
          for (const el of elements) {
            if (el.shadowRoot) queryAllDeep(el.shadowRoot, selector, results);
          }
          return results;
        }
        const normalize = (value) =>
          (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const isDisabled = (el) => {
          if (!el) return false;
          if (el.disabled) return true;
          const aria = (el.getAttribute('aria-disabled') || '').toLowerCase();
          if (aria === 'true') return true;
          const cls = (el.className || '').toString().toLowerCase();
          return cls.includes('disabled');
        };
        const isVisible = (el) => el && el.getClientRects().length > 0;
        const buttons = queryAllDeep(document, 'button, [role="button"]');
        const candidates = buttons.filter((btn) => normalize(btn.textContent) === 'continue');
        if (candidates.length === 0) {
          const textNodes = queryAllDeep(document, 'div, span, a, p, li');
          const label = textNodes.find(
            (el) => isVisible(el) && normalize(el.textContent) === 'continue'
          );
          if (!label) {
            return {
              ok: false,
              reason: 'not-found',
              buttons: buttons.slice(0, 10).map((btn) => ({
                text: btn.textContent?.trim(),
                disabled: btn.disabled,
                ariaDisabled: btn.getAttribute('aria-disabled'),
              })),
            };
          }
          let clickable = label;
          while (clickable && clickable !== document.body) {
            const role = clickable.getAttribute?.('role');
            const style = window.getComputedStyle(clickable);
            if (role === 'button' || style.cursor === 'pointer') break;
            clickable = clickable.parentElement;
          }
          const target = clickable || label;
          if (isDisabled(target)) {
            return { ok: false, reason: 'disabled', selected: { text: label.textContent?.trim() } };
          }
          target.scrollIntoView({ block: 'center' });
          target.click();
          return { ok: true };
        }
        const visible = candidates.find((btn) => btn.getClientRects().length > 0);
        const btn = visible || candidates[0];
        const disabled = isDisabled(btn);
        if (disabled) {
          return {
            ok: false,
            reason: 'disabled',
            selected: {
              text: btn.textContent?.trim(),
              disabled,
              ariaDisabled: btn.getAttribute('aria-disabled'),
            },
          };
        }
        btn.scrollIntoView({ block: 'center' });
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        btn.click();
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return { ok: true };
      `) as { ok: boolean; reason?: string; buttons?: unknown; selected?: unknown };

      if (result.ok) return;
      await sleep(CIGNA_TIMING.pollInterval);
    }

    await this.captureDebugContext(`continue-${context}`, { context });
    throw new Error(`Continue button not clickable (${context})`);
  }

  /**
   * Upload documents
   *
   * Cigna uses a hidden file input (slds-assistive-text class) INSIDE SHADOW DOM
   * with a visible label overlay. We need to find it by searching shadow roots,
   * then use sendKeys() to upload.
   *
   * Allowed: .bmp .pdf .png .jpg .jpeg .gif
   * Max individual: 6 MB
   * Max total: 30 MB
   */
  private async uploadDocuments(documents: ClaimSubmissionDocument[]): Promise<void> {
    if (!this.driver) throw new Error("Driver not initialized");
    console.log(`  Step 6: Uploading ${documents.length} documents...`);

    // Wait for upload page to fully load
    const loaded = await this.waitForPageText("upload all documents");
    if (!loaded) {
      console.log("    Warning: Upload page text not found, continuing anyway...");
    }

    for (const doc of documents) {
      const absPath = path.resolve(doc.filePath);

      if (!fs.existsSync(absPath)) {
        console.log(`    ⚠ Skipping missing file: ${absPath}`);
        continue;
      }

      // Check file extension
      const ext = path.extname(absPath).toLowerCase();
      const allowedExts = [".bmp", ".pdf", ".png", ".jpg", ".jpeg", ".gif"];
      if (!allowedExts.includes(ext)) {
        console.log(`    ⚠ Skipping unsupported file type: ${ext} (${absPath})`);
        continue;
      }

      // Check file size (6 MB max)
      const stats = fs.statSync(absPath);
      if (stats.size > 6 * 1024 * 1024) {
        console.log(`    ⚠ Skipping file over 6MB: ${absPath} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
        continue;
      }

      try {
        // Ensure the upload control is present (some flows require clicking "Upload Files")
        let fileInput = await this.findFileInputElement();
        if (!fileInput) {
          console.log("    Upload input not visible yet, clicking Upload Files...");
          await this.clickUploadFilesButton();
          await sleep(1000);
          fileInput = await this.findFileInputElement();
        }

        if (!fileInput) {
          console.log(`    ✗ Could not find file input for ${absPath}`);
          await this.takeDebugScreenshot("upload-no-input");
          continue;
        }

        // sendKeys() works on hidden inputs - no click needed!
        await fileInput.sendKeys(absPath);

        const fileName = doc.fileName || path.basename(absPath);
        console.log(`    ✓ Uploaded: ${fileName}`);

        // Wait for upload to process and close the modal dialog if it appears.
        await sleep(3000);
        const closeStart = Date.now();
        let closed = false;
        while (Date.now() - closeStart < CIGNA_TIMING.elementWait) {
          const clicked = await this.clickUploadDialogDone();
          if (clicked) {
            closed = true;
            await sleep(1000);
            break;
          }
          await sleep(CIGNA_TIMING.pollInterval);
        }

        if (!closed) {
          await this.captureDebugContext("upload-done-missing", { fileName });
        }

        // Check if upload appeared in the UI
        const uploadedFiles = await this.driver.executeScript(`
          const uploaded = document.querySelectorAll('[data-file-name], .slds-file__card, .uploaded-file, article');
          return Array.from(uploaded).filter(el => el.textContent.includes('.pdf') || el.textContent.includes('.png') || el.textContent.includes('.jpg')).length;
        `) as number;
        console.log(`    (${uploadedFiles} file(s) now showing on page)`);

      } catch (err) {
        console.log(`    ✗ Failed to upload ${absPath}: ${err}`);
        await this.takeDebugScreenshot("upload-failed");
      }
    }

    console.log("  ✓ Document upload complete");
  }

  /**
   * Final review and submit (or pause before submit)
   */
  private async reviewAndSubmit(): Promise<SubmissionResult> {
    if (!this.driver) throw new Error("Driver not initialized");
    const driver = this.driver;
    console.log("  Final review...");
    const result: SubmissionResult = {
      submissionUrl: await driver.getCurrentUrl(),
    };

    const extractSubmission = async () => {
      try {
        const pageText = await driver.executeScript(`return document.body.textContent;`) as string;

        const claimMatch = pageText.match(/[Cc]laim\s*[Nn]umber[:\s]*(\d+)/);
        const claimId = claimMatch?.[1];
        if (claimId) result.cignaClaimId = claimId;

        const subMatch = pageText.match(/[Ss]ubmission\s*[Nn]umber[:\s]*(\d+)/);
        const submissionNumber = subMatch?.[1];
        if (submissionNumber) result.submissionNumber = submissionNumber;
      } catch { }
    };

    if (this.config.pauseBeforeSubmit) {
      this.keepBrowserOpen = true;
      console.log("\n  ⏸️  PAUSED BEFORE SUBMIT");
      console.log("  Review the form in the browser.");
      console.log("  The submit button will be highlighted.");

      // Highlight submit button
      await this.driver.executeScript(`
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          const text = (btn.textContent || '').toLowerCase();
          if (text.includes('submit')) {
            btn.style.border = '5px solid red';
            btn.style.backgroundColor = 'yellow';
          }
        }
      `);

      const pauseUntil = Date.now() + (this.config.pauseTimeoutMs ?? 15 * 60 * 1000);
      while (Date.now() < pauseUntil) {
        await sleep(5000);
        await extractSubmission();
        if (result.cignaClaimId || result.submissionNumber) {
          break;
        }
      }
    } else {
      await extractSubmission();
    }

    const hasSubmission = Boolean(result.cignaClaimId || result.submissionNumber);
    if (this.config.pauseBeforeSubmit && !hasSubmission) {
      result.paused = true;
      console.log("  ⏸️  Submission paused; waiting for manual submit.");
    }

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
    await this.handleOtherInsurer();

    // Document upload step
    if (input.documents.length > 0) {
      await this.uploadDocuments(input.documents);
    }

    // Click Continue to go to review page
    await this.clickContinueButton("upload");
    await sleep(CIGNA_TIMING.afterNavigation);

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
      // Keep the browser open only if we actually reached the pause step.
      const shouldKeepOpen = this.config.pauseBeforeSubmit && this.keepBrowserOpen;
      if (!shouldKeepOpen) {
        await this.close();
      }
    }
  }
}

