(() => {
  const API = 'https://www.wikidata.org/w/api.php';
  const SPARQL = 'https://query.wikidata.org/sparql';
  // association football club, national football team, association football team,
  // men's association football team (used by e.g. FC Barcelona, Chelsea), women's association football team
  const CLUB_FILTER = 'haswbstatement:P31=Q476028|P31=Q6979593|P31=Q15944511|P31=Q103229495|P31=Q28140340';

  const state = { a: null, b: null };
  const memo = new Map();
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const statusEl = $('#status');
  const resultsEl = $('#results');

  // ---------- i18n ----------
  const T = {
    tr: {
      title: '3-2-1 Ortak Oyuncu',
      sub: 'İki kulüp seç, ikisinde de oynamış oyuncuları gör.',
      club1: '1. Kulüp', club2: '2. Kulüp',
      ph1: 'örn. Galatasaray', ph2: 'örn. Fenerbahçe',
      swap: 'Kulüpleri değiştir',
      footer: 'Veriler <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a>\'dan canlı olarak çekilir; eksik olabilir.',
      noClub: 'Kulüp bulunamadı',
      same: 'İki farklı kulüp seç.',
      loading: 'Oyuncular aranıyor…',
      error: 'Veri alınamadı, lütfen tekrar dene.',
      none: (a, b) => `<strong>${a}</strong> ve <strong>${b}</strong> için ortak oyuncu bulunamadı.`,
      found: (n) => `<strong>${n}</strong> ortak oyuncu bulundu`,
    },
    en: {
      title: '3-2-1 Common Players',
      sub: 'Pick two clubs and see every player who played for both.',
      club1: 'Club 1', club2: 'Club 2',
      ph1: 'e.g. Real Madrid', ph2: 'e.g. Barcelona',
      swap: 'Swap clubs',
      footer: 'Data is fetched live from <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a> and may be incomplete.',
      noClub: 'No club found',
      same: 'Pick two different clubs.',
      loading: 'Searching players…',
      error: 'Could not load data, please try again.',
      none: (a, b) => `No common players found for <strong>${a}</strong> and <strong>${b}</strong>.`,
      found: (n) => `<strong>${n}</strong> common player${n === 1 ? '' : 's'} found`,
    },
  };
  let lang = (() => {
    try { const s = localStorage.getItem('lang'); if (T[s]) return s; } catch {}
    return (navigator.language || '').toLowerCase().startsWith('tr') ? 'tr' : 'en';
  })();
  const t = (k) => T[lang][k];
  // Wikidata language order: chosen language first, the other as fallback
  const langs = () => (lang === 'tr' ? ['tr', 'en'] : ['en', 'tr']);
  const pick = (terms) => { for (const l of langs()) if (terms?.[l]) return terms[l].value; };

  function applyLang() {
    document.documentElement.lang = lang;
    document.title = t('title');
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = el.ariaLabel = t(el.dataset.i18nTitle); });
    document.querySelectorAll('.lang button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
  }
  applyLang();

  // ---------- caching (memory + localStorage, 7 days) ----------
  const TTL = 7 * 24 * 3600 * 1000;
  function cacheGet(key) {
    if (memo.has(key)) return memo.get(key);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { t, v } = JSON.parse(raw);
      if (Date.now() - t > TTL) return null;
      memo.set(key, v);
      return v;
    } catch { return null; }
  }
  function cacheSet(key, v) {
    memo.set(key, v);
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch {}
  }

  async function getJSON(url, signal, retry = 1) {
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    // Wikidata occasionally answers 429/5xx; retry once after a short pause
    if ((res.status === 429 || res.status >= 500) && retry > 0) {
      await new Promise((r) => setTimeout(r, 700));
      return getJSON(url, signal, retry - 1);
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // ---------- club search ----------
  async function searchClubs(q, signal) {
    const key = `c:${lang}:${q.toLowerCase()}`;
    const hit = cacheGet(key);
    if (hit) return hit;

    const term = q.trim().split(/\s+/).map((w) => w + '*').join(' ');
    const s = new URLSearchParams({
      action: 'query', list: 'search', srlimit: '8', srprop: '', format: 'json', origin: '*',
      srsearch: `${term} ${CLUB_FILTER}`,
    });
    const data = await getJSON(`${API}?${s}`, signal);
    const ids = (data.query?.search || []).map((r) => r.title);
    if (!ids.length) return cacheSet(key, []), [];

    const e = new URLSearchParams({
      action: 'wbgetentities', ids: ids.join('|'), props: 'labels|descriptions',
      languages: 'tr|en', format: 'json', origin: '*',
    });
    const ents = (await getJSON(`${API}?${e}`, signal)).entities || {};
    const list = ids.map((id) => {
      const x = ents[id] || {};
      return {
        id,
        label: pick(x.labels),
        desc: pick(x.descriptions) || '',
      };
    }).filter((c) => c.label);
    cacheSet(key, list);
    return list;
  }

  // ---------- autocomplete ----------
  function setupField(side) {
    const field = $(`.field[data-side="${side}"]`);
    const input = $('input', field);
    const list = $('.suggest', field);
    let items = [];
    let active = -1;
    let timer;
    let ctrl;

    const close = () => { list.hidden = true; active = -1; };
    const render = () => {
      if (!items.length) {
        list.innerHTML = `<li class="empty">${t('noClub')}</li>`;
      } else {
        list.innerHTML = items.map((it, i) =>
          `<li role="option" data-i="${i}" class="${i === active ? 'active' : ''}">${esc(it.label)}${it.desc ? `<small>${esc(it.desc)}</small>` : ''}</li>`
        ).join('');
      }
      list.hidden = false;
    };

    const choose = (it) => {
      state[side] = it;
      input.value = it.label;
      field.classList.add('selected');
      close();
      updateURL();
      const other = side === 'a' ? 'b' : 'a';
      if (!state[other]) $(`.field[data-side="${other}"] input`).focus();
      else input.blur();
      run();
    };
    field._choose = choose;

    input.addEventListener('input', () => {
      state[side] = null;
      field.classList.remove('selected');
      clearTimeout(timer);
      ctrl?.abort();
      const q = input.value.trim();
      if (q.length < 2) return close();
      timer = setTimeout(async () => {
        ctrl = new AbortController();
        try {
          items = await searchClubs(q, ctrl.signal);
          active = items.length ? 0 : -1;
          if (input.value.trim() === q) render();
        } catch (err) {
          if (err.name !== 'AbortError') { items = []; render(); }
        }
      }, 220);
    });

    input.addEventListener('keydown', (e) => {
      if (list.hidden || !items.length) return;
      if (e.key === 'ArrowDown') { active = (active + 1) % items.length; render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = (active - 1 + items.length) % items.length; render(); e.preventDefault(); }
      else if (e.key === 'Enter' && active >= 0) { choose(items[active]); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    });

    // mousedown fires before blur, so the click registers
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li[data-i]');
      if (li) { e.preventDefault(); choose(items[+li.dataset.i]); }
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('focus', () => { if (items.length && !state[side] && input.value.trim().length >= 2) render(); });

    return { field, input };
  }

  const fa = setupField('a');
  const fb = setupField('b');

  $('#swap').addEventListener('click', () => {
    [state.a, state.b] = [state.b, state.a];
    [fa.input.value, fb.input.value] = [fb.input.value, fa.input.value];
    fa.field.classList.toggle('selected', !!state.a);
    fb.field.classList.toggle('selected', !!state.b);
    updateURL();
    run();
  });

  // ---------- common players ----------
  function buildQuery(a, b) {
    return `SELECT ?p ?pLabel (SAMPLE(?img) AS ?i)
 (GROUP_CONCAT(DISTINCT ?ya;separator=",") AS ?a) (GROUP_CONCAT(DISTINCT ?yb;separator=",") AS ?b) WHERE {
 ?p p:P54 ?s1 . ?s1 ps:P54 wd:${a} .
 ?p p:P54 ?s2 . ?s2 ps:P54 wd:${b} .
 OPTIONAL{?s1 pq:P580 ?a1} OPTIONAL{?s1 pq:P582 ?a2}
 OPTIONAL{?s2 pq:P580 ?b1} OPTIONAL{?s2 pq:P582 ?b2}
 BIND(CONCAT(COALESCE(STR(YEAR(?a1)),"?"),"-",COALESCE(STR(YEAR(?a2)),"")) AS ?ya)
 BIND(CONCAT(COALESCE(STR(YEAR(?b1)),"?"),"-",COALESCE(STR(YEAR(?b2)),"")) AS ?yb)
 OPTIONAL{?p wdt:P18 ?img}
 SERVICE wikibase:label { bd:serviceParam wikibase:language "${langs().join(",")}". }
} GROUP BY ?p ?pLabel LIMIT 1000`;
  }

  async function commonPlayers(a, b, signal) {
    const [x, y] = [a, b].sort();
    const key = `p:${lang}:${x}:${y}`;
    const hit = cacheGet(key);
    if (hit) return hit.map((r) => (x === a ? r : { ...r, ya: r.yb, yb: r.ya }));

    const url = `${SPARQL}?format=json&query=${encodeURIComponent(buildQuery(x, y))}`;
    const data = await getJSON(url, signal);
    const rows = data.results.bindings.map((r) => ({
      id: r.p.value.split('/').pop(),
      name: r.pLabel?.value || '',
      img: r.i?.value || '',
      ya: r.a?.value || '',
      yb: r.b?.value || '',
    }));
    rows.sort((p, q) => latest(q) - latest(p) || p.name.localeCompare(q.name, lang));
    cacheSet(key, rows);
    return x === a ? rows : rows.map((r) => ({ ...r, ya: r.yb, yb: r.ya }));
  }

  function latest(r) {
    const nums = (r.ya + ',' + r.yb).match(/\d{4}/g);
    return nums ? Math.max(...nums) : 0;
  }

  function fmtYears(s) {
    const parts = [...new Set(s.split(','))]
      .filter((p) => p && p !== '?-')
      .map((p) => {
        const [f, t] = p.split('-');
        if (f === t) return f;
        return f === '?' ? `?–${t}` : `${f}–${t}`;
      })
      .sort();
    // drop a lone year already inside another range (e.g. "2022–2023, 2023")
    return parts.filter((p) => p.includes('–') || !parts.some((o) => {
      const [f, t] = o.split('–');
      return o !== p && o.includes('–') && +f <= +p && (t === '' || +p <= +t);
    })).join(', ');
  }

  let runCtrl;
  async function run() {
    runCtrl?.abort();
    resultsEl.innerHTML = '';
    statusEl.className = 'status';
    const { a, b } = state;
    if (!a || !b) { statusEl.textContent = ''; return; }
    if (a.id === b.id) { statusEl.textContent = t('same'); return; }

    statusEl.innerHTML = `<span class="spinner"></span>${t('loading')}`;
    runCtrl = new AbortController();
    try {
      const rows = await commonPlayers(a.id, b.id, runCtrl.signal);
      render(rows, a, b);
    } catch (err) {
      if (err.name === 'AbortError') return;
      statusEl.className = 'status error';
      statusEl.textContent = t('error');
    }
  }

  function render(rows, a, b) {
    if (!rows.length) {
      statusEl.innerHTML = t('none')(esc(a.label), esc(b.label));
      return;
    }
    statusEl.innerHTML = t('found')(rows.length);
    const la = esc(a.label), lb = esc(b.label);
    resultsEl.innerHTML = rows.map((r) => {
      const name = esc(r.name);
      const img = r.img
        ? `<img class="avatar" loading="lazy" decoding="async" alt="" src="${esc(r.img)}?width=96">`
        : `<span class="avatar">${esc(r.name.charAt(0))}</span>`;
      const ya = fmtYears(r.ya), yb = fmtYears(r.yb);
      return `<li><a href="https://www.wikidata.org/wiki/${r.id}" target="_blank" rel="noopener">${img}
        <span class="info"><span class="name">${name}</span>
        <span class="years" style="display:block"><b>${la}</b>${ya ? ' ' + ya : ''} · <b>${lb}</b>${yb ? ' ' + yb : ''}</span></span></a></li>`;
    }).join('');
  }

  // ---------- shareable URL (?a=Q..&b=Q..) ----------
  function updateURL() {
    const p = new URLSearchParams();
    if (state.a) p.set('a', state.a.id);
    if (state.b) p.set('b', state.b.id);
    const qs = p.toString();
    history.replaceState(null, '', qs ? '?' + qs : location.pathname);
  }

  // fetch labels for the selected clubs in the current language
  async function loadSelected(ids) {
    const e = new URLSearchParams({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels', languages: 'tr|en', format: 'json', origin: '*' });
    const ents = (await getJSON(`${API}?${e}`)).entities || {};
    [state.a, state.b] = ids.map((id) => ({ id, label: pick(ents[id]?.labels) || id }));
    fa.input.value = state.a.label; fb.input.value = state.b.label;
    fa.field.classList.add('selected'); fb.field.classList.add('selected');
    run();
  }

  function restoreFromURL() {
    const p = new URLSearchParams(location.search);
    const ids = ['a', 'b'].map((k) => p.get(k)).filter((v) => /^Q\d+$/.test(v || ''));
    if (ids.length === 2) loadSelected(ids).catch(() => {});
  }

  document.querySelectorAll('.lang button').forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.lang === lang) return;
    lang = btn.dataset.lang;
    try { localStorage.setItem('lang', lang); } catch {}
    applyLang();
    if (state.a && state.b) loadSelected([state.a.id, state.b.id]).catch(run);
    else run();
  }));

  restoreFromURL();
})();
