# Cigna Envoy Claim Submission Flow - Browser Test Report

**Generated:** 2026-01-26 22:09 UTC  
**Updated:** 2026-01-26 22:20 UTC - REWRITE TESTED & WORKING!  
**Browser:** Internal Playwright-based browser  
**Account:** 88017286701 (EMILS PETRACENOKS)

## ✅ REWRITE STATUS: SUCCESS

The rewrite of `cigna-submit.ts` based on this report is **WORKING**!

**Test Result (2026-01-26 22:18 UTC):**
- ✅ Login successful
- ✅ **Patient selection WORKING** (was the main blocker!)
- ✅ Country selection working
- ✅ Claim type selection working  
- ✅ Claim details (outpatient, treatment, currency, cost, date) all working!
- ⏸️ Symptoms step needs refinement (search didn't find "ME/CFS")

**Key Fix:** Using `cursor:pointer` CSS detection with JavaScript to find clickable patient cards instead of trying to find text spans within web components.

---

## CRITICAL FINDINGS

### 1. Site Speed & Timing
The Cigna Envoy site is **EXTREMELY SLOW**. All timing estimates assume worst-case:

| Action | Observed Wait Time |
|--------|-------------------|
| Login completion | 10 seconds |
| Page navigation | 8-10 seconds |
| Form submission | 8-10 seconds |
| Dropdown population | 2-3 seconds |
| Date picker rendering | 1-2 seconds |

### 2. Key Technical Discoveries

1. **Patient cards ARE clickable** - The outer `<generic>` div with `[cursor=pointer]` attribute is the click target, NOT inner text spans
2. **Date input** - Direct text typing FAILS! Must use the date picker button
3. **Checkboxes** - Click the LABEL text, not the checkbox input (parent intercepts)
4. **Progress indicator** - Each step has a specific progress % that can be used to verify navigation

---

## COMPLETE SUBMISSION FLOW

### Step 0: Login
- **URL:** `https://customer.cignaenvoy.com/CustomLogin`
- **Elements:**
  - ID textbox: `textbox "Cigna Healthcare ID number"`
  - Password textbox: `textbox "Password/PIN"`
  - Login button: `button "Login"`
- **Wait:** 10 seconds after click for redirect to home

### Step 1: Patient Selection (Progress 0%)
- **URL:** `/s/new-submitclaim?LanguageCode=en_GB&language=en_GB`
- **Heading:** "Who are you claiming for?"
- **Element to click:** The OUTER div containing patient info with `[cursor=pointer]`
  - Look for: `generic [cursor=pointer]` containing "EMILS PETRACENOKS"
  - Structure: outer div > img (person icon) > Block div > name text > img (chevron)
- **Wait:** 8 seconds for Step 2 (check for progress ~14%)

### Step 2: Country Selection (Progress ~14%)
- **Heading:** "Where did you receive care?"
- **Elements:**
  - Country dropdown: `combobox "Select a country/area*"`
  - Options in listbox, e.g., `option "UNITED KINGDOM"`
  - Continue button: `button "Continue"` (disabled until country selected)
- **Wait:** 8 seconds for Step 3 (check for progress ~28%)

### Step 3: Claim Type (Progress ~28%)
- **Heading:** "Tell us more about the claim"
- **Elements:**
  - Claim type dropdown: `combobox "Claim type*"`
  - Options: "Medical", "Vision", "Dental"
  - Continue button: `button "Continue"`
- **Wait:** 8 seconds for Step 4 (check for progress ~42%)

### Step 4: Claim Details (Progress ~42%)
- **Heading:** "Tell us more about the claim" (same heading, different content)
- **Part A - Outpatient/Inpatient:**
  - Dropdown: `combobox "Is it an outpatient or inpatient stay?*"`
  - Options: "Outpatient", "Inpatient"
  
- **Part B - Treatment Details (appears after Outpatient selected):**
  - **Treatment Type** (multi-checkbox group `group "Treatment Type*"`):
    - Chiropractic treatment
    - Consultation with medical practitioner and specialist
    - Maternity consultations or treatment
    - Osteopathy
    - Pathology tests and expenses
    - Physiotherapy
    - Prescribed medication
    - Psychiatric consultations or treatment
    - X-rays
    - Other
  - **Currency:** `combobox "Currency*"` - Options like "UK POUND STERLING"
  - **Cost:** `textbox "What was the cost?*"` - Enter number, auto-formats to 2 decimals
  - **Treatment Date:** Use `button "Select Date"` to open date picker, then click date cell
  
- **Continue button:** `button "Continue"`
- **Wait:** 10 seconds for Step 5 (check for progress ~57%)

### Step 5: Symptoms/Diagnosis (Progress ~57%)
- **Heading:** "What were the symptoms or diagnosis?"
- **Elements:**
  - Search combobox: `combobox "Begin typing"` - Type to search symptoms
  - Work-related checkbox: `checkbox "This claim is a result of a work-related accident or injury"`
  - Continue button: `button "Continue"`
- **Wait:** 8 seconds for Step 6

### Step 6: Provider Details (Progress ~71% - estimated)
- Expected fields: Provider name, address, etc.
- (Not yet explored)

### Step 7: Document Upload (Progress ~85% - estimated)
- File upload interface
- (Not yet explored)

### Step 8: Review & Submit (Progress ~100% - estimated)
- Review all entered data
- Submit button
- (Not yet explored)

---

## RECOMMENDED IMPLEMENTATION APPROACH

### Use Playwright-style Selectors, NOT Selenium XPath

The internal browser uses Playwright which handles Shadow DOM and LWC components much better than Selenium.

**For Selenium, use this approach:**

```typescript
// 1. ALWAYS poll for element visibility
async function waitForElement(driver, locator, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const el = await driver.findElement(locator);
      if (await el.isDisplayed()) return el;
    } catch {}
    await sleep(1000);
  }
  throw new Error(`Element not found: ${locator}`);
}

// 2. For patient card, find by text content and click parent with cursor:pointer
async function clickPatientCard(driver, patientName) {
  // Use JavaScript to find the clickable parent
  return driver.executeScript(`
    const allDivs = document.querySelectorAll('div, generic');
    for (const div of allDivs) {
      const style = window.getComputedStyle(div);
      if (style.cursor === 'pointer' && div.textContent.includes('${patientName}')) {
        // Check if this is a reasonable card size
        const rect = div.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 50 && rect.height < 200) {
          div.click();
          return true;
        }
      }
    }
    return false;
  `);
}

// 3. For dropdowns, click to open then find option by text
async function selectDropdownOption(driver, dropdownLabel, optionText) {
  // Find and click dropdown
  const dropdown = await driver.findElement(
    By.xpath(`//combobox[contains(@aria-label, '${dropdownLabel}')] | //*[contains(text(), '${dropdownLabel}')]/following::*[role='combobox']`)
  );
  await dropdown.click();
  await sleep(2000); // Wait for options to load
  
  // Find and click option
  const option = await driver.findElement(
    By.xpath(`//option[contains(text(), '${optionText}')] | //*[role='option'][contains(text(), '${optionText}')]`)
  );
  await option.click();
}

