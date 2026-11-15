(function () {
  'use strict';
  var EL = window.EL, h = EL.h, clear = EL.clear, MK = EL.mapkit;
  var CFG = window.ELECTION_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var configured = CFG.supabaseUrl && CFG.supabaseAnonKey &&
    CFG.supabaseUrl.indexOf('PASTE') === -1 && CFG.supabaseAnonKey.indexOf('PASTE') === -1 && window.supabase;
  var sb = configured ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
  var demo = !sb;

  /* ---------- data ---------- */
  function demoSnapshot() {
    var P = CFG.parties || {}, ids = Object.keys(P);
    var cands = [{ id: 'a', name: 'Sample Mayor A', party: ids[0], home_nation: 'maradon' }, { id: 'b', name: 'Sample Mayor B', party: ids[1], home_nation: 'narellan' }, { id: 'c', name: 'Sample Mayor C', party: ids[2] || ids[0], home_nation: 'corcelia' }];
    var res = [], sres = [], sc = [];
    var nat = ['maradon', 'flumina', 'seafaria', 'corcelia', 'narellan', 'athens'];
    nat.forEach(function (n, i) {
      cands.forEach(function (c, j) { res.push({ nation: n, candidate_id: c.id, votes: 30 + ((i * 7 + j * 13) % 40) * 12 }); });
      [0, 1].forEach(function (j) { var id = 's' + n + j; sc.push({ id: id, name: 'Senator ' + n + ' ' + (j + 1), party: ids[(i + j) % ids.length], nation: n }); sres.push({ nation: n, candidate_id: id, votes: 50 + ((i + j * 5) % 7) * 31 }); });
    });
    return { race: { title: 'Sample Mayor Election', short: 'Mayor', lower: 'mayor' }, nations: CFG.nations, seats: CFG.senateSeats, excluded: CFG.senateExcluded || [], parties: P,
      president: { candidates: cands, results: res }, senate: { candidates: sc, results: sres } };
  }
  var api = demo ? {
    list: function () { return Promise.resolve([{ id: 'demo', title: 'Sample Mayor Election', created_at: new Date().toISOString() }]); },
    get: function () { return Promise.resolve({ id: 'demo', title: 'Sample Mayor Election', created_at: new Date().toISOString(), data: demoSnapshot() }); }
  } : {
    list: function () { return sb.from('archives').select('id,title,created_at').order('created_at', { ascending: false }).then(function (r) { if (r.error) throw r.error; return r.data; }); },
    get: function (id) { return sb.from('archives').select('*').eq('id', id).maybeSingle().then(function (r) { if (r.error) throw r.error; return r.data; }); }
  };

  function fail(msg) { var e = $('load-error'); e.hidden = false; e.textContent = msg; }
  function fmtDate(d) { try { return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); } catch (e) { return ''; } }

  /* ---------- list ---------- */
  function showList() {
    $('list-view').hidden = false; $('view').hidden = true;
    api.list().then(function (rows) {
      var box = $('list'); clear(box);
      if (!rows.length) { box.appendChild(h('p', { 'class': 'muted', text: 'No elections have been archived yet. The first one will show up here.' })); return; }
      rows.forEach(function (r) {
        box.appendChild(h('a', { 'class': 'card mkt arch', href: 'archive.html?id=' + encodeURIComponent(r.id) },
          h('p', { 'class': 'eyebrow', text: fmtDate(r.created_at) }), h('h3', { text: r.title }), h('span', { 'class': 'muted', text: 'View results' })));
      });
    }).catch(function () { fail('The archive could not load. Run add-archive.sql in Supabase if you have not yet.'); });
  }

  /* ---------- one archived election ---------- */
  function showView(row) {
    $('list-view').hidden = true; $('view').hidden = false;
    var D = row.data, P = D.parties || {}, nations = D.nations || CFG.nations || {};
    var short = (D.race && D.race.short) || 'Mayor';
    document.title = row.title + ' | World Election';
    $('v-title').textContent = row.title; $('v-date').textContent = 'Archived ' + fmtDate(row.created_at);
    $('tab-pres').textContent = short + ' race';
    function pcol(p) { return (P[p] && P[p].color) || '#6B7688'; }
    function pname(p) { return (P[p] && P[p].name) || p; }
    function pshort(p) { return (P[p] && (P[p].short || P[p].name)) || p; }
    function nName(id) { return nations[id] || id; }

    /* president */
    var cand = {}; D.president.candidates.forEach(function (c) { cand[c.id] = c; });
    var byNation = {}, byCand = {}, total = 0;
    D.president.results.forEach(function (r) {
      var v = Number(r.votes); if (!cand[r.candidate_id]) return;
      (byNation[r.nation] = byNation[r.nation] || { by: {}, total: 0 }); byNation[r.nation].by[r.candidate_id] = (byNation[r.nation].by[r.candidate_id] || 0) + v; byNation[r.nation].total += v;
      byCand[r.candidate_id] = (byCand[r.candidate_id] || 0) + v; total += v;
    });
    function leader(by) { var k = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }); if (!k.length) return null; return { id: k[0], tie: k.length > 1 && by[k[1]] === by[k[0]] }; }
    var order = Object.keys(byCand).sort(function (a, b) { return byCand[b] - byCand[a]; });
    var win = order.length ? order[0] : null;
    $('v-headline').textContent = win ? cand[win].name + ' won with ' + EL.pct(byCand[win] / total) + ' of the vote.' : 'No votes were recorded.';
    $('st-votes').textContent = EL.num(total); $('st-votes-l').textContent = short + ' votes';
    $('st-nations').textContent = Object.keys(byNation).length;

    var map = MK.create($('map'), { onClick: select, tip: function (id) {
      var d = byNation[id]; if (!d) return nName(id) + ': no votes';
      var l = leader(d.by); return nName(id) + ': ' + (l.tie ? 'tied' : cand[l.id].name + ' ' + EL.pct(d.by[l.id] / d.total, 0)) + ' of ' + EL.num(d.total) + ' votes';
    }, fixed: function (id) { return !(CFG.nations && CFG.nations[id]) || id === 'igt-town'; } });
    Object.keys(map.refs).forEach(function (id) {
      var d = byNation[id], l = d && leader(d.by);
      if (!l) return;
      if (l.tie) { map.paint(id, MK.TIED, 'Tied', true); return; }
      var share = d.by[l.id] / d.total;
      map.paint(id, EL.mix(pcol(cand[l.id].party), MK.strength(share)), EL.pct(share, 0));
    });
    var lg = $('legend'); clear(lg);
    lg.appendChild(h('span', { 'class': 'labels', text: 'Darker = a bigger share of the nation\'s vote' }));
    var steps = h('div', { 'class': 'steps' }); MK.BINS.forEach(function (b) { steps.appendChild(h('span', { style: 'background:' + EL.mix('#14202E', b.t), title: b.label })); }); lg.appendChild(steps);

    var totals = $('totals'); clear(totals);
    order.forEach(function (id, i) {
      var c = cand[id], share = byCand[id] / total;
      totals.appendChild(h('div', { 'class': 'row' },
        h('div', { 'class': 'row-head' }, h('span', null, h('span', { 'class': 'sw', style: 'background:' + pcol(c.party) }), h('b', { text: c.name }), i === 0 ? h('span', { 'class': 'badge', text: 'Winner' }) : null, h('span', { 'class': 'muted', text: ' ' + pname(c.party) })),
          h('span', { text: EL.num(byCand[id]) + ' · ' + EL.pct(share) })),
        h('div', { 'class': 'bar' }, h('i', { style: 'width:' + (share * 100).toFixed(1) + '%;background:' + pcol(c.party) }))));
    });
    if (!order.length) totals.appendChild(h('p', { 'class': 'muted', text: 'No votes were recorded.' }));

    var rows = $('nation-rows'); clear(rows);
    Object.keys(nations).filter(function (n) { return n !== 'igt-town'; }).forEach(function (n) {
      var d = byNation[n], l = d && leader(d.by);
      rows.appendChild(h('tr', null, h('th', { scope: 'row', text: nName(n) }),
        h('td', null, l ? (l.tie ? 'Tied' : h('span', null, h('span', { 'class': 'sw', style: 'background:' + pcol(cand[l.id].party) }), cand[l.id].name)) : h('span', { 'class': 'muted', text: 'No votes' })),
        h('td', { 'class': 'n', text: l && !l.tie ? EL.pct(d.by[l.id] / d.total) : '-' }), h('td', { 'class': 'n', text: d ? EL.num(d.total) : '0' })));
    });

    var panel = $('panel');
    function select(id) {
      map.select(id); clear(panel);
      var d = byNation[id];
      panel.appendChild(h('h2', { text: nName(id) }));
      if (!d) { panel.appendChild(h('p', { 'class': 'muted', text: 'No votes were recorded here.' })); return; }
      panel.appendChild(h('p', { 'class': 'muted', text: EL.num(d.total) + ' votes' }));
      var rs = h('div', { 'class': 'rows' });
      Object.keys(d.by).sort(function (a, b) { return d.by[b] - d.by[a]; }).forEach(function (cid) {
        var sh = d.by[cid] / d.total;
        rs.appendChild(h('div', { 'class': 'row' }, h('div', { 'class': 'row-head' }, h('span', null, h('span', { 'class': 'sw', style: 'background:' + pcol(cand[cid].party) }), h('b', { text: cand[cid].name })), h('span', { text: EL.num(d.by[cid]) + ' · ' + EL.pct(sh) })),
          h('div', { 'class': 'bar' }, h('i', { style: 'width:' + (sh * 100).toFixed(1) + '%;background:' + pcol(cand[cid].party) }))));
      });
      panel.appendChild(rs);
    }
    clear(panel); panel.appendChild(h('h2', { text: 'Pick a nation' })); panel.appendChild(h('p', { 'class': 'muted', text: 'Click a nation on the map for its full vote breakdown.' }));

    /* senate */
    var sc = {}; D.senate.candidates.forEach(function (c) { sc[c.id] = c; });
    var excl = {}; (D.excluded || []).forEach(function (n) { excl[n] = true; });
    function seatsOf(n) { if (excl[n]) return 0; var m = D.seats; return m && m[n] !== undefined ? Number(m[n]) : (CFG.senateSeatsPerNation || 2); }
    var sByNation = {}; D.senate.results.forEach(function (r) { if (!sc[r.candidate_id]) return; var o = sByNation[r.nation] = sByNation[r.nation] || { by: {}, total: 0 }; o.by[r.candidate_id] = (o.by[r.candidate_id] || 0) + Number(r.votes); o.total += Number(r.votes); });
    var nat = Object.keys(nations).filter(function (n) { return n !== 'igt-town' && !excl[n]; });
    var seatsTotal = 0, partySeats = {}, nRes = {};
    nat.forEach(function (n) {
      var seats = seatsOf(n); seatsTotal += seats;
      var o = sByNation[n] || { by: {}, total: 0 };
      var list = D.senate.candidates.filter(function (c) { return c.nation === n; }).map(function (c) { return { c: c, v: o.by[c.id] || 0 }; }).sort(function (a, b) { return b.v - a.v || (a.c.name < b.c.name ? -1 : 1); });
      var winners = [], tied = false;
      if (o.total && seats > 0) {
        var withV = list.filter(function (x) { return x.v > 0; }).length, k = Math.min(seats, withV);
        if (list.length > k && list[k - 1].v === list[k].v && list[k].v > 0) { tied = true; var cut = list[k - 1].v; winners = list.filter(function (x) { return x.v > cut; }); }
        else winners = list.slice(0, k);
      }
      winners.forEach(function (w) { partySeats[w.c.party] = (partySeats[w.c.party] || 0) + 1; });
      nRes[n] = { winners: winners, tied: tied, total: o.total, seats: seats };
    });
    var decided = 0; Object.keys(partySeats).forEach(function (p) { decided += partySeats[p]; });
    var maj = Math.floor(seatsTotal / 2) + 1;
    var pOrder = Object.keys(partySeats).sort(function (a, b) { return partySeats[b] - partySeats[a]; });
    $('sen-sub').textContent = !decided ? 'No Senate seats were decided.' : (partySeats[pOrder[0]] >= maj ? pname(pOrder[0]) + ' held a majority with ' + partySeats[pOrder[0]] + ' of ' + seatsTotal + ' seats.' : pname(pOrder[0]) + ' was the largest party with ' + partySeats[pOrder[0]] + ' of ' + seatsTotal + ' seats; ' + maj + ' were needed for a majority.');
    var bar = $('seatbar'); clear(bar);
    pOrder.forEach(function (p) { bar.appendChild(h('i', { style: 'width:' + (partySeats[p] / seatsTotal * 100) + '%;background:' + pcol(p), title: pname(p) + ': ' + partySeats[p] })); });
    var mj = $('maj'); mj.hidden = !seatsTotal; mj.style.left = ((maj - 0.5) / seatsTotal * 100) + '%';
    var sl = $('seatlist'); clear(sl);
    pOrder.forEach(function (p) { sl.appendChild(h('div', null, h('span', { 'class': 'sw', style: 'background:' + pcol(p) }), h('b', { text: pname(p) }), ': ' + partySeats[p] + (partySeats[p] === 1 ? ' seat' : ' seats'))); });

    var smap = MK.create($('smap'), { fixed: function (id) { return !(CFG.nations && CFG.nations[id]) || id === 'igt-town' || !!excl[id]; },
      tip: function (id) { var r = nRes[id]; if (!r) return nName(id); return nName(id) + ': ' + (r.winners.length ? r.winners.map(function (w) { return w.c.name; }).join(', ') : 'no senators'); } });
    nat.forEach(function (n) {
      var r = nRes[n];
      if (r.seats === 0) { smap.paint(n, MK.NO_DATA, 'No seats'); return; }
      if (!r.winners.length) { smap.paint(n, MK.NO_DATA, 'No votes'); return; }
      var ps = []; r.winners.forEach(function (w) { if (ps.indexOf(w.c.party) === -1) ps.push(w.c.party); });
      if (ps.length === 1 && !r.tied) smap.paint(n, pcol(ps[0]), pshort(ps[0]));
      else if (ps.length >= 2) smap.paint(n, smap.stripe(pcol(ps[0]), pcol(ps[1])), pshort(ps[0]) + ' + ' + pshort(ps[1]), true);
      else smap.paint(n, MK.TIED, 'Tied', true);
    });
    var slg = $('slegend'); clear(slg);
    pOrder.forEach(function (p) { slg.appendChild(h('div', null, h('span', { 'class': 'sw', style: 'background:' + pcol(p) }), pname(p))); });
    slg.appendChild(h('div', { 'class': 'muted', text: 'Stripes = seats split between parties' }));

    function winnersCell(ws) { var sp = h('span'); ws.forEach(function (w) { sp.appendChild(h('span', { style: 'display:block' }, h('span', { 'class': 'sw', style: 'background:' + pcol(w.c.party) }), w.c.name + ' (' + pshort(w.c.party) + ')')); }); return sp; }
    var sr = $('sen-rows'); clear(sr);
    nat.forEach(function (n) {
      var r = nRes[n];
      sr.appendChild(h('tr', null, h('th', { scope: 'row', text: nName(n) }),
        h('td', null, r.seats === 0 ? h('span', { 'class': 'muted', text: 'No seats' }) : (r.winners.length ? winnersCell(r.winners) : h('span', { 'class': 'muted', text: 'No votes' }))),
        h('td', { 'class': 'n', text: r.seats === 0 ? '-' : EL.num(r.total) }) ));
    });

    function tab(which) {
      var p = which === 'pres';
      $('pane-pres').hidden = !p; $('pane-sen').hidden = p;
      $('tab-pres').className = p ? 'on' : ''; $('tab-sen').className = p ? '' : 'on';
      $('tab-pres').setAttribute('aria-selected', String(p)); $('tab-sen').setAttribute('aria-selected', String(!p));
    }
    $('tab-pres').onclick = function () { tab('pres'); }; $('tab-sen').onclick = function () { tab('sen'); };
    tab('pres');
  }

  $('demo-banner').hidden = !demo;
  var id = (location.search.match(/[?&]id=([^&]+)/) || [])[1];
  if (!id) showList();
  else api.get(decodeURIComponent(id)).then(function (row) {
    if (!row) { fail('That archive could not be found.'); showList(); return; }
    showView(row);
  }).catch(function (e) { if (window.console) console.error(e); fail('The archive could not load.'); showList(); });
})();
