import { loadStopSummary, paintSession } from '../core/bus.js';
import { state, ui } from '../core/state.js';
import { el } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
import { speechAutoOn, stopSpeak } from './voice.js';

function markBusy(on) {
  const now = !!on;
  if (now && !state.busy) state.busySince = Date.now();
  if (!now) state.busySince = 0;
  state.busy = now;
}

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function busyText() {
  if (!state.busy) return '';
  return state.busySince ? `深度求索中… ${fmtElapsed(Date.now() - state.busySince)}` : '深度求索中…';
}

let busyTicker = null;

function syncBusyTicker() {
  const want = !!(state.busy && state.busySince && state.view === 'session' && ui.strip);
  if (want && !busyTicker) {
    busyTicker = setInterval(() => {
      if (!state.busy || !ui.strip) { clearInterval(busyTicker); busyTicker = null; return; }
      if (state.stream === 'open') paintProg();
    }, 1000);
  } else if (!want && busyTicker) {
    clearInterval(busyTicker); busyTicker = null;
  }
}

// ---------------------------------------------------------------- F1 过程进度
// 数据全部来自宿主：session/live-steps（步骤）与 todo_write.phase（第几/共几/那步叫什么）。
// 前端只做合并与降级：拿不到 phase 就不显示总步数，绝不编造 total。

let stepsSheetRefresh = null, stepsSheetRefreshAt = 0;

function refreshStepsSheet(force = false) {
  if (!stepsSheetRefresh) return;
  const now = Date.now();
  if (!force && now - stepsSheetRefreshAt < 500) return;
  stepsSheetRefreshAt = now;
  try { stepsSheetRefresh(); } catch {}
}


function resetSteps() {
  state.steps = []; state.stepsTurn = null; state.phase = null;
  state.stepsDone = null; state.stepsDoneFade = false;
  clearTimeout(finishSteps._fadeTimer);
  clearTimeout(finishSteps._clearTimer);
  if (ui) ui.progSig = '';
}


function normPhase(p) {
  if (!p || typeof p !== 'object') return null;
  const total = Math.max(0, Number(p.total) || 0);
  if (!total) return null;
  const index = Math.max(0, Math.min(total, Number(p.index) || 0));
  return { index, total, label: String(p.label || '') };
}
// 兼容几种下发形状：block.phase / block.details.phase / block.result.phase

function phaseOfTodoBlock(b) {
  if (!b || typeof b !== 'object' || b.name !== 'todo_write') return null;
  return normPhase(b.phase) || normPhase(b.details && b.details.phase) || normPhase(b.result && b.result.phase);
}
// session/event 里工具块可能埋在 event.data / message.blocks 里：只做有界深搜，找到最后一处

function findTodoPhase(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 7) return null;
  if (Array.isArray(obj)) {
    let hit = null;
    for (const x of obj) hit = findTodoPhase(x, depth + 1) || hit;
    return hit;
  }
  const direct = phaseOfTodoBlock(obj);
  if (direct) return direct;
  let hit = null;
  for (const k of Object.keys(obj)) {
    if (k === 'phase') continue;
    const v = obj[k];
    if (v && typeof v === 'object') hit = findTodoPhase(v, depth + 1) || hit;
  }
  return hit;
}

function phaseFromMessages(msgs, turn = null) {
  let hit = null;
  for (const m of msgs || []) {
    // 指定轮次时只认这一轮的消息：别把上一轮的 todo_write 当成当前轮的进度
    if (turn != null) {
      const t = Number(m && m.turn);
      if (!Number.isFinite(t) || t !== Number(turn)) continue;
    }
    for (const b of (m.blocks || [])) {
      const p = phaseOfTodoBlock(b);
      if (p) hit = p;
    }
  }
  return hit;
}

const samePhase = (a, b) => !!a && !!b && a.index === b.index && a.total === b.total && a.label === b.label;

// full=true 整份替换；full=false 同 key 覆盖、新的追加；turn 变了按轮隔离。

