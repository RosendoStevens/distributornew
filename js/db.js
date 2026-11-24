// Supabase client, signed-in state and permission checks.

const cfg = window.APP_CONFIG || {};
export const configured = !!cfg.SUPABASE_URL && !cfg.SUPABASE_URL.startsWith('YOUR_') &&
  !!cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.startsWith('YOUR_');

export const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

export const MODULES = [
  { key: 'users', label: 'Staff and roles' },
  { key: 'agents', label: 'Agents' },
  { key: 'areas', label: 'Areas' },
  { key: 'customers', label: 'Customers' },
  { key: 'products', label: 'Products and prices' },
  { key: 'costs', label: 'Cost prices' },
  { key: 'margins', label: 'Agent margins' },
  { key: 'overrides', label: 'Head of sales override' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'purchasing', label: 'Purchasing' },
  { key: 'stock', label: 'Stock' },
  { key: 'settings', label: 'Settings' },
  { key: 'audit', label: 'Audit log' },
];

export const ROLES = [
  { key: 'admin', label: 'Admin / Owner' },
  { key: 'head_of_sales', label: 'Head of Sales' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'store_keeper', label: 'Store keeper' },
  { key: 'delivery', label: 'Delivery staff' },
  { key: 'agent', label: 'Agent' },
];
export const roleLabel = (k) => (ROLES.find((r) => r.key === k) || { label: k }).label;

export const state = { user: null, profile: null, perms: {}, settings: {}, myAgentId: null };

const rank = (l) => ({ none: 0, view: 1, edit: 2, full: 3 }[l] ?? 0);

export function can(module, level = 'view') {
  if (!state.profile || !state.profile.active) return false;
  if (state.profile.role === 'admin') return true;
  return rank(state.perms[module]) >= rank(level);
}

export async function loadAccount() {
  const { data: { session } } = await sb.auth.getSession();
  state.user = session ? session.user : null;
  state.profile = null; state.perms = {}; state.myAgentId = null;
  if (!state.user) return;
  const { data: profile } = await sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
  state.profile = profile;
  if (!profile || !profile.active) return;
  const { data: perms } = await sb.from('role_permissions').select('module, level').eq('role', profile.role);
  state.perms = Object.fromEntries((perms || []).map((p) => [p.module, p.level]));
  if (profile.role === 'agent') {
    const { data: ag } = await sb.from('agents').select('id').eq('profile_id', profile.id).maybeSingle();
    state.myAgentId = ag ? ag.id : null;
  }
  await loadSettings();
}

export async function loadSettings() {
  const { data } = await sb.from('settings').select('key, value');
  state.settings = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
}

export const setting = (key, fallback = {}) => state.settings[key] || fallback;

// Options helper for select fields
export async function optionsFrom(table, labelKey = 'name', { filter, order } = {}) {
  let q = sb.from(table).select('*').order(order || labelKey);
  if (filter) q = filter(q);
  const { data } = await q;
  return (data || []).map((r) => ({ value: r.id, label: r[labelKey] }));
}

// A separate client that never stores a session. Used by the Admin to create
// staff logins without being signed out.
export const tempClient = () => window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'tmp-signup-client' },
});
