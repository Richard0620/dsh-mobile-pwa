import { CACHE_KEYS, CACHE_SCHEMA, CACHE_V2, CACHE_V2_MIGRATED_KEY, CACHE_V2_WIPE_KEY, IDB_LIMITS, IDB_NAME, IDB_STORE, IDB_VERSION } from './config.js';
import { state } from './state.js';

const idbState = {
  ready: false, failed: false, db: null,
  gen: 0,                   // 每次退登 +1：在飞的初始化/迁移/预热看到代数变了就自废
  initToken: null,          // 当前这次初始化；新的 init 会覆盖它，旧 init 据此知道自己已被接手
  clearPending: false,      // 有「待清库」：拿到连接后必须先清空再读，绝不让旧账号数据被读出来
  memList: null,            // 会话列表（读走它）
  memMsgs: new Map(),       // sid -> { at, lastSeq, messages }
  msgAt: new Map(),         // sid -> at（裁剪排序用）
  prefetching: new Set(),
  warnedWrite: false,
  initP: null,
  hydrateP: null,
};


function idbWarn(msg, e) {
  console.warn('[cache-v2] ' + msg, (e && e.message) || e || '');
}

function idbUsable() { return !!(CACHE_V2 && idbState.ready && idbState.db); }


function idbOpenDb() {
  return new Promise((resolve, reject) => {
    let settled = false;
    // WebKit 偶发 open() 既不成功也不失败：兜个超时，别把启动卡死
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('open timeout'));
    }, 3000);
    let req;
    try { req = indexedDB.open(IDB_NAME, IDB_VERSION); }
    catch (e) { clearTimeout(timer); settled = true; return reject(e); }
    req.onupgradeneeded = () => {
      try { if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE); } catch {}
    };
    req.onblocked = () => {};   // 别的标签页还占着旧版本：等它关，不算失败
    req.onerror = () => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(req.error || new Error('open failed'));
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      if (settled) { try { req.result.close(); } catch {} return; }
      settled = true;
      resolve(req.result);
    };
  });
}


function idbGet(key) {
  return new Promise((resolve, reject) => {
    if (!idbState.db) return reject(new Error('no db'));
    let tx;
    try { tx = idbState.db.transaction(IDB_STORE, 'readonly'); } catch (e) { return reject(e); }
    const rq = tx.objectStore(IDB_STORE).get(key);
    rq.onsuccess = () => resolve(rq.result == null ? null : rq.result);
    rq.onerror = () => reject(rq.error || new Error('get failed'));
  });
}

function idbGetAll() {
  return new Promise((resolve, reject) => {
    if (!idbState.db) return reject(new Error('no db'));
    let tx;
    try { tx = idbState.db.transaction(IDB_STORE, 'readonly'); } catch (e) { return reject(e); }
    const rq = tx.objectStore(IDB_STORE).getAll();
    rq.onsuccess = () => resolve(Array.isArray(rq.result) ? rq.result : []);
    rq.onerror = () => reject(rq.error || new Error('getAll failed'));
  });
}
// ops: [{type:'put', key, value} | {type:'del', key} | {type:'clear'}]，一笔事务

function idbTx(ops) {
  return new Promise((resolve, reject) => {
    if (!idbState.db) return reject(new Error('no db'));
    let tx;
    try { tx = idbState.db.transaction(IDB_STORE, 'readwrite'); } catch (e) { return reject(e); }
    tx.oncomplete = () => resolve(true);
    tx.onabort = () => reject(tx.error || new Error('tx aborted'));
    tx.onerror = () => reject(tx.error || new Error('tx failed'));
    try {
      const st = tx.objectStore(IDB_STORE);
      for (const op of ops) {
        if (op.type === 'del') st.delete(op.key);
        else if (op.type === 'clear') st.clear();
        else st.put(op.value, op.key);
      }
    } catch (e) { try { tx.abort(); } catch {} reject(e); }
  });
}
// 写失败不许打断使用：只 warn 一次，legacy 那份还在

function idbWrite(ops, label) {
  idbTx(ops).catch(e => {
    if (idbState.warnedWrite) return;
    idbState.warnedWrite = true;
    idbWarn('写 IndexedDB 失败（' + label + '），继续用 localStorage', e);
  });
}

function idbIdxValue() {
  const msgAt = {};
  for (const [sid, at] of idbState.msgAt) msgAt[sid] = at;
  return { key:'idx', schema: CACHE_SCHEMA, msgAt };
}

