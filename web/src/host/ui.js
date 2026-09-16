// Small DOM helpers shared by the host screens.
export const $ = (id) => document.getElementById(id);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

export const SCREENS = ['signin', 'home', 'new', 'game', 'setup', 'question', 'penalty', 'strike', 'questions', 'settings', 'fixup', 'scoreboard', 'premium'];

let currentScreen = 'signin';
export const screen = () => currentScreen;

export function show(name) {
  currentScreen = name;
  for (const s of SCREENS) {
    const node = $(`screen-${s}`);
    if (node) node.hidden = s !== name;
  }
  window.scrollTo(0, 0);
}

/** Fill every [data-t] with the catalogue. Called after the language is known. */
export function applyStatic(t, root = document) {
  for (const node of root.querySelectorAll('[data-t]')) node.textContent = t(node.dataset.t);
}

export function toast(message, ms = 2600) {
  const node = el('div', 'toast', message);
  document.body.appendChild(node);
  setTimeout(() => node.remove(), ms);
}

/** Modal with confirm/cancel. Resolves true when confirmed. */
export function confirmModal(t, { title, body, confirmLabel, danger }) {
  return new Promise((resolve) => {
    const root = $('modal-root');
    const backdrop = el('div', 'modal-backdrop');
    const box = el('div', 'modal');
    box.appendChild(el('h3', null, title));
    if (body) box.appendChild(el('p', 'lede small', body));
    const row = el('div', 'row');
    const cancel = el('button', 'btn btn-quiet grow', t('action.cancel'));
    const ok = el('button', `btn grow ${danger ? 'btn-wrong' : 'btn-primary'}`, confirmLabel ?? t('action.confirm'));
    row.append(cancel, ok);
    box.appendChild(row);
    backdrop.appendChild(box);
    root.appendChild(backdrop);
    const close = (value) => { backdrop.remove(); resolve(value); };
    cancel.addEventListener('click', () => close(false));
    ok.addEventListener('click', () => close(true));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });
  });
}

export function timeAgo(t, iso) {
  if (!iso) return t('time.justNow');
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 5) return t('time.justNow');
  if (s < 60) return t('time.secondsAgo', { n: s });
  if (s < 3600) return t('time.minutesAgo', { n: Math.round(s / 60) });
  return t('time.hoursAgo', { n: Math.round(s / 3600) });
}

export function on(id, event, handler) {
  const node = $(id);
  if (node) node.addEventListener(event, handler);
  else console.warn('missing element', id);
}
