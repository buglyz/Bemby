import "dotenv/config";
import express from "express";
import { createServer } from "http";

// GramJS throws TIMEOUT from its background _updateLoop after disconnect — suppress it
process.on("unhandledRejection", (reason: any) => {
  if (reason?.message === "TIMEOUT") return;
  console.error("Unhandled rejection:", reason);
});
import cors from "cors";
import path from "path";

import authRouter from "./routes/auth";
import accountsRouter from "./routes/accounts";
import jobsRouter from "./routes/jobs";
import logsRouter from "./routes/logs";
import statusRouter from "./routes/status";
import settingsRouter from "./routes/settings";
import dataRouter from "./routes/data";
import debugRouter from "./routes/debug";
import aiSuppliersRouter from "./routes/ai-suppliers";
import templatesRouter from "./routes/templates";
import tgClientRouter from "./routes/tgClient";
import { requireAuth, getJwtSecret } from "./middleware/auth";
import { startScheduler } from "./scheduler";
import { attachWebSocket } from "./tg/wsHandler";

// Validate critical env vars before accepting any requests
getJwtSecret();

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const BIND_HOST = process.env.HOST ?? "0.0.0.0";
const DISPLAY_HOST = process.env.DISPLAY_HOST ?? BIND_HOST;

// TRUST_PROXY: set to the number of proxy hops in front of this app.
// 0/false = direct internet (no proxy) -- clients cannot spoof X-Forwarded-For
// 1       = one reverse proxy (nginx, Caddy, Railway, etc.)
// 2+      = multiple proxies (e.g. Cloudflare + nginx)
const trustProxy = process.env.TRUST_PROXY ?? '0';
app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

app.use(cors());
app.use(express.json());

// Health check -- no auth required
app.get("/api/health", (_req: express.Request, res: express.Response) =>
  res.json({ status: "ok" }),
);

// Public routes
app.use("/api/auth", authRouter);

// Protected API routes
app.use("/api/accounts", requireAuth, accountsRouter);
app.use("/api/jobs", requireAuth, jobsRouter);
app.use("/api/logs", requireAuth, logsRouter);
app.use("/api/status", requireAuth, statusRouter);
app.use("/api/settings", requireAuth, settingsRouter);
app.use("/api/data", requireAuth, dataRouter);
app.use("/api/debug", requireAuth, debugRouter);
app.use("/api/ai-suppliers", requireAuth, aiSuppliersRouter);
app.use("/api/templates", requireAuth, templatesRouter);
app.use("/api/tg-client", requireAuth, tgClientRouter);

// Serve Vue SPA
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
app.get("*", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const server = createServer(app);
attachWebSocket(server);
server.listen(PORT, BIND_HOST, () => {
  console.log(`Bemby admin: http://${DISPLAY_HOST}:${PORT}`);
  startScheduler();
});
