(function () {
'use strict';

/* ------------------------------------------------------------------
   Storage
------------------------------------------------------------------ */
var LS = {
  fav: 'wpv.favorites', custom: 'wpv.custom', over: 'wpv.overrides',
  hidden: 'wpv.hidden', recents: 'wpv.recents', values: 'wpv.values',
  settings: 'wpv.settings'
};
// Prompt-scoped fill-in values live here: they survive a reload of this tab
// and nothing else, so pasted material never follows a person to next week.
var SS = { local: 'wpv.session.values' };

function loadSession(key, fallback) {
  try { var raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch (e) { return fallback; }
}
function saveSession(key, val) {
  try { sessionStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode: in-memory only */ }
}

function load(key, fallback) {
  try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch (e) { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch (e) { toast('Storage is blocked or full, so that change will not survive a refresh.', true); return false; }
}

var S = {
  base: [], taxonomy: null, collection: 'Prompt Cookbook', defaults: {}, collections: [],
  favorites: load(LS.fav, []),
  custom: load(LS.custom, []),
  overrides: load(LS.over, {}),
  hidden: load(LS.hidden, []),
  recents: load(LS.recents, []),
  values: load(LS.values, {}),          // shared placeholders only
  local: loadSession(SS.local, {}),     // prompt-scoped placeholders, keyed promptId|KEY
  settings: Object.assign({ model: 'claude', theme: 'light', collapsed: {} }, load(LS.settings, {})),
  q: '', fn: [], cat: [], cx: [], coll: null, view: 'all',
  selected: null, mode: 'read', draft: null
};

/* ------------------------------------------------------------------
   Small helpers
------------------------------------------------------------------ */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function el(id) { return document.getElementById(id); }
function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }
function toggleIn(arr, v) {
  var i = arr.indexOf(v);
  if (i === -1) arr.push(v); else arr.splice(i, 1);
  return arr;
}
var toastTimer;
function toast(msg, warn) {
  var t = el('toast');
  t.textContent = msg;
  t.className = 'toast show' + (warn ? ' warn' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.className = 'toast'; }, 2600);
}

/* ------------------------------------------------------------------
   Data assembly: published + user overrides + user prompts
------------------------------------------------------------------ */
function prompts() {
  var out = [];
  S.base.forEach(function (p) {
    if (S.hidden.indexOf(p.id) !== -1) return;
    var o = S.overrides[p.id];
    out.push(o ? Object.assign({}, p, o, { edited: true }) : p);
  });
  S.custom.forEach(function (p) { out.push(Object.assign({ source: 'user' }, p)); });
  return out;
}
function byId(id) {
  var all = prompts();
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}
function fnMeta(id) {
  var f = S.taxonomy.functions.filter(function (x) { return x.id === id; })[0];
  return f || { id: id, label: id, tab: '#8794A0' };
}
function catLabel(id) {
  var c = S.taxonomy.categories.filter(function (x) { return x.id === id; })[0];
  return c ? c.label : id;
}


/* ------------------------------------------------------------------
   Attribution and licensing

   Both fields accept a string or an object, so prompts.json stays
   pleasant to hand-edit:

     "author": "Jane Doe"
     "author": { "name": "Jane Doe", "url": "https://example.org" }
     "license": "CC-BY-4.0"
     "license": { "id": "CC-BY-4.0", "url": "https://..." }

   A prompt with neither inherits the collection defaults, so the
   common case costs nothing per prompt. The URL is optional on both;
   for a known license id it is filled in from the table below.
------------------------------------------------------------------ */
function licenseUrl(id) {
  var list = (S.taxonomy && S.taxonomy.licenses) || [];
  var hit = list.filter(function (l) {
    return l.id.toLowerCase() === String(id || '').toLowerCase();
  })[0];
  return hit ? hit.url : '';
}

function asParty(v, idKey) {
  if (!v) return null;
  if (typeof v === 'string') return { name: v, url: '' };
  var name = v.name || v[idKey] || '';
  if (!name) return null;
  return { name: name, url: v.url || '' };
}

function attribution(p) {
  var author = asParty(p.author, 'name') || asParty(S.defaults.author, 'name');
  var license = asParty(p.license, 'id') || asParty(S.defaults.license, 'id');
  if (license && !license.url) license.url = licenseUrl(license.name);
  return { author: author, license: license };
}

function partyHtml(party, prefix) {
  if (!party) return '';
  var label = esc(party.name);
  var body = party.url
    ? '<a href="' + esc(party.url) + '" target="_blank" rel="noopener">' + label + '</a>'
    : label;
  return prefix + ' ' + body;
}

/* ------------------------------------------------------------------
   Placeholders
------------------------------------------------------------------ */
var PH = /\{\{([A-Z0-9_]+)\}\}/g;

function collectKeys(p) {
  var text = JSON.stringify(p.blocks || {}) + JSON.stringify(p.placeholders || []);
  var keys = [], m;
  PH.lastIndex = 0;
  while ((m = PH.exec(text)) !== null) keys.push(m[1]);
  (p.placeholders || []).forEach(function (x) { keys.push(x.key); });
  return uniq(keys);
}
/* A placeholder definition:
     { key, label, default, scope: "shared" | "prompt", type: "text" | "textarea", options: [...] }
   scope defaults to "prompt". Only "shared" keys persist in localStorage;
   everything else is session-only and keyed to the prompt it belongs to. */
function phMeta(p, key) {
  var d = (p.placeholders || []).filter(function (x) { return x.key === key; })[0];
  var meta = d ? Object.assign({}, d)
               : { key: key, label: key.replace(/_/g, ' ').toLowerCase(), default: '' };
  meta.scope = meta.scope === 'shared' ? 'shared' : 'prompt';
  meta.options = Array.isArray(meta.options) && meta.options.length ? meta.options.slice() : null;
  meta.type = meta.options ? 'select' : (meta.type === 'textarea' ? 'textarea' : 'text');
  meta.default = meta.default || '';
  return meta;
}
function localKey(p, key) { return p.id + '|' + key; }

function storedValue(p, key) {
  return phMeta(p, key).scope === 'shared' ? S.values[key] : S.local[localKey(p, key)];
}
function valueFor(p, key) {
  var v = storedValue(p, key);
  if (v !== undefined && v !== '') return v;
  return phMeta(p, key).default;
}
function setValue(p, key, v) {
  if (phMeta(p, key).scope === 'shared') {
    if (v === '' || v === undefined) delete S.values[key]; else S.values[key] = v;
    save(LS.values, S.values);
  } else {
    var lk = localKey(p, key);
    if (v === '' || v === undefined) delete S.local[lk]; else S.local[lk] = v;
    saveSession(SS.local, S.local);
  }
}
// Anything in localStorage that no prompt declares as shared came from an
// older version of the app and would bleed across prompts. Drop it.
function pruneSharedValues() {
  var shared = {};
  prompts().forEach(function (p) {
    (p.placeholders || []).forEach(function (x) { if (x.scope === 'shared') shared[x.key] = true; });
  });
  var changed = false;
  Object.keys(S.values).forEach(function (k) {
    if (!shared[k]) { delete S.values[k]; changed = true; }
  });
  if (changed) save(LS.values, S.values);
}

/* Sensitivity. A declared level wins; `sensitive: false` switches the banner
   off; otherwise a prompt that takes pasted material about people gets the
   de-identification banner by default. */
var SENSITIVE_SUBJECT = /transcript|case ?notes?|participant|client|complaint|grievance|survey|responses|intake|interview|r\u00e9sum\u00e9|resume|testimonial|donor/i;
var TAKES_PASTE = /paste|attach|upload|transcript/i;

// What a prompt takes in: its title, its source-material line, and the
// labels of its multi-line fields. Example text after "e.g." is stripped so a
// column called "participant name" in an illustration does not count.
function intakeText(p) {
  var b = p.blocks || {};
  var parts = [p.title || '', b.data || ''];
  (p.placeholders || []).forEach(function (x) {
    if (x.type !== 'textarea') return;
    parts.push(x.key.replace(/_/g, ' '));
    parts.push(String(x.label || '').replace(/\be\.g\..*$/i, ''));
  });
  return parts.join(' ');
}
function effectiveSensitivity(p) {
  if (p.sensitive === false) return 'none';
  var declared = p.sensitivity || 'none';
  if (declared !== 'none') return declared;
  var b = p.blocks || {};
  var hasTextarea = (p.placeholders || []).some(function (x) { return x.type === 'textarea'; });
  var takesPaste = hasTextarea || TAKES_PASTE.test((b.data || '') + ' ' + (b.context || ''));
  return takesPaste && SENSITIVE_SUBJECT.test(intakeText(p)) ? 'deidentify' : 'none';
}
function sensitivityIsAuto(p) {
  return p.sensitive !== false && (p.sensitivity || 'none') === 'none' && effectiveSensitivity(p) !== 'none';
}
function fill(text, p) {
  if (!text) return '';
  return String(text).replace(PH, function (whole, key) {
    var v = valueFor(p, key);
    return v ? v : whole;
  });
}

/* ------------------------------------------------------------------
   Model adapters — one structured prompt, three renderings
------------------------------------------------------------------ */

/* ------------------------------------------------------------------
   Inline icons. Functional only: each one sits on the same baseline as
   the label it belongs to. No tinted tiles, no decoration.
------------------------------------------------------------------ */
var ICON = {
  plus:   'M12 5v14M5 12h14',
  guide:  'M4 4h11l5 5v11H4z M15 4v5h5',
  down:   'M12 3v12M7 10l5 5 5-5M4 19h16',
  up:     'M12 15V3M7 8l5-5 5 5M4 19h16',
  copy:   'M9 9h11v11H9z M5 15H4V4h11v1',
  edit:   'M4 20h4L20 8l-4-4L4 16z',
  dup:    'M8 8h12v12H8z M4 16V4h12',
  vars:   'M20 7h-9M14 17H5M17 12H3',
  code:   'M16 18l6-6-6-6M8 6l-6 6 6 6',
  info:   'M12 11v5M12 7.5v.5',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  ext:    'M14 4h6v6M20 4l-9 9M18 13v7H4V6h7',
  sys:    'M4 6h16M4 12h10M4 18h13',
  next:   'M5 12h14M13 6l6 6-6 6',
  chev:   'M8 10l4 4 4-4'
};
function icon(name, size) {
  var d = ICON[name] || '';
  var extra = name === 'info' ? '<circle cx="12" cy="12" r="9"/>' : '';
  return '<svg width="' + (size || 13) + '" height="' + (size || 13) + '" viewBox="0 0 24 24" ' +
    'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" aria-hidden="true">' +
    extra + '<path d="' + d + '"/></svg>';
}

var MODELS = {
  claude:  { label: 'Claude',  arch: 'XML-tagged structure',
             note: 'Structure carried in XML tags; source material before the instructions.' },
  chatgpt: { label: 'ChatGPT', arch: 'Markdown sections',
             note: 'Markdown headings, numbered task list, data-analysis handoff for files.' },
  gemini:  { label: 'Gemini',  arch: 'Source-first framing',
             note: 'Source first, brief second, instruction restated at the end for long inputs.' }
};

function blocks(p) {
  var b = p.blocks || {};
  return {
    role: fill(b.role, p),
    context: fill(b.context, p),
    steps: (b.steps || []).map(function (s) { return fill(s, p); }),
    output: fill(b.output, p),
    constraints: (b.constraints || []).map(function (s) { return fill(s, p); }),
    data: fill(b.data, p)
  };
}

function composeClaude(p) {
  var b = blocks(p), out = [];
  if (b.role) out.push('<role>\n' + b.role + '\n</role>');
  if (b.context) out.push('<context>\n' + b.context + '\n</context>');
  if (b.data) out.push('<source_material>\n' + b.data + '\n\n[Paste the material here, or attach the file.]\n</source_material>');
  if (b.steps.length) {
    out.push('<instructions>\n' + b.steps.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n') + '\n</instructions>');
  }
  if (b.output) out.push('<output_format>\n' + b.output + '\n</output_format>');
  if (b.constraints.length) {
    out.push('<constraints>\n' + b.constraints.map(function (c) { return '- ' + c; }).join('\n') + '\n</constraints>');
  }
  if (p.complexity === 'high') {
    out.push('Work through the material in <scratchpad> tags first, then give the finished product in <answer> tags. If something required is missing from the source, say so inside <gaps> tags rather than filling it in.');
  } else {
    out.push('If something required is missing from the source, name the gap instead of filling it in.');
  }
  return out.join('\n\n');
}

function composeChatGPT(p) {
  var b = blocks(p), out = [];
  if (b.role) out.push('# Role\n' + b.role);
  if (b.context) out.push('# Context\n' + b.context);
  if (b.steps.length) out.push('# Task\n' + b.steps.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n'));
  if (b.output) out.push('# Output format\n' + b.output);
  if (b.constraints.length) out.push('# Rules\n' + b.constraints.map(function (c) { return '- ' + c; }).join('\n'));
  if (b.data) {
    out.push('# Source material\n' + b.data + '\n\n[Paste the material here, or upload the file.]');
    out.push('If the source is a spreadsheet or CSV, upload the file and use the data analysis tool rather than reading it by eye: load it, report the row and column counts, show the code you ran, and state any rows you dropped.');
  }
  if (p.complexity === 'high') {
    out.push('Before you start, ask me up to three clarifying questions if anything material is missing. Otherwise begin.');
  }
  return out.join('\n\n');
}

function composeGemini(p) {
  var b = blocks(p), out = [], head = [];
  if (b.data) {
    out.push('SOURCE MATERIAL\n<<<\n' + b.data + '\n\n[Paste the full text here, or attach the files. Long documents are fine — do not summarize before pasting.]\n>>>');
  }
  head.push('TASK BRIEF');
  if (b.role) head.push('Role: ' + b.role);
  if (b.context) head.push('Context: ' + b.context);
  if (b.steps.length) head.push('Do this, in order:\n' + b.steps.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n'));
  if (b.output) head.push('Output format: ' + b.output);
  if (b.constraints.length) head.push('Rules:\n' + b.constraints.map(function (c) { return '- ' + c; }).join('\n'));
  out.push(head.join('\n\n'));
  if (b.data) {
    out.push('For every factual statement, cite where in the source material it came from (section heading, page, or line). If the source does not support a statement, leave it out and list it under "Not found in source".');
    out.push('REMINDER: ' + (b.steps[0] || b.role || 'Follow the task brief above.') + ' Follow the output format exactly.');
  }
  return out.join('\n\n');
}

function compose(p, model) {
  if (model === 'chatgpt') return composeChatGPT(p);
  if (model === 'gemini') return composeGemini(p);
  return composeClaude(p);
}

/* ------------------------------------------------------------------
   Search and filtering
------------------------------------------------------------------ */
function haystack(p) {
  if (p._hay) return p._hay;
  var parts = [p.title, p.summary, (p.tags || []).join(' '), catLabel(p.category), p.complexity];
  var credit = attribution(p);
  if (credit.author) parts.push(credit.author.name);
  if (credit.license) parts.push(credit.license.name);
  (p.functions || []).forEach(function (f) { parts.push(fnMeta(f).label); });
  var b = p.blocks || {};
  parts.push(b.role, b.context, b.output, (b.steps || []).join(' '), (b.constraints || []).join(' '));
  var h = parts.join(' ').toLowerCase();
  try { Object.defineProperty(p, '_hay', { value: h, enumerable: false }); } catch (e) { p._hay = h; }
  return h;
}

/* Weighted ranking: title 10, tags/category/function 5, everything else 1,
   per search term. Every term still has to match somewhere, so a two-word
   query narrows rather than widens; the weights decide the order. */
function metaText(p) {
  if (p._meta) return p._meta;
  var m = [(p.tags || []).join(' '), catLabel(p.category)]
    .concat((p.functions || []).map(function (f) { return fnMeta(f).label; }))
    .join(' ').toLowerCase();
  try { Object.defineProperty(p, '_meta', { value: m, enumerable: false }); } catch (e) { p._meta = m; }
  return m;
}
function scoreFor(p, terms) {
  var title = (p.title || '').toLowerCase();
  var meta = metaText(p);
  var body = haystack(p);
  var total = 0;
  for (var i = 0; i < terms.length; i++) {
    var t = terms[i], s = 0;
    if (title.indexOf(t) !== -1) s += 10;
    if (meta.indexOf(t) !== -1) s += 5;
    if (body.indexOf(t) !== -1) s += 1;
    if (!s) return 0;
    total += s;
  }
  return total;
}
function activeCollection() {
  if (!S.coll) return null;
  return S.collections.filter(function (c) { return c.id === S.coll; })[0] || null;
}

function visible() {
  var terms = S.q.toLowerCase().split(/\s+/).filter(Boolean);
  var coll = activeCollection();
  var order = coll ? coll.prompts : null;
  var scores = {};
  var list = prompts().filter(function (p) {
    if (S.view === 'favorites' && S.favorites.indexOf(p.id) === -1) return false;
    if (S.view === 'mine' && p.source !== 'user' && !p.edited) return false;
    if (S.view === 'recent' && S.recents.indexOf(p.id) === -1) return false;
    if (order && order.indexOf(p.id) === -1) return false;
    if (S.fn.length && !(p.functions || []).some(function (f) { return S.fn.indexOf(f) !== -1; })) return false;
    if (S.cat.length && S.cat.indexOf(p.category) === -1) return false;
    if (S.cx.length && S.cx.indexOf(p.complexity) === -1) return false;
    if (terms.length) {
      var sc = scoreFor(p, terms);
      if (!sc) return false;
      scores[p.id] = sc;
    }
    return true;
  });
  return list.sort(function (a, b) {
    if (terms.length && scores[a.id] !== scores[b.id]) return scores[b.id] - scores[a.id];
    if (order) return order.indexOf(a.id) - order.indexOf(b.id);
    if (S.view === 'recent') return S.recents.indexOf(a.id) - S.recents.indexOf(b.id);
    return a.title.localeCompare(b.title);
  });
}

/* ------------------------------------------------------------------
   Drawer
------------------------------------------------------------------ */
function countBy(pred) { return prompts().filter(pred).length; }

function renderDrawer() {
  var all = prompts();
  var h = [];

  h.push('<h2>Library views</h2>');
  var views = [
    ['all', 'All prompts', all.length],
    ['favorites', 'Favorites', S.favorites.length],
    ['mine', 'Created & edited', all.filter(function (p) { return p.source === 'user' || p.edited; }).length],
    ['recent', 'Recently used', S.recents.length]
  ];
  views.forEach(function (v) {
    h.push('<button class="filt" type="button" data-view="' + v[0] + '" aria-pressed="' + (S.view === v[0]) + '">' +
      '<span>' + esc(v[1]) + '</span><span class="count">' + v[2] + '</span></button>');
  });

  // Every facet below collapses. An active filter inside a collapsed section
  // still shows as a count on its header so nothing is hidden silently.
  var collapsed = S.settings.collapsed || {};
  function sectionHead(id, label, activeCount) {
    var open = !collapsed[id];
    return '<button class="sect" type="button" data-sect="' + id + '" aria-expanded="' + open + '">' +
      '<span>' + esc(label) + '</span>' +
      (!open && activeCount ? '<span class="count on">' + activeCount + ' on</span>' : '') +
      icon('chev', 14) + '</button>';
  }

  if (S.collections.length) {
    h.push(sectionHead('coll', 'Collections', S.coll ? 1 : 0));
    if (!collapsed.coll) {
      S.collections.forEach(function (c) {
        var n = c.prompts.filter(function (id) { return byId(id); }).length;
        h.push('<button class="filt" type="button" data-coll="' + esc(c.id) + '" aria-pressed="' + (S.coll === c.id) + '" title="' + esc(c.description || '') + '">' +
          '<span>' + esc(c.title) + '</span><span class="count">' + n + '</span></button>');
      });
    }
  }

  h.push(sectionHead('fn', 'Domains & functions', S.fn.length));
  if (!collapsed.fn) {
    S.taxonomy.functions.forEach(function (f) {
      var n = countBy(function (p) { return (p.functions || []).indexOf(f.id) !== -1; });
      h.push('<button class="filt" type="button" data-fn="' + f.id + '" aria-pressed="' + (S.fn.indexOf(f.id) !== -1) + '">' +
        '<span class="tab" style="background:' + f.tab + '"></span><span>' + esc(f.label) + '</span>' +
        '<span class="count">' + n + '</span></button>');
    });
  }

  h.push(sectionHead('cat', 'Task type', S.cat.length));
  if (!collapsed.cat) {
    S.taxonomy.categories.forEach(function (c) {
      var n = countBy(function (p) { return p.category === c.id; });
      h.push('<button class="filt" type="button" data-cat="' + c.id + '" aria-pressed="' + (S.cat.indexOf(c.id) !== -1) + '">' +
        '<span>' + esc(c.label) + '</span><span class="count">' + n + '</span></button>');
    });
  }

  h.push(sectionHead('cx', 'Prompt complexity', S.cx.length));
  if (!collapsed.cx) {
    ['low', 'medium', 'high'].forEach(function (cx) {
      var n = countBy(function (p) { return p.complexity === cx; });
      h.push('<button class="filt" type="button" data-cx="' + cx + '" aria-pressed="' + (S.cx.indexOf(cx) !== -1) + '">' +
        '<span>' + cx.charAt(0).toUpperCase() + cx.slice(1) + '</span><span class="count">' + n + '</span></button>');
    });
  }

  h.push('<div class="tools">');
  h.push('<button class="linkish" type="button" data-act="new">' + icon('plus', 14) + 'Write a new prompt</button>');
  h.push('<button class="linkish" type="button" data-act="guide">' + icon('guide', 14) + 'Model tuning guide</button>');
  h.push('<button class="linkish" type="button" data-act="about">' + icon('info', 14) + 'About this cookbook</button>');
  h.push('<button class="linkish" type="button" data-act="export-mine">' + icon('down', 14) + 'Back up my prompts</button>');
  h.push('<button class="linkish" type="button" data-act="export-all">' + icon('down', 14) + 'Export full prompts.json</button>');
  h.push('<button class="linkish" type="button" data-act="import">' + icon('up', 14) + 'Restore from a backup</button>');
  if (S.hidden.length) h.push('<button class="linkish" type="button" data-act="unhide">Restore ' + S.hidden.length + ' archived</button>');
  h.push('</div>');

  el('drawer').innerHTML = h.join('');
}

/* ------------------------------------------------------------------
   Index list
------------------------------------------------------------------ */
function notches(cx) {
  var n = cx === 'high' ? 3 : cx === 'medium' ? 2 : 1;
  var s = '<span class="notches" title="' + cx + ' effort" aria-label="' + cx + ' effort">';
  for (var i = 1; i <= 3; i++) s += '<i class="' + (i <= n ? '' : 'off') + '"></i>';
  return s + '</span>';
}

function renderIndex() {
  var list = visible();
  var h = [];
  var filtered = S.q || S.fn.length || S.cat.length || S.cx.length || S.view !== 'all';

  h.push('<div class="index-head"><span>' + list.length + (list.length === 1 ? ' prompt available' : ' prompts available') + '</span>' +
    (filtered ? '<button class="chip" type="button" data-act="clear">Reset filters</button>' : '') + '</div>');

  if (!list.length) {
    h.push('<div class="empty"><strong>Nothing matches yet.</strong>' +
      (S.view === 'favorites'
        ? 'Star a prompt from the index and it lands here for next time.'
        : 'Try a shorter search, or clear the filters in the left rail. You can also write a new prompt for this task and keep it in your own library.') +
      '</div>');
  }

  list.forEach(function (p) {
    var f = fnMeta((p.functions || [])[0]);
    var isFav = S.favorites.indexOf(p.id) !== -1;
    h.push(
      '<div class="row" role="button" tabindex="0" data-id="' + esc(p.id) + '" aria-current="' + (S.selected === p.id) + '">' +
      '<span class="rowtab" style="background:' + f.tab + '"></span>' +
      '<span class="rowbody">' +
      '<h3>' + esc(p.title) + '</h3>' +
      '<p>' + esc(p.summary || '') + '</p>' +
      '<span class="rowmeta">' + notches(p.complexity) +
      '<span class="pill-tag">' + esc(f.label) + '</span>' +
      '<span class="pill-tag">' + esc(catLabel(p.category)) + '</span>' +
      (p.source === 'user' ? '<span class="pill-tag state">Custom</span>'
        : (p.edited ? '<span class="pill-tag state">Modified</span>' : '')) +
      '</span></span>' +
      '<span class="rowside"><span class="star" role="button" tabindex="0" data-fav="' + esc(p.id) + '" aria-pressed="' + isFav + '" title="Favorite" aria-label="Favorite">' +
      (isFav ? '\u2605' : '\u2606') + '</span></span>' +
      '</div>'
    );
  });
  el('index').innerHTML = h.join('');
}

/* ------------------------------------------------------------------
   Reader
------------------------------------------------------------------ */
function markPlaceholders(text) {
  return esc(text).replace(/\{\{([A-Z0-9_]+)\}\}/g, function (w, k) {
    return '<mark>{{' + esc(k) + '}}</mark>';
  });
}

function fieldHtml(p, k, meta) {
  var id = 'f-' + esc(k), val = valueFor(p, k), control;
  var attrs = 'id="' + id + '" data-key="' + esc(k) + '"';
  if (meta.type === 'select') {
    control = '<select ' + attrs + '><option value="">' + esc(meta.default ? meta.default : 'Choose\u2026') + '</option>' +
      meta.options.map(function (o) {
        return '<option value="' + esc(o) + '"' + (val === o ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('') + '</select>';
  } else if (meta.type === 'textarea') {
    control = '<textarea ' + attrs + ' rows="2" placeholder="' + esc(meta.default) + '">' + esc(val) + '</textarea>';
  } else {
    control = '<input ' + attrs + ' type="text" value="' + esc(val) + '" placeholder="' + esc(meta.default) + '">';
  }
  return '<div class="field' + (meta.type === 'textarea' ? ' tall' : '') + '"><label for="' + id + '">' + esc(meta.label) +
    (meta.scope === 'shared' ? ' <span class="scope">shared</span>' : '') + '</label>' + control + '</div>';
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(Math.max(ta.scrollHeight, 44), 320) + 'px';
}

// Role, context and rules only: the standing part of a prompt, for a Claude
// Project or ChatGPT custom instructions. Steps and output format belong
// to the task, not the workspace.
function composeSystem(p) {
  var b = blocks(p), out = [];
  if (b.role) out.push(b.role);
  if (b.context) out.push(b.context);
  if (b.constraints.length) out.push('Rules:\n' + b.constraints.map(function (c) { return '- ' + c; }).join('\n'));
  return out.join('\n\n');
}

function renderReader() {
  var r = el('reader');
  if (S.mode === 'guide') { renderGuide(); return; }
  if (S.mode === 'about') { renderAbout(); return; }
  if (S.mode === 'edit') { renderEditor(); return; }

  var p = S.selected ? byId(S.selected) : null;
  if (!p) {
    r.innerHTML = '<div class="reader-inner"><div class="empty"><strong>Pick a prompt.</strong>' +
      'Choose one from the index and it opens here, already shaped for ' + MODELS[S.settings.model].label +
      '. Fill in the fields, copy, paste.</div></div>';
    return;
  }

  var model = MODELS[S.settings.model];
  var keys = collectKeys(p);
  var text = compose(p, S.settings.model);
  var level = effectiveSensitivity(p);
  var sens = S.taxonomy.sensitivity[level];
  var isFav = S.favorites.indexOf(p.id) !== -1;
  var h = [];

  h.push('<div class="reader-inner">');

  /* --- header block: title, lede, badges, actions --- */
  h.push('<div class="reader-header">');
  h.push('<button class="chip backlink" type="button" data-act="back">Back to prompt list</button>');
  h.push('<h1>' + esc(p.title) + '</h1>');
  h.push('<p class="lede">' + esc(p.summary || '') + '</p>');

  h.push('<div class="badges">');
  (p.functions || []).forEach(function (f) {
    var fm = fnMeta(f);
    h.push('<span class="badge"><b style="background:' + fm.tab + '"></b>' + esc(fm.label) + '</span>');
  });
  h.push('<span class="badge">' + esc(catLabel(p.category)) + '</span>');
  h.push('<span class="badge">' + esc(p.complexity) + ' complexity</span>');
  (p.tags || []).forEach(function (t) { h.push('<span class="badge">#' + esc(t) + '</span>'); });
  h.push('</div>');

  if (level !== 'none') {
    h.push('<div class="sens">' + icon('shield', 15) + '<span>' + esc(sens) +
      (sensitivityIsAuto(p) ? ' <span class="micro">Set from the material this prompt takes</span>' : '') +
      '</span></div>');
  }

  h.push('<div class="toolbar">');
  h.push('<button class="btn" type="button" data-act="copy">' + icon('copy', 14) + 'Copy for ' + model.label + '</button>');
  h.push('<button class="btn ghost" type="button" data-act="open-claude">' + icon('ext') + 'Open in Claude</button>');
  h.push('<button class="btn ghost" type="button" data-act="open-chatgpt">' + icon('ext') + 'Open in ChatGPT</button>');
  h.push('<button class="btn ghost" type="button" data-act="copy-system" title="Role, context and rules only \u2014 for a Claude Project or ChatGPT custom instructions">' + icon('sys') + 'Copy as system prompt</button>');
  h.push('</div>');

  var tips = p.models || {};
  var tipKeys = Object.keys(MODELS).filter(function (k) { return tips[k]; });
  if (tipKeys.length) {
    h.push('<dl class="model-tips">');
    tipKeys.forEach(function (k) {
      h.push('<div class="' + (k === S.settings.model ? 'on' : '') + '"><dt class="micro">' + esc(MODELS[k].label) + '</dt><dd>' + esc(tips[k]) + '</dd></div>');
    });
    h.push('</dl>');
  }

  h.push('<div class="toolbar secondary">');
  h.push('<button class="btn ghost" type="button" data-act="fav">' + (isFav ? '\u2605 Saved to favorites' : '\u2606 Add to favorites') + '</button>');
  h.push('<button class="btn ghost" type="button" data-act="edit">' + icon('edit') + 'Customize</button>');
  h.push('<button class="btn ghost" type="button" data-act="duplicate">' + icon('dup') + 'Duplicate</button>');
  h.push('<button class="btn ghost" type="button" data-act="print">Print</button>');
  if (p.edited) h.push('<button class="btn ghost" type="button" data-act="revert">Restore published version</button>');
  if (p.source === 'user') h.push('<button class="btn ghost danger" type="button" data-act="delete">Delete</button>');
  h.push('</div>');
  h.push('</div>');

  /* --- fill-in fields --- */
  if (keys.length) {
    h.push('<div class="panel"><div class="panel-head">' + icon('vars', 14) +
      '<span class="micro">Template variables</span></div><div class="panel-body">');
    var anyShared = false;
    keys.forEach(function (k) {
      var meta = phMeta(p, k);
      if (meta.scope === 'shared') anyShared = true;
      h.push(fieldHtml(p, k, meta));
    });
    h.push('<p class="hint">' + (anyShared
      ? 'Fields marked shared are saved in this browser and reused by every prompt that asks for them. The rest clear when this tab closes.'
      : 'These clear when this tab closes. Nothing pasted here is kept.') + '</p>');
    h.push('</div></div>');
  }

  /* --- composed prompt --- */
  h.push('<div class="panel"><div class="panel-head">' + icon('code', 14) +
    '<span class="micro">Composed prompt</span>' +
    '<span class="micro right">' + esc(model.arch) + '</span></div>');
  h.push('<pre class="compose" id="composed">' + markPlaceholders(text) + '</pre>');
  h.push('<p class="placeholder-note">' + icon('info') + esc(model.note) + '</p>');
  h.push('</div>');

  var credit = attribution(p);
  var related = (p.related || []).map(byId).filter(Boolean);
  if (p.notes || credit.author || credit.license || related.length) {
    h.push('<footer>');
    if (related.length) {
      h.push('<p class="usenext"><span class="micro">Use next</span>' +
        related.map(function (rp) {
          return '<button class="chip next" type="button" data-act="goto" data-id="' + esc(rp.id) + '">' +
            esc(rp.title) + ' ' + icon('next', 12) + '</button>';
        }).join('') + '</p>');
    }
    if (p.notes) h.push('<p><strong>Staff note.</strong> ' + esc(p.notes) + '</p>');
    if (credit.author || credit.license) {
      var line = [];
      if (credit.author) line.push(partyHtml(credit.author, 'Written by'));
      if (credit.license) line.push(partyHtml(credit.license, 'Licensed'));
      h.push('<p class="attrib"><span class="micro">Attribution</span>' + line.join(' &middot; ') + '</p>');
    }
    h.push('</footer>');
  }
  h.push('</div>');
  r.innerHTML = h.join('');
  r.querySelectorAll('textarea[data-key]').forEach(autosize);
  r.scrollTop = 0;
}

/* ------------------------------------------------------------------
   Editor
------------------------------------------------------------------ */
function blankPrompt() {
  return {
    id: 'user-' + Date.now().toString(36),
    title: '', summary: '', functions: [S.taxonomy.functions[0].id],
    category: S.taxonomy.categories[0].id, complexity: 'medium',
    sensitivity: 'none', source: 'user', tags: [],
    author: S.settings.author ? JSON.parse(JSON.stringify(S.settings.author)) : null,
    blocks: { role: '', context: '', steps: [], output: '', constraints: [], data: '' },
    placeholders: [], notes: ''
  };
}

function placeholderTableHtml(p) {
  var keys = collectKeys(p);
  var h = ['<div class="ph-head"><label>Variables found in the text</label>' +
    '<button class="chip" type="button" data-act="detect">Rescan the text</button></div>'];
  if (!keys.length) {
    h.push('<p class="hint">No {{VARIABLES}} yet.</p>');
    return h.join('');
  }
  h.push('<div class="ph-table"><div class="ph-row head">' +
    '<span>Variable</span><span>Label</span><span>Scope</span><span>Input</span><span>Default</span><span>Choices</span></div>');
  keys.forEach(function (k) {
    var m = phMeta(p, k);
    h.push('<div class="ph-row" data-ph-key="' + esc(k) + '">' +
      '<code>' + esc(k) + '</code>' +
      '<input class="ph-label" type="text" value="' + esc(m.label) + '">' +
      '<select class="ph-scope">' +
        '<option value="prompt"' + (m.scope === 'prompt' ? ' selected' : '') + '>This prompt</option>' +
        '<option value="shared"' + (m.scope === 'shared' ? ' selected' : '') + '>Shared</option></select>' +
      '<select class="ph-type">' +
        '<option value="text"' + (m.type === 'text' ? ' selected' : '') + '>Text</option>' +
        '<option value="textarea"' + (m.type === 'textarea' ? ' selected' : '') + '>Multi-line</option>' +
        '<option value="select"' + (m.type === 'select' ? ' selected' : '') + '>Choices</option></select>' +
      '<input class="ph-default" type="text" value="' + esc(m.default) + '">' +
      '<input class="ph-options" type="text" placeholder="one, two, three" value="' + esc((m.options || []).join(', ')) + '">' +
      '</div>');
  });
  h.push('</div>');
  h.push('<p class="hint">Shared variables are saved in the browser and reused by every prompt that asks for the same one \u2014 board name, county, funding stream. Everything else clears when the tab closes.</p>');
  return h.join('');
}

function readPlaceholderTable(p) {
  var rows = document.querySelectorAll('.ph-row[data-ph-key]');
  var out = [];
  rows.forEach(function (row) {
    var key = row.dataset.phKey;
    var type = row.querySelector('.ph-type').value;
    var options = row.querySelector('.ph-options').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    var def = {
      key: key,
      label: row.querySelector('.ph-label').value.trim() || key.replace(/_/g, ' ').toLowerCase(),
      default: row.querySelector('.ph-default').value,
      scope: row.querySelector('.ph-scope').value === 'shared' ? 'shared' : 'prompt'
    };
    if (type === 'select' && options.length) def.options = options;
    else if (type === 'textarea') def.type = 'textarea';
    out.push(def);
  });
  // keep declared metadata for tokens the table did not show (none today, but
  // an import can declare a key before the text uses it)
  (p.placeholders || []).forEach(function (x) {
    if (!out.some(function (o) { return o.key === x.key; })) out.push(x);
  });
  return out;
}

function renderEditor() {
  var p = S.draft;
  var h = ['<div class="editor">'];
  h.push('<h1>' + (p.source === 'user' && !byId(p.id) ? 'New prompt' : 'Edit prompt') + '</h1>');
  h.push('<p class="lede">Edits live in this browser only. Back them up or export a full prompts.json to share them with the team.</p>');

  h.push('<label for="e-title">Title</label><input id="e-title" type="text" value="' + esc(p.title) + '">');
  h.push('<label for="e-summary">One-line summary</label><input id="e-summary" type="text" value="' + esc(p.summary) + '">');

  h.push('<div class="two"><div><label for="e-fn">Job function</label><select id="e-fn">');
  S.taxonomy.functions.forEach(function (f) {
    h.push('<option value="' + f.id + '"' + ((p.functions || [])[0] === f.id ? ' selected' : '') + '>' + esc(f.label) + '</option>');
  });
  h.push('</select></div><div><label for="e-cat">Task category</label><select id="e-cat">');
  S.taxonomy.categories.forEach(function (c) {
    h.push('<option value="' + c.id + '"' + (p.category === c.id ? ' selected' : '') + '>' + esc(c.label) + '</option>');
  });
  h.push('</select></div></div>');

  h.push('<div class="two"><div><label for="e-cx">Effort</label><select id="e-cx">');
  ['low', 'medium', 'high'].forEach(function (c) {
    h.push('<option value="' + c + '"' + (p.complexity === c ? ' selected' : '') + '>' + c + '</option>');
  });
  h.push('</select></div><div><label for="e-sens">Participant data</label><select id="e-sens">');
  var sensValue = p.sensitive === false ? 'off' : (p.sensitivity || 'none');
  h.push('<option value="none"' + (sensValue === 'none' ? ' selected' : '') + '>Decide from the material it takes (default)</option>');
  Object.keys(S.taxonomy.sensitivity).forEach(function (k) {
    if (k === 'none') return;
    h.push('<option value="' + k + '"' + (sensValue === k ? ' selected' : '') + '>' + esc(S.taxonomy.sensitivity[k]) + '</option>');
  });
  h.push('<option value="off"' + (sensValue === 'off' ? ' selected' : '') + '>No banner, even if it takes pasted material</option>');
  h.push('</select></div></div>');

  h.push('<label for="e-tags">Tags, comma separated</label><input id="e-tags" type="text" value="' + esc((p.tags || []).join(', ')) + '">');

  var pAuthor = asParty(p.author, 'name') || { name: '', url: '' };
  var pLicense = asParty(p.license, 'id') || { name: '', url: '' };
  var dAuthor = asParty(S.defaults.author, 'name');
  var dLicense = asParty(S.defaults.license, 'id');

  h.push('<div class="two"><div><label for="e-author">Author</label>' +
    '<input id="e-author" type="text" value="' + esc(pAuthor.name) + '" placeholder="' +
    esc(dAuthor ? dAuthor.name : 'Name or organization') + '"></div>' +
    '<div><label for="e-author-url">Author link, optional</label>' +
    '<input id="e-author-url" type="text" value="' + esc(pAuthor.url) + '" placeholder="https://"></div></div>');

  h.push('<div class="two"><div><label for="e-license">License</label>' +
    '<input id="e-license" type="text" list="license-ids" value="' + esc(pLicense.name) + '" placeholder="' +
    esc(dLicense ? dLicense.name : 'CC-BY-4.0') + '"></div>' +
    '<div><label for="e-license-url">License link, optional</label>' +
    '<input id="e-license-url" type="text" value="' + esc(pLicense.url) + '" placeholder="filled in for known licenses"></div></div>');

  h.push('<datalist id="license-ids">');
  ((S.taxonomy.licenses) || []).forEach(function (l) {
    h.push('<option value="' + esc(l.id) + '"></option>');
  });
  h.push('</datalist>');

  var inherit = [];
  if (dAuthor) inherit.push(dAuthor.name);
  if (dLicense) inherit.push(dLicense.name);
  if (inherit.length) {
    h.push('<p class="hint">Leave either blank to inherit the collection default: ' + esc(inherit.join(', ')) + '.</p>');
  }
  h.push('<label for="e-role">Role — who the model is acting as</label><textarea id="e-role" rows="3">' + esc(p.blocks.role) + '</textarea>');
  h.push('<label for="e-context">Context — what it needs to know about our setting</label><textarea id="e-context" rows="3">' + esc(p.blocks.context) + '</textarea>');
  h.push('<label for="e-steps">Steps — one per line</label><textarea id="e-steps" rows="7">' + esc((p.blocks.steps || []).join('\n')) + '</textarea>');
  h.push('<label for="e-output">Output format</label><textarea id="e-output" rows="4">' + esc(p.blocks.output) + '</textarea>');
  h.push('<label for="e-constraints">Rules — one per line</label><textarea id="e-constraints" rows="5">' + esc((p.blocks.constraints || []).join('\n')) + '</textarea>');
  h.push('<label for="e-data">Source material line — what the user pastes or attaches</label><textarea id="e-data" rows="2">' + esc(p.blocks.data) + '</textarea>');
  h.push('<label for="e-notes">Staff notes</label><textarea id="e-notes" rows="2">' + esc(p.notes || '') + '</textarea>');

  h.push('<label for="e-related">Use next \u2014 ids of prompts that follow this one, comma separated</label>' +
    '<input id="e-related" type="text" list="prompt-ids" value="' + esc((p.related || []).join(', ')) + '">');
  h.push('<datalist id="prompt-ids">');
  prompts().forEach(function (x) { if (x.id !== p.id) h.push('<option value="' + esc(x.id) + '">' + esc(x.title) + '</option>'); });
  h.push('</datalist>');

  var tips = p.models || {};
  h.push('<label>Model-specific tips, shown under the action buttons</label><div class="two three">');
  Object.keys(MODELS).forEach(function (k) {
    h.push('<input id="e-tip-' + k + '" type="text" placeholder="' + esc(MODELS[k].label) + '" value="' + esc(tips[k] || '') + '">');
  });
  h.push('</div>');

  h.push(placeholderTableHtml(p));

  h.push('<p class="placeholder-note">Write reusable fields as {{LIKE_THIS}} anywhere above. They become fill-in boxes for everyone.</p>');

  h.push('<div class="toolbar" style="margin-top:20px">');
  h.push('<button class="btn" type="button" data-act="save">Save prompt</button>');
  h.push('<button class="btn ghost" type="button" data-act="cancel">Cancel</button>');
  h.push('</div></div>');
  el('reader').innerHTML = h.join('');
  document.body.classList.add('reading');
}

function readEditor() {
  var p = S.draft;
  p.title = el('e-title').value.trim();
  p.summary = el('e-summary').value.trim();
  p.functions = [el('e-fn').value];
  p.category = el('e-cat').value;
  p.complexity = el('e-cx').value;
  var sensChoice = el('e-sens').value;
  if (sensChoice === 'off') { p.sensitivity = 'none'; p.sensitive = false; }
  else { p.sensitivity = sensChoice; delete p.sensitive; }
  p.tags = el('e-tags').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  p.blocks = {
    role: el('e-role').value.trim(),
    context: el('e-context').value.trim(),
    steps: el('e-steps').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
    output: el('e-output').value.trim(),
    constraints: el('e-constraints').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
    data: el('e-data').value.trim()
  };
  p.notes = el('e-notes').value.trim();

  p.related = el('e-related').value.split(',').map(function (x) { return x.trim(); })
    .filter(function (x) { return x && x !== p.id && byId(x); });
  if (!p.related.length) delete p.related;

  var models = {};
  Object.keys(MODELS).forEach(function (k) {
    var v = el('e-tip-' + k).value.trim();
    if (v) models[k] = v;
  });
  if (Object.keys(models).length) p.models = models; else delete p.models;

  p.placeholders = readPlaceholderTable(p);

  var authorName = el('e-author').value.trim();
  var authorUrl = el('e-author-url').value.trim();
  p.author = authorName ? (authorUrl ? { name: authorName, url: authorUrl } : { name: authorName }) : null;
  if (!p.author) delete p.author;

  var licenseId = el('e-license').value.trim();
  var licenseUrlValue = el('e-license-url').value.trim() || licenseUrl(licenseId);
  p.license = licenseId ? (licenseUrlValue ? { id: licenseId, url: licenseUrlValue } : { id: licenseId }) : null;
  if (!p.license) delete p.license;

  return p;
}

function saveDraft() {
  var p = readEditor();
  if (!p.title) { toast('Give the prompt a title before saving.', true); return; }
  if (p.author) {
    S.settings.author = p.author;
    save(LS.settings, S.settings);
  }
  var isBase = S.base.some(function (b) { return b.id === p.id; });
  if (isBase) {
    S.overrides[p.id] = p;
    save(LS.over, S.overrides);
  } else {
    var i = -1;
    S.custom.forEach(function (c, idx) { if (c.id === p.id) i = idx; });
    if (i === -1) S.custom.push(p); else S.custom[i] = p;
    save(LS.custom, S.custom);
  }
  S.mode = 'read'; S.selected = p.id;
  renderAll();
  toast('Saved to this browser.');
}

/* ------------------------------------------------------------------
   Guide
------------------------------------------------------------------ */
function renderGuide() {
  var h = [];
  h.push('<div class="guide">');
  h.push('<button class="chip backlink" type="button" data-act="back">Back to prompt list</button>');
  h.push('<h1>Tuning a prompt for each model</h1>');
  h.push('<p>Every prompt in this cookbook is stored as parts: a role, the context, the steps, the output format, the rules, and a slot for source material. The Claude, ChatGPT, and Gemini buttons do not rewrite the prompt — they lay the same parts out the way each model handles best. What follows is what those buttons are doing, so you can do it by hand in a chat window when you need to.</p>');

  h.push('<div class="card stale"><h3>Check the model names before you rely on them</h3>' +
    '<p>Model lineups turn over every few months. As of September 2026, Anthropic is shipping Claude Opus 5 and Sonnet 5; OpenAI is on GPT-6 Astra with the GPT-5.6 family beneath it, and GPT-4o was retired in February 2026; Google has Gemini 3.1 Pro alongside the faster 3.8 Flash. The habits below outlive the version numbers, which is why they are written as habits.</p></div>');

  h.push('<h2>Context engineering</h2>');
  h.push('<p>Wording matters less than what you put in front of the model. Anthropic describes the shift as moving from finding the right words toward deciding what configuration of context is most likely to produce the behavior you want, and defines context engineering as curating and maintaining the best set of information available to the model during inference \u2014 not just the prompt itself.</p>');
  h.push('<table><thead><tr><th>Instead of only\u2026</th><th>Add context such as\u2026</th></tr></thead><tbody>' +
    '<tr><td>Write a summary</td><td>Audience, purpose, length, tone, source text, what to emphasize</td></tr>' +
    '<tr><td>Make quiz questions</td><td>Learning goals, student level, prior lesson content, question style</td></tr>' +
    '<tr><td>Improve this script</td><td>Target audience, constraints, examples of preferred style, what not to change</td></tr>' +
    '<tr><td>Find problems with this idea</td><td>Your goals, risks you care about, institutional context, decision criteria</td></tr>' +
    '</tbody></table>');
  h.push('<p>The prompts in this cookbook are context engineering with the blanks already drawn: the role says who the model is being, the context carries the standing facts about our setting, the rules say what not to do, and the source material slot is where the evidence goes. When you write your own, the parts you are tempted to leave out \u2014 who reads this, what it is for, what must not change \u2014 are usually the parts doing the work.</p>');
  h.push('<p>The same idea applies across a whole session. A Project or a Gem holding your board name, your funding streams, and your local policies is context you stop re-typing. A long thread that has drifted through three unrelated tasks is context working against you; start a new one.</p>');
  h.push('<p class="source">The context engineering section above is adapted from the Student Guide to Generative AI. Attribution: \u201cUniversity of Arizona Libraries, \u00a9 2026 The Arizona Board of Regents on behalf of The University of Arizona, licensed under a <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">Creative Commons Attribution 4.0 International License</a>.\u201d <a href="https://libguides.library.arizona.edu/students-chatgpt/use" target="_blank" rel="noopener">Original guide</a>. The Anthropic framing it cites is in <a href="https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents" target="_blank" rel="noopener">Effective context engineering for AI agents</a>.</p>');

  h.push('<h2>The CLEAR framework</h2>');
  h.push('<p>CLEAR, from librarian Leo S. Lo at the University of New Mexico, is five tests to run a prompt against before blaming the model for the answer. It is the shortest useful checklist we have found, and it maps onto how the prompts here are built.</p>');
  h.push('<ul>' +
    '<li><strong>Concise</strong> \u2014 brevity and clarity in prompts. Cut the throat-clearing, keep the specifics. Length is not the enemy; vagueness is. \u201cReview this policy\u201d is short and useless. \u201cList every requirement this policy places on the subrecipient and mark each one met, partly met, or not addressed\u201d is longer and does the job.</li>' +
    '<li><strong>Logical</strong> \u2014 structured and coherent prompts. Put the instructions in the sequence you want them carried out, one idea per step. If you would not hand the list to a new hire in that order, the model will not follow it in that order either.</li>' +
    '<li><strong>Explicit</strong> \u2014 clear output specifications. Name the format, the length, the sections, and what must not appear. \u201cA table with columns Finding, Criteria, Status, then a short list of open questions\u201d beats \u201csummarize the findings\u201d every time, and it makes a wrong answer obvious at a glance.</li>' +
    '<li><strong>Adaptive</strong> \u2014 flexibility and customization. If the answer is generic, change the framing rather than adding adjectives: give it a role, show an example of what good looks like, ask for three options instead of one, or ask it to argue the opposite case. The model buttons above each prompt are this test applied to structure.</li>' +
    '<li><strong>Reflective</strong> \u2014 continuous evaluation and improvement. When an answer disappoints, the useful question is which part of the prompt permitted it. Missing constraint? Unstated audience? No format? Fix that part and keep the fixed version. A prompt that has been through this loop three times is worth adding to this cookbook; one that has not usually is not.</li>' +
    '</ul>');
  h.push('<p>Run the loop on a real task rather than a test one. A prompt tuned against a made-up example fails the first time it meets an actual monitoring finding.</p>');
  h.push('<p>There is a prompt for this too: <strong>Build a better prompt with a prompt engineering coach</strong> turns the model into the thing that interviews you and drafts it.</p>');
  h.push('<p class="source">Lo, L. S. (2023). The CLEAR path: A framework for enhancing information literacy through prompt engineering. <em>The Journal of Academic Librarianship</em>, 49(4). The five short definitions are Lo\u2019s; the examples are ours.</p>');

  h.push('<h2>Claude — say what the parts are</h2>');
  h.push('<p>Claude follows structure that is explicitly marked. Wrapping each part of a prompt in a tag makes it much harder for the model to blur your source document into your instructions, which is the usual failure on a long policy review or a grant evaluation. Tag names are yours to choose; they just have to be consistent.</p>');
  h.push('<pre>&lt;role&gt;You are a compliance analyst for a local workforce board.&lt;/role&gt;\n\n&lt;source_material&gt;\n[paste the directive or the subrecipient policy here]\n&lt;/source_material&gt;\n\n&lt;instructions&gt;\n1. List every requirement the policy places on the subrecipient.\n2. Mark each one met, partly met, or not addressed.\n&lt;/instructions&gt;\n\n&lt;output_format&gt;A table, then a short list of open questions.&lt;/output_format&gt;</pre>');
  h.push('<ul>' +
    '<li>Put long documents <em>before</em> the instructions. Accuracy on long inputs improves when the question comes after the material.</li>' +
    '<li>For anything scored or evaluative, ask for reasoning in a <code>&lt;scratchpad&gt;</code> and the deliverable in <code>&lt;answer&gt;</code>, then read the scratchpad to check the logic before you trust the answer.</li>' +
    '<li>Keep recurring context — the board name, the funding streams, the local policies — in a Project so you are not re-pasting it every session. <strong>Copy as system prompt</strong> on any prompt gives you exactly that standing part \u2014 role, context and rules, without the task steps.</li>' +
    '</ul>');

  h.push('<h2>ChatGPT — set the standing context, then hand it the file</h2>');
  h.push('<p>ChatGPT reads markdown headings cleanly, so numbered steps under <code>#&nbsp;Task</code> are enough structure for most work. The larger win is the two features around the chat box.</p>');
  h.push('<ul>' +
    '<li><strong>Custom instructions</strong> hold the things you would otherwise type every time: that you work for a local workforce development board, that outputs are read by auditors and board members, that you want plain language and no invented figures. Set it once in settings and every chat starts there. <strong>Copy as system prompt</strong> produces the text to paste in.</li>' +
    '<li><strong>The data analysis tool</strong> should do any work involving a spreadsheet. Upload the CSV rather than pasting rows, and ask it to report row and column counts, show the code it ran, and list anything it dropped. A model reading numbers by eye will produce a plausible total that is wrong; a model running code on the file will produce one you can check.</li>' +
    '<li>For a task you repeat monthly, put the prompt and the reference files in a Project so the context comes back with it.</li>' +
    '</ul>');
  h.push('<pre># Role\nYou are an ETPL coordinator reviewing provider performance.\n\n# Task\n1. Load the attached CSV and report row and column counts.\n2. Reconcile completions against enrollments by provider.\n3. Flag any provider whose figures do not reconcile.\n\n# Rules\n- Show the code you ran.\n- Do not compute a rate that is not supported by the columns present.</pre>');

  h.push('<h2>Gemini — feed it everything, then repeat yourself</h2>');
  h.push('<p>Gemini\u2019s strength here is volume: a full Workforce Services Directive with its attachments, a stack of monitoring reports, a year of board minutes. Paste or attach the whole thing rather than summarizing first, since summarizing is what you are asking it to do.</p>');
  h.push('<ul>' +
    '<li>Put the source material first, the instruction second, and restate the instruction in one line at the very end. With a long input the closing line is what the model is holding when it starts writing.</li>' +
    '<li>Ask for a location citation on every claim — section heading, page, or line. Then spot-check three of them. This is the fastest way to catch a summary that drifted.</li>' +
    '<li>Ask it to list what it could not find in the source under a separate heading, so absence shows up as a heading instead of a quiet omission.</li>' +
    '<li>When the draft is right, export it into Docs or Sheets from Workspace rather than copying through the clipboard, which is where formatting and tables get mangled.</li>' +
    '</ul>');

  h.push('<h2>What none of the three will do for you</h2>');
  h.push('<ul>' +
    '<li>Verify a citation. If a model gives you a CFR section, a WSD number, or a directive date, open it. Confident citation formatting is not evidence.</li>' +
    '<li>Know our local policy. If it is not in the prompt, in a Project, or attached, the model is guessing at it.</li>' +
    '<li>Carry accountability. Staff sign the case note, the memo, and the CAP response. The draft is a draft.</li>' +
    '</ul>');
  h.push('</div>');
  el('reader').innerHTML = h.join('');
  el('reader').scrollTop = 0;
  document.body.classList.add('reading');
}


/* ------------------------------------------------------------------
   About
------------------------------------------------------------------ */
function renderAbout() {
  var all = prompts();
  var h = [];

  h.push('<div class="guide">');
  h.push('<button class="chip backlink" type="button" data-act="back">Back to prompt list</button>');
  h.push('<h1>About this cookbook</h1>');
  h.push('<p>A prompt library for staff at WIOA-funded local workforce development boards. ' +
    'It holds ' + all.length + ' prompts for the work that actually fills the week: case notes and service ' +
    'strategies, employer outreach, cost allocation and monitoring responses, funding announcements, ' +
    'state directives, and labor market briefs. Everything runs in the browser. There is no account, ' +
    'no server, and nothing you type here leaves your machine.</p>');

  h.push('<h2>Who built it</h2>');
  h.push('<p>Kyle Hamilton, Research Analyst and ETPL Coordinator at the ' +
    '<a href="https://workforce-connection.com" target="_blank" rel="noopener">Fresno Regional Workforce ' +
    'Development Board</a>, built this for FRWDB staff. It is shared in the hope that other local boards ' +
    'find it useful; the prompts assume WIOA Title I practice and California reporting, so expect to ' +
    'adjust the specifics for your own area.</p>');

  h.push('<h2>How it works</h2>');
  h.push('<ul>' +
    '<li>Pick a prompt, fill in the variables, choose your model, copy. Variables are saved in your browser and reused across every prompt that asks for the same thing.</li>' +
    '<li>Favorites, edits, and prompts you write yourself live in this browser only. Clearing site data clears them, so use <strong>Back up my prompts</strong> if they matter.</li>' +
    '<li>Every prompt carries an author and a license, shown in the attribution line beneath the composed prompt. Prompts that name neither inherit the collection default.</li>' +
    '<li>The three model buttons do not change what the prompt asks for. They change how it is laid out — XML tags for Claude, markdown sections for ChatGPT, source-first for Gemini. The model tuning guide explains why.</li>' +
    '</ul>');

  h.push('<div class="card"><h3>The output is a draft</h3>' +
    '<p>Every model here will produce a confident citation to a regulation that does not say what it claims, ' +
    'and a total that does not add up. Staff sign the case note, the memo, and the monitoring response. ' +
    'Check the numbers and open the citations.</p></div>');
  h.push('</div>');

  el('reader').innerHTML = h.join('');
  el('reader').scrollTop = 0;
  document.body.classList.add('reading');
}

/* ------------------------------------------------------------------
   Copy
------------------------------------------------------------------ */
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
  }
  return Promise.resolve(legacyCopy(text));
}
function legacyCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-2000px';
  document.body.appendChild(ta);
  ta.select();
  var ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}
function doCopy(btn) {
  var p = byId(S.selected);
  if (!p) return;
  var text = compose(p, S.settings.model);
  copyText(text).then(function (ok) {
    if (ok) {
      S.recents = uniq([p.id].concat(S.recents)).slice(0, 12);
      save(LS.recents, S.recents);
      if (btn) {
        btn.classList.add('copied');
        btn.innerHTML = icon('copy', 14) + 'Copied';
        setTimeout(function () {
          btn.classList.remove('copied');
          btn.innerHTML = icon('copy', 14) + 'Copy for ' + MODELS[S.settings.model].label;
        }, 1400);
      }
      toast('Copied. Paste it into ' + MODELS[S.settings.model].label + '.');
      renderDrawer();
    } else {
      toast('The browser blocked the copy. Select the prompt text and copy it manually.', true);
    }
  });
}

/* Deep links. Both services accept a prefilled draft in ?q=. Browsers and
   proxies start truncating around 2,000 characters of URL, so past that the
   prompt goes to the clipboard and the bare new-chat page opens instead. */
var DEEPLINK = {
  claude:  { prefill: 'https://claude.ai/new?q=', bare: 'https://claude.ai/new' },
  chatgpt: { prefill: 'https://chatgpt.com/?q=',  bare: 'https://chatgpt.com/' }
};
var URL_LIMIT = 2000;

function openIn(model) {
  var p = byId(S.selected);
  var link = DEEPLINK[model];
  if (!p || !link) return;
  var text = compose(p, model);
  var url = link.prefill + encodeURIComponent(text);
  var label = MODELS[model].label;
  S.recents = uniq([p.id].concat(S.recents)).slice(0, 12);
  save(LS.recents, S.recents);
  renderDrawer();
  if (url.length <= URL_LIMIT) {
    window.open(url, '_blank', 'noopener');
    toast('Opened in ' + label + ' with the prompt filled in.');
    return;
  }
  // open synchronously inside the click so popup blockers allow it
  window.open(link.bare, '_blank', 'noopener');
  copyText(text).then(function (ok) {
    if (ok) toast('Prompt copied to clipboard (exceeds URL length limit for direct prefill). Paste it into ' + label + '.');
    else toast('Too long for a prefill link, and the browser blocked the copy. Copy the prompt text manually.', true);
  });
}

function copySystemPrompt(btn) {
  var p = byId(S.selected);
  if (!p) return;
  var text = composeSystem(p);
  if (!text) { toast('This prompt has no role, context, or rules to use as a system prompt.', true); return; }
  copyText(text).then(function (ok) {
    if (!ok) { toast('The browser blocked the copy. Select the text and copy it manually.', true); return; }
    if (btn) {
      btn.classList.add('copied');
      btn.innerHTML = icon('sys') + 'Copied';
      setTimeout(function () { btn.classList.remove('copied'); btn.innerHTML = icon('sys') + 'Copy as system prompt'; }, 1400);
    }
    toast('Copied role, context and rules. Paste into a Claude Project or ChatGPT custom instructions.');
  });
}

/* ------------------------------------------------------------------
   Import / export
------------------------------------------------------------------ */
function download(name, obj) {
  var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
function exportMine() {
  download('my-prompt-vault.json', {
    kind: 'wpv-user-backup', exported: new Date().toISOString(),
    favorites: S.favorites, custom: S.custom, overrides: S.overrides,
    hidden: S.hidden, values: S.values
  });
  toast('Backup downloaded.');
}
function exportAll() {
  var merged = prompts().map(function (p) {
    var c = Object.assign({}, p); delete c.edited; return c;
  });
  download('prompts.json', {
    schema_version: '1.1', generated: new Date().toISOString().slice(0, 10),
    collection: S.collection, defaults: S.defaults, taxonomy: S.taxonomy,
    collections: S.collections, prompts: merged
  });
  toast('prompts.json downloaded. Hand it to the vault maintainer to publish.');
}
function importBackup(file) {
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var d = JSON.parse(reader.result);
      if (d.kind === 'wpv-user-backup') {
        S.favorites = uniq(S.favorites.concat(d.favorites || []));
        S.values = Object.assign({}, d.values || {}, S.values);
        S.overrides = Object.assign({}, S.overrides, d.overrides || {});
        (d.custom || []).forEach(function (c) {
          if (!S.custom.some(function (x) { return x.id === c.id; })) S.custom.push(c);
        });
        save(LS.fav, S.favorites); save(LS.values, S.values);
        save(LS.over, S.overrides); save(LS.custom, S.custom);
        renderAll();
        toast('Backup restored.');
      } else if (d.prompts) {
        S.base = d.prompts; S.taxonomy = d.taxonomy || S.taxonomy;
        renderAll();
        toast('Loaded ' + d.prompts.length + ' prompts from that file, for this session.');
      } else {
        toast('That file is not a vault backup.', true);
      }
    } catch (e) { toast('That file could not be read as JSON.', true); }
  };
  reader.readAsText(file);
}

/* ------------------------------------------------------------------
   Events
------------------------------------------------------------------ */
function renderAll() {
  document.body.classList.toggle('guide-mode', S.mode === 'guide' || S.mode === 'about');
  document.querySelectorAll('.seg button[data-model]').forEach(function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.model === S.settings.model));
  });
  applyTheme();
  renderDrawer();
  renderIndex();
  renderReader();
}

// Light unless the person has chosen dark. The OS preference is deliberately
// ignored: the app looks the same on every machine in the office until
// someone asks otherwise. A script in <head> applies the saved choice before
// first paint so dark users do not see a flash of light.
function applyTheme() {
  var theme = S.settings.theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('.seg button[data-theme-choice]').forEach(function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.themeChoice === theme));
  });
}

