// 在 VPS 上跑：给所有已订阅设备发一条测试推送
// 用法：node /opt/dsh-push/send-test.mjs [title] [body] [badge]
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('/etc/dsh-push.env', 'utf8')
    .split('\n')
    .filter(l => l && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }),
);

const health = await (await fetch('http://127.0.0.1:18789/push/healthz')).json();
console.log('订阅数:', health.subs);

const [title, body, badge] = process.argv.slice(2);
const payload = {
  title: title || 'DSH 推送测试',
  body: body || '这条是从美国 VPS 发出来的。收到说明订阅、VAPID、SW 全部打通。',
  badge: Number(badge || 3),
  tag: 'test-' + Date.now(),
  kind: 'test',
};

const r = await fetch('http://127.0.0.1:18789/push/notify', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-push-secret': env.PUSH_SECRET },
  body: JSON.stringify(payload),
});
console.log('notify ->', r.status, await r.text());
