#!/usr/bin/env node
/**
 * 部署前静态预检：语法、版本号/CACHE 一致性、冲突标记、补丁语法。
 * 目标是把「只有 node --check」升级成一条可重复执行的检查，deploy.ps1 会先跑它。
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fails = [];
const ok = (m) => console.log('  ✓ ' + m);
const fail = (m) => { fails.push(m); console.log('  ✗ ' + m); };

function nodeCheck(file, label) {
  if (!existsSync(file)) { fail(`${label} 不存在`); return; }
  const r = spawnSync(process.execPath, ['--check', file], { stdio: 'ignore' });
  if (r.status !== 0) fail(`${label} 语法检查未通过`); else ok(label);
}

const indexPath = join(root, 'index.html');
const swPath = join(root, 'sw.js');
const html = readFileSync(indexPath, 'utf8');
const sw = readFileSync(swPath, 'utf8');

// 1. 抽出内联模块跑语法检查
const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
if (!mod) {
  fail('index.html 里找不到 <script type="module">');
} else {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-preflight-'));
  try {
    const tmp = join(dir, 'app.mjs');
    writeFileSync(tmp, mod[1], 'utf8');
    nodeCheck(tmp, 'index.html 内联模块');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 2. 版本号 / CACHE 必须相邻（CACHE = APP + 1）
const appM = /const APP_VERSION = '(v\d+)'/.exec(html);
const cacheM = /const CACHE = 'dsh-mobile-v(\d+)'/.exec(sw);
if (!appM) fail('找不到 APP_VERSION');
if (!cacheM) fail('找不到 sw.js CACHE');
if (appM && cacheM) {
  const app = Number(appM[1].slice(1));
  const cache = Number(cacheM[1]);
  if (cache !== app + 1) fail(`版本不一致：APP=${appM[1]}，CACHE=dsh-mobile-v${cache}（应为 v${app + 1}）`);
  else ok(`版本一致：APP=${appM[1]}，CACHE=dsh-mobile-v${cache}`);
}

// 3. Service Worker / 本地补丁语法
nodeCheck(swPath, 'sw.js');
nodeCheck(join(root, 'patches', 'push-notify.js'), 'patches/push-notify.js');

// 4. 冲突标记
for (const [name, text] of [['index.html', html], ['sw.js', sw]]) {
  if (/^(<{7}|={7}|>{7})/m.test(text)) fail(`${name} 里还有冲突标记`);
  else ok(`${name} 无冲突标记`);
}

// 5. 关键文件存在
for (const f of ['manifest.webmanifest', 'icon-192.png', 'sw.js']) {
  if (!existsSync(join(root, f))) fail(`缺少 ${f}`); else ok(`存在 ${f}`);
}

console.log('');
if (fails.length) {
  console.error(`PREFLIGHT FAILED (${fails.length})`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('PREFLIGHT PASSED');
