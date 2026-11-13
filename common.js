/* Small helpers shared by the results page and the admin page. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  // Candidate colours, handed out in order when you approve people.
  var PALETTE = ['#C62828', '#1565C0', '#F2A900', '#2E8B57', '#7B3FC4', '#D6458B', '#00838F', '#6D4C41'];

  function setAttrs(el, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
  }
  function addKids(el, kids) {
    kids.forEach(function (k) {
      if (k === null || k === undefined || k === false) return;
      el.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
    });
  }
  // h('div', {class:'x'}, 'text', childEl) builds HTML. User text is always a text node, never HTML.
  function h(tag, attrs) {
    var el = document.createElement(tag);
    setAttrs(el, attrs);
    addKids(el, Array.prototype.slice.call(arguments, 2));
    return el;
  }
  function s(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    setAttrs(el, attrs);
    addKids(el, Array.prototype.slice.call(arguments, 2));
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function hexToRgb(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) { return Math.round(v).toString(16).padStart(2, '0'); }).join('');
  }
  // t = 1 is the full colour, t = 0 is white.
  function mix(hex, t) {
    var c = hexToRgb(hex);
    return rgbToHex(255 + (c[0] - 255) * t, 255 + (c[1] - 255) * t, 255 + (c[2] - 255) * t);
  }
  function lum(hex) {
    var c = hexToRgb(hex).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  // Picks white or near-black text, whichever reads better on this background.
  function textOn(hex) {
    var L = lum(hex);
    var onWhite = 1.05 / (L + 0.05);
    var onDark = (L + 0.05) / (0.014 + 0.05);
    return onWhite >= onDark ? '#FFFFFF' : '#14202E';
  }

  function pct(x, digits) { return (x * 100).toFixed(digits === undefined ? 1 : digits) + '%'; }
  function num(n) { return Number(n).toLocaleString(); }

  // True only if someone is signed in on admin.html (same browser) and is a listed admin.
  function checkAdmin(sb) {
    if (!sb) return Promise.resolve(false);
    return sb.auth.getSession().then(function (r) {
      if (!r.data || !r.data.session) return false;
      return sb.rpc('am_i_admin').then(function (x) { return x.data === true; });
    }).catch(function () { return false; });
  }

  // Admin-only "how many votes" control: preset chips, a log-scale slider and a typeable box, all kept in sync.
  var PRESETS = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000];
  function bulkPicker(initial) {
    var MAXV = 10000, count = initial || 1;
    function toSlider(n) { return Math.round(Math.log(n) / Math.log(MAXV) * 1000); }
    function fromSlider(v) { return Math.max(1, Math.min(MAXV, Math.round(Math.pow(MAXV, v / 1000)))); }
    var num = h('input', { type: 'number', min: 1, max: MAXV, step: 1, value: count, id: 'bulk-num', 'aria-label': 'Number of votes', style: 'width:110px' });
    var range = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: toSlider(count), 'aria-label': 'Number of votes slider', style: 'width:100%' });
    var chips = h('div', { 'class': 'chips', style: 'margin:8px 0' });
    var note = h('div', { 'class': 'hint' });
    var btns = [];
    function set(n, from) {
      n = Math.round(Number(n)); if (!isFinite(n)) n = 1;
      count = Math.max(1, Math.min(MAXV, n));
      if (from !== 'num') num.value = count;
      if (from !== 'range') range.value = toSlider(count);
      btns.forEach(function (b) { b.el.setAttribute('aria-pressed', b.n === count ? 'true' : 'false'); b.el.className = 'btn small' + (b.n === count ? '' : ' ghost'); });
      note.textContent = count === 1 ? 'Casts 1 test vote.' : 'Casts ' + count.toLocaleString() + ' test votes, all for the candidate you pick.';
    }
    PRESETS.forEach(function (n) {
      var b = h('button', { type: 'button', text: n.toLocaleString(), onclick: function () { set(n); } });
      btns.push({ n: n, el: b }); chips.appendChild(b);
    });
    num.addEventListener('input', function () { if (num.value !== '') set(num.value, 'num'); });
    num.addEventListener('blur', function () { set(num.value || 1); });
    range.addEventListener('input', function () { set(fromSlider(Number(range.value)), 'range'); });
    set(count);
    var el = h('div', { 'class': 'field bulk' },
      h('label', { 'for': 'bulk-num', text: 'How many votes? (1 to 10,000)' }), chips, range,
      h('div', { style: 'margin-top:8px' }, num), note);
    return { el: el, get: function () { set(num.value || count); return count; } };
  }

  // Names of the main race, set in settings.js. Elements with data-race="short|lower|title" get filled in.
  var CFGR = window.ELECTION_CONFIG || {};
  var race = { title: CFGR.raceTitle || 'Leader of the World', short: CFGR.raceShort || 'President', lower: CFGR.raceLower || 'president' };
  function fillRace() {
    var els = document.querySelectorAll('[data-race]');
    for (var i = 0; i < els.length; i++) { var k = els[i].getAttribute('data-race'); if (race[k]) els[i].textContent = race[k]; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fillRace); else fillRace();

  window.EL = { race: race, bulkPicker: bulkPicker, checkAdmin: checkAdmin, h: h, s: s, clear: clear, PALETTE: PALETTE, mix: mix, textOn: textOn, pct: pct, num: num };
})();
