// Launch Radar's dashboard: a plain page, no framework, no network. It reads
// window.RADAR (written beside dashboard/ by main.ts) and renders the ranked
// board, a filterable and sortable table, a routed detail view per protocol
// with the value model's own factors and the protocol's farm plan, and a
// separate view for protocols whose token already trades.
//
// Routes, all in the hash so every view has a URL:
//   #/                        the board
//   #/protocol/<slug>         one protocol's detail view
//   #/live                    protocols whose token already trades
//   #/?chain=Ethereum&q=...   the board, filtered (chain, category, q, sort, dir)
(function () {
  'use strict';

  var DATA = window.RADAR;
  var main = document.getElementById('main');
  if (!DATA || !main) return;

  var MODEL = DATA.model;

  // ---------- formatting ----------

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function categoryOf(row) { return row.category || 'No category'; }
  function chainLabel(row) {
    if (!row.chains || row.chains.length === 0) return 'an unnamed chain';
    if (row.chains.length <= 2) return row.chains.join(', ');
    return row.chains.slice(0, 2).join(', ') + ' +' + (row.chains.length - 2);
  }

  // The value model, recomputed in the page from the snapshot figures, so the
  // detail view can show its arithmetic agrees with the board's number.
  function recomputedValue(row) {
    var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthF = 1 + (growth / 100) * MODEL.growth_weight;
    var age = row.age_days === null ? MODEL.unknown_age_days : row.age_days;
    var tenureF = MODEL.tenure_floor + (Math.min(Math.max(age, 0), MODEL.tenure_days) / MODEL.tenure_days) * MODEL.tenure_range;
    var breadthF = 1 + Math.min(Math.max(row.chains.length, 0), MODEL.breadth_max_chains) * MODEL.breadth_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * MODEL.base_multiple * growthF * tenureF * breadthF));
  }

  // ---------- tiny DOM builder: text only, never HTML, so data stays data ----------

  function h(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') node.textContent = v;
        else if (k === 'class') node.className = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string' || typeof child === 'number') node.appendChild(document.createTextNode(String(child)));
      else node.appendChild(child);
    }
    return node;
  }

  // ---------- routing: the hash is the whole state ----------

  function parseHash() {
    var raw = window.location.hash.replace(/^#/, '');
    var parts = raw.split('?');
    var path = parts[0] || '/';
    var params = new URLSearchParams(parts[1] || '');
    var segments = path.split('/').filter(function (s) { return s.length > 0; });
    var route = { view: 'board', slug: null, q: params.get('q') || '', category: params.get('category') || 'all', chain: params.get('chain') || 'all', sort: params.get('sort') || 'implied', dir: params.get('dir') || 'desc' };
    if (segments[0] === 'protocol' && segments[1]) { route.view = 'detail'; route.slug = decodeURIComponent(segments[1]); }
    else if (segments[0] === 'live') { route.view = 'live'; }
    if (['rank', 'name', 'tvl', 'growth', 'age', 'implied'].indexOf(route.sort) < 0) route.sort = 'implied';
    if (route.dir !== 'asc' && route.dir !== 'desc') route.dir = 'desc';
    return route;
  }
  function boardHash(overrides) {
    var r = parseHash();
    var next = { q: r.q, category: r.category, chain: r.chain, sort: r.sort, dir: r.dir };
    if (overrides) Object.keys(overrides).forEach(function (k) { next[k] = overrides[k]; });
    var params = new URLSearchParams();
    if (next.q) params.set('q', next.q);
    if (next.category !== 'all') params.set('category', next.category);
    if (next.chain !== 'all') params.set('chain', next.chain);
    if (next.sort !== 'implied') params.set('sort', next.sort);
    if (next.dir !== 'desc') params.set('dir', next.dir);
    var query = params.toString();
    return '#/' + (query ? '?' + query : '');
  }
  function replaceHash(hash) {
    window.history.replaceState(null, '', hash);
  }

  // ---------- filtering and sorting ----------

  function filteredRows(route) {
    var q = route.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (route.category !== 'all' && categoryOf(r) !== route.category) return false;
      if (route.chain !== 'all' && (r.chains || []).indexOf(route.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, categoryOf(r), (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list, route) {
    var dir = route.dir === 'asc' ? 1 : -1;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (route.sort === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (route.sort === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (route.sort === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (route.sort === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (route.sort === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---------- shared chrome ----------

  function masthead() {
    return h('header', { class: 'masthead' },
      h('a', { class: 'wordmark', href: '#/' },
        h('span', { class: 'dot', 'aria-hidden': 'true' }),
        h('b', { text: 'LAUNCH RADAR' }),
        h('span', { text: 'Pre-token protocol radar' })
      ),
      h('div', { class: 'masthead-meta' },
        h('span', { text: 'Snapshot ' + DATA.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: 'Model ' + DATA.model_version })
      )
    );
  }
  function footer() {
    return h('footer', { class: 'footer' },
      h('p', null,
        h('b', { text: 'Method. ' }),
        'Implied value is this entry\u2019s own model, never a price and never a promise. Every row is scored by one function of the snapshot figures: TVL, seven-day growth, tenure with no token, and chain breadth. No protocol name is special-cased.'
      ),
      h('p', null,
        h('b', { text: 'Honest language. ' }),
        'A protocol on this board records no token in the snapshot: no market cap, no CoinGecko id, no symbol. The record is not proof it has none, and nothing here predicts whether or when a token is issued.'
      ),
      h('p', { text: 'Snapshot ' + DATA.as_of + ' \u00b7 DefiLlama protocol index \u00b7 ' + DATA.rows.length + ' ranked rows \u00b7 Model ' + DATA.model_version })
    );
  }
  function viewTabs(route) {
    return h('div', { class: 'view-tabs', role: 'navigation', 'aria-label': 'Views' },
      h('a', { href: '#/', 'aria-current': route.view === 'board' ? 'page' : null, text: 'Pre-token board' }),
      h('a', { href: '#/live', 'aria-current': route.view === 'live' ? 'page' : null, text: 'Already trading' })
    );
  }

  // ---------- board view ----------

  function hero() {
    return h('section', { class: 'hero' },
      h('h1', { text: 'Every protocol with no token on record, ranked by what its launch could be worth.' }),
      h('p', { class: 'lede' }, 'The watchlist is the floor: ', h('b', { text: DATA.watchlist_size + ' protocols' }), ' with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token recorded. The early radar adds every screened pre-token protocol below that floor. Select a row for its value breakdown and farm plan.'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat hot' }, h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), h('span', { text: 'Watchlist protocols covered' })),
        h('div', { class: 'stat' }, h('b', { text: String(DATA.board_size) }), h('span', { text: 'Pre-token rows ranked' })),
        h('div', { class: 'stat' }, h('b', { text: String(DATA.early_size) }), h('span', { text: 'Early rows below the floor' })),
        h('div', { class: 'stat' }, h('b', { text: String(DATA.live_size) }), h('span', { text: 'Live-token protocols set aside' }))
      )
    );
  }

  function categoryOptions(route) {
    var seen = {};
    DATA.rows.forEach(function (r) { seen[categoryOf(r)] = true; });
    var names = Object.keys(seen).sort();
    return names.map(function (c) {
      return h('option', { value: c, selected: c === route.category ? 'selected' : null, text: c });
    });
  }
  function chainOptions(route) {
    var counts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
    var names = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); });
    return names.map(function (c) {
      return h('option', { value: c, selected: c === route.chain ? 'selected' : null, text: c + ' (' + counts[c] + ')' });
    });
  }

  function sortHeader(route, key, label, refresh) {
    var active = route.sort === key;
    var arrow = active ? (route.dir === 'desc' ? ' \u25bc' : ' \u25b2') : '';
    return h('th', { scope: 'col' },
      h('button', {
        type: 'button', class: 'sort-btn',
        onclick: function () {
          var next = parseHash();
          if (next.sort === key) next.dir = next.dir === 'desc' ? 'asc' : 'desc';
          else { next.sort = key; next.dir = key === 'name' ? 'asc' : 'desc'; }
          window.location.hash = boardHash(next);
        }
      }, label, active ? h('span', { class: 'arrow', 'aria-hidden': 'true', text: arrow }) : null)
    );
  }

  function boardTable(route, refresh) {
    var list = sortedRows(filteredRows(route), route);
    var count = document.getElementById('shown-count');
    if (count) {
      var filtering = route.q || route.category !== 'all' || route.chain !== 'all';
      count.textContent = filtering ? list.length + ' of ' + DATA.rows.length + ' rows shown' : DATA.rows.length + ' rows';
    }
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        h('button', { class: 'clear-filters', type: 'button', text: 'Clear filters', onclick: function () { window.location.hash = '#/'; } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = h('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      var tr = h('tr', {
        class: 'row-link', tabindex: '0',
        onclick: function () { window.location.hash = '#/protocol/' + encodeURIComponent(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.hash = '#/protocol/' + encodeURIComponent(r.slug); } }
      },
        h('td', { class: 'rank-cell', text: String(r.rank) }),
        h('td', null, h('div', { class: 'cell-name' }, h('b', { text: r.name }), h('span', { text: categoryOf(r) }))),
        h('td', { text: chainLabel(r) }),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        h('td', { class: 'num', text: fmtAge(r.age_days) }),
        h('td', null, h('div', { class: 'value-cell' },
          h('span', { class: 'value-bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          h('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        h('td', null, h('span', { class: 'badge ' + (r.on_watchlist ? 'watch' : 'early'), text: r.on_watchlist ? 'Watchlist' : 'Early' }))
      );
      tbody.appendChild(tr);
    });
    return h('div', { class: 'panel' }, h('div', { class: 'table-scroll' },
      h('table', null,
        h('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
        h('thead', null, h('tr', null,
          sortHeader(route, 'rank', 'Rank', refresh),
          sortHeader(route, 'name', 'Protocol', refresh),
          h('th', { scope: 'col', text: 'Chains' }),
          sortHeader(route, 'tvl', 'TVL', refresh),
          sortHeader(route, 'growth', '7d', refresh),
          sortHeader(route, 'age', 'Age', refresh),
          sortHeader(route, 'implied', 'Implied value', refresh),
          h('th', { scope: 'col', text: 'Board' })
        )),
        tbody
      )
    ));
  }

  function modelSection() {
    var m = MODEL;
    return h('section', { class: 'panel model', 'aria-labelledby': 'model-title' },
      h('h2', { id: 'model-title', text: 'How implied value is computed' }),
      h('p', { text: 'One function scores every row, from the snapshot figures alone. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula', text: 'implied = round( tvl_usd \u00d7 ' + m.base_multiple + ' \u00d7 (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 \u00d7 ' + m.growth_weight + ') \u00d7 (' + m.tenure_floor + ' + min(age_days, ' + m.tenure_days + ') / ' + m.tenure_days + ' \u00d7 ' + m.tenure_range + ') \u00d7 (1 + min(chains, ' + m.breadth_max_chains + ') \u00d7 ' + m.breadth_per_chain + ') )' }),
      h('div', { class: 'constants' },
        h('div', { class: 'constant' }, h('span', { text: 'Base multiple of TVL' }), h('b', { text: String(m.base_multiple) })),
        h('div', { class: 'constant' }, h('span', { text: 'Growth weight, band' }), h('b', { text: m.growth_weight + ', ' + m.growth_floor + '% to +' + m.growth_cap + '%' })),
        h('div', { class: 'constant' }, h('span', { text: 'Tenure floor, range, cap' }), h('b', { text: m.tenure_floor + ' + ' + m.tenure_range + ' over ' + m.tenure_days + ' days' })),
        h('div', { class: 'constant' }, h('span', { text: 'Unknown age counts as' }), h('b', { text: m.unknown_age_days + ' days' })),
        h('div', { class: 'constant' }, h('span', { text: 'Breadth per chain, cap' }), h('b', { text: '+' + Math.round(m.breadth_per_chain * 100) + '% per chain, ' + m.breadth_max_chains + ' chains' })),
        h('div', { class: 'constant' }, h('span', { text: 'Model version' }), h('b', { text: DATA.model_version }))
      ),
      h('div', { class: 'method' },
        h('h3', { text: 'Which protocols make the board' }),
        h('p', { text: 'Every protocol on the snapshot\u2019s watchlist, plus every pre-token protocol below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor that passes the wrapped-product screen: its category is not a bridge, liquid staking, restaked product or exchange, its name carries no version marker and no whole word wrapped, staked or staking, and it does not begin with an exchange\u2019s name. Above the floor the board trusts the watchlist itself, because the house rule also reads a parent protocol the snapshot does not carry.' }),
        h('h3', { text: 'How each farm plan is built' }),
        h('p', { text: 'Six steps per protocol, derived from its own record. The capital tier follows its TVL ($40 under $100M, $75 to $500M, $120 to $2B, $200 above); the gas estimate follows its first chain (Ethereum costs real money, cheap chains cost cents); the hold follows its age (90 days under 90 days old, 60 under a year, 45 beyond); the entry and weekly actions follow its category. Every step states what it costs and how long it takes. No airdrop is promised.' })
      )
    );
  }

  function boardView(route) {
    var tableWrap = h('div');
    function refresh() {
      var next = parseHash();
      tableWrap.textContent = '';
      tableWrap.appendChild(boardTable(next, refresh));
    }
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: route.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () {
      replaceHash(boardHash({ q: search.value }));
      refresh();
    });
    var categorySelect = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categoryOptions(route)
    );
    categorySelect.addEventListener('change', function () {
      replaceHash(boardHash({ category: categorySelect.value }));
      refresh();
    });
    var chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', text: 'All chains' }),
      chainOptions(route)
    );
    chainSelect.addEventListener('change', function () {
      replaceHash(boardHash({ chain: chainSelect.value }));
      refresh();
    });
    var controls = h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), categorySelect),
      h('div', { class: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chainSelect),
      viewTabs(route),
      h('span', { class: 'shown-count', id: 'shown-count' })
    );
    refresh();
    var section = h('div', null, hero(), controls, tableWrap, modelSection());
    return section;
  }

  // ---------- detail view ----------

  function splitStep(step) {
    var at = step.indexOf(' Cost: ');
    if (at < 0) return { action: step, cost: null, time: null };
    var action = step.slice(0, at);
    var rest = step.slice(at + 1);
    var cut = rest.indexOf('. Time: ');
    if (cut < 0) return { action: action, cost: rest, time: null };
    return { action: action, cost: rest.slice(0, cut), time: rest.slice(cut + 8).replace(/\.$/, '') };
  }

  function detailView(route) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === route.slug) row = r; });
    if (!row) {
      return h('div', null,
        h('a', { class: 'back-link', href: '#/', text: '\u2190 All protocols' }),
        h('div', { class: 'panel' }, h('div', { class: 'empty' },
          h('h2', { text: 'No protocol on this board has that address' }),
          h('p', { text: 'The board holds ' + DATA.rows.length + ' pre-token protocols. Pick one from the board.' })
        ))
      );
    }
    var recomputed = recomputedValue(row);
    var matches = recomputed === row.implied_value_usd;
    var growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var base = Math.round(row.tvl_usd * MODEL.base_multiple);
    var factors = h('div', { class: 'factor-grid' },
      h('div', { class: 'factor' }, h('span', { text: 'Base' }), h('b', { text: fmtUsd(base) }), h('small', { text: 'TVL ' + fmtUsd(row.tvl_usd) + ' \u00d7 ' + MODEL.base_multiple })),
      h('div', { class: 'factor' }, h('span', { text: 'Growth factor' }), h('b', { text: '\u00d7' + row.growth_factor.toFixed(2) }), h('small', { text: '7d ' + fmtPct(row.change_7d) + ', clamped to ' + fmtPct(growthPct) })),
      h('div', { class: 'factor' }, h('span', { text: 'Tenure factor' }), h('b', { text: '\u00d7' + row.tenure_factor.toFixed(2) }), h('small', { text: fmtAge(row.age_days) + ' with no token on record' })),
      h('div', { class: 'factor' }, h('span', { text: 'Breadth factor' }), h('b', { text: '\u00d7' + row.breadth_factor.toFixed(2) }), h('small', { text: (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + ', capped at ' + MODEL.breadth_max_chains })),
      h('div', { class: 'factor result' }, h('span', { text: 'Implied value' }), h('b', { text: fmtUsd(row.implied_value_usd) }), h('small', { text: 'Rank ' + row.rank + ' of ' + DATA.rows.length }))
    );
    var facts = h('div', { class: 'facts' },
      h('div', { class: 'fact' }, h('span', { text: 'TVL' }), h('b', { text: fmtUsd(row.tvl_usd) }), h('small', { text: 'Seven-day change ' + fmtPct(row.change_7d) })),
      h('div', { class: 'fact' }, h('span', { text: 'First listed' }), h('b', { text: row.listed_at || 'unreported' }), h('small', { text: 'Age ' + fmtAge(row.age_days) })),
      h('div', { class: 'fact' }, h('span', { text: 'Token status' }), h('b', { text: 'Records no token' }), h('small', { text: 'No market cap, no CoinGecko id, no symbol in the snapshot' })),
      h('div', { class: 'fact' }, h('span', { text: 'Category' }), h('b', { text: categoryOf(row) }), h('small', { text: 'As the snapshot records it' })),
      h('div', { class: 'fact' }, h('span', { text: 'Chains' }), h('b', { text: (row.chains || []).length ? row.chains.join(', ') : 'Unnamed' }), h('small', { text: (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') })),
      h('div', { class: 'fact' }, h('span', { text: 'Board' }), h('b', { text: row.on_watchlist ? 'Watchlist' : 'Early radar' }), h('small', { text: row.on_watchlist ? 'At or above the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor' : 'Below the floor, passed the screen' }))
    );
    var steps = h('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
      var part = splitStep(s);
      return h('li', null,
        h('div', { class: 'action', text: part.action }),
        h('div', { class: 'chips' },
          part.cost ? h('span', { class: 'chip', text: part.cost }) : null,
          part.time ? h('span', { class: 'chip', text: 'Time: ' + part.time }) : null
        )
      );
    }));
    return h('div', null,
      h('a', { class: 'back-link', href: '#/', text: '\u2190 All protocols' }),
      h('div', { class: 'detail-head' },
        h('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.rows.length }),
        h('h1', { text: row.name }),
        h('p', { class: 'meta', text: categoryOf(row) + ' on ' + ((row.chains || []).length ? row.chains.join(', ') : 'an unnamed chain') }),
        h('p', null, h('span', { class: 'badge ' + (row.on_watchlist ? 'watch' : 'early'), text: row.on_watchlist ? 'Watchlist protocol' : 'Early radar protocol' }))
      ),
      factors,
      h('p', { class: 'recompute', text: 'Model ' + DATA.model_version + ': the page recomputes this row from the snapshot figures as ' + fmtUsd(recomputed) + (matches ? ', the same number the board carries.' : ', which differs from the board: the data would be stale.') + ' An estimate, not a price.' }),
      facts,
      h('section', { class: 'panel plan', 'aria-labelledby': 'plan-title' },
        h('h2', { id: 'plan-title', text: 'Farm plan' }),
        h('p', { text: 'Six steps for ' + row.name + ', derived from its category, chains, TVL and age. Nothing here promises an airdrop: the protocol records no token, and the plan says what to do, what it costs, and how long it takes.' }),
        steps
      ),
      h('div', { class: 'note' }, h('b', { text: 'Before you farm. ' }), 'Use money you can afford to leave in the position, check every link from the protocol\u2019s own app, and never pay anyone to claim. A snapshot can only count activity it sees, so the hold matters more than the size.')
    );
  }

  // ---------- live-token view ----------

  function liveView(route) {
    var tbody = h('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(h('tr', null,
        h('td', null, h('div', { class: 'cell-name' }, h('b', { text: r.name }), h('span', { text: categoryOf(r) }))),
        h('td', { text: chainLabel(r) }),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : r.change_7d !== null ? 'down' : ''), text: fmtPct(r.change_7d) }),
        h('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        h('td', null, h('span', { class: 'badge live', text: 'Already trades' }))
      ));
    });
    return h('div', null,
      h('section', { class: 'hero' },
        h('h1', { text: 'Already trading: the market has spoken.' }),
        h('p', { class: 'lede' }, 'These ' + DATA.live.length + ' protocols record a token, so their market capitalisation is a fact, not a model. They are set aside from the pre-token ranking, shown here so the board\u2019s separation is visible.')
      ),
      h('div', { class: 'controls' }, viewTabs(route), h('span', { class: 'shown-count', text: DATA.live.length + ' live-token protocols' })),
      h('div', { class: 'panel' }, h('div', { class: 'table-scroll' },
        h('table', null,
          h('caption', { text: 'Largest live-token protocols by market capitalisation. None of these is ranked: the board ranks only protocols that record no token.' }),
          h('thead', null, h('tr', null,
            h('th', { scope: 'col', text: 'Protocol' }),
            h('th', { scope: 'col', text: 'Chains' }),
            h('th', { scope: 'col', text: 'TVL' }),
            h('th', { scope: 'col', text: '7d' }),
            h('th', { scope: 'col', text: 'Market cap' }),
            h('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      ))
    );
  }

  // ---------- render ----------

  function render() {
    var route = parseHash();
    main.textContent = '';
    var shell = h('div', { class: 'shell' });
    shell.appendChild(masthead());
    if (route.view === 'detail') shell.appendChild(detailView(route));
    else if (route.view === 'live') shell.appendChild(liveView(route));
    else shell.appendChild(boardView(route));
    shell.appendChild(footer());
    main.appendChild(shell);
    main.setAttribute('aria-busy', 'false');
  }

  window.addEventListener('hashchange', render);
  render();
})();