// 首次迁移：把 localStorage 里已有的 list/msgs 一次性搬进 IDB，搬完记 dsh.cache.migrated.v2。
// 只补不覆盖：IDB 里已有更新的记录就保留 IDB 的。

async function idbMigrateOnce(gen) {
  try { if (localStorage.getItem(CACHE_V2_MIGRATED_KEY) === '1') return; } catch {}
  const recs = [];
  try {
    const raw = localStorage.getItem(CACHE_KEYS.list);
    const j = raw ? JSON.parse(raw) : null;
    if (j && Array.isArray(j.sessions)) {
      recs.push({ key:'list', value:{ key:'list', at: j.at || Date.now(), sessions: j.sessions } });
    }
  } catch {}
  try {
    const raw = localStorage.getItem(CACHE_KEYS.msgs);
    const all = raw ? JSON.parse(raw) : null;
    if (all && typeof all === 'object') {
      for (const sid of Object.keys(all)) {
        const r = all[sid];
        if (!sid || !r || !Array.isArray(r.messages)) continue;
        const key = 'msg:' + sid;
        recs.push({ key, value:{ key, at: r.at || Date.now(), lastSeq: r.lastSeq || 0, messages: r.messages } });
      }
    }
  } catch {}
  const ops = [];
  for (const rec of recs) {
    let cur = null;
    try { cur = await idbGet(rec.key); } catch {}
    if (cur && (cur.at || 0) >= (rec.value.at || 0)) continue;
    ops.push({ type:'put', key: rec.key, value: rec.value });
    if (rec.key.startsWith('msg:')) idbState.msgAt.set(rec.key.slice(4), rec.value.at);
  }
  // 退登可能发生在迁移中间：代数变了就放弃，别把旧账号数据写回去、也别记「已迁移」
  if (gen !== idbState.gen) return;
  ops.push({ type:'put', key:'idx', value: idbIdxValue() });   // 顺手把 schema 戳写上，后面的版本校验才有依据
  await idbTx(ops);
  if (gen !== idbState.gen) return;
  try { localStorage.setItem(CACHE_V2_MIGRATED_KEY, '1'); } catch {}
}

// 正文灌进内存镜像（后台做，不挡启动）。长会话从后台回来能立刻有内容靠的就是这一步。

async function idbHydrateMsgs(gen) {
  let all = [];
  try { all = await idbGetAll(); } catch (e) { idbWarn('读消息缓存失败', e); return; }
  if (gen !== idbState.gen) return;   // 退登过：别把旧账号的数据灌进内存镜像
  for (const rec of all) {
    if (gen !== idbState.gen) return;  // 每条写 mem 前再确认一次：被退登打断就整批丢弃
    if (!rec || typeof rec !== 'object') continue;
    const key = String(rec.key || '');
    if (!key.startsWith('msg:')) continue;
    const sid = key.slice(4);
    if (!sid) continue;
    if (rec.at && !idbState.msgAt.has(sid)) idbState.msgAt.set(sid, Number(rec.at) || 0);
    if (!idbState.memMsgs.has(sid) && Array.isArray(rec.messages)) {
      idbState.memMsgs.set(sid, { at: Number(rec.at) || 0, lastSeq: Number(rec.lastSeq) || 0, messages: rec.messages });
    }
  }
}

// 在给定连接上清空 store（一笔事务）；退登打断初始化时也用它

function idbClearConn(conn) {
  return new Promise((resolve) => {
    if (!conn) return resolve(false);
    let tx;
    try { tx = conn.transaction(IDB_STORE, 'readwrite'); } catch (e) { return resolve(false); }
    try { tx.objectStore(IDB_STORE).clear(); } catch {}
    tx.oncomplete = () => resolve(true);
    tx.onabort = () => resolve(false);
    tx.onerror = () => resolve(false);
  });
}

// 退登打断了这次初始化：收拾自己那条连接；只有确认没有「更新的一次 init」接手时，
// 才复位内存镜像和代数（否则会清掉新账号刚建立的状态，b-fast 场景）。

async function idbAbortAndClear(conn, gen, token) {
  if (conn && (!idbState.initToken || idbState.initToken === token)) {
    await idbClearConn(conn);
  }
  if (conn) { try { conn.close(); } catch {} }
  // await 期间可能已经有新的 init 接手：那就只关自己的连接，别动它
  if (idbState.initToken && idbState.initToken !== token) return false;
  idbState.gen++;
  idbState.initToken = null;
  idbState.initP = null;
  idbState.ready = false;
  idbState.db = null;
  idbState.memList = null;
  idbState.memMsgs.clear();
  idbState.msgAt.clear();
  return false;
}


