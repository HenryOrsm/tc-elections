(function () {
  'use strict';
  var EL = window.EL, h = EL.h, clear = EL.clear;
  var CFG = window.ELECTION_CONFIG;
  var $ = function (id) { return document.getElementById(id); };

  var configured = CFG.supabaseUrl && CFG.supabaseAnonKey &&
    CFG.supabaseUrl.indexOf('PASTE') === -1 && CFG.supabaseAnonKey.indexOf('PASTE') === -1 && window.supabase;
  var sb = configured ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;

  function nationName(id) { return id === 'other' ? 'Not from any nation' : ((CFG.nations && CFG.nations[id]) || id); }
  function say(id, text, isErr) { var m = $(id); m.textContent = text; m.className = 'msg' + (isErr ? ' err' : ''); }

  if (!sb) {
    say('login-msg', 'Not connected yet. Add your Supabase URL and anon key in js/config.js first.', true);
    $('login-form').hidden = true;
    return;
  }

  function showDash(on) { $('login').hidden = on; $('dash').hidden = !on; $('signout').hidden = !on; }

  function load() {
    return sb.rpc('am_i_admin').then(function (r) {
      if (r.error || r.data !== true) {
        showDash(false);
        say('login-msg', 'This account is not an admin. Add its email to the admin_emails table in Supabase.', true);
        return sb.auth.signOut();
      }
      showDash(true);
      return Promise.all([
        sb.from('candidates').select('*').order('created_at', { ascending: true }),
        sb.from('votes').select('id,mc_username,nation,candidate_id,created_at').not('mc_username', 'like', 'admin_test_%').order('created_at', { ascending: false }).limit(500),
        sb.from('senate_candidates').select('*').order('created_at', { ascending: true }),
        sb.from('senate_votes').select('id,mc_username,nation,candidate_id,created_at').not('mc_username', 'like', 'admin_test_%').order('created_at', { ascending: false }).limit(500),
        sb.from('nation_info').select('*'),
        sb.from('votes').select('id', { count: 'exact', head: true }).like('mc_username', 'admin_test_%'),
        sb.from('senate_votes').select('id', { count: 'exact', head: true }).like('mc_username', 'admin_test_%'),
        sb.from('parties').select('*').order('sort', { ascending: true }).order('created_at', { ascending: true }),
        sb.from('markets').select('*').order('created_at', { ascending: false }),
        sb.from('wallets').select('username,display_name,balance').order('balance', { ascending: false }).limit(300),
        sb.from('market_settings').select('*')
      ]).then(function (res) {
        partyRows = res[7].error ? null : res[7].data;
        if (partyRows && partyRows.length) { var pm = {}; partyRows.forEach(function (r) { pm[r.id] = { name: r.name, short: r.short || undefined, color: r.color }; }); PARTIES = pm; }
        renderParties(partyRows);
        allCands = res[0].error ? [] : res[0].data;
        renderMarketAdmin(res[8].error ? null : res[8].data, res[9].error ? [] : res[9].data, res[10].error ? [] : res[10].data);
        if (res[0].error || res[1].error) { say('dash-msg', 'Could not load data.', true); return; }
        render(res[0].data, res[1].data);
        renderSenate(res[2].error ? null : res[2].data, res[3].error ? null : res[3].data);
        renderNations(res[4].error ? null : res[4].data);
        $('test-count').textContent = (res[5].count || 0).toLocaleString() + ' admin test votes are hidden from this list.';
        $('test-count-sen').textContent = (res[6].count || 0).toLocaleString() + ' admin test votes are hidden from this list.';
      });
    });
  }

  var PARTIES = CFG.parties || { blue: { name: 'Blue Party', color: '#1063DF' }, gold: { name: 'Gold Party', color: '#DDAA22' }, red: { name: 'Red Party', color: '#D32F2F' } };
  var partyRows = null;
  var allCands = [];
  function party(c) { return PARTIES[c.party] || PARTIES[Object.keys(PARTIES)[0]]; }

  function act(promise, okText) {
    return promise.then(function (r) {
      if (r.error) {
        say('dash-msg', r.error.code === '23503' ? 'That party still has candidates. Remove or reassign them first.' : 'That did not work: ' + r.error.message, true);
        return;
      }
      say('dash-msg', okText, false);
      return load();
    });
  }


  function isTest(x) { return /^admin_test_/i.test(x.mc_username); }
  function nationIds() { return Object.keys(CFG.nations || {}).filter(function (k) { return k !== 'igt-town'; }); }

  // One vote row with a "Change vote" editor. table is 'votes' or 'senate_votes'.
  // withNation: president votes can also change the voter's nation. Senate votes keep their nation.
  function voteRow(table, x, cands, who, withNation) {
    var wrap = h('div', { 'class': 'item' });
    var label = isTest(x) ? 'Admin test vote' : x.mc_username;
    function showNormal() {
      clear(wrap);
      wrap.appendChild(h('div', { 'class': 'who' }, h('b', { text: label }),
        h('span', { text: 'Voted ' + who + ' · ' + nationName(x.nation) + ' · ' + new Date(x.created_at).toLocaleString() })));
      wrap.appendChild(h('div', { 'class': 'acts' },
        h('button', { 'class': 'btn small ghost', type: 'button', text: 'Change vote', onclick: showEdit }),
        h('button', { 'class': 'btn small ghost', type: 'button', text: 'Remove vote', onclick: function () {
          act(sb.from(table).delete().eq('id', x.id), 'Removed the vote.');
        } })));
    }
    function showEdit() {
      clear(wrap);
      var opts = cands.filter(function (c) { return c.approved && (withNation || c.nation === x.nation); });
      var candSel = h('select', { 'aria-label': 'Candidate' });
      opts.forEach(function (c) { candSel.appendChild(h('option', { value: c.id, text: c.name + ' (' + party(c).name + ')' })); });
      candSel.value = x.candidate_id;
      var natSel = null;
      if (withNation) {
        natSel = h('select', { 'aria-label': 'Voter nation' });
        nationIds().forEach(function (n) { natSel.appendChild(h('option', { value: n, text: nationName(n) })); });
        natSel.value = x.nation;
      }
      wrap.appendChild(h('div', { 'class': 'who' }, h('b', { text: 'Change vote: ' + label }), candSel, natSel));
      wrap.appendChild(h('div', { 'class': 'acts' },
        h('button', { 'class': 'btn small', type: 'button', text: 'Save', onclick: function () {
          var patch = { candidate_id: candSel.value };
          if (natSel) patch.nation = natSel.value;
          act(sb.from(table).update(patch).eq('id', x.id), 'Vote changed.');
        } }),
        h('button', { 'class': 'btn small ghost', type: 'button', text: 'Cancel', onclick: showNormal })));
    }
    showNormal();
    return wrap;
  }

  function render(cands, votes) {
    var pending = cands.filter(function (c) { return !c.approved; });
    var approved = cands.filter(function (c) { return c.approved; });
    var byId = {}; cands.forEach(function (c) { byId[c.id] = c; });

    $('n-pending').textContent = '(' + pending.length + ')';
    $('n-approved').textContent = '(' + approved.length + ')';
    $('n-votes').textContent = '(' + votes.length + (votes.length === 500 ? '+' : '') + ')';

    var p = $('pending'); clear(p);
    if (!pending.length) p.appendChild(h('p', { 'class': 'muted', text: 'Nobody is waiting.' }));
    pending.forEach(function (c) {
      p.appendChild(h('div', { 'class': 'item' },
        h('div', { 'class': 'who' }, h('b', { text: c.name }),
          h('span', { text: party(c).name + ' · username ' + c.mc_username + ' · from ' + nationName(c.home_nation) }),
          c.pitch ? h('span', { text: c.pitch }) : null),
        h('div', { 'class': 'acts' },
          h('button', { 'class': 'btn small', type: 'button', text: 'Approve', onclick: function () {
            act(sb.from('candidates').update({ approved: true, color: party(c).color }).eq('id', c.id), c.name + ' is on the ballot.');
          } }),
          h('button', { 'class': 'btn small danger', type: 'button', text: 'Reject', onclick: function () {
            if (confirm('Reject and delete ' + c.name + '?')) act(sb.from('candidates').delete().eq('id', c.id), c.name + ' was rejected.');
          } }))));
    });

    var a = $('approved'); clear(a);
    if (!approved.length) a.appendChild(h('p', { 'class': 'muted', text: 'No approved candidates yet.' }));
    approved.forEach(function (c) {
      a.appendChild(h('div', { 'class': 'item' },
        h('div', { 'class': 'who' },
          h('b', null, h('span', { 'class': 'sw', style: 'background:' + party(c).color }), c.name),
          h('span', { text: party(c).name + ' · username ' + c.mc_username + ' · from ' + nationName(c.home_nation) })),
        h('div', { 'class': 'acts' },
          h('button', { 'class': 'btn small danger', type: 'button', text: 'Remove', onclick: function () {
            if (confirm('Remove ' + c.name + ' and all of their votes?')) act(sb.from('candidates').delete().eq('id', c.id), c.name + ' was removed.');
          } }))));
    });

    var v = $('votes'); clear(v);
    if (!votes.length) v.appendChild(h('p', { 'class': 'muted', text: 'No votes yet.' }));
    votes.forEach(function (x) {
      var who = byId[x.candidate_id] ? byId[x.candidate_id].name : 'Unknown';
      v.appendChild(voteRow('votes', x, cands, who, true));
    });
  }


  function renderSenate(cands, votes) {
    var ids = ['sen-pending', 'sen-approved', 'sen-votes'];
    if (!cands || !votes) {
      ids.forEach(function (id) { var el = $(id); clear(el); el.appendChild(h('p', { 'class': 'muted', text: 'The senate tables are not set up yet. Run add-senate-and-red.sql in Supabase first.' })); });
      return;
    }
    var pending = cands.filter(function (c) { return !c.approved; });
    var approved = cands.filter(function (c) { return c.approved; });
    var byId = {}; cands.forEach(function (c) { byId[c.id] = c; });
    $('sn-pending').textContent = '(' + pending.length + ')';
    $('sn-approved').textContent = '(' + approved.length + ')';
    $('sn-votes').textContent = '(' + votes.length + (votes.length === 500 ? '+' : '') + ')';

    function info(c) { return party(c).name + ' · ' + nationName(c.nation) + ' · username ' + c.mc_username; }

    var p = $('sen-pending'); clear(p);
    if (!pending.length) p.appendChild(h('p', { 'class': 'muted', text: 'Nobody is waiting.' }));
    pending.forEach(function (c) {
      p.appendChild(h('div', { 'class': 'item' },
        h('div', { 'class': 'who' }, h('b', { text: c.name }), h('span', { text: info(c) }), c.pitch ? h('span', { text: c.pitch }) : null),
        h('div', { 'class': 'acts' },
          h('button', { 'class': 'btn small', type: 'button', text: 'Approve', onclick: function () {
            act(sb.from('senate_candidates').update({ approved: true }).eq('id', c.id), c.name + ' is on the ' + nationName(c.nation) + ' senate ballot.');
          } }),
          h('button', { 'class': 'btn small danger', type: 'button', text: 'Reject', onclick: function () {
            if (confirm('Reject and delete ' + c.name + '?')) act(sb.from('senate_candidates').delete().eq('id', c.id), c.name + ' was rejected.');
          } }))));
    });

    var a = $('sen-approved'); clear(a);
    if (!approved.length) a.appendChild(h('p', { 'class': 'muted', text: 'No approved senate candidates yet.' }));
    approved.forEach(function (c) {
      a.appendChild(h('div', { 'class': 'item' },
        h('div', { 'class': 'who' }, h('b', null, h('span', { 'class': 'sw', style: 'background:' + party(c).color }), c.name), h('span', { text: info(c) })),
        h('div', { 'class': 'acts' },
          h('button', { 'class': 'btn small danger', type: 'button', text: 'Remove', onclick: function () {
            if (confirm('Remove ' + c.name + ' and all of their votes?')) act(sb.from('senate_candidates').delete().eq('id', c.id), c.name + ' was removed.');
          } }))));
    });

    var v = $('sen-votes'); clear(v);
    if (!votes.length) v.appendChild(h('p', { 'class': 'muted', text: 'No senate votes yet.' }));
    votes.forEach(function (x) {
      var who = byId[x.candidate_id] ? byId[x.candidate_id].name : 'Unknown';
      v.appendChild(voteRow('senate_votes', x, cands, who, false));
    });
  }

  /* ---------- diamond markets ---------- */
  function lmsrYes(m) { var qy = Number(m.q_yes), qn = Number(m.q_no), b = Number(m.b), mx = Math.max(qy, qn), ey = Math.exp((qy - mx) / b), en = Math.exp((qn - mx) / b); return ey / (ey + en); }
  function actRpc(promise, okText) {
    return promise.then(function (r) {
      if (r.error) { say('dash-msg', 'That did not work: ' + r.error.message, true); return; }
      if (r.data && r.data.ok === false) { say('dash-msg', r.data.error || 'That did not work.', true); return; }
      say('dash-msg', okText, false);
      return load();
    });
  }
  function renderMarketAdmin(markets, wallets, settings) {
    var tools = $('mk-tools'), pend = $('mk-pending'), live = $('mk-live'), wal = $('mk-wallets');
    [tools, pend, live, wal].forEach(clear);
    if (!markets) { tools.appendChild(h('p', { 'class': 'muted', text: 'The markets tables are not set up yet. Run add-markets.sql in Supabase first.' })); $('mk-pend-n').textContent = ''; return; }

    // one-click election markets
    var existing = {}; markets.forEach(function (m) { if (m.ref) existing[m.kind + ':' + m.ref] = true; });
    var toMake = [];
    allCands.filter(function (c) { return c.approved; }).forEach(function (c) {
      if (!existing['candidate:' + c.id]) toMake.push({ question: 'Will ' + c.name + ' win the ' + EL.race.title + '?', kind: 'candidate', ref: c.id, status: 'open', description: 'Settles when the polls close.' });
    });
    Object.keys(PARTIES).forEach(function (k) {
      if (!existing['senate:' + k]) toMake.push({ question: 'Will ' + PARTIES[k].name + ' win the most Senate seats?', kind: 'senate', ref: k, status: 'open', description: 'Settles on the final Senate seat count.' });
    });
    tools.appendChild(h('div', { 'class': 'acts', style: 'margin-bottom:12px' },
      h('button', { 'class': 'btn small', type: 'button', text: toMake.length ? 'Create ' + toMake.length + ' election market' + (toMake.length === 1 ? '' : 's') : 'Election markets are up to date', disabled: toMake.length ? null : 'disabled',
        onclick: function () { act(sb.from('markets').insert(toMake), 'Created ' + toMake.length + ' markets.'); } })));

    // custom market
    var cq = h('input', { type: 'text', maxlength: 160, placeholder: 'Question (a Yes or No)', 'aria-label': 'Market question' });
    var cd = h('input', { type: 'text', maxlength: 500, placeholder: 'How it settles (optional)', 'aria-label': 'Market details' });
    var cb = h('select', { 'aria-label': 'Liquidity' });
    [['25', 'Twitchy (prices jump, low risk)'], ['50', 'Normal'], ['100', 'Steady'], ['250', 'Deep (prices barely move, costs the house more)']].forEach(function (o) { cb.appendChild(h('option', { value: o[0], text: o[1] })); });
    cb.value = '50';
    var cc = h('input', { type: 'datetime-local', 'aria-label': 'Trading closes' });
    tools.appendChild(h('div', { 'class': 'item', style: 'display:block' },
      h('div', { 'class': 'who' }, h('b', { text: 'New custom market' }), cq, cd, cb, h('span', { text: 'Trading closes (optional)' }), cc),
      h('div', { 'class': 'acts', style: 'margin-top:8px' }, h('button', { 'class': 'btn small', type: 'button', text: 'Create market', onclick: function () {
        if (cq.value.trim().length < 5) { say('dash-msg', 'Write the question out.', true); return; }
        act(sb.from('markets').insert({ question: cq.value.trim(), description: cd.value.trim() || null, kind: 'custom', status: 'open', b: Number(cb.value), closes_at: cc.value ? new Date(cc.value).toISOString() : null }), 'Market created.');
      } }))));

    // starter diamonds
    var starterRow = (settings || []).filter(function (r) { return r.key === 'starter_diamonds'; })[0];
    var st = h('input', { type: 'number', min: 0, step: 1, value: starterRow ? starterRow.value : 100, 'aria-label': 'Starter diamonds', style: 'width:110px' });
    tools.appendChild(h('div', { 'class': 'item' },
      h('div', { 'class': 'who' }, h('b', { text: 'Free starter diamonds' }), h('span', { text: 'What a new wallet starts with. Set 0 to turn the freebie off.' })),
      h('div', { 'class': 'acts' }, st, h('button', { 'class': 'btn small', type: 'button', text: 'Save', onclick: function () {
        act(sb.from('market_settings').update({ value: Math.max(0, Number(st.value) || 0) }).eq('key', 'starter_diamonds'), 'Starter diamonds updated.');
      } }))));

    // proposals
    var pending = markets.filter(function (m) { return m.status === 'pending'; });
    $('mk-pend-n').textContent = '(' + pending.length + ')';
    if (!pending.length) pend.appendChild(h('p', { 'class': 'muted', text: 'Nobody is waiting.' }));
    pending.forEach(function (m) {
      pend.appendChild(h('div', { 'class': 'item' },
        h('div', { 'class': 'who' }, h('b', { text: m.question }), h('span', { text: 'From ' + (m.created_by || 'someone') + (m.description ? ' · ' + m.description : '') + (m.closes_at ? ' · closes ' + new Date(m.closes_at).toLocaleString() : '') })),
        h('div', { 'class': 'acts' },
          h('button', { 'class': 'btn small', type: 'button', text: 'Approve', onclick: function () { act(sb.from('markets').update({ status: 'open' }).eq('id', m.id), 'Market is live.'); } }),
          h('button', { 'class': 'btn small danger', type: 'button', text: 'Reject', onclick: function () { if (confirm('Reject this suggestion?')) act(sb.from('markets').delete().eq('id', m.id), 'Rejected.'); } }))));
    });

    // live markets
    var liveList = markets.filter(function (m) { return m.status === 'open' || m.status === 'closed'; });
    if (!liveList.length) live.appendChild(h('p', { 'class': 'muted', text: 'No open markets.' }));
    liveList.forEach(function (m) {
      function settle(outcome, label) { if (confirm(label + ' for: ' + m.question + '\n\nThis pays everyone out and cannot be undone.')) actRpc(sb.rpc('admin_settle_market', { p_market: m.id, p_outcome: outcome }), 'Settled.'); }
      live.appendChild(h('div', { 'class': 'item', style: 'display:block' },
        h('div', { 'class': 'who' }, h('b', { text: m.question }), h('span', { text: (m.status === 'open' ? 'Open' : 'Trading closed') + ' · Yes at ' + Math.round(lmsrYes(m) * 100) + '%' })),
        h('div', { 'class': 'acts', style: 'margin-top:8px;display:flex;gap:6px;flex-wrap:wrap' },
          h('button', { 'class': 'btn small ghost', type: 'button', text: m.status === 'open' ? 'Close trading' : 'Reopen', onclick: function () { act(sb.from('markets').update({ status: m.status === 'open' ? 'closed' : 'open' }).eq('id', m.id), m.status === 'open' ? 'Trading closed.' : 'Reopened.'); } }),
          h('button', { 'class': 'btn small', type: 'button', text: 'Settle Yes', onclick: function () { settle('yes', 'Settle YES'); } }),
          h('button', { 'class': 'btn small', type: 'button', text: 'Settle No', onclick: function () { settle('no', 'Settle NO'); } }),
          h('button', { 'class': 'btn small danger', type: 'button', text: 'Void (refund)', onclick: function () { settle('void', 'VOID and refund'); } }))));
    });
    var done = markets.filter(function (m) { return m.status === 'settled'; }).slice(0, 8);
    done.forEach(function (m) { live.appendChild(h('div', { 'class': 'item' }, h('div', { 'class': 'who' }, h('b', { text: m.question }), h('span', { text: 'Settled: ' + m.outcome })))); });

    // wallets
    var wu = h('input', { type: 'text', placeholder: 'Minecraft username', 'aria-label': 'Wallet username', autocomplete: 'off' });
    var wa = h('input', { type: 'number', step: 'any', placeholder: 'Diamonds (negative to take away)', 'aria-label': 'Amount' });
    var wr = h('input', { type: 'text', maxlength: 80, placeholder: 'Note, e.g. deposited 10 real diamonds', 'aria-label': 'Note' });
    wal.appendChild(h('div', { 'class': 'item', style: 'display:block' },
      h('div', { 'class': 'who' }, h('b', { text: 'Add or remove diamonds' }), wu, wa, wr),
      h('div', { 'class': 'acts', style: 'margin-top:8px' }, h('button', { 'class': 'btn small', type: 'button', text: 'Apply', onclick: function () {
        var n = Number(wa.value); if (!wu.value.trim() || !n) { say('dash-msg', 'Enter a username and a non-zero amount.', true); return; }
        actRpc(sb.rpc('admin_credit', { p_user: wu.value, p_amount: n, p_reason: wr.value }), (n > 0 ? 'Added ' : 'Removed ') + Math.abs(n) + ' diamonds.');
      } }))));
    var pu = h('input', { type: 'text', placeholder: 'Minecraft username', 'aria-label': 'Username to reset', autocomplete: 'off' });
    var pp = h('input', { type: 'text', maxlength: 8, placeholder: 'New PIN (4 to 8 digits)', 'aria-label': 'New PIN', autocomplete: 'off' });
    wal.appendChild(h('div', { 'class': 'item', style: 'display:block' },
      h('div', { 'class': 'who' }, h('b', { text: 'Reset someone\'s PIN' }), pu, pp),
      h('div', { 'class': 'acts', style: 'margin-top:8px' }, h('button', { 'class': 'btn small', type: 'button', text: 'Set PIN', onclick: function () {
        actRpc(sb.rpc('admin_set_pin', { p_user: pu.value, p_pin: pp.value }), 'PIN changed.');
      } }))));
    if (!wallets.length) wal.appendChild(h('p', { 'class': 'muted', text: 'No wallets yet.' }));
    wallets.forEach(function (w) {
      wal.appendChild(h('div', { 'class': 'item' }, h('div', { 'class': 'who' }, h('b', { text: w.display_name }), h('span', { text: Number(w.balance).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' diamonds' })),
        h('div', { 'class': 'acts' }, h('button', { 'class': 'btn small ghost', type: 'button', text: 'Use name', onclick: function () { wu.value = w.display_name; pu.value = w.display_name; wa.focus(); } }))));
    });
  }

  function slug(name, taken) {
    var base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'party', id = base, i = 2;
    while (taken[id]) id = base.slice(0, 20) + '-' + (i++);
    return id;
  }

  function renderParties(rows) {
    var box = $('parties'); clear(box);
    if (!rows) { box.appendChild(h('p', { 'class': 'muted', text: 'The parties table is not set up yet. Run add-parties-table.sql in Supabase first.' })); return; }
    var taken = {}; rows.forEach(function (r) { taken[r.id] = true; });
    rows.forEach(function (p) {
      var col = p.color;
      var swatch = h('span', { 'class': 'sw big', style: 'background:' + col });
      var name = h('input', { type: 'text', maxlength: 60, value: p.name, 'aria-label': 'Party name' });
      var short = h('input', { type: 'text', maxlength: 16, value: p.short || '', placeholder: 'Short name for map labels', 'aria-label': 'Short name' });
      var picker = EL.colorPicker(col, function (c) { col = c; swatch.style.background = c; });
      box.appendChild(h('div', { 'class': 'item', style: 'display:block' },
        h('div', { 'class': 'who' }, h('b', null, swatch, p.name), name, short, picker),
        h('div', { 'class': 'acts', style: 'margin-top:8px' },
          h('button', { 'class': 'btn small', type: 'button', text: 'Save', onclick: function () {
            if (name.value.trim().length < 2) { say('dash-msg', 'Give the party a name.', true); return; }
            act(sb.from('parties').update({ name: name.value.trim(), short: short.value.trim() || null, color: col }).eq('id', p.id), name.value.trim() + ' saved.');
          } }),
          h('button', { 'class': 'btn small danger', type: 'button', text: 'Delete', onclick: function () {
            if (confirm('Delete ' + p.name + '?')) act(sb.from('parties').delete().eq('id', p.id), p.name + ' was deleted.');
          } }))));
    });
    // New party form
    var used = rows.map(function (r) { return r.color.toLowerCase(); });
    var ncol = EL.PARTY_COLORS.filter(function (c) { return used.indexOf(c.toLowerCase()) === -1; })[0] || EL.PARTY_COLORS[0];
    var nswatch = h('span', { 'class': 'sw big', style: 'background:' + ncol });
    var nname = h('input', { type: 'text', maxlength: 60, placeholder: 'New party name', 'aria-label': 'New party name' });
    var nshort = h('input', { type: 'text', maxlength: 16, placeholder: 'Short name for map labels (optional)', 'aria-label': 'New party short name' });
    var npicker = EL.colorPicker(ncol, function (c) { ncol = c; nswatch.style.background = c; });
    box.appendChild(h('div', { 'class': 'item', style: 'display:block' },
      h('div', { 'class': 'who' }, h('b', null, nswatch, 'Add a party'), nname, nshort, npicker),
      h('div', { 'class': 'acts', style: 'margin-top:8px' },
        h('button', { 'class': 'btn small', type: 'button', text: 'Add party', onclick: function () {
          var nm = nname.value.trim();
          if (nm.length < 2) { say('dash-msg', 'Give the new party a name.', true); return; }
          var max = rows.reduce(function (a, r) { return Math.max(a, r.sort || 0); }, 0);
          act(sb.from('parties').insert({ id: slug(nm, taken), name: nm, short: nshort.value.trim() || null, color: ncol, sort: max + 1 }), nm + ' added.');
        } }))));
  }

  function renderNations(rows) {
    var box = $('nation-info'); clear(box);
    if (!rows) { box.appendChild(h('p', { 'class': 'muted', text: 'The nation info table is not set up yet. Run add-nation-info.sql in Supabase first.' })); return; }
    var byN = {}; rows.forEach(function (r) { byN[r.nation] = r; });
    nationIds().forEach(function (n) {
      var cur = byN[n] || {};
      var leader = h('input', { type: 'text', maxlength: 60, value: cur.leader || '', placeholder: 'Leader', 'aria-label': nationName(n) + ' leader' });
      var capital = h('input', { type: 'text', maxlength: 60, value: cur.capital || '', placeholder: 'Capital', 'aria-label': nationName(n) + ' capital' });
      var blurb = h('textarea', { maxlength: 500, placeholder: 'Short description', 'aria-label': nationName(n) + ' description' });
      blurb.value = cur.blurb || '';
      box.appendChild(h('div', { 'class': 'item', style: 'display:block' },
        h('div', { 'class': 'who' }, h('b', { text: nationName(n) }), leader, capital, blurb),
        h('div', { 'class': 'acts', style: 'margin-top:8px' },
          h('button', { 'class': 'btn small', type: 'button', text: 'Save', onclick: function () {
            act(sb.from('nation_info').upsert({ nation: n, leader: leader.value.trim() || null, capital: capital.value.trim() || null, blurb: blurb.value.trim() || null, updated_at: new Date().toISOString() }), nationName(n) + ' saved.');
          } }))));
    });
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    say('login-msg', 'Signing in...', false);
    sb.auth.signInWithPassword({ email: $('a-email').value.trim(), password: $('a-pass').value }).then(function (r) {
      if (r.error) { say('login-msg', 'Wrong email or password.', true); return; }
      say('login-msg', '', false);
      return load();
    });
  });
  $('clr-votes').addEventListener('click', function () {
    if (confirm('Delete every admin test vote in the ' + EL.race.lower + ' race?')) act(sb.from('votes').delete().like('mc_username', 'admin_test_%'), 'Cleared the admin test votes.');
  });
  $('clr-sen').addEventListener('click', function () {
    if (confirm('Delete every admin test vote in the senate race?')) act(sb.from('senate_votes').delete().like('mc_username', 'admin_test_%'), 'Cleared the senate admin test votes.');
  });
  $('signout').addEventListener('click', function () { sb.auth.signOut().then(function () { showDash(false); }); });

  sb.auth.getSession().then(function (r) { if (r.data && r.data.session) load(); });
})();
