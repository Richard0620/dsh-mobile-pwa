import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKeyOf, fmtBytes, fmtDayLabel, mimeOfName, plain } from '../src/core/format.js';
import { splitAttachmentNotes } from '../src/features/media.js';
import { snippetAround } from '../src/features/search.js';

test('fmtBytes formats B / KB / MB', () => {
  assert.equal(fmtBytes(512), '512B');
  assert.equal(fmtBytes(2048), '2.0KB');
  assert.equal(fmtBytes(5 * 1024 * 1024), '5.0MB');
});

test('mimeOfName returns expected MIME types', () => {
  assert.equal(mimeOfName('demo.mp4'), 'video/mp4');
  assert.equal(mimeOfName('doc.pdf'), 'application/pdf');
  assert.equal(mimeOfName('photo.webp'), 'image/webp');
  assert.equal(mimeOfName('unknown.bin'), 'application/octet-stream');
});

test('plain strips markdown syntax for list preview', () => {
  assert.equal(plain('**Hello** `world` [link](https://a.b)'), 'Hello world link');
});

test('dayKeyOf and fmtDayLabel handle today/yesterday', () => {
  const now = Date.now();
  assert.equal(fmtDayLabel(now), '今天');
  assert.equal(fmtDayLabel(now - 86400_000), '昨天');
  assert.match(dayKeyOf(now), /^\d{4}-\d{1,2}-\d{1,2}$/);
});

test('splitAttachmentNotes extracts uploaded file/video cards and @"path" refs', () => {
  const text = '看下这个视频\n🎬 已上传视频：D:/Vibe/PWA/_uploads/clip.mp4\n@"D:/Vibe/PWA/README.md"';
  const res = splitAttachmentNotes(text);
  assert.equal(res.text, '看下这个视频');
  assert.deepEqual(res.files, ['D:/Vibe/PWA/_uploads/clip.mp4', 'D:/Vibe/PWA/README.md']);
});

test('snippetAround returns context around matched query', () => {
  const text = '这是一段很长的中文测试文本，里面包含一个关键词部署脚本用于验证搜索摘要';
  const q = '部署脚本';
  const s = snippetAround(text, text.indexOf(q), q);
  assert.ok(s.includes(q));
});
