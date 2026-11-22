// Mobile-emulation screenshot for the agents page (iPhone 16 Pro Max CSS metrics).
// Requires: npm i puppeteer-core (once, in this dir or via NODE_PATH).
// Must run from a normal PowerShell (outside the DSH sandbox: spawning Chrome is EPERM in sandbox).
// Usage:
//   $env:BRIDGE_TOKEN='...'; node agents/mobile-shot.mjs <url> <out.png>
// Defaults: embed view of pane w1:pK on the public URL, 440x956 @3x.
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TOKEN = process.env.BRIDGE_TOKEN || '';
const BASE = process.env.DSH_BASE || 'https://dsh.easymana.online:8443';
const URL = process.argv[2] || (BASE + '/agents/?embed=1&pane=' + (process.env.PANE || 'w1:pK') + '&v=' + Date.now());
const OUT = process.argv[3] || 'mobile-shot.png';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 440, height: 956, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
if (TOKEN) {
  await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('bridge_token', t); } catch {} }, TOKEN);
}
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise((r) => setTimeout(r, 4000));
await page.screenshot({ path: OUT });
const info = await page.evaluate(() => ({
  ver: (document.querySelector('.ver') || {}).textContent,
  panes: document.querySelectorAll('#paneList .row').length,
  chat: (document.querySelector('#chat') || {}).textContent?.slice(0, 160),
  viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
}));
console.log(JSON.stringify({ info, errors }, null, 2));
await browser.close();
