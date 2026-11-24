// Stock levels, batches and expiry, the movement ledger, adjustments and packing runs.
import { sb, can } from '../db.js';
import { h, clear, openModal, buildForm, toast, friendlyError, dataTable, badge, num, dateTime, dateOnly } from '../ui.js';
import { loadRef, itemOptions, parseItem, itemName, unitOf, locOptions, productLabel } from '../items.js';

const KIND = {
  receipt: 'Goods received', packing_in: 'Packed', packing_out: 'Used in packing',
  adjustment: 'Adjustment', sale: 'Sale', return: 'Return',
};
const today = () => new Date().toISOString().slice(0, 10);

export async function stockPage(container) {
  const canEdit = can('stock', 'edit');
  let ref = await loadRef();
  const body = h('div');
  const tabs = h('div', { class: 'tabs' });
  let current = 'levels';

  const setTab = async (t) => {
    current = t;
    clear(tabs).append(...[['levels', 'Stock levels'], ['batches', 'Batches and expiry'], ['moves', 'Movements']].map(([k, l]) =>
      h('button', { class: current === k ? 'active' : '', onclick: () => setTab(k) }, l)));
    clear(body).append(h('div', { class: 'muted' }, 'Loading…'));
    if (t === 'levels') await levelsTab(); else if (t === 'batches') await batchesTab(); else await movesTab();
  };

  const refresh = async () => { ref = await loadRef(); await setTab(current); };

  // ---------- Stock levels ----------
  async function levelsTab() {
    const { data, error } = await sb.from('v_stock_levels').select('*');
    if (error) return clear(body).append(h('div', { class: 'error-box' }, friendlyError(error)));
    const qty = {}; for (const r of data) qty[`${r.item_type}|${r.item_id}|${r.location_id}`] = Number(r.qty);
    const locs = ref.locations.filter((l) => l.active);
    const rows = [];
    for (const l of locs) {
      for (const m of ref.materials.filter((x) => x.active)) rows.push({ type: 'Material', code: m.code, name: m.name, loc: l.name, unit: m.unit, reorder: Number(m.reorder_level), qty: qty[`material|${m.id}|${l.id}`] || 0 });
      for (const p of ref.products.filter((x) => x.active)) rows.push({ type: 'Product', code: p.sku, name: productLabel(p), loc: l.name, unit: 'packs', reorder: Number(p.reorder_level), qty: qty[`product|${p.id}|${l.id}`] || 0 });
    }
    const search = h('input', { class: 'search', type: 'search', placeholder: 'Search items…' });
    const typeSel = h('select', {}, h('option', { value: '' }, 'All items'), h('option', { value: 'Product' }, 'Products'), h('option', { value: 'Material' }, 'Materials'), h('option', { value: 'low' }, 'Low or out'));
    const box = h('div', { class: 'card' });
    const state = (r) => (r.qty < 0 ? ['Negative', 'bad'] : r.qty === 0 ? (r.reorder > 0 ? ['Out', 'bad'] : ['Empty', '']) :
      r.reorder > 0 && r.qty <= r.reorder ? ['Low', 'warn'] : ['OK', 'ok']);
    const draw = () => {
      const term = search.value.trim().toLowerCase();
      const list = rows.filter((r) => (!typeSel.value || (typeSel.value === 'low' ? ['Out', 'Low', 'Negative'].includes(state(r)[0]) : r.type === typeSel.value)) &&
        (!term || `${r.code} ${r.name}`.toLowerCase().includes(term)));
      const cols = [
        { label: 'Type', key: 'type' }, { label: 'Code', key: 'code' }, { label: 'Item', key: 'name' },
        ...(locs.length > 1 ? [{ label: 'Warehouse', key: 'loc' }] : []),
        { label: 'On hand', num: true, render: (r) => num(r.qty) + ' ' + r.unit },
        { label: 'Reorder at', num: true, render: (r) => (r.reorder ? num(r.reorder) : '') },
        { label: 'Status', render: (r) => badge(state(r)[0], state(r)[1]) },
      ];
      clear(box).append(dataTable(cols, list));
    };
    search.addEventListener('input', draw); typeSel.addEventListener('change', draw);
    clear(body).append(h('div', { class: 'toolbar', style: { marginBottom: '12px' } }, search, typeSel), box);
    draw();
  }

  // ---------- Batches ----------
  async function batchesTab() {
    const { data, error } = await sb.from('v_batch_levels').select('*');
    if (error) return clear(body).append(h('div', { class: 'error-box' }, friendlyError(error)));
    const list = [...data].sort((a, b) => (a.expiry_date || '9999').localeCompare(b.expiry_date || '9999'));
    const multi = ref.locations.filter((l) => l.active).length > 1;
    const daysLeft = (d) => (d ? Math.floor((new Date(d + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 864e5) : null);
    const cols = [
      { label: 'Product', render: (r) => { const p = ref.products.find((x) => x.id === r.product_id); return p ? productLabel(p) : ''; } },
      { label: 'Batch', key: 'batch_no' },
      { label: 'Packed', render: (r) => dateOnly(r.packed_on) },
      { label: 'Expiry', render: (r) => dateOnly(r.expiry_date) },
      { label: 'Time left', render: (r) => { const d = daysLeft(r.expiry_date); if (d == null) return ''; return d < 0 ? badge('Expired', 'bad') : d <= 60 ? badge(d + ' days', 'warn') : badge(d + ' days', 'ok'); } },
      ...(multi ? [{ label: 'Warehouse', render: (r) => (ref.locations.find((l) => l.id === r.location_id) || {}).name || '' }] : []),
      { label: 'On hand', num: true, render: (r) => num(r.qty) },
    ];
    clear(body).append(h('div', { class: 'muted small', style: { marginBottom: '10px' } }, 'Batches with stock, soonest expiry first. Sell the oldest batch first.'),
      h('div', { class: 'card' }, dataTable(cols, list)));
  }

  // ---------- Movements ----------
  async function movesTab() {
    const { data, error } = await sb.from('stock_movements').select('*').order('at', { ascending: false }).limit(300);
    if (error) return clear(body).append(h('div', { class: 'error-box' }, friendlyError(error)));
    const kindSel = h('select', {}, h('option', { value: '' }, 'All types'), Object.entries(KIND).map(([k, l]) => h('option', { value: k }, l)));
    const search = h('input', { class: 'search', type: 'search', placeholder: 'Search…' });
    const box = h('div', { class: 'card' });
    const draw = () => {
      const term = search.value.trim().toLowerCase();
      const list = data.filter((r) => (!kindSel.value || r.kind === kindSel.value) &&
        (!term || `${itemName(ref, r)} ${r.note || ''} ${r.user_name || ''}`.toLowerCase().includes(term)));
      clear(box).append(dataTable([
        { label: 'When', render: (r) => dateTime(r.at) },
        { label: 'Item', render: (r) => itemName(ref, r) },
        { label: 'Type', render: (r) => KIND[r.kind] || r.kind },
        { label: 'Change', num: true, render: (r) => badge((Number(r.qty) > 0 ? '+' : '') + num(r.qty) + ' ' + unitOf(ref, r), Number(r.qty) > 0 ? 'ok' : 'bad') },
        { label: 'Note', wrap: true, key: 'note' }, { label: 'By', key: 'user_name' },
      ], list));
    };
    search.addEventListener('input', draw); kindSel.addEventListener('change', draw);
    clear(body).append(h('div', { class: 'toolbar', style: { marginBottom: '12px' } }, search, kindSel),
      h('div', { class: 'muted small', style: { marginBottom: '10px' } }, 'Every stock change is recorded here and cannot be edited. The latest 300 are shown.'), box);
    draw();
  }

  // ---------- Adjust stock ----------
  async function openAdjust() {
    const locs = locOptions(ref);
    const form = buildForm([
      { key: 'item', label: 'Item', type: 'select', required: true, options: itemOptions(ref) },
      { key: 'location', label: 'Warehouse', type: 'select', required: true, options: locs, default: locs.length === 1 ? locs[0].value : '' },
      { key: 'batch', label: 'Batch (optional)', type: 'select', options: [], hint: 'Pick the batch when you are correcting a product batch.' },
      { key: 'qty', label: 'Change in quantity', type: 'number', step: 'any', required: true, hint: 'Use + to add and a minus sign to remove. Example: -5' },
      { key: 'reason', label: 'Reason', type: 'select', required: true,
        options: ['Stock count correction', 'Damaged', 'Expired', 'Lost or stolen', 'Sample or gift', 'Other'].map((x) => ({ value: x, label: x })) },
      { key: 'note', label: 'Note', type: 'textarea', hint: 'Required when the reason is Other.' },
    ]);
    const errBox = h('div', { class: 'error-box hidden' });
    const showErr = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };

    const reloadBatches = async () => {
      const it = parseItem(form.getValue('item')); const loc = form.getValue('location');
      const sel = form.inputs.batch; clear(sel).append(h('option', { value: '' }, '— none —'));
      if (!it.product_id || !loc) return;
      const { data } = await sb.from('v_batch_levels').select('*').eq('product_id', it.product_id).eq('location_id', loc);
      (data || []).forEach((b) => sel.append(h('option', { value: b.batch_id }, `${b.batch_no} (${num(b.qty)} on hand)`)));
    };
    form.inputs.item.addEventListener('change', reloadBatches);
    form.inputs.location.addEventListener('change', reloadBatches);
    reloadBatches();

    openModal({
      title: 'Adjust stock', body: h('div', {}, errBox, form.el),
      actions: [
        { label: 'Cancel', onClick: (c) => c() },
        { label: 'Record adjustment', kind: 'primary', onClick: async (close) => {
          errBox.classList.add('hidden');
          const p = form.validate(); if (p) return showErr(p);
          const v = form.values();
          if (v.reason === 'Other' && !v.note) return showErr('Please write a note for the reason Other.');
          const it = parseItem(v.item);
          const { error } = await sb.rpc('record_adjustment', {
            p_product: it.product_id, p_material: it.material_id, p_location: v.location, p_batch: v.batch || null,
            p_qty: v.qty, p_reason: v.reason + (v.note ? ': ' + v.note : ''),
          });
          if (error) return showErr(friendlyError(error));
          toast('Stock adjusted'); close(); refresh();
        } },
      ],
    });
  }

  // ---------- Packing run ----------
  async function openPacking() {
    const locs = locOptions(ref);
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const form = buildForm([
      { key: 'product', label: 'Product packed', type: 'select', required: true, options: ref.products.filter((p) => p.active).map((p) => ({ value: p.id, label: productLabel(p) })) },
      { key: 'location', label: 'Warehouse', type: 'select', required: true, options: locs, default: locs.length === 1 ? locs[0].value : '' },
      { key: 'qty', label: 'Packs produced', type: 'number', step: '1', min: 1, required: true },
      { key: 'batch_no', label: 'Batch number', default: 'B-' + stamp, hint: 'Needed for products that track batches.' },
      { key: 'packed_on', label: 'Packed on', type: 'date', default: today() },
      { key: 'expiry', label: 'Best before / expiry', type: 'date' },
    ]);
    // materials used
    const tbody = h('tbody');
    const addRow = () => {
      const sel = h('select', {}, h('option', { value: '' }, '— material —'),
        ref.materials.filter((m) => m.active).map((m) => h('option', { value: m.id }, `${m.name} (${m.unit})`)));
      const qty = h('input', { type: 'number', step: 'any', min: 0, placeholder: 'Quantity used' });
      const tr = h('tr', {}, h('td', {}, sel), h('td', {}, qty), h('td', {}, h('button', { class: 'btn sm', type: 'button', onclick: () => tr.remove() }, '×')));
      tr._get = () => ({ material_id: sel.value || null, qty: qty.value === '' ? null : Number(qty.value) });
      tbody.append(tr);
    };
    addRow();
    const errBox = h('div', { class: 'error-box hidden' });
    const showErr = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };
    openModal({
      title: 'Packing run',
      body: h('div', {}, errBox, h('div', { class: 'muted small', style: { marginBottom: '10px' } }, 'Record tea and packaging used and the packs produced. Materials are deducted and the packs are added to stock under the batch.'),
        form.el, h('div', { class: 'section-title' }, 'Materials used'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'mini-table' }, tbody)),
        h('button', { class: 'btn sm', type: 'button', style: { marginTop: '8px' }, onclick: addRow }, '+ Add material')),
      actions: [
        { label: 'Cancel', onClick: (c) => c() },
        { label: 'Record packing', kind: 'primary', onClick: async (close) => {
          errBox.classList.add('hidden');
          const p = form.validate(); if (p) return showErr(p);
          const v = form.values();
          const mats = [...tbody.querySelectorAll('tr')].map((tr) => tr._get()).filter((m) => m.material_id || m.qty != null);
          if (mats.some((m) => !m.material_id || !m.qty || m.qty <= 0)) return showErr('Each material line needs a material and a quantity.');
          const { error } = await sb.rpc('record_packing', {
            p_product: v.product, p_location: v.location, p_qty: v.qty, p_batch_no: v.batch_no,
            p_packed_on: v.packed_on, p_expiry: v.expiry, p_materials: mats,
          });
          if (error) return showErr(friendlyError(error));
          toast('Packing recorded'); close(); refresh();
        } },
      ],
    });
  }

  clear(container).append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Stock'), h('div', { class: 'muted small' }, 'What you have in the warehouse, by batch, with every movement recorded.')),
      canEdit ? h('div', { class: 'toolbar' },
        h('button', { class: 'btn', onclick: openPacking }, 'Packing run'),
        h('button', { class: 'btn', onclick: openAdjust }, 'Adjust stock')) : null),
    tabs, body);
  await setTab('levels');
}
