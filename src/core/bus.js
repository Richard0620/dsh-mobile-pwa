/**
 * 跨层事件/动作总线（打破核心层 ↔ 视图层循环依赖）。
 * 由 src/main.js 启动时统一 registerHooks，下层模块只依赖本文件。
 */
const _hooks = {};

export function registerHooks(map) {
  Object.assign(_hooks, map);
}

export function createWorkspaceAt(...args) { return _hooks.createWorkspaceAt(...args); }
export function downloadHostFile(...args) { return _hooks.downloadHostFile(...args); }
export function loadFiles(...args) { return _hooks.loadFiles(...args); }
export function loadMessages(...args) { return _hooks.loadMessages(...args); }
export function loadRoots(...args) { return _hooks.loadRoots(...args); }
export function loadStopSummary(...args) { return _hooks.loadStopSummary(...args); }
export function onFrame(...args) { return _hooks.onFrame(...args); }
export function openDrawer(...args) { return _hooks.openDrawer(...args); }
export function openFileDrawer(...args) { return _hooks.openFileDrawer(...args); }
export function openGit(...args) { return _hooks.openGit(...args); }
export function openHostPath(...args) { return _hooks.openHostPath(...args); }
export function openNewSessionSheet(...args) { return _hooks.openNewSessionSheet(...args); }
export function openSession(...args) { return _hooks.openSession(...args); }
export function openStats(...args) { return _hooks.openStats(...args); }
export function paint(...args) { return _hooks.paint(...args); }
export function paintConnPills(...args) { return _hooks.paintConnPills(...args); }
export function paintProg(...args) { return _hooks.paintProg(...args); }
export function paintSession(...args) { return _hooks.paintSession(...args); }
export function refreshAll(...args) { return _hooks.refreshAll(...args); }
export function reloadApp(...args) { return _hooks.reloadApp(...args); }
export function render(...args) { return _hooks.render(...args); }
export function renderList(...args) { return _hooks.renderList(...args); }
export function repaintSessionKeepingScroll(...args) { return _hooks.repaintSessionKeepingScroll(...args); }
export function subscribeDevice(...args) { return _hooks.subscribeDevice(...args); }
export function toast(...args) { return _hooks.toast(...args); }
