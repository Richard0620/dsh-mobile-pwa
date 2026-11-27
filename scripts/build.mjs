#!/usr/bin/env node
/**
 * 零依赖前端构建脚本：
 *   src/template.html + src/styles/*.css + src/main.js (ES 模块 DAG) → index.html
 *
 * 用法：
 *   node scripts/build.mjs          构建并写入 index.html，同时跑 node --check
 *   node scripts/build.mjs --check  仅校验当前 index.html 与 src/ 构建结果一致
 */
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const srcDir = join(root, 'src');
const stylesDir = join(srcDir, 'styles');
const templatePath = join(srcDir, 'template.html');
const entryPath = join(srcDir, 'main.js');
const versionPath = join(srcDir, 'core', 'version.js');
const outPath = join(root, 'index.html');

/** 解析模块中的静态相对 import，返回 { spec, absPath, raw, bindings }[] */
function parseImports(code, filePath) {
  const imports = [];
  const dir = dirname(filePath);
  // 支持：import { a, b as c } from './x.js'; 以及 import './x.js';
  const re = /^[ \t]*import\s+(?:\{([\s\S]*?)\}\s+from\s+)?['"]([^'"]+)['"]\s*;?[ \t]*$/gm;
  let m;
  while ((m = re.exec(code)) !== null) {
    const spec = m[2];
    if (!spec.startsWith('./') && !spec.startsWith('../')) {
      throw new Error(`不允许外部依赖导入 (${relative(root, filePath)}): ${spec}`);
    }
    const absPath = resolve(dir, spec);
    if (!existsSync(absPath)) {
      throw new Error(`找不到模块 (${relative(root, filePath)}): ${spec}`);
    }
    imports.push({
      raw: m[0],
      bindings: m[1] ? m[1].trim() : null,
      spec,
      absPath,
    });
  }
  return imports;
}

/** 拓扑排序并检测循环依赖 */
function collectModules(entry) {
  const order = [];
  const state = new Map(); // absPath -> 1 (visiting) | 2 (done)
  const stack = [];

  function visit(file) {
    const st = state.get(file);
    if (st === 2) return;
    if (st === 1) {
      const idx = stack.indexOf(file);
      const cycle = [...stack.slice(idx), file].map(f => relative(root, f)).join(' -> ');
      throw new Error(`检测到循环依赖: ${cycle}`);
    }
    state.set(file, 1);
    stack.push(file);
    const code = readFileSync(file, 'utf8');
    const imports = parseImports(code, file);
    for (const imp of imports) visit(imp.absPath);
    stack.pop();
    state.set(file, 2);
    order.push({ file, code, imports });
  }

  visit(entry);
  return order;
}

/** 将单个 ES 模块转换为 IIFE 封装代码 */
function transformModule(mod, idMap) {
  const rel = relative(root, mod.file).replace(/\\/g, '/');
  let body = mod.code.replace(/\r\n/g, '\n');

  // 1. 替换 import 语句为解构 __mN
  for (const imp of mod.imports) {
    const targetId = idMap.get(imp.absPath);
    let repl;
    if (imp.bindings) {
      // 把 `a as b` 转成对象解构 `a: b`
      const props = imp.bindings
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => {
          const asM = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(s);
          return asM ? `${asM[1]}: ${asM[2]}` : s;
        })
        .join(', ');
      repl = `const { ${props} } = ${targetId};`;
    } else {
      repl = `/* side-effect: ${imp.spec} */`;
    }
    body = body.replace(imp.raw.replace(/\r\n/g, '\n'), repl);
  }

  // 2. 收集 export 声明并去掉 export 关键字
  const exported = new Set();

  // export async function name / export function name
  body = body.replace(/^(export\s+)(async\s+function|function)\s+([\w$]+)/gm, (_, _e, kw, name) => {
    exported.add(name);
    return `${kw} ${name}`;
  });

  // export const name = ...
  body = body.replace(/^(export\s+)(const)\s+([\w$]+)/gm, (_, _e, kw, name) => {
    exported.add(name);
    return `${kw} ${name}`;
  });

  // 禁止 export let（可变状态统一放 state 对象，避免活绑定坑）
  if (/^export\s+let\s+/m.test(body)) {
    throw new Error(`禁止使用 export let (${rel})，请把可变状态放入导出对象或使用 getter/setter`);
  }

  // export { a, b as c };
  body = body.replace(/^export\s*\{([^}]+)\}\s*;?[ \t]*$/gm, (_, list) => {
    for (const item of list.split(',').map(s => s.trim()).filter(Boolean)) {
      const asM = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(item);
      if (asM) exported.add(`${asM[2]}: ${asM[1]}`);
      else exported.add(item);
    }
    return '';
  });

  // version.js 特殊处理：APP_VERSION 已在顶层声明，模块内部不再重复声明
  if (mod.file === versionPath) {
    body = body.replace(/^const\s+APP_VERSION\s*=\s*'v\d+'[^\n]*$/m, '// APP_VERSION hoisted to module top-level');
  }

  const modId = idMap.get(mod.file);
  const retList = [...exported].join(', ');
  const indented = body.trimEnd();
  if (mod.file === entryPath) {
    return `// === ${rel} ===\n(() => {\n${indented}\n})();`;
  }
  return `// === ${rel} ===\nconst ${modId} = (() => {\n${indented}\nreturn { ${retList} };\n})();`;
}

