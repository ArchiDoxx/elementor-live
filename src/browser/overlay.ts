import type { Page } from 'playwright-core';
import type { AgentMood, Box, HudState, UserEvent } from '../types.js';

export const OVERLAY_SCRIPT: string = String.raw`(() => {
  if (window.top !== window) return;
  if (window.__elive) return;

  var MAX_EVENTS = 500;
  var SEQ_KEY = '__elive_seq';

  function getEl() { try { return window.elementor || null; } catch (e) { return null; } }
  function getDoc() { try { var el = getEl(); return el && el.documents && el.documents.getCurrent ? el.documents.getCurrent() : null; } catch (e) { return null; } }
  function getIframe() { try { return document.getElementById('elementor-preview-iframe'); } catch (e) { return null; } }
  function getPreviewDoc() { try { var f = getIframe(); return f ? f.contentDocument : null; } catch (e) { return null; } }
  function isReady() { return !!(getEl() && getDoc() && getIframe() && document.body); }

  function activate() {
    if (window.__elive) return;

    var seq = 0;
    try { seq = parseInt(sessionStorage.getItem(SEQ_KEY) || '0', 10) || 0; } catch (e) { seq = 0; }
    var list = [];
    var quietUntil = 0;
    var agentDepth = 0;
    function isQuiet() { return agentDepth > 0 || Date.now() < quietUntil; }

    var events = {
      get seq() { return seq; },
      push: function (ev) {
        seq += 1;
        var out = { seq: seq, ts: Date.now(), type: ev.type };
        if (ev.ids) out.ids = ev.ids.slice();
        if (ev.title !== undefined) out.title = ev.title;
        if (ev.text !== undefined) out.text = ev.text;
        list.push(out);
        if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
        try { sessionStorage.setItem(SEQ_KEY, String(seq)); } catch (e) {}
        return out;
      },
      pull: function (since) {
        var s = Number(since) || 0;
        return list.filter(function (e) { return e.seq > s; }).map(function (e) { return Object.assign({}, e, e.ids ? { ids: e.ids.slice() } : {}); });
      }
    };

    var css = [
      '.elive-root{position:fixed;inset:0;pointer-events:none;z-index:2147483000;font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e8e8ef}',
      '.elive-root *{box-sizing:border-box}',
      '.elive-root{--elive-accent:#9aa0a6}',
      '.elive-mood-neutral{--elive-accent:#9aa0a6}',
      '.elive-mood-happy{--elive-accent:#34c759}',
      '.elive-mood-thinking{--elive-accent:#4c8dff}',
      '.elive-mood-warning{--elive-accent:#ffb020}',
      '.elive-mood-sassy{--elive-accent:#ff3ea5}',
      '.elive-cursor{position:fixed;left:0;top:0;width:22px;height:22px;opacity:0;transition:left 350ms cubic-bezier(.2,.8,.2,1),top 350ms cubic-bezier(.2,.8,.2,1),opacity 400ms ease;pointer-events:none}',
      '.elive-cursor.elive-show{opacity:1}',
      '.elive-cursor svg{display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))}',
      '.elive-tag{position:absolute;left:18px;top:18px;background:var(--elive-accent);color:#111;font-weight:600;font-size:11px;padding:1px 7px;border-radius:9px;white-space:nowrap}',
      '.elive-glow{position:fixed;left:0;top:0;width:0;height:0;border:2px solid var(--elive-accent);border-radius:4px;box-shadow:0 0 0 3px rgba(255,255,255,.08),0 0 18px 2px var(--elive-accent);opacity:0;transition:left 350ms cubic-bezier(.2,.8,.2,1),top 350ms cubic-bezier(.2,.8,.2,1),width 350ms cubic-bezier(.2,.8,.2,1),height 350ms cubic-bezier(.2,.8,.2,1),opacity 400ms ease;pointer-events:none}',
      '.elive-glow.elive-show{opacity:.9}',
      '.elive-bubble{position:absolute;left:24px;top:40px;width:max-content;max-width:280px;background:#1d1e24;border:1px solid rgba(255,255,255,.08);border-left:3px solid var(--elive-accent);border-radius:10px;padding:8px 11px;box-shadow:0 8px 24px rgba(0,0,0,.4);opacity:0;transform:translateY(4px);transition:opacity 200ms ease,transform 200ms ease;white-space:pre-wrap;word-break:break-word}',
      '.elive-bubble.elive-show{opacity:1;transform:none}',
      '.elive-cursor.elive-flip .elive-bubble{left:auto;right:4px}',
      '.elive-hud{position:fixed;top:56px;right:16px;display:none;align-items:center;gap:8px;max-width:300px;background:rgba(24,25,31,.92);border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:4px 12px;box-shadow:0 4px 14px rgba(0,0,0,.35);pointer-events:none}',
      '.elive-hud.elive-show{display:flex}',
      '.elive-hud-score{font-weight:700;font-size:14px;color:#fff}',
      '.elive-hud-delta{font-weight:700;font-size:12px;opacity:0}',
      '.elive-hud-delta.elive-up{color:#34c759}',
      '.elive-hud-delta.elive-down{color:#ff5a5f}',
      '.elive-hud-delta.elive-flash{animation:elive-flash 1.8s ease}',
      '.elive-hud-note{font-size:12px;color:#b9bac4;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '@keyframes elive-flash{0%{opacity:0;transform:translateY(4px)}15%{opacity:1;transform:none}75%{opacity:1}100%{opacity:0}}',
      '.elive-prompt{position:fixed;left:50%;top:30%;transform:translate(-50%,-50%);width:320px;background:#1b1c22;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px;box-shadow:0 18px 48px rgba(0,0,0,.55);display:none;pointer-events:auto}',
      '.elive-prompt.elive-show{display:block}',
      '.elive-prompt-head{display:flex;justify-content:space-between;font-size:11px;color:#9a9bab;margin:0 2px 6px}',
      '.elive-prompt textarea{width:100%;min-height:64px;max-height:180px;resize:vertical;background:#111216;color:#f2f2f6;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px;font-family:inherit;font-size:13px;line-height:1.4;outline:none}',
      '.elive-prompt textarea:focus{border-color:#4c8dff}',
      '.elive-prompt-foot{font-size:11px;color:#7d7e8c;margin:6px 2px 0}',
      '.elive-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1d1e24;border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:6px 14px;font-size:12px;opacity:0;transition:opacity 200ms ease;pointer-events:none;max-width:300px}',
      '.elive-toast.elive-show{opacity:1}',
      '.elive-root.elive-capturing .elive-cursor,.elive-root.elive-capturing .elive-glow,.elive-root.elive-capturing .elive-toast{visibility:hidden!important;transition:none!important}'
    ].join('\n');

    var style = document.createElement('style');
    style.setAttribute('data-elive', '');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);

    var root = document.createElement('div');
    root.className = 'elive-root elive-mood-neutral';
    root.setAttribute('data-elive', '');
    root.innerHTML =
      '<div class="elive-glow"></div>' +
      '<div class="elive-cursor"><svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.6 20.5 L13.4 19.2 L10.3 12.6 L16.5 12.4 Z" fill="var(--elive-accent)" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg><span class="elive-tag">Agent</span><div class="elive-bubble"></div></div>' +
      '<div class="elive-hud"><span class="elive-hud-score"></span><span class="elive-hud-delta"></span><span class="elive-hud-note"></span></div>' +
      '<div class="elive-prompt"><div class="elive-prompt-head"><span>Tell the agent</span><span class="elive-prompt-sel"></span></div><textarea placeholder="Tell the agent…" rows="3"></textarea><div class="elive-prompt-foot">Enter to send · Shift+Enter for newline · Esc to close</div></div>' +
      '<div class="elive-toast"></div>';
    document.body.appendChild(root);

    var cursorEl = root.querySelector('.elive-cursor');
    var glowEl = root.querySelector('.elive-glow');
    var bubbleEl = root.querySelector('.elive-bubble');
    var hudEl = root.querySelector('.elive-hud');
    var hudScore = root.querySelector('.elive-hud-score');
    var hudDelta = root.querySelector('.elive-hud-delta');
    var hudNote = root.querySelector('.elive-hud-note');
    var promptEl = root.querySelector('.elive-prompt');
    var promptSel = root.querySelector('.elive-prompt-sel');
    var textarea = root.querySelector('.elive-prompt textarea');
    var toastEl = root.querySelector('.elive-toast');

    function setMood(mood) {
      var m = ['neutral', 'happy', 'thinking', 'warning', 'sassy'].indexOf(mood) >= 0 ? mood : 'neutral';
      root.className = root.className.replace(/elive-mood-\w+/, 'elive-mood-' + m);
    }

    function iframeRect() {
      var f = getIframe();
      if (!f) return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      var r = f.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }

    function findNode(id) {
      var pdoc = getPreviewDoc();
      if (!pdoc || !id) return null;
      try { return pdoc.querySelector('[data-id="' + String(id).replace(/["\\]/g, '\\$&') + '"][data-element_type]'); } catch (e) { return null; }
    }

    function nodeRect(node) {
      var win = node.ownerDocument.defaultView;
      var cs = win.getComputedStyle(node);
      if (cs.display !== 'contents') return node.getBoundingClientRect();
      var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      var kids = node.children;
      for (var i = 0; i < kids.length; i++) {
        var kr = nodeRect(kids[i]);
        if (kr.width === 0 && kr.height === 0) continue;
        l = Math.min(l, kr.left); t = Math.min(t, kr.top); r = Math.max(r, kr.right); b = Math.max(b, kr.bottom);
      }
      if (l === Infinity) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
      return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t };
    }

    var idleTimer = null;
    var lastTargetId = null;
    var cursorVisible = false;

    function touch() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(function () {
        cursorEl.classList.remove('elive-show');
        glowEl.classList.remove('elive-show');
        bubbleEl.classList.remove('elive-show');
        cursorVisible = false;
        lastTargetId = null;
      }, 8000);
    }

    function placeCursor(x, y) {
      cursorEl.style.left = Math.round(x) + 'px';
      cursorEl.style.top = Math.round(y) + 'px';
      if (x > window.innerWidth - 320) cursorEl.classList.add('elive-flip'); else cursorEl.classList.remove('elive-flip');
      cursorEl.classList.add('elive-show');
      cursorVisible = true;
    }

    function moveTo(box, passive) {
      if (!box) return false;
      var fr = iframeRect();
      var left = fr.left + box.x, top = fr.top + box.y;
      var right = left + box.width, bottom = top + box.height;
      var cl = Math.max(fr.left, Math.min(left, fr.left + fr.width));
      var ct = Math.max(fr.top, Math.min(top, fr.top + fr.height));
      var cr = Math.max(fr.left, Math.min(right, fr.left + fr.width));
      var cb = Math.max(fr.top, Math.min(bottom, fr.top + fr.height));
      glowEl.style.left = (cl - 3) + 'px';
      glowEl.style.top = (ct - 3) + 'px';
      glowEl.style.width = Math.max(0, cr - cl + 6) + 'px';
      glowEl.style.height = Math.max(0, cb - ct + 6) + 'px';
      if (cr - cl > 0 && cb - ct > 0) glowEl.classList.add('elive-show'); else glowEl.classList.remove('elive-show');
      var px = cl + Math.min((cr - cl) * 0.5, 40);
      var py = ct + Math.min((cb - ct) * 0.5, 24);
      placeCursor(px, py);
      if (!passive) touch();
      return true;
    }

    function moveToId(id, opts) {
      var node = findNode(id);
      if (!node) return false;
      if (opts && opts.scroll) {
        try {
          var r0 = nodeRect(node);
          var vh = node.ownerDocument.defaultView.innerHeight;
          if (r0.top < 0 || r0.bottom > vh) {
            var target = node;
            if (node.ownerDocument.defaultView.getComputedStyle(node).display === 'contents' && node.firstElementChild) target = node.firstElementChild;
            target.scrollIntoView({ block: r0.height > vh ? 'start' : 'center', inline: 'nearest' });
          }
        } catch (e) {}
      }
      var r = nodeRect(node);
      lastTargetId = String(id);
      return moveTo({ x: r.left, y: r.top, width: r.width, height: r.height });
    }

    function hideCursor() {
      cursorEl.classList.remove('elive-show');
      glowEl.classList.remove('elive-show');
      bubbleEl.classList.remove('elive-show');
      cursorVisible = false;
      lastTargetId = null;
    }

    function parkCursor() {
      var fr = iframeRect();
      lastTargetId = null;
      glowEl.classList.remove('elive-show');
      placeCursor(fr.left + Math.min(fr.width / 2, 120), fr.top + 60);
      touch();
    }

    var bubbleTimer = null;
    function say(message, id, mood) {
      setMood(mood || 'neutral');
      var moved = id ? moveToId(id, { scroll: false }) : false;
      if (!moved && !cursorVisible) parkCursor();
      bubbleEl.textContent = String(message == null ? '' : message);
      bubbleEl.classList.add('elive-show');
      touch();
      if (bubbleTimer) clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(function () { bubbleEl.classList.remove('elive-show'); }, 6000);
      events.push({ type: 'agent', text: String(message == null ? '' : message), ids: id ? [String(id)] : undefined });
      return true;
    }

    var hudState = {};
    var deltaTimer = null;
    function hudSet(state) {
      state = state || {};
      if (typeof state.score === 'number') hudState.score = state.score;
      if (typeof state.note === 'string') hudState.note = state.note;
      hudScore.textContent = typeof hudState.score === 'number' ? String(Math.round(hudState.score * 10) / 10) : '';
      hudNote.textContent = hudState.note || '';
      if (typeof state.delta === 'number' && state.delta !== 0) {
        hudDelta.textContent = (state.delta > 0 ? '+' : '') + String(Math.round(state.delta * 10) / 10);
        hudDelta.classList.remove('elive-up', 'elive-down', 'elive-flash');
        void hudDelta.offsetWidth;
        hudDelta.classList.add(state.delta > 0 ? 'elive-up' : 'elive-down', 'elive-flash');
        if (deltaTimer) clearTimeout(deltaTimer);
        deltaTimer = setTimeout(function () { hudDelta.classList.remove('elive-flash'); }, 1900);
      }
      hudEl.classList.add('elive-show');
      return true;
    }

    var toastTimer = null;
    function toast(text) {
      toastEl.textContent = text;
      toastEl.classList.add('elive-show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.classList.remove('elive-show'); }, 1600);
    }

    function currentSelection() {
      try {
        var el = getEl();
        if (!el || !el.selection || typeof el.selection.getElements !== 'function') return [];
        return (el.selection.getElements() || []).map(function (c) { return String(c.id); });
      } catch (e) { return []; }
    }

    function openPrompt() {
      var sel = currentSelection();
      promptSel.textContent = sel.length ? (sel.length === 1 ? '1 element selected' : sel.length + ' elements selected') : '';
      promptEl.classList.add('elive-show');
      try { window.focus(); } catch (e) {}
      setTimeout(function () { try { textarea.focus(); } catch (e) {} }, 0);
      try { textarea.focus(); } catch (e) {}
    }
    function closePrompt() {
      promptEl.classList.remove('elive-show');
      textarea.value = '';
    }
    function isPromptOpen() { return promptEl.classList.contains('elive-show'); }
    function sendPrompt() {
      var text = textarea.value.trim();
      if (!text) { closePrompt(); return; }
      events.push({ type: 'prompt', text: text, ids: currentSelection() });
      closePrompt();
      toast('Sent to agent');
    }

    textarea.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); closePrompt(); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendPrompt(); }
    });
    ['keyup', 'keypress', 'input', 'paste', 'copy', 'cut'].forEach(function (t) {
      textarea.addEventListener(t, function (e) { e.stopPropagation(); });
    });

    function isAltSpace(e) {
      return e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'Space' || e.key === ' ' || e.keyCode === 32);
    }
    function onHotkey(e) {
      if (!isAltSpace(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (isPromptOpen()) { try { textarea.focus(); } catch (x) {} return; }
      openPrompt();
    }
    window.addEventListener('keydown', onHotkey, true);

    var hookedPreviewDoc = null;
    function hookPreview() {
      var pdoc = getPreviewDoc();
      if (!pdoc || pdoc === hookedPreviewDoc) return;
      try {
        if (pdoc.__eliveHooked) { hookedPreviewDoc = pdoc; return; }
        pdoc.addEventListener('keydown', onHotkey, true);
        pdoc.__eliveHooked = true;
        hookedPreviewDoc = pdoc;
      } catch (e) {}
    }

    var lastSelKey = currentSelection().slice().sort().join(',');
    function pollSelection() {
      hookPreview();
      var sel = currentSelection();
      var key = sel.slice().sort().join(',');
      if (key !== lastSelKey) {
        lastSelKey = key;
        if (!isQuiet()) events.push({ type: 'select', ids: sel });
      }
      if (cursorVisible && lastTargetId) {
        var node = findNode(lastTargetId);
        if (node) {
          var r = nodeRect(node);
          var fr = iframeRect();
          var gl = parseFloat(glowEl.style.left) || 0, gt = parseFloat(glowEl.style.top) || 0;
          var nl = Math.max(fr.left, Math.min(fr.left + r.left, fr.left + fr.width)) - 3;
          var nt = Math.max(fr.top, Math.min(fr.top + r.top, fr.top + fr.height)) - 3;
          if (Math.abs(gl - nl) > 1 || Math.abs(gt - nt) > 1) moveTo({ x: r.left, y: r.top, width: r.width, height: r.height }, true);
        }
      }
    }

    var histDocId = null;
    var seen = {};
    var dirty = false;

    function historyItems(doc) {
      try {
        var items = doc && doc.history && doc.history.getItems ? doc.history.getItems() : null;
        if (!items) return [];
        return items.models ? items.models.slice() : (Array.isArray(items) ? items.slice() : []);
      } catch (e) { return []; }
    }
    function attr(item, key) {
      try { return item && item.get ? item.get(key) : (item ? item[key] : undefined); } catch (e) { return undefined; }
    }
    function itemIds(item) {
      var out = [];
      try {
        var subs = attr(item, 'items');
        var arr = subs ? (subs.models || (Array.isArray(subs) ? subs : [])) : [];
        arr.forEach(function (s) {
          var c = attr(s, 'container');
          if (c && c.id) out.push(String(c.id));
          var cs = attr(s, 'containers');
          if (cs && cs.forEach) cs.forEach(function (x) { if (x && x.id) out.push(String(x.id)); });
        });
      } catch (e) {}
      return out.filter(function (id, i) { return id !== 'document' && out.indexOf(id) === i; });
    }
    function itemKey(item) {
      var id = attr(item, 'id');
      return id !== undefined && id !== null ? String(id) : (item && item.cid ? item.cid : null);
    }

    function pollHistory() {
      var doc = getDoc();
      if (!doc) return;
      var items = historyItems(doc);
      if (doc.id !== histDocId) {
        histDocId = doc.id;
        seen = {};
        items.forEach(function (it) { var k = itemKey(it); if (k) seen[k] = attr(it, 'status'); });
        return;
      }
      for (var i = items.length - 1; i >= 0; i--) {
        var it = items[i];
        var k = itemKey(it);
        if (!k) continue;
        var status = attr(it, 'status');
        var title = String(attr(it, 'title') || '');
        if (!(k in seen)) {
          seen[k] = status;
          if (attr(it, 'editing_started')) continue;
          dirty = true;
          if (isQuiet() || title.indexOf('Agent:') === 0 || title === 'Editing Started') continue;
          var ids = itemIds(it);
          events.push({ type: 'change', title: title, ids: ids.length ? ids : undefined });
        } else if (seen[k] !== status) {
          seen[k] = status;
          dirty = true;
          if (isQuiet()) continue;
          var ids2 = itemIds(it);
          events.push({ type: 'change', title: (status === 'applied' ? 'Undo: ' : 'Redo: ') + title, ids: ids2.length ? ids2 : undefined });
        }
      }
    }

    var saveHooked = false;
    try {
      var elm = getEl();
      if (elm && elm.channels && elm.channels.editor && typeof elm.channels.editor.on === 'function') {
        elm.channels.editor.on('saved', function () {
          dirty = false;
          if (!isQuiet()) events.push({ type: 'save' });
        });
        saveHooked = true;
      }
    } catch (e) { saveHooked = false; }

    window.__elive = {
      version: 1,
      bootedAt: Date.now(),
      events: events,
      cursor: { moveTo: moveTo, moveToId: moveToId, hide: hideCursor, park: parkCursor },
      say: say,
      hud: { set: hudSet },
      prompt: { open: openPrompt, close: closePrompt, isOpen: isPromptOpen },
      toast: toast,
      selection: currentSelection,
      get dirty() { return dirty; },
      get saveHooked() { return saveHooked; },
      beginAgent: function () { agentDepth += 1; },
      endAgent: function () { agentDepth = Math.max(0, agentDepth - 1); quietUntil = Date.now() + 800; },
      capture: function (on) { if (on) root.classList.add('elive-capturing'); else root.classList.remove('elive-capturing'); }
    };

    events.push({ type: 'navigate', text: String(location.href) });
    pollHistory();
    setInterval(function () { try { pollSelection(); } catch (e) {} }, 250);
    setInterval(function () { try { pollHistory(); } catch (e) {} }, 400);
  }

  if (isReady()) { try { activate(); } catch (e) {} return; }
  if (window.__eliveBooting) return;
  window.__eliveBooting = true;
  var started = Date.now();
  var timer = setInterval(function () {
    if (window.__elive) { clearInterval(timer); return; }
    if (isReady()) { clearInterval(timer); try { activate(); } catch (e) {} return; }
    if (Date.now() - started > 60000) clearInterval(timer);
  }, 500);
})();`;

