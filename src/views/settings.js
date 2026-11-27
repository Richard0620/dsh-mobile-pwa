import { render } from '../core/bus.js';
import { APP_VERSION } from '../core/version.js';
import { state } from '../core/state.js';
import { el } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { fmtDur, fmtTime, fmtTok } from '../core/format.js';
import { clearLocalCaches } from '../core/cache.js';
import { api } from '../core/api.js';
import { setNetMode } from '../core/net.js';
import { sheetIconSVG } from '../components/sheet.js';
import { connPill, heatmap, heroBackHeader, miniBars } from '../components/chrome.js';
import { alwaysDone, disablePush, enablePush, pushHeartbeat, pushStatus, setAlwaysDone } from '../features/push.js';
import { setSpeechAuto, setSpeechHold, speechAutoOn, speechHoldOn, speechRecogCtor, speechSynthOK } from '../features/voice.js';
import { openSchedule } from '../features/schedule-api.js';
import { openConnectionSheet, openRecovery, openSkinSheet, openThemeSheet, openVersionCheck, reloadApp } from '../features/session-actions.js';
import { openSession } from '../features/sync.js';

async function renderSubPage(wrap) {
  const page = state.subPage || 'conn';
  const titles = { conn:'连接', push:'通知', pushdiag:'推送诊断', stats:'统计', voice:'语音', about:'关于' };
  const back = el('button', { class:'ico', html:sheetIconSVG('chevronLeft'), title:'返回设置', 'aria-label':'返回设置', onclick: () => {
    state.view = 'settings'; state.subPage = ''; render();
  }});
  const headAction = page === 'conn' ? connPill({ interactive:false }) : null;
  wrap.append(heroBackHeader(titles[page] || '设置', '', back, headAction));
  const main = el('div', { class:'settings' });
  wrap.append(main);

  const group = (...rows) => el('div', { class:'groupcard' }, ...rows);
  const row = (title, desc, value, run) => el(run ? 'button' : 'div', run ? { class:'srow', onclick: run } : { class:'srow' },
    el('div', { class:'st' }, el('b', { text: title }), desc ? el('span', { text: desc }) : null),
    value ? el('span', { class:'sv', text: value }) : null);
  const sw = (title, desc, on, run) => el('div', { class:'srow', onclick: run },
    el('div', { class:'st' }, el('b', { text: title }), desc ? el('span', { text: desc }) : null),
    el('span', { class:'tgl' + (on ? ' on' : '') }));

  if (page === 'conn') {
    const modeLabel = state.mode === 'auto' ? '自动' : state.mode === 'lan' ? '仅局域网' : '仅中转';
    const info = state.netInfo || {};
    main.append(el('div', { class:'slabel', text:'连接方式' }), group(
      row('自动', '通了局域网就直连，断了回中转', state.mode === 'auto' ? '✓' : '', () => { setNetMode('auto'); render(); }),
      row('仅中转', '始终走公网中转', state.mode === 'relay' ? '✓' : '', () => { setNetMode('relay'); render(); }),
      row('仅局域网', '只走局域网直连（需要证书）', state.mode === 'lan' ? '✓' : '', () => { setNetMode('lan'); render(); }),
    ));
    // 诊断数据：中转延迟现测一次，其余取宿主的 connection-info（不造指标）
    let ci = null;
    let relayLabel = '不可达';
    let relayMs = 0;
    try { ci = await api('/api/mobile/v1/connection-info'); } catch {}
    const t0 = performance.now();
    try {
      const h = await api('/api/mobile/v1/health');
      relayMs = Math.round(performance.now() - t0);
      relayLabel = h.service === 'dsh-mobile-relay' ? '正常（中转）'
        : h.service === 'dsh-mobile-plugin' ? '正常（直连宿主）'
        : (h.service || '正常');
    } catch (e) { relayLabel = String(e.message || e); }

    const lineName = info.channel === 'lan' ? '局域网直连' : (info.channel ? '公网中转' : '探测中');
    const lineMs = info.ms ? info.ms + 'ms' : (info.channel ? '—' : '');
    main.append(el('div', { class:'slabel', text:'当前线路' }), group(
      row('线路', lineName, lineMs, null),
      row('探测时间', info.at ? new Date(info.at).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }) : '还没探测', '', null),
      row('高级设置', '手填局域网地址 / 稳定名字', '', () => openConnectionSheet()),
    ));
    const lan = (ci && ((ci.lanUrls && ci.lanUrls.length) ? ci.lanUrls : ci.lanCandidates)) || [];
    const direct = [(ci && ci.directUrl), (ci && ci.tcpUrl)].filter(Boolean).join(' / ');
    const v6 = (ci && ci.ipv6Candidates) || [];
    main.append(el('div', { class:'slabel', text:'中转' }), group(
      row('中转地址', (ci && (ci.relayUrl || (ci.relayUrls || [])[0])) || '未配置', '', null),
      row('中转状态', relayLabel, relayMs ? relayMs + 'ms' : '', null),
    ));
    main.append(el('div', { class:'slabel', text:'直连' }), group(
      row('局域网直连', lan.length ? lan[0].url : '同网才有，当前没有可用地址',
        lan.length && lan[0].interface ? lan[0].interface : '', null),
      row('公网直连', direct || '未设置', direct ? '' : '可在「高级设置」里手填', null),
      row('IPv6', v6.length ? v6[0].url : '无', '', null),
    ));
    main.append(el('div', { class:'slabel', text:'实例' }), group(
      row('设备名', (ci && ci.name) || '未知', '', null),
      row('实例 ID', String(state.instanceId || '').slice(0, 8) || '未知', '', null),
      row('最近上报', ci && ci.lastSeen ? fmtTime(ci.lastSeen) : '—', '', null),
      row('复制诊断', '整份连接信息 JSON，出问题直接发出去', '', async () => {
        try { await navigator.clipboard.writeText(JSON.stringify({ relayLabel, relayMs, ci }, null, 2)); toast('已复制连接信息'); }
        catch { toast('复制失败'); }
      }),
      row('重新测速', '重跑一次健康检查', '', () => render()),
    ));
    main.append(el('div', { class:'slabel', text:'其他' }), group(
      row('恢复链接', '粘一条带 token 的链接重新登录', '', openRecovery),
      row('重新加载', '清掉页面状态重新进入', '', reloadApp),
    ));
    return;
  }

  if (page === 'voice') {
    const canRecog = !!speechRecogCtor();
    const canSpeak = speechSynthOK();
    main.append(el('div', { class:'slabel', text:'语音' }), group(
      sw('按住说话', canRecog ? '允许长按麦克风说话'
        : '这个浏览器没有语音识别（iOS 16.4 以下不支持）', speechHoldOn(), () => {
          if (!canRecog) { toast('这个浏览器不支持语音识别'); return; }
          setSpeechHold(!speechHoldOn()); render();
        }),
      sw('自动朗读回复', canSpeak ? '每轮回复完成后自动朗读，随时可以停止'
        : '这个浏览器不支持朗读', speechAutoOn(), () => {
          if (!canSpeak) { toast('这个浏览器不支持朗读'); return; }
          setSpeechAuto(!speechAutoOn()); render();
        }),
    ));
    main.append(el('div', { class:'slabel', text:'说明' }), group(
      row('识别', '浏览器原生识别（iOS 走系统听写，不经过电脑）', '', null),
      row('朗读', '按句切分播放并显示第几段；切后台自动停', '', null),
    ));
    return;
  }

  if (page === 'push') {
    let st = 'off';
    try { st = await pushStatus(); } catch {}
    const label = { on:'已开启，这台设备会收到推送', off:'未开启', denied:'系统里被拒绝，请去 设置 → 通知 打开',
      unsupported:'浏览器不支持 Web Push（iOS 16.4+ 且需添加到主屏）', nosw:'Service Worker 没注册上',
      installing:'SW 正在激活，稍后再看' }[st] || st;
    main.append(el('div', { class:'slabel', text:'推送' }), group(
      sw('通知提醒', label, st === 'on', async () => { if (st === 'on') await disablePush(); else await enablePush(); render(); }),
      sw('完成时总是推送', '后台跑完也推一条，不只审批', alwaysDone(), () => { setAlwaysDone(!alwaysDone()); pushHeartbeat(); render(); }),
    ));
    main.append(el('div', { class:'slabel', text:'排查' }), group(
      row('推送诊断', 'SW、权限、最近投递', '', () => { state.subPage = 'pushdiag'; render(); }),
      row('重新检测', '重新读一遍当前状态', '', () => render()),
    ));
    return;
  }

  if (page === 'pushdiag') {
    const rows = [];
    try { rows.push(['通知状态', await pushStatus()]); } catch { rows.push(['通知状态', 'err']); }
    rows.push(['权限', (typeof Notification !== 'undefined' ? Notification.permission : '-')]);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      rows.push(['SW 作用域', reg ? (reg.scope || '-') : '未注册']);
      rows.push(['SW 状态', reg ? (reg.active ? 'active' : (reg.installing ? 'installing' : 'waiting')) : '-']);
      const c = await caches.open('dsh-open');
      rows.push(['dsh-open 条目', String((await c.keys()).length)]);
    } catch { rows.push(['缓存', '读不到']); }
    main.append(el('div', { class:'slabel', text:'状态' }), group(
      ...rows.map(([k, v]) => row(k, '', String(v), null))));
    return;
  }

  if (page === 'stats') {
    main.append(el('div', { class:'slabel', text:'最近 7 天' }));
    const box = el('div', { class:'groupcard' });
    main.append(box);
    try {
      const r = await api('/api/mobile/v1/stats/overview');
      const k = (r.overview && r.overview.kpi) || {};
      const days = (r.overview && r.overview.days) || [];
      const models = (r.overview && r.overview.models) || [];
      const billed = models.reduce((a, m) => a + (m.billedTokens || 0), 0);
      box.append(
        row('会话', '', String(k.sessions ?? '-'), null),
        row('轮次 / 步数', '', `${k.turns ?? '-'} / ${k.steps ?? '-'}`, null),
        row('输出 tokens', '', fmtTok(k.outputTokens), null),
        row('缓存读取', '', fmtTok(k.cacheReadTokens), null),
        row('未缓存输入', '', fmtTok(k.uncachedInputTokens), null),
        row('计费 tokens', '', billed ? fmtTok(billed) : '-', null),
        row('活跃时长', '', fmtDur(k.activeMs), null),
        row('模型耗时', '', fmtDur(k.llmMs), null),
        row('工具耗时', '', fmtDur(k.toolMs), null),
      );
      if (days.length) {
        main.append(el('div', { class:'slabel', text:'输出趋势' }), miniBars(days, d => d.outputTokens) || el('span'));
        // 热力图单独取 30 天：KPI 那几张卡还是 7 天口径，两个口径不能混着画
        let heatDays = days;
        try {
          const r30 = await api('/api/mobile/v1/stats/overview?range=30d');
          const d30 = (r30.overview && r30.overview.days) || [];
          if (d30.length > days.length) heatDays = d30;
        } catch {}
        const heat = heatmap(heatDays, 35);
        if (heat) main.append(el('div', { class:'slabel', text:`活跃热力（最近 ${heatDays.length} 天）` }),
          el('div', { class:'groupcard' }, heat,
            el('div', { class:'heatlegend' },
              el('span', { text:'少' }),
              el('i', { class:'hcell l0' }), el('i', { class:'hcell l1' }),
              el('i', { class:'hcell l2' }), el('i', { class:'hcell l3' }),
              el('span', { text:'多' }))));
      }
      // 最近活跃会话：宿主没有「按会话的 token 排行」接口，这里按最后活跃时间排，
      // 标题就叫「最近活跃」而不是「排行」，别造一个不存在的指标
      let recent = (state.sessions || []).slice();
      if (!recent.length) { try { const s = await api('/api/mobile/v1/sessions'); recent = s.items || []; } catch {} }
      const top = recent.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6);
      if (top.length) {
        main.append(el('div', { class:'slabel', text:'最近活跃会话' }));
        main.append(el('div', { class:'groupcard' },
          ...top.map(s => row(s.title || '(无标题)', '', fmtTime(s.updatedAt), () => openSession(s)))));
      }
      if (models.length) {
        main.append(el('div', { class:'slabel', text:'按模型' }));
        main.append(el('div', { class:'groupcard' },
          ...models.slice(0, 6).map(m => row((m.modelName || m.model || '?'), (m.providerName || ''), `输出 ${fmtTok(m.outputTokens)}`, null))));
      }
      if (days.length) {
        main.append(el('div', { class:'slabel', text:'按天' }));
        main.append(el('div', { class:'groupcard' },
          ...days.slice(-7).map(d => row(d.day || '?', '', `输出 ${fmtTok(d.outputTokens)} · ${d.requests || 0} 次`, null))));
      }
    } catch (e) {
      box.append(row('取统计失败', String(e.message || e), '', null));
    }
    return;
  }
  // about
  let devices = '';
  try { const r = await api('/api/mobile/v1/paired-devices'); devices = String((r.devices || r.items || []).length); } catch {}
  main.append(el('div', { class:'slabel', text:'应用' }), group(
    row('版本', '构建与缓存', APP_VERSION, null),
    row('已配对设备', '在电脑端可移除', devices ? devices + ' 台' : '', null),
    row('版本自检', '本地版本 / SW 缓存 / 线上版本戳', '', openVersionCheck),
    row('清除缓存并重载', '删掉 Cache Storage 与 SW 后重载', '', async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      } catch {}
      location.reload();
    }),
  ));
  main.append(el('div', { class:'slabel', text:'其他' }), group(
    row('恢复链接', '重新登录', '', openRecovery),
    row('重新加载', '清页面状态再进', '', reloadApp),
  ));
}
// 设置首页要显示真实状态（推送开没开、配了几台设备），但 render() 是同步的：
// 先把事实缓存起来异步取一次，拿到后只重绘一次设置页（避免每次进都闪）。

