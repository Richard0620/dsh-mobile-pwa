#!/usr/bin/env node
/**
 * 功能契约一致性校验：
 * 提取 index.html 中的 API 端点、视图名、子页名、存储键、SSE 帧类型、CSS 变量与类选择器，
 * 与基线 scripts/parity-baseline.json 比对，确保重构不遗漏任何线上功能。
 *
 * 用法：
 *   node scripts/parity-check.mjs --save-baseline   生成基线
 *   node scripts/parity-check.mjs                   对比当前 index.html 与基线
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const indexPath = join(root, 'index.html');
const baselinePath = join(root, 'scripts', 'parity-baseline.json');

export function extractContract(html) {
  const styleM = /<style>([\s\S]*?)<\/style>/.exec(html);
  const scriptM = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
  const css = styleM ? styleM[1] : '';
  const js = scriptM ? scriptM[1] : '';

  const appM = /const APP_VERSION = '(v\d+)'/.exec(js);

  // API / Push / Agents 路径（去掉模板变量后半段，按路径前缀归一）
  const endpoints = new Set();
  for (const m of js.matchAll(/['"`](\/(?:api|push|agents|__lan_pair)[^'"`\s?)$]*)/g)) {
    endpoints.add(m[1]);
  }

  // 视图与子页
  const views = new Set();
  for (const m of js.matchAll(/state\.view\s*(?:===|!==|=)\s*['"]([^'"]+)['"]/g)) views.add(m[1]);
  for (const m of js.matchAll(/registerView\(\s*['"]([^'"]+)['"]/g)) views.add(m[1]);

  const subPages = new Set();
  for (const m of js.matchAll(/state\.subPage\s*(?:===|!==|=)\s*['"]([^'"]+)['"]/g)) subPages.add(m[1]);

  // 存储键字面量
  const storageKeys = new Set();
  for (const m of js.matchAll(/['"](dsh\.[a-zA-Z0-9._-]+|dsh-mobile|bridge_token|term\.collapsed)['"]/g)) {
    storageKeys.add(m[1]);
  }

  // SSE 帧类型
  const sseFrames = new Set();
  for (const m of js.matchAll(/['"]((?:session|approval|question|turn|device)\/[a-z-]+)['"]/g)) {
    sseFrames.add(m[1]);
  }

  // CSS 变量
  const cssVars = new Set();
  for (const m of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) cssVars.add(m[1]);

  // CSS 类选择器
  const cssClasses = new Set();
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of cssNoComments.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g)) {
    // 排除小数点（如 .5px）
    cssClasses.add(m[1]);
  }

  return {
    appVersion: appM ? appM[1] : null,
    endpoints: [...endpoints].sort(),
    views: [...views].sort(),
    subPages: [...subPages].sort(),
    storageKeys: [...storageKeys].sort(),
    sseFrames: [...sseFrames].sort(),
    cssVars: [...cssVars].sort(),
    cssClasses: [...cssClasses].sort(),
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const html = readFileSync(indexPath, 'utf8');
  const current = extractContract(html);

  if (process.argv.includes('--save-baseline')) {
    writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n', 'utf8');
    console.log(`Saved parity baseline: ${current.endpoints.length} endpoints, ${current.views.length} views, ${current.subPages.length} subPages, ${current.storageKeys.length} storageKeys, ${current.sseFrames.length} sseFrames, ${current.cssVars.length} cssVars, ${current.cssClasses.length} cssClasses`);
    process.exit(0);
  }

  if (!existsSync(baselinePath)) {
    console.error('Missing scripts/parity-baseline.json');
    process.exit(1);
  }
  const base = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const missing = [];
  for (const key of ['endpoints', 'views', 'subPages', 'storageKeys', 'sseFrames', 'cssVars', 'cssClasses']) {
    const curSet = new Set(current[key]);
    const miss = base[key].filter(x => !curSet.has(x));
    if (miss.length) {
      missing.push({ key, miss });
      console.error(`  ✗ ${key} 缺失 (${miss.length}): ${miss.slice(0, 15).join(', ')}`);
    } else {
      console.log(`  ✓ ${key} 完整 (${base[key].length}/${current[key].length})`);
    }
  }
  if (base.appVersion !== current.appVersion) {
    console.log(`  ℹ APP_VERSION: baseline=${base.appVersion}, current=${current.appVersion}`);
  }
  if (missing.length) {
    console.error(`\nPARITY CHECK FAILED (${missing.length} categories have missing items)`);
    process.exit(1);
  }
  console.log('\nPARITY CHECK PASSED');
}