function applyLiveSteps(f) {
  if (!f || (f.sessionId && f.sessionId !== state.sessionId)) return;
  const list = Array.isArray(f.steps) ? f.steps : [];
  const turn = f.turn == null ? null : f.turn;
  const turnChanged = turn != null && state.stepsTurn != null && turn !== state.stepsTurn;
  if (f.full || turnChanged) {
    state.steps = [];
    state.stepsTurn = turn;
  } else if (turn != null) {
    state.stepsTurn = turn;
  }
  for (const it of list) {
    if (!it || it.key == null) continue;
    const key = String(it.key);
    const step = it.step || {};
    const cur = state.steps.find(x => x.key === key);
    if (cur) {
      cur.step = step;
      if (step.state === 'running' && !cur._at) cur._at = Date.now();
    } else {
      state.steps.push({ key, step, _at: step.state === 'running' ? Date.now() : 0 });
    }
  }
  // 有新的步骤帧 = 新一轮还在跑，旧的一轮完成提示作废
  state.stepsDone = null;
  state.stepsDoneFade = false;
  clearTimeout(finishSteps._fadeTimer);
  clearTimeout(finishSteps._clearTimer);
  refreshStepsSheet();
}


function stepSummary(it) {
  const s = (it && it.step) || {};
  return String(s.summary || s.name || (s.kind === 'think' ? '思考中' : '执行中'));
}

function currentStep() {
  const list = state.steps || [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].step && list[i].step.state === 'running') return list[i];
  }
  return list[list.length - 1] || null;
}

const progElapsed = () => state.busySince ? fmtElapsed(Date.now() - state.busySince) : '';

// 一轮结束：先收成一行「已完成 · N 步 · 2:03」，3 秒后淡出，不长期占位

function finishSteps() {
  const count = state.steps.length
    ? (state.phase && state.phase.total ? state.phase.total : state.steps.length)
    : 0;
  if (!count) return;
  const ms = state.busySince ? Date.now() - state.busySince : 0;
  state.stepsDone = { count, ms, at: Date.now() };
  state.stepsDoneFade = false;
  clearTimeout(finishSteps._fadeTimer);
  clearTimeout(finishSteps._clearTimer);
  finishSteps._fadeTimer = setTimeout(() => {
    state.stepsDoneFade = true;
    paintProg(true);
  }, 2500);
  finishSteps._clearTimer = setTimeout(() => {
    state.stepsDone = null;
    state.stepsDoneFade = false;
    // 面板还开着就留着数据；关掉后下一次整份快照会覆盖
    if (!stepsSheetRefresh) { state.steps = []; state.stepsTurn = null; }
    paintProg(true);
    refreshStepsSheet(true);
  }, 3000);
}

// 一轮开始/结束：turn/start、turn/end 在两种帧形状下都走同一套状态

function beginTurn() {
  // 新一轮：上一轮的步骤和 phase 全部清掉；模型写 todo_write 之前不沿用旧 index/total
  state.steps = []; state.stepsTurn = null;
  state.phase = null;
  state.stepsDone = null; state.stepsDoneFade = false;
  state.autoReadPending = false;
  clearTimeout(finishSteps._fadeTimer); clearTimeout(finishSteps._clearTimer);
  markBusy(true);
  if (ui.stopBtn) ui.stopBtn.style.display = 'grid';
  paintProg(true);
  syncBusyTicker();
}

function endTurn() {
  if (speechAutoOn()) state.autoReadPending = true;
  finishSteps();
  markBusy(false);
  if (ui.stopBtn) ui.stopBtn.style.display = 'none';
  paintProg(true);
}


async function stopRun() {
  if (!state.sessionId) return;
  if (!confirm('中断这次运行？')) return;
  const sid = state.sessionId;
  const turn = state.turn;
  const startedAt = state.turnStartedAt || state.busySince || 0;
  try {
    await api('/api/mobile/v1/session/stop', { method:'POST', body: { sessionId: sid } });
    markBusy(false); paintProg(true); paintSession();
    // F4：停止成功后再拉这一轮的交代；失败 / 拿不到 turn 都不画卡
    if (sid === state.sessionId) loadStopSummary(turn, startedAt);
  } catch (e) { toast('取消失败：' + (e.message || e)); }
}

