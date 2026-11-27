import { paintProg } from '../core/bus.js';
import { SPEECH_AUTO_KEY, SPEECH_HOLD_KEY } from '../core/config.js';
import { state, ui } from '../core/state.js';
import { toast } from '../core/toast.js';
import { sheetIconSVG } from '../components/sheet.js';

function speechHoldOn() {
  try {
    const v = localStorage.getItem(SPEECH_HOLD_KEY);
    return v == null ? true : v === '1';   // 默认开；只有明确写 '0' 才算关
  } catch { return true; }
}

function setSpeechHold(v) { try { localStorage.setItem(SPEECH_HOLD_KEY, v ? '1' : '0'); } catch {} }

function speechAutoOn() { try { return localStorage.getItem(SPEECH_AUTO_KEY) === '1'; } catch { return false; } }

function setSpeechAuto(v) { try { localStorage.setItem(SPEECH_AUTO_KEY, v ? '1' : '0'); } catch {} }

function speechRecogCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function speechSynthOK() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    && typeof window.SpeechSynthesisUtterance === 'function';
}

const voiceState = { deniedShown: false };

let speakState = null;

let speechPrimed = false;
// iOS 要求第一次 speak 由用户手势触发；自动朗读没有手势，先在首次点按时用一条静音
// utterance 解锁（只在没有任何朗读时做，避免打断正在播的）。

function primeSpeech() {
  if (speechPrimed || !speechSynthOK() || state.speaking) return;
  speechPrimed = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    setTimeout(() => {
      try { if (!state.speaking && !speakState) window.speechSynthesis.cancel(); } catch {}
    }, 0);
  } catch {}
}

function splitSentences(text) {
  const s = String(text || '').replace(/\r/g, '').trim();
  if (!s) return [];
  const parts = s.split(/((?:[。！？!?]|\n)+)/);
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    const t = (parts[i] + (parts[i + 1] || '')).trim();
    if (t) out.push(t);
  }
  return out;
}
// 朗读不要把 markdown 符号念出来；代码块只播一句占位

function speechPlain(s) {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, ' 代码块 ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/[*_~|>]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


function speakBtnHtml(on) {
  const svg = sheetIconSVG(on ? 'square' : 'speaker');
  return (svg ? '<span class="ic">' + svg + '</span>' : '') + '<span class="lb">' + (on ? '停止朗读' : '朗读') + '</span>';
}


function syncSpeakButtons() {
  for (const b of document.querySelectorAll('[data-speak-mid]')) {
    const on = !!(state.speaking && state.speakMsgId === b.getAttribute('data-speak-mid'));
    b.innerHTML = speakBtnHtml(on);
  }
}


function stopSpeak() {
  if (!state.speaking && !speakState) return;
  speakState = null;
  state.speaking = false;
  state.speakIndex = 0;
  state.speakTotal = 0;
  state.speakMsgId = null;
  try { window.speechSynthesis.cancel(); } catch {}
  syncSpeakButtons();
  paintProg(true);
}


function nextSpeakChunk() {
  const st = speakState;
  if (!st) return;
  st.i++;
  if (st.i >= st.chunks.length) { stopSpeak(); return; }
  state.speakIndex = st.i + 1;
  paintProg(true);
  const u = new SpeechSynthesisUtterance(st.chunks[st.i]);
  u.lang = 'zh-CN';
  u.rate = 1;
  u.onend = () => { if (speakState === st) nextSpeakChunk(); };
  u.onerror = () => { if (speakState === st) stopSpeak(); };
  try { window.speechSynthesis.speak(u); } catch { stopSpeak(); }
}


function speakText(text, msgId) {
  if (!speechSynthOK()) { toast('这个浏览器不支持朗读'); return; }
  const chunks = splitSentences(speechPlain(text));
  if (!chunks.length) { toast('这条消息没有可朗读的文字'); return; }
  stopSpeak();
  speakState = { chunks, i: -1 };
  state.speaking = true;
  state.speakTotal = chunks.length;
  state.speakIndex = 1;
  state.speakMsgId = msgId == null ? null : String(msgId);
  syncSpeakButtons();
  paintProg(true);
  nextSpeakChunk();
}


function assistantSpeechBody(m) {
  if (!m || m.role === 'user') return '';
  const blocks = m.blocks || [];
  const txt = (m.text && m.text.trim())
    ? m.text
    : blocks.filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n');
  return String(txt || '').trim();
}
// 一轮结束后自动读最新一条回复（设置里默认关闭）

function autoReadLatest(items) {
  if (!speechSynthOK() || !speechAutoOn()) return;
  if (document.visibilityState !== 'visible') return;
  for (let i = (items || []).length - 1; i >= 0; i--) {
    const m = items[i];
    if (!m) continue;
    if (m.role === 'user') break;
    const body = assistantSpeechBody(m);
    if (body) { speakText(body, m.id); return; }
  }
}

// 切走 / 切后台时收掉还没松手的识别（录音不能带到别的会话）

function cancelVoiceInput() {
  const rec = state.rec;
  if (!rec) return;
  rec.cancelled = true;
  state.rec = null;
  try { rec.recog.abort(); } catch {}
  if (ui && ui.ta && typeof rec.base === 'string') { try { ui.ta.textContent = rec.base; } catch {} }
  if (ui && ui.voiceBar) ui.voiceBar.style.display = 'none';
  if (ui && ui.micBtn) ui.micBtn.classList.remove('on');
  try { ui && ui.syncInputButtons && ui.syncInputButtons(); } catch {}
  paintProg(true);
}

// 子代理目录刷新会重画父会话；用户不在底部时，重画不能把他弹回底部（否则打开子代理
// 面板那一下就把阅读位置丢了，返回时 openSubagentView 再快照到的已经是底部）。

export { autoReadLatest, cancelVoiceInput, primeSpeech, setSpeechAuto, setSpeechHold, speakBtnHtml, speakText, speechAutoOn, speechHoldOn, speechRecogCtor, speechSynthOK, stopSpeak, voiceState };
