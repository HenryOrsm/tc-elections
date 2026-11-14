(function () {
  'use strict';
  var EL = window.EL, h = EL.h, s = EL.s, clear = EL.clear;
  var CFG = window.ELECTION_CONFIG;
  var $ = function (id) { return document.getElementById(id); };

  var configured = CFG.supabaseUrl && CFG.supabaseAnonKey &&
    CFG.supabaseUrl.indexOf('PASTE') === -1 && CFG.supabaseAnonKey.indexOf('PASTE') === -1 && window.supabase;
  var sb = configured ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
  var demo = !sb;

  /* ---------- pricing maths (must match the database) ---------- */
  function cost(qy, qn, b) { var m = Math.max(qy, qn); return b * (m / b + Math.log(Math.exp((qy - m) / b) + Math.exp((qn - m) / b))); }
  function priceYes(qy, qn, b) { var m = Math.max(qy, qn), ey = Math.exp((qy - m) / b), en = Math.exp((qn - m) / b); return ey / (ey + en); }
  function sidePrice(side, m) { var p = priceYes(m.q_yes, m.q_no, m.b); return side === 'yes' ? p : 1 - p; }
  function buyShares(side, m, spend) {
    var mm = (cost(m.q_yes, m.q_no, m.b) + spend) / m.b, other = side === 'yes' ? m.q_no : m.q_yes;
    var qNew = m.b * (mm + Math.log(1 - Math.exp(other / m.b - mm)));
    return qNew - (side === 'yes' ? m.q_yes : m.q_no);
  }
  function sellProceeds(side, m, sh) {
    return cost(m.q_yes, m.q_no, m.b) - cost(side === 'yes' ? m.q_yes - sh : m.q_yes, side === 'no' ? m.q_no - sh : m.q_no, m.b);
  }

  function fmt(n, d) { n = Number(n); return n.toLocaleString(undefined, { maximumFractionDigits: d === undefined ? 2 : d, minimumFractionDigits: 0 }); }
  function pctText(p) { return Math.round(p * 100) + '%'; }
  function dia() {
    var svg = s('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', 'class': 'dia' });
    svg.appendChild(s('polygon', { points: '8,1 14.5,6 8,15 1.5,6', fill: '#3FD0D4', stroke: '#14788C', 'stroke-width': 1, 'stroke-linejoin': 'round' }));
    svg.appendChild(s('polygon', { points: '8,1 11,6 8,15 5,6', fill: '#9BF0F0', opacity: .7 }));
    return svg;
  }
  function dm(n) { return h('span', { 'class': 'dm' }, dia(), ' ' + fmt(n)); }

  /* ---------- data layer: real (Supabase) or demo (in memory) ---------- */
  var api;
  if (!demo) {
    var rpc = function (name, args) {
      return sb.rpc(name, args).then(function (r) { return r.error ? { ok: false, error: r.error.message } : r.data; },
        function () { return { ok: false, error: 'Could not reach the server.' }; });
    };
    api = {
      markets: function () {
        return sb.from('markets').select('id,question,description,kind,status,outcome,b,q_yes,q_no,closes_at,created_at')
          .order('created_at', { ascending: false }).then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      starter: function () {
        return sb.from('market_settings').select('value').eq('key', 'starter_diamonds').maybeSingle()
          .then(function (r) { return r.data ? Number(r.data.value) : null; }, function () { return null; });
      },
      register: function (u, p) { return rpc('market_register', { p_user: u, p_pin: p }); },
      login: function (u, p) { return rpc('market_login', { p_user: u, p_pin: p }); },
      buy: function (u, p, id, side, spend) { return rpc('market_buy', { p_user: u, p_pin: p, p_market: id, p_side: side, p_spend: spend }); },
      sell: function (u, p, id, side, sh) { return rpc('market_sell', { p_user: u, p_pin: p, p_market: id, p_side: side, p_shares: sh }); },
      propose: function (u, p, q, d, c) { return rpc('market_propose', { p_user: u, p_pin: p, p_question: q, p_description: d, p_closes_at: c }); },
      history: function (id) {
        return sb.rpc('market_history', { p_market: id }).then(function (r) { return r.error ? [] : r.data.map(function (x) { return Number(x.price_yes); }); }, function () { return []; });
      }
    };
  } else {
    var D = { wallets: {}, hist: {}, markets: [
      { id: 'd1', question: 'Will Candidate B win the Aljanna Mayor Election?', description: 'Settles when the polls close.', kind: 'candidate', status: 'open', outcome: null, b: 50, q_yes: 20, q_no: 0, closes_at: null, created_at: '2026-11-10' },
      { id: 'd2', question: 'Will Narellan and Cecilia merge by December?', description: 'Counts if an official merge is announced.', kind: 'custom', status: 'open', outcome: null, b: 50, q_yes: 0, q_no: 12, closes_at: null, created_at: '2026-11-11' },
      { id: 'd3', question: 'Will Og for Aljanna win the most Senate seats?', description: null, kind: 'senate', status: 'closed', outcome: null, b: 50, q_yes: 5, q_no: 5, closes_at: null, created_at: '2026-11-09' },
      { id: 'd4', question: 'Will the server hit 50 players this week?', description: null, kind: 'custom', status: 'settled', outcome: 'yes', b: 50, q_yes: 30, q_no: 0, closes_at: null, created_at: '2026-11-01' }
    ] };
    var done = function (v) { return Promise.resolve(v); };
    var W = function (u, p) { var w = D.wallets[u.toLowerCase().trim()]; return w && w.pin === p ? w : null; };
    var findM = function (id) { return D.markets.filter(function (m) { return m.id === id; })[0]; };
    api = {
      markets: function () { return done(JSON.parse(JSON.stringify(D.markets))); },
      starter: function () { return done(100); },
      register: function (u, p) {
        var k = u.toLowerCase().trim();
        if (!/^[a-z0-9_. ]{3,32}$/.test(k)) return done({ ok: false, error: 'That is not a valid Minecraft username.' });
        if (!/^[0-9]{4,8}$/.test(p)) return done({ ok: false, error: 'PIN must be 4 to 8 digits.' });
        if (D.wallets[k]) return done({ ok: false, error: 'That username already has a wallet. Log in with its PIN.' });
        D.wallets[k] = { name: u.trim(), pin: p, balance: 100, pos: {} };
        return done({ ok: true, name: u.trim(), balance: 100 });
      },
      login: function (u, p) {
        var w = W(u, p); if (!w) return done({ ok: false, error: 'Wrong username or PIN.' });
        return done({ ok: true, name: w.name, balance: w.balance, positions: Object.keys(w.pos).map(function (id) { return { market_id: id, yes: w.pos[id].yes, no: w.pos[id].no }; }) });
      },
      buy: function (u, p, id, side, spend) {
        var w = W(u, p), m = findM(id); if (!w) return done({ ok: false, error: 'Wrong PIN.' });
        if (!m || m.status !== 'open') return done({ ok: false, error: 'This market is not open for trading.' });
        if (spend < 0.01) return done({ ok: false, error: 'Spend at least 0.01 diamonds.' });
        if (spend > w.balance) return done({ ok: false, error: 'Not enough diamonds.' });
        var sh = buyShares(side, m, spend);
        if (side === 'yes') m.q_yes += sh; else m.q_no += sh;
        w.balance -= spend; var ps = w.pos[id] = w.pos[id] || { yes: 0, no: 0 }; ps[side] += sh;
        (D.hist[id] = D.hist[id] || []).push(priceYes(m.q_yes, m.q_no, m.b));
        return done({ ok: true, shares: sh, spent: spend, balance: w.balance });
      },
      sell: function (u, p, id, side, sh) {
        var w = W(u, p), m = findM(id); if (!w) return done({ ok: false, error: 'Wrong PIN.' });
        if (!m || m.status !== 'open') return done({ ok: false, error: 'This market is not open for trading.' });
        var ps = w.pos[id] || { yes: 0, no: 0 }; sh = Math.min(sh, ps[side]);
        if (sh < 0.0001) return done({ ok: false, error: 'You do not hold that many shares.' });
        var got = sellProceeds(side, m, sh);
        if (side === 'yes') m.q_yes -= sh; else m.q_no -= sh;
        ps[side] -= sh; w.balance += got; (D.hist[id] = D.hist[id] || []).push(priceYes(m.q_yes, m.q_no, m.b));
        return done({ ok: true, shares: sh, received: got, balance: w.balance });
      },
      propose: function () { return done({ ok: true }); },
      history: function (id) { return done((D.hist[id] || []).slice()); }
    };
  }

  /* ---------- state ---------- */
  var SKEY = 'mkt-session';
  function loadSession() { try { return JSON.parse(sessionStorage.getItem(SKEY)); } catch (e) { return null; } }
  function saveSession(v) { try { if (v) sessionStorage.setItem(SKEY, JSON.stringify(v)); else sessionStorage.removeItem(SKEY); } catch (e) {} }
  var session = loadSession();            // { user, pin }
  var wallet = null;                       // { name, balance, pos: { marketId: {yes,no} } }
  var markets = [];
  var starter = null;
  var hist = {};
  var ui = { openId: null, side: 'yes', mode: 'buy', amount: '10' };

  function say(id, text, isErr) { var m = $(id); m.textContent = text || ''; m.className = 'msg' + (isErr ? ' err' : ''); }
  function isOpen(m) { return m.status === 'open' && (!m.closes_at || new Date(m.closes_at) > new Date()); }
  function posOf(id) { return (wallet && wallet.pos[id]) || { yes: 0, no: 0 }; }

  function applyLogin(r, creds) {
    if (!r || !r.ok) return false;
    wallet = { name: r.name, balance: Number(r.balance), pos: {} };
    (r.positions || []).forEach(function (p) { wallet.pos[p.market_id] = { yes: Number(p.yes), no: Number(p.no) }; });
    session = creds; saveSession(creds);
    return true;
  }
  function refreshWallet() {
    if (!session) { wallet = null; return Promise.resolve(); }
    return api.login(session.user, session.pin).then(function (r) {
      if (!applyLogin(r, session)) { session = null; wallet = null; saveSession(null); }
    });
  }
  function refreshMarkets() {
    return api.markets().then(function (list) { markets = list.map(function (m) { m.q_yes = Number(m.q_yes); m.q_no = Number(m.q_no); m.b = Number(m.b); return m; }); })
      .catch(function () {
        var e = $('load-error'); e.hidden = false;
        e.textContent = 'Markets could not load. Run add-markets.sql in Supabase if you have not yet.';
      });
  }
  function refreshAll() { return Promise.all([refreshMarkets(), refreshWallet()]).then(renderAll); }

  /* ---------- wallet card ---------- */
  function renderWallet() {
    var box = $('wallet'); clear(box);
    $('st-bal').textContent = wallet ? fmt(wallet.balance) : '-';
    if (wallet) {
      box.appendChild(h('p', { style: 'margin:0 0 10px' }, 'Signed in as ', h('b', { text: wallet.name }), '. Balance: ', h('b', null, dm(wallet.balance))));
      box.appendChild(h('button', { 'class': 'btn small ghost', type: 'button', text: 'Log out', onclick: function () { session = null; wallet = null; saveSession(null); renderAll(); } }));
      box.appendChild(h('p', { 'class': 'muted', style: 'margin:10px 0 0', text: 'To add or cash out real diamonds, hand them to an admin in-game and they will update your balance.' }));
      return;
    }
    var user = h('input', { id: 'w-user', type: 'text', maxlength: 32, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    var pin = h('input', { id: 'w-pin', type: 'password', inputmode: 'numeric', maxlength: 8, autocomplete: 'off', placeholder: '4 to 8 digits' });
    var msg = h('div', { 'class': 'msg', role: 'status' });
    function creds() { return { user: user.value.trim(), pin: pin.value.trim() }; }
    function go(fn) {
      var c = creds();
      if (!c.user || !c.pin) { msg.textContent = 'Enter your username and a PIN.'; msg.className = 'msg err'; return; }
      msg.textContent = 'One sec...'; msg.className = 'msg';
      fn(c).then(function (r) {
        if (!r.ok) { msg.textContent = r.error || 'That did not work.'; msg.className = 'msg err'; return; }
        // after register, log in to load positions
        return api.login(c.user, c.pin).then(function (lr) { applyLogin(lr, c); return refreshMarkets(); }).then(renderAll);
      });
    }
    var form = h('form', { style: 'max-width:520px', novalidate: 'novalidate' },
      h('div', { 'class': 'field' }, h('label', { 'for': 'w-user', text: 'Minecraft username' }), user),
      h('div', { 'class': 'field' }, h('label', { 'for': 'w-pin', text: 'PIN' }), pin,
        h('span', { 'class': 'hint', text: 'New here? Pick any PIN and press Create wallet' + (starter ? ' to get ' + fmt(starter) + ' free diamonds' : '') + '. You need the same PIN every time, so remember it. Admins can reset it.' })),
      h('div', { 'class': 'acts', style: 'display:flex;gap:8px;flex-wrap:wrap' },
        h('button', { 'class': 'btn', type: 'submit', text: 'Log in' }),
        h('button', { 'class': 'btn ghost', type: 'button', text: 'Create wallet', onclick: function () { go(function (c) { return api.register(c.user, c.pin); }); } })),
      msg);
    form.addEventListener('submit', function (e) { e.preventDefault(); go(function (c) { return api.login(c.user, c.pin); }); });
    box.appendChild(form);
  }

  /* ---------- price history chart ---------- */
  function chart(vals) {
    var W = 320, H = 90, svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'spark', role: 'img', 'aria-label': 'Yes price history' });
    svg.appendChild(s('line', { x1: 0, x2: W, y1: H / 2, y2: H / 2, stroke: '#C9D1DE', 'stroke-dasharray': '3 4' }));
    var pts = [0.5].concat(vals || []);
    if (pts.length < 2) { return svg; }
    var d = pts.map(function (p, i) { return (i / (pts.length - 1) * (W - 8) + 4).toFixed(1) + ',' + ((1 - p) * (H - 10) + 5).toFixed(1); }).join(' ');
    svg.appendChild(s('polyline', { points: d, fill: 'none', stroke: '#1063DF', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    return svg;
  }

  /* ---------- a market card ---------- */
  function badge(m) {
    if (m.status === 'settled') return h('span', { 'class': 'badge', text: m.outcome === 'void' ? 'Voided, refunded' : 'Settled: ' + (m.outcome === 'yes' ? 'Yes' : 'No') });
    if (!isOpen(m)) return h('span', { 'class': 'badge', text: 'Trading closed' });
    return h('span', { 'class': 'badge', text: 'Open' });
  }

  function tradePanel(m) {
    var box = h('div', { 'class': 'trade' });
    var hold = posOf(m.id);
    var side = ui.side, mode = ui.mode;
    var sideBtns = h('div', { 'class': 'seg' },
      h('button', { type: 'button', 'class': side === 'yes' ? 'on yes' : '', text: 'Yes ' + pctText(sidePrice('yes', m)), onclick: function () { ui.side = 'yes'; renderMarkets(); } }),
      h('button', { type: 'button', 'class': side === 'no' ? 'on no' : '', text: 'No ' + pctText(sidePrice('no', m)), onclick: function () { ui.side = 'no'; renderMarkets(); } }));
    var modeBtns = h('div', { 'class': 'seg' },
      h('button', { type: 'button', 'class': mode === 'buy' ? 'on' : '', text: 'Buy', onclick: function () { ui.mode = 'buy'; ui.amount = '10'; renderMarkets(); } }),
      h('button', { type: 'button', 'class': mode === 'sell' ? 'on' : '', text: 'Sell', onclick: function () { ui.mode = 'sell'; ui.amount = String(Math.floor(posOf(m.id)[ui.side] * 100) / 100 || ''); renderMarkets(); } }));
    var input = h('input', { type: 'number', min: 0, step: 'any', value: ui.amount, 'aria-label': mode === 'buy' ? 'Diamonds to spend' : 'Shares to sell', inputmode: 'decimal' });
    var preview = h('div', { 'class': 'preview' });
    var msg = h('div', { 'class': 'msg', role: 'status' });
    var go = h('button', { 'class': 'btn', type: 'button' });

    function amt() { var v = parseFloat(input.value); return isFinite(v) && v > 0 ? v : 0; }
    function upd() {
      ui.amount = input.value; var a = amt(); clear(preview);
      if (mode === 'buy') {
        go.textContent = wallet ? 'Buy ' + (side === 'yes' ? 'Yes' : 'No') : 'Log in to trade';
        if (!a) { preview.textContent = 'Enter how many diamonds to spend.'; return; }
        if (a * 1 > 1e6) { preview.textContent = 'That is too large.'; return; }
        var sh = buyShares(side, m, a);
        preview.appendChild(h('span', null, 'You get about ', h('b', { text: fmt(sh) }), ' ' + side.toUpperCase() + ' shares (avg ' + fmt(a / sh, 3) + ' each). Pays ', dm(sh), ' if ' + (side === 'yes' ? 'Yes' : 'No') + ', a profit of ', dm(sh - a), '.'));
      } else {
        go.textContent = wallet ? 'Sell ' + (side === 'yes' ? 'Yes' : 'No') : 'Log in to trade';
        if (!a) { preview.textContent = hold[side] > 0 ? 'Enter how many shares to sell.' : 'You hold no ' + side.toUpperCase() + ' shares here.'; return; }
        var sell = Math.min(a, hold[side]);
        preview.appendChild(h('span', null, 'Sell ', h('b', { text: fmt(sell) }), ' shares for about ', dm(sellProceeds(side, m, sell)), '.'));
      }
    }
    input.addEventListener('input', upd);

    var quick = h('div', { 'class': 'quick' });
    if (mode === 'buy') {
      [5, 10, 25, 50].forEach(function (n) { quick.appendChild(h('button', { type: 'button', 'class': 'btn small ghost', text: String(n), onclick: function () { input.value = n; upd(); } })); });
      quick.appendChild(h('button', { type: 'button', 'class': 'btn small ghost', text: 'Max', onclick: function () { input.value = wallet ? Math.floor(wallet.balance * 100) / 100 : ''; upd(); } }));
    } else {
      quick.appendChild(h('button', { type: 'button', 'class': 'btn small ghost', text: 'All', onclick: function () { input.value = Math.floor(hold[side] * 100) / 100 || ''; upd(); } }));
    }

    go.addEventListener('click', function () {
      if (!wallet) { say('p-msg', ''); $('wallet-card').scrollIntoView({ behavior: 'smooth' }); var u = $('w-user'); if (u) u.focus(); return; }
      var a = amt(); if (!a) { msg.textContent = 'Enter an amount first.'; msg.className = 'msg err'; return; }
      go.disabled = true; msg.textContent = 'Placing order...'; msg.className = 'msg';
      var p = mode === 'buy' ? api.buy(session.user, session.pin, m.id, side, a) : api.sell(session.user, session.pin, m.id, side, Math.min(a, hold[side]));
      p.then(function (r) {
        go.disabled = false;
        if (!r.ok) { msg.textContent = r.error || 'That did not work.'; msg.className = 'msg err'; return; }
        delete hist[m.id];
        say('m-msg', mode === 'buy' ? 'Bought ' + fmt(r.shares) + ' ' + side.toUpperCase() + ' shares for ' + fmt(r.spent) + ' diamonds.' : 'Sold ' + fmt(r.shares) + ' ' + side.toUpperCase() + ' shares for ' + fmt(r.received) + ' diamonds.', false);
        return refreshAll();
      });
    });

    var chartBox = h('div', { 'class': 'chartbox' });
    if (hist[m.id]) chartBox.appendChild(chart(hist[m.id]));
    else api.history(m.id).then(function (v) { hist[m.id] = v; clear(chartBox); chartBox.appendChild(chart(v)); });
    box.appendChild(h('div', { 'class': 'trade-row' }, sideBtns, modeBtns));
    box.appendChild(h('div', { 'class': 'field', style: 'margin:10px 0 6px' }, h('label', { text: mode === 'buy' ? 'Diamonds to spend' : 'Shares to sell' }), input));
    box.appendChild(quick); box.appendChild(preview); box.appendChild(go); box.appendChild(msg);
    box.appendChild(h('p', { 'class': 'muted', style: 'margin:12px 0 4px', text: 'Yes price over time' })); box.appendChild(chartBox);
    upd();
    return box;
  }

  function marketCard(m) {
    var py = priceYes(m.q_yes, m.q_no, m.b), open = isOpen(m), mine = posOf(m.id);
    var card = h('article', { 'class': 'card mkt' });
    card.appendChild(h('div', { 'class': 'mkt-head' }, h('h3', { text: m.question }), badge(m)));
    if (m.description) card.appendChild(h('p', { 'class': 'muted', style: 'margin:4px 0 10px', text: m.description }));
    card.appendChild(h('div', { 'class': 'odds' },
      h('div', { 'class': 'yes' }, h('b', { text: pctText(py) }), h('span', { text: 'Yes · ' + py.toFixed(2) + ' per share' })),
      h('div', { 'class': 'no' }, h('b', { text: pctText(1 - py) }), h('span', { text: 'No · ' + (1 - py).toFixed(2) + ' per share' }))));
    card.appendChild(h('div', { 'class': 'oddsbar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + (py * 100).toFixed(1) + '%' })));
    if (mine.yes > 0.0001 || mine.no > 0.0001) {
      var bits = [];
      if (mine.yes > 0.0001) bits.push(fmt(mine.yes) + ' Yes');
      if (mine.no > 0.0001) bits.push(fmt(mine.no) + ' No');
      var line = 'You hold ' + bits.join(' and ') + '.';
      if (m.status === 'settled' && m.outcome && m.outcome !== 'void') line += ' ' + ((m.outcome === 'yes' ? mine.yes : mine.no) > 0.0001 ? 'Paid out ' + fmt(m.outcome === 'yes' ? mine.yes : mine.no) + ' diamonds.' : 'No payout.');
      card.appendChild(h('p', { 'class': 'mine', text: line }));
    }
    if (open) {
      var isThis = ui.openId === m.id;
      card.appendChild(h('button', { 'class': 'btn small' + (isThis ? '' : ' ghost'), type: 'button', text: isThis ? 'Hide trading' : 'Trade',
        onclick: function () { ui.openId = isThis ? null : m.id; ui.mode = 'buy'; ui.amount = '10'; renderMarkets(); } }));
      if (isThis) card.appendChild(tradePanel(m));
    }
    return card;
  }

  function renderMarkets() {
    var groups = { open: [], wait: [], done: [] };
    markets.forEach(function (m) { (m.status === 'settled' ? groups.done : isOpen(m) ? groups.open : groups.wait).push(m); });
    $('st-open').textContent = groups.open.length;
    [['sec-open', 'Open markets', groups.open, 'No open markets right now.'], ['sec-wait', 'Waiting for a result', groups.wait, null], ['sec-done', 'Settled', groups.done, null]].forEach(function (g) {
      var sec = $(g[0]); clear(sec);
      if (!g[2].length && !g[3]) return;
      sec.appendChild(h('h2', { 'class': 'sect', text: g[1] }));
      if (!g[2].length) sec.appendChild(h('p', { 'class': 'muted', text: g[3] }));
      var grid = h('div', { 'class': 'mkt-grid' });
      g[2].forEach(function (m) { grid.appendChild(marketCard(m)); });
      sec.appendChild(grid);
    });
    $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
  }

  function renderAll() { renderWallet(); renderMarkets(); }

  /* ---------- suggest a market ---------- */
  $('prop-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!wallet) { say('p-msg', 'Log in to your wallet first.', true); return; }
    var q = $('p-q').value.trim(); if (q.length < 5) { say('p-msg', 'Write the question out (at least 5 characters).', true); return; }
    var c = $('p-c').value ? new Date($('p-c').value).toISOString() : null;
    say('p-msg', 'Sending...', false);
    api.propose(session.user, session.pin, q, $('p-d').value.trim(), c).then(function (r) {
      if (!r.ok) { say('p-msg', r.error || 'That did not work.', true); return; }
      say('p-msg', 'Sent. It appears once an admin approves it.', false);
      $('p-q').value = ''; $('p-d').value = ''; $('p-c').value = '';
    });
  });
  $('refresh').addEventListener('click', refreshAll);

  /* ---------- start ---------- */
  $('demo-banner').hidden = !demo;
  renderAll();
  api.starter().then(function (v) { starter = v; if (!wallet) renderWallet(); });
  refreshAll();
  setInterval(function () {
    var a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;   // don't wipe what someone is typing
    refreshAll();
  }, Math.max(10, CFG.refreshSeconds || 20) * 1000);
})();
