import { el } from './dom.js';

function toast(msg, ms = 2200) {
  let t = document.querySelector('.toast');
  if (!t) { t = el('div', { class:'toast' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), ms);
}

export { toast };
