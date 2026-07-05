import { Router } from "express";
import { db, getDefaultTgApiCredentials } from "../db/database";
import { runJob, type JobDetailLog } from "../jobs/runner";
import {
  sendTgNotify,
  buildFailureMessage,
  buildSuccessMessage,
  getNotifyConfig,
} from "../jobs/notify";
import { refreshScheduler } from "../scheduler";
import type { Job, TgAccount } from "../types";
import { registerJob, unregisterJob, registerLiveDetail, clearLiveDetail } from "../jobs/cancellation";
import { testEmbywatchConnection } from "../jobs/embywatch";
import { getLiveClient, resolvePeer } from "../tg/liveClient";
import { applyLogRetention } from "../logRetention";

const router = Router();

type JobRow = {
  id: number;
  name: string;
  account_id: number | null;
  job_type: string;
  bot_username: string;
  schedule_window_start: number;
  schedule_window_end: number;
  timezone: string;
  reply_timeout_ms: number;
  retry_max: number;
  enabled: number;
  created_at: string;
  config: string | null;
  start_command: string;
  checkin_button: string;
  template_id: number | null;
  run_every_days: number;
  retired: string | null;
  account_name?: string;
};

type AccountRow = {
  id: number;
  name: string;
  phone_number: string;
  api_id: number | null;
  api_hash: string | null;
  session_string: string | null;
  auth_status: string;
  proxy_id: string | null;
  disabled: number;
  app_client_id: string | null;
  created_at: string;
};

function rowToAccount(row: AccountRow): TgAccount {
  const defaults = !row.api_id || !row.api_hash ? getDefaultTgApiCredentials() : null;
  return {
    id: row.id,
    name: row.name,
    phoneNumber: row.phone_number,
    apiId: row.api_id || defaults?.apiId || null,
    apiHash: row.api_hash || defaults?.apiHash || null,
    sessionString: row.session_string,
    authStatus: row.auth_status as TgAccount["authStatus"],
    proxyId: row.proxy_id ?? null,
    disabled: Boolean(row.disabled),
    appClientId: row.app_client_id ?? null,
    createdAt: row.created_at,
  };
}

function rowToJob(row: JobRow): Job & { accountName?: string } {
  return {
    id: row.id,
    name: row.name,
    accountId: row.account_id ?? null,
    accountName: row.account_name,
    jobType: row.job_type as Job["jobType"],
    botUsername: row.bot_username,
    scheduleWindowStart: row.schedule_window_start,
    scheduleWindowEnd: row.schedule_window_end,
    timezone: row.timezone,
    replyTimeoutMs: row.reply_timeout_ms,
    retryMax: row.retry_max,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    config: row.config ?? null,
    startCommand: row.start_command || "/start",
    checkinButton: row.checkin_button || "签到",
    templateId: row.template_id ?? null,
    runEveryDays: row.run_every_days ?? 1,
    retired: row.retired ?? null,
  };
}

function parseJsonConfig(raw: unknown): Record<string, any> {
  if (raw == null || raw === "") return {};
  if (typeof raw === "object") return raw as Record<string, any>;
  try {
    const parsed = JSON.parse(String(raw));
    return typeof parsed === "string" ? parseJsonConfig(parsed) : (parsed ?? {});
  } catch {
    return {};
  }
}

function templateConfig(templateId: unknown): Record<string, any> {
  if (!templateId) return {};
  const row = db
    .prepare("SELECT config FROM job_templates WHERE id = ?")
    .get(Number(templateId)) as { config: string | null } | undefined;
  return parseJsonConfig(row?.config);
}

function resolveJobTypeFromBody(body: Record<string, any>): string {
  if (!body.templateId) return body.jobType ?? "checkin";
  const row = db
    .prepare("SELECT job_type FROM job_templates WHERE id = ?")
    .get(Number(body.templateId)) as { job_type: string } | undefined;
  return row?.job_type ?? body.jobType ?? "checkin";
}

router.get("/", (_req, res) => {
  const rows = db
    .prepare(
      `
    SELECT j.*, a.name AS account_name
    FROM jobs j
    LEFT JOIN tg_accounts a ON j.account_id = a.id
    WHERE j.retired IS NULL
    ORDER BY j.name COLLATE NOCASE
  `,
    )
    .all() as JobRow[];
  res.json(rows.map(rowToJob));
});

