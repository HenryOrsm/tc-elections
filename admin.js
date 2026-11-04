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
        sb.from('votes').select('id,mc_username,nation,candidate_id,created_at').order('created_at', { ascending: false }).limit(500)
      ]).then(function (res) {
        if (res[0].error || res[1].error) { say('dash-msg', 'Could not load data.', true); return; }
        render(res[0].data, res[1].data);
      });
    });
  }

  var PARTIES = CFG.parties || { blue: { name: 'Blue Party', color: '#1063DF' }, gold: { name: 'Gold Party', color: '#DDAA22' } };
  function party(c) { return PARTIES[c.party] || PARTIES[Object.keys(PARTIES)[0]]; }

  function act(promise, okText) {
    return promise.then(function (r) {
      if (r.error) { say('dash-msg', 'That did not work: ' + r.error.message, true); return; }
      say('dash-msg', okText, false);
      return load();
    });
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
      v.appendChild(h('div', { 'class': 'item' },
        h('div', { 'class': 'who' }, h('b', { text: x.mc_username }),
          h('span', { text: 'Voted ' + who + ' · ' + nationName(x.nation) + ' · ' + new Date(x.created_at).toLocaleString() })),
        h('div', { 'class': 'acts' },
          h('button', { 'class': 'btn small ghost', type: 'button', text: 'Remove vote', onclick: function () {
            act(sb.from('votes').delete().eq('id', x.id), 'Removed the vote from ' + x.mc_username + '.');
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
  $('signout').addEventListener('click', function () { sb.auth.signOut().then(function () { showDash(false); }); });

  sb.auth.getSession().then(function (r) { if (r.data && r.data.session) load(); });
})();
