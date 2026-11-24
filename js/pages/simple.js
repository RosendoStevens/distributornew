// Areas, customers, suppliers and agents: list + form pages.
import { sb, state, can, optionsFrom } from '../db.js';
import { crudPage } from '../crud.js';
import { badge, money, toast } from '../ui.js';

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const status = (r) => badge(r.active ? 'Active' : 'Inactive', r.active ? 'ok' : '');
const isAgent = () => state.profile && state.profile.role === 'agent';

// ---------- Areas ----------
export const areasPage = crudPage({
  title: 'Areas', itemName: 'area', module: 'areas', table: 'areas', order: 'name',
  subtitle: 'Sales territories. Agents and customers belong to areas.',
  fields: [
    { key: 'name', label: 'Area name', required: true },
    { key: 'district', label: 'District' },
    { key: 'active', label: 'Active', type: 'checkbox', default: true },
  ],
  columns: [
    { label: 'Area', key: 'name' }, { label: 'District', key: 'district' }, { label: 'Status', render: status },
  ],
  searchText: (r) => `${r.name} ${r.district || ''}`,
});

// ---------- Suppliers ----------
export const suppliersPage = crudPage({
  title: 'Suppliers', itemName: 'supplier', module: 'suppliers', table: 'suppliers', order: 'name',
  subtitle: 'Tea suppliers, packaging suppliers and others.',
  fields: [
    { key: 'code', label: 'Code', readonlyOnEdit: true, placeholder: 'Auto', hint: 'Leave blank to generate' },
    { key: 'name', label: 'Supplier name', required: true },
    { key: 'type', label: 'Type', type: 'select', required: true, default: 'tea',
      options: [{ value: 'tea', label: 'Tea' }, { value: 'packaging', label: 'Packaging' }, { value: 'other', label: 'Other' }] },
    { key: 'contact_name', label: 'Contact person' },
    { key: 'phone', label: 'Phone', type: 'tel' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'payment_terms_days', label: 'Payment terms (days)', type: 'number', default: 0, min: 0 },
    { key: 'address', label: 'Address', type: 'textarea' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
    { key: 'active', label: 'Active', type: 'checkbox', default: true },
  ],
  filters: [{ key: 'type', label: 'Types', options: [{ value: 'tea', label: 'Tea' }, { value: 'packaging', label: 'Packaging' }, { value: 'other', label: 'Other' }] }],
  columns: [
    { label: 'Code', key: 'code' }, { label: 'Name', key: 'name' }, { label: 'Type', render: (r) => cap(r.type) },
    { label: 'Contact', key: 'contact_name' }, { label: 'Phone', key: 'phone' },
    { label: 'Terms', num: true, render: (r) => (r.payment_terms_days ? r.payment_terms_days + ' days' : 'Cash') },
    { label: 'Status', render: status },
  ],
  searchText: (r) => `${r.code} ${r.name} ${r.contact_name || ''} ${r.phone || ''}`,
});

// ---------- Customers ----------
const CUSTOMER_TYPES = [
  { value: 'grocery', label: 'Grocery shop' }, { value: 'supermarket', label: 'Supermarket' },
  { value: 'wholesale', label: 'Wholesale' }, { value: 'other', label: 'Other' },
];

export const customersPage = crudPage({
  title: 'Customers', itemName: 'customer', module: 'customers', table: 'customers', order: 'name',
  select: '*, areas(name), agents(full_name)',
  subtitle: 'Grocery shops and supermarkets you sell to.',
  fields: async () => [
    { key: 'code', label: 'Code', readonlyOnEdit: true, placeholder: 'Auto', hint: 'Leave blank to generate' },
    { key: 'name', label: 'Shop name', required: true },
    { key: 'type', label: 'Type', type: 'select', required: true, default: 'grocery', options: CUSTOMER_TYPES },
    { key: 'contact_name', label: 'Contact person' },
    { key: 'phone', label: 'Phone', type: 'tel' },
    { key: 'area_id', label: 'Area', type: 'select', options: await optionsFrom('areas', 'name', { filter: (q) => q.eq('active', true) }) },
    { key: 'agent_id', label: 'Agent', type: 'select', hidden: isAgent,
      options: isAgent() ? [] : await optionsFrom('agents', 'full_name', { filter: (q) => q.eq('active', true) }) },
    { key: 'address', label: 'Address', type: 'textarea' },
    { key: 'latitude', label: 'Latitude', type: 'number', step: 'any' },
    { key: 'longitude', label: 'Longitude', type: 'number', step: 'any' },
    { key: '_geo', type: 'button', label: '📍 Use my current location',
      onClick: (api) => {
        if (!navigator.geolocation) return toast('Location is not available on this device', 'bad');
        navigator.geolocation.getCurrentPosition(
          (p) => { api.setValue('latitude', +p.coords.latitude.toFixed(6)); api.setValue('longitude', +p.coords.longitude.toFixed(6)); },
          () => toast('Could not get your location. Allow location access and try again.', 'bad'));
      } },
    { key: 'credit_limit', label: 'Credit limit (LKR)', type: 'number', step: '0.01', min: 0, default: 0,
      hint: 'Maximum unpaid balance. 0 means cash only.' },
    { key: 'credit_days', label: 'Credit days', type: 'number', min: 0, default: 0 },
    { key: 'notes', label: 'Notes', type: 'textarea' },
    { key: 'active', label: 'Active', type: 'checkbox', default: true },
  ],
  filters: async () => [
    { key: 'type', label: 'Types', options: CUSTOMER_TYPES },
    { key: 'area_id', label: 'Areas', options: await optionsFrom('areas') },
    ...(isAgent() ? [] : [{ key: 'agent_id', label: 'Agents', options: await optionsFrom('agents', 'full_name') }]),
  ],
  beforeSave: (payload) => {
    if (isAgent()) {
      if (!state.myAgentId) throw new Error('Your login is not linked to an agent record yet. Ask the Admin to link it.');
      payload.agent_id = state.myAgentId;
    }
  },
  columns: [
    { label: 'Code', key: 'code' }, { label: 'Shop', key: 'name' },
    { label: 'Type', render: (r) => (CUSTOMER_TYPES.find((t) => t.value === r.type) || {}).label || r.type },
    { label: 'Area', render: (r) => (r.areas ? r.areas.name : '') },
    { label: 'Agent', render: (r) => (r.agents ? r.agents.full_name : '') },
    { label: 'Phone', key: 'phone' },
    { label: 'Credit limit', num: true, render: (r) => money(r.credit_limit) },
    { label: 'Status', render: status },
  ],
  searchText: (r) => `${r.code} ${r.name} ${r.contact_name || ''} ${r.phone || ''} ${r.address || ''}`,
});

// ---------- Agents ----------
export const agentsPage = crudPage({
  title: 'Agents', itemName: 'agent', module: 'agents', table: 'agents', order: 'full_name',
  select: '*, agent_areas(area_id, areas(name))',
  subtitle: 'Field agents who take orders. Add a login for each agent under Staff and roles, then link it here.',
  fields: async () => {
    const areaOpts = await optionsFrom('areas', 'name', { filter: (q) => q.eq('active', true) });
    let loginOpts = [];
    if (can('users', 'view')) {
      const { data } = await sb.from('profiles').select('id, full_name, email').eq('role', 'agent').eq('active', true).order('full_name');
      loginOpts = (data || []).map((p) => ({ value: p.id, label: (p.full_name || p.email) + ' (' + p.email + ')' }));
    }
    return [
      { key: 'code', label: 'Agent code', readonlyOnEdit: true, placeholder: 'Auto', hint: 'Leave blank to generate' },
      { key: 'full_name', label: 'Full name', required: true },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'join_date', label: 'Joined on', type: 'date' },
      { key: 'address', label: 'Address', type: 'textarea' },
      { key: 'area_ids', label: 'Areas covered', type: 'checks', options: areaOpts, virtual: true },
      ...(can('users', 'view') ? [{ key: 'profile_id', label: 'Login account', type: 'select', options: loginOpts,
        hint: 'Create the login in Staff and roles (role: Agent), then pick it here.' }] : []),
      { key: 'bank_name', label: 'Bank' },
      { key: 'bank_account', label: 'Bank account' },
      { key: 'is_salaried', label: 'Salaried staff (attendance and payroll)', type: 'checkbox', default: false },
      { key: 'base_salary', label: 'Monthly salary (LKR)', type: 'number', step: '0.01', min: 0, hint: 'Only if salaried.' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
      { key: 'active', label: 'Active', type: 'checkbox', default: true },
    ];
  },
  loadExtra: async (row) => {
    const { data } = await sb.from('agent_areas').select('area_id').eq('agent_id', row.id);
    return { area_ids: (data || []).map((r) => r.area_id) };
  },
  afterSave: async (saved, virt) => {
    const ids = virt.area_ids || [];
    const del = await sb.from('agent_areas').delete().eq('agent_id', saved.id);
    if (del.error) throw del.error;
    if (ids.length) {
      const ins = await sb.from('agent_areas').insert(ids.map((area_id) => ({ agent_id: saved.id, area_id })));
      if (ins.error) throw ins.error;
    }
  },
  beforeSave: (payload) => { if (!payload.is_salaried) payload.base_salary = null; },
  filters: [{ key: 'is_salaried', label: 'Pay types', options: [{ value: 'true', label: 'Salaried' }, { value: 'false', label: 'Margin only' }] }],
  columns: [
    { label: 'Code', key: 'code' }, { label: 'Name', key: 'full_name' }, { label: 'Phone', key: 'phone' },
    { label: 'Areas', wrap: true, render: (r) => (r.agent_areas || []).map((a) => a.areas && a.areas.name).filter(Boolean).join(', ') },
    { label: 'Pay', render: (r) => badge(r.is_salaried ? 'Salaried' : 'Margin only', r.is_salaried ? 'warn' : '') },
    { label: 'Login', render: (r) => badge(r.profile_id ? 'Linked' : 'None', r.profile_id ? 'ok' : '') },
    { label: 'Status', render: status },
  ],
  searchText: (r) => `${r.code} ${r.full_name} ${r.phone || ''}`,
});

// ---------- Materials (tea, packaging) ----------
const MATERIAL_CATS = [{ value: 'tea', label: 'Tea' }, { value: 'packaging', label: 'Packaging' }, { value: 'other', label: 'Other' }];
export const materialsPage = crudPage({
  title: 'Materials', itemName: 'material', module: 'stock', table: 'materials', order: 'name',
  subtitle: 'Raw tea and packaging you buy from suppliers and use when packing.',
  fields: [
    { key: 'code', label: 'Code', readonlyOnEdit: true, placeholder: 'Auto', hint: 'Leave blank to generate' },
    { key: 'name', label: 'Material name', required: true, placeholder: 'Black tea BOPF' },
    { key: 'category', label: 'Category', type: 'select', required: true, default: 'tea', options: MATERIAL_CATS },
    { key: 'unit', label: 'Unit', required: true, default: 'kg', hint: 'kg, g, pcs, boxes...' },
    { key: 'reorder_level', label: 'Reorder level', type: 'number', step: 'any', min: 0, default: 0, hint: 'Shows a Low warning at or below this quantity.' },
    { key: 'active', label: 'Active', type: 'checkbox', default: true },
  ],
  filters: [{ key: 'category', label: 'Categories', options: MATERIAL_CATS }],
  columns: [
    { label: 'Code', key: 'code' }, { label: 'Material', key: 'name' }, { label: 'Category', render: (r) => cap(r.category) },
    { label: 'Unit', key: 'unit' }, { label: 'Reorder at', num: true, render: (r) => (Number(r.reorder_level) ? Number(r.reorder_level) : '') },
    { label: 'Status', render: status },
  ],
  searchText: (r) => `${r.code} ${r.name}`,
});

// ---------- Warehouses ----------
export const locationsPage = crudPage({
  title: 'Warehouses', itemName: 'warehouse', module: 'stock', table: 'stock_locations', order: 'name',
  subtitle: 'Places where stock is kept. One is enough to start.',
  fields: [
    { key: 'name', label: 'Warehouse name', required: true },
    { key: 'active', label: 'Active', type: 'checkbox', default: true },
  ],
  columns: [{ label: 'Warehouse', key: 'name' }, { label: 'Status', render: status }],
  searchText: (r) => r.name,
});
