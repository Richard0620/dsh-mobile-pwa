import test from 'node:test';
import assert from 'node:assert/strict';
import { esc, hl, hlFamily, inlineMd, mdToHtml } from '../src/core/markdown.js';

test('esc escapes HTML special characters', () => {
  assert.equal(esc('<script>"a" & \'b\'</script>'), '&lt;script&gt;&quot;a&quot; &amp; \'b\'&lt;/script&gt;');
});

test('hlFamily whitelists known languages and rejects unknown/yaml/html', () => {
  assert.equal(hlFamily('js'), 'js');
  assert.equal(hlFamily('tsx'), 'js');
  assert.equal(hlFamily('json'), 'json');
  assert.equal(hlFamily('python'), 'py');
  assert.equal(hlFamily('bash'), 'sh');
  assert.equal(hlFamily('yaml'), '');
  assert.equal(hlFamily('html'), '');
  assert.equal(hlFamily(''), '');
});

test('hl highlights JS/JSON/sh safely without breaking plain text', () => {
  const jsOut = hl('const x = 42; // hi', 'js');
  assert.match(jsOut, /<span class="k">const<\/span>/);
  assert.match(jsOut, /<span class="n">42<\/span>/);
  assert.match(jsOut, /<span class="c">\/\/ hi<\/span>/);

  const yamlOut = hl('key: #not-a-comment', 'yaml');
  assert.equal(yamlOut, 'key: #not-a-comment');
});

test('inlineMd renders code, bold, italic, links and escapes HTML', () => {
  assert.equal(inlineMd('**bold** and `code`'), '<strong>bold</strong> and <code>code</code>');
  assert.match(inlineMd('[docs](https://example.com)'), /<a href="https:\/\/example\.com"/);
  assert.doesNotMatch(inlineMd('<img src=x onerror=alert(1)>'), /<img/);
});

test('mdToHtml renders headings, lists, blockquotes, and fenced code blocks', () => {
  const out = mdToHtml('# Title\n\n- item 1\n- item 2\n\n```js\nconst a = 1;\n```');
  assert.match(out, /<h1>Title<\/h1>/);
  assert.match(out, /<ul><li>item 1<\/li><li>item 2<\/li><\/ul>/);
  assert.match(out, /<pre class="code" data-lang="js"><code>/);
});
