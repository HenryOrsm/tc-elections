/* Shared map drawing for the archive and prediction pages. */
(function () {
  'use strict';
  var EL = window.EL, h = EL.h, s = EL.s, clear = EL.clear;
  var MAP = window.MAP_DATA, CFG = window.ELECTION_CONFIG || {};
  var CALLOUTS = { athens: [822, 316] };
  var NO_DATA = '#E3E7EE', TIED = '#A9B2C3';

  function nationName(id) { return (CFG.nations && CFG.nations[id]) || id; }

  // opts: { fixed(id) -> bool, onClick(id), tip(id) -> string|Node|null }
  function create(svg, opts) {
    opts = opts || {};
    clear(svg);
    svg.setAttribute('viewBox', MAP.viewBox.join(' '));
    var defs = s('defs', null,
      s('pattern', { id: 'hatch', width: 10, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
        s('rect', { width: 10, height: 10, fill: '#D5DAE3' }),
        s('line', { x1: 0, y1: 0, x2: 0, y2: 10, stroke: '#B9C0CE', 'stroke-width': 4 })));
    svg.appendChild(defs);
    var wrap = svg.parentNode, tip = h('div', { 'class': 'tip', hidden: 'hidden' });
    wrap.appendChild(tip);
    var refs = {}, stripes = {};

    MAP.regions.forEach(function (r) {
      var fixed = opts.fixed ? opts.fixed(r.id) : !r.claimable;
      var g = s('g', { 'class': 'region' + (fixed ? ' fixed' : ''), 'data-id': r.id });
      if (!fixed) { g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); }
      var path = s('path', { d: r.d, 'fill-rule': 'evenodd', fill: fixed ? 'url(#hatch)' : NO_DATA });
      g.appendChild(path);
      var call = CALLOUTS[r.id];
      var text = s('text', { 'class': 'lbl' });
      var l1 = s('tspan', { 'class': 'l1' }), l2 = s('tspan', { 'class': 'l2' });
      text.appendChild(l1); text.appendChild(l2);
      if (call) {
        g.appendChild(s('line', { 'class': 'callout-line', x1: r.cx + r.r * 0.9, y1: r.cy, x2: call[0] - 8, y2: call[1] }));
        text.setAttribute('x', call[0]); text.setAttribute('y', call[1] - 2); text.style.textAnchor = 'start';
      } else { text.setAttribute('x', r.cx); text.setAttribute('y', r.cy); }
      g.appendChild(text); svg.appendChild(g);
      var ref = refs[r.id] = { g: g, path: path, text: text, l1: l1, l2: l2, call: !!call, fixed: fixed };
      setLabel(ref, nationName(r.id), fixed ? (r.claimable ? 'No senate' : 'Spawn') : '', '#3C4658');
      if (!fixed) {
        if (opts.onClick) {
          g.addEventListener('click', function () { opts.onClick(r.id); });
          g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onClick(r.id); } });
        }
        if (opts.tip) {
          g.addEventListener('pointerenter', function (e) { showTip(r.id, e); });
          g.addEventListener('pointermove', moveTip);
          g.addEventListener('pointerleave', function () { tip.hidden = true; });
        }
      }
    });

    function setLabel(ref, line1, line2, color) {
      var t = ref.text, cx = t.getAttribute('x');
      t.style.fill = color;
      ref.l1.textContent = line1; ref.l2.textContent = line2 || '';
      ref.l1.setAttribute('x', cx); ref.l1.setAttribute('dy', line2 ? '-0.2em' : '0.35em');
      ref.l2.setAttribute('x', cx); ref.l2.setAttribute('dy', '1.25em');
    }
    function showTip(id, e) {
      var c = opts.tip(id); if (!c) return;
      clear(tip); tip.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      tip.hidden = false; moveTip(e);
    }
    function moveTip(e) {
      var b = wrap.getBoundingClientRect(), x = e.clientX - b.left + 14, y = e.clientY - b.top + 14;
      if (x + 230 > b.width) x = e.clientX - b.left - 234;
      tip.style.left = Math.max(4, x) + 'px'; tip.style.top = y + 'px';
    }
    function stripe(colorA, colorB) {
      var id = 'st-' + (colorA + colorB).replace(/[^0-9a-f]/gi, '');
      if (!stripes[id]) {
        defs.appendChild(s('pattern', { id: id, width: 24, height: 24, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
          s('rect', { width: 12, height: 24, fill: EL.mix(colorA, 0.85) }), s('rect', { x: 12, width: 12, height: 24, fill: EL.mix(colorB, 0.85) })));
        stripes[id] = true;
      }
      return 'url(#' + id + ')';
    }
    // paint(id, fill, line2, forceDark): label colour adapts to the fill
    function paint(id, fill, line2, dark) {
      var ref = refs[id]; if (!ref || ref.fixed) return;
      ref.path.setAttribute('fill', fill);
      var color = (dark || ref.call || /^url/.test(fill)) ? '#14202E' : EL.textOn(fill);
      setLabel(ref, nationName(id), line2 || '', color);
    }
    function select(id) { Object.keys(refs).forEach(function (k) { refs[k].g.classList.toggle('sel', k === id); }); }
    return { refs: refs, paint: paint, stripe: stripe, select: select, NO_DATA: NO_DATA, TIED: TIED };
  }

  // Shade strength for a vote share (same bins as the live map).
  var BINS = [{ max: 0.4, t: 0.28, label: 'Under 40%' }, { max: 0.5, t: 0.45, label: '40-50%' }, { max: 0.6, t: 0.62, label: '50-60%' }, { max: 0.7, t: 0.8, label: '60-70%' }, { max: 2, t: 1, label: '70%+' }];
  function strength(share) { for (var i = 0; i < BINS.length; i++) if (share < BINS[i].max) return BINS[i].t; return 1; }

  EL.mapkit = { create: create, strength: strength, BINS: BINS, NO_DATA: NO_DATA, TIED: TIED, nationName: nationName };
})();