async function idbInit() {
  if (!CACHE_V2) return false;                 // 回退开关 = '0'：连库都不开，零开销
  if (idbState.initP) return idbState.initP;
  // 上次退登没清成库（连接还没开）或者中间重载过页面：持久标记要求这次「先清再读」
  try { if (localStorage.getItem(CACHE_V2_WIPE_KEY) === '1') idbState.clearPending = true; } catch {}
  const gen = idbState.gen;                    // 记下代数：退登会让它 +1，在飞的任务据此自废
  const token = {};                            // 本次 init 的身份：被更新的 init 覆盖后，旧 init 知道自己已被接手
  idbState.initToken = token;
  const alive = () => gen === idbState.gen;
  idbState.initP = (async () => {
    let db = null;
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('indexedDB 不存在');
      db = await idbOpenDb();
      if (!alive()) return await idbAbortAndClear(db, gen, token);
      idbState.db = db;
      db.onversionchange = () => {
        try { db.close(); } catch {}
        if (idbState.db === db) idbState.db = null;
        idbState.ready = false;
        idbWarn('IndexedDB 被要求升级/关闭，本次会话回落 localStorage');
      };
      // 退登留下的「待清」：先清空磁盘 + 内存镜像，成功之后才允许读 idx/list。
      // 清失败就保持 clearPending 并 warn，本次直接不读旧数据（宁可没有缓存，也不能串账号）。
      if (idbState.clearPending) {
        const cleared = await idbClearConn(db);
        if (!alive()) return await idbAbortAndClear(db, gen, token);
        if (!cleared) {
          idbState.ready = false;
          idbState.db = null;
          idbState.initP = null;
          try { db.close(); } catch {}
          idbWarn('清 IndexedDB 失败，保留待清标记，本次不读旧缓存');
          return false;
        }
        idbState.memList = null;
        idbState.memMsgs.clear();
        idbState.msgAt.clear();
        idbState.clearPending = false;
        try { localStorage.removeItem(CACHE_V2_WIPE_KEY); } catch {}
      }
      // schema 不兼容：整库清掉（跟 localStorage 那边同一规则），也不再把旧结构迁进来
      let idx = null;
      try { idx = await idbGet('idx'); } catch {}
      if (!alive()) return await idbAbortAndClear(db, gen, token);
      if (idx && idx.schema !== CACHE_SCHEMA) {
        await idbTx([{ type:'clear' }]);
        idbState.msgAt.clear(); idbState.memMsgs.clear(); idbState.memList = null;
        try { localStorage.setItem(CACHE_V2_MIGRATED_KEY, '1'); } catch {}
      } else if (idx && idx.msgAt && typeof idx.msgAt === 'object') {
        for (const sid of Object.keys(idx.msgAt)) idbState.msgAt.set(String(sid), Number(idx.msgAt[sid]) || 0);
      }
      try { await idbMigrateOnce(gen); } catch (e) { if (alive()) idbWarn('迁移旧缓存失败（下次启动再试）', e); }
      if (!alive()) return await idbAbortAndClear(db, gen, token);
      const list = await idbGet('list');
      if (!alive()) return await idbAbortAndClear(db, gen, token);
      if (list && Array.isArray(list.sessions)) idbState.memList = list.sessions;
      idbState.ready = true;
      idbState.hydrateP = idbHydrateMsgs(gen).catch(e => idbWarn('预热消息缓存失败', e));
      return true;
    } catch (e) {
      if (alive()) {
        idbState.db = null; idbState.ready = false;
        if (!idbState.failed) { idbState.failed = true; idbWarn('IndexedDB 不可用，自动回落 localStorage（不弹提示）', e); }
        // 别把已 resolve 的 promise 留在 initP 里：退登后同页重登 / 下次调用还要能重新起库
        idbState.initP = null;
        idbState.initToken = null;
      }
      if (db) { try { db.close(); } catch {} }
      return false;
    }
  })();
  return idbState.initP;
}

// b-fast：重登后同一 tick 就刷列表/开会话时库还没 ready，把这次写挂到 initP 上补一次（只补一次，不递归）
// 补写时必须确认代数没变：退登/换账号后，旧账号的数据只能丢掉，绝不能等库起来再写进去

function idbQueueUntilReady(fn) {
  if (!CACHE_V2 || idbState.ready || !idbState.initP) return;
  const gen = idbState.gen;
  idbState.initP.then(() => {
    if (gen !== idbState.gen) return;
    if (idbUsable()) fn();
  }).catch(() => {});
}

function idbSaveList(slim) {
  if (idbUsable()) return idbSaveListNow(slim);
  idbQueueUntilReady(() => idbSaveListNow(slim));
}

