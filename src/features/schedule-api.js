import { render } from '../core/bus.js';
import { state } from '../core/state.js';
import { el } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { plain } from '../core/format.js';
import { api } from '../core/api.js';

const SCHEDULE_FREQ_LABEL = { daily:'每天', weekdays:'工作日', weekly:'每周', once:'仅一次' };


function scheduleZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}


function scheduleLocalDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}


function scheduleTimeValue(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim());
  if (!m) return '09:00';
  return `${String(Math.min(23, Number(m[1]))).padStart(2, '0')}:${m[2]}`;
}


function scheduleWeekdayName(n) {
  return ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][Number(n)] || '';
}


function scheduleWeekdayLabel(days) {
  const list = (Array.isArray(days) ? days : []).map(Number).filter(n => n >= 1 && n <= 7).sort((a, b) => a - b);
  if (!list.length) return '每周';
  const key = list.join(',');
  if (key === '1,2,3,4,5') return '工作日';
  if (key === '6,7') return '周末';
  return list.map(scheduleWeekdayName).join('、');
}


function scheduleEveryLabel(seconds) {
  const n = Number(seconds) || 0;
  if (n <= 0) return '周期';
  if (n < 3600) return `每 ${Math.max(1, Math.round(n / 60))} 分钟`;
  if (n < 86400) return `每 ${Math.max(1, Math.round(n / 3600))} 小时`;
  return `每 ${Math.max(1, Math.round(n / 86400))} 天`;
}

/** 列表时间位只有 54px：compact 版（每 2h / 每 30m）才放得下。 */

function scheduleEveryCompact(seconds) {
  const n = Number(seconds) || 0;
  if (n <= 0) return '周期';
  if (n < 3600) return `每 ${Math.max(1, Math.round(n / 60))}m`;
  if (n < 86400) return `每 ${Math.max(1, Math.round(n / 3600))}h`;
  return `每 ${Math.max(1, Math.round(n / 86400))}d`;
}

/** 下次/上次运行的人话时间；未来跨天用星期，过去用日期。 */

function fmtScheduleAt(value) {
  const t = typeof value === 'number' ? value : Date.parse(String(value || ''));
  if (!Number.isFinite(t) || !t) return '';
  const d = new Date(t);
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return `今天 ${hm}`;
  const tomorrow = new Date(now.getTime() + 86400000);
  if (sameDay(d, tomorrow)) return `明天 ${hm}`;
  const yesterday = new Date(now.getTime() - 86400000);
  if (sameDay(d, yesterday)) return `昨天 ${hm}`;
  if (t > now.getTime() && t - now.getTime() < 7 * 86400000) return `${'日一二三四五六'[d.getDay()]} ${hm}`.replace(/^/, '周');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}


function scheduleBasename(path) {
  const parts = String(path || '').split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}


function scheduleSessionTitle(sessionId) {
  if (!sessionId) return '';
  const found = (state.sessions || []).find(s => s.sessionId === sessionId);
  if (found) return found.title || '(无标题)';
  return `…${String(sessionId).slice(-6)}`;
}


function scheduleSessionGone(sessionId) {
  if (!sessionId || !(state.sessions || []).length) return false;
  return !state.sessions.some(s => s.sessionId === sessionId);
}

/** 宿主的 status 是 active/paused/ended/inactive；老宿主只有 state（active/inactive）。 */

function normalizeScheduleRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const status = ['active', 'paused', 'ended', 'inactive'].includes(raw.status)
    ? raw.status
    : (raw.state === 'inactive' ? 'paused' : 'active');
  return { ...raw, id, title: String(raw.title || '').trim() || '未命名任务', status };
}


function scheduleTargetText(record) {
  const target = record.target && typeof record.target === 'object' ? record.target : null;
  // v2 宿主把目标放在 target 里，行上的 sessionId 只是「创建者」：新会话目标必须优先认 target，
  // 否则每条新会话任务都会被写成「会话 <创建它的那条>」。
  if (target && (target.kind === 'new_once' || target.kind === 'new')) {
    const cwd = target.create && target.create.cwd;
    return { text: `新会话${cwd ? ' · ' + scheduleBasename(cwd) : ''}`, dead:false };
  }
  const sessionId = (target && target.kind === 'session' && target.sessionId)
    || (record.sessionId || '');
  if (sessionId) {
    const dead = scheduleSessionGone(sessionId);
    return { text: `会话 ${scheduleSessionTitle(sessionId)}`, dead };
  }
  return { text:'未设目标', dead:false };
}


