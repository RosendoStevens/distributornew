// Small UI toolkit: DOM builder, toast, modal, forms. No data is ever put in innerHTML.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  appendKids(el, kids);
  return el;
}

function appendKids(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function toast(msg, kind) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast' + (kind === 'bad' ? ' bad' : '') }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3000);
}

export function friendlyError(err) {
  const msg = (err && err.message) || String(err);
  const code = err && err.code;
  if (code === '23505') return 'That value already exists. Please use a different one.';
  if (code === '23503') return 'This record is used by other records, so it cannot be removed. Mark it inactive instead.';
  if (code === '23514') return 'One of the values is not allowed (check numbers and options).';
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'You do not have permission to do that.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Cannot reach the server. Check your internet connection.';
  return msg;
}

export const money = (n) =>
  n == null || n === '' ? '' : 'LKR ' + Number(n).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('en-LK'));

export const dateTime = (s) => {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

export const dateOnly = (s) => {
  if (!s) return '';
  return new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export function badge(text, kind) { return h('span', { class: 'badge ' + (kind || '') }, text); }

// ---------- Modal ----------
// openModal({ title, body, actions:[{label, kind, left, onClick(close)}], narrow })
export function openModal({ title, body, actions = [], narrow = false, onClose }) {
  const back = h('div', { class: 'modal-back' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const foot = h('div', { class: 'modal-foot' });
  const buttons = actions.map((a) => {
    const b = h('button', { class: 'btn ' + (a.kind || '') + (a.left ? ' left' : ''), type: 'button' }, a.label);
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await a.onClick(close, b); } finally { if (document.body.contains(b)) b.disabled = false; }
    });
    foot.append(b);
    return b;
  });
  const modal = h('div', { class: 'modal' + (narrow ? ' narrow' : ''), role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'x', type: 'button', 'aria-label': 'Close', onclick: close }, '×')),
    h('div', { class: 'modal-body' }, body),
    actions.length ? foot : null);
  back.append(modal);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  return { close, buttons, modal };
}

export function confirmDialog(message, okLabel = 'Delete') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openModal({
      title: 'Please confirm', narrow: true, body: h('p', {}, message), onClose: () => finish(false),
      actions: [
        { label: 'Cancel', onClick: (close) => { finish(false); close(); } },
        { label: okLabel, kind: 'danger', onClick: (close) => { finish(true); close(); } },
      ],
    });
  });
}

// ---------- Form builder ----------
// field: { key, label, type, required, options, hint, span2, step, min, max, readonly, placeholder, onClick, hidden }
// types: text, tel, email, number, date, password, textarea, select, checkbox, checks, button
export function buildForm(fields, values = {}) {
  const inputs = {};
  const wrappers = {};
  const grid = h('div', { class: 'form-grid' });
  const api = {
    el: grid,
    setValue(key, v) {
      const f = fields.find((x) => x.key === key); const i = inputs[key];
      if (!i) return;
      if (f.type === 'checkbox') i.checked = !!v;
      else if (f.type === 'checks') i.querySelectorAll('input').forEach((c) => { c.checked = (v || []).includes(c.value); });
      else i.value = v == null ? '' : v;
    },
    getValue(key) {
      const f = fields.find((x) => x.key === key); const i = inputs[key];
      if (!i) return undefined;
      if (f.type === 'checkbox') return i.checked;
      if (f.type === 'checks') return [...i.querySelectorAll('input:checked')].map((c) => c.value);
      const raw = i.value;
      if (f.type === 'number') return raw === '' ? null : Number(raw);
      const t = typeof raw === 'string' ? raw.trim() : raw;
      return t === '' ? null : t;
    },
    values() {
      const out = {};
      for (const f of fields) { if (f.type === 'button' || f.hidden === true) continue; out[f.key] = api.getValue(f.key); }
      return out;
    },
    validate() {
      for (const f of fields) {
        if (f.type === 'button' || f.hidden === true || !f.required) continue;
        const v = api.getValue(f.key);
        if (v == null || v === '' || (Array.isArray(v) && !v.length)) return f.label + ' is required.';
      }
      return null;
    },
    setHidden(key, hide) { if (wrappers[key]) wrappers[key].classList.toggle('hidden', !!hide); },
    inputs,
  };

  for (const f of fields) {
    if (f.hidden === true) continue;
    const id = 'f_' + f.key + '_' + Math.random().toString(36).slice(2, 7);
    let input;
    const cur = values[f.key];
    if (f.type === 'select') {
      input = h('select', { id }, h('option', { value: '' }, f.placeholder || '— select —'),
        (f.options || []).map((o) => h('option', { value: o.value }, o.label)));
      input.value = cur == null ? (f.default ?? '') : cur;
    } else if (f.type === 'textarea') {
      input = h('textarea', { id, rows: 3 }); input.value = cur ?? '';
    } else if (f.type === 'checkbox') {
      input = h('input', { id, type: 'checkbox' }); input.checked = cur == null ? !!f.default : !!cur;
    } else if (f.type === 'checks') {
      input = h('div', { class: 'checks', id },
        (f.options || []).map((o) => h('label', {}, h('input', { type: 'checkbox', value: o.value, checked: (cur || []).includes(o.value) }), o.label)));
    } else if (f.type === 'button') {
      input = h('button', { class: 'btn', type: 'button', onclick: () => f.onClick && f.onClick(api) }, f.label);
    } else {
      input = h('input', { id, type: f.type || 'text', step: f.step, min: f.min, max: f.max, placeholder: f.placeholder, autocomplete: f.type === 'password' ? 'new-password' : 'off' });
      input.value = cur == null ? (f.default ?? '') : cur;
    }
    if (f.readonly) input.disabled = true;
    inputs[f.key] = input;

    const isCheck = f.type === 'checkbox';
    const label = f.type === 'button' ? null :
      h('label', { for: id }, f.label, f.required ? h('span', { class: 'req' }, ' *') : null);
    const wrap = h('div', { class: 'field' + (isCheck ? ' check' : '') + (f.span2 || f.type === 'textarea' || f.type === 'checks' ? ' span2' : '') },
      isCheck ? [input, label] : [label, input],
      f.hint ? h('div', { class: 'hint' }, f.hint) : null);
    wrappers[f.key] = wrap;
    grid.append(wrap);
  }
  return api;
}

