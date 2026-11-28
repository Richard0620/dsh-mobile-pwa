import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml } from '../scripts/build.mjs';
import { extractContract } from '../scripts/parity-check.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function walkJs(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkJs(p));
    else if (ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('all src/ ES module imports resolve to valid exports', () => {
  const files = walkJs(join(root, 'src'));
  assert.ok(files.length >= 40, `expected >= 40 modules, got ${files.length}`);

  const exportsMap = new Map();
  for (const f of files) {
    const c = readFileSync(f, 'utf8');
    const ex = new Set();
    for (const m of c.matchAll(/^export\s+(?:async\s+function|function|const)\s+([\w$]+)/gm)) ex.add(m[1]);
    for (const m of c.matchAll(/^export\s*\{([^}]+)\}/gm)) {
      for (const s of m[1].split(',').map(x => x.trim()).filter(Boolean)) {
        ex.add(s.split(/\s+as\s+/).pop());
      }
    }
    exportsMap.set(f, ex);
  }

  for (const f of files) {
    const c = readFileSync(f, 'utf8');
    for (const m of c.matchAll(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gm)) {
      const target = resolve(dirname(f), m[2]);
      const ex = exportsMap.get(target);
      assert.ok(ex, `missing target module ${m[2]} imported from ${f}`);
      for (const sym of m[1].split(',').map(x => x.trim()).filter(Boolean)) {
        const orig = sym.split(/\s+as\s+/)[0];
        assert.ok(ex.has(orig), `${f} imports missing symbol "${orig}" from ${m[2]}`);
      }
    }
  }
});

test('buildHtml() is deterministic, preserves APP_VERSION, and matches committed index.html', () => {
  const a = buildHtml();
  const b = buildHtml();
  assert.equal(a.html, b.html, 'build output must be deterministic');
  assert.match(a.html, /const APP_VERSION = 'v\d+';/, 'APP_VERSION regex contract preserved');

  const disk = readFileSync(join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(disk, a.html, 'committed index.html must match buildHtml()');
});

test('built index.html satisfies v251 parity baseline', () => {
  const base = JSON.parse(readFileSync(join(root, 'scripts', 'parity-baseline.json'), 'utf8'));
  const cur = extractContract(readFileSync(join(root, 'index.html'), 'utf8'));
  for (const key of ['endpoints', 'views', 'subPages', 'storageKeys', 'sseFrames', 'cssVars', 'cssClasses']) {
    const curSet = new Set(cur[key]);
    const missing = base[key].filter(x => !curSet.has(x));
    assert.deepEqual(missing, [], `${key} missing items`);
  }
});
