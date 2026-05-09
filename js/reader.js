// Reader configuration. Phase 2/3 will read more from here.
const CONFIG = {
  partCount: 10,
  fontSize: { min: 14, max: 28, default: 18 },
  defaultTheme: 'dark',
  refs: {
    selector: '[data-ref]',
    path: (n) => `parts/refs/part-${pad2(n)}.json`,
    keyOf: (el) => el.getAttribute('data-ref'),
    labelOf: (el) => el.textContent.trim() || el.getAttribute('data-ref'),
  },
};

const STORAGE = {
  theme: 'reader_theme',
  fontSize: 'reader_fontSize',
  lastPart: 'reader_lastPart',
  pos: (n) => `reader_pos_part_${pad2(n)}`,
};

const state = {
  currentPart: null,
  scrollSaveTimer: null,
};

const refsCache = new Map();
const popup = {
  el: null,
  prevFocus: null,
  outsideHandler: null,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function $(id) {
  return document.getElementById(id);
}

document.addEventListener('DOMContentLoaded', init);

function init() {
  applyTheme(localStorage.getItem(STORAGE.theme) || CONFIG.defaultTheme);
  applyFontSize(readStoredFontSize());
  buildPartList();
  wireUI();

  const last = parseInt(localStorage.getItem(STORAGE.lastPart) || '', 10);
  if (Number.isInteger(last) && last >= 1 && last <= CONFIG.partCount) {
    loadPart(last);
  }
}

function readStoredFontSize() {
  const raw = parseInt(localStorage.getItem(STORAGE.fontSize) || '', 10);
  if (!Number.isInteger(raw)) return CONFIG.fontSize.default;
  return Math.min(CONFIG.fontSize.max, Math.max(CONFIG.fontSize.min, raw));
}

function buildPartList() {
  const ul = $('partList');
  for (let n = 1; n <= CONFIG.partCount; n++) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `Part ${n}`;
    btn.dataset.part = String(n);
    btn.addEventListener('click', () => {
      loadPart(n);
      closeSidebar();
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function wireUI() {
  $('sidebarToggle').addEventListener('click', toggleSidebar);
  $('overlay').addEventListener('click', closeSidebar);

  $('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || CONFIG.defaultTheme;
    const next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem(STORAGE.theme, next);
  });

  const slider = $('fontSize');
  slider.min = String(CONFIG.fontSize.min);
  slider.max = String(CONFIG.fontSize.max);
  slider.value = String(readStoredFontSize());

  let pendingFontSize = null;
  let fontSizeRaf = 0;
  let fontSizeSaveTimer = null;
  slider.addEventListener('input', () => {
    pendingFontSize = parseInt(slider.value, 10);
    if (!fontSizeRaf) {
      fontSizeRaf = requestAnimationFrame(() => {
        fontSizeRaf = 0;
        if (pendingFontSize != null) applyFontSize(pendingFontSize);
      });
    }
    if (fontSizeSaveTimer) clearTimeout(fontSizeSaveTimer);
    fontSizeSaveTimer = setTimeout(() => {
      fontSizeSaveTimer = null;
      if (pendingFontSize != null) {
        localStorage.setItem(STORAGE.fontSize, String(pendingFontSize));
      }
    }, 250);
  });

  window.addEventListener('scroll', onScroll, { passive: true });

  $('content').addEventListener('click', handleRefClick);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (popup.el && !popup.el.hidden) {
      hidePopup();
    } else {
      closeSidebar();
    }
  });
}

function applyTheme(t) {
  const theme = t === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#fafaf7' : '#1a1a1a');
  const btn = $('themeToggle');
  if (btn) btn.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
}

function applyFontSize(px) {
  document.documentElement.style.setProperty('--font-size', px + 'px');
}

function toggleSidebar() {
  const sb = $('sidebar');
  const open = !sb.classList.contains('open');
  setSidebar(open);
}

function closeSidebar() {
  setSidebar(false);
}

function setSidebar(open) {
  const sb = $('sidebar');
  sb.classList.toggle('open', open);
  $('overlay').hidden = !open;
  $('sidebarToggle').setAttribute('aria-expanded', String(open));
  $('sidebarToggle').setAttribute('aria-label', open ? 'Close parts list' : 'Open parts list');
}

async function loadPart(n) {
  const id = pad2(n);
  const url = `parts/part-${id}.html`;
  const content = $('content');

  hidePopup();
  state.currentPart = n;
  localStorage.setItem(STORAGE.lastPart, String(n));
  highlightActive(n);

  content.innerHTML = '<p class="hint">Loading…</p>';

  let html;
  try {
    const resp = await fetch(url, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    html = await resp.text();
  } catch (err) {
    content.innerHTML = `<p class="hint">Part ${n} not yet available.</p>`;
    window.scrollTo(0, 0);
    return;
  }

  content.innerHTML = html;
  restoreScroll(n);
  getRefs(n);
}

function restoreScroll(n) {
  const saved = parseFloat(localStorage.getItem(STORAGE.pos(n)) || '0');
  const frac = Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : 0;
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, max > 0 ? frac * max : 0);
  });
}

