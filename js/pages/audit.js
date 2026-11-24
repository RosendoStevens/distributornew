// Audit log: who changed what, and when.
import { sb } from '../db.js';
import { h, clear, openModal, toast, friendlyError, dataTable, badge, dateTime } from '../ui.js';

const ACTION = { INSERT: ['Created', 'ok'], UPDATE: ['Changed', 'warn'], DELETE: ['Deleted', 'bad'] };

function changedKeys(d) {
  if (!d || !d.old || !d.new) return '';
  return Object.keys(d.new).filter((k) => JSON.stringify(d.old[k]) !== JSON.stringify(d.new[k])).join(', ');
}

export async function auditPage(container) {
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Search…' });
  const tableSel = h('select', { 'aria-label': 'Table' }, h('option', { value: '' }, 'All tables'));
  const listBox = h('div', { class: 'card' });
  let rows = [];

  const { data, error } = await sb.from('audit_log').select('*').order('at', { ascending: false }).limit(400);
  if (error) { toast(friendlyError(error), 'bad'); }
  rows = data || [];
  [...new Set(rows.map((r) => r.table_name))].sort().forEach((t) => tableSel.append(h('option', { value: t }, t)));

  function draw() {
    const term = search.value.trim().toLowerCase();
    const list = rows.filter((r) => (!tableSel.value || r.table_name === tableSel.value) &&
      (!term || `${r.user_name || ''} ${r.table_name} ${r.action} ${r.row_id || ''} ${changedKeys(r.details)}`.toLowerCase().includes(term)));
    clear(listBox).append(dataTable([
      { label: 'When', render: (r) => dateTime(r.at) },
      { label: 'Who', render: (r) => r.user_name || 'System' },
      { label: 'Action', render: (r) => badge(ACTION[r.action][0], ACTION[r.action][1]) },
      { label: 'Table', key: 'table_name' },
      { label: 'Fields changed', wrap: true, render: (r) => changedKeys(r.details) },
    ], list, (r) => openModal({
      title: `${ACTION[r.action][0]} in ${r.table_name}`,
      body: h('div', {}, h('p', { class: 'muted small' }, `${r.user_name || 'System'} · ${dateTime(r.at)}`),
        h('div', { class: 'json' }, JSON.stringify(r.details, null, 2))),
      actions: [{ label: 'Close', onClick: (c) => c() }],
    })));
  }
  search.addEventListener('input', draw); tableSel.addEventListener('change', draw);

  clear(container).append(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Audit log'),
      h('div', { class: 'muted small' }, 'The latest 400 changes. Every change to prices, margins, agents, customers, settings and permissions is recorded.')),
      h('div', { class: 'toolbar' }, search, tableSel)), listBox);
  draw();
}