router.post("/preflight", async (req, res) => {
  const body = req.body as Record<string, any>;
  const jobType = resolveJobTypeFromBody(body);
  const botUsername = String(body.botUsername ?? "").replace(/^@+/, "").trim();

  try {
    if (jobType === "embywatch") {
      const config = {
        ...templateConfig(body.templateId),
        ...parseJsonConfig(body.config),
      };
      if (!body.botUsername) {
        res.status(400).json({ ok: false, error: "Emby server URL is required" });
        return;
      }
      if (!config.username || !config.password) {
        res.status(400).json({ ok: false, error: "Emby username and password are required" });
        return;
      }
      const result = await testEmbywatchConnection(String(body.botUsername), {
        username: String(config.username),
        password: String(config.password),
        userAgent: config.userAgent,
        proxyId: config.proxyId,
      });
      res.json({
        ok: true,
        message: `Connected to Emby as ${result.userName}; media items available: ${result.itemCount}`,
        details: result,
      });
      return;
    }

    if (jobType === "checkin" || jobType === "custom") {
      const accountId = Number(body.accountId);
      if (!accountId) {
        res.status(400).json({ ok: false, error: "Account is required" });
        return;
      }
      if (!botUsername) {
        res.status(400).json({ ok: false, error: "Bot username is required" });
        return;
      }

      const account = db
        .prepare("SELECT auth_status, session_string, disabled FROM tg_accounts WHERE id = ?")
        .get(accountId) as
        | { auth_status: string; session_string: string | null; disabled: number }
        | undefined;
      if (!account || account.disabled) {
        res.status(400).json({ ok: false, error: "Account not found or disabled" });
        return;
      }
      if (account.auth_status !== "authenticated" || !account.session_string) {
        res.status(400).json({ ok: false, error: "Account is not authenticated" });
        return;
      }

      const entry = await getLiveClient(accountId);
      const target = await resolvePeer(entry, botUsername);
      if (!target) {
        res.status(400).json({ ok: false, error: `Cannot resolve Telegram target @${botUsername}` });
        return;
      }

      res.json({
        ok: true,
        message: `Resolved ${target.type}: ${target.name}${target.username ? ` (@${target.username})` : ""}`,
        details: target,
      });
      return;
    }

    res.status(400).json({ ok: false, error: `Unsupported job type: ${jobType}` });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message ?? "Preflight failed" });
  }
});

