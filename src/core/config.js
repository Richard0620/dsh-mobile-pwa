
const LS = { token:'dsh.token', inst:'dsh.inst', collapsed:'dsh.collapsed', draft:'dsh.draft', mode:'dsh.mode', lanBase:'dsh.lanBase', lanPort:'dsh.lanPort', lanName:'dsh.lanName' };

// 本地缓存：先出内容再拉新（弱网/离线时至少能看到上次的样子）

const CACHE_KEYS = { list:'dsh.cache.list', msgs:'dsh.cache.msgs' };
// 缓存 schema：结构不兼容时只清列表/消息缓存，已读水位和主题等偏好保留

const CACHE_SCHEMA = 1;
if (typeof localStorage !== 'undefined') try {
  if (localStorage.getItem('dsh.cache.schema') !== String(CACHE_SCHEMA)) {
    localStorage.removeItem(CACHE_KEYS.list);
    localStorage.removeItem(CACHE_KEYS.msgs);
    localStorage.setItem('dsh.cache.schema', String(CACHE_SCHEMA));
  }
} catch {}

// ---------------------------------------------------------------- 缓存存储层 v2
// 一期只做「影子写 + 可开关读取」，不改界面、不改接口：
//   - 默认开启：读走 IndexedDB，写仍然照老规则写 localStorage（当影子 + 回滚保险），
//     另外再写一份到 IndexedDB（限额更大：单会话 400 条 / 最多 30 个会话）；
//   - 回退：localStorage['dsh.cache.v2'] = '0' 后彻底重开 App，就只剩下面的 legacy 路径，
//     行为与改动前逐字节一致；删掉这个键即恢复默认开启。
// 四个对外函数 saveListCache / readListCache / saveMsgCache / readMsgCache 签名和行为保持。

const CACHE_V2_KEY = 'dsh.cache.v2';

const CACHE_V2_MIGRATED_KEY = 'dsh.cache.migrated.v2';
// 退登时若库连接还没开（open pending），当场清不掉库：留一个持久「待清」标记，下次拿连接时先清再读

const CACHE_V2_WIPE_KEY = 'dsh.cache.wipe.v2';

const IDB_NAME = 'dsh-mobile';

const IDB_VERSION = 1;

const IDB_STORE = 'kv';
// 本期唯一的行为差异：IDB 单会话 400 条 / 最多 30 个会话；legacy 仍是 120 条 / 10 个会话

const IDB_LIMITS = { msgsPerSession: 400, sessions: 30 };
// 2026-11-25 用户决策：默认开启（一期先发 preview 真机跑一天）。
// 回退开关保留：`localStorage['dsh.cache.v2'] = '0'` 后彻底重开 App 即回到 legacy。

const CACHE_V2 = (() => { try { return localStorage.getItem(CACHE_V2_KEY) !== '0'; } catch { return true; } })();

// 读接口是同步的（调用点都在渲染路径上），所以 IndexedDB 的内容先灌进内存镜像，读只查内存。
// 键：'list' / 'msg:<sid>'；另有一条 'idx' 只存 { sid: at }，用于在「不读消息正文」的前提下裁会话数。

const THEME_KEY = 'dsh.theme';

const SKIN_KEY = 'dsh.skin';

const READ_LS = 'dsh.read';

const FALLBACK_COMMANDS = [
  { name:'help', description:'列出可用指令' },
  { name:'compact', description:'压缩较早的对话历史' },
  { name:'export', description:'导出当前会话为 ZIP' },
  { name:'feedback', description:'对当前会话给出反馈' },
  { name:'goal', description:'设置或查看长任务目标' },
  { name:'review', description:'复核当前改动' },
  { name:'clear', description:'清空当前对话上下文' },
];


const PUSH_DEVICE_KEY = 'dsh.push.device';


const ALWAYS_DONE_KEY = 'dsh.push.alwaysDone';

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|3gp)$/i;

const TEXTY_EXT = /\.(md|markdown|txt|json|jsonc|js|mjs|cjs|ts|tsx|jsx|html|htm|css|scss|yml|yaml|sh|ps1|bat|py|rs|go|java|c|h|cpp|log|csv|xml|svg|ini|toml|conf)$/i;

const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|heic|ico)$/i;

const PDF_EXT = /\.pdf$/i;

const isIOS = () => /iP(hone|ad|od)/.test((typeof navigator !== 'undefined' ? navigator.userAgent : ''))
  || ((typeof navigator !== 'undefined' ? navigator.platform : '') === 'MacIntel' && (typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0) > 1);

const MIME_BY_EXT = {
  pdf:'application/pdf', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif',
  webp:'image/webp', svg:'image/svg+xml', avif:'image/avif', bmp:'image/bmp', ico:'image/x-icon', heic:'image/heic',
  mp4:'video/mp4', mov:'video/quicktime', m4v:'video/x-m4v', webm:'video/webm', mkv:'video/x-matroska',
  txt:'text/plain;charset=utf-8', md:'text/markdown;charset=utf-8', json:'application/json',
  zip:'application/zip', csv:'text/csv;charset=utf-8',
};

const SPEECH_HOLD_KEY = 'dsh.speech.hold';

const SPEECH_AUTO_KEY = 'dsh.speech.auto';

export { ALWAYS_DONE_KEY, CACHE_KEYS, CACHE_SCHEMA, CACHE_V2, CACHE_V2_MIGRATED_KEY, CACHE_V2_WIPE_KEY, FALLBACK_COMMANDS, IDB_LIMITS, IDB_NAME, IDB_STORE, IDB_VERSION, IMG_EXT, LS, MIME_BY_EXT, PDF_EXT, PUSH_DEVICE_KEY, READ_LS, SKIN_KEY, SPEECH_AUTO_KEY, SPEECH_HOLD_KEY, TEXTY_EXT, THEME_KEY, VIDEO_EXT, isIOS };
