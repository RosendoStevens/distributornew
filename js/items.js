// Shared helpers for stock and purchasing screens.
import { sb } from './db.js';

export async function loadRef() {
  const [p, m, l] = await Promise.all([
    sb.from('products').select('id, sku, name, pack_size, track_batches, active, reorder_level').order('name'),
    sb.from('materials').select('*').order('name'),
    sb.from('stock_locations').select('*').order('name'),
  ]);
  return { products: p.data || [], materials: m.data || [], locations: l.data || [] };
}

export const productLabel = (p) => p.name + (p.pack_size ? ' (' + p.pack_size + ')' : '');

// Select options mixing materials and finished products. Values look like "m:<id>" or "p:<id>".
export function itemOptions(ref, activeOnly = true) {
  return [
    ...ref.materials.filter((m) => !activeOnly || m.active).map((m) => ({ value: 'm:' + m.id, label: 'Material: ' + m.name + ' (' + m.unit + ')' })),
    ...ref.products.filter((p) => !activeOnly || p.active).map((p) => ({ value: 'p:' + p.id, label: 'Product: ' + productLabel(p) })),
  ];
}

export function parseItem(v) {
  if (!v) return { material_id: null, product_id: null };
  return { material_id: v[0] === 'm' ? v.slice(2) : null, product_id: v[0] === 'p' ? v.slice(2) : null };
}

export function itemName(ref, row) {
  if (row.material_id) { const m = ref.materials.find((x) => x.id === row.material_id); return m ? m.name : 'Material'; }
  const p = ref.products.find((x) => x.id === row.product_id); return p ? productLabel(p) : 'Product';
}

export const unitOf = (ref, row) => {
  if (row.material_id) { const m = ref.materials.find((x) => x.id === row.material_id); return m ? m.unit : ''; }
  return 'packs';
};

export const locOptions = (ref) => ref.locations.filter((l) => l.active).map((l) => ({ value: l.id, label: l.name }));
