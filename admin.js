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
        sb.from('parties').select('*').order('sort', { ascending: true }).order('created_at', { ascending: true })
      ]).then(function (res) {
        partyRows = res[7].error ? null : res[7].data;
        if (partyRows && partyRows.length) { var pm = {}; partyRows.forEach(function (r) { pm[r.id] = { name: r.name, short: r.short || undefined, color: r.color }; }); PARTIES = pm; }
        renderParties(partyRows);
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