function scheduleTimeCell(record) {
  if (record.status !== 'active') {
    return { big:'—', small: record.status === 'ended' ? '已结束' : '暂停' };
  }
  switch (record.kind) {
    case 'daily':
      return { big: scheduleTimeValue((record.daily && record.daily.time) || record.time), small:'每天' };
    case 'weekly':
      return { big: scheduleTimeValue((record.weekly && record.weekly.time) || record.time),
        small: scheduleWeekdayLabel((record.weekly && record.weekly.weekdays) || record.weekdays) };
    case 'every':
      return { big: scheduleEveryCompact(record.everySeconds),
        small: record.scheduledAt ? fmtScheduleAt(record.scheduledAt) : '' };
    case 'after':
      return { big:'一次', small:'延后' };
    case 'at': {
      const at = record.at;
      if (typeof at === 'string') {
        const d = new Date(at);
        return Number.isFinite(d.getTime())
          ? { big:`${d.getMonth() + 1}-${d.getDate()}`, small:scheduleTimeValue(`${d.getHours()}:${d.getMinutes()}`) }
          : { big:'一次', small:'' };
      }
      if (at && typeof at === 'object') return { big:String(at.date || '').slice(5) || '—', small:String(at.time || '') };
      return { big:'一次', small:'' };
    }
    case 'cron':
      return { big:'cron', small: record.expression || '' };
    case 'rrule':
      return { big:'规则', small:'rrule' };
    default:
      return { big:'—', small: record.kind || '未知' };
  }
}


function scheduleFrequencyDetail(record) {
  switch (record.kind) {
    case 'daily': return `每天 ${scheduleTimeValue((record.daily && record.daily.time) || record.time)}`;
    case 'weekly': return `${scheduleWeekdayLabel((record.weekly && record.weekly.weekdays) || record.weekdays)} ${scheduleTimeValue((record.weekly && record.weekly.time) || record.time)}`;
    case 'every': return scheduleEveryLabel(record.everySeconds);
    case 'after': return `置后 ${Math.max(1, Math.round((Number(record.afterSeconds) || 0) / 60))} 分钟跑一次`;
    case 'at': {
      const at = record.at;
      if (typeof at === 'string') return `仅一次 ${fmtScheduleAt(at)}`;
      if (at && typeof at === 'object') return `仅一次 ${at.date || ''} ${at.time || ''}`.trim();
      return '仅一次';
    }
    case 'cron': return `cron ${record.expression || ''}`;
    case 'rrule': return 'rrule 规则';
    default: return record.kind || '未知';
  }
}


function scheduleRow(title, desc, value, run) {
  return el(run ? 'button' : 'div', run ? { class:'srow', type:'button', onclick:run } : { class:'srow' },
    el('div', { class:'st' }, el('b', { text:title }), desc ? el('span', { text:desc }) : null),
    value == null ? null : (value.nodeType ? el('span', { class:'sv' }, value) : el('span', { class:'sv', text:String(value) })));
}


function scheduleInput(type, value, onInput, extra = {}) {
  const input = el('input', { type, value, ...extra });
  input.addEventListener('input', onInput);
  input.addEventListener('change', onInput);
  return input;
}


function scheduleRecentDeliveries(records, limit = 5) {
  const rows = [];
  for (const record of records) {
    const delivery = record.lastDelivery;
    const at = delivery && Date.parse(String(delivery.deliveredAt || ''));
    if (!Number.isFinite(at) || !at) continue;
    rows.push({ record, at });
  }
  return rows.sort((a, b) => b.at - a.at).slice(0, limit);
}


function scheduleDeliveryRow(entry) {
  return el('div', { class:'hrow' },
    el('span', { class:'hw', text: fmtScheduleAt(entry.at) }),
    el('span', { class:'hn', text: entry.record.title }),
    el('span', { class:'hr ok', text:'已投递' }));
}


