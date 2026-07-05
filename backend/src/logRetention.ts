import { db } from "./db/database";

export type LogRetentionPolicy = {
  days: number;
  maxRows: number;
};

export type LogRetentionResult = LogRetentionPolicy & {
  deleted: number;
};

const DEFAULT_DAYS = 30;
const DEFAULT_MAX_ROWS = 1000;
const MAX_DAYS = 3650;
const MAX_ROWS = 100_000;

function readSetting(key: string): string | undefined {
  return (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined)?.value;
}

function clampNonNegativeInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(0, Math.floor(parsed)));
}

export function normalizeLogRetentionPolicy(input: { days?: unknown; maxRows?: unknown }): LogRetentionPolicy {
  return {
    days: clampNonNegativeInt(input.days, DEFAULT_DAYS, MAX_DAYS),
    maxRows: clampNonNegativeInt(input.maxRows, DEFAULT_MAX_ROWS, MAX_ROWS),
  };
}

export function getLogRetentionPolicy(): LogRetentionPolicy {
  return normalizeLogRetentionPolicy({
    days: readSetting("log_retention_days"),
    maxRows: readSetting("log_retention_max_rows"),
  });
}

export function saveLogRetentionPolicy(input: { days?: unknown; maxRows?: unknown }): LogRetentionPolicy {
  const policy = normalizeLogRetentionPolicy(input);
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  db.transaction(() => {
    stmt.run("log_retention_days", String(policy.days));
    stmt.run("log_retention_max_rows", String(policy.maxRows));
  })();
  return policy;
}

export function applyLogRetention(policy = getLogRetentionPolicy()): LogRetentionResult {
  let deleted = 0;

  if (policy.days > 0) {
    const cutoff = new Date(Date.now() - policy.days * 24 * 60 * 60 * 1000).toISOString();
    const result = db
      .prepare("DELETE FROM job_logs WHERE status != 'running' AND ran_at < ?")
      .run(cutoff);
    deleted += result.changes;
  }

  if (policy.maxRows > 0) {
    const result = db
      .prepare(
        `
        DELETE FROM job_logs
        WHERE status != 'running'
          AND id IN (
            SELECT id
            FROM job_logs
            WHERE status != 'running'
            ORDER BY ran_at DESC, id DESC
            LIMIT -1 OFFSET ?
          )
      `,
      )
      .run(policy.maxRows);
    deleted += result.changes;
  }

  return { ...policy, deleted };
}
