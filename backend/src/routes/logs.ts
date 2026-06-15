import { Router } from 'express';
import { db } from '../db/database';
import { cancelJob, isJobRunning, getLiveDetail } from '../jobs/cancellation';

const router = Router();

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`
    SELECT l.id, l.job_id, l.ran_at, l.status, l.message, l.detail,
           j.name AS job_name, j.job_type,
           a.name AS account_name
    FROM job_logs l
    LEFT JOIN jobs j ON l.job_id = j.id
    LEFT JOIN tg_accounts a ON j.account_id = a.id
    WHERE l.id = ?
  `).get(id) as any;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  const liveDetail = getLiveDetail(id);
  res.json({
    id: row.id,
    jobId: row.job_id,
    jobName: row.job_name,
    jobType: row.job_type ?? null,
    accountName: row.account_name,
    ranAt: row.ran_at,
    status: row.status,
    message: row.message,
    detail: liveDetail ?? (row.detail ? JSON.parse(row.detail) : null),
  });
});

router.get('/', (req, res) => {
  const { jobId, limit = '50', offset = '0' } = req.query as Record<string, string>;

  const params: (string | number)[] = [];
  let where = '';

  if (jobId) {
    where = 'WHERE l.job_id = ?';
    params.push(Number(jobId));
  }

  params.push(Number(limit), Number(offset));

  const rows = db.prepare(`
    SELECT l.id, l.job_id, l.ran_at, l.status, l.message,
           j.name AS job_name, j.job_type,
           a.name AS account_name
    FROM job_logs l
    LEFT JOIN jobs j ON l.job_id = j.id
    LEFT JOIN tg_accounts a ON j.account_id = a.id
    ${where}
    ORDER BY l.ran_at DESC
    LIMIT ? OFFSET ?
  `).all(...params) as any[];

  res.json(rows.map(r => ({
    id: r.id,
    jobId: r.job_id,
    jobName: r.job_name,
    jobType: r.job_type ?? null,
    accountName: r.account_name,
    ranAt: r.ran_at,
    status: r.status,
    message: r.message,
  })));
});

router.post('/:id/cancel', (req, res) => {
  const logId = Number(req.params.id);
  if (!isJobRunning(logId)) {
    res.status(404).json({ error: 'No running job found for this log entry' });
    return;
  }
  cancelJob(logId);
  res.json({ message: 'Cancel signal sent' });
});

export default router;
