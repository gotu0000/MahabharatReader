// Reader configuration. Tweak in one place.
const CONFIG = {
  partCount: 10,
  fontSize: { min: 14, max: 28, default: 18 },
  defaultTheme: 'dark',
  topManifest: 'parts/index.json',
  partManifest: (n) => `parts/part-${pad2(n)}/index.json`,
  resolveUnderParts: (rel) => `parts/${rel}`,
  refs: {
    selector: '[data-ref]',
    keyOf: (el) => el.getAttribute('data-ref'),
    labelOf: (el) => el.textContent.trim() || el.getAttribute('data-ref'),
  },
};

const STORAGE = {
  theme: 'reader_theme',
  fontSize: 'reader_fontSize',
  lastParva: 'reader_lastParva',
  pos: (part, section) => `reader_pos_${pad2(part)}_${pad2(section)}`,
};

const state = {
  currentPart: null,
  currentSection: null,
  scrollSaveTimer: null,
};

const partManifests = new Map();
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

  const last = parseLastParva(localStorage.getItem(STORAGE.lastParva));
  if (last) {
    expandPart(last.part);
    loadParva(last.part, last.section);
  }
}

function parseLastParva(raw) {
  if (!raw) return null;
  const m = /^(\d{1,2})\/(\d{1,3})$/.exec(raw);
  if (!m) return null;
  const part = parseInt(m[1], 10);
  const section = parseInt(m[2], 10);
  if (!Number.isInteger(part) || part < 1 || part > CONFIG.partCount) return null;
  if (!Number.isInteger(section) || section < 1) return null;
  return { part, section };
}

function readStoredFontSize() {
  const raw = parseInt(localStorage.getItem(STORAGE.fontSize) || '', 10);
  if (!Number.isInteger(raw)) return CONFIG.fontSize.default;
  return Math.min(CONFIG.fontSize.max, Math.max(CONFIG.fontSize.min, raw));
}

