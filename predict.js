(function () {
  'use strict';
  var EL = window.EL, h = EL.h, clear = EL.clear, MK = EL.mapkit;
  var CFG = window.ELECTION_CONFIG, MAP = window.MAP_DATA;
  var $ = function (id) { return document.getElementById(id); };
  var configured = CFG.supabaseUrl && CFG.supabaseAnonKey &&
    CFG.supabaseUrl.indexOf('PASTE') === -1 && CFG.supabaseAnonKey.indexOf('PASTE') === -1 && window.supabase;
  var sb = configured ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
  var demo = !sb;

  var PARTIES = CFG.parties || {}, PARTY_IDS = Object.keys(PARTIES);
  function nName(id) { return (CFG.nations && CFG.nations[id]) || id; }
  var EXCL = {}; (CFG.senateExcluded || []).forEach(function (n) { EXCL[n] = true; });
  var NATIONS = MAP.regions.filter(function (r) { return r.claimable; }).map(function (r) { return r.id; });
  function seatsOf(n) { if (EXCL[n]) return 0; var m = CFG.senateSeats; return m && m[n] !== undefined ? Number(m[n]) : (CFG.senateSeatsPerNation || 2); }
  var SEN_NATIONS = NATIONS.filter(function (n) { return seatsOf(n) > 0; });
  var SEATS_TOTAL = SEN_NATIONS.reduce(function (a, n) { return a + seatsOf(n); }, 0);

  var TIERS = [{ max: 5, name: 'Tilt', t: 0.35 }, { max: 15, name: 'Lean', t: 0.55 }, { max: 30, name: 'Likely', t: 0.78 }, { max: 101, name: 'Safe', t: 1 }];
  function tier(m) { for (var i = 0; i < TIERS.length; i++) if (m < TIERS[i].max) return TIERS[i]; return TIERS[3]; }

  /* ---------- state ---------- */
  var people = [];                 // participants for the mayor/president race: {id,name,color}
  var raceTitle = EL.race.title;
  var weights = {}, defaultWeights = {};
  var pstate = {};                 // nation -> { id: pct }
  var sstate = {};                 // nation -> [partyId|null, ...]
  var tab = 'pres', selP = null, selS = null;

  /* ---------- data ---------- */
  function load() {
    if (demo) {
      var ids = PARTY_IDS;
      people = [{ id: 'a', name: 'Sample Candidate A', color: PARTIES[ids[0]].color }, { id: 'b', name: 'Sample Candidate B', color: PARTIES[ids[1]].color }, { id: 'c', name: 'Sample Candidate C', color: PARTIES[ids[2]].color }];
      NATIONS.forEach(function (n, i) { defaultWeights[n] = 200 + i * 130; });
      return Promise.resolve();
    }
    return Promise.all([
      sb.from('candidates').select('id,name,party').eq('approved', true).then(function (r) { return r.error ? [] : r.data; }, function () { return []; }),
      sb.from('archives').select('id').order('created_at', { ascending: false }).limit(1).then(function (r) { return r.error || !r.data.length ? null : r.data[0].id; }, function () { return null; })
    ]).then(function (res) {
      var live = res[0], aid = res[1];
      var fromArch = aid ? sb.from('archives').select('data').eq('id', aid).maybeSingle().then(function (r) { return r.data ? r.data.data : null; }, function () { return null; }) : Promise.resolve(null);
      return fromArch.then(function (D) {
        if (D && D.president) {
          D.president.results.forEach(function (r) { defaultWeights[r.nation] = (defaultWeights[r.nation] || 0) + Number(r.votes); });
        }
        function colorOf(p) { var P = (D && D.parties && D.parties[p]) || PARTIES[p]; return (P && P.color) || '#6B7688'; }
        if (live.length) people = live.map(function (c) { return { id: c.id, name: c.name, color: colorOf(c.party) }; });
        else if (D && D.president && D.president.candidates.length) { people = D.president.candidates.map(function (c) { return { id: c.id, name: c.name, color: colorOf(c.party) }; }); if (D.race && D.race.title) raceTitle = D.race.title; }
        else people = PARTY_IDS.map(function (p) { return { id: p, name: PARTIES[p].name, color: PARTIES[p].color }; });
      });
    });
  }
  function resetWeights() { NATIONS.forEach(function (n) { weights[n] = defaultWeights[n] || 0; }); var any = NATIONS.some(function (n) { return weights[n] > 0; }); if (!any) NATIONS.forEach(function (n) { weights[n] = 1000; }); }

  /* ---------- nation maths ---------- */
  function sorted(sh) { return Object.keys(sh).sort(function (a, b) { return sh[b] - sh[a]; }); }
  function leadInfo(sh) { var k = sorted(sh); if (!k.length) return null; var m = sh[k[0]] - (k.length > 1 ? sh[k[1]] : 0); return { id: k[0], margin: m, tie: m < 0.05 }; }
  function makeShares(leaderId, margin) {
    var k = people.length, r = (100 - margin) / k, sh = {};
    people.forEach(function (p) { sh[p.id] = r; }); sh[leaderId] = r + margin; return sh;
  }
  function setMargin(sh, m) {
    var k = sorted(sh); if (k.length < 2) return;
    var O = 0; k.slice(2).forEach(function (id) { O += sh[id]; });
    var room = 100 - O; m = Math.max(0, Math.min(room, m));
    sh[k[0]] = (room + m) / 2; sh[k[1]] = (room - m) / 2;
  }
  function setShare(sh, id, v) {
    v = Math.max(0, Math.min(100, v)); var others = Object.keys(sh).filter(function (k) { return k !== id; });
    var rest = 100 - v, sum = 0; others.forEach(function (k) { sum += sh[k]; });
    others.forEach(function (k) { sh[k] = sum > 0 ? sh[k] / sum * rest : rest / others.length; });
    sh[id] = v;
  }

  /* ---------- maps ---------- */
  var pmap, smap;
  function paintP(n) {
    var sh = pstate[n];
    if (!sh) { pmap.paint(n, MK.NO_DATA, ''); return; }
    var l = leadInfo(sh), p = people.filter(function (x) { return x.id === l.id; })[0];
    if (l.tie) { pmap.paint(n, MK.TIED, 'Tossup', true); return; }
    var t = tier(l.margin);
    pmap.paint(n, EL.mix(p.color, t.t), t.name + ' +' + Math.round(l.margin));
  }
  function paintS(n) {
    var a = sstate[n], names = [];
    if (!a || a.every(function (x) { return !x; })) { smap.paint(n, MK.NO_DATA, ''); return; }
    var ps = []; a.forEach(function (x) { if (x && ps.indexOf(x) === -1) ps.push(x); });
    var open = a.some(function (x) { return !x; });
    if (ps.length === 1 && !open) smap.paint(n, PARTIES[ps[0]].color, PARTIES[ps[0]].short || PARTIES[ps[0]].name);
    else if (ps.length >= 2) smap.paint(n, smap.stripe(PARTIES[ps[0]].color, PARTIES[ps[1]].color), (PARTIES[ps[0]].short || PARTIES[ps[0]].name) + ' + ' + (PARTIES[ps[1]].short || PARTIES[ps[1]].name), true);
    else smap.paint(n, EL.mix(PARTIES[ps[0]].color, 0.5), (PARTIES[ps[0]].short || PARTIES[ps[0]].name) + ' +', true);
  }

  /* ---------- president tab ---------- */
  function cycleP(n) {
    var cur = pstate[n], idx = -1;
    if (cur) { var l = leadInfo(cur); idx = people.map(function (p) { return p.id; }).indexOf(l.id); }
    var next = idx + 1;
    if (next >= people.length) { delete pstate[n]; }
    else pstate[n] = makeShares(people[next].id, cur ? Math.max(leadInfo(cur).margin, 10) : 10);
    selP = n; renderP();
  }
  function renderP() {
    NATIONS.forEach(paintP); pmap.select(selP);
    var called = Object.keys(pstate).length;
    $('st-painted').textContent = called + ' of ' + NATIONS.length;
    // totals
    var sums = {}, wsum = 0;
    Object.keys(pstate).forEach(function (n) { var w = weights[n] || 0; wsum += w; Object.keys(pstate[n]).forEach(function (id) { sums[id] = (sums[id] || 0) + w * pstate[n][id] / 100; }); });
    var box = $('totals'); clear(box);
    var order = Object.keys(sums).sort(function (a, b) { return sums[b] - sums[a]; });
    if (!order.length || !wsum) { $('proj').textContent = 'Click nations on the map to start calling them.'; }
    else {
      var top = order[0], sh = sums[top] / wsum, second = order.length > 1 ? sums[order[1]] / wsum : 0;
      var name = people.filter(function (p) { return p.id === top; })[0].name;
      $('proj').textContent = (called < NATIONS.length ? 'With ' + called + ' of ' + NATIONS.length + ' nations called: ' : '') + (sh - second < 0.0005 ? 'too close to call.' : name + ' wins ' + EL.pct(sh) + ' of the vote, about ' + EL.num(Math.round(sums[top])) + ' votes.');
      order.forEach(function (id) {
        var p = people.filter(function (x) { return x.id === id; })[0], s = sums[id] / wsum;
        box.appendChild(h('div', { 'class': 'row' }, h('div', { 'class': 'row-head' }, h('span', null, h('span', { 'class': 'sw', style: 'background:' + p.color }), h('b', { text: p.name })), h('span', { text: EL.num(Math.round(sums[id])) + ' · ' + EL.pct(s) })),
          h('div', { 'class': 'bar' }, h('i', { style: 'width:' + (s * 100).toFixed(1) + '%;background:' + p.color }))));
      });
    }
    renderPanelP();
  }
  function renderPanelP() {
    var panel = $('panel'); clear(panel);
    var n = selP;
    if (!n) { panel.appendChild(h('h2', { text: 'Pick a nation' })); panel.appendChild(h('p', { 'class': 'muted', text: 'Click a nation to call it. Keep clicking to cycle through the candidates, then back to blank. Then drag its margin here.' })); return; }
    panel.appendChild(h('h2', { text: nName(n) }));
    var sh = pstate[n];
    if (!sh) { panel.appendChild(h('p', { 'class': 'muted', text: 'Not called yet. Click the nation to give it to the first candidate.' })); return; }
    var l = leadInfo(sh);
    var p0 = people.filter(function (x) { return x.id === l.id; })[0];
    panel.appendChild(h('p', null, h('span', { 'class': 'sw', style: 'background:' + p0.color }), h('b', { text: l.tie ? 'Tossup' : p0.name + ': ' + tier(l.margin).name + ' by ' + l.margin.toFixed(1) + ' points' })));
    var mr = h('input', { type: 'range', min: 0, max: 60, step: 0.5, value: Math.min(60, l.margin), 'aria-label': 'Winning margin in points' });
    mr.addEventListener('input', function () { setMargin(sh, Number(mr.value)); paintP(n); refreshTotalsOnly(); updateSliders(); });
    panel.appendChild(h('div', { 'class': 'field' }, h('label', { text: 'Margin (lead over second place)' }), mr));
    var sliders = {};
    panel.appendChild(h('p', { 'class': 'muted', style: 'margin:12px 0 4px', text: 'Vote share' }));
    people.forEach(function (p) {
      var r = h('input', { type: 'range', min: 0, max: 100, step: 0.5, value: sh[p.id], 'aria-label': p.name + ' vote share' });
      var out = h('span', { 'class': 'pv', text: sh[p.id].toFixed(1) + '%' });
      sliders[p.id] = { r: r, out: out };
      r.addEventListener('input', function () { setShare(sh, p.id, Number(r.value)); paintP(n); refreshTotalsOnly(); updateSliders(r); });
      panel.appendChild(h('div', { 'class': 'shr' }, h('span', null, h('span', { 'class': 'sw', style: 'background:' + p.color }), p.name), out, r));
    });
    function updateSliders(skip) { Object.keys(sliders).forEach(function (id) { sliders[id].out.textContent = sh[id].toFixed(1) + '%'; if (sliders[id].r !== skip) sliders[id].r.value = sh[id]; }); var ll = leadInfo(sh); if (mr !== document.activeElement) mr.value = Math.min(60, ll.margin); }
    panel.appendChild(h('button', { 'class': 'btn small ghost', type: 'button', text: 'Clear this nation', onclick: function () { delete pstate[n]; renderP(); } }));
  }
  function refreshTotalsOnly() {
    var keepSel = selP; var panelHtml = $('panel');
    // recompute totals without rebuilding the panel (keeps sliders under the finger)
    var sums = {}, wsum = 0;
    Object.keys(pstate).forEach(function (n) { var w = weights[n] || 0; wsum += w; Object.keys(pstate[n]).forEach(function (id) { sums[id] = (sums[id] || 0) + w * pstate[n][id] / 100; }); });
    var box = $('totals'); clear(box);
    var order = Object.keys(sums).sort(function (a, b) { return sums[b] - sums[a]; });
    if (!order.length || !wsum) return;
    var called = Object.keys(pstate).length, top = order[0], sh = sums[top] / wsum, second = order.length > 1 ? sums[order[1]] / wsum : 0;
    var name = people.filter(function (p) { return p.id === top; })[0].name;
    $('proj').textContent = (called < NATIONS.length ? 'With ' + called + ' of ' + NATIONS.length + ' nations called: ' : '') + (sh - second < 0.0005 ? 'too close to call.' : name + ' wins ' + EL.pct(sh) + ' of the vote, about ' + EL.num(Math.round(sums[top])) + ' votes.');
    order.forEach(function (id) {
      var p = people.filter(function (x) { return x.id === id; })[0], s = sums[id] / wsum;
      box.appendChild(h('div', { 'class': 'row' }, h('div', { 'class': 'row-head' }, h('span', null, h('span', { 'class': 'sw', style: 'background:' + p.color }), h('b', { text: p.name })), h('span', { text: EL.num(Math.round(sums[id])) + ' · ' + EL.pct(s) })),
        h('div', { 'class': 'bar' }, h('i', { style: 'width:' + (s * 100).toFixed(1) + '%;background:' + p.color }))));
    });
  }

  /* ---------- senate tab ---------- */
  function cycleS(n) {
    var a = sstate[n], cur = a && a[0] && a.every(function (x) { return x === a[0]; }) ? a[0] : null;
    var idx = cur ? PARTY_IDS.indexOf(cur) : (a && a.some(function (x) { return x; }) ? -1 : -1);
    var next = idx + 1, seats = seatsOf(n);
    if (next >= PARTY_IDS.length) delete sstate[n];
    else { sstate[n] = []; for (var i = 0; i < seats; i++) sstate[n].push(PARTY_IDS[next]); }
    selS = n; renderS();
  }
  function renderS() {
    SEN_NATIONS.forEach(paintS); smap.select(selS);
    var seats = {}, set = 0;
    Object.keys(sstate).forEach(function (n) { sstate[n].forEach(function (p) { if (p) { seats[p] = (seats[p] || 0) + 1; set++; } }); });
    var maj = Math.floor(SEATS_TOTAL / 2) + 1, order = Object.keys(seats).sort(function (a, b) { return seats[b] - seats[a]; });
    var bar = $('seatbar'); clear(bar);
    order.forEach(function (p) { bar.appendChild(h('i', { style: 'width:' + (seats[p] / SEATS_TOTAL * 100) + '%;background:' + PARTIES[p].color, title: PARTIES[p].name + ': ' + seats[p] })); });
    var mj = $('maj'); mj.hidden = false; mj.style.left = ((maj - 0.5) / SEATS_TOTAL * 100) + '%';
    $('sen-sub').textContent = !set ? 'Click nations to fill in seats. ' + maj + ' of ' + SEATS_TOTAL + ' seats make a majority.' :
      (seats[order[0]] >= maj ? PARTIES[order[0]].name + ' would control the Senate with ' + seats[order[0]] + ' of ' + SEATS_TOTAL + ' seats.' : set + ' of ' + SEATS_TOTAL + ' seats filled. ' + PARTIES[order[0]].name + ' leads with ' + seats[order[0]] + '; ' + maj + ' make a majority.');
    var sl = $('seatlist'); clear(sl);
    order.forEach(function (p) { sl.appendChild(h('div', null, h('span', { 'class': 'sw', style: 'background:' + PARTIES[p].color }), h('b', { text: PARTIES[p].name }), ': ' + seats[p] + (seats[p] === 1 ? ' seat' : ' seats'))); });
    $('st-painted').textContent = (tab === 'sen' ? Object.keys(sstate).length + ' of ' + SEN_NATIONS.length : Object.keys(pstate).length + ' of ' + NATIONS.length);
    var panel = $('spanel'); clear(panel);
    var n = selS;
    if (!n) { panel.appendChild(h('h2', { text: 'Pick a nation' })); panel.appendChild(h('p', { 'class': 'muted', text: 'Click a nation to give all its seats to a party. Click again to move to the next party. Then split the seats here.' })); return; }
    panel.appendChild(h('h2', { text: nName(n) }));
    panel.appendChild(h('p', { 'class': 'muted', text: seatsOf(n) + (seatsOf(n) === 1 ? ' seat' : ' seats') }));
    var cur = sstate[n] || [];
    for (var i = 0; i < seatsOf(n); i++) (function (i) {
      var sel = h('select', { 'aria-label': 'Seat ' + (i + 1) });
      sel.appendChild(h('option', { value: '', text: 'Undecided' }));
      PARTY_IDS.forEach(function (p) { sel.appendChild(h('option', { value: p, text: PARTIES[p].name })); });
      sel.value = cur[i] || '';
      sel.addEventListener('change', function () {
        var arr = sstate[n] || []; while (arr.length < seatsOf(n)) arr.push(null);
        arr[i] = sel.value || null; if (arr.every(function (x) { return !x; })) delete sstate[n]; else sstate[n] = arr;
        renderS();
      });
      panel.appendChild(h('div', { 'class': 'field' }, h('label', { text: 'Seat ' + (i + 1) }), sel));
    })(i);
    panel.appendChild(h('button', { 'class': 'btn small ghost', type: 'button', text: 'Clear this nation', onclick: function () { delete sstate[n]; renderS(); } }));
  }

  /* ---------- share link ---------- */
  function encode() { try { return btoa(unescape(encodeURIComponent(JSON.stringify({ p: pstate, s: sstate })))); } catch (e) { return ''; } }
  function decode(str) {
    try {
      var o = JSON.parse(decodeURIComponent(escape(atob(str))));
      var ids = people.map(function (p) { return p.id; });
      Object.keys(o.p || {}).forEach(function (n) { if (NATIONS.indexOf(n) !== -1 && Object.keys(o.p[n]).every(function (k) { return ids.indexOf(k) !== -1; })) { var sh = {}; people.forEach(function (p) { sh[p.id] = Number(o.p[n][p.id]) || 0; }); pstate[n] = sh; } });
      Object.keys(o.s || {}).forEach(function (n) { if (seatsOf(n) > 0 && Array.isArray(o.s[n])) sstate[n] = o.s[n].slice(0, seatsOf(n)).map(function (p) { return PARTIES[p] ? p : null; }); });
    } catch (e) {}
  }

  /* ---------- weights ---------- */
  function renderWeights() {
    var box = $('weights'); clear(box);
    NATIONS.forEach(function (n) {
      var inp = h('input', { type: 'number', min: 0, step: 1, value: Math.round(weights[n]), 'aria-label': nName(n) + ' turnout' });
      inp.addEventListener('input', function () { weights[n] = Math.max(0, Number(inp.value) || 0); refreshTotalsOnly(); });
      box.appendChild(h('label', { 'class': 'wrow' }, h('span', { text: nName(n) }), inp));
    });
  }

  /* ---------- tabs and start ---------- */
  function setTab(t) {
    tab = t; var p = t === 'pres';
    $('pane-pres').hidden = !p; $('pane-sen').hidden = p;
    $('tab-pres').className = p ? 'on' : ''; $('tab-sen').className = p ? '' : 'on';
    $('tab-pres').setAttribute('aria-selected', String(p)); $('tab-sen').setAttribute('aria-selected', String(!p));
    if (p) renderP(); else renderS();
  }
  $('tab-pres').onclick = function () { setTab('pres'); }; $('tab-sen').onclick = function () { setTab('sen'); };
  $('btn-reset').onclick = function () { if (tab === 'pres') { pstate = {}; selP = null; renderP(); } else { sstate = {}; selS = null; renderS(); } };
  $('btn-share').onclick = function () {
    var url = location.href.split('#')[0] + '#' + encode(), m = $('share-msg');
    function ok() { m.textContent = 'Link copied. Anyone who opens it sees your map.'; m.className = 'msg'; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, function () { location.hash = encode(); m.textContent = 'Copy the link from your address bar.'; });
    else { location.hash = encode(); m.textContent = 'Copy the link from your address bar.'; }
  };
  $('w-reset').onclick = function () { resetWeights(); renderWeights(); refreshTotalsOnly(); };

  $('demo-banner').hidden = !demo;
  $('tab-pres').textContent = EL.race.short + ' race';
  load().then(function () {
    resetWeights();
    $('pres-h').textContent = 'Who wins the ' + raceTitle + '?';
    $('pres-hint').textContent = 'Click a nation to cycle through ' + people.length + ' options. Shade shows the margin: Tilt, Lean, Likely, Safe.';
    pmap = MK.create($('map'), { fixed: function (id) { return NATIONS.indexOf(id) === -1; }, onClick: function (id) { cycleP(id); }, tip: function (id) { var sh = pstate[id]; if (!sh) return nName(id) + ': not called'; var l = leadInfo(sh); var p = people.filter(function (x) { return x.id === l.id; })[0]; return nName(id) + ': ' + (l.tie ? 'tossup' : p.name + ' by ' + l.margin.toFixed(1)); } });
    smap = MK.create($('smap'), { fixed: function (id) { return SEN_NATIONS.indexOf(id) === -1; }, onClick: function (id) { cycleS(id); }, tip: function (id) { var a = sstate[id]; return nName(id) + ': ' + (a ? a.map(function (p) { return p ? PARTIES[p].name : 'undecided'; }).join(', ') : 'not called'); } });
    var lg = $('legend'); clear(lg);
    TIERS.forEach(function (t) { lg.appendChild(h('div', null, h('span', { 'class': 'sw', style: 'background:' + EL.mix('#14202E', t.t) }), t.name + (t.max < 100 ? ' (under ' + t.max + ')' : ' (30+)'))); });
    var slg = $('slegend'); clear(slg);
    PARTY_IDS.forEach(function (p) { slg.appendChild(h('div', null, h('span', { 'class': 'sw', style: 'background:' + PARTIES[p].color }), PARTIES[p].name)); });
    renderWeights();
    if (location.hash.length > 2) decode(location.hash.slice(1));
    setTab(Object.keys(sstate).length && !Object.keys(pstate).length ? 'sen' : 'pres');
  }).catch(function (e) { if (window.console) console.error(e); var el = $('load-error'); el.hidden = false; el.textContent = 'Could not load the candidates. Reload to try again.'; });
})();
