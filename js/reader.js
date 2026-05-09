// Reader configuration. Phase 2/3 will read more from here.
const CONFIG = {
  partCount: 10,
  fontSize: { min: 14, max: 28, default: 18 },
  defaultTheme: 'dark',
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
  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10);
    applyFontSize(v);
    localStorage.setItem(STORAGE.fontSize, String(v));
  });

  window.addEventListener('scroll', onScroll, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
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
