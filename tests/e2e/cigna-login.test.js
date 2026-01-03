import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { createDriver, captureBrowserErrors, sleep, generateTOTP } from './setup.js';
import { By, until } from 'selenium-webdriver';

/**
 * Retrieve credentials from passveil.
 * Returns { username, password } or throws if unavailable.
 */
function getCredentials() {
    const raw = execSync('passveil show customer.cignaenvoy.com/tracker-credentials', {
        encoding: 'utf-8',
        timeout: 10000,
    }).trim();

    const lines = raw.split('\n');
    if (lines.length < 2) {
        throw new Error('Expected 2 lines from passveil (username, password)');
    }

    return {
        username: lines[0].trim(),
        password: lines[1].trim(),
    };
}

/**
 * Retrieve TOTP secret from passveil.
 */
function getTotpSecret() {
    const secret = execSync('passveil show customer.cignaenvoy.com/totp-secret', {
        encoding: 'utf-8',
        timeout: 10000,
    }).trim();

    return secret;
}

/**
 * Dismiss OneTrust cookie consent banner if present.
 */
async function dismissCookieBanner(driver) {
    try {
        // Try to find and click "Accept All Cookies" button
        const acceptButton = await driver.findElement(By.id('onetrust-accept-btn-handler'));
        await acceptButton.click();
        await sleep(500);
        console.log('✓ Cookie consent banner dismissed');
    } catch {
        // Banner not present or already dismissed - continue
    }
}

describe('Cigna Envoy Portal E2E Tests', () => {
    let driver;
    let credentials;
    let totpSecret;
    const baseUrl = 'https://customer.cignaenvoy.com';

    before(async () => {
        credentials = getCredentials();
        totpSecret = getTotpSecret();
        driver = await createDriver();
    });

    after(async () => {
        if (driver) {
            const browserErrors = await captureBrowserErrors(driver);
            browserErrors.logSummary();
            await driver.quit();
        }
    });

    it('should load the Cigna Envoy login page', async () => {
        await driver.get(baseUrl);
        await sleep(3000);  // Salesforce Lightning / Okta takes time to render

        const title = await driver.getTitle();
        console.log(`Page title: ${title}`);

        assert.strictEqual(title, 'Login', 'Page title should be "Login"');

        // Dismiss cookie banner for subsequent tests
        await dismissCookieBanner(driver);
    });

    it('should have login form with Okta elements', async () => {
        // Okta Sign-In Widget element IDs
        const usernameField = await driver.wait(
            until.elementLocated(By.id('okta-signin-username')),
            10000,
            'Okta username field not found'
        );
        assert.ok(usernameField, 'Username field should exist');

        const passwordField = await driver.findElement(By.id('okta-signin-password'));
        assert.ok(passwordField, 'Password field should exist');

        const loginButton = await driver.findElement(By.id('okta-signin-submit'));
        const buttonValue = await loginButton.getAttribute('value');
        assert.strictEqual(buttonValue, 'Login', 'Login button should have "Login" value');
    });

    it('should complete full login with MFA and reach dashboard', async () => {
        // Ensure cookie banner is dismissed
        await dismissCookieBanner(driver);

        // Fill in credentials using Okta element IDs
        const usernameField = await driver.findElement(By.id('okta-signin-username'));
        await usernameField.clear();
        await usernameField.sendKeys(credentials.username);

        const passwordField = await driver.findElement(By.id('okta-signin-password'));
        await passwordField.clear();
        await passwordField.sendKeys(credentials.password);

        // Click login
        const loginButton = await driver.findElement(By.id('okta-signin-submit'));
        await loginButton.click();

        // Wait for MFA page
        await sleep(5000);

        const mfaUrl = await driver.getCurrentUrl();
        console.log(`MFA page URL: ${mfaUrl}`);

        assert.ok(
            mfaUrl.includes('login.cigna.com') && mfaUrl.includes('verify'),
            `Should be on MFA page. Current URL: ${mfaUrl}`
        );

        // Generate and enter TOTP code
        const totpCode = generateTOTP(totpSecret);
        console.log(`Generated TOTP code: ${totpCode}`);

        // Find the TOTP input field and enter code
        const totpInput = await driver.wait(
            until.elementLocated(By.css('input[name="credentials.passcode"], input[aria-label="Enter Code"], input[type="text"]')),
            10000,
            'TOTP input field not found'
        );
        await totpInput.clear();
        await totpInput.sendKeys(totpCode);

        // Click Verify button
        const verifyButton = await driver.findElement(
            By.css('input[type="submit"][value="Verify"], button[type="submit"]')
        );
        await verifyButton.click();

        // Wait for dashboard to load
        await sleep(8000);

        const dashboardUrl = await driver.getCurrentUrl();
        const dashboardTitle = await driver.getTitle();
        console.log(`After MFA - URL: ${dashboardUrl}`);
        console.log(`After MFA - Title: ${dashboardTitle}`);

        // Verify we reached the dashboard (not stuck on login/MFA)
        const isOnDashboard = !dashboardUrl.includes('login.cigna.com') &&
            !dashboardUrl.includes('CustomLogin') &&
            (dashboardUrl.includes('cignaenvoy.com') || dashboardUrl.includes('/s/'));

        assert.ok(isOnDashboard, `Should be on dashboard. Current URL: ${dashboardUrl}`);
        console.log('✓ Successfully logged in and reached dashboard!');
    });
});