type OverlayEnvelope<T> = { missing: true } | { missing: false; value: T };

async function invoke<T>(page: Page, method: string, args: unknown[]): Promise<OverlayEnvelope<T>> {
  return (await page.evaluate(
    ([m, a]) => {
      const o = (window as any).__elive;
      if (!o) return { missing: true };
      const path = String(m).split('.');
      const fn = path.length === 2 ? o[path[0]][path[1]] : o[path[0]];
      const owner = path.length === 2 ? o[path[0]] : o;
      return { missing: false, value: fn.apply(owner, a) ?? null };
    },
    [method, args] as const,
  )) as OverlayEnvelope<T>;
}

export const overlay = {
  isActive: async (page: Page): Promise<boolean> => page.evaluate(() => !!(window as any).__elive),
  say: (page: Page, message: string, id: string | undefined, mood: AgentMood) => invoke<boolean>(page, 'say', [message, id ?? null, mood]),
  moveToId: (page: Page, id: string, scroll = false) => invoke<boolean>(page, 'cursor.moveToId', [id, { scroll }]),
  moveTo: (page: Page, box: Box) => invoke<boolean>(page, 'cursor.moveTo', [box]),
  hideCursor: (page: Page) => invoke<null>(page, 'cursor.hide', []),
  setHud: (page: Page, state: HudState) => invoke<boolean>(page, 'hud.set', [state]),
  pull: (page: Page, since: number) => invoke<UserEvent[]>(page, 'events.pull', [since]),
  capture: (page: Page, on: boolean) => invoke<null>(page, 'capture', [on]),
  lastSeq: async (page: Page): Promise<number | undefined> =>
    page.evaluate(() => (window as any).__elive?.events?.seq as number | undefined),
  dirty: async (page: Page): Promise<boolean | undefined> =>
    page.evaluate(() => (window as any).__elive?.dirty as boolean | undefined),
};
