(function () {
  'use strict';
  var EL = window.EL, h = EL.h, s = EL.s, clear = EL.clear;
  var CFG = window.ELECTION_CONFIG, MAP = window.MAP_DATA;
  var $ = function (id) { return document.getElementById(id); };

  var CLAIMABLE = MAP.regions.filter(function (r) { return r.claimable; }).map(function (r) { return r.id; });
  function nationName(id) { return (CFG.nations && CFG.nations[id]) || id; }
  var PARTIES = CFG.parties || {};
  var PARTY_IDS = Object.keys(PARTIES);
  function party(id) { return PARTIES[id] || PARTIES[PARTY_IDS[0]] || { name: 'Party', color: '#888888' }; }
  var SEATS = CFG.senateSeatsPerNation || 2;

  var N = (location.search.match(/[?&]n=([^&]+)/) || [])[1];
  N = N ? decodeURIComponent(N) : '';
  var region = null;
  MAP.regions.forEach(function (r) { if (r.id === N) region = r; });
  var EXC = (CFG.senateExcluded || []).indexOf(N) !== -1;
  var NSEATS = EXC ? 0 : (CFG.senateSeats && CFG.senateSeats[N] !== undefined ? Number(CFG.senateSeats[N]) : SEATS);


  var configured = CFG.supabaseUrl && CFG.supabaseAnonKey &&
    CFG.supabaseUrl.indexOf('PASTE') === -1 && CFG.supabaseAnonKey.indexOf('PASTE') === -1 && window.supabase;
  var sb = configured ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
  var demo = !sb;

  /* ---------- data (every piece is optional, so one missing table never blanks the page) ---------- */
  function demoPres() {
    return {
      cands: [{ id: 'd1', name: 'Candidate A', party: 'blue', home_nation: 'narellan' }, { id: 'd2', name: 'Candidate B', party: 'gold', home_nation: 'seafaria' }, { id: 'd3', name: 'Candidate C', party: 'red', home_nation: N }],
      results: [{ nation: N, candidate_id: 'd1', votes: 31 }, { nation: N, candidate_id: 'd2', votes: 22 }, { nation: N, candidate_id: 'd3', votes: 9 }, { nation: 'maradon', candidate_id: 'd1', votes: 40 }]
    };
  }
  function load() {
    if (demo) {
      var d = demoPres();
      return Promise.resolve({
        cands: d.cands, results: d.results,
        scands: [{ id: 's1', name: 'Sample Senator 1', party: 'blue', nation: N }, { id: 's2', name: 'Sample Senator 2', party: 'gold', nation: N }, { id: 's3', name: 'Sample Senator 3', party: 'red', nation: N }],
        sresults: [{ nation: N, candidate_id: 's1', votes: 20 }, { nation: N, candidate_id: 's2', votes: 14 }, { nation: N, candidate_id: 's3', votes: 14 }],
        info: { nation: N, leader: 'Sample Leader', capital: 'Sample City', blurb: 'This text is edited in the admin panel.' }, failed: []
      });
    }
    var failed = [];
    function safe(name, p) { return p.then(function (r) { if (r.error) { failed.push(name); return null; } return r.data; }, function () { failed.push(name); return null; }); }
    return Promise.all([
      safe('candidates', sb.from('candidates').select('id,name,party,home_nation,pitch').eq('approved', true)),
      safe('results', sb.rpc('get_results')),
      safe('senate candidates', sb.from('senate_candidates').select('id,name,party,nation,pitch').eq('approved', true).eq('nation', N)),
      safe('senate results', sb.rpc('get_senate_results')),
      safe('nation info', sb.from('nation_info').select('*').eq('nation', N).maybeSingle())
    ]).then(function (r) {
      return { cands: r[0] || [], results: r[1] || [], scands: r[2] || [], sresults: r[3] || [], info: r[4], failed: failed };
    });
  }

  /* ---------- small renderers ---------- */
  function barRow(label, color, v, share, badge) {
    return h('div', { 'class': 'row' },
      h('div', { 'class': 'row-head' },
        h('span', null, h('span', { 'class': 'sw', style: 'background:' + color }), h('b', { text: label }), badge ? h('span', { 'class': 'badge', text: badge }) : null),
        h('span', { text: EL.num(v) + ' · ' + EL.pct(share) })),
      h('div', { 'class': 'bar' }, h('i', { style: 'width:' + (share * 100).toFixed(1) + '%;background:' + color })));
  }
  function empty(text) { return h('p', { 'class': 'muted', text: text }); }

  function drawMini(color) {
    var svg = $('mini'); clear(svg);
    if (!region || !region.d) return;
    var path = s('path', { d: region.d, fill: color || '#E3E7EE', stroke: '#14202E', 'stroke-width': 2, 'stroke-linejoin': 'round' });
    svg.appendChild(path);
    var b = path.getBBox(), pad = Math.max(b.width, b.height) * 0.12;
    svg.setAttribute('viewBox', [b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2].join(' '));
  }

  function render(D) {
    var failedBits = D.failed || [];
    if (failedBits.length) {
      var e = $('load-error'); e.hidden = false;
      e.textContent = 'Some parts could not load (' + failedBits.join(', ') + '). If you just updated the site, run the newest SQL file in Supabase.';
    }

    /* president */
    var pc = {}; D.cands.forEach(function (c) { pc[c.id] = c; });
    var by = {}, ptotal = 0, worldTotal = 0;
    D.results.forEach(function (r) {
      var n = Number(r.votes);
      if (!pc[r.candidate_id]) return;
      worldTotal += n;
      if (r.nation !== N) return;
      by[r.candidate_id] = (by[r.candidate_id] || 0) + n; ptotal += n;
    });
    var order = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
    var lead = order.length && by[order[0]] > 0 ? order[0] : null;
    var tie = lead && order.length > 1 && by[order[1]] === by[lead];

    var pres = $('pres'); clear(pres);
    if (!ptotal) pres.appendChild(empty('Nobody from here has voted for ' + EL.race.lower + ' yet.'));
    else {
      var byParty = {}; order.forEach(function (id) { byParty[pc[id].party] = (byParty[pc[id].party] || 0) + by[id]; });
      pres.appendChild(h('h3', { 'class': 'sect', text: 'By party' }));
      var rp = h('div', { 'class': 'rows' });
      Object.keys(byParty).sort(function (a, b) { return byParty[b] - byParty[a]; }).forEach(function (k) {
        rp.appendChild(barRow(party(k).name, party(k).color, byParty[k], byParty[k] / ptotal));
      });
      pres.appendChild(rp);
      pres.appendChild(h('h3', { 'class': 'sect', text: 'By candidate' }));
      var rc = h('div', { 'class': 'rows' });
      order.forEach(function (id) { rc.appendChild(barRow(pc[id].name, party(pc[id].party).color, by[id], by[id] / ptotal)); });
      pres.appendChild(rc);
    }

    /* senate */
    var sv = {}, stotal = 0;
    D.sresults.forEach(function (r) { if (r.nation === N) { sv[r.candidate_id] = (sv[r.candidate_id] || 0) + Number(r.votes); stotal += Number(r.votes); } });
    var sc = D.scands.filter(function (c) { return c.nation === N; }).map(function (c) { return { c: c, v: sv[c.id] || 0 }; });
    sc.sort(function (a, b) { return b.v - a.v || (a.c.name < b.c.name ? -1 : 1); });
    var winners = [], stied = false;
    if (stotal && NSEATS > 0) {
      var withVotes = sc.filter(function (x) { return x.v > 0; }).length, seats = Math.min(NSEATS, withVotes);
      if (sc.length > seats && sc[seats - 1].v === sc[seats].v && sc[seats].v > 0) {
        stied = true; var cut = sc[seats - 1].v; winners = sc.filter(function (x) { return x.v > cut; });
      } else winners = sc.slice(0, seats);
    }
    var sen = $('sen'); clear(sen);
    if (NSEATS === 0) { sen.appendChild(empty('This nation has no senate seats for now.')); sc = []; stotal = 0; }
    else if (!sc.length) sen.appendChild(empty('No senate candidates here yet.'));
    else {
      sen.appendChild(h('p', { 'class': 'muted', text: 'The top ' + NSEATS + ' win a seat.' + (stied ? ' The last seat is tied.' : '') }));
      var rs = h('div', { 'class': 'rows' });
      sc.forEach(function (x) { rs.appendChild(barRow(x.c.name, party(x.c.party).color, x.v, stotal ? x.v / stotal : 0, winners.indexOf(x) !== -1 ? 'Seat' : null)); });
      sen.appendChild(rs);
    }

    /* header */
    $('n-title').textContent = nationName(N);
    document.title = nationName(N) + ' | World Election';
    $('st-pres').textContent = EL.num(ptotal);
    $('st-sen').textContent = EL.num(stotal);
    $('st-share').textContent = worldTotal ? EL.pct(ptotal / worldTotal, 0) : '0%';
    var hl = $('n-headline');
    if (!ptotal) hl.textContent = 'No ' + EL.race.lower + ' votes from this nation yet.';
    else if (tie) hl.textContent = 'Dead heat for ' + EL.race.lower + ' here.';
    else hl.textContent = pc[lead].name + ' (' + party(pc[lead].party).name + ') leads here with ' + EL.pct(by[lead] / ptotal, 0) + '.';
    drawMini(lead && !tie ? EL.mix(party(pc[lead].party).color, 0.8) : null);

    /* info */
    var dl = $('info'); clear(dl);
    var info = D.info || {};
    [['Leader', info.leader], ['Capital', info.capital]].forEach(function (p) {
      if (p[1]) { dl.appendChild(h('dt', { text: p[0] })); dl.appendChild(h('dd', { text: p[1] })); }
    });
    $('blurb').textContent = info.blurb || '';
    $('info-card').hidden = !(info.leader || info.capital || info.blurb);

    /* candidates from here */
    var cb = $('cands'); clear(cb);
    var homeP = D.cands.filter(function (c) { return c.home_nation === N; });
    function card(c, tag) {
      return h('div', { 'class': 'item' }, h('div', { 'class': 'who' },
        h('b', null, h('span', { 'class': 'sw', style: 'background:' + party(c.party).color }), c.name),
        h('span', { text: tag + ' · ' + party(c.party).name }), c.pitch ? h('span', { text: c.pitch }) : null));
    }
    if (!homeP.length && !sc.length) cb.appendChild(empty('Nobody from here is on a ballot yet.'));
    homeP.forEach(function (c) { cb.appendChild(card(c, 'Running for ' + EL.race.short)); });
    sc.forEach(function (x) { cb.appendChild(card(x.c, 'Running for Senate here')); });

    $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
  }

  /* other nations */
  var ob = $('others');
  CLAIMABLE.forEach(function (id) {
    if (id !== N) ob.appendChild(h('a', { 'class': 'chip', href: 'nation.html?n=' + encodeURIComponent(id), text: nationName(id) }));
  });

  function refresh() {
    return load().then(render).catch(function () {
      var e = $('load-error'); e.hidden = false; e.textContent = 'Could not load results. Check your connection and try again.';
    });
  }

  $('demo-banner').hidden = !demo;
  if (!region || !region.claimable) {
    $('n-title').textContent = 'Nation not found';
    $('n-headline').textContent = 'Pick a nation from the list below, or go back to the map.';
    ['info-card', 'pres', 'sen', 'cands'].forEach(function (id) { var el = $(id); if (el) el.closest('section,aside') ? (el.closest('section,aside').hidden = true) : (el.hidden = true); });
    document.querySelector('#mini').closest('aside').hidden = true;
    return;
  }
  refresh();
  setInterval(refresh, Math.max(10, CFG.refreshSeconds || 20) * 1000);
})();
