import path from "node:path";
import nextImport from "next";
import { createApp } from "./app.js";
import { bootstrap } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { createContext } from "./context.js";

const cfg = loadConfig();
const ctx = createContext(cfg);
await bootstrap(ctx);

const app = createApp(ctx);

// One service, one origin: the dashboard is served by the same process, so the session cookie
// and the SQLite disk are shared without CORS or a second deployment.
// next ships CommonJS; under NodeNext its default export is the module object
const next = ((nextImport as unknown as { default?: unknown }).default ?? nextImport) as unknown as typeof import("next/dist/server/next.js").default;
const dashboard = next({ dev: cfg.nodeEnv !== "production", dir: path.join(cfg.repoRoot, "apps/dashboard") });
await dashboard.prepare();
const handle = dashboard.getRequestHandler();
app.all("/{*splat}", (req, res) => handle(req, res));

// keep the rolling week of demo slots topped up
setInterval(() => bootstrap(ctx, { sync: false }).catch(console.error), 6 * 3600_000).unref();

app.listen(cfg.port, () => console.log(`AI receptionist on :${cfg.port} (${cfg.nodeEnv})`));
