// Launch Radar's dashboard: a plain page, no framework, no network. It reads
// window.RADAR (written beside dashboard/ by main.ts) and renders the ranked
// board, a filterable and sortable table, a routed detail view per protocol
// with the fitted model's own factors and the protocol's farm plan, a view for
// protocols whose token already trades, and a Model view showing the
// calibration evidence: the comps the model was fitted on, the fitted
// equation, and the out-of-sample error.
//
// The value model is fitted at run time from the snapshot's own launched-token
// protocols (comps): ln(mcap) = intercept + slope x ln(TVL), unclipped, with a
// shrunk per-category adjustment, then bounded growth, tenure and breadth
// multipliers. Nothing is hardcoded: every fitted number below comes from
// data.js, computed from the snapshot by main.ts.
//
// Routes, all in the hash so every view has a URL:
//   #/                        the board
//   #/protocol/<slug>         one protocol's detail view
//   #/live                    protocols whose token already trades
//   #/model                   the fitted model and its evidence
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
  // detail view can show its arithmetic agrees with the board's number. The
  // fitted core uses the equation in DATA.evidence; the category adjustment is
  // the row's own, fitted from its category's comps; the three multipliers are
  // the bounded secondary factors the model states.
  function recomputedValue(row) {
    var fit = DATA.evidence.fit;
    var core = Math.exp(fit.intercept + fit.slope * Math.log(row.tvl_usd) + row.category_adj);
    var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthF = 1 + (growth / 100) * MODEL.growth_weight;
    var age = row.age_days === null ? MODEL.unknown_age_days : row.age_days;
    var tenureF = MODEL.tenure_floor + (Math.min(Math.max(age, 0), MODEL.tenure_days) / MODEL.tenure_days) * MODEL.tenure_range;
    var breadthF = 1 + Math.min(Math.max(row.chains.length, 0), MODEL.breadth_max_chains) * MODEL.breadth_per_chain;
    return Math.min(100000000000000, Math.max(1, Math.round(core * growthF * tenureF * breadthF)));
  }
  function fmtMult(x) {
    if (x === null || x === undefined || !isFinite(x)) return 'n/a';
    return '\u00d7' + x.toFixed(2);
  }
  function fmtErrMultiple(logErr) {
    if (logErr === null || logErr === undefined || !isFinite(logErr)) return 'n/a';
    return '\u00d7' + Math.exp(logErr).toFixed(1);
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
    else if (segments[0] === 'model') { route.view = 'model'; }
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
        'Implied value is this entry\u2019s own model, never a price and never a promise. It is fitted, not guessed: the protocols that record a token are the calibration comps, and least squares over their market caps and TVLs sets the equation every row is scored with, plus a shrunk per-category adjustment and neutral growth, tenure and breadth multipliers. No protocol name is special-cased, and no fitted number is hardcoded. The Model & evidence view shows the fit and its out-of-sample error.'
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
      h('a', { href: '#/live', 'aria-current': route.view === 'live' ? 'page' : null, text: 'Already trading' }),
      h('a', { href: '#/model', 'aria-current': route.view === 'model' ? 'page' : null, text: 'Model & evidence' })
    );
  }

  // ---------- board view ----------

  function hero() {
    return h('section', { class: 'hero' },
      h('h1', { text: 'Every protocol with no token on record, ranked by what its launch could be worth.' }),
      h('p', { class: 'lede' }, 'The watchlist is the floor: ', h('b', { text: DATA.watchlist_size + ' protocols' }), ' with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token recorded. The early radar adds every screened pre-token protocol below that floor. Implied values are fitted on ', h('b', { text: DATA.evidence.comp_count + ' launched-token comparables' }), ' from this same snapshot, and validated out of sample. Select a row for its value breakdown and farm plan.'),
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
    var ev = DATA.evidence;
    var oos = ev.oos;
    return h('section', { class: 'panel model', 'aria-labelledby': 'model-title' },
      h('h2', { id: 'model-title', text: 'How implied value is computed: fitted on launched tokens' }),
      h('p', { text: 'One fitted function scores every row, from the snapshot figures alone. The ' + ev.comp_count + ' protocols that record a token are the calibration comps: least squares over their market caps and TVLs sets the equation, a shrunk per-category adjustment corrects it, and neutral growth, tenure and breadth multipliers finish it. No protocol name is special-cased, no fitted number is hardcoded, and the fit is re-derived from whatever snapshot the program is handed.' }),
      h('div', { class: 'formula', text: 'ln(implied core) = ' + ev.fit.intercept.toFixed(3) + ' + ' + ev.fit.slope.toFixed(3) + ' \u00d7 ln(tvl_usd) + category adjustment;  implied = round( exp(core) \u00d7 (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 \u00d7 ' + m.growth_weight + ') \u00d7 (' + m.tenure_floor + ' + min(age_days, ' + m.tenure_days + ') / ' + m.tenure_days + ' \u00d7 ' + m.tenure_range + ') \u00d7 (1 + min(chains, ' + m.breadth_max_chains + ') \u00d7 ' + m.breadth_per_chain + ') )' }),
      h('div', { class: 'constants' },
        h('div', { class: 'constant' }, h('span', { text: 'Calibration comps (mcap recorded)' }), h('b', { text: String(ev.comp_count) })),
        h('div', { class: 'constant' }, h('span', { text: 'Fitted slope: 10\u00d7 TVL \u2192 ' + Math.pow(10, ev.fit.slope).toFixed(1) + '\u00d7 value' }), h('b', { text: ev.fit.slope.toFixed(3) })),
        h('div', { class: 'constant' }, h('span', { text: 'Global median mcap / TVL' }), h('b', { text: fmtMult(ev.global_median_ratio) })),
        h('div', { class: 'constant' }, h('span', { text: 'Development-holdout median miss (' + oos.test_n + ' held out)' }), h('b', { text: fmtErrMultiple(oos.med_abs_log_err) })),
        h('div', { class: 'constant' }, h('span', { text: 'Held-out comps predicted within 2\u00d7' }), h('b', { text: oos.within_2x === null ? 'n/a' : (oos.within_2x * 100).toFixed(1) + '%' })),
        h('div', { class: 'constant' }, h('span', { text: 'Model version' }), h('b', { text: DATA.model_version }))
      ),
      h('p', null, h('a', { href: '#/model', text: 'See the full evidence: the fit, the per-category adjustments, and the out-of-sample validation \u2192' })),
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
    var fit = DATA.evidence.fit;
    var catMult = Math.exp(row.category_adj);
    var factors = h('div', { class: 'factor-grid' },
      h('div', { class: 'factor' }, h('span', { text: 'Fitted core' }), h('b', { text: fmtUsd(row.core_value_usd) }), h('small', { text: 'exp(' + fit.intercept.toFixed(2) + ' + ' + fit.slope.toFixed(2) + ' \u00d7 ln TVL + adj)' })),
      h('div', { class: 'factor' }, h('span', { text: 'Category' }), h('b', { text: '\u00d7' + catMult.toFixed(2) }), h('small', { text: categoryOf(row) + ', ' + row.category_n + ' comp' + (row.category_n === 1 ? '' : 's') + (row.category_n === 0 ? ': global fit' : ', shrunk') })),
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
      h('p', { class: 'recompute', text: 'Model ' + DATA.model_version + ': the page recomputes this row from the snapshot figures and the fitted equation as ' + fmtUsd(recomputed) + (matches ? ', the same number the board carries.' : ', which differs from the board: the data would be stale.') + ' An estimate, not a price. See the Model & evidence view for the fit behind it.' }),
      facts,
      h('section', { class: 'panel plan', 'aria-labelledby': 'plan-title' },
        h('h2', { id: 'plan-title', text: 'Farm plan' }),
        h('p', { text: 'Six steps for ' + row.name + ', derived from its category, chains, TVL and age. Nothing here promises an airdrop: the protocol records no token, and the plan says what to do, what it costs, and how long it takes.' }),
        steps
      ),
      h('div', { class: 'note' }, h('b', { text: 'Before you farm. ' }), 'Use money you can afford to leave in the position, check every link from the protocol\u2019s own app, and never pay anyone to claim. A snapshot can only count activity it sees, so the hold matters more than the size.')
    );
  }

  // ---------- model & evidence view ----------

  function modelView(route) {
    var ev = DATA.evidence;
    var m = MODEL;
    var oos = ev.oos;
    var fit = ev.fit;
    var at100m = function (adj) { return Math.exp(fit.intercept + fit.slope * Math.log(100000000) + adj); };
    var oosRows = [
      ['Full pipeline (fitted core + adjustments)', oos.med_abs_log_err, oos.within_2x],
      ['Fitted core alone (no adjustments)', oos.core_med_abs_log_err, oos.core_within_2x],
      ['Baseline: one global median ratio', oos.baseline_med_abs_log_err, oos.baseline_within_2x],
    ];
    var oosBody = h('tbody');
    oosRows.forEach(function (r) {
      oosBody.appendChild(h('tr', null,
        h('td', { text: r[0] }),
        h('td', { class: 'num', text: r[1] === null ? 'n/a' : r[1].toFixed(3) }),
        h('td', { class: 'num', text: fmtErrMultiple(r[1]) }),
        h('td', { class: 'num', text: r[2] === null ? 'n/a' : (r[2] * 100).toFixed(1) + '%' })
      ));
    });
    var splitText = oos.method === 'time-split'
      ? 'Time split: the model was fitted on the ' + oos.train_n + ' comps listed up to ' + oos.split_date + ' and scored on the ' + oos.test_n + ' listed after it, which the fit never saw. The shipped board uses the fit on all ' + ev.comp_count + ' comps.'
      : oos.method === 'k-fold'
        ? 'K-fold split: ' + (oos.reason || 'the time split was degenerate, so a deterministic slug-hash fold stands in.') + ' The shipped board uses the fit on all ' + ev.comp_count + ' comps.'
        : 'No validation was possible: ' + (oos.reason || 'too few comps.');
    var catBody = h('tbody');
    ev.categories.forEach(function (c) {
      catBody.appendChild(h('tr', null,
        h('td', { text: c.category || 'No category' }),
        h('td', { class: 'num', text: String(c.n) }),
        h('td', { class: 'num', text: fmtMult(c.median_ratio) }),
        h('td', { class: 'num', text: fmtMult(Math.exp(c.adjustment)) }),
        h('td', { class: 'num', text: fmtUsd(at100m(c.adjustment)) })
      ));
    });
    var fittedCats = {};
    ev.categories.forEach(function (c) { fittedCats[c.category || ''] = true; });
    var noCompCats = [];
    DATA.rows.forEach(function (r) { var k = r.category || ''; if (!fittedCats[k] && noCompCats.indexOf(k) < 0) noCompCats.push(k); });
    return h('div', null,
      h('section', { class: 'hero' },
        h('h1', { text: 'The model is fitted, not guessed.' }),
        h('p', { class: 'lede' }, 'Every implied value on the board comes from one equation, fitted at run time on the ', h('b', { text: ev.comp_count + ' protocols in this snapshot that record a token' }), ' \u2014 their market caps are facts, and the model learns what the market pays per dollar of TVL from them. Nothing is hardcoded: hand the program a fresh snapshot and it refits. What follows is the whole fit, and how wrong it is out of sample.')
      ),
      h('div', { class: 'controls' }, viewTabs(route)),
      ev.fallback ? h('div', { class: 'note' }, h('b', { text: 'Fallback fit. ' }), ev.fallback_reason || 'Too few comps to fit.') : null,
      h('div', { class: 'stats' },
        h('div', { class: 'stat hot' }, h('b', { text: String(ev.comp_count) }), h('span', { text: 'Calibration comps with a recorded market cap' })),
        h('div', { class: 'stat' }, h('b', { text: fit.slope.toFixed(3) }), h('span', { text: 'Fitted slope: 10\u00d7 TVL \u2192 ' + Math.pow(10, fit.slope).toFixed(1) + '\u00d7 value (sublinear)' })),
        h('div', { class: 'stat' }, h('b', { text: fmtErrMultiple(oos.med_abs_log_err) }), h('span', { text: 'Development-holdout median miss (' + oos.test_n + ' held-out comps)' })),
        h('div', { class: 'stat' }, h('b', { text: oos.within_2x === null ? 'n/a' : (oos.within_2x * 100).toFixed(1) + '%' }), h('span', { text: 'Held-out comps predicted within 2\u00d7' }))
      ),
      h('section', { class: 'panel model', 'aria-labelledby': 'fit-title' },
        h('h2', { id: 'fit-title', text: 'The fitted equation' }),
        h('div', { class: 'formula', text: 'ln(implied core) = ' + fit.intercept.toFixed(3) + ' + ' + fit.slope.toFixed(3) + ' \u00d7 ln(tvl_usd) + category adjustment' }),
        h('div', { class: 'method' },
          h('h3', { text: 'How the fit is built, in four steps' }),
          h('p', { text: '1. Use positive-TVL and positive-market-cap comps. 2. Keep log ratios unclipped. 3. Fit ordinary least squares of log market cap on log TVL. 4. Shrink category median residuals toward zero using ' + m.shrink_k + ' pseudo-counts.' }),
          h('h3', { text: 'No unsupported valuation premiums' }),
          h('p', { text: 'Growth, listing age and chain breadth remain visible as context and inform farm plans, but their valuation multipliers are neutral. Grouped training-only cross-validation selected this simpler model. Listing age is not proven time without a token.' })
        )
      ),
      h('section', { class: 'panel model', 'aria-labelledby': 'oos-title' },
        h('h2', { id: 'oos-title', text: 'Development-holdout evaluation' }),
        h('p', { text: splitText }),
        h('div', { class: 'table-scroll' },
          h('table', null,
            h('caption', { text: 'Held-out error: median absolute log-error, the same error as a multiple, and the share predicted within 2\u00d7 of the recorded market cap.' }),
            h('thead', null, h('tr', null,
              h('th', { scope: 'col', text: 'Variant' }),
              h('th', { scope: 'col', text: 'Median |log error|' }),
              h('th', { scope: 'col', text: 'Typical miss' }),
              h('th', { scope: 'col', text: 'Within 2\u00d7' })
            )),
            oosBody
          )
        ),
        h('p', { text: 'This historically inspected development holdout is not a new independent test or a forward backtest: all TVLs and caps come from the same snapshot. Typical error remains about ' + fmtErrMultiple(oos.med_abs_log_err) + '. The observed improvement over v2 is small and its bootstrap interval crosses zero; statistical improvement is not established. Market cap is not FDV, protocol equity or a promised launch price.' })
      ),
      h('section', { class: 'panel model', 'aria-labelledby': 'cat-title' },
        h('h2', { id: 'cat-title', text: 'Per-category adjustments' }),
        h('p', { text: 'Each category\u2019s median comp ratio, and the shrunk adjustment the board applies. The last column prices the same $100M-TVL protocol in each category, before the growth, tenure and breadth multipliers, so the adjustments can be compared directly.' }),
        h('div', { class: 'table-scroll' },
          h('table', null,
            h('caption', { text: 'Categories ordered by comp count. Adjustments are shrunk toward \u00d71.00 with ' + m.shrink_k + ' pseudo-counts.' }),
            h('thead', null, h('tr', null,
              h('th', { scope: 'col', text: 'Category' }),
              h('th', { scope: 'col', text: 'Comps' }),
              h('th', { scope: 'col', text: 'Median mcap / TVL' }),
              h('th', { scope: 'col', text: 'Adjustment' }),
              h('th', { scope: 'col', text: '$100M protocol' })
            )),
            catBody
          )
        ),
        noCompCats.length ? h('p', { text: noCompCats.length + ' board categor' + (noCompCats.length === 1 ? 'y' : 'ies') + ' ha' + (noCompCats.length === 1 ? 's' : 've') + ' no comps and use' + (noCompCats.length === 1 ? 's' : '') + ' the global fit with no adjustment: ' + noCompCats.map(function (c) { return c || 'No category'; }).sort().join(', ') + '.' }) : null
      ),
      h('div', { class: 'note' }, h('b', { text: 'Honest limits. ' }), 'The comps are survivors: protocols whose tokens already trade and lived to be recorded. A pre-token protocol may never issue one, and if it does, its market may price it nothing like the comps. The snapshot is one day\u2019s record, market caps move daily, and this model never predicts whether or when a token is issued. Treat every implied value as a starting point for research, not a valuation.')
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
    else if (route.view === 'model') shell.appendChild(modelView(route));
    else shell.appendChild(boardView(route));
    shell.appendChild(footer());
    main.appendChild(shell);
    main.setAttribute('aria-busy', 'false');
  }

  window.addEventListener('hashchange', render);
  render();
})();
