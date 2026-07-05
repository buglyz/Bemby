import Database from "better-sqlite3";
import express from "express";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let testDb!: InstanceType<typeof Database>;

const { mockTestEmby, mockGetLiveClient, mockResolvePeer } = vi.hoisted(() => ({
  mockTestEmby: vi.fn(),
  mockGetLiveClient: vi.fn(),
  mockResolvePeer: vi.fn(),
}));

vi.mock("../db/database", () => ({ get db() { return testDb; } }));
vi.mock("../scheduler", () => ({ refreshScheduler: vi.fn() }));
vi.mock("../jobs/embywatch", () => ({ testEmbywatchConnection: mockTestEmby }));
vi.mock("../tg/liveClient", () => ({
  getLiveClient: mockGetLiveClient,
  resolvePeer: mockResolvePeer,
}));
vi.mock("../jobs/runner", () => ({ runJob: vi.fn() }));
vi.mock("../jobs/cancellation", () => ({
  registerJob: vi.fn().mockReturnValue(new AbortController().signal),
  unregisterJob: vi.fn(),
  registerLiveDetail: vi.fn(),
  clearLiveDetail: vi.fn(),
}));
vi.mock("../jobs/notify", () => ({
  getNotifyConfig: vi.fn().mockReturnValue({ events: [], username: null }),
  sendTgNotify: vi.fn(),
  buildSuccessMessage: vi.fn(),
  buildFailureMessage: vi.fn(),
}));

import jobsRouter from "../routes/jobs";

const SCHEMA = `
  CREATE TABLE tg_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    api_id INTEGER,
    api_hash TEXT,
    session_string TEXT,
    auth_status TEXT NOT NULL DEFAULT 'unauthenticated',
    disabled INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE job_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    job_type TEXT NOT NULL,
    bot_username TEXT NOT NULL DEFAULT '',
    config TEXT
  );
  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    account_id INTEGER,
    job_type TEXT NOT NULL DEFAULT 'checkin',
    bot_username TEXT NOT NULL,
    schedule_window_start INTEGER NOT NULL DEFAULT 1000,
    schedule_window_end INTEGER NOT NULL DEFAULT 1200,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    reply_timeout_ms INTEGER NOT NULL DEFAULT 40000,
    retry_max INTEGER NOT NULL DEFAULT 5,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    config TEXT,
    start_command TEXT NOT NULL DEFAULT '/start',
    checkin_button TEXT NOT NULL DEFAULT '签到',
    template_id INTEGER,
    run_every_days INTEGER NOT NULL DEFAULT 1,
    retired TEXT
  );
`;

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/jobs", jobsRouter);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("jobs preflight route", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    testDb.exec(SCHEMA);
    vi.clearAllMocks();
  });

  afterEach(() => {
    testDb.close();
  });

  it("tests an Emby connection without creating a job", async () => {
    mockTestEmby.mockResolvedValue({ ok: true, userName: "alice", itemCount: 12 });

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/jobs/preflight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobType: "embywatch",
          botUsername: "https://emby.example.com",
          config: { username: "alice", password: "secret" },
        }),
      });
      const body = await res.json() as { ok: boolean; message: string };
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.message).toContain("alice");
    });

    expect(mockTestEmby).toHaveBeenCalledWith("https://emby.example.com", {
      username: "alice",
      password: "secret",
    });
    const count = testDb.prepare("SELECT COUNT(*) AS n FROM jobs").get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("resolves a Telegram target for checkin jobs", async () => {
    testDb
      .prepare(
        "INSERT INTO tg_accounts (name, phone_number, session_string, auth_status) VALUES ('A', '+1', 'sess', 'authenticated')",
      )
      .run();
    mockGetLiveClient.mockResolvedValue({ client: {} });
    mockResolvePeer.mockResolvedValue({
      chatId: "u1",
      name: "Test Bot",
      type: "bot",
      username: "TestBot",
      unreadCount: 0,
      lastMessage: null,
    });

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/jobs/preflight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Check",
          jobType: "checkin",
          accountId: 1,
          botUsername: "@TestBot",
        }),
      });
      const body = await res.json() as { ok: boolean; message: string };
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.message).toContain("Test Bot");
    });

    expect(mockGetLiveClient).toHaveBeenCalledWith(1);
    expect(mockResolvePeer).toHaveBeenCalledWith(expect.anything(), "TestBot");
  });
});