function renderScheduleRow(record) {
  const cell = scheduleTimeCell(record);
  const target = scheduleTargetText(record);
  const row = el('div', {
    class: 'trow' + (record.status !== 'active' ? ' paused' : '') + (state.scheduleHighlight === record.id ? ' new' : ''),
    role:'button', tabindex:'0', onclick: () => openScheduleDetail(record),
  });
  row.append(el('div', { class:'tw' }, el('b', { text:cell.big }), cell.small ? el('span', { text:cell.small }) : null));
  const sub = el('span', { text: target.dead ? '目标会话已不可用' : target.text });
  if (target.dead) sub.style.color = 'var(--bad)';
  row.append(el('div', { class:'ts' }, el('b', { text:record.title }), sub));
  const acts = el('div', { class:'ta' });
  if (record.executionActive) acts.append(el('span', { class:'runpill' }, el('span', { class:'dot run' }), '跑中'));
  if (record.status === 'active') {
    const run = el('button', { class:'tbtn' + (record.executionActive ? ' dis' : ''), type:'button',
      title:'立刻跑', 'aria-label':`立刻跑 ${record.title}`, text:'▶', disabled: !!record.executionActive,
      onclick: (ev) => { ev.stopPropagation(); scheduleAction(record, 'run'); } });
    acts.append(run);
    acts.append(el('button', { class:'tbtn', type:'button', title:'暂停', 'aria-label':`暂停 ${record.title}`,
      text:'⏸', onclick: (ev) => { ev.stopPropagation(); scheduleAction(record, 'pause'); } }));
  } else {
    acts.append(el('button', { class:'tbtn', type:'button', title:'恢复', 'aria-label':`恢复 ${record.title}`,
      text:'▶', onclick: (ev) => { ev.stopPropagation(); scheduleAction(record, 'resume'); } }));
  }
  row.append(acts);
  row.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openScheduleDetail(record); }
  });
  return row;
}


function openSchedule() {
  state.view = 'schedule';
  if (!state.schedule || state.schedule.error) state.schedule = { loading:true, records:[], error:'' };
  render();
  loadSchedule();
}


async function loadSchedule() {
  try {
    const r = await api('/api/mobile/v1/schedule/catalog');
    const records = (Array.isArray(r && r.records) ? r.records : []).map(normalizeScheduleRecord).filter(Boolean);
    state.schedule = { loading:false, records, error:'', at:Date.now(), serverNow:Number(r && r.serverNow) || Date.now() };
  } catch (e) {
    state.schedule = { loading:false, records:[], error:String((e && e.message) || e), code:e && e.code, at:Date.now() };
  }
  if (state.view === 'schedule') render();
}


function openScheduleNew() {
  const now = new Date();
  state.scheduleDraft = {
    freq:'daily',
    time:'09:00',
    weekday: now.getDay() || 7,
    date: scheduleLocalDate(1),
    target:'new',
    sessionId:'',
    workspaceCwd: (state.workspaces[0] && (state.workspaces[0].path || state.workspaces[0].cwd)) || state.sessionCwd || '',
    prompt:'',
    advanced:false,
    cron:'',
    saving:false,
    error:'',
    editingId:'',
    expectedUpdatedAt:'',
  };
  state.view = 'scheduleNew';
  render();
  // 从设置直接进来时这两个列表可能还没拉过：补一次，选目标/工作区才有东西可选。
  // 不重绘页面：用户可能正在输入提示词，重绘会丢焦点；选择面板点开时读的是最新 state。
  if (!state.workspaces.length) {
    api('/api/mobile/v1/workspaces').then(r => {
      state.workspaces = (r && r.items) || [];
    }).catch(() => {});
  }
  if (!state.sessions.length) {
    api('/api/mobile/v1/sessions').then(r => {
      state.sessions = (r && r.items) || [];
    }).catch(() => {});
  }
}

/** 详情页「改时间」：复用新建表单，保存走 /schedule/update（带 CAS）。 */

