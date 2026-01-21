/**
 * Timing utilities for performance measurement.
 *
 * Pure functions for tracking latency and computing percentiles.
 */

export interface TimingRecord {
  operation: string;
  durationMs: number;
  timestamp: Date;
  metadata: Record<string, unknown> | undefined;
}

export interface TimingSummary {
  operation: string;
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface RunMetrics {
  runId: string;
  trigger: string;
  startedAt: Date;
  completedAt: Date;
  totalDurationMs: number;
  documentsProcessed: number;
  summaries: TimingSummary[];
}

/**
 * Collector for timing records during a processing run.
 */
export class TimingCollector {
  private records: TimingRecord[] = [];
  private runId: string;
  private trigger: string;
  private startedAt: Date;

  constructor(trigger: string) {
    this.runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.trigger = trigger;
    this.startedAt = new Date();
  }

  /**
   * Record a timing measurement.
   */
  record(operation: string, durationMs: number, metadata?: Record<string, unknown>): void {
    this.records.push({
      operation,
      durationMs,
      timestamp: new Date(),
      metadata,
    });
  }

  /**
   * Time an async operation and record it.
   */
  async time<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const durationMs = performance.now() - start;
      this.record(operation, durationMs, metadata);
    }
  }

  /**
   * Time a sync operation and record it.
   */
  timeSync<T>(
    operation: string,
    fn: () => T,
    metadata?: Record<string, unknown>
  ): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      const durationMs = performance.now() - start;
      this.record(operation, durationMs, metadata);
    }
  }

  /**
   * Get all records for an operation.
   */
  getRecords(operation?: string): TimingRecord[] {
    if (!operation) return [...this.records];
    return this.records.filter((r) => r.operation === operation);
  }

  /**
   * Compute summary statistics for an operation.
   */
  summarize(operation: string): TimingSummary | null {
    const records = this.getRecords(operation);
    if (records.length === 0) return null;

    const durations = records.map((r) => r.durationMs).sort((a, b) => a - b);
    const totalMs = durations.reduce((sum, d) => sum + d, 0);

    return {
      operation,
      count: durations.length,
      totalMs,
      minMs: durations[0]!,
      maxMs: durations[durations.length - 1]!,
      avgMs: totalMs / durations.length,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      p99Ms: percentile(durations, 99),
    };
  }

  /**
   * Get all unique operation names.
   */
  getOperations(): string[] {
    return [...new Set(this.records.map((r) => r.operation))];
  }

  /**
   * Finalize and return run metrics.
   */
  finalize(documentsProcessed: number): RunMetrics {
    const completedAt = new Date();
    const summaries = this.getOperations()
      .map((op) => this.summarize(op))
      .filter((s): s is TimingSummary => s !== null);

    return {
      runId: this.runId,
      trigger: this.trigger,
      startedAt: this.startedAt,
      completedAt,
      totalDurationMs: completedAt.getTime() - this.startedAt.getTime(),
      documentsProcessed,
      summaries,
    };
  }
}

/**
 * Calculate percentile from sorted array.
 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0]!;

  const index = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sortedValues[lower]!;

  const fraction = index - lower;
  return sortedValues[lower]! * (1 - fraction) + sortedValues[upper]! * fraction;
}

/**
 * Format a timing summary for logging.
 */
export function formatSummary(summary: TimingSummary): string {
  return (
    `${summary.operation}: ` +
    `count=${summary.count}, ` +
    `total=${summary.totalMs.toFixed(0)}ms, ` +
    `avg=${summary.avgMs.toFixed(1)}ms, ` +
    `p50=${summary.p50Ms.toFixed(1)}ms, ` +
    `p95=${summary.p95Ms.toFixed(1)}ms, ` +
    `p99=${summary.p99Ms.toFixed(1)}ms`
  );
}

/**
 * Format run metrics for logging.
 */
export function formatRunMetrics(metrics: RunMetrics): string {
  const lines = [
    `\n=== Run Metrics (${metrics.runId}) ===`,
    `Trigger: ${metrics.trigger}`,
    `Duration: ${metrics.totalDurationMs}ms`,
    `Documents: ${metrics.documentsProcessed}`,
    `Started: ${metrics.startedAt.toISOString()}`,
    `Completed: ${metrics.completedAt.toISOString()}`,
    "",
    "Per-operation breakdown:",
  ];

  for (const summary of metrics.summaries) {
    lines.push(`  ${formatSummary(summary)}`);
  }

  lines.push("=".repeat(40));
  return lines.join("\n");
}