function idbSaveListNow(slim) {
  idbState.memList = slim;
  idbWrite([{ type:'put', key:'list', value:{ key:'list', at: Date.now(), sessions: slim } }], 'list');
}
// 一个会话一笔事务：put 正文 + idx +（超 30 个会话时）删最旧的

function idbSaveMsg(sid, messages, lastSeq) {
  if (idbUsable()) return idbSaveMsgNow(sid, messages, lastSeq);
  idbQueueUntilReady(() => idbSaveMsgNow(sid, messages, lastSeq));
}

function idbSaveMsgNow(sid, messages, lastSeq) {
  const at = Date.now();
  const key = 'msg:' + sid;
  idbState.memMsgs.set(sid, { at, lastSeq, messages });
  idbState.msgAt.set(sid, at);
  const drops = [];
  if (idbState.msgAt.size > IDB_LIMITS.sessions) {
    const keep = [...idbState.msgAt.entries()].sort((a, b) => (b[1] || 0) - (a[1] || 0)).slice(0, IDB_LIMITS.sessions);
    const keepSet = new Set(keep.map(x => x[0]));
    // 同一毫秒写入多个会话时排序可能并列：当前会话必须保住，别把自己刚写的删了
    if (!keepSet.has(sid)) {
      const last = keep[keep.length - 1];
      if (last && last[0] !== sid) keepSet.delete(last[0]);
      keepSet.add(sid);
    }
    for (const k of [...idbState.msgAt.keys()]) if (!keepSet.has(k)) drops.push(k);
    for (const k of drops) { idbState.msgAt.delete(k); idbState.memMsgs.delete(k); }
  }
  const ops = [{ type:'put', key, value:{ key, at, lastSeq, messages } }];
  for (const k of drops) ops.push({ type:'del', key:'msg:' + k });
  ops.push({ type:'put', key:'idx', value: idbIdxValue() });
  idbWrite(ops, key);
}

function idbPrefetchMsg(sid) {
  if (!idbUsable() || idbState.memMsgs.has(sid) || idbState.prefetching.has(sid)) return;
  const gen = idbState.gen;
  idbState.prefetching.add(sid);
  idbGet('msg:' + sid).then(rec => {
    if (gen !== idbState.gen) return;   // 退登/换账号过：这份结果作废，别灌进内存镜像
    if (!rec || !Array.isArray(rec.messages) || idbState.memMsgs.has(sid)) return;
    idbState.memMsgs.set(sid, { at: Number(rec.at) || 0, lastSeq: Number(rec.lastSeq) || 0, messages: rec.messages });
  }).catch(() => {}).then(() => idbState.prefetching.delete(sid));
}

// 退登时把 UI 层里跟旧账号/旧会话相关的状态一起清掉：不能等下一次 refreshAll，
// 否则网络回来前列表/会话还在显示旧账号内容（跨账号残留）。

function resetClientCachesForLogout() {
  try { state.live?.close(); } catch {}
  if (state.poll) { try { clearInterval(state.poll); } catch {} }
  state.live = null; state.poll = null;
  state.sessions = []; state.workspaces = [];
  state.sessionId = null; state.sessionTitle = ''; state.sessionCwd = '';
  state.messages = []; state.cards = []; state.queue = []; state.pending = [];
  state.lastSeq = 0; state.unseen = 0; state.busy = false; state.busySince = 0;
  state.msgLimit = 120;
  state.foreign = new Map();
  state.archived = null; state.archivedError = '';
  state.searchQ = ''; state.searchItems = null;
  state.gitWs = ''; state.gitData = null; state.gitTitle = '';
}

// 退登：localStorage 一直是一把清，现在消息正文还多了一份在 IDB，必须一起清
// （否则换账号后重启就能读到上一个账号的消息）。
// 同时把「启动状态 + 判重状态 + UI 状态」全部复位：否则同一页里用恢复链接/配对码重登时，
// 旧的 initP 会被 idbInit() 永远返回、msgCacheSig 会挡住重写、列表还挂着旧账号标题。
// 连接可能还没开（open pending）：这时清不了库，留一个持久「待清」标记，拿到连接后先清再读。

