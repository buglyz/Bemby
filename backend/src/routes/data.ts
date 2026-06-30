import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db/database';
import { refreshScheduler } from '../scheduler';

type EncryptedEnvelope = {
  encrypted: true;
  version: '1';
  salt: string;
  iv: string;
  tag: string;
  data: string;
};

function encryptPayload(plaintext: string, secret: string): EncryptedEnvelope {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(secret, salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    encrypted: true,
    version: '1',
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: encrypted.toString('base64'),
  };
}

function decryptPayload(envelope: EncryptedEnvelope, secret: string): string {
  const salt = Buffer.from(envelope.salt, 'hex');
  const key = crypto.scryptSync(secret, salt, 32);
  const iv = Buffer.from(envelope.iv, 'hex');
  const tag = Buffer.from(envelope.tag, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(Buffer.from(envelope.data, 'base64')) + decipher.final('utf8');
}

const router = Router();

type AccountRow = {
  id: number;
  name: string;
  phone_number: string;
  api_id: number;
  api_hash: string;
  session_string: string | null;
  auth_status: string;
  proxy_id: string | null;
};

type JobRow = {
  id: number;
  account_id: number | null;
  template_id: number | null;
  name: string;
  job_type: string;
  bot_username: string;
  schedule_window_start: number;
  schedule_window_end: number;
  timezone: string;
  reply_timeout_ms: number;
  retry_max: number;
  enabled: number;
  config: string | null;
  start_command: string;
  checkin_button: string;
};

type TemplateRow = {
  id: number;
  name: string;
  job_type: string;
  bot_username: string;
  timezone: string;
  reply_timeout_ms: number;
  retry_max: number;
  config: string | null;
  start_command: string;
  checkin_button: string;
};

type SettingRow = { key: string; value: string };

type AiSupplierRow = {
  id: number;
  name: string;
  base_url: string;
  api_key: string;
  timeout_ms: number;
};

type AiModelRow = {
  id: number;
  supplier_id: number;
  model_id: string;
  label: string | null;
};

export type ExportPayload = {
  version: '1';
  exportedAt: string;
  accounts: Array<{
    name: string;
    phoneNumber: string;
    apiId: number;
    apiHash: string;
    sessionString: string | null;
    authStatus: string;
    proxyId?: string | null;
  }>;
  templates?: Array<{
    name: string;
    jobType: string;
    botUsername: string;
    timezone: string;
    replyTimeoutMs: number;
    retryMax: number;
    config: string | null;
    startCommand: string;
    checkinButton: string;
  }>;
  jobs: Array<{
    /** Index into the accounts array; null for jobs that don't require an account */
    accountIndex: number | null;
    /** Index into the templates array; null if not linked to a template */
    templateIndex?: number | null;
    name: string;
    jobType: string;
    botUsername: string;
    scheduleWindowStart: number;
    scheduleWindowEnd: number;
    timezone: string;
    replyTimeoutMs: number;
    retryMax: number;
    enabled: boolean;
    config: string | null;
    startCommand: string;
    checkinButton: string;
  }>;
  aiSuppliers?: Array<{
    name: string;
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
  }>;
  aiModels?: Array<{
    /** Index into the aiSuppliers array */
    supplierIndex: number;
    modelId: string;
    label: string | null;
  }>;
  settings: Record<string, string>;
};

router.get('/export', (req, res) => {
  const accounts = db.prepare('SELECT * FROM tg_accounts ORDER BY id').all() as AccountRow[];
  const templates = db.prepare('SELECT * FROM job_templates ORDER BY id').all() as TemplateRow[];
  const jobs = db.prepare('SELECT * FROM jobs ORDER BY id').all() as JobRow[];
  const aiSuppliers = db.prepare('SELECT * FROM ai_suppliers ORDER BY id').all() as AiSupplierRow[];
  const aiModels = db.prepare('SELECT * FROM ai_models ORDER BY id').all() as AiModelRow[];
  const settings = db.prepare('SELECT key, value FROM settings').all() as SettingRow[];

  const accountIdToIndex = new Map(accounts.map((a, i) => [a.id, i]));
  const templateIdToIndex = new Map(templates.map((t, i) => [t.id, i]));
  const supplierIdToIndex = new Map(aiSuppliers.map((s, i) => [s.id, i]));

  const payload: ExportPayload = {
    version: '1',
    exportedAt: new Date().toISOString(),
    accounts: accounts.map(a => ({
      name: a.name,
      phoneNumber: a.phone_number,
      apiId: a.api_id,
      apiHash: a.api_hash,
      sessionString: a.session_string,
      authStatus: a.auth_status,
      proxyId: a.proxy_id ?? null,
    })),
    templates: templates.map(t => ({
      name: t.name,
      jobType: t.job_type,
      botUsername: t.bot_username,
      timezone: t.timezone,
      replyTimeoutMs: t.reply_timeout_ms,
      retryMax: t.retry_max,
      config: t.config,
      startCommand: t.start_command,
      checkinButton: t.checkin_button,
    })),
    jobs: jobs.map(j => ({
      accountIndex: j.account_id != null ? (accountIdToIndex.get(j.account_id) ?? null) : null,
      templateIndex: j.template_id != null ? (templateIdToIndex.get(j.template_id) ?? null) : null,
      name: j.name,
      jobType: j.job_type,
      botUsername: j.bot_username,
      scheduleWindowStart: j.schedule_window_start,
      scheduleWindowEnd: j.schedule_window_end,
      timezone: j.timezone,
      replyTimeoutMs: j.reply_timeout_ms,
      retryMax: j.retry_max,
      enabled: j.enabled === 1,
      config: j.config,
      startCommand: j.start_command,
      checkinButton: j.checkin_button,
    })),
    aiSuppliers: aiSuppliers.map(s => ({
      name: s.name,
      baseUrl: s.base_url,
      apiKey: s.api_key,
      timeoutMs: s.timeout_ms,
    })),
    aiModels: aiModels
      .filter(m => supplierIdToIndex.has(m.supplier_id))
      .map(m => ({
        supplierIndex: supplierIdToIndex.get(m.supplier_id)!,
        modelId: m.model_id,
        label: m.label,
      })),
    settings: Object.fromEntries(settings.map(s => [s.key, s.value])),
  };

  const secret = typeof req.query.secret === 'string' && req.query.secret ? req.query.secret : null;
  if (secret) {
    res.json(encryptPayload(JSON.stringify(payload), secret));
  } else {
    res.json(payload);
  }
});

router.post('/import', (req, res) => {
  let { data, mode, secret, forceReauth = true } = req.body as { data: ExportPayload | EncryptedEnvelope; mode: 'merge' | 'replace'; secret?: string; forceReauth?: boolean };

  if (data && (data as EncryptedEnvelope).encrypted === true) {
    if (!secret) {
      res.status(400).json({ error: 'This backup is encrypted. Please provide the secret to decrypt it.' });
      return;
    }
    try {
      data = JSON.parse(decryptPayload(data as EncryptedEnvelope, secret)) as ExportPayload;
    } catch {
      res.status(400).json({ error: 'Incorrect secret or corrupted backup file', code: 'WRONG_SECRET' });
      return;
    }
  }

  const payload = data as ExportPayload;

  if (!payload || payload.version !== '1') {
    res.status(400).json({ error: 'Invalid or unsupported export file' });
    return;
  }

  if (!Array.isArray(payload.accounts) || !Array.isArray(payload.jobs)) {
    res.status(400).json({ error: 'Malformed export file: missing accounts or jobs' });
    return;
  }

  const results = { accountsImported: 0, accountsSkipped: 0, templatesImported: 0, jobsImported: 0, aiSuppliersImported: 0, aiModelsImported: 0, settingsUpdated: 0 };

  db.transaction(() => {
    if (mode === 'replace') {
      // FK order: models -> suppliers, jobs -> templates/accounts
      db.prepare('DELETE FROM ai_models').run();
      db.prepare('DELETE FROM ai_suppliers').run();
      db.prepare('DELETE FROM jobs').run();
      db.prepare('DELETE FROM job_templates').run();
      db.prepare('DELETE FROM tg_accounts').run();
    }

    // Import accounts and build accountIndex -> new db id mapping
    const accountIndexToId = new Map<number, number>();

    for (let i = 0; i < payload.accounts.length; i++) {
      const a = payload.accounts[i];

      if (mode === 'merge') {
        const existing = db.prepare('SELECT id FROM tg_accounts WHERE phone_number = ?').get(a.phoneNumber) as { id: number } | undefined;
        if (existing) {
          accountIndexToId.set(i, existing.id);
          results.accountsSkipped++;
          continue;
        }
      }

      const result = db.prepare(
        `INSERT INTO tg_accounts (name, phone_number, api_id, api_hash, session_string, auth_status, proxy_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        a.name, a.phoneNumber, a.apiId, a.apiHash,
        forceReauth ? null : (a.sessionString ?? null),
        forceReauth ? 'unauthenticated' : (a.authStatus ?? 'unauthenticated'),
        a.proxyId ?? null,
      );

      accountIndexToId.set(i, result.lastInsertRowid as number);
      results.accountsImported++;
    }

    // Import templates and build templateIndex -> new db id mapping
    const templateIndexToId = new Map<number, number>();

    if (Array.isArray(payload.templates)) {
      for (let i = 0; i < payload.templates.length; i++) {
        const t = payload.templates[i];

        if (mode === 'merge') {
          const existing = db.prepare('SELECT id FROM job_templates WHERE name = ?').get(t.name) as { id: number } | undefined;
          if (existing) {
            templateIndexToId.set(i, existing.id);
            continue;
          }
        }

        const result = db.prepare(
          `INSERT INTO job_templates
             (name, job_type, bot_username, timezone, reply_timeout_ms, retry_max, config, start_command, checkin_button)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          t.name,
          t.jobType ?? 'checkin',
          t.botUsername ?? '',
          t.timezone ?? 'Australia/Sydney',
          t.replyTimeoutMs ?? 40000,
          t.retryMax ?? 5,
          t.config ?? null,
          t.startCommand ?? '/start',
          t.checkinButton ?? '签到',
        );

        templateIndexToId.set(i, result.lastInsertRowid as number);
        results.templatesImported++;
      }
    }

    // Import jobs
    for (const j of payload.jobs) {
      const resolvedAccountId = j.accountIndex != null ? (accountIndexToId.get(j.accountIndex) ?? null) : null;
      const resolvedTemplateId = j.templateIndex != null ? (templateIndexToId.get(j.templateIndex) ?? null) : null;

      db.prepare(
        `INSERT INTO jobs
           (account_id, template_id, name, job_type, bot_username, schedule_window_start, schedule_window_end,
            timezone, reply_timeout_ms, retry_max, enabled, config, start_command, checkin_button)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        resolvedAccountId,
        resolvedTemplateId,
        j.name,
        j.jobType ?? 'checkin',
        j.botUsername,
        j.scheduleWindowStart ?? 1400,
        j.scheduleWindowEnd ?? 1600,
        j.timezone ?? 'Australia/Sydney',
        j.replyTimeoutMs ?? 40000,
        j.retryMax ?? 5,
        j.enabled ? 1 : 0,
        j.config ?? null,
        j.startCommand ?? '/start',
        j.checkinButton ?? '签到',
      );
      results.jobsImported++;
    }

    // Import AI suppliers and build supplierIndex -> new db id mapping
    const supplierIndexToId = new Map<number, number>();

    if (Array.isArray(payload.aiSuppliers)) {
      for (let i = 0; i < payload.aiSuppliers.length; i++) {
        const s = payload.aiSuppliers[i];

        if (mode === 'merge') {
          const existing = db.prepare('SELECT id FROM ai_suppliers WHERE name = ?').get(s.name) as { id: number } | undefined;
          if (existing) {
            supplierIndexToId.set(i, existing.id);
            continue;
          }
        }

        const result = db.prepare(
          'INSERT INTO ai_suppliers (name, base_url, api_key, timeout_ms) VALUES (?, ?, ?, ?)',
        ).run(s.name, s.baseUrl, s.apiKey, s.timeoutMs ?? 25000);

        supplierIndexToId.set(i, result.lastInsertRowid as number);
        results.aiSuppliersImported++;
      }
    }

    // Import AI models
    if (Array.isArray(payload.aiModels)) {
      for (const m of payload.aiModels) {
        const resolvedSupplierId = supplierIndexToId.get(m.supplierIndex);
        if (resolvedSupplierId == null) continue;

        db.prepare(
          'INSERT INTO ai_models (supplier_id, model_id, label) VALUES (?, ?, ?)',
        ).run(resolvedSupplierId, m.modelId, m.label ?? null);
        results.aiModelsImported++;
      }
    }

    // Merge settings
    if (payload.settings && typeof payload.settings === 'object') {
      const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      for (const [key, value] of Object.entries(payload.settings)) {
        if (typeof value === 'string') { stmt.run(key, value); results.settingsUpdated++; }
      }
    }
  })();

  refreshScheduler();
  res.json({ message: 'Import complete', ...results });
});

export default router;
