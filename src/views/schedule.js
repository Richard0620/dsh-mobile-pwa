import { render } from '../core/bus.js';
import { state } from '../core/state.js';
import { el } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { fmtTime } from '../core/format.js';
import { openSheet, sheetIconSVG } from '../components/sheet.js';
import { heroBackHeader } from '../components/chrome.js';
import { SCHEDULE_FREQ_LABEL, createScheduleFromDraft, deleteSchedule, fmtScheduleAt, loadSchedule, loadScheduleDetail, openScheduleEdit, openScheduleNew, renderScheduleRow, scheduleAction, scheduleBasename, scheduleDeliveryRow, scheduleFrequencyDetail, scheduleHistoryRow, scheduleInput, scheduleLocalDate, scheduleRecentDeliveries, scheduleRow, scheduleSessionTitle, scheduleTargetText, scheduleTimeValue, scheduleWeekdayName, scheduleZone } from '../features/schedule-api.js';

function renderSchedule(wrap) {
  const data = state.schedule;
  const records = (data && data.records) || [];
  const active = records.filter(r => r.status === 'active');
  const paused = records.filter(r => r.status !== 'active');
  const sub = data && data.loading ? '读取中…'
    : data && data.error ? '读取失败'
    : (records.length ? `${active.length} 个启用 · ${paused.length} 个暂停` : '还没有任务');
  const back = el('button', { class:'ico', html:sheetIconSVG('chevronLeft'), title:'返回设置',
    'aria-label':'返回设置', onclick: () => { state.view = 'settings'; state.subPage = ''; render(); } });
  const plus = data && data.error ? null
    : el('button', { class:'ico', html:sheetIconSVG('plus'), title:'新建定时任务',
      'aria-label':'新建定时任务', onclick: openScheduleNew });
  wrap.append(heroBackHeader('定时任务', sub, back, plus));
  const main = el('div', { class:'settings' });
  wrap.append(main);

  if (!data || data.loading) {
    for (const width of ['82%', '68%', '74%', '58%']) {
      main.append(el('div', { class:'skel', style:`width:${width};margin:14px 6px` }));
    }
    return;
  }
  if (data.error) {
    main.append(el('div', { class:'empty', text:'读不到定时任务' }),
      el('div', { class:'err', style:'text-align:center', text:data.error }),
      el('button', { class:'cta', type:'button', text:'重试', onclick: () => loadSchedule() }));
    return;
  }
  if (!records.length) {
    main.append(el('div', { class:'empty' },
      el('div', { text:'还没有定时任务' }),
      el('div', { style:'font-size:12.5px;padding-top:6px', text:'存在电脑上，关掉手机也会跑。' })));
    main.append(el('button', { class:'cta', type:'button', text:'新建定时任务', onclick: openScheduleNew }));
    return;
  }
  if (active.length) {
    main.append(el('div', { class:'slabel', text:'启用中' }),
      el('div', { class:'groupcard' }, ...active.map(renderScheduleRow)));
  }
  if (paused.length) {
    main.append(el('div', { class:'slabel', text:'已暂停' }),
      el('div', { class:'groupcard' }, ...paused.map(renderScheduleRow)));
  }
  const recent = scheduleRecentDeliveries(records);
  if (recent.length) {
    main.append(el('div', { class:'slabel', text:'最近运行' }),
      el('div', { class:'groupcard' }, ...recent.map(scheduleDeliveryRow)));
  }
  main.append(el('div', { class:'schedhint',
    text:'点一行进详情：看完整历史、暂停 / 恢复、立刻执行或删除。' }));
}

/** 新建草稿：四选一 + 时间（仅一次另带日期）+ 目标 + 工作区 + 提示词。 */

