// Purchase orders and goods received.
import { sb, can } from '../db.js';
import { h, clear, openModal, buildForm, syncRows, confirmDialog, toast, friendlyError, dataTable, badge, money, num, dateOnly, dateTime } from '../ui.js';
import { loadRef, itemOptions, parseItem, itemName, unitOf, locOptions } from '../items.js';

const STATUS = { draft: ['Draft', ''], ordered: ['Ordered', 'warn'], partial: ['Part received', 'warn'], received: ['Received', 'ok'], cancelled: ['Cancelled', 'bad'] };
const stamp = () => new Date().toISOString().slice(2, 10).replace(/-/g, '');
const today = () => new Date().toISOString().slice(0, 10);

export async function purchasingPage(container) {
  const canEdit = can('purchasing', 'edit');
  const canDel = can('purchasing', 'full');
  const canReceive = can('stock', 'edit');
  let ref = await loadRef();
  const { data: supData } = await sb.from('suppliers').select('id, name, active').order('name');
  const suppliers = supData || [];
  const supOpts = (all) => suppliers.filter((s) => all || s.active).map((s) => ({ value: s.id, label: s.name }));

  const body = h('div'); const tabs = h('div', { class: 'tabs' }); let current = 'orders';
  const setTab = async (t) => {
    current = t;
    clear(tabs).append(...[['orders', 'Purchase orders'], ['receipts', 'Goods received']].map(([k, l]) =>
      h('button', { class: current === k ? 'active' : '', onclick: () => setTab(k) }, l)));
    clear(body).append(h('div', { class: 'muted' }, 'Loading…'));
    if (t === 'orders') await ordersTab(); else await receiptsTab();
  };
  const refresh = async () => { ref = await loadRef(); await setTab(current); };

  // ---------- Orders list ----------
  async function ordersTab() {
    const { data, error } = await sb.from('purchase_orders')
      .select('*, suppliers(name), purchase_order_items(qty_ordered, unit_cost)').order('order_date', { ascending: false }).order('po_no', { ascending: false });
    if (error) return clear(body).append(h('div', { class: 'error-box' }, friendlyError(error)));
    const search = h('input', { class: 'search', type: 'search', placeholder: 'Search orders…' });
    const statusSel = h('select', {}, h('option', { value: '' }, 'All statuses'), Object.entries(STATUS).map(([k, v]) => h('option', { value: k }, v[0])));
    const box = h('div', { class: 'card' });
    const total = (r) => (r.purchase_order_items || []).reduce((a, i) => a + Number(i.qty_ordered) * Number(i.unit_cost), 0);
    const draw = () => {
      const term = search.value.trim().toLowerCase();
      const list = data.filter((r) => (!statusSel.value || r.status === statusSel.value) &&
        (!term || `${r.po_no} ${r.suppliers ? r.suppliers.name : ''} ${r.notes || ''}`.toLowerCase().includes(term)));
      clear(box).append(dataTable([
        { label: 'PO', key: 'po_no' }, { label: 'Supplier', render: (r) => (r.suppliers ? r.suppliers.name : '') },
        { label: 'Date', render: (r) => dateOnly(r.order_date) }, { label: 'Expected', render: (r) => dateOnly(r.expected_date) },
        { label: 'Lines', num: true, render: (r) => (r.purchase_order_items || []).length },
        { label: 'Total', num: true, render: (r) => money(total(r)) },
        { label: 'Status', render: (r) => badge(STATUS[r.status][0], STATUS[r.status][1]) },
      ], list, openPO));
    };
    search.addEventListener('input', draw); statusSel.addEventListener('change', draw);
    clear(body).append(h('div', { class: 'toolbar', style: { marginBottom: '12px' } }, search, statusSel), box);
    draw();
  }

  // ---------- Purchase order form ----------
  async function openPO(row) {
    const isNew = !row;
    if (isNew && !canEdit) return;
    const status = row ? row.status : 'draft';
    const editable = canEdit && status === 'draft';
    let items = [], received = {};
    if (row) {
      const r1 = await sb.from('purchase_order_items').select('*').eq('po_id', row.id);
      items = r1.data || [];
      if (items.length) {
        const r2 = await sb.from('goods_receipt_items').select('po_item_id, qty').in('po_item_id', items.map((i) => i.id));
        for (const g of r2.data || []) received[g.po_item_id] = (received[g.po_item_id] || 0) + Number(g.qty);
      }
    }
    const form = buildForm([
      { key: 'supplier_id', label: 'Supplier', type: 'select', required: true, options: supOpts(false).concat(row && !supOpts(false).some((o) => o.value === row.supplier_id) ? supOpts(true).filter((o) => o.value === row.supplier_id) : []), readonly: !editable },
      { key: 'order_date', label: 'Order date', type: 'date', required: true, default: today(), readonly: !editable },
      { key: 'expected_date', label: 'Expected delivery', type: 'date', readonly: !editable },
      { key: 'notes', label: 'Notes', type: 'textarea', readonly: !editable },
    ], row || {});

    const errBox = h('div', { class: 'error-box hidden' });
    const showErr = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };

    // lines
    let linesEl; let getLines = () => [];
    if (editable) {
      const tbody = h('tbody'); const totalEl = h('div', { class: 'muted', style: { marginTop: '8px', textAlign: 'right' } });
      const opts = itemOptions(ref, false);
      const recalc = () => {
        const t = [...tbody.querySelectorAll('tr')].reduce((a, tr) => a + (Number(tr._qty.value) || 0) * (Number(tr._cost.value) || 0), 0);
        totalEl.textContent = 'Total: ' + money(t);
      };
      const addLine = (it) => {
        const sel = h('select', {}, h('option', { value: '' }, '— item —'), opts.map((o) => h('option', { value: o.value }, o.label)));
        if (it) sel.value = it.material_id ? 'm:' + it.material_id : 'p:' + it.product_id;
        const qty = h('input', { type: 'number', step: 'any', min: 0, placeholder: 'Qty' }); qty.value = it ? it.qty_ordered : '';
        const cost = h('input', { type: 'number', step: '0.01', min: 0, placeholder: 'Unit cost' }); cost.value = it ? it.unit_cost : '';
        qty.addEventListener('input', recalc); cost.addEventListener('input', recalc);
        const tr = h('tr', {}, h('td', {}, sel), h('td', {}, qty), h('td', {}, cost), h('td', {}, h('button', { class: 'btn sm', type: 'button', onclick: () => { tr.remove(); recalc(); } }, '×')));
        tr._id = it ? it.id : null; tr._sel = sel; tr._qty = qty; tr._cost = cost;
        tbody.append(tr); recalc();
      };
      items.forEach(addLine); if (!items.length) addLine();
      getLines = () => [...tbody.querySelectorAll('tr')].map((tr) => ({ id: tr._id, ...parseItem(tr._sel.value), qty_ordered: tr._qty.value === '' ? null : Number(tr._qty.value), unit_cost: tr._cost.value === '' ? 0 : Number(tr._cost.value), _empty: !tr._sel.value && tr._qty.value === '' }))
        .filter((l) => !l._empty).map(({ _empty, ...l }) => l);
      linesEl = h('div', {}, h('div', { class: 'table-wrap' }, h('table', { class: 'mini-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', {}, 'Quantity'), h('th', {}, 'Unit cost (LKR)'), h('th', {}))), tbody)),
        h('button', { class: 'btn sm', type: 'button', style: { marginTop: '8px' }, onclick: () => addLine() }, '+ Add line'), totalEl);
    } else {
      linesEl = dataTable([
        { label: 'Item', render: (i) => itemName(ref, i) },
        { label: 'Ordered', num: true, render: (i) => num(i.qty_ordered) + ' ' + unitOf(ref, i) },
        { label: 'Received', num: true, render: (i) => num(received[i.id] || 0) },
        { label: 'Outstanding', num: true, render: (i) => num(Math.max(0, Number(i.qty_ordered) - (received[i.id] || 0))) },
        { label: 'Unit cost', num: true, render: (i) => money(i.unit_cost) },
        { label: 'Line total', num: true, render: (i) => money(Number(i.qty_ordered) * Number(i.unit_cost)) },
      ], items);
    }

    async function save() {
      const p = form.validate(); if (p) throw new Error(p);
      const lines = getLines();
      if (!lines.length) throw new Error('Add at least one line.');
      if (lines.some((l) => (!l.material_id && !l.product_id) || !l.qty_ordered || l.qty_ordered <= 0)) throw new Error('Each line needs an item and a quantity above zero.');
      const v = form.values();
      const q = isNew ? sb.from('purchase_orders').insert(v) : sb.from('purchase_orders').update(v).eq('id', row.id);
      const { data, error } = await q.select().single(); if (error) throw error;
      await syncRows(sb, 'purchase_order_items', items, lines, { po_id: data.id });
      return data;
    }
    const setStatus = async (st) => {
      const { error } = await sb.from('purchase_orders').update({ status: st }).eq('id', row.id);
      if (error) throw error;
    };

    const actions = [];
    if (row && canDel && ['draft', 'cancelled'].includes(status)) actions.push({
      label: 'Delete', kind: 'danger', left: true,
      onClick: async (close) => {
        if (!(await confirmDialog('Delete this purchase order?'))) return;
        const { error } = await sb.from('purchase_orders').delete().eq('id', row.id);
        if (error) return showErr(friendlyError(error)); toast('Deleted'); close(); refresh();
      },
    });
    if (row && canEdit && ['draft', 'ordered'].includes(status)) actions.push({
      label: 'Cancel order', kind: 'danger', left: !(row && canDel && ['draft', 'cancelled'].includes(status)),
      onClick: async (close) => {
        if (!(await confirmDialog('Cancel this purchase order?', 'Cancel order'))) return;
        try { await setStatus('cancelled'); toast('Order cancelled'); close(); refresh(); } catch (e) { showErr(friendlyError(e)); }
      },
    });
    actions.push({ label: editable ? 'Close' : 'Close', onClick: (c) => c() });
    if (row && canReceive && ['ordered', 'partial'].includes(status)) actions.push({
      label: 'Receive goods', kind: 'primary', onClick: (close) => { close(); openReceive(row); },
    });
    if (editable) {
      actions.push({ label: 'Save draft', onClick: async (close) => {
        try { await save(); toast('Saved'); close(); refresh(); } catch (e) { showErr(friendlyError(e)); }
      } });
      actions.push({ label: 'Save and mark as ordered', kind: 'primary', onClick: async (close) => {
        try {
          const saved = await save();
          const { error } = await sb.from('purchase_orders').update({ status: 'ordered' }).eq('id', saved.id); if (error) throw error;
          toast('Order placed: ' + saved.po_no); close(); refresh();
        } catch (e) { showErr(friendlyError(e)); }
      } });
    }
    openModal({
      title: row ? `${row.po_no} · ${STATUS[status][0]}` : 'New purchase order',
      body: h('div', {}, errBox, form.el, h('div', { class: 'section-title' }, 'Items'), linesEl), actions,
    });
  }

  // ---------- Receive goods ----------
  async function openReceive(po) {
    const open = await sb.from('purchase_orders').select('id, po_no, supplier_id, suppliers(name)').in('status', ['ordered', 'partial']).order('po_no');
    const openPOs = open.data || [];
    const locs = locOptions(ref);
    const form = buildForm([
      { key: 'po_id', label: 'Against purchase order', type: 'select', placeholder: '— none (goods without an order) —', options: openPOs.map((p) => ({ value: p.id, label: `${p.po_no} · ${p.suppliers ? p.suppliers.name : ''}` })), default: po ? po.id : '' },
      { key: 'supplier_id', label: 'Supplier', type: 'select', required: true, options: supOpts(true) },
      { key: 'location_id', label: 'Warehouse', type: 'select', required: true, options: locs, default: locs.length === 1 ? locs[0].value : '' },
      { key: 'received_on', label: 'Received on', type: 'date', required: true, default: today() },
      { key: 'supplier_ref', label: "Supplier's delivery note / invoice no." },
      { key: 'notes', label: 'Notes' },
    ]);
    const errBox = h('div', { class: 'error-box hidden' });
    const showErr = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };
    const linesBox = h('div');
    let getLines = () => [];

    const batchCells = (tracked) => {
      const bn = h('input', { type: 'text', placeholder: tracked ? 'Batch no.' : '—' }); const ex = h('input', { type: 'date' });
      if (!tracked) { bn.disabled = true; ex.disabled = true; } else bn.value = 'B-' + stamp();
      return { bn, ex };
    };

    async function buildLines() {
      clear(linesBox); const poId = form.getValue('po_id');
      form.inputs.supplier_id.disabled = !!poId;
      const head = h('thead', {}, h('tr', {}, ['Item', 'Quantity', 'Unit cost', 'Batch no.', 'Expiry'].map((x) => h('th', {}, x))));
      const tbody = h('tbody'); const rows = [];
      if (poId) {
        const p = openPOs.find((x) => x.id === poId); if (p) form.setValue('supplier_id', p.supplier_id);
        const [it, rc] = await Promise.all([
          sb.from('purchase_order_items').select('*').eq('po_id', poId),
          sb.from('goods_receipt_items').select('po_item_id, qty'),
        ]);
        const got = {}; for (const g of rc.data || []) if (g.po_item_id) got[g.po_item_id] = (got[g.po_item_id] || 0) + Number(g.qty);
        for (const i of it.data || []) {
          const out = Number(i.qty_ordered) - (got[i.id] || 0); if (out <= 0) continue;
          const prod = i.product_id ? ref.products.find((x) => x.id === i.product_id) : null;
          const qty = h('input', { type: 'number', step: 'any', min: 0 }); qty.value = out;
          const cost = h('input', { type: 'number', step: '0.01', min: 0 }); cost.value = i.unit_cost;
          const { bn, ex } = batchCells(!!(prod && prod.track_batches));
          tbody.append(h('tr', {}, h('td', { class: 'wrap' }, itemName(ref, i) + ' (outstanding ' + num(out) + ' ' + unitOf(ref, i) + ')'), h('td', {}, qty), h('td', {}, cost), h('td', {}, bn), h('td', {}, ex)));
          rows.push(() => ({ po_item_id: i.id, material_id: i.material_id, product_id: i.product_id, qty: Number(qty.value) || 0, unit_cost: Number(cost.value) || 0, batch_no: bn.disabled ? null : bn.value.trim() || null, expiry_date: ex.disabled ? null : ex.value || null }));
        }
        if (!rows.length) tbody.append(h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'Nothing is outstanding on this order.')));
        linesBox.append(h('div', { class: 'muted small', style: { marginBottom: '6px' } }, 'Set a quantity to 0 for items that did not arrive. Part deliveries are fine.'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'mini-table' }, head, tbody)));
      } else {
        const opts = itemOptions(ref);
        const add = () => {
          const sel = h('select', {}, h('option', { value: '' }, '— item —'), opts.map((o) => h('option', { value: o.value }, o.label)));
          const qty = h('input', { type: 'number', step: 'any', min: 0 }); const cost = h('input', { type: 'number', step: '0.01', min: 0 });
          const bn = h('input', { type: 'text', placeholder: '—', disabled: true }); const ex = h('input', { type: 'date', disabled: true });
          sel.addEventListener('change', () => {
            const it = parseItem(sel.value); const prod = it.product_id ? ref.products.find((x) => x.id === it.product_id) : null;
            const tracked = !!(prod && prod.track_batches); bn.disabled = !tracked; ex.disabled = !tracked;
            bn.placeholder = tracked ? 'Batch no.' : '—'; bn.value = tracked ? 'B-' + stamp() : '';
          });
          const tr = h('tr', {}, h('td', {}, sel), h('td', {}, qty), h('td', {}, cost), h('td', {}, bn), h('td', {}, ex));
          tbody.append(tr);
          rows.push(() => (!sel.value && !qty.value ? null : { po_item_id: null, ...parseItem(sel.value), qty: Number(qty.value) || 0, unit_cost: Number(cost.value) || 0, batch_no: bn.disabled ? null : bn.value.trim() || null, expiry_date: ex.disabled ? null : ex.value || null }));
        };
        add();
        linesBox.append(h('div', { class: 'table-wrap' }, h('table', { class: 'mini-table' }, head, tbody)),
          h('button', { class: 'btn sm', type: 'button', style: { marginTop: '8px' }, onclick: add }, '+ Add line'));
      }
      getLines = () => rows.map((f) => f()).filter(Boolean).filter((l) => l.qty > 0);
    }
    form.inputs.po_id.addEventListener('change', buildLines);
    await buildLines();

    openModal({
      title: 'Receive goods', body: h('div', {}, errBox, form.el, h('div', { class: 'section-title' }, 'Items received'), linesBox),
      actions: [
        { label: 'Cancel', onClick: (c) => c() },
        { label: 'Record receipt', kind: 'primary', onClick: async (close) => {
          errBox.classList.add('hidden');
          const poId = form.getValue('po_id');
          const p = form.validate(); if (p && !(poId && /Supplier/.test(p))) return showErr(p);
          const lines = getLines(); if (!lines.length) return showErr('Enter the quantity received for at least one item.');
          const v = form.values();
          const { error } = await sb.rpc('receive_goods', {
            p_po_id: poId || null, p_supplier_id: poId ? (openPOs.find((x) => x.id === poId) || {}).supplier_id : v.supplier_id,
            p_location_id: v.location_id, p_received_on: v.received_on, p_supplier_ref: v.supplier_ref, p_notes: v.notes, p_items: lines,
          });
          if (error) return showErr(friendlyError(error));
          toast('Goods received and stock updated'); close(); refresh();
        } },
      ],
    });
  }

  // ---------- Goods received list ----------
  async function receiptsTab() {
    const { data, error } = await sb.from('goods_receipts')
      .select('*, suppliers(name), stock_locations(name), purchase_orders(po_no), goods_receipt_items(qty, unit_cost, material_id, product_id, product_batches(batch_no))')
      .order('received_on', { ascending: false }).order('created_at', { ascending: false });
    if (error) return clear(body).append(h('div', { class: 'error-box' }, friendlyError(error)));
    const search = h('input', { class: 'search', type: 'search', placeholder: 'Search receipts…' });
    const box = h('div', { class: 'card' });
    const value = (r) => (r.goods_receipt_items || []).reduce((a, i) => a + Number(i.qty) * Number(i.unit_cost), 0);
    const draw = () => {
      const term = search.value.trim().toLowerCase();
      const list = data.filter((r) => !term || `${r.grn_no} ${r.suppliers ? r.suppliers.name : ''} ${r.purchase_orders ? r.purchase_orders.po_no : ''} ${r.supplier_ref || ''}`.toLowerCase().includes(term));
      clear(box).append(dataTable([
        { label: 'GRN', key: 'grn_no' }, { label: 'Received', render: (r) => dateOnly(r.received_on) },
        { label: 'Supplier', render: (r) => (r.suppliers ? r.suppliers.name : '') },
        { label: 'PO', render: (r) => (r.purchase_orders ? r.purchase_orders.po_no : '') },
        { label: 'Warehouse', render: (r) => (r.stock_locations ? r.stock_locations.name : '') },
        { label: 'Lines', num: true, render: (r) => (r.goods_receipt_items || []).length },
        { label: 'Value', num: true, render: (r) => money(value(r)) },
        { label: 'Supplier ref.', key: 'supplier_ref' }, { label: 'By', key: 'user_name' },
      ], list, (r) => openModal({
        title: `${r.grn_no} · ${dateOnly(r.received_on)}`,
        body: h('div', {}, h('p', { class: 'muted small' }, `${r.suppliers ? r.suppliers.name : ''}${r.purchase_orders ? ' · ' + r.purchase_orders.po_no : ''} · recorded ${dateTime(r.created_at)}`),
          r.notes ? h('p', {}, r.notes) : null,
          dataTable([
            { label: 'Item', render: (i) => itemName(ref, i) },
            { label: 'Batch', render: (i) => (i.product_batches ? i.product_batches.batch_no : '') },
            { label: 'Quantity', num: true, render: (i) => num(i.qty) + ' ' + unitOf(ref, i) },
            { label: 'Unit cost', num: true, render: (i) => money(i.unit_cost) },
          ], r.goods_receipt_items || [])),
        actions: [{ label: 'Close', onClick: (c) => c() }],
      })));
    };
    search.addEventListener('input', draw);
    clear(body).append(h('div', { class: 'toolbar', style: { marginBottom: '12px' } }, search), box);
    draw();
  }

  clear(container).append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Purchasing'), h('div', { class: 'muted small' }, 'Order tea and packaging from suppliers and record what arrives.')),
      h('div', { class: 'toolbar' },
        canReceive ? h('button', { class: 'btn', onclick: () => openReceive(null) }, 'Receive goods') : null,
        canEdit ? h('button', { class: 'btn primary', onclick: () => openPO(null) }, '+ New purchase order') : null)),
    tabs, body);
  await setTab('orders');
}
