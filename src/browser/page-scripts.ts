export const PAGE_API_SCRIPT: string = String.raw`(() => {
  if (window.top !== window) return;

  var SKIP_CONTROL_TYPES = ['section', 'tab', 'tabs', 'heading', 'divider', 'raw_html', 'alert', 'notice', 'deprecated_notice'];
  var DEVICES = ['desktop', 'tablet', 'mobile'];
  var SAVE_MODES = ['draft', 'publish', 'update'];

  function fail(code, message) { var e = new Error(message); e.code = code; throw e; }
  function el() { return window.elementor; }
  function getDoc() { try { return el().documents.getCurrent(); } catch (e) { return null; } }
  function previewFrame() { return document.getElementById('elementor-preview-iframe'); }
  function previewDoc() { try { var f = previewFrame(); return f ? f.contentDocument : null; } catch (e) { return null; } }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function overlay() { return window.__elive || null; }

  function ready() {
    try {
      var e = el();
      var pd = previewDoc();
      return !!(e && window.$e && e.documents && e.documents.getCurrent && e.documents.getCurrent() &&
        pd && pd.readyState === 'complete' && e.getPreviewView && e.getPreviewView() &&
        e.widgetsCache && Object.keys(e.widgetsCache).length > 0);
    } catch (x) { return false; }
  }

  function cache(type) {
    try { return (el().widgetsCache || {})[type] || null; } catch (e) { return null; }
  }
  function isAtomicType(type) {
    if (!type) return false;
    var w = cache(type);
    if (w && (w.atomic || w.atomic_controls)) return true;
    return String(type).indexOf('e-') === 0;
  }
  function containerType(c) {
    try { return c.model.get('widgetType') || c.model.get('elType'); } catch (e) { return undefined; }
  }
  function isAtomicContainer(c) { return !!c && isAtomicType(containerType(c)); }

  function resolve(id) {
    if (id === undefined || id === null) return null;
    var doc = getDoc();
    if (String(id) === 'document') return doc ? doc.container : null;
    var found = null;
    try { found = el().getContainer(String(id)) || null; } catch (e) { found = null; }
    return found || pendingCreated[String(id)] || null;
  }

  var pendingCreated = {};

  function selection() {
    try { return (el().selection.getElements() || []).map(function (c) { return String(c.id); }); } catch (e) { return []; }
  }

  function currentDevice() {
    try { return el().channels.deviceMode.request('currentMode'); } catch (e) { return undefined; }
  }

  function status() {
    var href = String(location.href);
    if (!ready()) return { connected: false, editorUrl: href, selection: [] };
    var e = el();
    var doc = getDoc();
    var title;
    try { title = doc.container.settings.get('post_title'); } catch (x) {}
    if (!title) { try { title = doc.config.settings.settings.post_title; } catch (x) {} }
    var postId = Number(doc.id);
    if (!isFinite(postId)) { var m = /[?&]post=(\d+)/.exec(href); postId = m ? Number(m[1]) : undefined; }
    var version;
    try { version = e.config.version; } catch (x) {}
    var atomic = false;
    try { atomic = !!window.elementorCommon.config.experimentalFeatures.e_atomic_elements; } catch (x) {}
    var o = overlay();
    var out = {
      connected: true,
      editorUrl: href,
      postId: postId,
      title: title || undefined,
      documentType: doc.config ? doc.config.type : undefined,
      elementorVersion: version ? String(version) : undefined,
      atomicEnabled: atomic,
      selection: selection()
    };
    if (o && o.events) out.lastSeq = o.events.seq;
    return out;
  }

  function readElement(c) {
    var elType = c.model.get('elType');
    var widgetType = c.model.get('widgetType');
    var settings = {};
    try { settings = c.settings && c.settings.toJSON ? c.settings.toJSON() : {}; } catch (x) {}
    var title;
    try { title = c.model.getTitle ? c.model.getTitle() : undefined; } catch (x) {}
    var node = {
      id: String(c.id),
      elType: String(elType),
      settings: JSON.parse(JSON.stringify(settings || {})),
      atomic: isAtomicType(widgetType || elType),
      children: (c.children || []).map(readElement)
    };
    if (widgetType) node.widgetType = String(widgetType);
    if (title) node.title = String(title);
    return node;
  }

  function tree() {
    var doc = getDoc();
    return { id: 'document', elType: 'document', settings: {}, atomic: false, children: (doc.container.children || []).map(readElement) };
  }

  function optionsRecord(opts) {
    if (!opts || typeof opts !== 'object') return undefined;
    var out = {};
    if (Array.isArray(opts)) {
      opts.forEach(function (o) { if (o && o.value !== undefined) out[String(o.value)] = String(o.label !== undefined ? o.label : o.value); });
    } else {
      Object.keys(opts).forEach(function (k) {
        var v = opts[k];
        out[k] = v && typeof v === 'object' ? String(v.title !== undefined ? v.title : (v.label !== undefined ? v.label : k)) : String(v);
      });
    }
    return Object.keys(out).length ? out : undefined;
  }

  function atomicControls(entry) {
    var out = [];
    var schema = entry.atomic_props_schema || {};
    function walk(items, section) {
      (items || []).forEach(function (it) {
        if (!it || !it.value) return;
        if (it.type === 'section') { walk(it.value.items, it.value.id || section); return; }
        if (it.type !== 'control') return;
        var v = it.value;
        if (!v.bind) return;
        var def = { name: String(v.bind), type: String(v.type) };
        if (v.label) def.label = String(v.label);
        if (schema[v.bind] && schema[v.bind].default !== undefined) def.default = schema[v.bind].default;
        var opts = optionsRecord(v.props && v.props.options);
        if (opts) def.options = opts;
        if (section) def.section = String(section);
        def.tab = 'settings';
        out.push(def);
      });
    }
    walk(entry.atomic_controls, undefined);
    return out;
  }

  function hasRawControls(entry) {
    var raw = entry && entry.controls;
    return !!(raw && (Array.isArray(raw) ? raw.length : Object.keys(raw).length));
  }

  async function awaitControls(type) {
    var entry = cache(type);
    if (!entry || hasRawControls(entry) || entry.atomic_controls) return;
    var start = Date.now();
    var requested = false;
    while (Date.now() - start < 12000) {
      await sleep(100);
      if (hasRawControls(cache(type))) return;
      if (!requested && Date.now() - start > 4000) {
        requested = true;
        try { if (typeof el().requestWidgetsConfig === 'function') el().requestWidgetsConfig(); } catch (x) {}
      }
    }
  }

  async function controls(type) {
    var e = el();
    await awaitControls(type);
    var entry = cache(type);
    var raw = entry && entry.controls;
    if ((!raw || (Array.isArray(raw) && raw.length === 0) || Object.keys(raw).length === 0) && entry && entry.atomic_controls) return atomicControls(entry);
    if (!raw || Object.keys(raw).length === 0) {
      try { raw = e.config.elements[type].controls; } catch (x) { raw = null; }
    }
    if (!raw) fail('element_not_found', 'Unknown widget or element type: ' + type);
    var list = Array.isArray(raw) ? raw : Object.keys(raw).map(function (k) { var c = raw[k]; return c && !c.name ? Object.assign({ name: k }, c) : c; });
    var out = [];
    list.forEach(function (c) {
      if (!c || SKIP_CONTROL_TYPES.indexOf(c.type) >= 0) return;
      var def = { name: String(c.name), type: String(c.type) };
      if (c.label) def.label = String(c.label);
      if (c.default !== undefined) def.default = c.default;
      var opts = optionsRecord(c.options);
      if (opts) def.options = opts;
      if (c.section) def.section = String(c.section);
      if (c.tab) def.tab = String(c.tab);
      if (c.responsive) def.responsive = true;
      out.push(def);
    });
    return out;
  }

  function widgets() {
    var wc = el().widgetsCache || {};
    return Object.keys(wc).map(function (k) {
      var w = wc[k] || {};
      var cats = Array.isArray(w.categories) ? w.categories.map(String) : (w.categories ? Object.values(w.categories).map(String) : []);
      return { type: k, title: String(w.title || k), categories: cats, atomic: !!(w.atomic || w.atomic_controls) };
    });
  }

  function findNode(pdoc, id) {
    try { return pdoc.querySelector('[data-id="' + String(id).replace(/["\\]/g, '\\$&') + '"][data-element_type]'); } catch (e) { return null; }
  }

  function effectiveNode(node) {
    var win = node.ownerDocument.defaultView;
    var cur = node;
    for (var i = 0; i < 4; i++) {
      if (win.getComputedStyle(cur).display !== 'contents') return cur;
      if (!cur.firstElementChild) return cur;
      cur = cur.firstElementChild;
    }
    return cur;
  }

  function nodeRect(node) {
    var win = node.ownerDocument.defaultView;
    if (win.getComputedStyle(node).display !== 'contents') { var b = node.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; }
    var l = Infinity, t = Infinity, r = -Infinity, bt = -Infinity;
    for (var i = 0; i < node.children.length; i++) {
      var kr = nodeRect(node.children[i]);
      if (kr.width === 0 && kr.height === 0) continue;
      l = Math.min(l, kr.x); t = Math.min(t, kr.y); r = Math.max(r, kr.x + kr.width); bt = Math.max(bt, kr.y + kr.height);
    }
    if (l === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: l, y: t, width: r - l, height: bt - t };
  }

  function rafTick(win) {
    return new Promise(function (res) {
      var done = false;
      var finish = function () { if (!done) { done = true; res(); } };
      try { win.requestAnimationFrame(finish); } catch (e) { finish(); }
      setTimeout(finish, 60);
    });
  }

  function modelIds() {
    var ids = [];
    function walk(c) { (c.children || []).forEach(function (k) { ids.push(String(k.id)); walk(k); }); }
    var doc = getDoc();
    if (doc) walk(doc.container);
    return ids;
  }

  async function quietRender(ids) {
    var pdoc = previewDoc();
    if (!pdoc) return;
    var start = Date.now();
    var want = ids ? ids.filter(function (id) { return !!resolve(id); }) : null;
    while (Date.now() - start < 1500) {
      var ok;
      if (want) {
        ok = want.every(function (id) { var n = findNode(pdoc, id); return n && nodeRect(n).height > 0; });
      } else {
        ok = modelIds().every(function (id) { return !!findNode(pdoc, id); });
      }
      if (ok) break;
      await sleep(50);
    }
    var win = pdoc.defaultView;
    await rafTick(win);
    await rafTick(win);
  }

  function textHost(root) {
    var walker = root.ownerDocument.createTreeWalker(root, 4);
    var t;
    while ((t = walker.nextNode())) {
      if (!t.nodeValue || !t.nodeValue.trim()) continue;
      var host = t.parentElement;
      if (!host) continue;
      var owner = host.closest('[data-id][data-element_type]');
      if (owner && owner !== root && root.contains(owner) && owner !== root.closest('[data-id][data-element_type]')) continue;
      var tag = host.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE') continue;
      return host;
    }
    return root;
  }

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function measure(node) {
    var win = node.ownerDocument.defaultView;
    var eff = effectiveNode(node);
    var cs = win.getComputedStyle(eff);
    var ts = win.getComputedStyle(textHost(eff));
    var box = nodeRect(node);
    var fontSize = num(ts.fontSize);
    var lh = ts.lineHeight === 'normal' ? fontSize * 1.2 : num(ts.lineHeight);
    var parent = node.parentElement ? node.parentElement.closest('[data-id][data-element_type]') : null;
    var wt = node.getAttribute('data-widget_type');
    var g = {
      id: String(node.getAttribute('data-id')),
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      computed: {
        display: cs.display,
        paddingTop: num(cs.paddingTop),
        paddingRight: num(cs.paddingRight),
        paddingBottom: num(cs.paddingBottom),
        paddingLeft: num(cs.paddingLeft),
        marginTop: num(cs.marginTop),
        marginBottom: num(cs.marginBottom),
        gap: num(cs.gap) || num(cs.rowGap),
        fontSize: fontSize,
        lineHeight: lh,
        overflowX: cs.overflowX,
        overflowY: cs.overflowY
      },
      text: String(node.innerText || eff.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      scrollOverflowX: eff.scrollWidth > eff.clientWidth + 1,
      elType: String(node.getAttribute('data-element_type') || '')
    };
    if (parent) g.parentId = String(parent.getAttribute('data-id'));
    if (wt) g.widgetType = wt.split('.')[0];
    return g;
  }

  async function geometry(ids) {
    var pdoc = previewDoc();
    if (!pdoc) fail('editor_not_ready', 'Preview iframe is not available');
    await quietRender(ids ? ids.map(String) : null);
    var out = [];
    var seenIds = {};
    var nodes = ids ? ids.map(function (id) { return findNode(pdoc, id); }) : Array.prototype.slice.call(pdoc.querySelectorAll('[data-id][data-element_type]'));
    nodes.forEach(function (n) {
      if (!n) return;
      var id = n.getAttribute('data-id');
      if (!id || seenIds[id]) return;
      seenIds[id] = true;
      try { out.push(measure(n)); } catch (e) {}
    });
    return out;
  }

  function wrapAtomic(type, settings) {
    var entry = cache(type) || {};
    var schema = entry.atomic_props_schema || {};
    var out = {};
    Object.keys(settings || {}).forEach(function (k) {
      var v = settings[k];
      var prop = schema[k];
      if (v === null || typeof v === 'object' || !prop) { out[k] = v; return; }
      var candidates = prop.kind === 'union' && prop.prop_types ? Object.keys(prop.prop_types).map(function (pk) { return prop.prop_types[pk]; }) : [prop];
      var t = typeof v;
      var pick = null;
      for (var i = 0; i < candidates.length && !pick; i++) {
        var c = candidates[i];
        if (!c) continue;
        if (c.kind === t || c.key === t) pick = c;
        else if (c.kind === 'plain' && c.default && typeof c.default.value === t) pick = c;
      }
      if (!pick && t === 'string') {
        for (var j = 0; j < candidates.length && !pick; j++) if (candidates[j] && candidates[j].kind === 'string') pick = candidates[j];
      }
      out[k] = pick && pick.key ? { $$type: pick.key, value: v } : v;
    });
    return out;
  }

  function opTargets(op) {
    if (!op) return null;
    if (op.op === 'create') return op.parentId || 'document';
    if (op.op === 'move') return op.id;
    return op.id || null;
  }

  function errMsg(e) { return String(e && e.message ? e.message : e); }

  function normalizeModel(op) {
    var model = { elType: String(op.elType) };
    if (op.widgetType) model.widgetType = String(op.widgetType);
    if (model.elType !== 'widget' && !model.widgetType) {
      var entry = cache(model.elType);
      if (entry && entry.elType === 'widget') { model.widgetType = model.elType; model.elType = 'widget'; }
    }
    return model;
  }

  function hasControl(container, name) {
    try { if (container.settings && container.settings.controls && container.settings.controls[name]) return true; } catch (e) {}
    var entry = cache(containerType(container));
    var raw = entry && entry.controls;
    return !!(raw && !Array.isArray(raw) && raw[name]);
  }

  function applySettings(container, settings) {
    var s = isAtomicContainer(container) ? wrapAtomic(containerType(container), settings) : settings;
    window.$e.run('document/elements/settings', { container: container, settings: s, options: { external: true } });
  }

  function runOne(op, index) {
    var base = { index: index, op: op && op.op };
    var target = null;
    try {
      if (!op || typeof op !== 'object') return Object.assign(base, { ok: false, code: 'invalid_op', error: 'Operation must be an object' });
      var o = overlay();
      var tid = opTargets(op);
      if (o && tid && tid !== 'document') { try { o.cursor.moveToId(tid); } catch (x) {} }
      switch (op.op) {
        case 'create': {
          if (!op.elType) return Object.assign(base, { ok: false, code: 'invalid_op', error: 'create requires elType' });
          var parentId = op.parentId || 'document';
          var parent = resolve(parentId);
          if (!parent) return Object.assign(base, { ok: false, code: 'parent_not_found', error: 'Parent not found: ' + parentId });
          target = parent;
          var model = normalizeModel(op);
          if (model.elType === 'widget' && !model.widgetType) return Object.assign(base, { ok: false, code: 'invalid_op', error: 'create with elType "widget" requires widgetType' });
          var atomic = isAtomicType(model.widgetType || model.elType);
          var hasSettings = op.settings && typeof op.settings === 'object' && Object.keys(op.settings).length > 0;
          if (hasSettings) model.settings = atomic ? wrapAtomic(model.widgetType || model.elType, op.settings) : op.settings;
          var options = {};
          if (typeof op.at === 'number') options.at = op.at;
          var created = window.$e.run('document/elements/create', { container: parent, model: model, options: options });
          if (Array.isArray(created)) created = created[0];
          if (!created || !created.id) return Object.assign(base, { ok: false, code: 'editor_error', error: 'Elementor did not create the element' });
          var newId = String(created.id);
          pendingCreated[newId] = created;
          if (o) { try { o.cursor.moveToId(newId); } catch (x) {} }
          return Object.assign(base, { ok: true, id: newId });
        }
        case 'update_settings': {
          var c1 = resolve(op.id);
          if (!c1) return Object.assign(base, { ok: false, code: 'element_not_found', error: 'Element not found: ' + op.id });
          target = c1;
          if (!op.settings || typeof op.settings !== 'object') return Object.assign(base, { ok: false, code: 'invalid_op', error: 'update_settings requires settings' });
          applySettings(c1, op.settings);
          return Object.assign(base, { ok: true, id: String(op.id) });
        }
        case 'set_custom_css': {
          var c2 = resolve(op.id);
          if (!c2) return Object.assign(base, { ok: false, code: 'element_not_found', error: 'Element not found: ' + op.id });
          target = c2;
          if (!hasControl(c2, 'custom_css')) return Object.assign(base, { ok: false, code: 'editor_error', error: 'custom_css is not available on this element (requires Elementor Pro); use style settings or _css_classes instead' });
          applySettings(c2, { custom_css: String(op.css == null ? '' : op.css) });
          return Object.assign(base, { ok: true, id: String(op.id) });
        }
        case 'move': {
          var c3 = resolve(op.id);
          if (!c3) return Object.assign(base, { ok: false, code: 'element_not_found', error: 'Element not found: ' + op.id });
          var dest = resolve(op.parentId);
          if (!dest) return Object.assign(base, { ok: false, code: 'parent_not_found', error: 'Parent not found: ' + op.parentId });
          target = c3;
          var mopts = {};
          if (typeof op.at === 'number') mopts.at = op.at;
          var moved = window.$e.run('document/elements/move', { container: c3, target: dest, options: mopts });
          if (Array.isArray(moved)) moved = moved[0];
          return Object.assign(base, { ok: true, id: String(moved && moved.id ? moved.id : op.id) });
        }
        case 'delete': {
          var c4 = resolve(op.id);
          if (!c4) return Object.assign(base, { ok: false, code: 'element_not_found', error: 'Element not found: ' + op.id });
          target = c4;
          window.$e.run('document/elements/delete', { container: c4 });
          return Object.assign(base, { ok: true, id: String(op.id) });
        }
        case 'duplicate': {
          var c5 = resolve(op.id);
          if (!c5) return Object.assign(base, { ok: false, code: 'element_not_found', error: 'Element not found: ' + op.id });
          target = c5;
          var dup = window.$e.run('document/elements/duplicate', { container: c5 });
          if (Array.isArray(dup)) dup = dup[0];
          if (!dup || !dup.id) return Object.assign(base, { ok: false, code: 'editor_error', error: 'Elementor did not return the duplicated element' });
          pendingCreated[String(dup.id)] = dup;
          if (o) { try { o.cursor.moveToId(String(dup.id)); } catch (x) {} }
          return Object.assign(base, { ok: true, id: String(dup.id) });
        }
        default:
          return Object.assign(base, { ok: false, code: 'invalid_op', error: 'Unknown op: ' + String(op.op) });
      }
    } catch (e) {
      return Object.assign(base, { ok: false, code: isAtomicContainer(target) ? 'unsupported_atomic' : 'editor_error', error: errMsg(e) });
    }
  }

  function bindRefs(op, results) {
    if (!op || typeof op !== 'object') return { op: op };
    var out = Object.assign({}, op);
    var keys = ['id', 'parentId'];
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var v = out[key];
      if (typeof v !== 'string') continue;
      var m = /^\$(\d+)$/.exec(v);
      if (!m) continue;
      var ref = results[Number(m[1])];
      if (!ref || !ref.ok || !ref.id) {
        return { error: { code: key === 'parentId' ? 'parent_not_found' : 'element_not_found', error: 'Reference ' + v + ' does not point to a successful earlier op' } };
      }
      out[key] = ref.id;
    }
    return { op: out };
  }

  async function cursorTour(ops) {
    var o = overlay();
    if (!o) return;
    var targets = [];
    ops.forEach(function (op) {
      var t = opTargets(op);
      if (t && /^\$\d+$/.test(t)) return;
      if (t && t !== 'document' && targets[targets.length - 1] !== t) targets.push(t);
    });
    if (targets.length < 2) return;
    var delay = Math.max(60, Math.min(300, Math.floor(1000 / targets.length)));
    for (var i = 0; i < targets.length - 1; i++) {
      try { if (o.cursor.moveToId(targets[i])) await sleep(delay); } catch (e) {}
    }
  }

  async function runOps(ops, label) {
    ops = Array.isArray(ops) ? ops : [];
    var title = 'Agent: ' + String(label || 'change');
    var o = overlay();
    if (o) o.beginAgent();
    try {
      await cursorTour(ops);
      var grouped = false;
      var hid = null;
      try {
        hid = window.$e.internal('document/history/start-log', { type: 'add', title: title });
        grouped = hid !== undefined && hid !== null;
      } catch (e) { grouped = false; }
      var results = [];
      pendingCreated = {};
      try {
        for (var i = 0; i < ops.length; i++) {
          var bound = bindRefs(ops[i], results);
          results.push(bound.error ? Object.assign({ index: i, op: ops[i] && ops[i].op, ok: false }, bound.error) : runOne(bound.op, i));
        }
      } finally {
        pendingCreated = {};
        if (grouped) { try { window.$e.internal('document/history/end-log', { id: hid }); } catch (e) {} }
      }
      return { results: results, historyGrouped: grouped, historyTitle: title };
    } finally {
      if (o) o.endAgent();
    }
  }

  async function save(mode) {
    if (SAVE_MODES.indexOf(mode) < 0) return { ok: false, error: 'Unknown save mode: ' + mode };
    var o = overlay();
    if (o) o.beginAgent();
    try {
      await window.$e.run('document/save/' + mode);
      var st;
      try { st = getDoc().container.settings.get('post_status'); } catch (x) {}
      return st ? { ok: true, status: String(st) } : { ok: true };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    } finally {
      if (o) o.endAgent();
    }
  }

  async function waitFrameStable() {
    var f = previewFrame();
    if (!f) return;
    var last = -1, stable = 0, start = Date.now();
    while (Date.now() - start < 1500 && stable < 3) {
      var w = f.getBoundingClientRect().width;
      if (Math.abs(w - last) < 0.5) stable++; else stable = 0;
      last = w;
      await sleep(60);
    }
  }

  async function setDevice(device) {
    if (DEVICES.indexOf(device) < 0) fail('evaluate_failed', 'Unknown device: ' + device);
    var e = el();
    var errors = [];
    if (currentDevice() !== device) {
      try { if (typeof e.changeDeviceMode === 'function') e.changeDeviceMode(device); } catch (x) { errors.push(errMsg(x)); }
      if (currentDevice() !== device) {
        try { await window.$e.run('panel/change-device-mode', { device: device }); } catch (x) { errors.push(errMsg(x)); }
      }
    }
    if (currentDevice() !== device) fail('evaluate_failed', 'Could not switch device mode to ' + device + (errors.length ? ': ' + errors.join('; ') : ''));
    await waitFrameStable();
    return device;
  }

  async function prepareShot(id) {
    var f = previewFrame();
    var pdoc = previewDoc();
    if (!f || !pdoc) fail('editor_not_ready', 'Preview iframe is not available');
    var rect = null;
    if (id) {
      var node = findNode(pdoc, id);
      if (!node) return { found: false };
      var o = overlay();
      if (o) { try { o.cursor.moveToId(String(id), { scroll: true }); } catch (x) {} }
      else { try { effectiveNode(node).scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (x) {} }
      await quietRender([String(id)]);
      await sleep(380);
      node = findNode(pdoc, id) || node;
      rect = nodeRect(node);
    }
    var fr = f.getBoundingClientRect();
    return {
      found: true,
      frame: { x: fr.left, y: fr.top, width: fr.width, height: fr.height },
      rect: rect,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  }

  var methods = {
    status: status,
    tree: tree,
    controls: controls,
    widgets: widgets,
    geometry: geometry,
    runOps: runOps,
    save: save,
    selection: selection,
    setDevice: setDevice,
    prepareShot: prepareShot
  };

  window.__eliveApi = {
    version: 1,
    ready: ready,
    invoke: async function (name, args) {
      try {
        var fn = methods[name];
        if (!fn) return { e: 'evaluate_failed', m: 'Unknown page method: ' + name };
        if (name !== 'status' && !ready()) return { e: 'editor_not_ready', m: 'Elementor editor is not ready' };
        var v = await fn.apply(null, args || []);
        return { v: v === undefined ? null : v };
      } catch (err) {
        return { e: err && err.code ? String(err.code) : 'evaluate_failed', m: errMsg(err) };
      }
    }
  };
})();`;
