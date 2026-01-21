/**
 * ID helpers.
 */

/**
 * Return a de-duplicated list of ids while preserving order.
 */
export function dedupeIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}
