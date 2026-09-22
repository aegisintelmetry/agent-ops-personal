import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Bridge } = require("./electron/bridge.cjs");

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "btk-local-read-preview",
      transformIndexHtml(html, context) {
        // Vite's development-only React refresh bootstrap is inline; packaged CSP stays strict.
        return context.server
          ? html.replace(
              "script-src 'self'",
              "script-src 'self' 'unsafe-inline'",
            ).replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:*")
          : html;
      },
      configureServer(server) {
        const bridge = new Bridge();
        server.httpServer?.once("close", () => bridge.stop());
        server.middlewares.use("/api/desktop", async (req, res) => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          const host = req.headers.host || "";
          if (
            !/^127\.0\.0\.1:\d+$/.test(host) ||
            (req.headers.origin && req.headers.origin !== `http://${host}`) ||
            req.headers["sec-fetch-site"] === "cross-site"
          ) {
            res.statusCode = 403;
            return res.end(
              JSON.stringify({ error: "허용되지 않은 출처입니다." }),
            );
          }
          const url = new URL(req.url, `http://${host}`);
          const method = url.pathname.slice(1);
          if (
            req.method !== "GET" ||
            !["snapshot", "connection", "readiness", "task"].includes(method)
          ) {
            res.statusCode = 403;
            return res.end(
              JSON.stringify({ error: "브라우저 미리보기는 조회 전용입니다." }),
            );
          }
          try {
            const result = await bridge.call(method, {
              task_id: url.searchParams.get("task_id"),
            });
            res.end(JSON.stringify(result));
          } catch (error) {
            res.statusCode = 503;
            res.end(JSON.stringify({ error: error.message }));
          }
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 4380 },
});
