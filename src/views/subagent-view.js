import { render } from '../core/bus.js';
import { state } from '../core/state.js';
import { el } from '../core/dom.js';
import { sheetIconSVG } from '../components/sheet.js';
import { heroBackHeader } from '../components/chrome.js';
import { SUB_META, goBackFromSubagent, interruptSubagent, loadSubagentMessages, renderChildMessage, subagentDuration } from '../features/subagents.js';

function renderSubagentView(wrap) {
  const entry = state.subagent;
  if (!entry) { state.view = 'session'; render(); return; }
  const back = el('button', { class:'ico', html: sheetIconSVG('chevronLeft'), title:'返回会话',
    'aria-label':'返回会话', onclick: goBackFromSubagent });
  const sub = state.subagentsParentAvailable
    ? `子代理 · 父会话 ${state.sessionTitle || '当前会话'}`
    : '子代理 · 父会话已删除';
  wrap.append(heroBackHeader(entry.title, sub, back));
  const meta = SUB_META[entry.status];
  const dur = subagentDuration(entry);
  const metabar = el('div', { class:'metabar2' },
    el('span', { class:`dot ${meta.dot}` }),
    el('span', { class: entry.status === 'running' ? 'w' : '', text: `${meta.label}${dur ? ' ' + dur : ''}` }));
  const modeText = entry.mode === 'one-shot' ? '一次性' : entry.mode === 'continuable' ? '可继续'
    : entry.mode === 'unknown' ? '模式未知' : '外部';
  metabar.append(el('span', { class:'sep', text:'·' }), el('span', { text: modeText }));
  if (!state.subagentsParentAvailable) metabar.append(el('span', { class:'sep', text:'·' }), el('span', { text:'只读' }));
  wrap.append(metabar);

  const main = el('div', { class:'roview' });
  wrap.append(main);
  if (entry.desc) {
    main.append(el('div', { class:'dispatch' },
      el('div', { class:'dl', text:'派发指令' }),
      el('div', { class:'dt', text: entry.desc })));
  }
  if (!state.subagentsParentAvailable) {
    main.append(el('div', { class:'childnote warn',
      text:'主会话已删除，读到的消息可能不全；状态和打断仍然可用。' }));
  }
  if (state.subagentLoading) {
    for (const width of ['92%', '78%', '86%']) main.append(el('div', { class:'skel', style:`width:${width}` }));
  } else if (state.subagentError) {
    main.append(el('div', { class:'childnote warn' }, el('div', { text: state.subagentError })),
      el('button', { class:'showhidden', style:'margin-top:8px', type:'button', text:'重试',
        onclick: () => { state.subagentError = ''; state.subagentLoading = true; render(); loadSubagentMessages(); } }));
  } else if (!state.subagentMessages.length) {
    main.append(el('div', { class:'empty', text:'这个子代理还没有消息' }));
  } else {
    for (const m of state.subagentMessages) main.append(renderChildMessage(m));
    if (entry.status === 'running') {
      main.append(el('div', { class:'typing' }, el('i'), el('i'), el('i'), el('span', { text:'正在跑…' })));
    }
  }

  const interruptible = entry.status === 'running' || entry.status === 'pending';
  const bar = el('div', { class:'robar' },
    el('div', { class:'rt', text:'只读视图 · 发消息请回主会话' }),
    el('button', { class:'ibtn', type:'button', text:'■ 打断', disabled: !interruptible,
      onclick: () => interruptSubagent(entry) }));
  wrap.append(bar);
}

// ---------------------------------------------------------------- F4 停止交代
// 停止成功后按轮号拉一次交代；字段缺就少画一段，接口失败/空交代都不画卡。

export { renderSubagentView };