// dock 里那一条：运行中显示步数 + 当前动作 + 进度条；断线 / 完成各有降级

function paintProg(force = false) {
  if (!ui || !ui.strip || state.view !== 'session') return;
  const strip = ui.strip;
  // 按住说话时整条让位给语音浮层（设计稿 ③）
  if (ui.voiceBar) ui.voiceBar.style.display = state.rec ? 'flex' : 'none';
  if (state.rec) {
    if (ui.progSig !== 'none') {
      strip.replaceChildren();
      strip.className = 'streamline prog';
      ui.progSig = 'none';
    }
    return;
  }
  let mode = 'none';
  if (state.stream && state.stream !== 'open') mode = 'offline';
  else if (state.busy) mode = 'run';
  else if (state.speaking) mode = 'speak';
  else if (state.stepsDone) mode = 'done';
  if (mode === 'none') {
    if (ui.progSig !== 'none') {
      strip.replaceChildren();
      strip.className = 'streamline prog';
      ui.progSig = 'none';
    }
    return;
  }
  const cur = currentStep();
  const phase = state.phase;
  const total = phase && phase.total ? phase.total : 0;
  const idx = phase && phase.index ? phase.index : 0;
  const sig = mode === 'offline' ? 'offline'
    : mode === 'run'
      ? `run|${state.busySince ? 1 : 0}|${total}|${idx}|${state.steps.map(x => x.key + ':' + ((x.step && x.step.state) || '')).join(',')}|${cur ? stepSummary(cur) : ''}`
      : mode === 'speak' ? `speak|${state.speakIndex}|${state.speakTotal}`
      : `done|${state.stepsDone.count}|${state.stepsDone.ms}`;
  if (!force && sig === ui.progSig) {
    const t = strip.querySelector('.t');
    if (t) {
      const v = progElapsed();
      if (t.textContent !== v) t.textContent = v;
    }
    refreshStepsSheet();
    return;
  }
  ui.progSig = sig;
  strip.className = 'streamline prog' + (mode === 'done' && state.stepsDoneFade ? ' donefade' : '');
  strip.replaceChildren();
  if (mode === 'offline') {
    strip.append(el('div', { class:'row' }, el('span', { class:'cur', text:'实时连接断开，重连中…' })));
  } else if (mode === 'run') {
    const label = total ? `第 ${idx || 1}/${total} 步` : `已跑 ${state.steps.length} 步`;
    const summary = cur ? stepSummary(cur) : (state.steps.length ? '' : '深度求索中…');
    const live = el('span', { class:'ltext', 'aria-live':'polite' },
      el('b', { text: label }),
      summary ? el('span', { class:'cur', text: summary }) : null);
    const open = () => openStepsSheet();
    const row = el('div', {
      class:'row', role:'button', tabindex:'0', title:'查看这一轮的步骤',
      onclick: open,
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } },
    },
      el('span', { class:'pdot' }), live,
      el('span', { class:'t', text: progElapsed() }), el('span', { class:'cv', text:'⌃' }));
    const bar = el('div', { class:'pbar' + (total ? '' : ' indet') });
    const fill = el('i');
    if (total) fill.style.width = Math.round(((idx || 1) / total) * 100) + '%';
    bar.append(fill);
    strip.append(row, bar);
  } else if (mode === 'speak') {
    strip.append(el('div', { class:'speak' },
      el('span', { class:'wave' }, ...[6, 11, 8, 12, 5].map(h => el('i', { style:`height:${h}px` }))),
      el('span', { text:`正在朗读 · 第 ${state.speakIndex}/${state.speakTotal} 段` }),
      el('button', { class:'x', text:'停止', onclick: () => stopSpeak() })));
  } else {
    const d = state.stepsDone || { count: 0, ms: 0 };
    strip.append(el('div', { class:'row' },
      el('span', { class:'pdot' }),
      el('span', { class:'ltext', 'aria-live':'polite' },
        el('b', { text: `已完成 · ${d.count} 步${d.ms ? ' · ' + fmtElapsed(d.ms) : ''}` }))));
  }
  refreshStepsSheet();
}