let settingsFacts = null;

function loadSettingsFacts() {
  if (settingsFacts) return;
  settingsFacts = { push: '', devices: null };
  Promise.all([
    pushStatus().catch(() => 'off'),
    api('/api/mobile/v1/paired-devices')
      .then(r => (r.devices || r.items || []).length)
      .catch(() => null),
  ]).then(([push, devices]) => {
    settingsFacts = { push, devices };
    if (state.view === 'settings') render();
  });
}


function renderSettings(wrap) {
  const sub = el('div', { class:'subrow' },
    el('div', { class:'sub', text:'DSH MOBILE · ' + APP_VERSION }));
  wrap.append(el('div', { class:'hero' },
    el('div', { class:'hero-stack' },
      el('div', { class:'hrow' }, el('h1', { text:'设置' }),
        el('div', { class:'acts' }, connPill())),
      sub)));
  loadSettingsFacts();
  const facts = settingsFacts || { push:'', devices:null };
  const skin = (() => { try { const v = localStorage.getItem('dsh.skin'); return v === 'carbon' ? '碳黑' : v === 'auto' ? '跟随系统' : '纸面'; } catch { return '纸面'; } })();
  const theme = (() => { try { const t = localStorage.getItem('dsh.theme'); return t === 'light' ? '浅色' : t === 'dark' ? '深色' : '跟随系统'; } catch { return '跟随系统'; } })();
  const row = (title, desc, value, run) => el(run ? 'button' : 'div', run ? { class:'srow', onclick: run } : { class:'srow' },
    el('div', { class:'st' }, el('b', { text: title }), desc ? el('span', { text: desc }) : null),
    value ? el('span', { class:'sv', text: value }) : null);
  const sw = (title, desc, on, run) => el('div', { class:'srow', onclick: run },
    el('div', { class:'st' }, el('b', { text: title }), desc ? el('span', { text: desc }) : null),
    el('span', { class:'tgl' + (on ? ' on' : '') }));
  const card = rows => el('div', { class:'groupcard' }, ...rows);
  const main = el('div', { class:'settings' });
  const pushLabel = {
    on:'已开启，这台设备会收到推送', off:'未开启，点了开启',
    denied:'系统里被拒绝，请去 设置 → 通知 打开',
    unsupported:'浏览器不支持 Web Push（iOS 16.4+ 且需添加到主屏）',
    nosw:'Service Worker 没注册上', installing:'SW 正在激活，稍后再看',
  }[facts.push] || (facts.push === '' ? '读取中…' : String(facts.push));
  main.append(el('div', { class:'slabel', text:'外观' }), card([
    row('皮肤', '纸面 / 碳黑', skin, openSkinSheet),
    row('主题', '跟随系统 / 浅色 / 深色', theme, openThemeSheet),
  ]));
  main.append(el('div', { class:'slabel', text:'语音' }), card([
    row('语音', '按住说话、自动朗读回复',
      speechHoldOn() && speechAutoOn() ? '都开' : speechHoldOn() ? '按住说话' : speechAutoOn() ? '自动朗读' : '',
      () => { state.view = 'sub'; state.subPage = 'voice'; render(); }),
  ]));
  main.append(el('div', { class:'slabel', text:'通知' }), card([
    sw('通知提醒', pushLabel, facts.push === 'on', async () => {
      if (facts.push === 'on') await disablePush(); else await enablePush();
      settingsFacts = null; render();
    }),
    sw('完成时总是推送', '后台跑完也推一条，不只在等你审批时', alwaysDone(), () => {
      setAlwaysDone(!alwaysDone()); pushHeartbeat(); render();
    }),
    row('推送诊断', '订阅端点、最近投递', '', () => { state.view = 'sub'; state.subPage = 'pushdiag'; render(); }),
  ]));
  main.append(el('div', { class:'slabel', text:'自动化' }), card([
    row('定时任务', '每天 / 工作日 / 每周 / 仅一次', '', openSchedule),
  ]));
  main.append(el('div', { class:'slabel', text:'连接' }), card([
    row('连接', '自动 / 仅中转 / 仅局域网', '', () => { state.view = 'sub'; state.subPage = 'conn'; render(); }),
    row('统计', '会话数、词元与用量', '', () => { state.view = 'sub'; state.subPage = 'stats'; render(); }),
    row('终端', '在浏览器打开 /agents/', '', () => { location.href = '/agents/'; }),
  ]));
  main.append(el('div', { class:'slabel', text:'应用' }), card([
    row('关于', '版本、设备、缓存', APP_VERSION, () => { state.view = 'sub'; state.subPage = 'about'; render(); }),
    row('已配对设备', '在电脑端可移除', facts.devices == null ? '' : facts.devices + ' 台', null),
    row('重新加载', '清掉页面状态重新进入', '', reloadApp),
    row('退出登录', '清除本机凭据', '', () => { clearLocalCaches(); state.token = ''; state.view = 'list'; render(); }),
  ]));
  wrap.append(main);
}

export { renderSettings, renderSubPage };
