(function () {
  'use strict';
  var EL = window.EL, h = EL.h, s = EL.s, clear = EL.clear;
  var CFG = window.ELECTION_CONFIG, MAP = window.MAP_DATA;
  var $ = function (id) { return document.getElementById(id); };

  var SEATS = CFG.senateSeatsPerNation || 2;
  var PARTIES = CFG.parties || { blue: { name: 'Blue Party', color: '#1063DF' }, gold: { name: 'Gold Party', color: '#DDAA22' }, red: { name: 'Red Party', color: '#D32F2F' } };
  var PARTY_IDS = Object.keys(PARTIES);
  var CLAIMABLE = MAP.regions.filter(function (r) { return r.claimable; }).map(function (r) { return r.id; });
  var SEATS_TOTAL = SEATS * CLAIMABLE.length;

  function nationName(id) { return (CFG.nations && CFG.nations[id]) || id; }
  function partyShort(k) { return (PARTIES[k] ? PARTIES[k].name : k).replace(/ Party$/, ''); }
  function withParty(c) {
    if (!PARTIES[c.party]) c.party = PARTY_IDS[0];
    c.color = PARTIES[c.party].color; c.partyName = PARTIES[c.party].name;
    return c;
  }

  /* ---------- data layer ---------- */
  var configured = CFG.supabaseUrl && CFG.supabaseAnonKey &&
    CFG.supabaseUrl.indexOf('PASTE') === -1 && CFG.supabaseAnonKey.indexOf('PASTE') === -1 && window.supabase;
  var sb = configured ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
  var demo = !sb;

  var demoData = (function () {
    var seed = 11;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    var cands = [], votes = [];
    CLAIMABLE.forEach(function (n, i) {
      for (var k = 0; k < 3; k++) {
        var id = 's-' + n + '-' + k;
        cands.push({ id: id, name: 'Sample Senator ' + (k + 1), party: PARTY_IDS[(i + k) % PARTY_IDS.length], nation: n, pitch: 'Sample candidate. Real ones show up once approved.' });
        var count = 4 + Math.floor(rnd() * (k === 0 ? 30 : k === 1 ? 22 : 12));
        for (var j = 0; j < count; j++) votes.push({ mc: 'demo' + id + j, nation: n, cand: id });
      }
    });
    return { cands: cands, votes: votes };
  })();

  function friendly(err) {
    var m = (err && (err.message || err.details)) || '', code = err && err.code;
    if (code === '23505') {
      if (m.indexOf('senate_votes_one_per_user') !== -1) return 'That username has already voted in the senate race.';
      if (m.indexOf('senate_candidates_name_key') !== -1) return 'A senate candidate with that name already exists.';
      if (m.indexOf('senate_candidates_user_key') !== -1) return 'That username has already signed up for the senate.';
      return 'That entry already exists.';
    }
    if (code === '42501') return 'That was blocked. Polls may be closed, or that candidate is not approved in your nation.';
    if (code === '23514') return 'Something in the form is not allowed. Check each field and try again.';
    return 'Something went wrong. Try again in a minute.';
  }

  var api = {
    candidates: function () {
      if (demo) return Promise.resolve(demoData.cands.map(function (c) { return Object.assign({}, c); }));
      return sb.from('senate_candidates').select('id,name,party,nation,pitch,created_at')
        .eq('approved', true).order('created_at', { ascending: true })
        .then(function (r) { if (r.error) throw r.error; return r.data; });
    },
    results: function () {
      if (demo) {
        var map = {};
        demoData.votes.forEach(function (v) { var k = v.nation + '|' + v.cand; map[k] = (map[k] || 0) + 1; });
        return Promise.resolve(Object.keys(map).map(function (k) { var p = k.split('|'); return { nation: p[0], candidate_id: p[1], votes: map[k] }; }));
      }
      return sb.rpc('get_senate_results').then(function (r) { if (r.error) throw r.error; return r.data || []; });
    },
    vote: function (v) {
      if (demo) {
        if (demoData.votes.some(function (x) { return x.mc.toLowerCase() === v.name.toLowerCase(); })) return Promise.reject({ code: '23505', message: 'senate_votes_one_per_user' });
        demoData.votes.push({ mc: v.name, nation: v.nation, cand: v.candidateId });
        return Promise.resolve();
      }
      return sb.from('senate_votes').insert({ mc_username: v.name, nation: v.nation, candidate_id: v.candidateId })
        .then(function (r) { if (r.error) throw r.error; });
    },
    adminVote: function (v) {
      if (demo) {
        demoData.votes.push({ mc: 'admin_test_' + Math.random().toString(36).slice(2, 10), nation: v.nation, cand: v.candidateId });
        return Promise.resolve();
      }
      return sb.rpc('admin_cast_senate_vote', { p_nation: v.nation, p_candidate: v.candidateId })
        .then(function (r) { if (r.error) throw r.error; });
    },
    signup: function (c) {
      if (demo) return Promise.resolve();
      return sb.from('senate_candidates').insert({ name: c.name, mc_username: c.user, nation: c.nation, party: c.party, pitch: c.pitch || null })
        .then(function (r) { if (r.error) throw r.error; });
    }
  };

  /* ---------- state + tallies ---------- */
  var state = { candidates: [], results: [], selected: null, me: null, ballotKey: '', voted: null };
  var isAdmin = false;

  // One senate vote per person: after voting, this browser is locked out. Admins are exempt.
  var LOCK_KEY = 'voted-senate';
  function getLock() { try { return localStorage.getItem(LOCK_KEY); } catch (e) { return null; } }
  function setLock(v) { try { localStorage.setItem(LOCK_KEY, v); } catch (e) { /* private mode: no lock */ } }

  function pollsClosed() {
    if (!CFG.pollsCloseAt) return false;
    var t = Date.parse(CFG.pollsCloseAt);
    return !isNaN(t) && Date.now() > t;
  }

  // One nation: candidates sorted by votes, and who holds the seats.
  function nationResult(n, votesOf) {
    var cs = state.candidates.filter(function (c) { return c.nation === n; }).map(function (c) { return { c: c, votes: votesOf[c.id] || 0 }; });
    cs.sort(function (a, b) { return b.votes - a.votes || (a.c.name < b.c.name ? -1 : 1); });
    var total = cs.reduce(function (a, x) { return a + x.votes; }, 0);
    var winners = [], tied = false;
    if (total > 0) {
      var withVotes = cs.filter(function (x) { return x.votes > 0; }).length;
      var seats = Math.min(SEATS, withVotes);
      if (cs.length > seats && cs[seats - 1].votes === cs[seats].votes && cs[seats].votes > 0) {
        tied = true;                                   // a tie for the last seat: leave it open
        var cutoff = cs[seats - 1].votes;
        winners = cs.filter(function (x) { return x.votes > cutoff; });
      } else winners = cs.slice(0, seats);
    }
    return { cands: cs, total: total, winners: winners, tied: tied };
  }

  function tally() {
    var votesOf = {};
    state.results.forEach(function (r) { votesOf[r.candidate_id] = (votesOf[r.candidate_id] || 0) + Number(r.votes); });
    var byNation = {}, seatsBy = {}, total = 0, reporting = 0, filled = 0;
    PARTY_IDS.forEach(function (k) { seatsBy[k] = 0; });
    CLAIMABLE.forEach(function (n) {
      var res = nationResult(n, votesOf);
      byNation[n] = res; total += res.total;
      if (res.total > 0) reporting++;
      res.winners.forEach(function (w) { seatsBy[w.c.party] += 1; filled++; });
    });
    return { byNation: byNation, seatsBy: seatsBy, total: total, reporting: reporting, filled: filled };
  }

  /* ---------- shading ---------- */
  var BINS = [{ max: 0.4, t: 0.3 }, { max: 0.5, t: 0.45 }, { max: 0.6, t: 0.62 }, { max: 0.7, t: 0.8 }, { max: 2, t: 1 }];
  function strength(share) { for (var i = 0; i < BINS.length; i++) if (share < BINS[i].max) return BINS[i].t; return 1; }
  var NO_VOTES = '#E3E7EE', TIED = '#A9B2C3';
  function stripeId(a, b) {
    var i = PARTY_IDS.indexOf(a), j = PARTY_IDS.indexOf(b);
    return i <= j ? 'stripe-' + a + '-' + b : 'stripe-' + b + '-' + a;
  }

  /* ---------- map ---------- */
  var refs = {};
  var CALLOUTS = { 'island-a': [1010, 373], 'island-b': [1010, 247] };
  var LABEL_DY = { dyonisia: 14 };

  function buildMap() {
    var svg = $('map'); clear(svg);
    svg.setAttribute('viewBox', MAP.viewBox.join(' '));
    var defs = s('defs', null,
      s('pattern', { id: 'hatch', width: 10, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
        s('rect', { width: 10, height: 10, fill: '#D5DAE3' }),
        s('line', { x1: 0, y1: 0, x2: 0, y2: 10, stroke: '#B9C0CE', 'stroke-width': 4 })));
    for (var i = 0; i < PARTY_IDS.length; i++) for (var j = i + 1; j < PARTY_IDS.length; j++) {
      defs.appendChild(s('pattern', { id: stripeId(PARTY_IDS[i], PARTY_IDS[j]), width: 24, height: 24, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
        s('rect', { width: 12, height: 24, fill: EL.mix(PARTIES[PARTY_IDS[i]].color, 0.85) }),
        s('rect', { x: 12, width: 12, height: 24, fill: EL.mix(PARTIES[PARTY_IDS[j]].color, 0.85) })));
    }
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
      if (call) {
        g.appendChild(s('line', { 'class': 'callout-line', x1: r.cx + r.r * 0.9, y1: r.cy, x2: call[0] - 8, y2: call[1] }));
        text.setAttribute('x', call[0]); text.setAttribute('y', call[1] - 2); text.style.textAnchor = 'start';
      } else {
        text.setAttribute('x', r.cx); text.setAttribute('y', r.cy + (LABEL_DY[r.id] || 0));
      }
      g.appendChild(text);
      svg.appendChild(g);
      refs[r.id] = { g: g, path: path, text: text, l1: l1, l2: l2, call: !!call };
      if (claim) {
        g.addEventListener('click', function () { openNation(r.id); });
        g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNation(r.id); } });
        g.addEventListener('pointerenter', function (e) { showTip(r.id, e); });
        g.addEventListener('pointermove', moveTip);
        g.addEventListener('pointerleave', hideTip);
      }
    });
  }

  function setLabel(ref, line1, line2, color, halo) {
    var t = ref.text, cx = t.getAttribute('x');
    t.style.fill = color;
    t.setAttribute('class', 'lbl' + (halo ? ' halo' : ''));
    ref.l1.textContent = line1; ref.l2.textContent = line2 || '';
    ref.l1.setAttribute('x', cx); ref.l1.setAttribute('dy', line2 ? '-0.2em' : '0.35em');
    ref.l2.setAttribute('x', cx); ref.l2.setAttribute('dy', '1.25em');
  }

  function winnerParties(res) {
    var ps = [];
    res.winners.forEach(function (w) { if (ps.indexOf(w.c.party) === -1) ps.push(w.c.party); });
    return ps;
  }

  function paintMap(t) {
    MAP.regions.forEach(function (r) {
      var ref = refs[r.id], label = nationName(r.id);
      if (!r.claimable) { setLabel(ref, label, 'Spawn', '#3C4658', false); return; }
      var res = t.byNation[r.id], fill = NO_VOTES, line2 = 'No votes', striped = false, summary = 'no votes yet';
      if (res.total > 0) {
        if (!res.winners.length) { fill = TIED; line2 = 'Tied'; summary = 'tied'; }
        else {
          var ps = winnerParties(res);
          if (ps.length === 1) {
            var pv = 0; res.cands.forEach(function (x) { if (x.c.party === ps[0]) pv += x.votes; });
            fill = EL.mix(PARTIES[ps[0]].color, strength(pv / res.total));
            line2 = partyShort(ps[0]) + (res.winners.length > 1 ? ' ×' + res.winners.length : '');
          } else {
            striped = true; fill = 'url(#' + stripeId(ps[0], ps[1]) + ')';
            line2 = ps.map(partyShort).join(' + ');
          }
          summary = res.winners.map(function (w) { return w.c.name + ' (' + partyShort(w.c.party) + ')'; }).join(' and ');
        }
      }
      ref.path.setAttribute('fill', fill);
      var color = (striped || ref.call) ? '#14202E' : EL.textOn(fill);
      setLabel(ref, label, line2, color, striped);
      ref.g.setAttribute('aria-label', label + ': ' + summary + '. Press Enter for details.');
      ref.g.classList.toggle('sel', state.selected === r.id);
    });
  }

  var tip = null;
  function showTip(id, e) {
    var res = tally().byNation[id];
    tip = $('tip'); clear(tip);
    tip.appendChild(h('b', { text: nationName(id) }));
    tip.appendChild(document.createTextNode(EL.num(res.total) + (res.total === 1 ? ' vote' : ' votes')));
    res.winners.forEach(function (w) { tip.appendChild(h('div', { text: w.c.name + ' (' + partyShort(w.c.party) + ')' })); });
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
  function openNation(id) { location.href = 'nation.html?n=' + encodeURIComponent(id); }
  function select(id) { state.selected = state.selected === id ? null : id; renderAll(); }

  /* ---------- panels ---------- */
  function barRow(label, color, v, share, seatBadge) {
    return h('div', null,
      h('div', { 'class': 'row-head' },
        h('span', null, h('span', { 'class': 'sw', style: 'background:' + color }), h('b', { text: label }), seatBadge ? h('span', { 'class': 'badge', text: 'Seat' }) : null),
        h('span', { text: EL.num(v) + ' · ' + EL.pct(share) })),
      h('div', { 'class': 'bar' }, h('i', { style: 'width:' + (share * 100).toFixed(1) + '%;background:' + color })));
  }

  function renderPanel(t) {
    var p = $('panel'); clear(p);
    if (state.selected) {
      var res = t.byNation[state.selected];
      p.appendChild(h('h2', { text: nationName(state.selected) }));
      p.appendChild(h('p', { 'class': 'sub', text: EL.num(res.total) + (res.total === 1 ? ' vote' : ' votes') + '. The top ' + SEATS + ' win a seat.' + (res.tied ? ' The last seat is tied.' : '') }));
      if (!res.cands.length) p.appendChild(h('p', { text: 'No senate candidates here yet.' }));
      else {
        var rows = h('div', { 'class': 'rows' });
        res.cands.forEach(function (x) {
          rows.appendChild(barRow(x.c.name + ' (' + partyShort(x.c.party) + ')', x.c.color, x.votes, res.total ? x.votes / res.total : 0, res.winners.indexOf(x) !== -1));
        });
        p.appendChild(rows);
      }
      p.appendChild(h('button', { 'class': 'btn ghost small', type: 'button', style: 'margin-top:16px', text: 'Back to all seats', onclick: function () { select(state.selected); } }));
    } else {
      p.appendChild(h('h2', { text: 'All seats' }));
      p.appendChild(h('p', { 'class': 'sub', text: t.filled + ' of ' + SEATS_TOTAL + ' seats decided. Click a nation on the map for its own page.' }));
      var rs = h('div', { 'class': 'rows' });
      PARTY_IDS.slice().sort(function (a, b) { return t.seatsBy[b] - t.seatsBy[a]; }).forEach(function (k) {
        rs.appendChild(barRow(PARTIES[k].name, PARTIES[k].color, t.seatsBy[k], SEATS_TOTAL ? t.seatsBy[k] / SEATS_TOTAL : 0));
      });
      p.appendChild(rs);
    }
  }

  function renderControl(t) {
    var bar = $('seatbar'); clear(bar);
    PARTY_IDS.forEach(function (k) {
      if (t.seatsBy[k]) bar.appendChild(h('i', { style: 'width:' + (t.seatsBy[k] / SEATS_TOTAL * 100).toFixed(2) + '%;background:' + PARTIES[k].color, title: PARTIES[k].name + ': ' + t.seatsBy[k] + ' seats' }));
    });
    var need = Math.floor(SEATS_TOTAL / 2) + 1;
    var maj = $('maj'); maj.hidden = false; maj.style.left = ((need - 0.5) / SEATS_TOTAL * 100).toFixed(2) + '%';
    $('majlbl').textContent = 'The black line marks the majority: ' + need + ' of ' + SEATS_TOTAL + ' seats.';
    var list = $('seatlist'); clear(list);
    PARTY_IDS.forEach(function (k) {
      list.appendChild(h('div', null, h('span', { 'class': 'sw', style: 'background:' + PARTIES[k].color }), h('b', { text: PARTIES[k].name }), ': ' + t.seatsBy[k] + (t.seatsBy[k] === 1 ? ' seat' : ' seats')));
    });
    var undecided = SEATS_TOTAL - t.filled;
    list.appendChild(h('div', { 'class': 'muted', text: undecided + ' undecided' }));

    var best = null, tie = false;
    PARTY_IDS.forEach(function (k) {
      if (best === null || t.seatsBy[k] > t.seatsBy[best]) { best = k; tie = false; }
      else if (t.seatsBy[k] === t.seatsBy[best]) tie = true;
    });
    var sub = $('control-sub'), head = $('headline');
    if (!t.filled) { sub.textContent = 'No seats decided yet.'; head.textContent = 'No senate votes yet.'; return; }
    if (tie) { head.textContent = 'The Senate is tied at the top.'; sub.textContent = 'More than one party has the same number of seats.'; return; }
    var n = t.seatsBy[best];
    head.textContent = PARTIES[best].name + ' leads with ' + n + ' of ' + SEATS_TOTAL + ' seats.';
    sub.textContent = n >= need ? PARTIES[best].name + ' has a majority.' : PARTIES[best].name + ' is the largest party but short of a majority (' + need + ' needed).';
  }

  function renderHero(t) {
    $('stat-votes').textContent = EL.num(t.total);
    $('stat-nations').textContent = t.reporting + ' of ' + CLAIMABLE.length;
    $('stat-seats').textContent = t.filled + ' of ' + SEATS_TOTAL;
    $('live-text').textContent = pollsClosed() ? 'Final results' : 'Live results';
  }

  function renderLegend() {
    var lg = $('legend'); clear(lg);
    PARTY_IDS.forEach(function (k) {
      lg.appendChild(h('div', null, h('span', { 'class': 'sw', style: 'background:' + PARTIES[k].color }), PARTIES[k].name + ' won every seat'));
    });
    if (PARTY_IDS.length > 1) {
      var a = PARTIES[PARTY_IDS[0]].color, b = PARTIES[PARTY_IDS[1]].color;
      lg.appendChild(h('div', null, h('span', { 'class': 'sw', style: 'background:repeating-linear-gradient(45deg,' + a + ' 0 4px,' + b + ' 4px 8px)' }), 'Seats split between parties'));
    }
    lg.appendChild(h('div', { 'class': 'muted', text: 'Darker = a bigger share of the nation\'s vote' }));
    lg.appendChild(h('div', null, h('span', { 'class': 'sw', style: 'background:' + NO_VOTES }), 'No votes'));
    lg.appendChild(h('div', null, h('span', { 'class': 'sw', style: 'background:' + TIED }), 'Tied'));
    lg.appendChild(h('div', null, h('span', { 'class': 'sw', style: 'background:#D5DAE3' }), 'Spawn island'));
  }

  function renderTable(t) {
    var body = $('table-body'); clear(body);
    CLAIMABLE.forEach(function (n) {
      var res = t.byNation[n], cell = h('td');
      if (!res.total) cell.appendChild(h('span', { 'class': 'muted', text: 'No votes yet' }));
      else if (!res.winners.length) cell.appendChild(document.createTextNode('Tied'));
      else {
        var chips = h('div', { 'class': 'chips' });
        res.winners.forEach(function (w) { chips.appendChild(h('span', { 'class': 'chip' }, h('span', { 'class': 'sw', style: 'background:' + w.c.color }), w.c.name + ' (' + partyShort(w.c.party) + ')')); });
        if (res.tied) chips.appendChild(h('span', { 'class': 'muted', text: 'last seat tied' }));
        cell.appendChild(chips);
      }
      body.appendChild(h('tr', null,
        h('th', { scope: 'row', text: nationName(n), style: 'text-transform:none;letter-spacing:0;font-size:15px;color:inherit;font-weight:600' }),
        cell, h('td', { 'class': 'n', text: EL.num(res.total) })));
    });
  }

  /* ---------- forms: step 1 (who are you) then the ballot ---------- */
  var USER_RE = /^[A-Za-z0-9_. ]{3,32}$/;
  function msg(id, text, isErr) { var m = $(id); m.textContent = text; m.className = 'msg' + (isErr ? ' err' : ''); }

  function renderForms() {
    var closed = pollsClosed();
    $('run-form').hidden = closed; $('run-locked').hidden = !closed;
    [['s-nation', 'Choose your nation'], ['n-nation', 'Choose the nation you are running in']].forEach(function (c) {
      var sel = $(c[0]);
      if (sel.options.length) return;
      sel.appendChild(h('option', { value: '', text: c[1] }));
      CLAIMABLE.forEach(function (n) { sel.appendChild(h('option', { value: n, text: nationName(n) })); });
    });
    var pbox = $('n-parties');
    if (!pbox.firstChild) {
      PARTY_IDS.forEach(function (k) {
        pbox.appendChild(h('label', { 'class': 'choice' },
          h('input', { type: 'radio', name: 'party', value: k }),
          h('span', { 'class': 'sw', style: 'background:' + PARTIES[k].color }),
          h('span', { text: PARTIES[k].name })));
      });
    }
  }

  function renderGate() {
    var locked = !!getLock() && !isAdmin;
    $('id-form').hidden = locked;
    var box = $('s-locked'); box.hidden = !locked;
    box.textContent = 'You have already voted in the senate race on this device. It is one vote per person. If something went wrong, ask an admin to change your vote.';
    $('s-admin').hidden = !isAdmin;
    $('s-name').closest('.field').hidden = isAdmin;
  }

  function renderBallot() {
    var box = $('ballot');
    if (!state.me) { box.hidden = true; state.ballotKey = ''; return; }
    var n = state.me.nation;
    var cs = state.candidates.filter(function (c) { return c.nation === n; });
    var key = state.me.name + '|' + n + '|' + cs.map(function (c) { return c.id; }).join(',') + '|' + (state.voted || '') + '|' + pollsClosed() + '|' + isAdmin;
    if (key === state.ballotKey) return;           // unchanged: do not wipe the person's pick
    state.ballotKey = key;
    box.hidden = false; clear(box);

    box.appendChild(h('h2', null, h('span', { 'class': 'stepno', 'aria-hidden': 'true', text: '2' }), 'Your ballot: ' + nationName(n)));
    box.appendChild(h('p', { 'class': 'muted', text: 'Voting as ' + state.me.name + '. You get one senate vote. The top ' + SEATS + ' candidates in ' + nationName(n) + ' win a seat.' }));

    if (state.voted) {
      box.appendChild(h('div', { 'class': 'msg', text: 'Vote counted for ' + state.voted + '. Thanks, ' + state.me.name + '!' }));
    } else if (pollsClosed()) {
      box.appendChild(h('div', { 'class': 'locked', text: 'Polls are closed.' }));
    } else if (!cs.length) {
      box.appendChild(h('div', { 'class': 'locked', text: 'No senate candidates in ' + nationName(n) + ' yet. You can run for senate further down this page.' }));
    } else {
      var rows = h('div', { 'class': 'rows' });
      cs.forEach(function (c) {
        rows.appendChild(h('label', { 'class': 'choice' },
          h('input', { type: 'radio', name: 'sen', value: c.id, 'data-name': c.name }),
          h('span', { 'class': 'sw', style: 'background:' + c.color }),
          h('span', null, h('b', { text: c.name }), h('span', { 'class': 'muted', text: '  ' + c.partyName }), c.pitch ? h('span', { 'class': 'hint', style: 'display:block', text: c.pitch }) : null)));
      });
      var vmsg = h('div', { 'class': 'msg', role: 'status' });
      var btn = h('button', { 'class': 'btn', type: 'submit', text: 'Cast my senate vote' });
      var form = h('form', { novalidate: true, style: 'max-width:640px' }, h('fieldset', null, h('legend', { text: 'Pick one candidate' }), rows), btn, vmsg);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var pick = document.querySelector('input[name=sen]:checked');
        if (!pick) { vmsg.textContent = 'Pick a candidate.'; vmsg.className = 'msg err'; return; }
        btn.disabled = true; vmsg.textContent = 'Sending...'; vmsg.className = 'msg';
        var req = isAdmin ? api.adminVote({ nation: n, candidateId: pick.value })
                          : api.vote({ name: state.me.name, nation: n, candidateId: pick.value });
        req.then(function () {
          if (isAdmin) { vmsg.textContent = 'Admin test vote counted. Vote as many times as you like.'; vmsg.className = 'msg'; }
          else { setLock(state.me.name); state.voted = pick.getAttribute('data-name'); renderGate(); }
          return refresh();
        }).catch(function (err) { vmsg.textContent = friendly(err); vmsg.className = 'msg err'; })
          .then(function () { btn.disabled = false; });
      });
      box.appendChild(form);
    }
    box.appendChild(h('button', { 'class': 'btn ghost small change', type: 'button', text: 'Not you? Change name or nation', onclick: function () {
      state.me = null; state.voted = null; renderBallot(); $('s-name').focus();
    } }));
  }

  $('id-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('s-name').value.trim(), nation = $('s-nation').value;
    if (!isAdmin && !USER_RE.test(name)) return msg('s-msg', 'Enter your Minecraft username (3 to 32 letters, numbers, underscores, dots or spaces).', true);
    if (!nation) return msg('s-msg', 'Choose your nation.', true);
    if (!name) name = 'Admin';
    msg('s-msg', '', false);
    state.me = { name: name, nation: nation }; state.voted = null; state.ballotKey = '';
    renderBallot();
    $('ballot').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('run-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if ($('n-hp').value) return;
    var name = $('n-name').value.trim(), user = $('n-user').value.trim(), nation = $('n-nation').value, pitch = $('n-pitch').value.trim();
    var party = document.querySelector('input[name=party]:checked');
    if (name.length < 2) return msg('n-msg', 'Enter a candidate name (at least 2 characters).', true);
    if (!USER_RE.test(user)) return msg('n-msg', 'Enter your Minecraft username (3 to 32 letters, numbers, underscores, dots or spaces).', true);
    if (!nation) return msg('n-msg', 'Choose the nation you are running in.', true);
    if (!party) return msg('n-msg', 'Pick a party.', true);
    var btn = $('n-submit'); btn.disabled = true; msg('n-msg', 'Sending...', false);
    api.signup({ name: name, user: user, nation: nation, party: party.value, pitch: pitch }).then(function () {
      msg('n-msg', demo ? 'Demo mode: nothing was saved.' : 'Submitted! You will appear on the ballot once an admin approves you.', false);
      $('run-form').reset();
    }).catch(function (err) { msg('n-msg', friendly(err), true); })
      .then(function () { btn.disabled = false; });
  });

  /* ---------- render + load ---------- */
  function renderAll() {
    var t = tally();
    renderHero(t); renderControl(t); paintMap(t); renderLegend(); renderPanel(t); renderTable(t); renderForms(); renderGate(); renderBallot();
  }

  var busy = false;
  function showLoadError(text) { var b = $('load-error'); b.textContent = text; b.hidden = !text; }
  function refresh() {
    if (busy) return Promise.resolve();
    busy = true;
    return Promise.all([api.candidates(), api.results()]).then(function (r) {
      state.candidates = r[0].map(withParty); state.results = r[1];
      showLoadError('');
      renderAll();
      $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
    }).catch(function (err) {
      if (window.console) console.error(err);
      var missing = err && (err.code === '42P01' || err.code === 'PGRST205' || /does not exist|Could not find the table/i.test(err.message || ''));
      showLoadError(missing
        ? 'The senate tables are not in the database yet. Open Supabase, go to SQL Editor, and run add-senate-and-red.sql once.'
        : 'Could not load senate results' + (err && err.message ? ' (' + err.message + ')' : '') + '. Check js/config.js and that the database is set up.');
      $('updated').textContent = 'Could not load results. Retrying soon.';
    }).then(function () { busy = false; });
  }
  $('refresh').addEventListener('click', function () { refresh(); });

  $('demo-banner').hidden = !demo;
  buildMap();
  renderAll();
  refresh();
  // Signed in as an admin on admin.html? Then this page lets you vote unlimited times to test.
  if (demo) { isAdmin = location.hash === '#admin'; renderAll(); }
  else EL.checkAdmin(sb).then(function (ok) { isAdmin = ok; renderAll(); });
  setInterval(function () { if (!document.hidden) refresh(); }, Math.max(5, CFG.refreshSeconds || 20) * 1000);
})();
