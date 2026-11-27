import { render } from '../core/bus.js';
import { state } from '../core/state.js';
import { el } from '../core/dom.js';
import { api } from '../core/api.js';
import { headerEl } from '../components/chrome.js';
import { refreshAll } from '../features/sync.js';

async function openGit(workspaceId, title) {
  state.view = 'git';
  state.gitWs = workspaceId;
  state.gitTitle = title || 'Git';
  state.gitData = null;
  render();
  try {
    const [ov, st, lg] = await Promise.all([
      api('/api/mobile/v1/git/overview?workspaceId=' + encodeURIComponent(workspaceId)).catch(() => null),
      api('/api/mobile/v1/git/status?workspaceId=' + encodeURIComponent(workspaceId)).catch(() => null),
      api('/api/mobile/v1/git/log?workspaceId=' + encodeURIComponent(workspaceId)).catch(() => null),
    ]);
    state.gitData = { ov, st, lg };
  } catch (e) {
    state.gitData = { err: String(e.message || e) };
  }
  if (state.view === 'git') render();
}


function renderGit(wrap) {
  const back = el('button', { class:'ico', text:'‹', onclick: () => {
    state.view = 'list'; render(); refreshAll();
  }});
  const d = state.gitData;
  wrap.append(headerEl(d && d.ov && d.ov.branch ? `Git · ${d.ov.branch}` : 'Git', back, el('span')));
  const main = el('main');
  if (!d) { main.append(el('div', { class:'empty', text:'加载中…' })); wrap.append(main); return; }
  if (d.err) { main.append(el('div', { class:'empty', text: d.err })); wrap.append(main); return; }

  const ov = d.ov || {};
  if (ov.remote || ov.githubRepo) {
    main.append(el('div', { class:'kvrow' }, el('span', { class:'kk', text:'远端' }),
      el('span', { class:'vv', text: ov.githubRepo || ov.remote || '' })));
  }
  const st = d.st || {};
  const groups = [
    ['已暂存', st.staged, 'var(--ok)'],
    ['未暂存', st.unstaged, 'var(--warn)'],
    ['未跟踪', st.untracked, 'var(--dim)'],
    ['冲突', st.conflicted, 'var(--bad)'],
  ];
  let total = 0;
  for (const [label, list, color] of groups) {
    if (!Array.isArray(list) || !list.length) continue;
    total += list.length;
    main.append(el('div', { class:'ghead' }, el('span', { class:'gname', text: label }),
      el('span', { class:'count', style:'margin-left:auto', text: String(list.length) })));
    for (const f of list.slice(0, 40)) {
      const name = typeof f === 'string' ? f : (f.path || f.name || JSON.stringify(f));
      main.append(el('div', { class:'frow' },
        el('span', { class:'fico', style:`color:${color}`, text:'●' }),
        el('span', { class:'fname', text: name })));
    }
  }
  if (!total) main.append(el('div', { class:'cmeta', style:'padding:10px 4px', text:'工作区干净，没有未提交的改动' }));

  const commits = (d.lg && d.lg.commits) || [];
  if (commits.length) {
    main.append(el('div', { class:'ghead', style:'margin-top:10px' }, el('span', { class:'gname', text:'最近提交' })));
    for (const c of commits.slice(0, 12)) {
      main.append(el('div', { class:'frow' },
        el('span', { class:'fico', style:'color:var(--dim);font-size:11px', text: c.shortHash || '' }),
        el('span', { class:'fname', text: c.subject || '' })));
    }
  }
  wrap.append(main);
}

// 离线横幅：断网/恢复时给个明确反馈，而不是让用户看着不动的界面猜

export { openGit, renderGit };
