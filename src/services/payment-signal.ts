/**
 * Payment signal helpers.
 *
 * Provides a unified view of document payment signals, including manual overrides.
 */

import type {
    DetectedAmount,
    MedicalDocument,
    PaymentOverride,
} from "../types/medical-document.js";

export type PaymentSignalSource = "detected" | "override";

export interface PaymentSignal {
    amount: number;
    currency: string;
    rawText?: string;
    context?: string;
    confidence?: number;
    source: PaymentSignalSource;
    overrideNote?: string;
    overrideUpdatedAt?: Date;
}

function signalFromOverride(override: PaymentOverride): PaymentSignal {
    const signal: PaymentSignal = {
        amount: override.amount,
        currency: override.currency,
        rawText: `Override: ${override.amount} ${override.currency}`,
        confidence: 100,
        source: "override",
        overrideUpdatedAt: override.updatedAt,
    };

    if (override.note !== undefined) {
        signal.context = override.note;
        signal.overrideNote = override.note;
    }

    return signal;
}

function signalFromDetected(amount: DetectedAmount): PaymentSignal {
    const signal: PaymentSignal = {
        amount: amount.value,
        currency: amount.currency,
        rawText: amount.rawText,
        confidence: amount.confidence,
        source: "detected",
    };

    if (amount.context !== undefined) {
        signal.context = amount.context;
    }

    return signal;
}

/**
 * Get all payment signals for a document.
 * If a manual override exists, it takes precedence and is the only signal.
 */
export function getPaymentSignals(document: MedicalDocument): PaymentSignal[] {
    if (document.paymentOverride) {
        return [signalFromOverride(document.paymentOverride)];
    }

    return document.detectedAmounts.map(signalFromDetected);
}

/**
 * Check if a document has any usable payment signal.
 */
export function hasPaymentSignal(document: MedicalDocument): boolean {
    return document.paymentOverride !== undefined || document.detectedAmounts.length > 0;
}

/**
 * Select the primary payment signal from a document.
 * Manual override is always preferred; otherwise highest confidence wins.
 */
export function getPrimaryPaymentSignal(
    document: MedicalDocument
): PaymentSignal | null {
    const signals = getPaymentSignals(document);
    if (signals.length === 0) return null;
    if (signals.length === 1) return signals[0];

    return signals.reduce((current, candidate) => {
        if (!current) return candidate;
        const currentConfidence = current.confidence ?? 0;
        const candidateConfidence = candidate.confidence ?? 0;
        if (candidateConfidence > currentConfidence) return candidate;
        if (candidateConfidence === currentConfidence && candidate.amount > current.amount) {
            return candidate;
        }
        return current;
    }, signals[0]);
}