function renderScheduleNew(wrap) {
  const draft = state.scheduleDraft;
  if (!draft) { state.view = 'schedule'; render(); return; }
  const editing = !!draft.editingId;
  const back = el('button', { class:'ico', html:sheetIconSVG('chevronLeft'), title: editing ? '返回任务详情' : '返回定时任务',
    'aria-label':'返回', onclick: () => {
      if (editing && state.scheduleDetail) { state.view = 'scheduleDetail'; render(); loadScheduleDetail(); }
      else { state.view = 'schedule'; render(); loadSchedule(); }
    } });
  wrap.append(heroBackHeader(editing ? '编辑定时任务' : '新建定时任务',
    editing ? '保存后按新时间重算下次运行' : '存在宿主上 · 关掉手机也会跑', back));
  const main = el('div', { class:'settings' });
  wrap.append(main);

  main.append(el('div', { class:'slabel', text:'什么时候' }));
  const whenRows = [];
  whenRows.push(scheduleRow('频率', '每天 / 工作日 / 每周 / 仅一次', SCHEDULE_FREQ_LABEL[draft.freq] || '每天', () => {
    openSheet([
      { label:'每天', checked:draft.freq === 'daily', run:() => { draft.freq = 'daily'; render(); } },
      { label:'工作日（周一至周五）', checked:draft.freq === 'weekdays', run:() => { draft.freq = 'weekdays'; render(); } },
      { label:'每周', checked:draft.freq === 'weekly', run:() => { draft.freq = 'weekly'; render(); } },
      { label:'仅一次', checked:draft.freq === 'once', run:() => { draft.freq = 'once'; render(); } },
    ], '频率');
  }));
  if (draft.freq === 'weekly') {
    whenRows.push(scheduleRow('星期几', '', scheduleWeekdayName(draft.weekday) || '周三', () => {
      openSheet([1, 2, 3, 4, 5, 6, 7].map(n => ({
        label: scheduleWeekdayName(n), checked:Number(draft.weekday) === n,
        run:() => { draft.weekday = n; render(); },
      })), '星期几');
    }));
  }
  whenRows.push(scheduleRow('时间', '按本机时区', scheduleInput('time', scheduleTimeValue(draft.time), (ev) => {
    draft.time = ev.target.value || '09:00';
  })));
  if (draft.freq === 'once') {
    whenRows.push(scheduleRow('日期', '仅在一天跑一次', scheduleInput('date', draft.date || scheduleLocalDate(1), (ev) => {
      draft.date = ev.target.value || scheduleLocalDate(1);
    }, { min: scheduleLocalDate(0), style:'width:128px' })));
  }
  main.append(el('div', { class:'groupcard' }, ...whenRows));

  main.append(el('div', { class:'slabel', text:'发到哪' }));
  const targetRows = [];
  targetRows.push(scheduleRow('目标', '新会话（推荐）/ 已有会话',
    draft.target === 'session' ? '已有会话' : '新会话', () => {
      openSheet([
        { label:'新会话（推荐）', checked:draft.target !== 'session', run:() => { draft.target = 'new'; render(); } },
        { label:'已有会话', checked:draft.target === 'session', run:() => { draft.target = 'session'; render(); } },
      ], '目标');
    }));
  if (draft.target === 'session') {
    targetRows.push(scheduleRow('会话', '触发时发到这条会话', draft.sessionId ? scheduleSessionTitle(draft.sessionId) : '选择会话', () => {
      const sessions = (state.sessions || []).slice(0, 40);
      if (!sessions.length) { toast('会话列表还没加载'); return; }
      openSheet(sessions.map(s => ({
        label: s.title || '(无标题)',
        sub: [scheduleBasename(s.cwd), s.sessionId === draft.sessionId ? '当前选择' : ''].filter(Boolean).join(' · '),
        checked: s.sessionId === draft.sessionId,
        run: () => { draft.sessionId = s.sessionId; render(); },
      })), '选一条会话');
    }));
  }
  const workspaceLabel = draft.target === 'session' ? '跟随会话'
    : (draft.workspaceCwd ? scheduleBasename(draft.workspaceCwd) : '跟随宿主');
  targetRows.push(scheduleRow('工作区', draft.target === 'session' ? '由目标会话决定' : '决定 cwd 与权限', workspaceLabel,
    draft.target === 'session' ? null : () => {
      const list = state.workspaces || [];
      if (!list.length) { toast('工作区列表还没加载'); return; }
      openSheet(list.map(w => ({
        label: w.title || scheduleBasename(w.path) || '工作区',
        sub: w.path || '',
        checked: w.path === draft.workspaceCwd,
        run: () => { draft.workspaceCwd = w.path || ''; render(); },
      })), '工作区');
    }));
  main.append(el('div', { class:'groupcard' }, ...targetRows));

  main.append(el('div', { class:'slabel', text:'提示词' }));
  const promptInput = el('textarea', { class:'pbox', rows:'3',
    placeholder:'每次触发就是把这段当一条新消息发出去，不要写「明天」这类相对时间。' });
  promptInput.value = draft.prompt;
  promptInput.addEventListener('input', () => { draft.prompt = promptInput.value; });
  main.append(promptInput);
  main.append(el('div', { class:'phint', text:'写清要做什么、做到什么程度、完成后回什么。' }));

  main.append(el('button', { class:'advrow', type:'button',
    onclick: () => { draft.advanced = !draft.advanced; render(); } },
    el('span', { text:'高级 · cron 表达式' }),
    el('span', { class:'ac', text:draft.advanced ? '⌄' : '›' })));
  if (draft.advanced) {
    const cronInput = el('input', { type:'text', placeholder:'0 9 * * *', value:draft.cron,
      autocomplete:'off', autocapitalize:'off', spellcheck:'false' });
    cronInput.addEventListener('input', () => { draft.cron = cronInput.value; });
    main.append(el('div', { class:'advbox' }, cronInput,
      el('div', { class:'phint', text:'五段式（分 时 日 月 周）。填了就按 cron 跑，忽略上面的频率；时区用本机的。' })));
  }

  if (draft.error) main.append(el('div', { class:'schedwarn', text:draft.error }));
  main.append(el('button', { class:'cta', type:'button', disabled:!!draft.saving,
    text: draft.saving ? (draft.editingId ? '保存中…' : '创建中…') : (draft.editingId ? '保存' : '创建'),
    onclick: createScheduleFromDraft }));
}


