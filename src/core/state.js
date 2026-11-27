import { LS } from './config.js';

if (typeof location !== 'undefined' && typeof localStorage !== 'undefined') (() => {
  const h = location.hash || '';
  const t = /[#&]token=([^&]+)/.exec(h);
  const i = /[#&]inst=([^&]+)/.exec(h);
  if (t) {
    localStorage.setItem(LS.token, decodeURIComponent(t[1]));
    if (i) localStorage.setItem(LS.inst, decodeURIComponent(i[1]));
    history.replaceState(null, '', location.pathname + location.search);
  }
})();


const _lsGet = (k) => { try { return typeof localStorage !== 'undefined' ? _lsGet(k) : null; } catch { return null; } };
const state = {
  token: _lsGet(LS.token) || '',
  instanceId: _lsGet(LS.inst) || '',
  // 连接方式：auto = 先探局域网、不通就回中转；relay = 只走中转；lan = 只走局域网
  mode: _lsGet(LS.mode) || 'auto',
  lanBase: _lsGet(LS.lanBase) || '',   // 手填的局域网入口，空则自动发现
  lanPort: _lsGet(LS.lanPort) || '8443',
  lanName: _lsGet(LS.lanName) || '',   // 稳定的 .local 名字：换 Wi-Fi 也不用改
  apiBase: '',        // 当前生效的请求前缀，'' 表示与页面同源（中转）
  netInfo: null,      // 最近一次探测结果
  booted: false,
  view: 'list',
  sessions: [],
  workspaces: [],
  sessionId: null,
  sessionTitle: '',
  messages: [],
  lastSeq: 0,
  live: null,
  device: null,
  cards: [],
  collapsed: new Set(JSON.parse(_lsGet(LS.collapsed) || '[]')),
  expandedGroups: new Set(),
  model: null,
  permCurrent: '',
  busy: false,
  // 本轮开始的时间戳（0 = 没在跑，或这一轮是「打开时已经在跑」——那种不显示计时，免得从 0 起算误导）
  busySince: 0,
  // F1 过程进度：本轮步骤 / 轮次 / 待办阶段。切会话、新一轮开始时清空，避免串台。
  steps: [],
  stepsTurn: null,
  phase: null,
  stepsDone: null,
  stepsDoneFade: false,
  // F2：语音输入 / 朗读。rec 是按住说话进行中的识别会话（手一松就清掉）
  rec: null,
  speaking: false,
  speakIndex: 0,
  speakTotal: 0,
  speakMsgId: null,
  autoReadPending: false,
  stream: 'idle',
  poll: null,
  lastPaint: 0,
  pending: [],
  unseen: 0,
  foreign: new Map(),
  attn: 0,
  searchQ: '',
  searchItems: null,
  modelGroups: [],
  modelMeta: null,
  commands: null,
  authError: '',
  sending: false,
  queue: [],
  // F3 子代理：目录元数据（列表只靠它画，不读子会话消息）
  subagents: [],
  subagentsFor: null,
  subagentsAt: 0,
  subagentsParentAvailable: true,
  subagentsLoading: false,
  subagent: null,              // 只读视图里那一条 entry
  subagentMessages: [],
  subagentLoading: false,
  subagentError: '',
  subagentPoll: null,
  // F4 停止交代：turn 来自 turn/start 帧，拿不到就不画卡
  turn: null,
  turnStartedAt: 0,
  stopSummary: null,           // { turn, data, expanded, durationMs }
  // F5 定时任务：目录、新建草稿、详情（含历史）
  schedule: null,
  scheduleDraft: null,
  scheduleDetail: null,
  scheduleHighlight: '',
  tab: 'all',
  archived: null,
  archivedError: '',
  filesPath: '',
  filesSelecting: false,
  filesSel: new Set(),
  subPage: '',
  filesListing: null,
  filesError: '',
  showHidden: false,
  roots: null,
  sessionCwd: '',
  gitWs: '',
  gitData: null,
  gitTitle: '',
  msgLimit: 120,
  // 从子代理只读页返回父会话时用：{ sessionId, top, atBottom }，渲染挂载后消费一次
  sessionRestore: null,
};


function uuid() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch {}
  const b = new Uint8Array(16);
  try { crypto.getRandomValues(b); }
  catch { for (let i = 0; i < b.length; i++) b[i] = Math.random() * 256 | 0; }
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

// ---------------------------------------------------------------- 连接方式（中转 / 局域网）
// 页面原点只有一个（线上那个 https 域名），但「API 打到哪」可以换：把每条请求前缀换成
// 探测到的局域网入口，页面、SW、缓存、凭据全都不用动。这样才有真正的自动/手动切换。
// 注意：页面是 https 时，局域网入口也必须是 https，否则浏览器按混合内容直接拦。

const ui = { sessionId:null, body:null, listWrap:null, cardsWrap:null, ta:null, sendBtn:null, strip:null, dot:null, sig:'',
  progSig:'', atBottom: true };

// 大图查看器：双指缩放（1–5x）、放大后单指拖动、双击切换、桌面滚轮缩放。
// 关键点：
//   - touch-action:none + 非 passive 的 touchmove：否则 iOS Safari 会把双指手势抢去缩放整个页面
//   - 双击/拖动后的合成 click 不能顺手关掉浮层（用 moved / lastToggle 挡掉）
//   - 平移边界按「图片显示尺寸 × (scale-1)/2」夹住，放大后不会把图拖出屏幕找不回来
function resetUi(next) { for (const k of Object.keys(ui)) delete ui[k]; Object.assign(ui, next); }

export { resetUi, state, ui, uuid };