function clearFilters() {
  S.q = ''; el('q').value = '';
  S.fn = []; S.cat = []; S.cx = []; S.coll = null; S.view = 'all';
  renderAll();
}

function gotoPrompt(id) {
  if (!byId(id)) return;
  S.selected = id; S.mode = 'read';
  document.body.classList.add('reading');
  renderIndex(); renderReader();
  var row = document.querySelector('.row[aria-current="true"]');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

function wire() {
  el('q').addEventListener('input', function () { S.q = this.value; renderIndex(); });

  document.querySelectorAll('.seg button[data-theme-choice]').forEach(function (b) {
    b.addEventListener('click', function () {
      S.settings.theme = b.dataset.themeChoice === 'dark' ? 'dark' : 'light';
      save(LS.settings, S.settings);
      applyTheme();
    });
  });

  document.querySelectorAll('.seg button[data-model]').forEach(function (b) {
    b.addEventListener('click', function () {
      S.settings.model = b.dataset.model;
      save(LS.settings, S.settings);
      renderAll();
    });
  });

  // Optional chrome: the shell can drop these without taking the app down.
  var toggle = el('drawerToggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      document.body.classList.toggle('drawer-open');
    });
  }

  el('drawer').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sect) {
      S.settings.collapsed = S.settings.collapsed || {};
      S.settings.collapsed[b.dataset.sect] = !S.settings.collapsed[b.dataset.sect];
      save(LS.settings, S.settings);
      renderDrawer();
      return;
    }
    if (b.dataset.view) { S.view = b.dataset.view; S.mode = 'read'; }
    else if (b.dataset.coll) { S.coll = S.coll === b.dataset.coll ? null : b.dataset.coll; S.mode = 'read'; }
    else if (b.dataset.fn) { toggleIn(S.fn, b.dataset.fn); S.mode = 'read'; }
    else if (b.dataset.cat) { toggleIn(S.cat, b.dataset.cat); S.mode = 'read'; }
    else if (b.dataset.cx) { toggleIn(S.cx, b.dataset.cx); S.mode = 'read'; }
    else if (b.dataset.act === 'new') { S.draft = blankPrompt(); S.mode = 'edit'; S.selected = null; }
    else if (b.dataset.act === 'guide') { S.mode = 'guide'; }
    else if (b.dataset.act === 'about') { S.mode = 'about'; }
    else if (b.dataset.act === 'export-mine') { exportMine(); return; }
    else if (b.dataset.act === 'export-all') { exportAll(); return; }
    else if (b.dataset.act === 'import') { el('importer').click(); return; }
    else if (b.dataset.act === 'unhide') { S.hidden = []; save(LS.hidden, S.hidden); }
    renderAll();
  });

  el('index').addEventListener('click', function (e) {
    var star = e.target.closest('[data-fav]');
    if (star) {
      e.stopPropagation();
      toggleIn(S.favorites, star.dataset.fav);
      save(LS.fav, S.favorites);
      renderDrawer(); renderIndex();
      if (S.selected === star.dataset.fav) renderReader();
      return;
    }
    var clear = e.target.closest('[data-act="clear"]');
    if (clear) { clearFilters(); return; }
    var row = e.target.closest('.row');
    if (row) {
      S.selected = row.dataset.id;
      S.mode = 'read';
      document.body.classList.add('reading');
      renderIndex(); renderReader();
    }
  });

  el('index').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var target = e.target.closest('[data-fav]') || e.target.closest('.row');
    if (!target) return;
    e.preventDefault();
    target.click();
  });

  el('reader').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var act = b.dataset.act;
    var p = byId(S.selected);
    if (act === 'copy') doCopy(b);
    else if (act === 'open-claude') openIn('claude');
    else if (act === 'open-chatgpt') openIn('chatgpt');
    else if (act === 'copy-system') copySystemPrompt(b);
    else if (act === 'print') window.print();
    else if (act === 'goto') gotoPrompt(b.dataset.id);
    else if (act === 'detect' && S.draft) { readEditor(); renderEditor(); }
    else if (act === 'back') { document.body.classList.remove('reading'); S.mode = 'read'; renderAll(); }
    else if (act === 'fav' && p) {
      toggleIn(S.favorites, p.id); save(LS.fav, S.favorites); renderAll();
    }
    else if (act === 'edit' && p) {
      S.draft = JSON.parse(JSON.stringify(p)); delete S.draft.edited;
      S.mode = 'edit'; renderReader();
    }
    else if (act === 'duplicate' && p) {
      var copy = JSON.parse(JSON.stringify(p));
      copy.id = 'user-' + Date.now().toString(36);
      copy.title = p.title + ' (copy)';
      copy.source = 'user'; delete copy.edited;
      S.draft = copy; S.mode = 'edit'; renderReader();
    }
    else if (act === 'revert' && p) {
      delete S.overrides[p.id]; save(LS.over, S.overrides); renderAll();
      toast('Restored the published version.');
    }
    else if (act === 'delete' && p) {
      S.custom = S.custom.filter(function (c) { return c.id !== p.id; });
      save(LS.custom, S.custom);
      S.selected = null; renderAll();
      toast('Deleted.');
    }
    else if (act === 'save') saveDraft();
    else if (act === 'cancel') { S.mode = 'read'; S.draft = null; renderReader(); }
  });

  function onFieldChange(e) {
    var f = e.target.closest('[data-key]');
    if (!f) return;
    var p = byId(S.selected);
    if (!p) return;
    setValue(p, f.dataset.key, f.value);
    if (f.tagName === 'TEXTAREA') autosize(f);
    if (el('composed')) el('composed').innerHTML = markPlaceholders(compose(p, S.settings.model));
  }
  el('reader').addEventListener('input', onFieldChange);
  el('reader').addEventListener('change', onFieldChange);

  el('importer').addEventListener('change', function () {
    if (this.files && this.files[0]) importBackup(this.files[0]);
    this.value = '';
  });

  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); el('q').focus(); el('q').select(); }
    else if (e.key === 'Escape') {
      if (typing && e.target.id === 'q') { S.q = ''; e.target.value = ''; renderIndex(); }
      else if (document.body.classList.contains('reading')) {
        document.body.classList.remove('reading');
      }
    }
    else if (e.key === 'c' && !typing && S.selected && S.mode === 'read') {
      doCopy(document.querySelector('[data-act="copy"]'));
    }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !typing) {
      var list = visible();
      if (!list.length) return;
      e.preventDefault();
      var i = list.map(function (p) { return p.id; }).indexOf(S.selected);
      i = e.key === 'ArrowDown' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
      S.selected = list[i].id; S.mode = 'read';
      renderIndex(); renderReader();
      var row = document.querySelector('.row[aria-current="true"]');
      if (row) row.scrollIntoView({ block: 'nearest' });
    }
  });
}