function openScheduleEdit(record) {
  const time = scheduleTimeValue((record.daily && record.daily.time) || (record.weekly && record.weekly.time) || record.time);
  const draft = {
    freq:'daily', time, weekday:new Date().getDay() || 7,
    date:scheduleLocalDate(1),
    target:'new', sessionId:'', workspaceCwd:'', prompt:record.prompt || '',
    advanced:false, cron:'', saving:false, error:'',
    editingId:record.id, expectedUpdatedAt:record.updatedAt || '',
    originalCreate:null, originalTargetKind:'', originalTitle:record.title || '', originalKind:record.kind || '',
  };
  const target = record.target && typeof record.target === 'object' ? record.target : null;
  if (target && (target.kind === 'new' || target.kind === 'new_once')) {
    draft.originalTargetKind = target.kind;
    if (target.create && typeof target.create === 'object') draft.originalCreate = { ...target.create };
  }
  if (target && target.kind === 'session' && target.sessionId) {
    draft.target = 'session';
    draft.sessionId = target.sessionId;
  } else if (target && (target.kind === 'new_once' || target.kind === 'new')) {
    draft.workspaceCwd = (target.create && target.create.cwd) || '';
  } else if (record.sessionId) {
    draft.target = 'session';
    draft.sessionId = record.sessionId;
  }
  if (record.kind === 'daily') {
    draft.freq = 'daily';
  } else if (record.kind === 'weekly') {
    const days = (record.weekly && record.weekly.weekdays) || record.weekdays || [];
    const list = (Array.isArray(days) ? days : []).map(Number).filter(n => n >= 1 && n <= 7);
    if (list.join(',') === '1,2,3,4,5') draft.freq = 'weekdays';
    else { draft.freq = 'weekly'; draft.weekday = list[0] || 1; }
  } else if (record.kind === 'at') {
    const at = record.at;
    if (typeof at === 'string') {
      const d = new Date(at);
      if (!Number.isFinite(d.getTime())) { toast('这条任务的时间读不出来'); return; }
      const p = n => String(n).padStart(2, '0');
      draft.freq = 'once';
      draft.date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      draft.time = `${p(d.getHours())}:${p(d.getMinutes())}`;
    } else if (at && typeof at === 'object') {
      draft.freq = 'once';
      draft.date = String(at.date || draft.date);
      draft.time = scheduleTimeValue(at.time);
    }
  } else if (record.kind === 'cron') {
    draft.advanced = true;
    draft.cron = record.expression || '';
  } else {
    toast('这类任务暂不支持在手机上改时间');
    return;
  }
  state.scheduleDraft = draft;
  state.view = 'scheduleNew';
  render();
}


