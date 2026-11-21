// agent-bridge.mjs - local HTTP bridge in front of herdr's CLI.
// Phase-2 lab: read panes + send input, plus a small built-in UI.
// Binds 127.0.0.1 only. Bearer token (header or ?token=) except / and /health.
import http from "node:http";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HERDR = process.env.HERDR_BIN || join(process.env.LOCALAPPDATA || "", "Programs", "herdr", "herdr.exe");
const UI_FILE = process.env.UI_FILE || join(HERE, "ui.html");
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 18888);
const TOKEN = process.env.BRIDGE_TOKEN || "";

function run(args, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile(HERDR, args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, out, errOut) => {
      if (err) {
        const e = new Error((errOut && errOut.trim()) || err.message);
        e.code = err.code;
        return reject(e);
      }
      resolve(out);
    });
  });
}

function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, code, body, type = "application/json; charset=utf-8") {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(code, { "content-type": type, "content-length": buf.length, "cache-control": "no-store" });
  res.end(buf);
}

function unauthorized(req, url) {
  if (!TOKEN) return false;
  const h = req.headers["authorization"] || "";
  if (h === `Bearer ${TOKEN}`) return false;
  if (url && url.searchParams.get("token") === TOKEN) return false;
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  try {
    if (url.pathname === "/health") {
      return send(res, 200, JSON.stringify({ ok: true, service: "agent-bridge", herdr: HERDR }));
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return send(res, 200, readFileSync(UI_FILE), "text/html; charset=utf-8");
    }
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    if (unauthorized(req, url)) {
      return send(res, 401, JSON.stringify({ error: "unauthorized" }));
    }
    if (req.method === "GET" && url.pathname === "/snapshot") {
      return send(res, 200, await run(["api", "snapshot"]));
    }
    if (req.method === "GET" && url.pathname === "/panes") {
      return send(res, 200, await run(["pane", "list"]), "text/plain; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/agents") {
      return send(res, 200, await run(["agent", "list"]), "text/plain; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/pane") {
      const id = url.searchParams.get("id");
      if (!id) return send(res, 400, JSON.stringify({ error: "id required" }));
      const lines = url.searchParams.get("lines") || "160";
      const out = await run(["pane", "read", id, "--lines", lines, "--source", "recent"]);
      return send(res, 200, out, "text/plain; charset=utf-8");
    }
    if (req.method === "POST" && url.pathname === "/send") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.pane) return send(res, 400, JSON.stringify({ error: "pane required" }));
      if (typeof body.text !== "string") return send(res, 400, JSON.stringify({ error: "text required" }));
      await run(["pane", "send-text", body.pane, body.text]);
      if (body.enter !== false) await run(["pane", "send-keys", body.pane, "enter"]);
      return send(res, 200, JSON.stringify({ ok: true }));
    }
    if (req.method === "POST" && url.pathname === "/keys") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.pane || !Array.isArray(body.keys) || !body.keys.length) {
        return send(res, 400, JSON.stringify({ error: "pane and keys required" }));
      }
      await run(["pane", "send-keys", body.pane, ...body.keys.map(String)]);
      return send(res, 200, JSON.stringify({ ok: true }));
    }
    if (req.method === "POST" && url.pathname === "/prompt") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.target || typeof body.text !== "string") {
        return send(res, 400, JSON.stringify({ error: "target and text required" }));
      }
      const args = ["agent", "prompt", body.target, body.text];
      if (body.wait) args.push("--wait");
      await run(args);
      return send(res, 200, JSON.stringify({ ok: true }));
    }
    if (req.method === "POST" && url.pathname === "/agent/start") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.pane) return send(res, 400, JSON.stringify({ error: "pane required" }));
      const name = body.name || "claude";
      const kind = body.kind || "claude";
      await run(["agent", "start", name, "--kind", kind, "--pane", body.pane]);
      return send(res, 200, JSON.stringify({ ok: true, name, kind }));
    }
    return send(res, 404, JSON.stringify({ error: "not found" }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ error: String((e && e.message) || e) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`agent-bridge listening on http://${HOST}:${PORT} (auth=${TOKEN ? "on" : "off"})`);
});