function onScroll() {
  if (!state.currentPart) return;
  if (state.scrollSaveTimer) return;
  state.scrollSaveTimer = setTimeout(() => {
    state.scrollSaveTimer = null;
    const part = state.currentPart;
    if (!part) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const frac = max > 0 ? window.scrollY / max : 0;
    localStorage.setItem(STORAGE.pos(part), frac.toFixed(4));
  }, 250);
}

function highlightActive(n) {
  document.querySelectorAll('#partList button').forEach((b) => {
    b.classList.toggle('active', parseInt(b.dataset.part, 10) === n);
  });
}

async function getRefs(n) {
  if (refsCache.has(n)) return refsCache.get(n);
  const url = CONFIG.refs.path(n);
  let data = null;
  try {
    const resp = await fetch(url, { cache: 'no-cache' });
    if (resp.ok) data = await resp.json();
  } catch {}
  refsCache.set(n, data);
  return data;
}

async function handleRefClick(e) {
  const target = e.target.closest(CONFIG.refs.selector);
  if (!target) return;
  if (!$('content').contains(target)) return;
  const part = state.currentPart;
  if (!part) return;
  e.preventDefault();
  const key = CONFIG.refs.keyOf(target);
  if (!key) return;
  const label = CONFIG.refs.labelOf(target);
  const refs = await getRefs(part);
  if (state.currentPart !== part) return;
  const text = refs && refs[key] ? refs[key] : null;
  showRefPopup(target, label, text);
}

function ensurePopup() {
  if (popup.el) return popup.el;
  const el = document.createElement('div');
  el.className = 'popup';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');
  el.setAttribute('tabindex', '-1');
  el.hidden = true;
  document.body.appendChild(el);
  popup.el = el;
  return el;
}

function showRefPopup(anchor, label, text) {
  const el = ensurePopup();
  if (popup.outsideHandler) {
    document.removeEventListener('pointerdown', popup.outsideHandler);
    popup.outsideHandler = null;
  }
  el.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'popup__title';
  title.textContent = `Note ${label}`;
  const body = document.createElement('p');
  body.className = 'popup__body';
  body.textContent = text || 'Reference not found in this part.';
  el.appendChild(title);
  el.appendChild(body);
  el.setAttribute('aria-label', `Note ${label}`);

  popup.prevFocus = document.activeElement;
  el.hidden = false;
  positionPopup(el, anchor);
  requestAnimationFrame(() => el.classList.add('show'));
  el.focus({ preventScroll: true });

  setTimeout(() => {
    popup.outsideHandler = (ev) => {
      if (el.contains(ev.target)) return;
      if (ev.target.closest && ev.target.closest(CONFIG.refs.selector)) return;
      hidePopup();
    };
    document.addEventListener('pointerdown', popup.outsideHandler);
  }, 0);

  window.addEventListener('scroll', hidePopup, { passive: true, once: true });
}

function positionPopup(el, anchor) {
  const margin = 8;
  const rect = anchor.getBoundingClientRect();
  el.style.maxWidth = Math.min(280, window.innerWidth - margin * 2) + 'px';
  el.style.left = '0px';
  el.style.top = '0px';
  const pw = el.offsetWidth;
  const ph = el.offsetHeight;

  let left = rect.left + (rect.width / 2) - (pw / 2);
  left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));

  let top = rect.bottom + 6;
  if (top + ph + margin > window.innerHeight) {
    const above = rect.top - ph - 6;
    if (above >= margin) top = above;
  }

  el.style.left = (left + window.scrollX) + 'px';
  el.style.top = (top + window.scrollY) + 'px';
}

function hidePopup() {
  if (!popup.el || popup.el.hidden) return;
  const el = popup.el;
  el.classList.remove('show');
  setTimeout(() => { el.hidden = true; }, 120);

  if (popup.outsideHandler) {
    document.removeEventListener('pointerdown', popup.outsideHandler);
    popup.outsideHandler = null;
  }

  const prev = popup.prevFocus;
  popup.prevFocus = null;
  if (prev && typeof prev.focus === 'function') {
    try { prev.focus({ preventScroll: true }); } catch {}
  }
}
