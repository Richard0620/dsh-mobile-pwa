import { onFrame } from './bus.js';
import { state } from './state.js';
import { apiUrl } from './api.js';

function openStream(path, { onFrame, onState }) {
  const ac = new AbortController();
  let stopped = false, retry = 3000;
  (async () => {
    while (!stopped) {
      try {
        const res = await fetch(apiUrl(path), {
          headers: {
            authorization: `Bearer ${state.token}`,
            accept: 'text/event-stream',
            ...(state.instanceId ? { 'x-dsh-instance': state.instanceId } : {}),
          },
          signal: ac.signal,
        });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        onState?.('open');
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
            let data = '';
            for (const line of raw.split('\n')) {
              if (line.startsWith('data:')) data += line.slice(5).trim();
              else if (line.startsWith('retry:')) { const n = +line.slice(6).trim(); if (n > 0) retry = n; }
            }
            if (!data) continue;
            try { onFrame(JSON.parse(data)); } catch {}
          }
        }
        throw new Error('closed');
      } catch (e) {
        if (stopped) break;
        console.warn('[stream]', path, '→', e && (e.message || e.name || e));
        onState?.('closed', e);
        await new Promise(r => setTimeout(r, retry));
      }
    }
  })();
  return { close(){ stopped = true; ac.abort(); onState?.('closed'); } };
}

// ---------------------------------------------------------------- 渲染入口

// 渲染崩溃兜底：至少让用户看到原因 + 一个能点的地方，而不是白屏

export { openStream };