function renderScheduleDetail(wrap) {
  const detail = state.scheduleDetail;
  if (!detail || !detail.record) { state.view = 'schedule'; render(); return; }
  const record = detail.record;
  const back = el('button', { class:'ico', html:sheetIconSVG('chevronLeft'), title:'返回定时任务',
    'aria-label':'返回定时任务', onclick: () => { state.view = 'schedule'; render(); loadSchedule(); } });
  wrap.append(heroBackHeader(record.title, '定时任务 · 详情', back));
  const meta = el('div', { class:'metabar2' },
    el('span', { class:`dot ${record.status === 'active' ? 'run' : 'done'}` }),
    el('span', { class: record.status === 'active' ? 'w' : '',
      text: record.status === 'active' ? '启用中' : record.status === 'paused' ? '已暂停' : record.status === 'ended' ? '已结束' : '未启用' }));
  if (record.status === 'active' && record.scheduledAt) {
    meta.append(el('span', { class:'sep', text:'·' }), el('span', { text:`下次 ${fmtScheduleAt(record.scheduledAt)}` }));
  }
  if (record.executionActive) meta.append(el('span', { class:'sep', text:'·' }), el('span', { text:'正在执行' }));
  wrap.append(meta);

  const main = el('div', { class:'settings' });
  wrap.append(main);
  const target = scheduleTargetText(record);
  main.append(el('div', { class:'slabel', text:'任务' }),
    el('div', { class:'groupcard' },
      scheduleRow('频率', '', scheduleFrequencyDetail(record), null),
      scheduleRow('下次运行', '', record.status !== 'active' ? '暂停中'
        : (record.scheduledAt ? fmtScheduleAt(record.scheduledAt) : '—'), null),
      scheduleRow('目标', target.dead ? '目标会话已不可用' : '', target.text, null),
      scheduleRow('时区', '', record.timeZone || scheduleZone(), null),
      scheduleRow('修订', '', record.updatedAt ? fmtTime(Date.parse(record.updatedAt)) : '—', null)));

  main.append(el('div', { class:'slabel', text:'提示词' }));
  main.append(el('div', { class:'groupcard' },
    el('div', { style:'padding:12px 14px' }, el('div', { class:'schedprompt', text: record.prompt || '（空）' }))));

  if (detail.viewError) main.append(el('div', { class:'schedwarn', text:'读最新任务失败：' + detail.viewError }));

  main.append(el('div', { class:'facts' },
    el('button', { class:'btn', type:'button', text:'▶ 立刻执行', disabled: !!record.executionActive,
      onclick: () => scheduleAction(record, 'run') }),
    el('button', { class:'btn', type:'button', text: record.status === 'active' ? '⏸ 暂停' : '▶ 恢复',
      onclick: () => scheduleAction(record, record.status === 'active' ? 'pause' : 'resume') })));
  main.append(el('div', { class:'facts', style:'margin-top:8px' },
    el('button', { class:'btn', type:'button', text:'改时间', onclick: () => openScheduleEdit(record) }),
    el('button', { class:'btn no', type:'button', text:'删除任务', onclick: () => deleteSchedule(record) })));

  main.append(el('div', { class:'slabel', text:'最近运行' }));
  if (detail.loading && !detail.history) {
    main.append(el('div', { class:'skel', style:'width:80%;margin:12px 6px' }),
      el('div', { class:'skel', style:'width:66%;margin:12px 6px' }));
  } else if (detail.historyError) {
    main.append(el('div', { class:'empty', text:'读不到运行记录' }),
      el('div', { class:'err', style:'text-align:center', text:detail.historyError }),
      el('button', { class:'cta', type:'button', text:'重试', onclick: () => loadScheduleDetail() }));
  } else if (!detail.history || !detail.history.records.length) {
    main.append(el('div', { class:'empty', text:'还没有投递记录' }));
  } else {
    main.append(el('div', { class:'groupcard' }, ...detail.history.records.map(item => scheduleHistoryRow(item, record.title))));
    if (detail.history.nextBefore) {
      main.append(el('button', { class:'showhidden', type:'button', disabled:!!detail.loadingMore,
        text: detail.loadingMore ? '读取中…' : '加载更早',
        onclick: () => loadScheduleDetail({ historyBefore: detail.history.nextBefore }) }));
    }
    const hint = detail.history.earlierRecordsUnavailable ? '更早的记录宿主已经读不到了。'
      : detail.history.earlierRecordsPruned ? `更早的记录已按保留策略清理（保留 ${detail.history.retention.days || 0} 天 / ${detail.history.retention.records || 0} 条）。`
      : '';
    if (hint) main.append(el('div', { class:'schedhint', text:hint }));
  }
}

// ---------------------------------------------------------------- 流程

export { renderSchedule, renderScheduleDetail, renderScheduleNew };