/* ------------------------------------------------------------------
   Boot
------------------------------------------------------------------ */
function adopt(data) {
  S.base = data.prompts || [];
  S.taxonomy = data.taxonomy;
  S.defaults = data.defaults || {};
  S.collection = data.collection || S.collection;
  S.collections = (data.collections || []).filter(function (c) {
    return c && c.id && c.title && Array.isArray(c.prompts);
  });
  if (S.coll && !activeCollection()) S.coll = null;
  pruneSharedValues();
}

function boot() {
  var seed = JSON.parse(el('seed').textContent);
  adopt(seed);

  var importer = document.createElement('input');
  importer.type = 'file'; importer.accept = 'application/json';
  importer.id = 'importer'; importer.style.display = 'none';
  document.body.appendChild(importer);

  wire();
  renderAll();

  // A served copy of prompts.json wins over the embedded seed, so the
  // collection can be updated without redeploying index.html. Opening the
  // file straight off a network share skips this and uses the seed.
  fetch('prompts.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.prompts) return;
      if (d.generated && seed.generated && d.generated === seed.generated &&
          d.prompts.length === seed.prompts.length) return;
      adopt(d);
      renderAll();
      toast('Loaded the published collection: ' + d.prompts.length + ' prompts.');
    })
    .catch(function () { /* file:// or offline — the seed already rendered */ });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
