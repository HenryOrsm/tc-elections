(function () {
  'use strict';
  var EL = window.EL, h = EL.h, s = EL.s, clear = EL.clear;
  var CFG = window.ELECTION_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var configured = CFG.supabaseUrl && CFG.supabaseAnonKey &&
    CFG.supabaseUrl.indexOf('PASTE') === -1 && CFG.supabaseAnonKey.indexOf('PASTE') === -1 && window.supabase;
  var sb = configured ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;

  var SKEY = 'mkt-session';           // same login as the Markets page
  function loadSession() { try { return JSON.parse(sessionStorage.getItem(SKEY)); } catch (e) { return null; } }
  function saveSession(v) { try { if (v) sessionStorage.setItem(SKEY, JSON.stringify(v)); else sessionStorage.removeItem(SKEY); } catch (e) {} }
  var session = loadSession();
  var wallet = null, me = null, corps = [], feed = [], sel = null, detail = null, fees = { corp: 50, transfer: 0 };
  var ticket = { side: 'buy', price: '', shares: '' };

  function money(n) { return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'dia'; }
  function px(n) { n = Number(n); return n.toLocaleString(undefined, { minimumFractionDigits: n < 1 ? 4 : 2, maximumFractionDigits: 4 }) + 'dia'; }
  function num(n) { return Number(n).toLocaleString(); }
  function pc(p) { return (p >= 0 ? '+' : '') + (p * 100).toFixed(2) + '%'; }
  function status(t, err) { var m = $('status'); m.textContent = t || ''; m.className = 'msg' + (err ? ' err' : ''); }
  function mcap(c) { return c.last_price === null || c.last_price === undefined ? null : Number(c.last_price) * c.total_shares; }
  function chg(c) { var o = Number(c.open_price), l = Number(c.last_price); return c.open_price && c.last_price && o > 0 ? (l - o) / o : null; }
  function chgEl(p) { return h('span', { style: 'font-weight:700;color:' + (p === null ? '#6B7688' : p >= 0 ? '#1B7F46' : '#B3261E'), text: p === null ? '-' : pc(p) }); }

  /* ---------- data ---------- */
  function rpc(name, args) {
    return sb.rpc(name, args).then(function (r) {
      if (r.error) return { ok: false, error: 'Something went wrong. Try again in a minute.' };
      return r.data || { ok: false, error: 'No answer from the server.' };
    }, function () { return { ok: false, error: 'Could not reach the server.' }; });
  }
  function rows(q) { return q.then(function (r) { return r.error ? [] : r.data; }, function () { return []; }); }

  function loadWallet() {
    if (!session) { wallet = null; me = null; return Promise.resolve(); }
    return Promise.all([rpc('market_login', { p_user: session.user, p_pin: session.pin }), rpc('corp_me', { p_user: session.user, p_pin: session.pin })]).then(function (r) {
      if (!r[0].ok) { wallet = null; me = null; session = null; saveSession(null); return; }
      wallet = { name: r[0].name, balance: Number(r[0].balance) };
      me = r[1].ok ? r[1] : null;
    });
  }
  function loadCorps() {
    return Promise.all([
      rows(sb.from('corps_stats_view').select('*').order('created_at', { ascending: true })),
      rows(sb.from('corp_posts_view').select('*').order('created_at', { ascending: false }).limit(12))
    ]).then(function (r) { corps = r[0]; feed = r[1]; });
  }
  function loadDetail() {
    var c = corps.filter(function (x) { return x.ticker === sel; })[0];
    if (!c) { detail = null; return Promise.resolve(); }
    return Promise.all([
      rows(sb.from('corp_depth_view').select('*').eq('corp_id', c.id)),
      rows(sb.from('corp_holders_view').select('*').eq('corp_id', c.id).order('shares', { ascending: false })),
      rows(sb.from('share_trades_view').select('*').eq('corp_id', c.id).order('created_at', { ascending: false }).limit(200)),
      rows(sb.from('corp_log').select('*').eq('corp_id', c.id).order('created_at', { ascending: false }).limit(10)),
      rows(sb.from('corp_posts_view').select('*').eq('corp_id', c.id).order('created_at', { ascending: false }).limit(8)),
      rpc('stock_quote', { p_corp: c.id })
    ]).then(function (r) { detail = { corp: c, depth: r[0], holders: r[1], trades: r[2], log: r[3], posts: r[4], quote: r[5] }; });
  }
  function loadFees() {
    return rows(sb.from('market_settings').select('key,value').in('key', ['corp_fee', 'transfer_fee_pct'])).then(function (l) {
      l.forEach(function (x) { if (x.key === 'corp_fee') fees.corp = Number(x.value); if (x.key === 'transfer_fee_pct') fees.transfer = Number(x.value); });
    });
  }
  function reload() { return Promise.all([loadWallet(), loadCorps()]).then(loadDetail).then(render); }

  /* ---------- small form helper ---------- */
  function mini(title, fields, btnText, run, hint) {
    var inputs = fields.map(function (f) {
      var i = h('input', { type: f.type || 'text', placeholder: f.ph, 'aria-label': f.ph, style: 'width:' + (f.w || 140) + 'px' });
      if (f.type === 'number') { i.min = f.min || 0; i.step = f.step || 'any'; }
      return i;
    });
    var msg = h('span', { 'class': 'msg', style: 'margin:0' });
    var btn = h('button', { 'class': 'btn small', type: 'button', text: btnText });
    btn.onclick = function () {
      if (!session) { msg.textContent = 'Log in first.'; msg.className = 'msg err'; return; }
      msg.textContent = 'Working...'; msg.className = 'msg';
      run(inputs.map(function (i) { return i.value.trim(); }), function (r, okText) {
        if (r.ok) { status(okText || 'Done.'); reload(); } else { msg.textContent = r.error || 'That did not work.'; msg.className = 'msg err'; }
      });
    };
    var row = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' });
    inputs.forEach(function (i) { row.appendChild(i); }); row.appendChild(btn); row.appendChild(msg);
    var f = h('div', { 'class': 'field' }, h('label', { text: title }), row);
    if (hint) f.appendChild(h('p', { 'class': 'hint', text: hint }));
    return f;
  }
  var P = function () { return { p_user: session.user, p_pin: session.pin }; };
  function withArgs(extra) { var a = P(); Object.keys(extra).forEach(function (k) { a[k] = extra[k]; }); return a; }

  function headRow(names) { var tr = h('tr'); names.forEach(function (x) { tr.appendChild(h('th', { text: x })); }); return h('thead', null, tr); }

  /* ---------- header, movers, news ---------- */
  function renderTop() {
    var now = 0, open = 0, withPrice = 0;
    corps.forEach(function (c) { if (c.last_price !== null) { now += Number(c.last_price) * c.total_shares; open += Number(c.open_price || c.last_price) * c.total_shares; withPrice++; } });
    $('st-idx').textContent = withPrice ? money(now) : '-';
    var ic = $('st-chg'); clear(ic);
    ic.appendChild(chgEl(open > 0 ? (now - open) / open : null));
    $('st-n').textContent = corps.length;
    $('st-bal').textContent = wallet ? money(wallet.balance) : '-';

    var mv = $('movers'); clear(mv);
    var list = corps.map(function (c) { return { c: c, p: chg(c) }; }).filter(function (x) { return x.p !== null && Math.abs(x.p) > 0.00001; });
    if (!list.length) mv.appendChild(h('p', { 'class': 'muted', text: 'No price moves yet. Trade some shares to get things going.' }));
    list.sort(function (a, b) { return b.p - a.p; });
    var up = list.filter(function (x) { return x.p > 0; }).slice(0, 3), down = list.filter(function (x) { return x.p < 0; }).reverse().slice(0, 3);
    [['Gainers', up], ['Losers', down]].forEach(function (g) {
      if (!g[1].length) return;
      mv.appendChild(h('p', { 'class': 'muted', style: 'margin:8px 0 4px', text: g[0] }));
      g[1].forEach(function (x) { mv.appendChild(h('div', { style: 'cursor:pointer;display:flex;justify-content:space-between', onclick: function () { pick(x.c.ticker); } }, h('span', null, h('b', { text: x.c.ticker }), ' ' + px(x.c.last_price)), chgEl(x.p))); });
    });

    var fd = $('feed'); clear(fd);
    if (!feed.length) fd.appendChild(h('p', { 'class': 'muted', text: 'Nothing yet.' }));
    feed.slice(0, 8).forEach(function (p) {
      var tag = p.kind === 'report' ? 'Report' : p.kind === 'news' ? 'News' : '';
      fd.appendChild(h('div', { style: 'margin:0 0 10px;cursor:pointer', onclick: function () { pick(p.ticker); } },
        h('div', null, h('b', { text: p.ticker }), ' ', h('span', { text: p.title }), tag ? h('span', { 'class': 'muted', text: '  ' + tag }) : ''),
        p.body ? h('div', { 'class': 'muted', text: p.body }) : '', h('div', { 'class': 'muted', style: 'font-size:12px', text: new Date(p.created_at).toLocaleString() })));
    });
  }
  function pick(ticker) {
    sel = ticker; try { history.replaceState(null, '', '#' + ticker); } catch (e) {}
    ticket = { side: 'buy', price: '', shares: '' };
    loadDetail().then(function () { render(); $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }

  /* ---------- wallet, pay, portfolio ---------- */
  function renderWallet() {
    var box = $('wallet'); clear(box);
    if (wallet) {
      box.appendChild(h('p', { style: 'margin:0 0 10px' }, 'Signed in as ', h('b', { text: wallet.name }), '. Balance: ', h('b', { text: money(wallet.balance) })));
      box.appendChild(h('button', { 'class': 'btn small ghost', type: 'button', text: 'Log out', onclick: function () { session = null; wallet = null; me = null; saveSession(null); render(); } }));
      return;
    }
    var u = h('input', { type: 'text', placeholder: 'Minecraft username', autocomplete: 'username', maxlength: 32 });
    var p = h('input', { type: 'password', inputmode: 'numeric', placeholder: 'PIN', maxlength: 8, autocomplete: 'off' });
    var m = h('div', { 'class': 'msg' });
    function go() {
      m.textContent = 'Logging in...'; m.className = 'msg';
      session = { user: u.value.trim(), pin: p.value.trim() };
      rpc('market_login', { p_user: session.user, p_pin: session.pin }).then(function (r) {
        if (!r.ok) { session = null; m.textContent = r.error || 'Could not log in.'; m.className = 'msg err'; return; }
        saveSession(session); reload();
      });
    }
    p.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    box.appendChild(h('div', { 'class': 'field' }, u)); box.appendChild(h('div', { 'class': 'field' }, p));
    box.appendChild(h('button', { 'class': 'btn small', type: 'button', text: 'Log in', onclick: go })); box.appendChild(m);
    box.appendChild(h('p', { 'class': 'hint' }, 'Same login as the Markets page. No wallet yet? ', h('a', { href: 'markets.html', text: 'Make one there first.' })));
  }
  function renderPay() {
    var box = $('pay'); clear(box);
    box.appendChild(mini('Send diamonds', [{ ph: 'Username', w: 140 }, { ph: 'Amount', type: 'number', w: 120, min: 0.01 }, { ph: 'Note (optional)', w: 150 }], 'Send', function (v, done) {
      rpc('pay_player', withArgs({ p_to: v[0], p_amount: Number(v[1]), p_note: v[2] })).then(function (r) { done(r, 'Sent ' + v[1] + ' diamonds to ' + v[0] + '.'); });
    }, fees.transfer > 0 ? 'A ' + fees.transfer + '% fee is added on top and goes back to the bank.' : 'No fee. They need a wallet on the Markets page.'));
  }
  function renderPortfolio() {
    var box = $('portfolio'); clear(box);
    if (!wallet || !me) { box.appendChild(h('p', { 'class': 'muted', text: 'Log in to see what you own and how you are doing.' })); return; }
    var owned = {}; // corp_id -> shares including shares listed for sale
    me.holdings.forEach(function (x) { owned[x.corp_id] = (owned[x.corp_id] || 0) + Number(x.shares); });
    me.listings.forEach(function (x) { if (!x.is_ipo) owned[x.corp_id] = (owned[x.corp_id] || 0) + Number(x.shares); });
    var basis = {}; me.basis.forEach(function (b) { basis[b.corp_id] = b; });
    var ids = Object.keys(owned).concat(Object.keys(basis).filter(function (k) { return !(k in owned); }));
    var totalVal = 0, totalPnl = 0, rowsOut = [];
    ids.forEach(function (id) {
      var c = corps.filter(function (x) { return x.id === id; })[0]; if (!c) return;
      var sh = owned[id] || 0, b = basis[id] || { shares: 0, cost: 0, realized: 0, dividends: 0 };
      var price = c.last_price !== null ? Number(c.last_price) : Number(c.book_value);
      var val = sh * price;
      var unreal = c.last_price !== null ? b.shares * price - Number(b.cost) : 0;
      var pnl = unreal + Number(b.realized) + Number(b.dividends);
      totalVal += val; totalPnl += pnl;
      rowsOut.push({ c: c, sh: sh, val: val, avg: b.shares > 0 ? Number(b.cost) / b.shares : null, unreal: unreal, real: Number(b.realized), div: Number(b.dividends), pnl: pnl });
    });
    var escrow = me.bids.reduce(function (a, x) { return a + Number(x.shares) * Number(x.price); }, 0);
    var st = h('div', { 'class': 'stats', style: 'margin:0 0 12px' });
    [[money(wallet.balance), 'Cash'], [money(totalVal), 'Shares value'], [money(wallet.balance + totalVal + escrow), 'Net worth'], [(totalPnl >= 0 ? '+' : '') + money(totalPnl), 'Total profit and loss']].forEach(function (x) {
      st.appendChild(h('div', { 'class': 'stat' }, h('b', { text: x[0] }), h('span', { text: x[1] })));
    });
    box.appendChild(st);
    if (escrow > 0) box.appendChild(h('p', { 'class': 'muted', text: money(escrow) + ' is locked in your open buy orders.' }));
    if (!rowsOut.length) { box.appendChild(h('p', { 'class': 'muted', text: 'You do not own any shares yet.' })); return; }
    var t = h('table'); t.appendChild(headRow(['Stock', 'Shares', 'Value', 'Avg cost', 'Unrealized', 'Realized', 'Dividends', 'Total']));
    var tb = h('tbody');
    rowsOut.sort(function (a, b) { return b.val - a.val; }).forEach(function (r) {
      var sgn = function (n) { return (n >= 0 ? '+' : '') + money(n); };
      tb.appendChild(h('tr', { style: 'cursor:pointer', onclick: function () { pick(r.c.ticker); } }, h('td', null, h('b', { text: r.c.ticker })), h('td', { text: num(r.sh) }), h('td', { text: money(r.val) }),
        h('td', { text: r.avg === null ? '-' : px(r.avg) }), h('td', { text: sgn(r.unreal) }), h('td', { text: sgn(r.real) }), h('td', { text: sgn(r.div) }), h('td', null, h('b', { text: sgn(r.pnl) }))));
    });
    t.appendChild(tb); var wrap = h('div', { style: 'overflow-x:auto' }); wrap.appendChild(t); box.appendChild(wrap);
    box.appendChild(h('p', { 'class': 'hint', text: 'Shares you got for free as founder count as zero cost. Unrealized profit is measured on shares you bought.' }));
  }

  /* ---------- list ---------- */
  function renderList() {
    var box = $('corp-list'); clear(box);
    if (!corps.length) { box.appendChild(h('p', { 'class': 'muted', text: 'No corporations yet. Be the first to start one below.' })); return; }
    var sorted = corps.slice().sort(function (a, b) { return (mcap(b) || 0) - (mcap(a) || 0); });
    var t = h('table');
    t.appendChild(headRow(['Ticker', 'Name', 'Owner', 'Price', '24h', 'Market cap', 'Cash / share', '24h volume']));
    var tb = h('tbody');
    sorted.forEach(function (c) {
      var m = mcap(c);
      tb.appendChild(h('tr', { style: 'cursor:pointer' + (c.ticker === sel ? ';background:rgba(20,120,140,.08)' : ''), onclick: function () { pick(c.ticker); } },
        h('td', null, h('b', { text: c.ticker })), h('td', { text: c.name }), h('td', { text: c.owner_name }),
        h('td', { text: c.last_price === null ? 'no trades' : px(c.last_price) }), h('td', null, chgEl(chg(c))), h('td', { text: m ? money(m) : '-' }),
        h('td', { text: px(c.book_value) }), h('td', { text: money(c.vol24) })));
    });
    t.appendChild(tb);
    var wrap = h('div', { style: 'overflow-x:auto' }); wrap.appendChild(t); box.appendChild(wrap);
  }

  /* ---------- chart ---------- */
  function chart(trades, c) {
    var pts = trades.filter(function (t) { return !t.mm; }).map(function (t) { return { x: new Date(t.created_at).getTime(), y: Number(t.price) }; }).sort(function (a, b) { return a.x - b.x; });
    var W = 640, H = 200, pad = { l: 56, r: 12, t: 12, b: 24 };
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', role: 'img', 'aria-label': 'Price history of ' + c.ticker, style: 'max-width:100%;height:auto' });
    if (pts.length < 2) {
      svg.appendChild(s('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: '#6B7688', 'font-size': 14, text: pts.length ? 'Only one trade so far (' + px(pts[0].y) + ')' : 'No trades yet' }));
      return svg;
    }
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (y1 === y0) { y1 += y1 * 0.1 + 0.01; y0 = Math.max(0, y0 - y0 * 0.1); }
    var X = function (v) { return pad.l + (x1 === x0 ? 0 : (v - x0) / (x1 - x0)) * (W - pad.l - pad.r); };
    var Y = function (v) { return H - pad.b - (v - y0) / (y1 - y0) * (H - pad.t - pad.b); };
    [0, 0.5, 1].forEach(function (f) {
      var v = y0 + (y1 - y0) * f, y = Y(v);
      svg.appendChild(s('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: '#E3E7EE' }));
      svg.appendChild(s('text', { x: pad.l - 6, y: y + 4, 'text-anchor': 'end', fill: '#6B7688', 'font-size': 11, text: v.toFixed(v < 1 ? 3 : 2) }));
    });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1); }).join(' ');
    var up = pts[pts.length - 1].y >= pts[0].y;
    svg.appendChild(s('path', { d: d, fill: 'none', stroke: up ? '#1B7F46' : '#B3261E', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    var last = pts[pts.length - 1];
    svg.appendChild(s('circle', { cx: X(last.x), cy: Y(last.y), r: 4, fill: up ? '#1B7F46' : '#B3261E' }));
    var fmt = function (t) { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
    svg.appendChild(s('text', { x: pad.l, y: H - 6, fill: '#6B7688', 'font-size': 11, text: fmt(x0) }));
    svg.appendChild(s('text', { x: W - pad.r, y: H - 6, 'text-anchor': 'end', fill: '#6B7688', 'font-size': 11, text: fmt(x1) }));
    return svg;
  }

  /* ---------- detail ---------- */
  function renderDetail() {
    var box = $('detail'); clear(box);
    if (!detail) { box.hidden = true; return; }
    box.hidden = false;
    var c = detail.corp, mine = !!(me && me.owned.indexOf(c.id) !== -1), m = mcap(c), q = detail.quote || {};
    box.appendChild(h('h2', null, c.ticker + ' · ' + c.name + '  ', chgEl(chg(c))));
    box.appendChild(h('p', { 'class': 'muted', text: 'Owner: ' + c.owner_name + (c.description ? '. ' + c.description : '') }));
    var st = h('div', { 'class': 'stats', style: 'margin:8px 0 16px' });
    [[c.last_price === null ? '-' : px(c.last_price), 'Last price'], [m ? money(m) : '-', 'Market cap'], [c.high24 === null ? '-' : px(c.high24) + ' / ' + px(c.low24), '24h high / low'], [money(c.vol24), '24h volume'],
     [money(c.balance), 'Company wallet'], [px(c.book_value), 'Cash per share'], [num(c.total_shares), 'Total shares'], [num(c.treasury), 'Unissued shares']].forEach(function (x) {
      st.appendChild(h('div', { 'class': 'stat' }, h('b', { text: x[0] }), h('span', { text: x[1] })));
    });
    box.appendChild(st);
    box.appendChild(h('h3', { text: 'Price history' }));
    box.appendChild(chart(detail.trades, c));

    // order book
    var asks = detail.depth.filter(function (d) { return d.side === 'ask'; }).sort(function (a, b) { return Number(a.price) - Number(b.price); }).slice(0, 6);
    var bids = detail.depth.filter(function (d) { return d.side === 'bid'; }).sort(function (a, b) { return Number(b.price) - Number(a.price); }).slice(0, 6);
    var book = h('div', { 'class': 'grid2', style: 'margin:12px 0' });
    function side(title, list, kind) {
      var col = h('div', null, h('h3', { text: title }));
      if (!list.length) col.appendChild(h('p', { 'class': 'muted', text: 'No orders.' }));
      list.forEach(function (d) {
        col.appendChild(h('div', { style: 'display:flex;justify-content:space-between;cursor:pointer;padding:2px 0;color:' + (kind === 'ask' ? '#B3261E' : '#1B7F46'),
          title: 'Click to use this price', onclick: function () { ticket.side = kind === 'ask' ? 'buy' : 'sell'; ticket.price = String(Number(d.price)); renderDetail(); } },
          h('span', { text: px(d.price) }), h('span', { text: num(d.shares) + ' shares' })));
      });
      return col;
    }
    book.appendChild(side('Sellers (asks)', asks, 'ask')); book.appendChild(side('Buyers (bids)', bids, 'bid'));
    box.appendChild(book);
    if (q.ok && q.bid !== null && q.ask !== null) {
      box.appendChild(h('p', { 'class': 'muted', text: 'Bank market maker: buys up to ' + num(q.bid_qty) + ' shares at ' + px(q.bid) + ' and sells up to ' + num(q.ask_qty) + ' shares at ' + px(q.ask) + ', based on the company\'s cash per share.' }));
    } else {
      box.appendChild(h('p', { 'class': 'muted', text: 'The bank market maker is idle while the company wallet is under about 0.02 diamonds per share.' }));
    }

    // ticket
    var myH = me && me.holdings.filter(function (x) { return x.corp_id === c.id; })[0];
    if (wallet) {
      box.appendChild(h('h3', { text: 'Trade', style: 'margin-top:16px' }));
      var sideSel = h('select', { 'aria-label': 'Buy or sell' }); [['buy', 'Buy'], ['sell', 'Sell my shares']].concat(mine && c.treasury > 0 ? [['ipo', 'Sell new company shares']] : []).forEach(function (o) { sideSel.appendChild(h('option', { value: o[0], text: o[1] })); });
      sideSel.value = ticket.side;
      var sh = h('input', { type: 'number', min: 1, step: 1, placeholder: 'Shares', value: ticket.shares, style: 'width:110px', 'aria-label': 'Shares' });
      var pr = h('input', { type: 'number', min: 0.01, step: 'any', placeholder: 'Limit price each', value: ticket.price, style: 'width:180px', 'aria-label': 'Limit price' });
      var msg = h('span', { 'class': 'msg', style: 'margin:0' });
      var info = h('p', { 'class': 'hint' });
      function upd() {
        ticket.side = sideSel.value; ticket.shares = sh.value; ticket.price = pr.value;
        var n = Math.floor(Number(sh.value)), p = Number(pr.value);
        info.textContent = n > 0 && p > 0 ? (ticket.side === 'buy' ? 'Most this can cost: ' + money(n * p) + '. You pay the seller\'s price if it is lower than your limit.' : 'Selling at least ' + money(n * p) + ' if it fills at your limit or better.') + ' Unfilled shares wait on the book until someone takes them.' : 'Your order fills against the best orders at your limit price or better. Whatever does not fill stays on the book.';
        if (myH && ticket.side === 'sell') info.textContent += ' You own ' + num(myH.shares) + '.';
      }
      [sideSel, sh, pr].forEach(function (e) { e.addEventListener('input', upd); e.addEventListener('change', upd); }); upd();
      var go = h('button', { 'class': 'btn small', type: 'button', text: 'Place order', onclick: function () {
        msg.textContent = 'Working...'; msg.className = 'msg';
        var n = Math.floor(Number(sh.value)), p = Number(pr.value);
        var call = ticket.side === 'buy' ? rpc('stock_buy', withArgs({ p_corp: c.id, p_shares: n, p_price: p })) : rpc('stock_sell', withArgs({ p_corp: c.id, p_shares: n, p_price: p, p_ipo: ticket.side === 'ipo' }));
        call.then(function (r) {
          if (!r.ok) { msg.textContent = r.error || 'That did not work.'; msg.className = 'msg err'; return; }
          var done = ticket.side === 'buy' ? 'Bought ' + r.filled + ' for ' + money(r.spent) : 'Sold ' + r.sold + ' for ' + money(r.received);
          status(done + (r.resting > 0 ? '. ' + r.resting + ' more ' + (ticket.side === 'buy' ? 'are waiting as a buy order' : 'are for sale on the book') + '.' : '.'));
          ticket = { side: ticket.side, price: '', shares: '' }; reload();
        });
      } });
      box.appendChild(h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, sideSel, sh, pr, go, msg)); box.appendChild(info);

      // my orders here
      var myL = me.listings.filter(function (l) { return l.corp_id === c.id; }), myB = me.bids.filter(function (b) { return b.corp_id === c.id; });
      if (myL.length || myB.length) {
        box.appendChild(h('p', { 'class': 'muted', style: 'margin:10px 0 4px', text: 'Your open orders here' }));
        myB.forEach(function (b) { box.appendChild(h('div', { style: 'margin:4px 0' }, 'Buy ' + num(b.shares) + ' at ' + px(b.price) + '  ', h('button', { 'class': 'btn small ghost', type: 'button', text: 'Cancel', onclick: function () { rpc('stock_cancel_bid', withArgs({ p_bid: b.id })).then(function (r) { if (r.ok) { status('Order cancelled. Your diamonds are back.'); reload(); } else status(r.error, true); }); } }))); });
        myL.forEach(function (l) { box.appendChild(h('div', { style: 'margin:4px 0' }, 'Sell ' + num(l.shares) + ' at ' + px(l.price) + (l.is_ipo ? ' (new company shares)' : '') + '  ', h('button', { 'class': 'btn small ghost', type: 'button', text: 'Cancel', onclick: function () { rpc('corp_cancel', withArgs({ p_listing: l.id })).then(function (r) { if (r.ok) { status('Order cancelled. Your shares are back.'); reload(); } else status(r.error, true); }); } }))); });
      }
      box.appendChild(mini('Send diamonds to the company', [{ ph: 'Amount', type: 'number', w: 120, min: 0.01 }], 'Send', function (v, done) {
        rpc('corp_deposit', withArgs({ p_corp: c.id, p_amount: Number(v[0]) })).then(function (r) { done(r, 'Sent ' + v[0] + ' diamonds to ' + c.ticker + '.'); });
      }, 'Funding a company puts diamonds in its wallet. You do not get shares for it.'));
    }

    // holders
    box.appendChild(h('h3', { text: 'Who owns it', style: 'margin-top:18px' }));
    detail.holders.forEach(function (x) {
      var p = x.shares / c.total_shares;
      box.appendChild(h('div', { 'class': 'row' }, h('div', { 'class': 'row-head' }, h('b', { text: x.holder }), h('span', { text: num(x.shares) + ' · ' + (p * 100).toFixed(1) + '%' })), h('div', { 'class': 'bar' }, h('i', { style: 'width:' + (p * 100).toFixed(1) + '%;background:#14788C' }))));
    });
    if (c.treasury > 0) box.appendChild(h('p', { 'class': 'muted', text: 'The company itself holds ' + num(c.treasury) + ' unissued shares.' }));

    // reports
    box.appendChild(h('h3', { text: 'Reports and news', style: 'margin-top:18px' }));
    if (!detail.posts.length) box.appendChild(h('p', { 'class': 'muted', text: 'Nothing yet.' }));
    detail.posts.forEach(function (p) {
      box.appendChild(h('div', { style: 'margin:0 0 8px' }, h('b', { text: p.title }), h('span', { 'class': 'muted', text: '  ' + (p.kind === 'report' ? 'Report' : p.kind === 'news' ? 'News' : '') + ' ' + new Date(p.created_at).toLocaleString() }), p.body ? h('div', { 'class': 'muted', text: p.body }) : ''));
    });

    // owner
    if (mine) {
      box.appendChild(h('h3', { text: 'Owner controls', style: 'margin-top:18px' }));
      box.appendChild(h('p', { 'class': 'muted', text: 'The company wallet holds ' + money(c.balance) + '. Only you can spend it. To sell new shares, pick "Sell new company shares" in the Trade box above.' }));
      var pk = h('select', { 'aria-label': 'Report or news' }); [['report', 'Report'], ['news', 'News']].forEach(function (o) { pk.appendChild(h('option', { value: o[0], text: o[1] })); });
      var pt = h('input', { type: 'text', placeholder: 'Headline', maxlength: 80, style: 'width:220px', 'aria-label': 'Headline' });
      var pb = h('input', { type: 'text', placeholder: 'Details (optional)', maxlength: 600, style: 'width:300px', 'aria-label': 'Details' });
      var pm = h('span', { 'class': 'msg', style: 'margin:0' });
      box.appendChild(h('div', { 'class': 'field' }, h('label', { text: 'Post a report or news' }), h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, pk, pt, pb,
        h('button', { 'class': 'btn small', type: 'button', text: 'Post', onclick: function () {
          rpc('corp_post', withArgs({ p_corp: c.id, p_kind: pk.value, p_title: pt.value, p_body: pb.value })).then(function (r) { if (r.ok) { status('Posted.'); reload(); } else { pm.textContent = r.error; pm.className = 'msg err'; } });
        } }), pm)));
      box.appendChild(mini('Pay a player from the company', [{ ph: 'Username', w: 140 }, { ph: 'Amount', type: 'number', w: 120, min: 0.01 }, { ph: 'Note', w: 150 }], 'Pay', function (v, done) {
        rpc('corp_pay', withArgs({ p_corp: c.id, p_to: v[0], p_amount: Number(v[1]), p_note: v[2] })).then(function (r) { done(r, 'Paid ' + v[1] + ' diamonds from ' + c.ticker + ' to ' + v[0] + '.'); });
      }));
      box.appendChild(mini('Pay a dividend (split across all shareholders)', [{ ph: 'Total amount', type: 'number', w: 150, min: 0.01 }], 'Pay dividend', function (v, done) {
        rpc('corp_dividend', withArgs({ p_corp: c.id, p_total: Number(v[0]) })).then(function (r) { done(r, r.ok ? 'Paid ' + money(r.paid) + ' in dividends (' + r.per_share + ' per share).' : ''); });
      }, 'Unissued shares do not get a dividend. That part stays in the company wallet.'));
      box.appendChild(mini('Hand over ownership', [{ ph: 'New owner username', w: 200 }], 'Transfer', function (v, done) {
        if (!confirm('Hand ' + c.ticker + ' and its wallet over to ' + v[0] + '? You cannot undo this.')) { done({ ok: false, error: 'Cancelled.' }); return; }
        rpc('corp_transfer_owner', withArgs({ p_corp: c.id, p_to: v[0] })).then(function (r) { done(r, c.ticker + ' now belongs to ' + v[0] + '.'); });
      }));
    }

    // trades + log
    box.appendChild(h('h3', { text: 'Recent trades', style: 'margin-top:18px' }));
    if (!detail.trades.length) box.appendChild(h('p', { 'class': 'muted', text: 'No trades yet.' }));
    detail.trades.slice(0, 10).forEach(function (t) {
      box.appendChild(h('div', { 'class': 'muted', text: new Date(t.created_at).toLocaleString() + ': ' + t.buyer_name + ' bought ' + num(t.shares) + ' at ' + px(t.price) + ' from ' + (t.seller_name || 'the company') }));
    });
    box.appendChild(h('h3', { text: 'Company wallet activity', style: 'margin-top:18px' }));
    if (!detail.log.length) box.appendChild(h('p', { 'class': 'muted', text: 'Nothing yet.' }));
    detail.log.forEach(function (l) {
      box.appendChild(h('div', { 'class': 'muted', text: new Date(l.created_at).toLocaleString() + ': ' + (Number(l.delta) >= 0 ? '+' : '') + money(l.delta) + ' ' + (l.reason || '') }));
    });
  }

  /* ---------- create ---------- */
  function renderCreate() {
    var box = $('create'); clear(box);
    box.appendChild(h('p', { 'class': 'muted', text: 'Registering costs ' + money(fees.corp) + ' (it goes back to the bank). You control the company wallet. You get 3 companies at most.' }));
    var f = {};
    [['ticker', 'Ticker (2 to 5 letters)', 'text', 'e.g. ACME'], ['name', 'Company name', 'text', ''], ['desc', 'What does it do? (optional)', 'text', ''], ['shares', 'Total shares', 'number', '1000'], ['keep', 'Shares you keep', 'number', '500']].forEach(function (x) {
      var i = h('input', { type: x[2], placeholder: x[3], value: x[2] === 'number' ? x[3] : '', maxlength: x[0] === 'desc' ? 300 : 40, 'aria-label': x[1] });
      if (x[2] === 'number') { i.min = 0; i.step = 1; }
      f[x[0]] = i; box.appendChild(h('div', { 'class': 'field' }, h('label', { text: x[1] }), i));
    });
    box.appendChild(h('p', { 'class': 'hint', text: 'The shares you do not keep go to the company. You can sell them later for the company to earn diamonds.' }));
    var msg = h('div', { 'class': 'msg' });
    box.appendChild(h('button', { 'class': 'btn', type: 'button', text: 'Start corporation', onclick: function () {
      if (!session) { msg.textContent = 'Log in first.'; msg.className = 'msg err'; return; }
      msg.textContent = 'Working...'; msg.className = 'msg';
      rpc('corp_create', withArgs({ p_ticker: f.ticker.value, p_name: f.name.value, p_desc: f.desc.value, p_shares: Math.floor(Number(f.shares.value)), p_keep: Math.floor(Number(f.keep.value)) })).then(function (r) {
        if (!r.ok) { msg.textContent = r.error || 'That did not work.'; msg.className = 'msg err'; return; }
        sel = f.ticker.value.trim().toUpperCase(); status(sel + ' is registered. It is yours.'); reload();
      });
    } }));
    box.appendChild(msg);
  }

  function render() { renderTop(); renderWallet(); renderPay(); renderPortfolio(); renderList(); renderDetail(); renderCreate(); }

  /* ---------- start ---------- */
  if (!sb) { $('demo-banner').hidden = false; ['wallet', 'pay', 'corp-list', 'create', 'portfolio', 'movers', 'feed'].forEach(function (id) { $(id).appendChild(h('p', { 'class': 'muted', text: 'Needs the live database.' })); }); return; }
  $('refresh').onclick = function () { status(''); reload(); };
  if (location.hash.length > 1) sel = decodeURIComponent(location.hash.slice(1)).toUpperCase();
  loadFees().then(reload).catch(function (e) { if (window.console) console.error(e); var el = $('load-error'); el.hidden = false; el.textContent = 'The stock market could not load. Run add-stock-market.sql in Supabase if you have not yet.'; });
  setInterval(function () { var a = document.activeElement; if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) return; reload(); }, Math.max(10, CFG.refreshSeconds || 20) * 1000);
})();
