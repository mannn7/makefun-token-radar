// Token Radar dashboard: reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, a per-protocol detail view and a live-token view. No network: every byte it shows
// is in data.js. Views are hash-routed so each one has its own URL: #/ is the board,
// #/p/<slug> is one protocol's detail, #/?q=&cat=&chain=&wl=&tab= filters the board.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;

  var MODEL = DATA.model;
  // The watchlist slugs, so the page can badge them and filter to them.
  var wlSet = {};
  (DATA.watchlist || []).forEach(function (s) { wlSet[s] = true; });

  var state = { q: '', cat: 'all', chain: 'all', wl: false, tab: 'pre', sort: 'rank', dir: 1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return usd0.format(n);
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
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // The model, recomputed in the page from the snapshot figures so the page's arithmetic and the
  // board's data are visibly the same: TVL sets the scale, 7-day growth the momentum, tokenless age
  // the overdue factor. Same constants as lib/model.ts.
  function impliedOf(row) {
    var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * MODEL.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? MODEL.unknown_age_days : row.age_days;
    var maturity = MODEL.maturity_floor + (Math.min(Math.max(age, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
    return { implied: Math.max(1, Math.round(row.tvl_usd * MODEL.base_multiple * growthMult * maturity)), growth: growth, growthMult: growthMult, maturity: maturity, age: age };
  }

  // The farm plan, the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e10) return 300;
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 75;
    if (age < 365) return 60;
    return 45;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and leave the supply open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('amm') >= 0 || c.indexOf('swap') >= 0) return 'Add $' + capital + ' of liquidity to ' + name + "'s busiest pool on " + chain + ' and leave the position open.';
    if (c.indexOf('yield') >= 0 || c.indexOf('vault') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds inside its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('perp') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and take one market position on ' + name + '.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy live.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyFor(p, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $10 against the supply once a week and repay it the same day.';
    if (c.indexOf('dex') >= 0 || c.indexOf('amm') >= 0 || c.indexOf('swap') >= 0) return "Swap $10 through " + name + "'s main pool once a week so the wallet shows repeated use.";
    if (c.indexOf('yield') >= 0 || c.indexOf('vault') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Top up the vault by $10 once a week and let the shares compound.';
    if (c.indexOf('bridge') >= 0) return 'Move $10 across ' + name + ' once a week, alternating the direction.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Claim the staking rewards once a week and restake them through ' + name + '.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('perp') >= 0) return 'Close and reopen the small hedge once a week to keep the margin account active.';
    if (c.indexOf('prediction') >= 0) return 'Settle one small market position a week on ' + name + '.';
    if (c.indexOf('stable') >= 0) return 'Mint and redeem $10 of the stable asset once a week through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Check the yield accrual once a week and add $10 when the rate holds.';
    if (c.indexOf('insurance') >= 0) return 'Review the cover once a week and renew it before it lapses.';
    return 'Make one qualifying action each week: a deposit, a swap, a borrow or a vote.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = capital >= 200 ? 8 : 4;
    return [
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper kept offline.', cost: 'no cost to create; under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: weeklyFor(p, chain), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Keep the position open for at least ' + hold + ' days so the activity spans more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before withdrawing, open " + p.name + "'s own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Record the wallet, the dates and every transaction hash in a farm log so the position can be repeated or unwound.', cost: 'nothing but the log', time: '5 minutes' }
    ];
  }

  // ---- hash routing ----
  function readHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var next = { q: '', cat: 'all', chain: 'all', wl: false, tab: 'pre', sort: 'rank', dir: 1, selected: null };
    if (h.indexOf('p/') === 0) { next.selected = decodeURIComponent(h.slice(2).split('?')[0]); return next; }
    var qi = h.indexOf('?');
    if (qi >= 0) {
      h.slice(qi + 1).split('&').forEach(function (kv) {
        var p = kv.split('=');
        var k = decodeURIComponent(p[0] || ''), v = decodeURIComponent(p[1] || '');
        if (k === 'q') next.q = v;
        if (k === 'cat') next.cat = v;
        if (k === 'chain') next.chain = v;
        if (k === 'wl') next.wl = v === '1';
        if (k === 'tab') next.tab = v === 'live' ? 'live' : 'pre';
        if (k === 'sort') next.sort = v;
        if (k === 'dir') next.dir = v === '-1' ? -1 : 1;
      });
    }
    return next;
  }
  function writeHash() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.cat !== 'all') parts.push('cat=' + encodeURIComponent(state.cat));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.wl) parts.push('wl=1');
    if (state.tab !== 'pre') parts.push('tab=' + state.tab);
    if (state.sort !== 'rank') parts.push('sort=' + state.sort);
    if (state.dir !== 1) parts.push('dir=-1');
    var h = state.selected ? '#/p/' + encodeURIComponent(state.selected) : '#/' + (parts.length ? '?' + parts.join('&') : '');
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  // ---- filtering & sorting ----
  function filteredRows() {
    var rows = state.tab === 'live' ? DATA.live.slice() : DATA.rows.slice();
    var q = state.q.trim().toLowerCase();
    if (q) rows = rows.filter(function (r) { return (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) >= 0; });
    if (state.cat !== 'all') rows = rows.filter(function (r) { return r.category === state.cat; });
    if (state.chain !== 'all') rows = rows.filter(function (r) { return (r.chains || []).indexOf(state.chain) >= 0; });
    if (state.wl && state.tab === 'pre') rows = rows.filter(function (r) { return wlSet[r.slug]; });
    var key = state.sort, dir = state.dir;
    var val = function (r) {
      if (key === 'implied') return r.implied_value_usd || r.mcap_usd || 0;
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'mcap') return r.mcap_usd || 0;
      return r.rank || 0;
    };
    rows.sort(function (a, b) { return (val(a) - val(b)) * dir || (a.slug < b.slug ? -1 : 1); });
    return rows;
  }

  function categories() {
    var seen = {}, out = [];
    DATA.rows.concat(DATA.live).forEach(function (r) { if (r.category && !seen[r.category]) { seen[r.category] = 1; out.push(r.category); } });
    return out.sort();
  }
  function chains() {
    var seen = {}, out = [];
    DATA.rows.concat(DATA.live).forEach(function (r) { (r.chains || []).forEach(function (c) { if (!seen[c]) { seen[c] = 1; out.push(c); } }); });
    return out.sort();
  }

  // ---- rendering ----
  var totalImplied = DATA.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
  var cats = categories(), chs = chains();

  function headerHtml() {
    return '<header class="top"><div class="wrap">' +
      '<p class="eyebrow">Token Radar · ' + esc(DATA.model_version) + ' · snapshot ' + esc(DATA.as_of) + '</p>' +
      '<h1>Protocols with no token yet, ranked by what the token would be worth</h1>' +
      '<p class="sub">Every row below <b>records no token</b> in the snapshot. Implied value follows from the ' +
      'protocol\u2019s own figures — its TVL, its seven-day growth, and how long it has run with no token — ' +
      'never from a list of names. Wrapped, staked and bridged products of tokens that already trade are left out.</p>' +
      '<div class="stats">' +
      '<div class="stat"><div class="num">' + DATA.board_size + '</div><div class="lbl">Pre-token rows</div></div>' +
      '<div class="stat"><div class="num amber">' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</div><div class="lbl">Watchlist covered</div></div>' +
      '<div class="stat"><div class="num green">' + fmtUsd(totalImplied) + '</div><div class="lbl">Total implied value</div></div>' +
      '<div class="stat"><div class="num">' + DATA.live_size + '</div><div class="lbl">Live tokens set aside</div></div>' +
      '</div></div></header>';
  }

  function controlsHtml(count) {
    var opts = function (list, cur, allLabel) {
      var h = '<option value="all"' + (cur === 'all' ? ' selected' : '') + '>' + allLabel + '</option>';
      list.forEach(function (v) { h += '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(v) + '</option>'; });
      return h;
    };
    return '<div class="controls"><div class="inner">' +
      '<div class="tabs" role="group" aria-label="Board">' +
      '<button class="tab" data-tab="pre" aria-pressed="' + (state.tab === 'pre') + '">Pre-token board</button>' +
      '<button class="tab" data-tab="live" aria-pressed="' + (state.tab === 'live') + '">Live tokens</button>' +
      '</div>' +
      '<input type="search" id="q" placeholder="Search name, slug or category…" value="' + esc(state.q) + '" aria-label="Search protocols">' +
      '<select id="cat" aria-label="Category">' + opts(cats, state.cat, 'All categories') + '</select>' +
      '<select id="chain" aria-label="Chain">' + opts(chs, state.chain, 'All chains') + '</select>' +
      '<label class="check"><input type="checkbox" id="wl"' + (state.wl ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count">' + count + ' shown</span>' +
      '</div></div>';
  }

  function sortArrow(key) {
    if (state.sort !== key) return '';
    return ' <span class="arrow">' + (state.dir === 1 ? '▲' : '▼') + '</span>';
  }
  function th(label, key, cls) {
    return '<th class="sortable ' + (cls || '') + '" data-sort="' + key + '">' + label + sortArrow(key) + '</th>';
  }

  function boardHtml(rows) {
    if (!rows.length) return '<main><p class="empty">Nothing matches this filter. Clear the search or pick another category.</p></main>';
    var live = state.tab === 'live';
    var h = '<main><table class="board"><thead><tr>';
    if (!live) h += th('#', 'rank', '');
    h += '<th>Protocol</th><th>Category</th><th>Chains</th>';
    h += th('TVL', 'tvl', 'num') + th('7d', 'change', 'num');
    if (!live) h += th('Age', 'age', 'num') + th('Implied value', 'implied', 'num');
    else h += th('Market cap', 'mcap', 'num');
    h += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var badge = live ? '<span class="badge live">Live</span>' : (wlSet[r.slug] ? '<span class="badge wl">Watchlist</span>' : '<span class="badge early">Early</span>');
      var chg = r.change_7d === null ? 'n/a' : '<span class="' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</span>';
      h += '<tr data-slug="' + esc(r.slug) + '" tabindex="0">';
      if (!live) h += '<td><span class="rank' + (r.rank <= 3 ? ' top3' : '') + '">#' + r.rank + '</span></td>';
      h += '<td><span class="pname">' + esc(r.name) + badge + '<span class="slug">' + esc(r.slug) + '</span></span></td>';
      h += '<td class="cat">' + esc(r.category || '—') + '</td>';
      h += '<td class="cat">' + esc((r.chains || []).slice(0, 3).join(', ') || '—') + '</td>';
      h += '<td class="num">' + fmtUsd(r.tvl_usd) + '</td><td class="num">' + chg + '</td>';
      if (!live) h += '<td class="num">' + fmtAge(r.age_days) + '</td><td class="num imp">' + fmtUsd(r.implied_value_usd) + '</td>';
      else h += '<td class="num imp">' + fmtUsd(r.mcap_usd) + '</td>';
      h += '</tr>';
    });
    return h + '</tbody></table></main>';
  }

  function detailHtml(row, isLive) {
    var m = isLive ? null : impliedOf(row);
    var base = isLive ? null : Math.round(row.tvl_usd * MODEL.base_multiple);
    var steps = isLive ? null : farmSteps(row);
    var h = '<main><div class="detail">';
    h += '<button class="back" id="back">← Back to the board</button>';
    h += '<h2>' + esc(row.name) + (isLive ? ' <span class="badge live">Live token</span>' : (wlSet[row.slug] ? ' <span class="badge wl">Watchlist</span>' : ' <span class="badge early">Early find</span>')) + '</h2>';
    h += '<p class="meta">' + esc(row.slug) + ' · ' + esc(row.category || 'no category') + ' · ' + esc((row.chains || []).join(', ') || 'no chains listed') + '</p>';
    h += '<div class="grid">';
    h += '<div class="card"><h3>Snapshot figures · ' + esc(DATA.as_of) + '</h3>';
    h += kv('TVL', fmtFull(row.tvl_usd));
    h += kv('7-day change', row.change_7d === null ? 'not reported' : fmtPct(row.change_7d));
    h += kv('Tracked since', row.listed_at || 'not reported');
    h += kv('Tokenless age', fmtAge(row.age_days));
    if (isLive) h += kv('Token market cap', fmtFull(row.mcap_usd));
    else h += kv('Token', 'records no token');
    h += '</div>';
    if (!isLive) {
      h += '<div class="card"><h3>Implied value · model ' + esc(DATA.model_version) + '</h3>';
      h += kv('Base · TVL × ' + MODEL.base_multiple, fmtFull(base));
      h += kv('Growth × ' + m.growthMult.toFixed(2), fmtPct(m.growth) + ' over 7 days');
      h += kv('Maturity × ' + m.maturity.toFixed(2), fmtAge(m.age) + ' with no token');
      h += kv('Implied value', fmtFull(row.implied_value_usd));
      h += '<p class="note">The page recomputes the value from the same figures and gets ' + fmtFull(m.implied) + ' — the board and the page agree.</p>';
      h += '<div class="formula">implied = round(TVL × ' + MODEL.base_multiple + ' × growth × maturity)</div>';
      h += '<div style="margin-top:12px">' + barRow('Growth', m.growthMult, 1.6, m.growthMult.toFixed(2) + '×') + barRow('Maturity', m.maturity, 1.0, m.maturity.toFixed(2) + '×') + '</div>';
      h += '</div>';
    } else {
      h += '<div class="card"><h3>Why it is set aside</h3><p style="margin:0">This protocol\u2019s token already trades, so the radar shows the market\u2019s own value — a market cap of ' + fmtFull(row.mcap_usd) + ' — instead of a model\u2019s guess. The ranked board is for protocols that record no token.</p></div>';
    }
    h += '</div>';
    if (!isLive) {
      h += '<div class="card" style="margin-top:14px"><h3>Farm plan · six steps</h3><ol class="steps">';
      steps.forEach(function (s) {
        h += '<li>' + esc(s.text) + '<br><span class="cost">Cost: ' + esc(s.cost) + '</span><span class="time">Time: ' + esc(s.time) + '</span></li>';
      });
      h += '</ol><p class="note">Steps follow from this protocol\u2019s own record — its category, its chains, its TVL and its age — not from a list of names. Costs are in USDC and gas; times are wall-clock estimates.</p></div>';
    }
    return h + '</div></main>';
  }
  function kv(k, v) { return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>'; }
  function barRow(label, val, max, text) {
    var pct = Math.max(2, Math.min(100, Math.round((val / max) * 100)));
    return '<div class="bar-row"><span class="bl">' + esc(label) + '</span><span class="bar"><i style="width:' + pct + '%"></i></span><span class="bv">' + esc(text) + '</span></div>';
  }

  function footerHtml() {
    return '<footer><div class="wrap">' +
      '<p><b>How the radar scores.</b> Implied value = TVL × ' + MODEL.base_multiple + ' × growth × maturity. ' +
      'Growth is the 7-day TVL change clamped to ' + MODEL.growth_floor + '%…+' + MODEL.growth_cap + '%, weighted ×' + MODEL.growth_weight + '. ' +
      'Maturity runs ' + MODEL.maturity_floor + '–' + (MODEL.maturity_floor + MODEL.maturity_range) + ' over ' + MODEL.maturity_days + ' tokenless days (' + MODEL.unknown_age_days + ' days when the listing date is unknown). ' +
      'Model ' + esc(DATA.model_version) + ', snapshot ' + esc(DATA.as_of) + ', watchlist floor ' + fmtFull(DATA.floor_usd) + '.</p>' +
      '<p>“Records no token” means the snapshot records no token for the protocol — never that it has none. ' +
      'Wrapped, staked and bridged products of tokens that already trade, exchanges and versioned pools are not ranked. ' +
      'Nothing here is a prediction that a token will be issued, or when.</p>' +
      '</div></footer>';
  }

  function render() {
    state = readHash();
    var rows = filteredRows();
    var html = headerHtml();
    if (state.selected) {
      var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
      var live = !row ? DATA.live.filter(function (r) { return r.slug === state.selected; })[0] : null;
      if (row) html += detailHtml(row, false);
      else if (live) html += detailHtml(live, true);
      else html += '<main><p class="empty">No protocol with that slug in this snapshot.</p></main>';
      html += footerHtml();
    } else {
      html += controlsHtml(rows.length) + boardHtml(rows) + footerHtml();
    }
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');
    bind();
  }

  function bind() {
    var q = document.getElementById('q');
    if (q) {
      q.addEventListener('input', function () { state.q = q.value; writeHash(); render(); var nq = document.getElementById('q'); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } });
    }
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.cat = cat.value; writeHash(); render(); });
    var chain = document.getElementById('chain');
    if (chain) chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });
    var wl = document.getElementById('wl');
    if (wl) wl.addEventListener('change', function () { state.wl = wl.checked; writeHash(); render(); });
    document.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); state.selected = null; writeHash(); render(); });
    });
    document.querySelectorAll('th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (state.sort === k) state.dir = -state.dir;
        else { state.sort = k; state.dir = k === 'rank' ? 1 : -1; }
        writeHash(); render();
      });
    });
    document.querySelectorAll('tr[data-slug]').forEach(function (tr) {
      var go = function () { state.selected = tr.getAttribute('data-slug'); writeHash(); render(); window.scrollTo(0, 0); };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    });
    var back = document.getElementById('back');
    if (back) back.addEventListener('click', function () { state.selected = null; writeHash(); render(); });
  }

  window.addEventListener('hashchange', render);
  render();
})();
