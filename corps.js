(function () {
  'use strict';
  var EL = window.EL, h = EL.h, clear = EL.clear;
  var CFG = window.ELECTION_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var configured = CFG.supabaseUrl && CFG.supabaseAnonKey &&
    CFG.supabaseUrl.indexOf('PASTE') === -1 && CFG.supabaseAnonKey.indexOf('PASTE') === -1 && window.supabase;
  var sb = configured ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;

  var SKEY = 'mkt-session';           // same login as the Markets page
  function loadSession() { try { return JSON.parse(sessionStorage.getItem(SKEY)); } catch (e) { return null; } }
  function saveSession(v) { try { if (v) sessionStorage.setItem(SKEY, JSON.stringify(v)); else sessionStorage.removeItem(SKEY); } catch (e) {} }
  var session = loadSession();
  var wallet = null, me = null, corps = [], sel = null, detail = null, fees = { corp: 50, transfer: 0 };

  function money(n) { return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'dia'; }
  function num(n) { return Number(n).toLocaleString(); }
  function status(t, err) { var m = $('status'); m.textContent = t || ''; m.className = 'msg' + (err ? ' err' : ''); }
  function mcap(c) { return c.last_price === null || c.last_price === undefined ? null : Number(c.last_price) * c.total_shares; }

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
    return rows(sb.from('corps_view').select('*').order('created_at', { ascending: true })).then(function (l) { corps = l; });
  }
  function loadDetail() {
    var c = corps.filter(function (x) { return x.ticker === sel; })[0];
    if (!c) { detail = null; return Promise.resolve(); }
    return Promise.all([
      rows(sb.from('corp_listings_view').select('*').eq('corp_id', c.id).order('price', { ascending: true })),
      rows(sb.from('corp_holders_view').select('*').eq('corp_id', c.id).order('shares', { ascending: false })),
      rows(sb.from('share_trades_view').select('*').eq('corp_id', c.id).order('created_at', { ascending: false }).limit(10)),
      rows(sb.from('corp_log').select('*').eq('corp_id', c.id).order('created_at', { ascending: false }).limit(10))
    ]).then(function (r) { detail = { corp: c, listings: r[0], holders: r[1], trades: r[2], log: r[3] }; });
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

  /* ---------- wallet + pay ---------- */
  function renderWallet() {
    var box = $('wallet'); clear(box);
    $('st-bal').textContent = wallet ? money(wallet.balance) : '-';
    if (wallet) {
      box.appendChild(h('p', { style: 'margin:0 0 10px' }, 'Signed in as ', h('b', { text: wallet.name }), '. Balance: ', h('b', { text: money(wallet.balance) })));
      box.appendChild(h('button', { 'class': 'btn small ghost', type: 'button', text: 'Log out', onclick: function () { session = null; wallet = null; me = null; saveSession(null); render(); } }));
      if (me && me.holdings.length) {
        box.appendChild(h('p', { 'class': 'muted', style: 'margin:12px 0 4px', text: 'Your shares' }));
        me.holdings.forEach(function (x) {
          var c = corps.filter(function (k) { return k.id === x.corp_id; })[0]; if (!c) return;
          var v = c.last_price === null ? '' : ' worth about ' + money(x.shares * Number(c.last_price));
          box.appendChild(h('div', null, h('a', { href: '#' + c.ticker, text: c.ticker, onclick: function () { sel = c.ticker; loadDetail().then(render); } }), ': ' + num(x.shares) + ' shares' + v));
        });
      }
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

  /* ---------- list ---------- */
  function renderList() {
    var box = $('corp-list'); clear(box);
    var total = 0, n = corps.length; corps.forEach(function (c) { var m = mcap(c); if (m) total += m; });
    $('st-n').textContent = n; $('st-cap').textContent = total ? money(total) : '-';
    if (!corps.length) { box.appendChild(h('p', { 'class': 'muted', text: 'No corporations yet. Be the first to start one below.' })); return; }
    var sorted = corps.slice().sort(function (a, b) { return (mcap(b) || 0) - (mcap(a) || 0); });
    var t = h('table', { 'class': 'tbl' });
    t.appendChild(h('thead', null, h('tr', null, h('th', { text: 'Ticker' }), h('th', { text: 'Name' }), h('th', { text: 'Owner' }), h('th', { text: 'Price' }), h('th', { text: 'Market cap' }), h('th', { text: 'Volume' }))));
    var tb = h('tbody');
    sorted.forEach(function (c) {
      var m = mcap(c);
      var tr = h('tr', { style: 'cursor:pointer' + (c.ticker === sel ? ';background:rgba(20,120,140,.08)' : '') },
        h('td', null, h('b', { text: c.ticker })), h('td', { text: c.name }), h('td', { text: c.owner_name }),
        h('td', { text: c.last_price === null ? 'unlisted' : money(c.last_price) }), h('td', { text: m ? money(m) : '-' }), h('td', { text: money(c.volume) }));
      tr.onclick = function () { sel = c.ticker; try { history.replaceState(null, '', '#' + c.ticker); } catch (e) {} loadDetail().then(function () { render(); $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); }); };
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    var wrap = h('div', { style: 'overflow-x:auto' }); wrap.appendChild(t); box.appendChild(wrap);
  }

  /* ---------- detail ---------- */
  function renderDetail() {
    var box = $('detail'); clear(box);
    if (!detail) { box.hidden = true; return; }
    box.hidden = false;
    var c = detail.corp, mine = !!(me && me.owned.indexOf(c.id) !== -1);
    var m = mcap(c);
    box.appendChild(h('h2', { text: c.ticker + ' · ' + c.name }));
    box.appendChild(h('p', { 'class': 'muted', text: 'Owner: ' + c.owner_name + (c.description ? '. ' + c.description : '') }));
    var st = h('div', { 'class': 'stats', style: 'margin:8px 0 16px' });
    [[c.last_price === null ? '-' : money(c.last_price), 'Last price'], [m ? money(m) : '-', 'Market cap'], [money(c.balance), 'Company wallet'], [num(c.total_shares), 'Total shares'], [num(c.treasury), 'Unissued shares'], [money(c.volume), 'Volume']].forEach(function (x) {
      st.appendChild(h('div', { 'class': 'stat' }, h('b', { text: x[0] }), h('span', { text: x[1] })));
    });
    box.appendChild(st);

    // for sale
    box.appendChild(h('h3', { text: 'Shares for sale' }));
    if (!detail.listings.length) box.appendChild(h('p', { 'class': 'muted', text: 'Nothing is for sale right now.' }));
    detail.listings.forEach(function (l) {
      var mineL = me && me.listings.some(function (x) { return String(x.id) === String(l.id); });
      var qty = h('input', { type: 'number', min: 1, max: l.shares, step: 1, value: Math.min(l.shares, 10), style: 'width:80px', 'aria-label': 'Shares to buy' });
      var msg = h('span', { 'class': 'msg', style: 'margin:0' });
      var act;
      if (mineL) act = h('button', { 'class': 'btn small ghost', type: 'button', text: 'Cancel', onclick: function () { rpc('corp_cancel', withArgs({ p_listing: l.id })).then(function (r) { if (r.ok) { status('Listing cancelled.'); reload(); } else { msg.textContent = r.error; msg.className = 'msg err'; } }); } });
      else act = h('button', { 'class': 'btn small', type: 'button', text: 'Buy', onclick: function () {
        if (!session) { msg.textContent = 'Log in first.'; msg.className = 'msg err'; return; }
        rpc('corp_buy', withArgs({ p_listing: l.id, p_shares: Math.floor(Number(qty.value)) })).then(function (r) { if (r.ok) { status('Bought ' + r.shares + ' ' + c.ticker + ' for ' + money(r.cost) + '.'); reload(); } else { msg.textContent = r.error; msg.className = 'msg err'; } });
      } });
      box.appendChild(h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:6px 0' },
        h('span', { style: 'min-width:190px' }, h('b', { text: num(l.shares) + ' shares' }), ' at ' + money(l.price)),
        h('span', { 'class': 'muted', style: 'min-width:140px', text: l.is_ipo ? 'from the company' : 'from ' + l.seller_name }),
        mineL ? '' : qty, act, msg));
    });

    // holders
    box.appendChild(h('h3', { text: 'Who owns it', style: 'margin-top:18px' }));
    var held = 0; detail.holders.forEach(function (x) { held += x.shares; });
    detail.holders.forEach(function (x) {
      var p = x.shares / c.total_shares;
      box.appendChild(h('div', { 'class': 'row' }, h('div', { 'class': 'row-head' }, h('b', { text: x.holder }), h('span', { text: num(x.shares) + ' · ' + (p * 100).toFixed(1) + '%' })), h('div', { 'class': 'bar' }, h('i', { style: 'width:' + (p * 100).toFixed(1) + '%;background:#14788C' }))));
    });
    if (c.treasury > 0) box.appendChild(h('p', { 'class': 'muted', text: 'The company itself holds ' + num(c.treasury) + ' unissued shares.' }));

    // my shares
    var myH = me && me.holdings.filter(function (x) { return x.corp_id === c.id; })[0];
    if (wallet) {
      box.appendChild(h('h3', { text: 'Your actions', style: 'margin-top:18px' }));
      box.appendChild(mini('Send diamonds to the company', [{ ph: 'Amount', type: 'number', w: 120, min: 0.01 }], 'Send', function (v, done) {
        rpc('corp_deposit', withArgs({ p_corp: c.id, p_amount: Number(v[0]) })).then(function (r) { done(r, 'Sent ' + v[0] + ' diamonds to ' + c.ticker + '.'); });
      }, 'Funding a company puts diamonds in its wallet. You do not get shares for it.'));
      if (myH) box.appendChild(mini('Sell your shares (you own ' + num(myH.shares) + ')', [{ ph: 'Shares', type: 'number', w: 120, min: 1, step: 1 }, { ph: 'Price each', type: 'number', w: 120, min: 0.01 }], 'List for sale', function (v, done) {
        rpc('corp_list', withArgs({ p_corp: c.id, p_shares: Math.floor(Number(v[0])), p_price: Number(v[1]), p_ipo: false })).then(function (r) { done(r, 'Listed ' + v[0] + ' ' + c.ticker + ' for sale.'); });
      }));
    }

    // owner
    if (mine) {
      box.appendChild(h('h3', { text: 'Owner controls', style: 'margin-top:18px' }));
      box.appendChild(h('p', { 'class': 'muted', text: 'The company wallet holds ' + money(c.balance) + '. Only you can spend it.' }));
      box.appendChild(mini('Pay a player from the company', [{ ph: 'Username', w: 140 }, { ph: 'Amount', type: 'number', w: 120, min: 0.01 }, { ph: 'Note', w: 150 }], 'Pay', function (v, done) {
        rpc('corp_pay', withArgs({ p_corp: c.id, p_to: v[0], p_amount: Number(v[1]), p_note: v[2] })).then(function (r) { done(r, 'Paid ' + v[1] + ' diamonds from ' + c.ticker + ' to ' + v[0] + '.'); });
      }));
      box.appendChild(mini('Pay a dividend (split across all shareholders)', [{ ph: 'Total amount', type: 'number', w: 150, min: 0.01 }], 'Pay dividend', function (v, done) {
        rpc('corp_dividend', withArgs({ p_corp: c.id, p_total: Number(v[0]) })).then(function (r) { done(r, r.ok ? 'Paid ' + money(r.paid) + ' in dividends (' + r.per_share + ' per share).' : ''); });
      }, 'Shares the company has not issued yet do not get a dividend. The money stays in the company wallet.'));
      box.appendChild(mini('Sell new company shares (' + num(c.treasury) + ' unissued)', [{ ph: 'Shares', type: 'number', w: 120, min: 1, step: 1 }, { ph: 'Price each', type: 'number', w: 120, min: 0.01 }], 'List for sale', function (v, done) {
        rpc('corp_list', withArgs({ p_corp: c.id, p_shares: Math.floor(Number(v[0])), p_price: Number(v[1]), p_ipo: true })).then(function (r) { done(r, 'Listed ' + v[0] + ' new ' + c.ticker + ' shares. Sales go into the company wallet.'); });
      }));
      box.appendChild(mini('Hand over ownership', [{ ph: 'New owner username', w: 180 }], 'Transfer', function (v, done) {
        if (!confirm('Hand ' + c.ticker + ' and its wallet over to ' + v[0] + '? You cannot undo this.')) { done({ ok: false, error: 'Cancelled.' }); return; }
        rpc('corp_transfer_owner', withArgs({ p_corp: c.id, p_to: v[0] })).then(function (r) { done(r, c.ticker + ' now belongs to ' + v[0] + '.'); });
      }));
    }

    // trades + log
    box.appendChild(h('h3', { text: 'Recent trades', style: 'margin-top:18px' }));
    if (!detail.trades.length) box.appendChild(h('p', { 'class': 'muted', text: 'No trades yet.' }));
    detail.trades.forEach(function (t) {
      box.appendChild(h('div', { 'class': 'muted', text: new Date(t.created_at).toLocaleString() + ': ' + t.buyer_name + ' bought ' + num(t.shares) + ' at ' + money(t.price) + ' from ' + (t.seller_name || 'the company') }));
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

  function render() { renderWallet(); renderPay(); renderList(); renderDetail(); renderCreate(); }

  /* ---------- start ---------- */
  if (!sb) { $('demo-banner').hidden = false; ['wallet', 'pay', 'corp-list', 'create'].forEach(function (id) { $(id).appendChild(h('p', { 'class': 'muted', text: 'Needs the live database.' })); }); return; }
  $('refresh').onclick = function () { status(''); reload(); };
  if (location.hash.length > 1) sel = decodeURIComponent(location.hash.slice(1)).toUpperCase();
  loadFees().then(reload).catch(function (e) { if (window.console) console.error(e); var el = $('load-error'); el.hidden = false; el.textContent = 'Corporations could not load. Run add-corporations.sql in Supabase if you have not yet.'; });
  setInterval(function () { var a = document.activeElement; if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return; reload(); }, Math.max(10, CFG.refreshSeconds || 20) * 1000);
})();
