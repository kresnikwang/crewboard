/* ============================================================
   name-search.js — shared Chinese name search helpers
   Supports direct text, full pinyin prefixes, spaced pinyin words,
   and pinyin initials. Loaded before the page modules.
   pinyin-pro (~145 KB gzipped) is loaded on demand: when a search
   field gains focus, or on the first non-empty query. Until it
   arrives, matching falls back to plain text.
   ============================================================ */
(function (root) {
  'use strict';

  var cache = Object.create(null);
  var pinyinApi = root.pinyinPro || null;
  var SEARCH_INPUT = 'input[type="search"], input[id$="-search"], input.ms-search';
  var script = document.currentScript;
  var pinyinSrc = (script && script.getAttribute('data-pinyin-src')) || '/vendor/pinyin-pro/pinyin-pro.min.js';
  var loading = null;

  function ensurePinyin() {
    if (pinyinApi || loading) return;
    loading = document.createElement('script');
    loading.src = pinyinSrc;
    loading.async = true;
    loading.onload = function () {
      pinyinApi = root.pinyinPro || null;
      if (!pinyinApi) return;
      // Indexes built before the library arrived have no pinyin.
      cache = Object.create(null);
      // Re-run the filter the user is typing into.
      var active = document.activeElement;
      if (active && active.matches && active.matches(SEARCH_INPUT) && active.value) {
        active.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
    loading.onerror = function () { loading = null; };
    document.head.appendChild(loading);
  }

  document.addEventListener('focusin', function (event) {
    if (event.target && event.target.matches && event.target.matches(SEARCH_INPUT)) ensurePinyin();
  });

  function decodeEntities(value) {
    return String(value || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'");
  }

  function normalize(value) {
    return decodeEntities(value)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s\u00a0]+/g, ' ')
      .trim();
  }

  function compact(value) {
    return normalize(value).replace(/\s+/g, '');
  }

  function pinyinWords(value) {
    var text = String(value || '').trim();
    if (!text || !pinyinApi || typeof pinyinApi.pinyin !== 'function') return [];
    try {
      return pinyinApi.pinyin(text, {
        toneType: 'none',
        type: 'array',
        surname: 'head',
        nonZh: 'consecutive'
      }).map(normalize).filter(Boolean);
    } catch (err) {
      return [];
    }
  }

  function buildIndex(value) {
    var text = normalize(value);
    if (!text) return { text: '', compact: '', pinyin: '', initials: '', initialWords: '' };
    var words = pinyinWords(text);
    return {
      text: text,
      compact: compact(text),
      pinyin: words.join(''),
      initials: words.map(function (word) { return word.charAt(0); }).join(''),
      initialWords: words.map(function (word) {
        return word.replace(/[^a-z0-9]/g, '').charAt(0);
      }).join('')
    };
  }

  function getIndex(value) {
    var text = normalize(value);
    if (!cache[text]) cache[text] = buildIndex(text);
    return cache[text];
  }

  function isOrderedSubsequence(needle, haystack) {
    if (!needle) return true;
    var at = 0;
    for (var i = 0; i < haystack.length && at < needle.length; i++) {
      if (haystack.charAt(i) === needle.charAt(at)) at++;
    }
    return at === needle.length;
  }

  /**
   * Match one query against one name.
   * - direct text: substring
   * - full pinyin: progressive prefix ("shi", "shik", "shika" -> 世看)
   * - spaced pinyin: each word must be an ordered fragment ("shi k")
   * - initials: ordered subsequence ("sk" -> 世看)
   */
  function matchesName(value, query) {
    var q = normalize(query);
    if (!q) return true;
    ensurePinyin();
    var target = getIndex(value);
    if (!target.text) return false;
    if (target.text.indexOf(q) >= 0) return true;

    var qCompact = q.replace(/\s+/g, '');
    if (!qCompact) return true;
    if (target.compact.indexOf(qCompact) >= 0) return true;
    var py = target.pinyin;
    if (!py) return false;
    if (py.indexOf(qCompact) >= 0) return true;
    if (q.indexOf(' ') >= 0 && isOrderedSubsequence(qCompact, py)) return true;
    return target.initials.indexOf(qCompact) >= 0 ||
      target.initialWords.indexOf(qCompact) >= 0;
  }

  /** Match text across one or more fields, keeping the same pinyin rules. */
  function matchesText(query, values) {
    var q = normalize(query);
    if (!q) return true;
    var list = Array.isArray(values) ? values : [values];
    if (matchesName(list.join(' '), q)) return true;
    return list.some(function (value) { return matchesName(value, q); });
  }

  function pinyinLabel(value) {
    var words = pinyinWords(value);
    return words.length ? words.join(' ') : '';
  }

  root.CrewNameSearch = {
    normalize: normalize,
    compact: compact,
    pinyinWords: pinyinWords,
    buildIndex: buildIndex,
    matchesName: matchesName,
    matchesText: matchesText,
    pinyinLabel: pinyinLabel
  };
})(window);