function scheduleTimingFromDraft(draft) {
  const zone = scheduleZone();
  const time = scheduleTimeValue(draft.time);
  const cron = String(draft.cron || '').trim();
  if (draft.advanced && cron) {
    if (cron.split(/\s+/).length !== 5) return null;
    return { kind:'cron', cron:{ expression:cron, time_zone:zone } };
  }
  // 原来就是 cron 的任务不能把表达式清空后静默变成每天
  if (draft.originalKind === 'cron') return null;
  if (draft.freq === 'daily') return { kind:'daily', daily:{ time, time_zone:zone } };
  if (draft.freq === 'weekdays') {
    return { kind:'weekly', weekly:{ time, time_zone:zone, weekdays:[1, 2, 3, 4, 5] } };
  }
  if (draft.freq === 'weekly') {
    return { kind:'weekly', weekly:{ time, time_zone:zone, weekdays:[Number(draft.weekday) || 1] } };
  }
  if (draft.freq === 'once') {
    const date = String(draft.date || '').trim() || scheduleLocalDate(1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return { kind:'at', at:{ date, time, time_zone:zone } };
  }
  return null;
}


function scheduleTargetFromDraft(draft) {
  if (draft.target === 'session') {
    const sessionId = String(draft.sessionId || '').trim();
    return sessionId ? { kind:'session', sessionId } : null;
  }
  // 编辑时保留原有的 create（cwd / agentPreset）与 new / new_once 语义，只覆盖用户改过的工作区
  const kind = draft.originalTargetKind === 'new' ? 'new' : 'new_once';
  const create = { ...(draft.originalCreate || {}) };
  const cwd = String(draft.workspaceCwd || '').trim();
  if (cwd) create.cwd = cwd;
  return Object.keys(create).length ? { kind, create } : { kind };
}


function scheduleTitleFromPrompt(prompt) {
  const first = String(prompt || '').split('\n').map(line => line.trim()).find(Boolean) || '';
  // 自动标题取第一句（到句号/分号为止），比整段提示词更适合当列表标题
  const clause = plain(first).split(/[。；;！!？?]/)[0].trim();
  const title = clause.slice(0, 24).trim();
  return title || `定时任务 ${new Date().toLocaleDateString('zh-CN', { month:'2-digit', day:'2-digit' })}`;
}


async function createScheduleFromDraft() {
  const draft = state.scheduleDraft;
  if (!draft || draft.saving) return;
  const prompt = String(draft.prompt || '').trim();
  if (!prompt) { toast('先写提示词'); return; }
  const timing = scheduleTimingFromDraft(draft);
  if (!timing) {
    toast(draft.advanced && String(draft.cron || '').trim() ? 'cron 要填五段（分 时 日 月 周）' : '时间还没填好');
    return;
  }
  const target = scheduleTargetFromDraft(draft);
  if (!target) { toast('先选一条目标会话'); return; }
  draft.saving = true;
  draft.error = '';
  if (state.view === 'scheduleNew') render();
  try {
    // 编辑时不覆盖用户原有的标题（表单里没有标题格，自动标题只用于新建）
    const title = (draft.editingId && draft.originalTitle) || scheduleTitleFromPrompt(prompt);
    if (draft.editingId) {
      const body = { id: draft.editingId, patch: { title, prompt, timing, target } };
      if (draft.expectedUpdatedAt) body.expectedUpdatedAt = draft.expectedUpdatedAt;
      const r = await api('/api/mobile/v1/schedule/update', { method:'POST', body });
      const updated = r && r.record ? normalizeScheduleRecord(r.record) : null;
      toast('已保存');
      state.scheduleDetail = updated ? {
        id: updated.id, record: updated, loading:true, loadingMore:false,
        viewError:'', history:null, historyError:'',
      } : null;
      state.view = updated ? 'scheduleDetail' : 'schedule';
      render();
      if (updated) loadScheduleDetail();
      loadSchedule();
      return;
    }
    const body = { title, prompt, timing, target };
    if (target.kind === 'session') body.sessionId = target.sessionId;
    const r = await api('/api/mobile/v1/schedule/create', { method:'POST', body });
    const id = r && r.record && r.record.id;
    state.scheduleHighlight = id || '';
    state.schedule = null;
    state.view = 'schedule';
    toast('已创建定时任务');
    render();
    loadSchedule();
    if (id) {
      setTimeout(() => {
        if (state.scheduleHighlight === id) {
          state.scheduleHighlight = '';
          if (state.view === 'schedule') render();
        }
      }, 3000);
    }
  } catch (e) {
    draft.saving = false;
    draft.error = String((e && e.message) || e);
    if (state.view === 'scheduleNew') render();
    toast((draft.editingId ? '保存失败：' : '创建失败：') + draft.error);
  }
}

/** 列表行上的 run / pause / resume；CAS 冲突单独说人话。 */

async function scheduleAction(record, action) {
  try {
    let result = null;
    if (action === 'run') {
      result = await api('/api/mobile/v1/schedule/run', { method:'POST', body:{ id:record.id } });
      if (result && result.ran === false) toast('这条任务正在执行中');
      else toast('已触发一次');
    } else {
      const body = { id: record.id };
      if (record.updatedAt) body.expectedUpdatedAt = record.updatedAt;
      await api(`/api/mobile/v1/schedule/${action}`, { method:'POST', body });
      toast(action === 'pause' ? '已暂停' : '已恢复');
    }
    await loadSchedule();
    if (state.view === 'scheduleDetail') await loadScheduleDetail();
  } catch (e) {
    const code = e && e.code;
    if (code === 'schedule_conflict') toast('这条任务刚被改过，刷新后再试');
    else if (code === 'schedule_execution_pending') toast('这条任务正在执行中');
    else if (code === 'schedule_not_found') toast('这条任务已经不在了，回列表刷新一下');
    else toast('操作失败：' + String((e && e.message) || e));
  }
}


function normalizeScheduleHistory(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const records = (Array.isArray(source.records) ? source.records : [])
    .filter(item => item && typeof item.messageId === 'string')
    .map(item => ({ ...item }));
  return {
    records,
    earlierRecordsUnavailable: source.earlierRecordsUnavailable === true,
    earlierRecordsPruned: source.earlierRecordsPruned === true,
    retention: source.retention && typeof source.retention === 'object' ? source.retention : { days:0, records:0 },
    nextBefore: typeof source.nextBefore === 'string' ? source.nextBefore : '',
  };
}


function openScheduleDetail(record) {
  state.view = 'scheduleDetail';
  state.scheduleHighlight = '';
  state.scheduleDetail = {
    id: record.id, record, loading:true, loadingMore:false,
    viewError:'', history:null, historyError:'',
  };
  render();
  loadScheduleDetail();
}


async function loadScheduleDetail({ historyBefore = '' } = {}) {
  const detail = state.scheduleDetail;
  if (!detail) return;
  if (!historyBefore) detail.loading = true;
  else detail.loadingMore = true;
  const id = detail.id;
  const historyPath = `/api/mobile/v1/schedule/history?id=${encodeURIComponent(id)}&limit=20`
    + (historyBefore ? `&before=${encodeURIComponent(historyBefore)}` : '');
  const [viewRes, historyRes] = await Promise.allSettled([
    api(`/api/mobile/v1/schedule/view?id=${encodeURIComponent(id)}`),
    api(historyPath),
  ]);
  if (!state.scheduleDetail || state.scheduleDetail !== detail) return;
  if (viewRes.status === 'fulfilled' && viewRes.value && viewRes.value.record) {
    const fresh = normalizeScheduleRecord(viewRes.value.record);
    if (fresh) detail.record = fresh;
    detail.viewError = '';
  } else if (viewRes.status === 'rejected') {
    detail.viewError = String((viewRes.reason && viewRes.reason.message) || viewRes.reason);
  }
  if (historyRes.status === 'fulfilled') {
    const page = normalizeScheduleHistory(historyRes.value);
    if (historyBefore && detail.history) {
      const seen = new Set(detail.history.records.map(item => item.messageId));
      for (const item of page.records) if (!seen.has(item.messageId)) detail.history.records.push(item);
      detail.history.nextBefore = page.nextBefore;
      detail.history.earlierRecordsUnavailable = page.earlierRecordsUnavailable;
      detail.history.earlierRecordsPruned = page.earlierRecordsPruned;
      detail.history.retention = page.retention;
    } else {
      detail.history = page;
    }
    detail.historyError = '';
  } else {
    detail.historyError = String((historyRes.reason && historyRes.reason.message) || historyRes.reason);
  }
  detail.loading = false;
  detail.loadingMore = false;
  if (state.view === 'scheduleDetail') render();
}


function scheduleHistoryRow(item, fallbackTitle) {
  const at = fmtScheduleAt(item.deliveredAt || item.scheduledAt);
  const text = item.prompt ? plain(item.prompt).slice(0, 40)
    : (item.targetSessionId ? scheduleSessionTitle(item.targetSessionId) : (fallbackTitle || '（无提示词）'));
  return el('div', { class:'hrow' },
    el('span', { class:'hw', text: at || '—' }),
    el('span', { class:'hn', text }),
    el('span', { class:'hr ok', text:'已投递' }));
}


async function deleteSchedule(record) {
  if (!confirm(`删除「${record.title}」？\n删除后不会再触发，已投递的记录不再保留。`)) return;
  const body = { id: record.id };
  if (record.updatedAt) body.expectedUpdatedAt = record.updatedAt;
  if (record.sessionId) body.sessionId = record.sessionId;
  try {
    await api('/api/mobile/v1/schedule/delete', { method:'POST', body });
    toast('已删除');
    state.scheduleDetail = null;
    state.scheduleHighlight = '';
    state.schedule = null;
    state.view = 'schedule';
    render();
    loadSchedule();
  } catch (e) {
    const code = e && e.code;
    if (code === 'schedule_conflict') toast('这条任务刚被改过，刷新后再试');
    else toast('删除失败：' + String((e && e.message) || e));
  }
}


export { SCHEDULE_FREQ_LABEL, createScheduleFromDraft, deleteSchedule, fmtScheduleAt, loadSchedule, loadScheduleDetail, normalizeScheduleRecord, openSchedule, openScheduleEdit, openScheduleNew, renderScheduleRow, scheduleAction, scheduleBasename, scheduleDeliveryRow, scheduleEveryLabel, scheduleFrequencyDetail, scheduleHistoryRow, scheduleInput, scheduleLocalDate, scheduleRecentDeliveries, scheduleRow, scheduleSessionTitle, scheduleTargetText, scheduleTimeValue, scheduleTimingFromDraft, scheduleWeekdayName, scheduleZone };
