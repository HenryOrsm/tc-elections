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

  window.EL = { h: h, s: s, clear: clear, PALETTE: PALETTE, mix: mix, textOn: textOn, pct: pct, num: num };
})();
