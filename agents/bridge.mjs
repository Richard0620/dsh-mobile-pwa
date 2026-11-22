// agent-bridge.mjs - local HTTP bridge in front of herdr's CLI.
// Phase-2 lab: read panes + send input, plus a small built-in UI.
// Binds 127.0.0.1 only. Bearer token (header or ?token=) except / and /health.
import http from "node:http";
import { execFile, spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { homedir } from "node:os";

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

const CLAUDE_ROOT = join(process.env.USERPROFILE || homedir(), ".claude", "projects");

// ---- DSH chat: one persisted headless session per pane, driven by this bridge ----
const DSH_CHAT_FILE = join(process.env.LOCALAPPDATA || "", "agents-bridge", "dsh-chat.json");
const DSH_BIN = join(process.env.APPDATA || "", "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const DSH_MAX_MESSAGES = 200;
const DSH_MAX_CONCURRENT = 1;
const DSH_TIMEOUT_MS = 5 * 60 * 1000;
const dshChildren = new Map(); // pane -> { child, timer, stopped }
const dshQueue = [];
const dshTurns = new Map(); // pane -> { events: [], subs: Set<res> }
let dshRunning = 0;

function dshTurnState(pane) {
  let t = dshTurns.get(pane);
  if (!t) { t = { events: [], subs: new Set() }; dshTurns.set(pane, t); }
  return t;
}
function dshEmit(pane, ev) {
  if (!pane) return;
  const t = dshTurnState(pane);
  t.events.push(ev);
  if (t.events.length > 500) t.events.shift();
  const line = JSON.stringify(ev) + "\n";
  for (const sub of t.subs) {
    try { sub.write(line); } catch {}
  }
}
let dshStore = {};
try { dshStore = JSON.parse(readFileSync(DSH_CHAT_FILE, "utf8")) || {}; } catch { dshStore = {}; }
function saveDshStore() {
  try {
    for (const e of Object.values(dshStore)) {
      if (Array.isArray(e.messages) && e.messages.length > DSH_MAX_MESSAGES) e.messages = e.messages.slice(-DSH_MAX_MESSAGES);
    }
    mkdirSync(dirname(DSH_CHAT_FILE), { recursive: true });
    writeFileSync(DSH_CHAT_FILE, JSON.stringify(dshStore));
  } catch {}
}
function dshTurn(entry, text, pane, onEvent) {
  return new Promise((resolve) => {
    const args = [DSH_BIN, "--profile", "headless", "--json"];
    if (entry.sessionId) args.push("--session-id", entry.sessionId);
    args.push(text);
    let child;
    try {
      child = spawn(process.execPath, args, { cwd: entry.cwd || process.cwd(), windowsHide: true });
    } catch (e) {
      return resolve({ text: "", sid: "", err: String(e), code: -1, stopped: false });
    }
    let buf = "";
    let err = "";
    let sid = "";
    let final = null;
    let timedOut = false;
    const handle = (o) => {
      if (!o || typeof o !== "object") return;
      if (o.type === "session" && o.sessionId) sid = o.sessionId;
      if (o.type === "final") final = o;
      if (onEvent) { try { onEvent(o); } catch {} }
    };
    const rec = { child, stopped: false };
    if (pane) dshChildren.set(pane, rec);
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch {}
    }, DSH_TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      buf += d.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try { handle(JSON.parse(line)); } catch {}
      }
    });
    child.stderr.on("data", (d) => { err += d.toString("utf8"); });
    child.on("error", (e) => {
      clearTimeout(timer);
      if (pane) dshChildren.delete(pane);
      resolve({ text: "", sid, err: String(e), code: -1, stopped: !!rec.stopped });
    });
    child.on("close", (code) => {
      if (buf.trim()) { try { handle(JSON.parse(buf)); } catch {} }
      clearTimeout(timer);
      if (pane) dshChildren.delete(pane);
      if (timedOut) err = (err ? err + "\n" : "") + "timeout after " + Math.round(DSH_TIMEOUT_MS / 60000) + " min";
      resolve({ text: (final && final.text) || "", sid, err, code, stopped: !!rec.stopped });
    });
  });
}

