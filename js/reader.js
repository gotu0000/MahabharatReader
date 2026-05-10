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
  pageIndicatorRaf: 0,
  pageIndicatorHideTimer: 0,
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
  } else {
    renderHome();
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

  const homeLi = document.createElement('li');
  homeLi.className = 'part-list__home';
  const homeBtn = document.createElement('button');
  homeBtn.type = 'button';
  homeBtn.className = 'home-link';
  const homeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  homeIcon.setAttribute('class', 'home-link__icon');
  homeIcon.setAttribute('viewBox', '0 0 24 24');
  homeIcon.setAttribute('fill', 'none');
  homeIcon.setAttribute('stroke', 'currentColor');
  homeIcon.setAttribute('stroke-width', '2');
  homeIcon.setAttribute('stroke-linecap', 'round');
  homeIcon.setAttribute('stroke-linejoin', 'round');
  homeIcon.setAttribute('aria-hidden', 'true');
  homeIcon.innerHTML = '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9h14v-9"/>';
  const homeLabel = document.createElement('span');
  homeLabel.textContent = 'Home';
  homeBtn.appendChild(homeIcon);
  homeBtn.appendChild(homeLabel);
  homeBtn.addEventListener('click', () => {
    goHome();
    closeSidebar();
  });
  homeLi.appendChild(homeBtn);
  ul.appendChild(homeLi);

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
        if (pendingFontSize != null) {
          applyFontSize(pendingFontSize);
          updatePageIndicator();
          showPageIndicator();
        }
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
  window.addEventListener('resize', () => {
    updatePageIndicator();
  });

  $('content').addEventListener('click', handleRefClick);

  $('reader').addEventListener('pointerdown', (e) => {
    if (e.target.closest('.page-indicator, .jump-popup')) return;
    showPageIndicator();
  }, { passive: true });

  $('pageIndicator').addEventListener('click', openJumpPopup);
  $('jumpForm').addEventListener('submit', (e) => {
    e.preventDefault();
    submitJump();
  });
  $('jumpPopup').addEventListener('click', (e) => {
    if (e.target.closest('[data-jump-close]')) closeJumpPopup();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const jp = $('jumpPopup');
    if (jp && !jp.hidden) {
      closeJumpPopup();
    } else if (popup.el && !popup.el.hidden) {
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
  if (open) refreshProgressBadges();
}

function refreshProgressBadges() {
  document.querySelectorAll('.parva-list button').forEach((btn) => {
    const badge = btn.querySelector('.parva-list__badge');
    if (!badge) return;
    const part = parseInt(btn.dataset.part, 10);
    const section = parseInt(btn.dataset.section, 10);
    updateProgressBadge(badge, part, section);
  });
}

function updateProgressBadge(badge, part, section) {
  const raw = parseFloat(localStorage.getItem(STORAGE.pos(part, section)) || '');
  const frac = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
  if (frac < 0.01) {
    badge.textContent = '';
    badge.hidden = true;
    badge.removeAttribute('aria-label');
    return;
  }
  const pct = Math.round(frac * 100);
  if (pct >= 99) {
    badge.textContent = '✓';
    badge.setAttribute('aria-label', 'Read');
  } else {
    badge.textContent = `${pct}%`;
    badge.setAttribute('aria-label', `${pct} percent read`);
  }
  badge.hidden = false;
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
    li.textContent = 'Coming soon';
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
    const badge = document.createElement('span');
    badge.className = 'parva-list__badge';
    badge.hidden = true;
    updateProgressBadge(badge, partNum, section.number);
    btn.appendChild(num);
    btn.appendChild(name);
    btn.appendChild(badge);
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
  clearParvaNav();
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
    showNotAvailable(part, section, manifest);
    return;
  }

  content.innerHTML = '<p class="hint">Loading…</p>';
  let html;
  try {
    const resp = await fetch(CONFIG.resolveUnderParts(sec.html), { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    html = await resp.text();
  } catch {
    showNotAvailable(part, section, manifest);
    return;
  }
  if (state.currentPart !== part || state.currentSection !== section) return;

  content.innerHTML = html;
  updateHeader({
    title: sec.parva || sec.name || `Section ${section}`,
    meta: `Part ${part} · ${manifest.sections.indexOf(sec) + 1} of ${manifest.sections.length}`,
  });
  renderParvaNav(part, section, manifest);
  restoreScroll(part, section);
  enablePageIndicator();
  requestAnimationFrame(() => {
    updatePageIndicator();
    showPageIndicator();
  });
  if (sec.refs) getRefsFor(part, section);
}

function showNotAvailable(part, section, manifest) {
  closeJumpPopup();
  disablePageIndicator();
  const content = $('content');
  content.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'coming-soon-card';

  const heading = document.createElement('h2');
  heading.className = 'coming-soon-card__title';
  heading.textContent = 'Coming soon';
  card.appendChild(heading);

  const body = document.createElement('p');
  body.className = 'coming-soon-card__body';
  const hasManifest = manifest && Array.isArray(manifest.sections);
  body.textContent = hasManifest
    ? `Part ${part}, Section ${section} hasn't been added to the reader yet.`
    : `Part ${part} hasn't been added to the reader yet.`;
  card.appendChild(body);

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'coming-soon-card__back';
  back.textContent = '← Back to home';
  back.addEventListener('click', goHome);
  card.appendChild(back);

  content.appendChild(card);

  updateHeader({ title: 'Coming soon', meta: `Part ${part} · Section ${section}` });
  if (hasManifest) {
    renderParvaNav(part, section, manifest);
  } else {
    clearParvaNav();
  }
  window.scrollTo(0, 0);
}

function goHome() {
  renderHome();
}

function renderHome() {
  hidePopup();
  closeJumpPopup();
  disablePageIndicator();
  clearParvaNav();
  state.currentPart = null;
  state.currentSection = null;
  highlightActive(null, null);
  updateHeader(null);

  const content = $('content');
  content.innerHTML = '';

  const home = document.createElement('div');
  home.className = 'home';

  const hero = document.createElement('div');
  hero.className = 'home__hero';
  const heroTitle = document.createElement('h2');
  heroTitle.className = 'home__hero-title';
  heroTitle.textContent = 'Mahabharata';
  const heroSub = document.createElement('p');
  heroSub.className = 'home__hero-sub';
  heroSub.textContent = 'Bibek Debroy — Penguin 10-volume edition';
  hero.appendChild(heroTitle);
  hero.appendChild(heroSub);
  home.appendChild(hero);

  const continueSlot = document.createElement('div');
  continueSlot.className = 'home__continue-slot';
  home.appendChild(continueSlot);

  const gridLabel = document.createElement('h3');
  gridLabel.className = 'home__section-label';
  gridLabel.textContent = 'Parts';
  home.appendChild(gridLabel);

  const grid = document.createElement('div');
  grid.className = 'home__grid';
  home.appendChild(grid);

  const cards = [];
  for (let n = 1; n <= CONFIG.partCount; n++) {
    const card = createHomePartCard(n);
    grid.appendChild(card);
    cards.push(card);
  }

  content.appendChild(home);
  window.scrollTo(0, 0);

  const last = parseLastParva(localStorage.getItem(STORAGE.lastParva));
  if (last) hydrateContinueCard(continueSlot, last);

  for (let i = 0; i < cards.length; i++) {
    hydrateHomePartCard(cards[i], i + 1);
  }
}

function createHomePartCard(partNum) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'home__part-card';
  card.dataset.part = String(partNum);
  card.disabled = true;

  const num = document.createElement('div');
  num.className = 'home__part-card-num';
  num.textContent = `Part ${partNum}`;

  const meta = document.createElement('div');
  meta.className = 'home__part-card-meta';
  meta.textContent = '…';

  card.appendChild(num);
  card.appendChild(meta);
  return card;
}

async function hydrateHomePartCard(card, partNum) {
  const manifest = await getPartManifest(partNum);
  if (!card.isConnected) return;
  const meta = card.querySelector('.home__part-card-meta');
  const sections = manifest && Array.isArray(manifest.sections) ? manifest.sections : [];
  if (sections.length === 0) {
    card.classList.add('home__part-card--soon');
    card.disabled = true;
    meta.textContent = 'Coming soon';
    return;
  }
  let read = 0;
  for (const s of sections) {
    const raw = parseFloat(localStorage.getItem(STORAGE.pos(partNum, s.number)) || '');
    if (Number.isFinite(raw) && raw >= 0.99) read++;
  }
  meta.textContent = read > 0
    ? `${sections.length} parvas · ${read} read`
    : `${sections.length} parvas`;
  card.disabled = false;
  card.addEventListener('click', () => {
    expandPart(partNum);
    loadParva(partNum, sections[0].number);
  });
}

async function hydrateContinueCard(slot, last) {
  const manifest = await getPartManifest(last.part);
  if (!slot.isConnected) return;
  if (!manifest || !Array.isArray(manifest.sections)) return;
  const sec = manifest.sections.find((s) => s.number === last.section);
  if (!sec) return;

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'home__continue';

  const lbl = document.createElement('div');
  lbl.className = 'home__continue-label';
  lbl.textContent = 'Continue reading';

  const name = document.createElement('div');
  name.className = 'home__continue-name';
  name.textContent = sec.parva || sec.name || `Section ${last.section}`;

  const meta = document.createElement('div');
  meta.className = 'home__continue-meta';
  const idx = manifest.sections.indexOf(sec);
  const total = manifest.sections.length;
  const raw = parseFloat(localStorage.getItem(STORAGE.pos(last.part, last.section)) || '');
  const frac = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
  const pct = Math.round(frac * 100);
  meta.textContent = `Part ${last.part} · ${idx + 1} of ${total}${pct > 0 ? ` · ${pct}%` : ''}`;

  card.appendChild(lbl);
  card.appendChild(name);
  card.appendChild(meta);
  card.addEventListener('click', () => {
    expandPart(last.part);
    loadParva(last.part, last.section);
  });

  slot.appendChild(card);
}

function pageInfo() {
  const article = $('content');
  const ph = window.innerHeight;
  if (!article || ph <= 0) return null;
  if (state.currentPart == null || state.currentSection == null) return null;
  const top = article.offsetTop;
  const height = article.offsetHeight;
  if (height <= 0) return null;
  const total = Math.max(1, Math.ceil(height / ph));
  const scrolled = Math.max(0, window.scrollY - top);
  const current = Math.min(total, Math.max(1, Math.floor(scrolled / ph) + 1));
  return { current, total };
}

function enablePageIndicator() {
  const pill = $('pageIndicator');
  if (!pill) return;
  pill.dataset.disabled = '';
  pill.hidden = false;
}

function disablePageIndicator() {
  const pill = $('pageIndicator');
  if (!pill) return;
  pill.dataset.disabled = '1';
  pill.classList.add('page-indicator--hidden');
  pill.hidden = true;
  if (state.pageIndicatorHideTimer) {
    clearTimeout(state.pageIndicatorHideTimer);
    state.pageIndicatorHideTimer = 0;
  }
}

function updatePageIndicator() {
  const pill = $('pageIndicator');
  const text = $('pageIndicatorText');
  if (!pill || !text) return;
  if (pill.dataset.disabled === '1') return;
  const info = pageInfo();
  if (!info) return;
  text.textContent = `${info.current} / ${info.total}`;
  pill.setAttribute('aria-label', `Page ${info.current} of ${info.total}. Jump to page.`);
}

function showPageIndicator() {
  const pill = $('pageIndicator');
  if (!pill || pill.dataset.disabled === '1') return;
  pill.classList.remove('page-indicator--hidden');
  if (state.pageIndicatorHideTimer) clearTimeout(state.pageIndicatorHideTimer);
  state.pageIndicatorHideTimer = setTimeout(() => {
    state.pageIndicatorHideTimer = 0;
    pill.classList.add('page-indicator--hidden');
  }, 1500);
}

function jumpToPage(n) {
  const article = $('content');
  if (!article) return;
  const ph = window.innerHeight;
  if (ph <= 0) return;
  const info = pageInfo();
  if (!info) return;
  const clamped = Math.min(info.total, Math.max(1, n));
  const top = article.offsetTop + (clamped - 1) * ph;
  window.scrollTo({ top, behavior: 'smooth' });
}

function openJumpPopup() {
  const info = pageInfo();
  if (!info) return;
  const popupEl = $('jumpPopup');
  const input = $('jumpInput');
  const total = $('jumpTotal');
  if (!popupEl || !input || !total) return;
  hidePopup();
  input.max = String(info.total);
  input.value = String(info.current);
  total.textContent = `of ${info.total}`;
  popupEl.hidden = false;
  requestAnimationFrame(() => {
    input.focus({ preventScroll: true });
    input.select();
  });
}

function closeJumpPopup() {
  const popupEl = $('jumpPopup');
  if (!popupEl || popupEl.hidden) return;
  popupEl.hidden = true;
  const pill = $('pageIndicator');
  if (pill && pill.dataset.disabled !== '1') {
    pill.focus({ preventScroll: true });
    showPageIndicator();
  }
}

function submitJump() {
  const input = $('jumpInput');
  if (!input) return;
  const raw = parseInt(input.value, 10);
  if (!Number.isFinite(raw)) {
    closeJumpPopup();
    return;
  }
  jumpToPage(raw);
  closeJumpPopup();
  requestAnimationFrame(() => {
    updatePageIndicator();
    showPageIndicator();
  });
}

function updateHeader(opts) {
  const titleEl = $('title');
  const metaEl = $('titleMeta');
  if (!opts) {
    titleEl.textContent = 'Mahabharata';
    metaEl.textContent = '';
    metaEl.hidden = true;
    document.title = 'Mahabharata';
    return;
  }
  titleEl.textContent = opts.title;
  if (opts.meta) {
    metaEl.textContent = opts.meta;
    metaEl.hidden = false;
  } else {
    metaEl.textContent = '';
    metaEl.hidden = true;
  }
  document.title = `${opts.title} — Mahabharata`;
}

function clearParvaNav() {
  const nav = $('parvaNav');
  nav.innerHTML = '';
  nav.hidden = true;
}

function renderParvaNav(part, section, manifest) {
  const sections = manifest && Array.isArray(manifest.sections) ? manifest.sections : [];
  const idx = sections.findIndex((s) => s.number === section);
  if (idx === -1) {
    clearParvaNav();
    return;
  }

  const toTarget = (s, p) => ({
    part: p,
    section: s.number,
    label: s.parva || s.name || `Section ${s.number}`,
    crossPart: p !== part,
  });

  let prev = idx > 0 ? toTarget(sections[idx - 1], part) : null;
  let next = idx < sections.length - 1 ? toTarget(sections[idx + 1], part) : null;
  drawParvaNav(prev, next);

  if (!prev && part > 1) {
    getPartManifest(part - 1).then((m) => {
      if (state.currentPart !== part || state.currentSection !== section) return;
      if (!m || !Array.isArray(m.sections) || m.sections.length === 0) return;
      prev = toTarget(m.sections[m.sections.length - 1], part - 1);
      drawParvaNav(prev, next);
    });
  }
  if (!next && part < CONFIG.partCount) {
    getPartManifest(part + 1).then((m) => {
      if (state.currentPart !== part || state.currentSection !== section) return;
      if (!m || !Array.isArray(m.sections) || m.sections.length === 0) return;
      next = toTarget(m.sections[0], part + 1);
      drawParvaNav(prev, next);
    });
  }
}

function drawParvaNav(prev, next) {
  const nav = $('parvaNav');
  nav.innerHTML = '';
  if (!prev && !next) {
    nav.hidden = true;
    return;
  }
  appendNavBtn(nav, prev, 'prev');
  appendNavBtn(nav, next, 'next');
  nav.hidden = false;
}

function appendNavBtn(nav, target, dir) {
  if (!target) {
    const spacer = document.createElement('span');
    spacer.className = 'parva-nav__spacer';
    nav.appendChild(spacer);
    return;
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `parva-nav__btn parva-nav__${dir}`;

  const arrow = document.createElement('span');
  arrow.className = 'parva-nav__arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = dir === 'prev' ? '←' : '→';

  const meta = document.createElement('span');
  meta.className = 'parva-nav__meta';

  const dirLbl = document.createElement('span');
  dirLbl.className = 'parva-nav__dir';
  dirLbl.textContent = target.crossPart
    ? `Part ${target.part}`
    : (dir === 'prev' ? 'Previous' : 'Next');

  const name = document.createElement('span');
  name.className = 'parva-nav__name';
  name.textContent = target.label;

  meta.appendChild(dirLbl);
  meta.appendChild(name);
  btn.appendChild(arrow);
  btn.appendChild(meta);
  btn.setAttribute('aria-label',
    `${dir === 'prev' ? 'Previous' : 'Next'}: Part ${target.part}, ${target.label}`);

  btn.addEventListener('click', () => {
    loadParva(target.part, target.section);
    expandPart(target.part);
  });

  nav.appendChild(btn);
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
  if (!state.pageIndicatorRaf) {
    state.pageIndicatorRaf = requestAnimationFrame(() => {
      state.pageIndicatorRaf = 0;
      updatePageIndicator();
      showPageIndicator();
    });
  }
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