// 4. For checkboxes, click the label not the input
async function checkCheckbox(driver, labelText) {
  const label = await driver.findElement(
    By.xpath(`//*[contains(text(), '${labelText}') and not(self::input)]`)
  );
  await label.click();
}

// 5. For date picker, use the button
async function selectDate(driver, dateStr) {
  const dateButton = await driver.findElement(By.xpath(`//button[contains(text(), 'Select Date')]`));
  await dateButton.click();
  await sleep(2000);
  
  // Parse date and click the appropriate cell
  // Date cells have format like "Thu Jan 15 2026"
  const dateCell = await driver.findElement(By.xpath(`//gridcell[contains(@aria-label, '${dateStr}')]`));
  await dateCell.click();
}
```

### Progress Verification

After each step, verify navigation by checking progress bar:

```typescript
async function getProgress(driver) {
  const progressBar = await driver.findElement(By.css('progressbar[aria-label="Steps"]'));
  const progressText = await progressBar.getText();
  // Returns something like "Progress: 42.857142857142854%"
  const match = progressText.match(/Progress:\s*([\d.]+)%/);
  return match ? parseFloat(match[1]) : 0;
}

// Expected progress values:
// Step 1 (Patient): 0%
// Step 2 (Country): ~14%
// Step 3 (Claim Type): ~28%
// Step 4 (Details): ~42%
// Step 5 (Symptoms): ~57%
// Step 6 (Provider): ~71%
// Step 7 (Upload): ~85%
// Step 8 (Review): ~100%
```

---

## TIMEOUT RECOMMENDATIONS

Based on observations, use these timeouts:

```typescript
const CIGNA_TIMEOUTS = {
  pageLoad: 60000,       // 60s max for any page load
  elementWait: 30000,    // 30s to find element
  afterClick: 8000,      // 8s after clicking navigation
  afterDropdown: 2000,   // 2s after opening dropdown
  afterDatePicker: 2000, // 2s after opening date picker
  pollInterval: 1000,    // Poll every 1s when waiting
};
```

---

## ACTION ITEMS FOR REWRITE

1. **Replace all XPath selectors** with JavaScript-based element finding using `executeScript`
2. **Add mandatory waits** after EVERY navigation click (minimum 8s)
3. **Poll for page content** instead of just element presence
4. **Use cursor:pointer detection** for finding clickable card elements
5. **Use date picker button** instead of typing dates directly
6. **Click labels** for checkboxes, not the inputs themselves
7. **Add progress bar verification** to confirm step transitions
