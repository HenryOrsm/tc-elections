(function () {
  'use strict';
  var EL = window.EL, h = EL.h, s = EL.s, clear = EL.clear;
  var CFG = window.ELECTION_CONFIG, MAP = window.MAP_DATA;
  var $ = function (id) { return document.getElementById(id); };

  var CLAIMABLE = MAP.regions.filter(function (r) { return r.claimable; }).map(function (r) { return r.id; });
  function nationName(id) {
    if (id === 'other') return 'Not from any nation';
    return (CFG.nations && CFG.nations[id]) || id;
  }

  /* ---------- data layer: Supabase, or in-memory demo when no keys are set ---------- */
  var configured = CFG.supabaseUrl && CFG.supabaseAnonKey &&
    CFG.supabaseUrl.indexOf('PASTE') === -1 && CFG.supabaseAnonKey.indexOf('PASTE') === -1 && window.supabase;
  var sb = configured ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
  var demo = !sb;

  var demoData = (function () {
    var cands = [
      { id: 'd1', name: 'Candidate A', party: 'blue', home_nation: 'narellan', pitch: 'Sample candidate. Real ones show up once approved.' },
      { id: 'd2', name: 'Candidate B', party: 'gold', home_nation: 'seafaria', pitch: 'Another sample candidate.' },
      { id: 'd3', name: 'Candidate C', party: 'blue', home_nation: 'eldonia', pitch: 'A third sample candidate.' }
    ];
    var seed = 7;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    var lean = { maradon: [.62, .25, .13], goldleaf: [.3, .48, .22], dyonisia: [.54, .3, .16], seafaria: [.18, .71, .11],
      narellan: [.83, .1, .07], cecilia: [.3, .52, .18], eldonia: [.25, .31, .44], 'island-a': [.58, .22, .2], 'island-b': [.05, .9, .05] };
    var votes = [];
    Object.keys(lean).forEach(function (n) {
      var size = 18 + Math.floor(rnd() * 40);
      for (var i = 0; i < size; i++) {
        var r = rnd(), k = 0, acc = lean[n][0];
        while (r > acc && k < 2) { k++; acc += lean[n][k]; }
        votes.push({ mc: 'demo' + n + i, nation: n, cand: cands[k].id });
      }
    });
    return { cands: cands, votes: votes };
  })();

  function friendly(err) {
    var m = (err && (err.message || err.details)) || '';
    var code = err && err.code;
    if (code === '23505') {
      if (m.indexOf('votes_one_per_user') !== -1) return 'That username has already voted.';
      if (m.indexOf('candidates_name_key') !== -1) return 'A candidate with that name already exists.';
      if (m.indexOf('candidates_user_key') !== -1) return 'That username has already signed up as a candidate.';
      return 'That entry already exists.';
    }
    if (code === '42501') return 'That was blocked. Polls may be closed, or the candidate is not approved yet.';
    if (code === '23514') return 'Something in the form is not allowed. Check each field and try again.';
    return 'Something went wrong. Try again in a minute.';
  }

  var api = {
    candidates: function () {
      if (demo) return Promise.resolve(demoData.cands.slice());
      function q(cols) {
        return sb.from('candidates').select(cols).eq('approved', true).order('created_at', { ascending: true });
      }
      return q('id,name,party,home_nation,pitch,created_at').then(function (r) {
        if (r.error && r.error.code === '42703') {
          // The database has no party column yet: keep working, and tell the admin.
          state.noPartyCol = true;
          return q('id,name,home_nation,pitch,created_at').then(function (r2) { if (r2.error) throw r2.error; return r2.data; });
        }
        if (r.error) throw r.error;
        state.noPartyCol = false;
        return r.data;
      });
    },
    results: function () {
      if (demo) {
        var map = {};
        demoData.votes.forEach(function (v) { var k = v.nation + '|' + v.cand; map[k] = (map[k] || 0) + 1; });
        return Promise.resolve(Object.keys(map).map(function (k) {
          var p = k.split('|'); return { nation: p[0], candidate_id: p[1], votes: map[k] };
        }));
      }
      return sb.rpc('get_results').then(function (r) { if (r.error) throw r.error; return r.data || []; });
    },
    vote: function (v) {
      if (demo) {
        var dup = demoData.votes.some(function (x) { return x.mc.toLowerCase() === v.name.toLowerCase(); });
        if (dup) return Promise.reject({ code: '23505', message: 'votes_one_per_user' });
        demoData.votes.push({ mc: v.name, nation: v.nation, cand: v.candidateId });
        return Promise.resolve();
      }
      return sb.from('votes').insert({ mc_username: v.name, nation: v.nation, candidate_id: v.candidateId })
        .then(function (r) { if (r.error) throw r.error; });
    },
    adminVote: function (v) {
      if (demo) {
        demoData.votes.push({ mc: 'admin_test_' + Math.random().toString(36).slice(2, 10), nation: v.nation, cand: v.candidateId });
        return Promise.resolve();
      }
      return sb.rpc('admin_cast_vote', { p_nation: v.nation, p_candidate: v.candidateId })
        .then(function (r) { if (r.error) throw r.error; });
    },
    signup: function (c) {
      if (demo) return Promise.resolve();
      return sb.from('candidates').insert({ name: c.name, mc_username: c.user, party: c.party, home_nation: c.nation, pitch: c.pitch || null })
        .then(function (r) { if (r.error) throw r.error; });
    }
  };

  /* ---------- state + tallies ---------- */
  var state = { candidates: [], results: [], selected: null, lastCandKey: '', voteNote: '' };
  var isAdmin = false;

  // One vote per person: after voting, this browser is locked out of the form. Admins are exempt.
  var LOCK_KEY = 'voted-president';
  function getLock() { try { return localStorage.getItem(LOCK_KEY); } catch (e) { return null; } }
  function setLock(v) { try { localStorage.setItem(LOCK_KEY, v); } catch (e) { /* private mode: no lock */ } }

  var PARTIES = CFG.parties || { blue: { name: 'Blue Party', color: '#1063DF' }, gold: { name: 'Gold Party', color: '#DDAA22' } };
  var PARTY_IDS = Object.keys(PARTIES);
  // A candidate is shown in their party's colour.
  function withParty(c) {
    var p = PARTIES[c.party] || PARTIES[PARTY_IDS[0]];
    c.color = p.color; c.partyName = p.name;
    return c;
  }

  function pollsClosed() {
    if (!CFG.pollsCloseAt) return false;
    var t = Date.parse(CFG.pollsCloseAt);
    return !isNaN(t) && Date.now() > t;
  }
  function candById(id) { for (var i = 0; i < state.candidates.length; i++) if (state.candidates[i].id === id) return state.candidates[i]; return null; }

  function tally() {
    var byCand = {}, byNation = {}, total = 0;
    state.candidates.forEach(function (c) { byCand[c.id] = 0; });
    CLAIMABLE.forEach(function (n) { byNation[n] = { total: 0, by: {} }; state.candidates.forEach(function (c) { byNation[n].by[c.id] = 0; }); });
    state.results.forEach(function (r) {
      var n = Number(r.votes);
      if (byCand[r.candidate_id] === undefined || !byNation[r.nation]) return;
      byCand[r.candidate_id] += n; total += n;
      byNation[r.nation].total += n; byNation[r.nation].by[r.candidate_id] += n;
    });
    return { byCand: byCand, byNation: byNation, total: total };
  }
  // Returns {id, votes, tie} for the top entry of {candidateId: votes}, or null if nobody has votes.
  function leader(by) {
    var best = null, tie = false;
    Object.keys(by).forEach(function (id) {
      if (best === null || by[id] > by[best]) { best = id; tie = false; }
      else if (by[id] === by[best]) tie = true;
    });
    if (best === null || by[best] === 0) return null;
    return { id: best, votes: by[best], tie: tie };
  }
  function sortedCands(by) {
    return state.candidates.slice().sort(function (a, b) { return (by[b.id] || 0) - (by[a.id] || 0); });
  }
  function shortName(n) { var w = String(n).split(/\s+/)[0]; return w.length > 12 ? w.slice(0, 11) + '.' : w; }

  /* ---------- shading: share of the nation's vote -> how strong the colour is ---------- */
  var BINS = [
    { max: 0.4, t: 0.28, label: 'Under 40%' }, { max: 0.5, t: 0.45, label: '40-50%' }, { max: 0.6, t: 0.62, label: '50-60%' },
    { max: 0.7, t: 0.8, label: '60-70%' }, { max: 2, t: 1, label: '70%+' }
  ];
  function strength(share) { for (var i = 0; i < BINS.length; i++) if (share < BINS[i].max) return BINS[i].t; return 1; }
  var NO_VOTES = '#E3E7EE', TIED = '#A9B2C3';

  /* ---------- map ---------- */
  var refs = {};
  var CALLOUTS = { 'island-a': [1010, 373], 'island-b': [1010, 247] };
  var LABEL_DY = { dyonisia: 14 };

  function buildMap() {
    var svg = $('map');
    clear(svg);
    var vb = MAP.viewBox;
    svg.setAttribute('viewBox', vb.join(' '));
    var defs = s('defs', null,
      s('pattern', { id: 'hatch', width: 10, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
        s('rect', { width: 10, height: 10, fill: '#D5DAE3' }),
        s('line', { x1: 0, y1: 0, x2: 0, y2: 10, stroke: '#B9C0CE', 'stroke-width': 4 })));
    svg.appendChild(defs);
    MAP.regions.forEach(function (r) {
      var claim = r.claimable;
      var g = s('g', { 'class': 'region' + (claim ? '' : ' fixed'), 'data-id': r.id });
      if (claim) { g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); }
      var path = s('path', { d: r.d, 'fill-rule': 'evenodd', fill: claim ? NO_VOTES : 'url(#hatch)' });
      g.appendChild(path);
      var call = CALLOUTS[r.id];
      var text = s('text', { 'class': 'lbl' });
      var l1 = s('tspan', { 'class': 'l1' }), l2 = s('tspan', { 'class': 'l2' });
      text.appendChild(l1); text.appendChild(l2);
      var line = null;
      if (call) {
        line = s('line', { 'class': 'callout-line', x1: r.cx + r.r * 0.9, y1: r.cy, x2: call[0] - 8, y2: call[1] });
        text.setAttribute('x', call[0]); text.setAttribute('y', call[1] - 2);
        text.style.textAnchor = 'start';
      } else {
        text.setAttribute('x', r.cx); text.setAttribute('y', r.cy + (LABEL_DY[r.id] || 0));
      }
      if (line) g.appendChild(line);
      g.appendChild(text);
      svg.appendChild(g);
      refs[r.id] = { g: g, path: path, text: text, l1: l1, l2: l2, call: !!call, region: r };

      if (claim) {
        g.addEventListener('click', function () { select(r.id); });
        g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(r.id); } });
        g.addEventListener('pointerenter', function (e) { showTip(r.id, e); });
        g.addEventListener('pointermove', function (e) { moveTip(e); });
        g.addEventListener('pointerleave', hideTip);
      }
    });
  }

  function setLabel(ref, line1, line2, color, x, y) {
    var t = ref.text;
    t.style.fill = color;
    clear(ref.l1); clear(ref.l2);
    ref.l1.textContent = line1;
    ref.l2.textContent = line2 || '';
    var cx = x === undefined ? t.getAttribute('x') : x;
    ref.l1.setAttribute('x', cx); ref.l1.setAttribute('dy', line2 ? '-0.2em' : '0.35em');
    ref.l2.setAttribute('x', cx); ref.l2.setAttribute('dy', '1.25em');
  }

  function paintMap(t) {
    MAP.regions.forEach(function (r) {
      var ref = refs[r.id];
      var big = r.r >= 60;
      var label = nationName(r.id);
      if (!r.claimable) {
        setLabel(ref, label, 'Spawn', '#3C4658');
        return;
      }
      var data = t.byNation[r.id];
      var lead = leader(data.by);
      var fill = NO_VOTES, share = 0, line2 = 'No votes', cand = null;
      if (lead) {
        share = lead.votes / data.total;
        cand = candById(lead.id);
        if (lead.tie) { fill = TIED; line2 = 'Tied'; }
        else { fill = EL.mix(cand.color, strength(share)); line2 = (big ? shortName(cand.name) + ' ' : '') + EL.pct(share, 0); }
      }
      ref.path.setAttribute('fill', fill);
      var tc = ref.call ? '#14202E' : EL.textOn(fill);
      setLabel(ref, label, big || ref.call || !lead ? line2 : line2, tc);
      ref.g.setAttribute('aria-label', label + ': ' + (lead ? (lead.tie ? 'tied' : cand.name + ' leads with ' + EL.pct(share, 0)) : 'no votes yet') + '. Press Enter for details.');
      ref.g.classList.toggle('sel', state.selected === r.id);
    });
  }

  var tip = null;
  function showTip(id, e) {
    var t = tally(), d = t.byNation[id], lead = leader(d.by);
    tip = $('tip'); clear(tip);
    tip.appendChild(h('b', { text: nationName(id) }));
    tip.appendChild(document.createTextNode(EL.num(d.total) + (d.total === 1 ? ' vote' : ' votes')));
    if (lead && !lead.tie) tip.appendChild(h('div', { text: candById(lead.id).name + ' ' + EL.pct(lead.votes / d.total, 0) }));
    tip.hidden = false; moveTip(e);
  }
  function moveTip(e) {
    if (!tip) return;
    var box = $('map-wrap').getBoundingClientRect();
    var x = e.clientX - box.left + 14, y = e.clientY - box.top + 14;
    if (x > box.width - 230) x = e.clientX - box.left - 230;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { if (tip) tip.hidden = true; }

  function select(id) { state.selected = state.selected === id ? null : id; renderAll(); }

  /* ---------- panels ---------- */
  function barRow(label, color, v, share) {
    return h('div', null,
      h('div', { 'class': 'row-head' },
        h('span', null, h('span', { 'class': 'sw', style: 'background:' + color }), h('b', { text: label })),
        h('span', { text: EL.num(v) + ' · ' + EL.pct(share) })),
      h('div', { 'class': 'bar' }, h('i', { style: 'width:' + (share * 100).toFixed(1) + '%;background:' + color })));
  }
  function bars(by, total) {
    var wrap = h('div', { 'class': 'rows' });
    sortedCands(by).forEach(function (c) {
      var v = by[c.id] || 0;
      wrap.appendChild(barRow(c.name + ' (' + c.partyName + ')', c.color, v, total ? v / total : 0));
    });
    return wrap;
  }
  function partyBars(by, total) {
    var sums = {};
    PARTY_IDS.forEach(function (k) { sums[k] = 0; });
    state.candidates.forEach(function (c) { sums[c.party] = (sums[c.party] || 0) + (by[c.id] || 0); });
    var wrap = h('div', { 'class': 'rows' });
    PARTY_IDS.slice().sort(function (a, b) { return sums[b] - sums[a]; }).forEach(function (k) {
      wrap.appendChild(barRow(PARTIES[k].name, PARTIES[k].color, sums[k], total ? sums[k] / total : 0));
    });
    return wrap;
  }

  function renderPanel(t) {
    var p = $('panel'); clear(p);
    if (!state.candidates.length) {
      p.appendChild(h('h2', { text: 'No candidates yet' }));
      p.appendChild(h('p', { 'class': 'sub', text: 'Results appear once the first candidate is approved.' }));
      return;
    }
    if (state.selected) {
      var d = t.byNation[state.selected];
      p.appendChild(h('h2', { text: nationName(state.selected) }));
      p.appendChild(h('p', { 'class': 'sub', text: EL.num(d.total) + (d.total === 1 ? ' vote' : ' votes') + ' from this nation' }));
      if (d.total) {
        p.appendChild(h('h3', { 'class': 'sect', text: 'By party' })); p.appendChild(partyBars(d.by, d.total));
        p.appendChild(h('h3', { 'class': 'sect', text: 'By candidate' })); p.appendChild(bars(d.by, d.total));
      } else p.appendChild(h('p', { text: 'Nobody from here has voted yet.' }));
      p.appendChild(h('button', { 'class': 'btn ghost small', type: 'button', style: 'margin-top:16px', text: 'Back to world total', onclick: function () { select(state.selected); } }));
    } else {
      p.appendChild(h('h2', { text: 'World total' }));
      p.appendChild(h('p', { 'class': 'sub', text: EL.num(t.total) + ' votes in all. Select a nation on the map for its own breakdown.' }));
      p.appendChild(h('h3', { 'class': 'sect', text: 'By party' })); p.appendChild(partyBars(t.byCand, t.total));
      p.appendChild(h('h3', { 'class': 'sect', text: 'By candidate' })); p.appendChild(bars(t.byCand, t.total));
    }
  }

  function renderCards(t) {
    var box = $('cand-cards'); clear(box);
    if (!state.candidates.length) {
      box.appendChild(h('div', { 'class': 'empty', text: 'No candidates on the ballot yet. Be the first to run below.' }));
      return;
    }
    var lead = leader(t.byCand), closed = pollsClosed();
    sortedCands(t.byCand).forEach(function (c) {
      var v = t.byCand[c.id], share = t.total ? v / t.total : 0;
      var isLead = lead && lead.id === c.id && !lead.tie;
      var title = h('h3', { text: c.name });
      if (isLead) title.appendChild(h('span', { 'class': 'badge', text: closed ? 'Winner' : 'Leading' }));
      box.appendChild(h('article', { 'class': 'cand', style: 'border-top-color:' + c.color },
        h('div', { 'class': 'cand-top' },
          h('div', { 'class': 'avatar', style: 'background:' + c.color + ';color:' + EL.textOn(c.color), 'aria-hidden': 'true', text: c.name.charAt(0).toUpperCase() }),
          h('div', null, title, h('div', { 'class': 'from', text: c.partyName + ' · From ' + nationName(c.home_nation) }))),
        c.pitch ? h('p', { 'class': 'pitch', text: c.pitch }) : null,
        h('div', { 'class': 'cand-nums' }, h('b', { text: EL.pct(share) }), h('span', { 'class': 'muted', text: EL.num(v) + ' votes' })),
        h('div', { 'class': 'bar' }, h('i', { style: 'width:' + (share * 100).toFixed(1) + '%;background:' + c.color }))));
    });
  }

  function renderHero(t) {
    $('site-title').textContent = CFG.siteTitle || 'World Election';
    $('race-title').textContent = CFG.raceTitle || 'Leader of the World';
    document.title = (CFG.siteTitle || 'World Election') + ' | ' + (CFG.raceTitle || 'Results');
    var closed = pollsClosed(), lead = leader(t.byCand), head = $('headline');
    if (!lead) head.textContent = 'No votes yet.';
    else if (lead.tie) head.textContent = 'Too close to call: tied at the top.';
    else head.textContent = candById(lead.id).name + (closed ? ' wins with ' : ' leads with ') + EL.pct(lead.votes / t.total) + ' of the vote.';
    $('stat-votes').textContent = EL.num(t.total);
    var reporting = CLAIMABLE.filter(function (n) { return t.byNation[n].total > 0; }).length;
    $('stat-nations').textContent = reporting + ' of ' + CLAIMABLE.length;
    $('stat-polls').textContent = closed ? 'Closed' : 'Open';
    var sub = $('stat-polls-sub');
    sub.textContent = CFG.pollsCloseAt && !closed ? 'Polls close ' + new Date(CFG.pollsCloseAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Polls';
    $('live-text').textContent = closed ? 'Final results' : 'Live results';
  }

  function renderLegend(t) {
    var lg = $('legend'); clear(lg);
    var lead = leader(t.byCand);
    var base = lead && !lead.tie ? candById(lead.id).color : '#12396B';
    var steps = h('div', { 'class': 'steps', role: 'img', 'aria-label': 'Shades from light to dark mean a larger vote share' });
    BINS.forEach(function (b) { steps.appendChild(h('span', { style: 'background:' + EL.mix(base, b.t), title: b.label })); });
    lg.appendChild(h('div', null, h('div', { 'class': 'labels', text: 'Darker = bigger share of that nation\'s vote (under 40% up to 70%+)' }), steps));
    lg.appendChild(h('div', null, h('span', { 'class': 'sw', style: 'background:' + NO_VOTES }), 'No votes'));
    lg.appendChild(h('div', null, h('span', { 'class': 'sw', style: 'background:' + TIED }), 'Tied'));
    lg.appendChild(h('div', null, h('span', { 'class': 'sw', style: 'background:#D5DAE3' }), 'Spawn island (no votes)'));
  }

  function renderTable(t) {
    var body = $('table-body'); clear(body);
    CLAIMABLE.forEach(function (n) {
      var d = t.byNation[n], lead = leader(d.by), cell;
      if (!lead) cell = h('td', { 'class': 'muted', text: 'No votes yet' });
      else if (lead.tie) cell = h('td', { text: 'Tied' });
      else { var c = candById(lead.id); cell = h('td', null, h('span', { 'class': 'sw', style: 'background:' + c.color }), c.name); }
      body.appendChild(h('tr', null,
        h('th', { scope: 'row', text: nationName(n), style: 'text-transform:none;letter-spacing:0;font-size:15px;color:inherit;font-weight:600' }),
        h('td', { 'class': 'n', text: EL.num(d.total) }), cell,
        h('td', { 'class': 'n', text: lead && !lead.tie ? EL.pct(lead.votes / d.total) : '' })));
    });
  }

  function renderGate() {
    var closed = pollsClosed(), locked = !!getLock();
    var blocked = !isAdmin && (closed || locked);
    $('vote-form').hidden = blocked;
    var box = $('vote-locked'); box.hidden = !blocked;
    box.textContent = closed ? 'Polls are closed. Thanks for voting.'
      : (state.voteNote || 'You have already voted in the presidential election on this device. It is one vote per person. If something went wrong, ask an admin to change your vote.');
    $('admin-note').hidden = !isAdmin;
    $('v-name').closest('.field').hidden = isAdmin;
  }

  function renderForms() {
    var closed = pollsClosed();
    $('run-form').hidden = closed; $('run-locked').hidden = !closed;
    renderGate();

    // nation selects (keep what the person already picked)
    [['v-nation', 'Choose your nation', false], ['r-nation', 'Choose your home nation', true]].forEach(function (cfg) {
      var sel = $(cfg[0]);
      if (sel.options.length) return;
      sel.appendChild(h('option', { value: '', text: cfg[1] }));
      CLAIMABLE.forEach(function (n) { sel.appendChild(h('option', { value: n, text: nationName(n) })); });
      if (cfg[2]) sel.appendChild(h('option', { value: 'other', text: 'Not from any nation' }));
    });

    // party radios for the sign-up form (built once)
    var pbox = $('r-parties');
    if (!pbox.firstChild) {
      PARTY_IDS.forEach(function (k) {
        pbox.appendChild(h('label', { 'class': 'choice' },
          h('input', { type: 'radio', name: 'party', value: k }),
          h('span', { 'class': 'sw', style: 'background:' + PARTIES[k].color }),
          h('span', { text: PARTIES[k].name })));
      });
    }

    // candidate radios (only rebuilt when the ballot changes, so a selection is not lost on refresh)
    var key = state.candidates.map(function (c) { return c.id; }).join(',');
    if (key !== state.lastCandKey) {
      state.lastCandKey = key;
      var box = $('v-cands');
      var prev = document.querySelector('input[name=cand]:checked');
      var prevId = prev ? prev.value : null;
      clear(box);
      if (!state.candidates.length) box.appendChild(h('p', { 'class': 'muted', text: 'No candidates on the ballot yet.' }));
      state.candidates.forEach(function (c) {
        box.appendChild(h('label', { 'class': 'choice' },
          h('input', { type: 'radio', name: 'cand', value: c.id, checked: prevId === c.id }),
          h('span', { 'class': 'sw', style: 'background:' + c.color }),
          h('span', null, c.name, h('span', { 'class': 'muted', text: '  (' + c.partyName + ', ' + nationName(c.home_nation) + ')' }))));
      });
    }
  }

  function renderAll() {
    var t = tally();
    renderHero(t); renderCards(t); paintMap(t); renderLegend(t); renderPanel(t); renderTable(t); renderForms();
  }

  /* ---------- loading ---------- */
  var busy = false;
  function showLoadError(text) {
    var b = $('load-error');
    b.textContent = text; b.hidden = !text;
  }
  function refresh() {
    if (busy) return Promise.resolve();
    busy = true;
    return Promise.all([api.candidates(), api.results()]).then(function (r) {
      state.candidates = r[0].map(withParty); state.results = r[1];
      renderAll();
      showLoadError(state.noPartyCol ? 'The database is missing the party column. Open Supabase, go to SQL Editor, and run supabase/add-parties.sql once. Until then everyone shows as Blue Party and sign-ups will fail.' : '');
      $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
    }).catch(function (err) {
      if (window.console) console.error(err);
      var why = err && (err.message || err.details) ? ' (' + (err.message || err.details) + ')' : '';
      showLoadError('Could not load results from the database' + why + '. Check the URL and key in js/config.js, and that setup.sql was run.');
      $('updated').textContent = 'Could not load results. Retrying soon.';
    }).then(function () { busy = false; });
  }

  /* ---------- forms ---------- */
  var USER_RE = /^[A-Za-z0-9_. ]{3,32}$/;
  function msg(id, text, isErr) { var m = $(id); m.textContent = text; m.className = 'msg' + (isErr ? ' err' : ''); }

  $('vote-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if ($('v-hp').value) return;
    var name = $('v-name').value.trim(), nation = $('v-nation').value;
    var pick = document.querySelector('input[name=cand]:checked');
    if (!isAdmin && !USER_RE.test(name)) return msg('v-msg', 'Enter your Minecraft username (3 to 32 letters, numbers, underscores, dots or spaces).', true);
    if (!nation) return msg('v-msg', 'Choose your nation.', true);
    if (!pick) return msg('v-msg', 'Pick a candidate.', true);
    var btn = $('v-submit'); btn.disabled = true; msg('v-msg', 'Sending...', false);
    var req = isAdmin ? api.adminVote({ nation: nation, candidateId: pick.value })
                      : api.vote({ name: name, nation: nation, candidateId: pick.value });
    req.then(function () {
      if (isAdmin) {
        msg('v-msg', 'Admin test vote counted. Vote as many times as you like.', false);
      } else {
        setLock(name);
        state.voteNote = 'Vote counted. Thanks, ' + name + '! It is one vote per person, so voting is now locked on this device. If something went wrong, ask an admin to change your vote.';
        renderGate();
      }
      $('v-name').value = '';
      return refresh();
    }).catch(function (err) { msg('v-msg', friendly(err), true); })
      .then(function () { btn.disabled = false; });
  });

  $('run-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if ($('r-hp').value) return;
    var name = $('r-name').value.trim(), user = $('r-user').value.trim(), nation = $('r-nation').value, pitch = $('r-pitch').value.trim();
    if (name.length < 2) return msg('r-msg', 'Enter a candidate name (at least 2 characters).', true);
    if (!USER_RE.test(user)) return msg('r-msg', 'Enter your Minecraft username (3 to 32 letters, numbers, underscores, dots or spaces).', true);
    if (!nation) return msg('r-msg', 'Choose your home nation.', true);
    var partyPick = document.querySelector('input[name=party]:checked');
    if (!partyPick) return msg('r-msg', 'Pick a party.', true);
    var btn = $('r-submit'); btn.disabled = true; msg('r-msg', 'Sending...', false);
    api.signup({ name: name, user: user, nation: nation, party: partyPick.value, pitch: pitch }).then(function () {
      msg('r-msg', demo ? 'Demo mode: nothing was saved.' : 'Submitted! You will appear on the ballot once an admin approves you.', false);
      $('run-form').reset();
    }).catch(function (err) { msg('r-msg', friendly(err), true); })
      .then(function () { btn.disabled = false; });
  });

  $('refresh').addEventListener('click', function () { refresh(); });

  /* ---------- go ---------- */
  $('demo-banner').hidden = !demo;
  buildMap();
  renderAll();   // draw the map, dropdowns and party picker right away, before any data arrives
  refresh();
  // Signed in as an admin on admin.html? Then this page lets you vote unlimited times to test.
  if (demo) { isAdmin = location.hash === '#admin'; renderAll(); }
  else EL.checkAdmin(sb).then(function (ok) { isAdmin = ok; renderAll(); });
  setInterval(function () { if (!document.hidden) refresh(); }, Math.max(5, CFG.refreshSeconds || 20) * 1000);
})();
