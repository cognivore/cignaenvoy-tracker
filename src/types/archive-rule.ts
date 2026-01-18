/**
 * Archive rule definitions.
 *
 * Rules are used to auto-archive documents based on email/attachment metadata.
 */

export interface ArchiveRule {
  /** Internal UUID */
  id: string;

  /** Display name for the rule */
  name: string;

  /** Whether the rule is active */
  enabled: boolean;

  /** Sender email contains */
  fromContains?: string;

  /** Email subject contains */
  subjectContains?: string;

  /** Attachment filename contains */
  attachmentNameContains?: string;

  /** Timestamps */
  createdAt: Date;
  updatedAt: Date;
}

export type CreateArchiveRuleInput = Omit<
  ArchiveRule,
  "id" | "createdAt" | "updatedAt"
>;

export type UpdateArchiveRuleInput = Partial<
  Omit<ArchiveRule, "id" | "createdAt" | "updatedAt">
>;