router.post("/", (req, res) => {
  const {
    name,
    accountId,
    jobType,
    botUsername,
    scheduleWindowStart,
    scheduleWindowEnd,
    timezone,
    replyTimeoutMs,
    retryMax,
    enabled,
    config,
    startCommand,
    checkinButton,
    templateId,
    runEveryDays,
  } = req.body as Record<string, any>;

  const resolvedType = jobType ?? "checkin";
  const needsAccount = resolvedType === "checkin" || resolvedType === "custom";
  if (!name || (needsAccount && !accountId) || !botUsername) {
    res.status(400).json({
      error: "name and botUsername are required; accountId is required for checkin and custom jobs",
    });
    return;
  }

  const result = db
    .prepare(
      `
    INSERT INTO jobs
      (name, account_id, job_type, bot_username, schedule_window_start, schedule_window_end,
       timezone, reply_timeout_ms, retry_max, enabled, config, start_command, checkin_button, template_id, run_every_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      name,
      accountId ? Number(accountId) : null,
      resolvedType,
      (botUsername as string).replace(/^@+/, ""),
      Number(scheduleWindowStart ?? 1400),
      Number(scheduleWindowEnd ?? 1600),
      timezone ?? "Australia/Sydney",
      Number(replyTimeoutMs ?? 40000),
      Number(retryMax ?? 5),
      enabled !== false ? 1 : 0,
      config != null ? JSON.stringify(config) : null,
      (startCommand as string | undefined)?.trim() || "/start",
      (checkinButton as string | undefined)?.trim() || "签到",
      templateId ? Number(templateId) : null,
      Math.max(1, Number(runEveryDays ?? 1)),
    );

  const row = db
    .prepare(
      "SELECT j.*, a.name AS account_name FROM jobs j LEFT JOIN tg_accounts a ON j.account_id = a.id WHERE j.id = ?",
    )
    .get(result.lastInsertRowid) as JobRow;
  refreshScheduler();
  res.status(201).json(rowToJob(row));
});

router.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM jobs WHERE id = ?")
    .get(req.params.id) as JobRow | undefined;
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const {
    name,
    accountId,
    jobType,
    botUsername,
    scheduleWindowStart,
    scheduleWindowEnd,
    timezone,
    replyTimeoutMs,
    retryMax,
    enabled,
    config,
    startCommand,
    checkinButton,
    templateId,
    runEveryDays,
  } = req.body as Record<string, any>;

  // When linked to a template, template-controlled fields are read-only
  const isLinked = existing.template_id != null && templateId === undefined;
  const resolvedTemplateId = templateId !== undefined
    ? (templateId ? Number(templateId) : null)
    : existing.template_id;

  const updatedType = isLinked ? existing.job_type : (jobType ?? existing.job_type);
  const updatedBotUsername =
    (botUsername as string | undefined)?.replace(/^@+/, "") ?? existing.bot_username;
  db.prepare(
    `
    UPDATE jobs SET
      name = ?, account_id = ?, job_type = ?, bot_username = ?,
      schedule_window_start = ?, schedule_window_end = ?, timezone = ?,
      reply_timeout_ms = ?, retry_max = ?, enabled = ?, config = ?,
      start_command = ?, checkin_button = ?, template_id = ?, run_every_days = ?
    WHERE id = ?
  `,
  ).run(
    name ?? existing.name,
    accountId !== undefined ? (accountId ? Number(accountId) : null) : (existing.account_id ?? null),
    updatedType,
    updatedBotUsername,
    Number(scheduleWindowStart ?? existing.schedule_window_start),
    Number(scheduleWindowEnd ?? existing.schedule_window_end),
    isLinked ? existing.timezone : (timezone ?? existing.timezone),
    isLinked ? existing.reply_timeout_ms : Number(replyTimeoutMs ?? existing.reply_timeout_ms),
    isLinked ? existing.retry_max : Number(retryMax ?? existing.retry_max),
    enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
    // embywatch template-linked jobs store credentials in the job; allow config updates
    (isLinked && existing.job_type !== 'embywatch') ? existing.config : (config !== undefined
      ? config != null
        ? JSON.stringify(config)
        : null
      : existing.config),
    isLinked ? existing.start_command : (startCommand !== undefined ? ((startCommand as string).trim() || "/start") : existing.start_command),
    isLinked ? existing.checkin_button : (checkinButton !== undefined ? ((checkinButton as string).trim() || "签到") : existing.checkin_button),
    resolvedTemplateId,
    Math.max(1, Number(runEveryDays ?? existing.run_every_days ?? 1)),
    req.params.id,
  );

  const row = db
    .prepare(
      "SELECT j.*, a.name AS account_name FROM jobs j LEFT JOIN tg_accounts a ON j.account_id = a.id WHERE j.id = ?",
    )
    .get(req.params.id) as JobRow;
  refreshScheduler();
  res.json(rowToJob(row));
});

router.delete("/:id", (req, res) => {
  db.prepare("UPDATE jobs SET retired = datetime('now') WHERE id = ?").run(req.params.id);
  refreshScheduler();
  res.status(204).send();
});

// Manual trigger
router.post("/:id/run", async (req, res) => {
  const jobRow = db
    .prepare("SELECT * FROM jobs WHERE id = ?")
    .get(req.params.id) as JobRow | undefined;
  if (!jobRow) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const job = rowToJob(jobRow);
  let account: TgAccount | null = null;

  if (job.jobType === "checkin" || job.jobType === "custom") {
    const accountRow = db
      .prepare("SELECT * FROM tg_accounts WHERE id = ?")
      .get(jobRow.account_id) as AccountRow | undefined;
    if (!accountRow?.session_string) {
      res.status(400).json({ error: "Account is not authenticated" });
      return;
    }
    account = rowToAccount(accountRow);
    if (!account.apiId || !account.apiHash) {
      res.status(400).json({
        error: "No API credentials available for this account. Add credentials to this account or configure global defaults in Settings.",
      });
      return;
    }
  } else if (job.accountId) {
    // Optional linked account (e.g. embywatch) — used for notifications only; don't block if not authenticated
    const accountRow = db
      .prepare("SELECT * FROM tg_accounts WHERE id = ?")
      .get(job.accountId) as AccountRow | undefined;
    if (accountRow?.session_string) {
      account = rowToAccount(accountRow);
    }
  }

  const ranAt = new Date().toISOString();
  const logResult = db
    .prepare(
      "INSERT INTO job_logs (job_id, ran_at, status, message, source) VALUES (?, ?, 'running', 'Manual run', 'manual')",
    )
    .run(job.id, ranAt);
  const logId = logResult.lastInsertRowid;

  res.json({ message: "Job triggered", logId });

  const detailLogs: JobDetailLog[] = [];
  const signal = registerJob(Number(logId));
  registerLiveDetail(Number(logId), detailLogs);
  runJob(job, account, detailLogs, signal)
    .then(() => {
      const detail = detailLogs.length ? JSON.stringify(detailLogs) : null;
      db.prepare(
        "UPDATE job_logs SET status = 'success', message = 'Completed', detail = ? WHERE id = ?",
      ).run(detail, logId);
      if (account?.sessionString) {
        const cfg = getNotifyConfig();
        if (cfg.events.includes("success") && cfg.username) {
          sendTgNotify(
            account,
            buildSuccessMessage(job.name, job.jobType),
            cfg.username,
          ).catch((e) => console.warn("[notify] TG notification failed:", e));
        }
      }
    })
    .catch((err: Error) => {
      const isCancelled = err.message === "Job cancelled";
      const detail = detailLogs.length ? JSON.stringify(detailLogs) : null;
      db.prepare(
        "UPDATE job_logs SET status = 'failed', message = ?, detail = ? WHERE id = ?",
      ).run(isCancelled ? "Cancelled" : err.message, detail, logId);
      if (!isCancelled && account?.sessionString) {
        const cfg = getNotifyConfig();
        if (cfg.events.includes("failed")) {
          const target = cfg.username ?? "me";
          sendTgNotify(
            account,
            buildFailureMessage(job.name, job.jobType, err.message),
            target,
          ).catch((e) => console.warn("[notify] TG notification failed:", e));
        }
      }
    })
    .finally(() => {
      unregisterJob(Number(logId));
      clearLiveDetail(Number(logId));
      try { applyLogRetention(); } catch (e) { console.warn("[logs] retention cleanup failed:", e); }
    });
});

export default router;