// Editable mini table for child rows. cols: [{key,label,type,step,min}]
export function rowsEditor(cols, rows, { readonly = false, addLabel = 'Add row' } = {}) {
  const body = h('tbody');
  const table = h('table', { class: 'mini-table' },
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c.label)), h('th', {}))), body);
  const addRow = (r = {}) => {
    const tr = h('tr'); tr._id = r.id || null;
    for (const c of cols) {
      const i = h('input', { type: c.type || 'number', step: c.step || 'any', min: c.min, 'data-key': c.key });
      i.value = r[c.key] == null ? '' : r[c.key]; if (readonly) i.disabled = true;
      tr.append(h('td', {}, i));
    }
    tr.append(h('td', {}, readonly ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => tr.remove(), 'aria-label': 'Remove row' }, '×')));
    body.append(tr);
  };
  (rows || []).forEach(addRow);
  const el = h('div', {}, h('div', { class: 'table-wrap' }, table),
    readonly ? null : h('button', { class: 'btn sm', type: 'button', style: { marginTop: '8px' }, onclick: () => addRow() }, '+ ' + addLabel));
  return {
    el,
    // returns rows with ids (existing) and values; skips completely empty rows
    values() {
      const out = [];
      for (const tr of body.querySelectorAll('tr')) {
        const row = { id: tr._id }; let any = false;
        for (const c of cols) {
          const raw = tr.querySelector(`[data-key="${c.key}"]`).value;
          row[c.key] = raw === '' ? null : Number(raw);
          if (raw !== '') any = true;
        }
        if (any) out.push(row);
      }
      return out;
    },
  };
}

// Make DB child rows match the editor: delete removed, update kept, insert new.
export async function syncRows(sb, table, existing, rows, extra) {
  const keepIds = new Set(rows.filter((r) => r.id).map((r) => r.id));
  const removed = (existing || []).filter((r) => !keepIds.has(r.id)).map((r) => r.id);
  if (removed.length) { const { error } = await sb.from(table).delete().in('id', removed); if (error) throw error; }
  for (const r of rows.filter((x) => x.id)) {
    const { id, ...vals } = r;
    const { error } = await sb.from(table).update(vals).eq('id', id); if (error) throw error;
  }
  const fresh = rows.filter((r) => !r.id).map(({ id, ...vals }) => ({ ...vals, ...extra }));
  if (fresh.length) { const { error } = await sb.from(table).insert(fresh); if (error) throw error; }
}

// Data table. columns: [{label, render(row)|key, num, wrap}]
export function dataTable(columns, rows, onRow) {
  if (!rows.length) return h('div', { class: 'empty' }, 'Nothing here yet.');
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.num ? 'num' : '' }, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', { class: onRow ? 'click' : '', onclick: onRow ? () => onRow(r) : null },
      columns.map((c) => h('td', { class: (c.num ? 'num ' : '') + (c.wrap ? 'wrap' : '') }, c.render ? c.render(r) : r[c.key] ?? ''))))))
  );
}
