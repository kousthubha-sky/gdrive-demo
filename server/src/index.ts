import "./load-env.js";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { MulterError } from "multer";
import passport from "passport";
import { ZodError } from "zod";
import { authRouter } from "./auth.js";
import { prisma } from "./db.js";
import { env, isProd } from "./env.js";
import { HttpError } from "./errors.js";
import { filesRouter } from "./routes/files.js";

const app = express();

// Behind Render/Fly/Heroku's proxy, so `secure` cookies and req.protocol work.
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        // Google profile pictures, plus blob/data previews rendered client-side.
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "connect-src": ["'self'", "https:"],
        "upgrade-insecure-requests": isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(morgan(isProd ? "combined" : "dev"));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(passport.initialize());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRouter);
app.use("/api/files", filesRouter);

// Any unmatched /api path is a 404 in JSON, never the SPA shell.
app.use("/api", (_req: Request, _res: Response, next: NextFunction) => {
  next(new HttpError(404, "Endpoint not found"));
});

// In production one process serves both the API and the built SPA, so there is
// a single origin, a single deploy, and no CORS.
const webDist = resolve(import.meta.dirname, "../../web/dist");
const hasWebUi = existsSync(webDist);
if (hasWebUi) {
  app.use(express.static(webDist, { index: false, maxAge: "1h" }));
  app.use((_req: Request, res: Response) => {
    res.sendFile(resolve(webDist, "index.html"));
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: err.issues.map((i) => i.message).join("; ") || "Invalid request",
      issues: err.issues,
    });
  }
  if (err instanceof MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? `File is larger than the ${Math.round(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit`
        : err.message;
    return res.status(status).json({ error: message });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }

  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

app.listen(env.PORT, () => {
  console.log(`API listening on ${env.APP_URL} (port ${env.PORT})`);
  if (!hasWebUi) console.log(`Web UI expected at ${env.WEB_URL}`);
});

// Report an unreachable database at boot rather than at the first login. Not
// fatal: a briefly unavailable database shouldn't stop the process coming up.
prisma.$connect().catch((err: Error) => {
  console.error(
    `\nCannot reach the database. Check DATABASE_URL in .env, then run "npm run db:push".\n  ${err.message}\n`
  );
});
