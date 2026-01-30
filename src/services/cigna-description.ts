/**
 * Utilities for generating and validating Cigna Envoy symptom descriptions.
 *
 * Cigna's symptom search doesn't return real results - all symptoms must be
 * entered as free text via "My Symptoms/Diagnosis is not on the list" option.
 *
 * Validation rules:
 * - English language only
 * - Allowed characters: A-Z, a-z, 0-9, whitespace, '.,-()/'
 * - NO colons (:) allowed!
 */

/** Regex pattern for allowed characters in Cigna descriptions */
const CIGNA_ALLOWED_PATTERN = /^[A-Za-z0-9\s'.,\-()\/]+$/;

/** Characters that need to be removed or replaced */
const INVALID_CHAR_REPLACEMENTS: Record<string, string> = {
  ":": "", // Remove colons
  ";": ",", // Replace semicolons with commas
  "!": ".", // Replace exclamation with period
  "?": ".", // Replace question mark with period
  "&": "and", // Replace ampersand with "and"
  "+": "and", // Replace plus with "and"
  "@": "at", // Replace @ with "at"
  "#": "", // Remove hash
  "*": "", // Remove asterisk
  "[": "(", // Replace brackets with parens
  "]": ")", // Replace brackets with parens
  "{": "(", // Replace braces with parens
  "}": ")", // Replace braces with parens
  "<": "", // Remove angle brackets
  ">": "", // Remove angle brackets
  "=": "-", // Replace equals with dash
  "_": " ", // Replace underscore with space
  "|": "/", // Replace pipe with slash
  "\\": "/", // Replace backslash with slash
  '"': "'", // Replace double quotes with single
  "`": "'", // Replace backtick with single quote
  "~": "-", // Replace tilde with dash
};

/**
 * Validates if a string is a valid Cigna description.
 */
export function isValidCignaDescription(description: string): boolean {
  return CIGNA_ALLOWED_PATTERN.test(description);
}

/**
 * Sanitizes a string to make it valid for Cigna submission.
 * Replaces or removes invalid characters.
 */
export function sanitizeCignaDescription(input: string): string {
  let result = input;

  // Apply character replacements
  for (const [invalid, replacement] of Object.entries(
    INVALID_CHAR_REPLACEMENTS
  )) {
    result = result.split(invalid).join(replacement);
  }

  // Remove any remaining invalid characters
  result = result.replace(/[^A-Za-z0-9\s'.,\-()\/]/g, "");

  // Collapse multiple spaces
  result = result.replace(/\s+/g, " ");

  // Trim
  result = result.trim();

  return result;
}

/**
 * Generates a Cigna description from illness name and ICD code.
 */
export function generateCignaDescription(
  name: string,
  icdCode?: string
): string {
  let description = sanitizeCignaDescription(name);

  if (icdCode) {
    // Sanitize ICD code (remove colon if present like "ICD-10:")
    const sanitizedCode = sanitizeCignaDescription(icdCode);
    if (sanitizedCode) {
      description += ` (ICD-10 ${sanitizedCode})`;
    }
  }

  return description;
}

/**
 * Gets the best available Cigna description for an illness.
 * Priority: cignaDescription > generated from name+icdCode
 */
export function getCignaDescriptionForIllness(illness: {
  name: string;
  icdCode?: string;
  cignaDescription?: string;
}): string {
  // Use custom description if available and valid
  if (illness.cignaDescription) {
    const sanitized = sanitizeCignaDescription(illness.cignaDescription);
    if (sanitized) {
      return sanitized;
    }
  }

  // Generate from name and ICD code
  return generateCignaDescription(illness.name, illness.icdCode);
}