function clearLocalCaches() {
  try { localStorage.clear(); } catch {}
  try { localStorage.setItem(CACHE_V2_WIPE_KEY, '1'); } catch {}
  const db = idbState.db;
  idbState.gen++;                       // 在飞的初始化/迁移/预热看到代数变了就自废
  idbState.initToken = null;            // 让旧 init 知道自己已被接手
  idbState.initP = null;                // 允许同页重登时重新起库
  idbState.hydrateP = null;
  idbState.clearPending = true;         // 即使 db 为 null 也要记住「库还没清」
  idbState.failed = false;
  idbState.ready = false;
  idbState.db = null;
  idbState.memList = null;
  idbState.memMsgs.clear();
  idbState.msgAt.clear();
  idbState.prefetching.clear();
  msgCacheSig = '';                     // 判重状态也清：重登后同样内容要能重新写进两份缓存
  resetClientCachesForLogout();
  if (!db) return;
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).clear();
  } catch {}
  try { db.close(); } catch {}          // close 会等这笔 clear 事务跑完才真正关闭
}


function legacySaveListCache(sessions) {
  let slim = null;
  try {
    slim = sessions.slice(0, 80).map(s => ({
      sessionId: s.sessionId, title: s.title, running: s.running, updatedAt: s.updatedAt,
      workspaceId: s.workspaceId, cwd: s.cwd, lastMessage: s.lastMessage || null,
    }));
    localStorage.setItem(CACHE_KEYS.list, JSON.stringify({ at: Date.now(), sessions: slim }));
  } catch {}
  return slim;   // 顺手把同一份裁剪结果给 v2 复用
}

function legacyReadListCache() {
  try {
    const j = JSON.parse(localStorage.getItem(CACHE_KEYS.list) || 'null');
    return j && Array.isArray(j.sessions) ? j.sessions : null;
  } catch { return null; }
}

// ---- 对外：会话列表 ----

function saveListCache(sessions) {
  const slim = legacySaveListCache(sessions);
  if (!CACHE_V2 || !slim) return;
  // 库没 ready 时由 idbSaveList 自己挂到 initP 上补写（b-fast），这里不再提前 return
  try { idbSaveList(slim); } catch (e) { idbWarn('保存列表缓存失败', e); }
}

function readListCache() {
  if (CACHE_V2 && idbState.ready) return idbState.memList ? idbState.memList.slice() : null;
  return legacyReadListCache();
}


function legacySaveMsgCache(sid, messages, lastSeq) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEYS.msgs) || '{}');
    let keep = messages.slice(-120);
    // 体积兜底：太大就只留最后 40 条
    while (keep.length > 40 && JSON.stringify(keep).length > 300000) keep = keep.slice(-Math.floor(keep.length * 0.6));
    all[sid] = { at: Date.now(), lastSeq, messages: keep };
    const keys = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
    for (const k of keys.slice(10)) delete all[k];
    localStorage.setItem(CACHE_KEYS.msgs, JSON.stringify(all));
  } catch {}
}

function legacyReadMsgCache(sid) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEYS.msgs) || '{}');
    return all[sid] || null;
  } catch { return null; }
}


let msgCacheSig = '';
// ---- 对外：消息 ----

function saveMsgCache(sid, messages, lastSeq) {
  if (!sid || !messages || !messages.length) return;
  // 只在内容真变了才写，避免每 4 秒轮询都写一次（IDB 写也共用这个判重）
  const sig = `${sid}:${messages.length}:${lastSeq}:${messages[messages.length - 1] && messages[messages.length - 1].id}`;
  if (sig === msgCacheSig) return;
  msgCacheSig = sig;
  legacySaveMsgCache(sid, messages, lastSeq);          // 影子写：回滚开关后立刻可用
  if (!CACHE_V2) return;
  // 库没 ready 时由 idbSaveMsg 自己挂到 initP 上补写（b-fast），这里不再提前 return
  try { idbSaveMsg(sid, messages.slice(-IDB_LIMITS.msgsPerSession), lastSeq); }
  catch (e) { idbWarn('保存消息缓存失败', e); }
}

function readMsgCache(sid) {
  if (CACHE_V2 && idbState.ready) {
    const rec = idbState.memMsgs.get(sid);
    if (rec && Array.isArray(rec.messages) && rec.messages.length) {
      // 返回数组副本：调用方会往 state.messages 里 push 临时消息，别写脏内存镜像
      return { at: rec.at, lastSeq: rec.lastSeq, messages: rec.messages.slice() };
    }
    idbPrefetchMsg(sid);   // 还没进内存镜像：后台补一次，下次打开就能秒开
    return null;
  }
  return legacyReadMsgCache(sid);
}
// 默认开启时早点开始开库/迁移，跟启动流程并行（await 在启动段）；退登后由登录路径重新触发

export { clearLocalCaches, idbInit, idbState, readListCache, readMsgCache, saveListCache, saveMsgCache };
