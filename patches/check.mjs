#!/usr/bin/env node
/**
 * 检查本地推送补丁是否还和已安装的 dsh-mobile-plugin 对得上。
 * 插件升级后跑一次：node patches/check.mjs [--plugin=<插件目录>]
 *
 * 检查项：
 *   1. 仓库里的 patches/push-notify.js 语法
 *   2. 插件目录 / 补丁依赖模块是否还在（升级后路径可能变）
 *   3. 已安装的 push-notify.js 是否就是仓库这份（hash 不一致 = 需要重新 cp + 重启 DSH）
 *   4. 已安装文件里是否还有 badgeNumber / mirrorToWebPush
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repoPatch = join(root, 'patches', 'push-notify.js');
const pluginArg = process.argv.find((a) => a.startsWith('--plugin='));
const pluginDir = pluginArg
  ? pluginArg.slice('--plugin='.length)
  : join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', process.env.DSH_PROFILE || 'desktop', 'node_modules', 'dsh-mobile-plugin');

const fails = [];
const warns = [];
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const line = (m) => console.log('  ' + m);

// 1. 仓库补丁语法
if (!existsSync(repoPatch)) {
  fails.push('仓库里没有 patches/push-notify.js');
} else {
  const r = spawnSync(process.execPath, ['--check', repoPatch], { stdio: 'ignore' });
  if (r.status !== 0) fails.push('patches/push-notify.js 语法检查未通过');
  else line('✓ 仓库补丁语法通过');
}

// 2. 插件目录与依赖模块
if (!existsSync(pluginDir)) {
  fails.push(`找不到插件目录：${pluginDir}`);
} else {
  line(`✓ 插件目录存在：${pluginDir}`);
}
const deps = ['notification-prefs.js', 'approvals.js', 'questions.js', 'push-notify.js'];
const mobileDir = join(pluginDir, 'lib', 'mobile');
for (const d of deps) {
  if (existsSync(join(mobileDir, d))) line(`✓ 依赖存在：lib/mobile/${d}`);
  else fails.push(`插件里缺少 lib/mobile/${d}（升级后路径变了？补丁需要重新适配）`);
}

// 3. 已安装补丁 hash 对比
const installed = join(mobileDir, 'push-notify.js');
if (existsSync(installed) && existsSync(repoPatch)) {
  const same = sha(installed) === sha(repoPatch);
  if (!same) {
    fails.push('已安装的 push-notify.js 与仓库补丁不一致：需要重新执行 cp patches/push-notify.js <插件>/lib/mobile/，然后重启 DSH');
  } else {
    line('✓ 已安装补丁与仓库一致');
  }
  const text = readFileSync(installed, 'utf8');
  for (const key of ['badgeNumber', 'mirrorToWebPush']) {
    if (text.includes(key)) line(`✓ 已安装补丁包含 ${key}`);
    else fails.push(`已安装补丁缺少 ${key}，补丁可能被插件升级覆盖`);
  }
}

console.log('');
if (warns.length) for (const w of warns) console.warn('  ⚠ ' + w);
if (fails.length) {
  console.error(`PATCH CHECK FAILED (${fails.length})`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('PATCH CHECK PASSED');
