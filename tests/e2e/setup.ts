import { Builder, WebDriver, logging } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import crypto from "crypto";

/**
 * Creates a configured Chrome WebDriver instance for e2e testing.
 * Set HEADLESS=false to run with visible browser.
 */
export async function createDriver(): Promise<WebDriver> {
  const headless = process.env.HEADLESS !== "false";

  const options = new chrome.Options();
  options.addArguments(
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--window-size=1600,1200"
  );

  if (headless) {
    options.addArguments("--headless=new");
  }

  const driver = await new Builder()
    .forBrowser("chrome")
    // Cast to avoid type mismatch between chromium.Options and chrome.Options
    .setChromeOptions(options as chrome.Options)
    .build();

  return driver;
}

interface BrowserLogs {
  all: logging.Entry[];
  errors: logging.Entry[];
  warnings: logging.Entry[];
  hasErrors: boolean;
  logSummary: () => void;
  formatForReport: () => string;
}

/**
 * Captures browser console logs and errors.
 * Returns an object with helper methods for error analysis.
 */
export async function captureBrowserErrors(
  driver: WebDriver
): Promise<BrowserLogs> {
  try {
    const logs = await driver.manage().logs().get(logging.Type.BROWSER);
    const errors = logs.filter((log) => log.level.value >= 900); // SEVERE level
    const warnings = logs.filter(
      (log) => log.level.value >= 800 && log.level.value < 900
    ); // WARNING level

    return {
      all: logs,
      errors,
      warnings,
      hasErrors: errors.length > 0,
      logSummary: () => {
        if (errors.length > 0) {
          console.log("\n=== BROWSER ERRORS ===");
          errors.forEach((err) => {
            console.log(`[${err.level.name}] ${err.message}`);
          });
        }
        if (warnings.length > 0) {
          console.log("\n=== BROWSER WARNINGS ===");
          warnings.forEach((warn) => {
            console.log(`[${warn.level.name}] ${warn.message}`);
          });
        }
        if (errors.length === 0 && warnings.length === 0) {
          console.log("✓ No browser errors or warnings");
        }
      },
      formatForReport: () => {
        const sections: string[] = [];
        if (errors.length > 0) {
          sections.push(
            "## Errors\n\n" +
              errors.map((e) => `- **${e.level.name}**: ${e.message}`).join("\n")
          );
        }
        if (warnings.length > 0) {
          sections.push(
            "## Warnings\n\n" +
              warnings
                .map((w) => `- **${w.level.name}**: ${w.message}`)
                .join("\n")
          );
        }
        return sections.join("\n\n");
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("Could not capture browser logs:", message);
    return {
      all: [],
      errors: [],
      warnings: [],
      hasErrors: false,
      logSummary: () => console.log("Browser logging not available"),
      formatForReport: () => "Browser logging not available",
    };
  }
}

/**
 * Wait helper with configurable timeout.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate TOTP code from base32 secret.
 */
export function generateTOTP(secret: string): string {
  // Decode base32
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

  // Generate TOTP (30-second window, SHA1)
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