function buildPartList() {
  const ul = $('partList');
  ul.innerHTML = '';
  for (let n = 1; n <= CONFIG.partCount; n++) {
    const li = document.createElement('li');
    li.className = 'part-item';
    li.dataset.part = String(n);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'part-toggle';
    btn.setAttribute('aria-expanded', 'false');

    const chevron = document.createElement('span');
    chevron.className = 'part-toggle__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    btn.appendChild(chevron);

    const label = document.createElement('span');
    label.className = 'part-toggle__label';
    label.textContent = `Part ${n}`;
    btn.appendChild(label);

    btn.addEventListener('click', () => togglePart(n));

    const sub = document.createElement('ul');
    sub.className = 'parva-list';
    sub.hidden = true;

    li.appendChild(btn);
    li.appendChild(sub);
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
  setSidebar(!sb.classList.contains('open'));
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

async function togglePart(n) {
  const item = document.querySelector(`.part-item[data-part="${n}"]`);
  if (!item) return;
  const btn = item.querySelector('.part-toggle');
  const list = item.querySelector('.parva-list');
  const open = btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', String(open));
  list.hidden = !open;
  if (open && !list.dataset.loaded) {
    list.dataset.loaded = '1';
    list.innerHTML = '<li class="parva-empty">Loading…</li>';
    const manifest = await getPartManifest(n);
    renderParvaList(list, n, manifest);
  }
}

async function expandPart(n) {
  const item = document.querySelector(`.part-item[data-part="${n}"]`);
  if (!item) return;
  const btn = item.querySelector('.part-toggle');
  if (btn.getAttribute('aria-expanded') === 'true') return;
  await togglePart(n);
}

function renderParvaList(list, partNum, manifest) {
  list.innerHTML = '';
  const sections = manifest && Array.isArray(manifest.sections) ? manifest.sections : [];
  if (sections.length === 0) {
    const li = document.createElement('li');
    li.className = 'parva-empty';
    li.textContent = 'Not yet available';
    list.appendChild(li);
    return;
  }
  for (const section of sections) {
    if (!Number.isInteger(section.number)) continue;
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.part = String(partNum);
    btn.dataset.section = String(section.number);
    const num = document.createElement('span');
    num.className = 'parva-list__num';
    num.textContent = String(section.number);
    const name = document.createElement('span');
    name.className = 'parva-list__name';
    name.textContent = section.parva || section.name || `Section ${section.number}`;
    btn.appendChild(num);
    btn.appendChild(name);
    btn.addEventListener('click', () => {
      loadParva(partNum, section.number);
      closeSidebar();
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
  if (state.currentPart === partNum && state.currentSection != null) {
    highlightActive(state.currentPart, state.currentSection);
  }
}

async function getPartManifest(n) {
  if (partManifests.has(n)) return partManifests.get(n);
  const url = CONFIG.partManifest(n);
  let data = null;
  try {
    const resp = await fetch(url, { cache: 'no-cache' });
    if (resp.ok) data = await resp.json();
  } catch {}
  partManifests.set(n, data);
  return data;
}

async function loadParva(part, section) {
  const content = $('content');
  hidePopup();
  state.currentPart = part;
  state.currentSection = section;
  localStorage.setItem(STORAGE.lastParva, `${pad2(part)}/${pad2(section)}`);
  highlightActive(part, section);

  const manifest = await getPartManifest(part);
  if (state.currentPart !== part || state.currentSection !== section) return;
  const sec = manifest && Array.isArray(manifest.sections)
    ? manifest.sections.find((s) => s.number === section)
    : null;
  if (!sec || !sec.html) {
    showNotAvailable(part, section);
    return;
  }

  content.innerHTML = '<p class="hint">Loading…</p>';
  let html;
  try {
    const resp = await fetch(CONFIG.resolveUnderParts(sec.html), { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    html = await resp.text();
  } catch {
    showNotAvailable(part, section);
    return;
  }
  if (state.currentPart !== part || state.currentSection !== section) return;

  content.innerHTML = html;
  restoreScroll(part, section);
  if (sec.refs) getRefsFor(part, section);
}

function showNotAvailable(part, section) {
  const content = $('content');
  content.innerHTML = `<p class="hint">Part ${part}, Section ${section} not yet available.</p>`;
  window.scrollTo(0, 0);
}

function restoreScroll(part, section) {
  const saved = parseFloat(localStorage.getItem(STORAGE.pos(part, section)) || '0');
  const frac = Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : 0;
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, max > 0 ? frac * max : 0);
  });
}

function onScroll() {
  if (state.currentPart == null || state.currentSection == null) return;
  if (state.scrollSaveTimer) return;
  state.scrollSaveTimer = setTimeout(() => {
    state.scrollSaveTimer = null;
    const part = state.currentPart;
    const section = state.currentSection;
    if (part == null || section == null) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const frac = max > 0 ? window.scrollY / max : 0;
    localStorage.setItem(STORAGE.pos(part, section), frac.toFixed(4));
  }, 250);
}

function highlightActive(part, section) {
  document.querySelectorAll('.part-item').forEach((item) => {
    const p = parseInt(item.dataset.part, 10);
    const isCurrent = p === part;
    const toggle = item.querySelector('.part-toggle');
    if (toggle) toggle.classList.toggle('part-toggle--current', isCurrent);
  });
  document.querySelectorAll('.parva-list button').forEach((b) => {
    const p = parseInt(b.dataset.part, 10);
    const s = parseInt(b.dataset.section, 10);
    b.classList.toggle('active', p === part && s === section);
  });
}

async function getRefsFor(part, section) {
  const key = `${part}/${section}`;
  if (refsCache.has(key)) return refsCache.get(key);
  const manifest = await getPartManifest(part);
  const sec = manifest && Array.isArray(manifest.sections)
    ? manifest.sections.find((s) => s.number === section)
    : null;
  if (!sec || !sec.refs) {
    refsCache.set(key, null);
    return null;
  }
  let data = null;
  try {
    const resp = await fetch(CONFIG.resolveUnderParts(sec.refs), { cache: 'no-cache' });
    if (resp.ok) data = await resp.json();
  } catch {}
  refsCache.set(key, data);
  return data;
}

async function handleRefClick(e) {
  const target = e.target.closest(CONFIG.refs.selector);
  if (!target) return;
  if (!$('content').contains(target)) return;
  const part = state.currentPart;
  const section = state.currentSection;
  if (part == null || section == null) return;
  e.preventDefault();
  const key = CONFIG.refs.keyOf(target);
  if (!key) return;
  const label = CONFIG.refs.labelOf(target);
  const refs = await getRefsFor(part, section);
  if (state.currentPart !== part || state.currentSection !== section) return;
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
  body.textContent = text || 'Reference not found in this parva.';
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
