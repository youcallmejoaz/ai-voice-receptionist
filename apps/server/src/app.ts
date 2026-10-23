import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AppContext } from "./context.js";
import { adminRoutes } from "./routes/admin.js";
import { vapiRoutes } from "./routes/vapi.js";

/** The API. The dashboard (Next.js) is mounted after this in index.ts, on the same origin. */
export function createApp(ctx: AppContext) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.use("/api/vapi", vapiRoutes(ctx));
  app.use("/api", adminRoutes(ctx));
  app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  });
  return app;
}
