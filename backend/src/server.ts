import 'dotenv/config';
import express from 'express';

// GramJS throws TIMEOUT from its background _updateLoop after disconnect — suppress it
process.on('unhandledRejection', (reason: any) => {
  if (reason?.message === 'TIMEOUT') return;
  console.error('Unhandled rejection:', reason);
});
import cors from 'cors';
import path from 'path';

import authRouter from './routes/auth';
import accountsRouter from './routes/accounts';
import jobsRouter from './routes/jobs';
import logsRouter from './routes/logs';
import statusRouter from './routes/status';
import settingsRouter from './routes/settings';
import { requireAuth } from './middleware/auth';
import { startScheduler } from './scheduler';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const BIND_HOST = process.env.HOST ?? '0.0.0.0';
const DISPLAY_HOST = process.env.DISPLAY_HOST ?? BIND_HOST;

app.use(cors());
app.use(express.json());

// Public routes
app.use('/api/auth', authRouter);

// Protected API routes
app.use('/api/accounts', requireAuth, accountsRouter);
app.use('/api/jobs', requireAuth, jobsRouter);
app.use('/api/logs', requireAuth, logsRouter);
app.use('/api/status', requireAuth, statusRouter);
app.use('/api/settings', requireAuth, settingsRouter);

// Serve Vue SPA
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, BIND_HOST, () => {
  console.log(`Bemby admin: http://${DISPLAY_HOST}:${PORT}`);
  startScheduler();
});
