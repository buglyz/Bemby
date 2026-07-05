import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let testDb!: InstanceType<typeof Database>;

vi.mock("../db/database", () => ({ get db() { return testDb; } }));

import {
  applyLogRetention,
  getLogRetentionPolicy,
  saveLogRetentionPolicy,
} from "../logRetention";

const SCHEMA = `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE job_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    ran_at TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT
  );
`;

function insertLog(ranAt: string, status = "success") {
  testDb
    .prepare("INSERT INTO job_logs (job_id, ran_at, status) VALUES (1, ?, ?)")
    .run(ranAt, status);
}

describe("log retention", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    testDb.exec(SCHEMA);
  });

  afterEach(() => {
    testDb.close();
  });

  it("returns default policy when settings are not configured", () => {
    expect(getLogRetentionPolicy()).toEqual({ days: 30, maxRows: 1000 });
  });

  it("saves a normalized retention policy", () => {
    expect(saveLogRetentionPolicy({ days: 7, maxRows: 50 })).toEqual({
      days: 7,
      maxRows: 50,
    });
    expect(getLogRetentionPolicy()).toEqual({ days: 7, maxRows: 50 });
  });

  it("deletes old completed logs but keeps running logs", () => {
    insertLog("2000-01-01T00:00:00.000Z", "success");
    insertLog("2000-01-01T00:00:00.000Z", "failed");
    insertLog("2000-01-01T00:00:00.000Z", "running");

    const result = applyLogRetention({ days: 30, maxRows: 1000 });

    expect(result.deleted).toBe(2);
    const rows = testDb.prepare("SELECT status FROM job_logs").all() as Array<{ status: string }>;
    expect(rows.map((r) => r.status)).toEqual(["running"]);
  });

  it("keeps only the newest completed rows when maxRows is set", () => {
    insertLog("2026-01-01T00:00:00.000Z");
    insertLog("2026-01-02T00:00:00.000Z");
    insertLog("2026-01-03T00:00:00.000Z");

    const result = applyLogRetention({ days: 0, maxRows: 2 });

    expect(result.deleted).toBe(1);
    const rows = testDb
      .prepare("SELECT ran_at FROM job_logs ORDER BY ran_at ASC")
      .all() as Array<{ ran_at: string }>;
    expect(rows.map((r) => r.ran_at)).toEqual([
      "2026-01-02T00:00:00.000Z",
      "2026-01-03T00:00:00.000Z",
    ]);
  });
});
