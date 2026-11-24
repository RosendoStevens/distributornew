// Generic list + add/edit/delete page for simple tables.
import { sb, can } from './db.js';
import { h, clear, openModal, buildForm, confirmDialog, toast, friendlyError, dataTable } from './ui.js';

const resolve = async (v) => (typeof v === 'function' ? await v() : v);

export function crudPage(cfg) {
  return async function render(container) {
    const canEdit = can(cfg.module, 'edit');
    const canDel = can(cfg.module, 'full') && !cfg.noDelete;
    const fieldDefs = await resolve(cfg.fields);
    const filterDefs = (await resolve(cfg.filters)) || [];

    const search = h('input', { class: 'search', type: 'search', placeholder: 'Search…', 'aria-label': 'Search' });
    const filterEls = filterDefs.map((f) => {
      const s = h('select', { 'aria-label': f.label }, h('option', { value: '' }, 'All ' + f.label.toLowerCase()),
        f.options.map((o) => h('option', { value: o.value }, o.label)));
      s.addEventListener('change', draw);
      return { def: f, el: s };
    });
    const listBox = h('div', { class: 'card' });
    let rows = [];

    async function load() {
      let q = sb.from(cfg.table).select(cfg.select || '*');
      if (cfg.order) q = q.order(cfg.order);
      const { data, error } = await q;
      if (error) { toast(friendlyError(error), 'bad'); return; }
      rows = data || [];
      draw();
    }

    function draw() {
      const term = search.value.trim().toLowerCase();
      let list = rows.filter((r) => filterEls.every((f) => !f.el.value || String(r[f.def.key]) === f.el.value));
      if (term) list = list.filter((r) => (cfg.searchText ? cfg.searchText(r) : JSON.stringify(r)).toLowerCase().includes(term));
      clear(listBox).append(dataTable(cfg.columns, list, openEdit));
    }
    search.addEventListener('input', draw);

    async function openEdit(row) {
      const isNew = !row;
      if (isNew && !canEdit) return;
      const extra = row && cfg.loadExtra ? await cfg.loadExtra(row) : {};
      const values = { ...(isNew ? (cfg.defaults ? cfg.defaults() : {}) : row), ...extra };
      const defs = fieldDefs.map((f) => ({
        ...f,
        hidden: typeof f.hidden === 'function' ? f.hidden() : f.hidden,
        readonly: !canEdit || f.readonly || (f.readonlyOnEdit && !isNew),
      }));
      const form = buildForm(defs, values);
      const errBox = h('div', { class: 'error-box hidden' });
      const body = h('div', {}, errBox, form.el);
      const showErr = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };

      const actions = [];
      if (!isNew && canDel) {
        actions.push({
          label: 'Delete', kind: 'danger', left: true,
          onClick: async (close) => {
            if (!(await confirmDialog(`Delete this ${cfg.itemName || 'record'}? This cannot be undone.`))) return;
            const { error } = await sb.from(cfg.table).delete().eq('id', row.id);
            if (error) { showErr(friendlyError(error)); return; }
            toast('Deleted'); close(); load();
          },
        });
      }
      actions.push({ label: canEdit ? 'Cancel' : 'Close', onClick: (close) => close() });
      if (canEdit) {
        actions.push({
          label: 'Save', kind: 'primary',
          onClick: async (close) => {
            errBox.classList.add('hidden');
            const problem = form.validate();
            if (problem) return showErr(problem);
            const all = form.values();
            const payload = {}; const virt = {};
            for (const f of defs) {
              if (!(f.key in all)) continue;
              if (f.virtual) { virt[f.key] = all[f.key]; continue; }
              if (!isNew && f.readonlyOnEdit) continue;
              payload[f.key] = all[f.key];
            }
            try {
              if (cfg.beforeSave) await cfg.beforeSave(payload, isNew, virt, row);
              if (isNew) for (const k of Object.keys(payload)) if (payload[k] == null) delete payload[k];
              const q = isNew ? sb.from(cfg.table).insert(payload) : sb.from(cfg.table).update(payload).eq('id', row.id);
              const { data, error } = await q.select().single();
              if (error) throw error;
              if (cfg.afterSave) await cfg.afterSave(data, virt, isNew);
              toast('Saved'); close(); load();
            } catch (e) { showErr(friendlyError(e)); }
          },
        });
      }
      openModal({ title: (isNew ? 'Add ' : canEdit ? 'Edit ' : 'View ') + (cfg.itemName || cfg.title.toLowerCase()), body, actions });
    }

    clear(container).append(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, cfg.title), cfg.subtitle ? h('div', { class: 'muted small' }, cfg.subtitle) : null),
        h('div', { class: 'toolbar' }, search, filterEls.map((f) => f.el),
          canEdit ? h('button', { class: 'btn primary', onclick: () => openEdit(null) }, '+ Add') : null)),
      listBox);
    await load();
  };
}
