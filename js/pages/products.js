// Products, cost price, quantity price breaks, agent margin rule and target tiers.
import { sb, can } from '../db.js';
import { h, clear, openModal, buildForm, rowsEditor, syncRows, confirmDialog, toast, friendlyError, dataTable, badge, money } from '../ui.js';

const one = (x) => (Array.isArray(x) ? x[0] : x) || null;

export async function productsPage(container) {
  const canEdit = can('products', 'edit');
  const canDel = can('products', 'full');
  const seeCost = can('costs', 'view');
  const seeMargin = can('margins', 'view');

  const search = h('input', { class: 'search', type: 'search', placeholder: 'Search products…' });
  const listBox = h('div', { class: 'card' });
  let rows = [];

  async function load() {
    const { data, error } = await sb.from('products')
      .select('*, product_costs(cost_price), product_margin_rules(margin_type, base_rate)').order('name');
    if (error) return toast(friendlyError(error), 'bad');
    rows = data || []; draw();
  }

  const marginText = (r) => {
    const m = one(r.product_margin_rules); if (!m) return '';
    return m.margin_type === 'percent' ? Number(m.base_rate) + '%' : money(m.base_rate) + ' / pack';
  };

  function draw() {
    const term = search.value.trim().toLowerCase();
    const list = rows.filter((r) => !term || `${r.sku} ${r.name} ${r.pack_size || ''}`.toLowerCase().includes(term));
    const cols = [
      { label: 'SKU', key: 'sku' }, { label: 'Product', key: 'name' }, { label: 'Pack', key: 'pack_size' },
      { label: 'Per case', num: true, key: 'units_per_case' },
      { label: 'Selling price', num: true, render: (r) => money(r.selling_price) },
    ];
    if (seeCost) cols.push({ label: 'Cost price', num: true, render: (r) => { const c = one(r.product_costs); return c ? money(c.cost_price) : ''; } });
    if (seeMargin) cols.push({ label: 'Agent margin', num: true, render: marginText });
    cols.push({ label: 'Status', render: (r) => badge(r.active ? 'Active' : 'Inactive', r.active ? 'ok' : '') });
    clear(listBox).append(dataTable(cols, list, openEdit));
  }
  search.addEventListener('input', draw);

  async function openEdit(row) {
    const isNew = !row;
    if (isNew && !canEdit) return;
    let breaks = [], tiers = [];
    if (row) {
      const [b, t] = await Promise.all([
        sb.from('product_price_breaks').select('*').eq('product_id', row.id).order('min_qty'),
        seeMargin ? sb.from('product_margin_tiers').select('*').eq('product_id', row.id).order('min_monthly_qty') : { data: [] },
      ]);
      breaks = b.data || []; tiers = t.data || [];
    }
    const cost = row ? one(row.product_costs) : null;
    const rule = row ? one(row.product_margin_rules) : null;

    const ro = !canEdit;
    const form = buildForm([
      { key: 'sku', label: 'SKU / code', required: true, readonly: ro, hint: 'Example: TEA-100' },
      { key: 'name', label: 'Product name', required: true, readonly: ro },
      { key: 'pack_size', label: 'Pack size', readonly: ro, placeholder: '100 g' },
      { key: 'units_per_case', label: 'Packs per case', type: 'number', min: 1, default: 1, required: true, readonly: ro },
      { key: 'selling_price', label: 'Selling price per pack (LKR)', type: 'number', step: '0.01', min: 0, default: 0, required: true, readonly: ro },
      { key: 'reorder_level', label: 'Reorder level (packs)', type: 'number', min: 0, default: 0, readonly: ro },
      { key: 'track_batches', label: 'Track batches and expiry', type: 'checkbox', default: true, readonly: ro },
      { key: 'active', label: 'Active', type: 'checkbox', default: true, readonly: ro },
    ], row || {});

    let costForm = null;
    if (seeCost) costForm = buildForm([
      { key: 'cost_price', label: 'Cost price per pack (LKR)', type: 'number', step: '0.01', min: 0, readonly: !can('costs', 'edit'),
        hint: 'Only people with cost access can see this. Agents never see it.' },
    ], cost || {});

    let marginForm = null, tierEd = null;
    if (seeMargin) {
      const me = can('margins', 'edit');
      marginForm = buildForm([
        { key: 'margin_type', label: 'Agent margin type', type: 'select', required: true, readonly: !me, default: 'percent',
          options: [{ value: 'percent', label: 'Percent of selling price' }, { value: 'fixed', label: 'Fixed amount per pack (LKR)' }] },
        { key: 'base_rate', label: 'Base margin rate', type: 'number', step: '0.0001', min: 0, readonly: !me, default: 0 },
      ], rule || {});
      tierEd = rowsEditor(
        [{ key: 'min_monthly_qty', label: 'Agent monthly packs from', step: '1', min: 1 }, { key: 'rate', label: 'Margin rate then', step: '0.0001', min: 0 }],
        tiers, { readonly: !me, addLabel: 'Add target level' });
    }

    const breakEd = rowsEditor(
      [{ key: 'min_qty', label: 'Order quantity from (packs)', step: '1', min: 2 }, { key: 'unit_price', label: 'Price per pack (LKR)', step: '0.01', min: 0 }],
      breaks, { readonly: ro, addLabel: 'Add price break' });

    const errBox = h('div', { class: 'error-box hidden' });
    const showErr = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };

    const body = h('div', {}, errBox, form.el,
      costForm ? [h('div', { class: 'section-title' }, 'Cost'), costForm.el] : null,
      h('div', { class: 'section-title' }, 'Price breaks for larger orders'),
      h('div', { class: 'muted small', style: { marginBottom: '6px' } }, 'The Admin decides these levels. Leave empty if the price is the same for every order size.'),
      breakEd.el,
      seeMargin ? [
        h('div', { class: 'section-title' }, 'Agent margin'), marginForm.el,
        h('div', { class: 'section-title' }, 'Higher margin after monthly target'),
        h('div', { class: 'muted small', style: { marginBottom: '6px' } }, 'When an agent sells at least this many packs of this product in a month, this rate applies.'),
        tierEd.el,
      ] : null);

    const actions = [];
    if (row && canDel) actions.push({
      label: 'Delete', kind: 'danger', left: true,
      onClick: async (close) => {
        if (!(await confirmDialog('Delete this product? Mark it inactive instead if it has been sold.'))) return;
        const { error } = await sb.from('products').delete().eq('id', row.id);
        if (error) return showErr(friendlyError(error));
        toast('Deleted'); close(); load();
      },
    });
    actions.push({ label: canEdit ? 'Cancel' : 'Close', onClick: (c) => c() });
    if (canEdit || can('costs', 'edit') || can('margins', 'edit')) actions.push({
      label: 'Save', kind: 'primary',
      onClick: async (close) => {
        errBox.classList.add('hidden');
        try {
          let id = row && row.id;
          if (canEdit) {
            const p = form.validate(); if (p) throw new Error(p);
            const vals = form.values();
            const q = isNew ? sb.from('products').insert(vals) : sb.from('products').update(vals).eq('id', id);
            const { data, error } = await q.select().single(); if (error) throw error;
            id = data.id;
          }
          if (costForm && can('costs', 'edit')) {
            const c = costForm.values().cost_price;
            if (c != null) { const { error } = await sb.from('product_costs').upsert({ product_id: id, cost_price: c }); if (error) throw error; }
          }
          if (canEdit) {
            const nb = breakEd.values();
            if (nb.some((r) => r.min_qty == null || r.unit_price == null)) throw new Error('Each price break needs a quantity and a price.');
            await syncRows(sb, 'product_price_breaks', breaks, nb, { product_id: id });
          }
          if (marginForm && can('margins', 'edit')) {
            const m = marginForm.values();
            const { error } = await sb.from('product_margin_rules').upsert({ product_id: id, margin_type: m.margin_type || 'percent', base_rate: m.base_rate ?? 0 });
            if (error) throw error;
            const nt = tierEd.values();
            if (nt.some((r) => r.min_monthly_qty == null || r.rate == null)) throw new Error('Each target level needs a quantity and a rate.');
            await syncRows(sb, 'product_margin_tiers', tiers, nt, { product_id: id });
          }
          toast('Saved'); close(); load();
        } catch (e) { showErr(friendlyError(e)); }
      },
    });
    openModal({ title: isNew ? 'Add product' : (canEdit ? 'Edit product' : 'Product'), body, actions });
  }

  clear(container).append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Products and prices'), h('div', { class: 'muted small' }, 'Tea packs, selling prices, price breaks and agent margins.')),
      h('div', { class: 'toolbar' }, search, canEdit ? h('button', { class: 'btn primary', onclick: () => openEdit(null) }, '+ Add') : null)),
    listBox);
  await load();
}
