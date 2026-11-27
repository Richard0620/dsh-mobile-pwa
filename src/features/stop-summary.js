import { paintSession } from '../core/bus.js';
import { state, ui } from '../core/state.js';
import { el } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { saveDraft } from '../core/format.js';
import { api } from '../core/api.js';
import { fmtElapsed } from './steps.js';

function turnFromFrame(frame, ev) {
  const candidates = [
    ev && ev.turn,
    ev && ev.data && ev.data.turn,
    ev && ev.payload && ev.payload.turn,
    frame && frame.turn,
    frame && frame.data && frame.data.turn,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  return null;
}

/** 宿主回 { summary:{did,saw,unfinished,outboundCount} }；契约里的 {sent:{count}} 也认。 */

function normalizeStopSummary(raw) {
  const source = raw && typeof raw === 'object'
    ? ((raw.summary && typeof raw.summary === 'object') ? raw.summary : raw)
    : {};
  const list = (value) => Array.isArray(value)
    ? value.map(item => typeof item === 'string' ? item : String((item && (item.text || item.label || item.summary)) || ''))
      .map(text => text.trim()).filter(Boolean)
    : [];
  let sent = 0;
  if (typeof source.sent === 'number') sent = source.sent;
  else if (source.sent && typeof source.sent === 'object') sent = Number(source.sent.count) || 0;
  else if (Array.isArray(source.sent)) sent = source.sent.length;
  if (!sent) sent = Number(source.outboundCount) || 0;
  return {
    did: list(source.did),
    saw: list(source.saw),
    unfinished: list(source.unfinished),
    sent: Number.isFinite(sent) && sent > 0 ? Math.round(sent) : 0,
  };
}


function stopSummaryHasContent(data) {
  return !!(data && (data.did.length || data.saw.length || data.unfinished.length || data.sent));
}


async function loadStopSummary(turn, startedAt) {
  const sid = state.sessionId;
  if (!sid || !Number.isSafeInteger(turn) || turn <= 0) return;
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('stop-summary 超时')), 4000));
  try {
    const r = await Promise.race([
      api(`/api/mobile/v1/session/stop-summary?sessionId=${encodeURIComponent(sid)}&turn=${turn}`),
      timeout,
    ]);
    // 请求期间用户可能已经开了下一轮：旧轮的交代不能贴到新轮上
    if (state.sessionId !== sid || state.turn !== turn) return;
    const data = normalizeStopSummary(r);
    if (!stopSummaryHasContent(data)) {
      state.stopSummary = null;
      if (state.view === 'session') paintSession();
      return;
    }
    state.stopSummary = {
      turn, data, expanded:false,
      durationMs: startedAt ? Math.max(0, Date.now() - startedAt) : 0,
    };
    if (state.view === 'session') paintSession({ scroll:'bottom' });
  } catch {
    // 失败/超时：不画卡，也不留半张空卡
    if (state.sessionId === sid && state.turn === turn) {
      state.stopSummary = null;
      if (state.view === 'session') paintSession();
    }
  }
}


function stopSummaryItem() {
  const stop = state.stopSummary;
  if (!stop || !stop.data) return null;
  const key = `STOP:${stop.turn}:${stop.expanded ? 1 : 0}:${stop.durationMs}`
    + `:${stop.data.did.length}:${stop.data.saw.length}:${stop.data.unfinished.length}:${stop.data.sent}`;
  return { type:'stop', key, stop };
}


function stopSection(title, items, max = 3) {
  const box = el('div', { class:'fsec' },
    el('div', { class:'fh' }, title, el('em', { text:String(items.length) })));
  for (let i = 0; i < Math.min(items.length, max); i++) {
    box.append(el('div', { class:'fi' }, el('i', { text:String(i + 1) }), el('span', { text:items[i] })));
  }
  if (items.length > max) box.append(el('div', { class:'fi more', text:`还有 ${items.length - max} 条` }));
  return box;
}

/** 把交代卡顶部滚进视野（展开后卡比一屏高时，贴底会只看到中段）。 */