export function buildHtml() {
  if (!existsSync(templatePath)) throw new Error(`缺少模板文件: ${templatePath}`);
  if (!existsSync(entryPath)) throw new Error(`缺少入口文件: ${entryPath}`);

  // 1. 提取顶层 APP_VERSION（供 deploy-remote.sh / deploy-preview.ps1 / preflight.mjs 正则读取）
  let appVersionLine = '';
  if (existsSync(versionPath)) {
    const vc = readFileSync(versionPath, 'utf8');
    const vm = /const\s+APP_VERSION\s*=\s*'(v\d+)'/.exec(vc);
    if (!vm) throw new Error('src/core/version.js 中找不到 const APP_VERSION = \'vNNN\'');
    appVersionLine = `const APP_VERSION = '${vm[1]}';   // 每次发版改 src/core/version.js，菜单底部会显示`;
  }

  // 2. 合并 CSS
  const cssFiles = readdirSync(stylesDir)
    .filter(f => f.endsWith('.css'))
    .sort();
  const cssBundle = cssFiles
    .map(f => readFileSync(join(stylesDir, f), 'utf8').replace(/\r\n/g, '\n').trimEnd())
    .join('\n');

  // 3. 收集并打包 JS 模块
  const modules = collectModules(entryPath);
  const idMap = new Map();
  modules.forEach((m, i) => idMap.set(m.file, `__m${i}`));

  const jsParts = [];
  if (appVersionLine) jsParts.push(appVersionLine);
  for (const m of modules) {
    jsParts.push(transformModule(m, idMap));
  }
  const jsBundle = jsParts.join('\n\n');

  // 4. 注入模板
  const tpl = readFileSync(templatePath, 'utf8').replace(/\r\n/g, '\n');
  if (!tpl.includes('/* __STYLE__ */') || !tpl.includes('/* __SCRIPT__ */')) {
    throw new Error('src/template.html 必须包含 /* __STYLE__ */ 和 /* __SCRIPT__ */ 占位符');
  }
  const html = tpl
    .replace('/* __STYLE__ */', () => cssBundle)
    .replace('/* __SCRIPT__ */', () => jsBundle);

  return { html, cssCount: cssFiles.length, modCount: modules.length, jsBundle };
}

function syntaxCheck(jsCode) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-build-check-'));
  try {
    const tmp = join(dir, 'bundle.mjs');
    writeFileSync(tmp, jsCode, 'utf8');
    const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error(`打包产物语法检查失败:\n${r.stderr || r.stdout}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const checkOnly = process.argv.includes('--check');
  const { html, cssCount, modCount, jsBundle } = buildHtml();
  syntaxCheck(jsBundle);

  if (checkOnly) {
    if (!existsSync(outPath)) {
      console.error('BUILD CHECK FAILED: index.html 不存在');
      process.exit(1);
    }
    const cur = readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n');
    if (cur !== html) {
      console.error('BUILD CHECK FAILED: index.html 与 src/ 构建产物不一致，请运行 `node scripts/build.mjs`');
      process.exit(1);
    }
    console.log(`BUILD CHECK PASSED (${cssCount} css, ${modCount} js modules)`);
  } else {
    writeFileSync(outPath, html, 'utf8');
    console.log(`BUILT index.html (${cssCount} css, ${modCount} js modules, ${html.length} bytes)`);
  }
}