function drainDshQueue() {
  if (dshRunning >= DSH_MAX_CONCURRENT) return;
  const job = dshQueue.shift();
  if (!job) return;
  dshRunning++;
  (async () => {
    const r = await dshTurn(job.entry, job.text, job.pane, (ev) => dshEmit(job.pane, ev));
    if (r.sid) job.entry.sessionId = r.sid;
    if (r.text) {
      job.entry.messages.push({ role: "assistant", text: r.text, time: new Date().toISOString() });
    } else {
      const msg = r.stopped ? "\u5DF2\u505C\u6B62" : ((r.err || "").trim() || ("exit " + r.code));
      job.entry.error = msg.slice(0, 4000);
      job.entry.messages.push({ role: "assistant", text: "\u26A0\uFE0F " + msg, time: new Date().toISOString() });
    }
    job.entry.busy = false;
    saveDshStore();
    dshEmit(job.pane, { type: "done", message: job.entry.messages[job.entry.messages.length - 1] || null });
    dshRunning--;
    drainDshQueue();
  })();
}

function enqueueDsh(entry, text, pane) {
  dshQueue.push({ entry, text, pane });
  drainDshQueue();
}

function encodeProjectDir(cwd) {
  return String(cwd || "").replace(/[\\/:]/g, "-");
}

function findSessionFile(cwd, sid) {
  if (!sid) return "";
  const name = sid + ".jsonl";
  const cands = [];
  if (cwd) cands.push(join(CLAUDE_ROOT, encodeProjectDir(cwd), name));
  try {
    for (const d of readdirSync(CLAUDE_ROOT)) cands.push(join(CLAUDE_ROOT, d, name));
  } catch {}
  for (const p of cands) {
    try { if (existsSync(p)) return p; } catch {}
  }
  return "";
}

function summarizeInput(input) {
  try {
    const s = typeof input === "string" ? input : JSON.stringify(input);
    return s.length > 400 ? s.slice(0, 400) + "\u2026" : s;
  } catch { return ""; }
}