function revealStopCard() {
  const card = ui && ui.listWrap && ui.listWrap.querySelector('.stopc, .stopline');
  if (!card || !ui.body || !ui.body.isConnected) return;
  const delta = card.getBoundingClientRect().top - ui.body.getBoundingClientRect().top - 12;
  if (Math.abs(delta) > 4) ui.body.scrollTop += delta;
  ui.atBottom = false;
}

/** 折叠态就是原来那行「已停止」+ 计数；展开才是四段。 */

function renderStopCard(item) {
  const stop = item.stop;
  const data = stop.data;
  if (!stop.expanded) {
    const line = el('button', { class:'stopline', type:'button',
      onclick: () => { stop.expanded = true; state.stopScrollTop = true; paintSession(); } },
      el('span', { class:'sq' }),
      el('b', { text:'这一轮被停止' }));
    if (stop.durationMs) line.append(el('span', { text:`· ${fmtElapsed(stop.durationMs)}` }));
    if (data.did.length) line.append(el('span', { text:`· 做了什么 ${data.did.length}` }));
    if (data.unfinished.length) line.append(el('span', { text:`· 没做完 ${data.unfinished.length}` }));
    line.append(el('span', { class:'x', text:'›' }));
    return line;
  }
  const card = el('div', { class:'card stopc' },
    el('div', { class:'ch' }, el('span', { class:'sq' }), '这一轮被停止',
      stop.durationMs ? el('span', { class:'dur', text:fmtElapsed(stop.durationMs) }) : null));
  if (data.did.length) card.append(stopSection('做了什么', data.did));
  if (data.saw.length) card.append(stopSection('看到了什么', data.saw));
  if (data.unfinished.length) card.append(stopSection('没做完', data.unfinished));
  if (data.sent) {
    card.append(el('div', { class:'fsec' },
      el('div', { class:'fh' }, '对外发出', el('em', { text:String(data.sent) })),
      el('div', { class:'fi' }, el('i', { text:'1' }), el('span', { text:`共 ${data.sent} 次对外动作` }))));
  }
  card.append(el('div', { class:'facts' },
    el('button', { class:'btn primary', type:'button', text:'照这个继续',
      onclick: () => continueFromStop(data) }),
    el('button', { class:'btn', type:'button', text:'收起',
      onclick: () => { stop.expanded = false; state.stopScrollTop = true; paintSession(); } })));
  return card;
}

/** 只预填输入框，不自动发送（停止后立刻又跑一轮容易惊吓，也不方便改提示词）。 */

function continueFromStop(data) {
  const list = (data && data.unfinished) || [];
  if (!list.length) { toast('没有「没做完」的条目可以续'); return; }
  const sentence = `接着把没做完的做完：${list.join('；')}。`;
  if (!ui || !ui.ta) { toast('先回到会话再试'); return; }
  ui.ta.textContent = sentence;
  try { saveDraft(state.sessionId, sentence); } catch {}
  try {
    ui.ta.focus();
    const range = document.createRange();
    range.selectNodeContents(ui.ta);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {}
  ui.atBottom = true;
  try { if (ui.body) ui.body.scrollTop = ui.body.scrollHeight; } catch {}
}

// ---------------------------------------------------------------- F5 定时任务
// 宿主字段（schedule.js / schedule-edit.js 实测）：
//   list/catalog → { records:[{ id, title, kind, status, state, time, timeZone, weekdays,
//     expression, everySeconds, afterSeconds, scheduledAt, updatedAt, lastDelivery,
//     target:{kind:'session'|'new_once'|'new', sessionId?, create?{cwd,agentPreset}}, executionActive }], serverNow }
//   create → { title, prompt, timing, target?, sessionId? }；timing 用 snake_case 嵌套
//   update → { id, patch, expectedUpdatedAt? }；pause/resume → { id, expectedUpdatedAt? }
// 页面只做「四选一 + 时间 + 目标 + 工作区 + 提示词」，cron 收进高级。


export { loadStopSummary, normalizeStopSummary, renderStopCard, revealStopCard, stopSummaryHasContent, stopSummaryItem, turnFromFrame };