// 过程面板：列出全部步骤；有 phase 时按总数补「未开始」

function openStepsSheet() {
  if (state.view !== 'session' || !ui.strip) return;
  const mask = el('div', { class:'mask', onclick: (e) => { if (e.target === mask) close(); } });
  const sheet = el('div', { class:'sheet stpsheet', role:'dialog', 'aria-modal':'true', tabindex:'-1' });
  const head = el('div');
  const list = el('div', { class:'stplist' });
  const acts = el('div', { class:'sacts' });
  sheet.append(el('div', { class:'grab' }), head, list, acts);

  function renderBody() {
    const phase = state.phase;
    const total = phase && phase.total ? phase.total : 0;
    const n = state.steps.length;
    const done = state.stepsDone;
    const ms = done ? done.ms : (state.busySince ? Date.now() - state.busySince : 0);
    const spent = ms ? `已跑 ${fmtElapsed(ms)}` : `已跑 ${n} 步`;
    let sub = spent + ' · 进行中';
    if (done) sub = `${spent} · 已完成`;
    else if (state.busy && phase && phase.index) sub = `${spent} · 第 ${phase.index} 步进行中`;
    head.replaceChildren(
      el('h2', { text: total ? `这一轮 · ${total} 步` : `已跑 ${n} 步` }),
      el('div', { class:'sm', text: sub }));
    list.replaceChildren();
    let shown = 0;
    for (const it of state.steps) {
      const s = it.step || {};
      const cls = s.state === 'ok' ? 'done' : s.state === 'running' ? 'now'
        : s.state === 'error' ? 'err' : s.state === 'stopped' ? 'stop' : 'todo';
      const dot = s.state === 'ok' ? '✓' : s.state === 'running' ? '●' : s.state === 'error' ? '!' : '·';
      const subline = s.state === 'running'
        ? `进行中${it._at ? ' ' + fmtElapsed(Date.now() - it._at) : ''}`
        : s.state === 'ok' ? '完成' : s.state === 'error' ? '失败' : s.state === 'stopped' ? '已停止' : '未开始';
      list.append(el('div', { class:'step ' + cls },
        el('div', { class:'sdot ' + cls, text: dot }),
        el('div', { class:'tx' },
          el('div', { text: stepSummary(it) }),
          el('span', { text: subline }))));
      shown++;
    }
    for (let i = shown; i < total; i++) {
      list.append(el('div', { class:'step todo' },
        el('div', { class:'sdot todo', text:'·' }),
        el('div', { class:'tx' }, el('div', { text: `第 ${i + 1} 步` }), el('span', { text:'未开始' }))));
    }
    if (!shown && !total) list.append(el('div', { class:'sm', text:'这一轮还没有步骤' }));
    acts.replaceChildren(...[
      el('button', { class:'btn', text:'收起', onclick: close }),
      state.busy ? el('button', { class:'btn primary', text:'停止这一轮', onclick: () => { close(); stopRun(); } }) : null,
    ].filter(Boolean));
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }
  function close() {
    document.removeEventListener('keydown', onKey, true);
    if (stepsSheetRefresh === renderBody) stepsSheetRefresh = null;
    mask.remove();
    paintProg(true);
  }
  document.addEventListener('keydown', onKey, true);
  stepsSheetRefresh = renderBody;
  stepsSheetRefreshAt = 0;
  renderBody();
  mask.append(sheet);
  document.body.append(mask);
  requestAnimationFrame(() => { try { sheet.focus({ preventScroll: true }); } catch {} });
}

// ---------------------------------------------------------------- F2 语音 / 朗读

export { applyLiveSteps, beginTurn, endTurn, findTodoPhase, fmtElapsed, markBusy, paintProg, phaseFromMessages, refreshStepsSheet, resetSteps, samePhase, stopRun, syncBusyTicker };