function normalizeChat(lines, limit) {
  const out = [];
  for (const line of lines) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== "user" && o.type !== "assistant") continue;
    const m = o.message || {};
    const content = m.content;
    const time = o.timestamp || "";
    if (o.type === "user") {
      if (typeof content === "string") {
        out.push({ role: "user", text: content, time });
      } else if (Array.isArray(content)) {
        const texts = content.filter((b) => b && b.type === "text").map((b) => b.text || "").join("\n").trim();
        const results = content.filter((b) => b && b.type === "tool_result").length;
        if (texts) out.push({ role: "user", text: texts, time });
        else if (results) out.push({ role: "tool", text: "(" + results + " tool result)", time });
      }
    } else {
      const blocks = Array.isArray(content) ? content : [];
      const texts = blocks.filter((b) => b && b.type === "text").map((b) => b.text || "").join("\n").trim();
      const tools = blocks.filter((b) => b && b.type === "tool_use").map((b) => ({ name: b.name || "tool", input: summarizeInput(b.input) }));
      if (texts || tools.length) out.push({ role: "assistant", text: texts, tools, time });
    }
  }
  return out.slice(-limit);
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
  res.writeHead(code, { "content-type": type, "content-length": buf.length, "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" });
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
      let out;
      try {
        out = await run(["pane", "read", id, "--lines", lines, "--source", "recent-unwrapped"]);
      } catch {
        out = await run(["pane", "read", id, "--lines", lines, "--source", "recent"]);
      }
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
      const snap = JSON.parse(await run(["api", "snapshot"])).result.snapshot;
      const p = (snap.panes || []).find((x) => x.pane_id === body.pane) || {};
      const t = (snap.tabs || []).find((x) => x.tab_id === p.tab_id) || {};
      const kind = body.kind || "claude";
      let name = body.name || (kind + "-" + (t.number || "x"));
      try {
        await run(["agent", "start", name, "--kind", kind, "--pane", body.pane]);
      } catch (e) {
        if (!/agent_name_taken/.test(String((e && e.message) || e))) throw e;
        name = name + "-" + Date.now().toString(36).slice(-4);
        await run(["agent", "start", name, "--kind", kind, "--pane", body.pane]);
      }
      return send(res, 200, JSON.stringify({ ok: true, name, kind }));
    }
    if (req.method === "POST" && url.pathname === "/tab/create") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const cwd = body.cwd;
      if (!cwd) return send(res, 400, JSON.stringify({ error: "cwd required" }));
      const label = body.label || basename(cwd) || "term";
      const startAgent = body.startAgent === true;
      const before = JSON.parse(await run(["api", "snapshot"])).result.snapshot;
      const beforeTabs = new Set((before.tabs || []).map((t) => t.tab_id));
      await run(["tab", "create", "--cwd", cwd, "--label", label, "--no-focus"]);
      const after = JSON.parse(await run(["api", "snapshot"])).result.snapshot;
      const tab = (after.tabs || []).find((t) => !beforeTabs.has(t.tab_id));
      if (!tab) return send(res, 500, JSON.stringify({ error: "tab created but not found in snapshot" }));
      const pane = (after.panes || []).find((p) => p.tab_id === tab.tab_id);
      let started = false;
      let startErr = "";
      if (pane && startAgent) {
        let name = "claude-" + (tab.number || "x");
        try {
          await run(["agent", "start", name, "--kind", "claude", "--pane", pane.pane_id]);
          started = true;
        } catch (e) {
          const msg = String((e && e.message) || e);
          if (/agent_not_ready/.test(msg)) {
            started = true;
          } else if (/agent_name_taken/.test(msg)) {
            try {
              name = name + "-" + Date.now().toString(36).slice(-4);
              await run(["agent", "start", name, "--kind", "claude", "--pane", pane.pane_id]);
              started = true;
            } catch (e2) { startErr = String((e2 && e2.message) || e2); }
          } else {
            startErr = msg;
          }
        }
      }
      return send(res, 200, JSON.stringify({ ok: true, tabId: tab.tab_id, paneId: pane ? pane.pane_id : "", started, startErr }));
    }
    if (req.method === "GET" && url.pathname === "/chat") {
      const pane = url.searchParams.get("pane");
      const limit = Math.min(500, Number(url.searchParams.get("limit") || 200));
      let sid = url.searchParams.get("session") || "";
      let cwd = url.searchParams.get("cwd") || "";
      if (!sid && pane) {
        const snap = JSON.parse(await run(["api", "snapshot"])).result.snapshot;
        const a = (snap.agents || []).find((x) => x.pane_id === pane);
        if (!a) return send(res, 404, JSON.stringify({ error: "no agent in this pane" }));
        sid = (a.agent_session && a.agent_session.value) || "";
        cwd = a.cwd || cwd;
      }
      if (!sid) return send(res, 400, JSON.stringify({ error: "pane or session required" }));
      const file = findSessionFile(cwd, sid);
      if (!file) return send(res, 200, JSON.stringify({ sessionId: sid, file: "", messages: [] }));
      const raw = readFileSync(file, "utf8");
      const messages = normalizeChat(raw.split(/\r?\n/), limit);
      let mtime = 0;
      try { mtime = statSync(file).mtimeMs; } catch {}
      return send(res, 200, JSON.stringify({ sessionId: sid, file, mtime, messages }));
    }
    if (req.method === "POST" && url.pathname === "/tab/close") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.tabId) return send(res, 400, JSON.stringify({ error: "tabId required" }));
      await run(["tab", "close", body.tabId]);
      return send(res, 200, JSON.stringify({ ok: true }));
    }
    if (req.method === "GET" && url.pathname === "/dsh/state") {
      const pane = url.searchParams.get("pane") || "";
      const e = dshStore[pane];
      if (!e) return send(res, 200, JSON.stringify({ exists: false }));
      return send(res, 200, JSON.stringify({ exists: true, pane, sessionId: e.sessionId || "", cwd: e.cwd || "", busy: !!e.busy, error: e.error || "", messages: (e.messages || []).slice(-200) }));
    }
    if (req.method === "GET" && url.pathname === "/dsh/stream") {
      const pane = url.searchParams.get("pane") || "";
      if (!pane) return send(res, 400, JSON.stringify({ error: "pane required" }));
      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "x-accel-buffering": "no",
        "referrer-policy": "no-referrer",
      });
      const t = dshTurnState(pane);
      for (const ev of t.events) { try { res.write(JSON.stringify(ev) + "\n"); } catch {} }
      t.subs.add(res);
      const ka = setInterval(() => { try { res.write(JSON.stringify({ type: "ping" }) + "\n"); } catch {} }, 15000);
      req.on("close", () => { clearInterval(ka); t.subs.delete(res); });
      return;
    }
    if (req.method === "POST" && url.pathname === "/dsh/start") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.pane) return send(res, 400, JSON.stringify({ error: "pane required" }));
      let e = dshStore[body.pane];
      if (!e) {
        let cwd = body.cwd || "";
        if (!cwd) {
          const snap = JSON.parse(await run(["api", "snapshot"])).result.snapshot;
          const p = (snap.panes || []).find((x) => x.pane_id === body.pane);
          cwd = (p && p.cwd) || process.cwd();
        }
        e = { cwd, sessionId: "", messages: [], busy: false, error: "", startedAt: Date.now() };
        dshStore[body.pane] = e;
        saveDshStore();
      }
      return send(res, 200, JSON.stringify({ ok: true, exists: true, pane: body.pane, sessionId: e.sessionId || "", cwd: e.cwd || "", busy: !!e.busy, messages: (e.messages || []).slice(-200) }));
    }
    if (req.method === "POST" && url.pathname === "/dsh/send") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.pane || typeof body.text !== "string" || !body.text.trim()) {
        return send(res, 400, JSON.stringify({ error: "pane and text required" }));
      }
      const e = dshStore[body.pane];
      if (!e) return send(res, 404, JSON.stringify({ error: "dsh not started in this pane" }));
      if (e.busy) return send(res, 409, JSON.stringify({ error: "busy" }));
      e.busy = true;
      e.error = "";
      e.messages.push({ role: "user", text: body.text, time: new Date().toISOString() });
      saveDshStore();
      const entry = e;
      dshTurnState(body.pane).events = [];
      enqueueDsh(entry, body.text, body.pane);
      return send(res, 200, JSON.stringify({ ok: true, busy: true }));
    }
    if (req.method === "POST" && url.pathname === "/dsh/reset") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.pane) return send(res, 400, JSON.stringify({ error: "pane required" }));
      const e = dshStore[body.pane];
      if (e) {
        e.sessionId = "";
        e.messages = [];
        e.busy = false;
        e.error = "";
        saveDshStore();
      }
      return send(res, 200, JSON.stringify({ ok: true }));
    }
    if (req.method === "POST" && url.pathname === "/dsh/close") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.pane) return send(res, 400, JSON.stringify({ error: "pane required" }));
      delete dshStore[body.pane];
      try { dshTurns.delete(body.pane); } catch {}
      saveDshStore();
      return send(res, 200, JSON.stringify({ ok: true }));
    }
    if (req.method === "POST" && url.pathname === "/dsh/stop") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.pane) return send(res, 400, JSON.stringify({ error: "pane required" }));
      const e = dshStore[body.pane];
      if (!e) return send(res, 404, JSON.stringify({ error: "no dsh session" }));
      for (let i = dshQueue.length - 1; i >= 0; i--) if (dshQueue[i].pane === body.pane) dshQueue.splice(i, 1);
      const rec = dshChildren.get(body.pane);
      if (rec) {
        rec.stopped = true;
        try { rec.child.kill(); } catch {}
      } else {
        e.busy = false;
        dshEmit(body.pane, { type: "done", message: null });
      }
      e.error = "stopped";
      saveDshStore();
      return send(res, 200, JSON.stringify({ ok: true }));
    }
    return send(res, 404, JSON.stringify({ error: "not found" }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ error: String((e && e.message) || e) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`agent-bridge listening on http://${HOST}:${PORT} (auth=${TOKEN ? "on" : "off"})`);
});
