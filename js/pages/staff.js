// Staff logins, roles, and the editable permission matrix.
import { sb, state, can, tempClient, ROLES, MODULES, roleLabel } from '../db.js';
import { h, clear, openModal, buildForm, toast, friendlyError, dataTable, badge, dateTime } from '../ui.js';

const roleOptions = ROLES.map((r) => ({ value: r.key, label: r.label }));

export async function staffPage(container) {
  const isAdmin = state.profile.role === 'admin';
  const body = h('div');
  const tabs = h('div', { class: 'tabs' });
  let current = 'people';

  const setTab = async (t) => {
    current = t;
    clear(tabs).append(
      h('button', { class: current === 'people' ? 'active' : '', onclick: () => setTab('people') }, 'People'),
      isAdmin ? h('button', { class: current === 'perms' ? 'active' : '', onclick: () => setTab('perms') }, 'Permissions') : null);
    clear(body);
    if (current === 'people') await peopleTab(body); else await permsTab(body);
  };

  clear(container).append(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Staff and roles'),
      h('div', { class: 'muted small' }, 'Logins for admins, staff, drivers and agents, and what each role can do.'))),
    tabs, body);
  await setTab('people');
}

async function peopleTab(box) {
  const canEdit = can('users', 'edit');
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Search people…' });
  const listBox = h('div', { class: 'card' });
  let rows = [];

  async function load() {
    const { data, error } = await sb.from('profiles').select('*').order('full_name');
    if (error) return toast(friendlyError(error), 'bad');
    rows = data || []; draw();
  }
  function draw() {
    const term = search.value.trim().toLowerCase();
    const list = rows.filter((r) => !term || `${r.full_name} ${r.email} ${r.phone || ''}`.toLowerCase().includes(term));
    clear(listBox).append(dataTable([
      { label: 'Name', render: (r) => r.full_name || '(no name)' },
      { label: 'Email', key: 'email' }, { label: 'Phone', key: 'phone' },
      { label: 'Role', render: (r) => roleLabel(r.role) },
      { label: 'Status', render: (r) => (r.active ? badge('Active', 'ok') : badge('Waiting for approval', 'warn')) },
      { label: 'Added', render: (r) => dateTime(r.created_at) },
    ], list, openEdit));
  }
  search.addEventListener('input', draw);

  function openAdd() {
    const form = buildForm([
      { key: 'full_name', label: 'Full name', required: true },
      { key: 'email', label: 'Email (used to sign in)', type: 'email', required: true },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'role', label: 'Role', type: 'select', required: true, default: 'agent', options: roleOptions },
      { key: 'password', label: 'Starting password', type: 'password', required: true, hint: 'At least 6 characters. Tell the person to change it under My account.' },
      { key: 'active', label: 'Can sign in now', type: 'checkbox', default: true },
    ]);
    const errBox = h('div', { class: 'error-box hidden' });
    const showErr = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };
    openModal({
      title: 'Add staff login', body: h('div', {}, errBox, form.el),
      actions: [
        { label: 'Cancel', onClick: (c) => c() },
        { label: 'Create login', kind: 'primary', onClick: async (close) => {
          errBox.classList.add('hidden');
          const p = form.validate(); if (p) return showErr(p);
          const v = form.values();
          if (v.password.length < 6) return showErr('Password must be at least 6 characters.');
          if (v.role === 'admin' && state.profile.role !== 'admin') return showErr('Only an Admin can create another Admin.');
          try {
            const { data, error } = await tempClient().auth.signUp({ email: v.email, password: v.password, options: { data: { full_name: v.full_name } } });
            if (error) throw error;
            const user = data.user;
            if (!user || (user.identities && user.identities.length === 0)) throw new Error('This email is already registered.');
            const { error: e2 } = await sb.from('profiles').update({ full_name: v.full_name, phone: v.phone, role: v.role, active: v.active }).eq('id', user.id);
            if (e2) throw e2;
            toast('Login created'); close(); load();
          } catch (e) { showErr(friendlyError(e)); }
        } },
      ],
    });
  }

  function openEdit(row) {
    const self = row.id === state.profile.id;
    const lockedAdmin = row.role === 'admin' && state.profile.role !== 'admin';
    const ro = !canEdit || lockedAdmin;
    const form = buildForm([
      { key: 'full_name', label: 'Full name', required: true, readonly: ro },
      { key: 'email', label: 'Email', readonly: true },
      { key: 'phone', label: 'Phone', type: 'tel', readonly: ro },
      { key: 'role', label: 'Role', type: 'select', required: true, options: roleOptions, readonly: ro || self,
        hint: self ? 'You cannot change your own role.' : null },
      { key: 'active', label: 'Can sign in', type: 'checkbox', readonly: ro || self },
    ], row);
    const errBox = h('div', { class: 'error-box hidden' });
    const showErr = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };
    const actions = [];
    if (canEdit && !lockedAdmin) actions.push({
      label: 'Send password reset email', left: true,
      onClick: async () => {
        const { error } = await sb.auth.resetPasswordForEmail(row.email, { redirectTo: location.origin + location.pathname });
        if (error) showErr(friendlyError(error)); else toast('Reset email sent to ' + row.email);
      },
    });
    actions.push({ label: ro ? 'Close' : 'Cancel', onClick: (c) => c() });
    if (!ro) actions.push({
      label: 'Save', kind: 'primary',
      onClick: async (close) => {
        const p = form.validate(); if (p) return showErr(p);
        const v = form.values();
        const payload = { full_name: v.full_name, phone: v.phone };
        if (!self) { payload.role = v.role; payload.active = v.active; }
        const { error } = await sb.from('profiles').update(payload).eq('id', row.id);
        if (error) return showErr(friendlyError(error));
        toast('Saved'); close(); load();
      },
    });
    openModal({ title: row.full_name || row.email, body: h('div', {}, errBox, form.el), actions });
  }

  box.append(h('div', { class: 'toolbar', style: { marginBottom: '12px' } }, search,
    canEdit ? h('button', { class: 'btn primary', onclick: openAdd }, '+ Add staff login') : null), listBox);
  await load();
}

async function permsTab(box) {
  const { data, error } = await sb.from('role_permissions').select('*');
  if (error) return box.append(h('div', { class: 'error-box' }, friendlyError(error)));
  const map = {}; for (const r of data) map[r.role + '|' + r.module] = r.level;
  const levels = [['none', 'No access'], ['view', 'View'], ['edit', 'Edit'], ['full', 'Full']];
  const selects = {};
  const head = h('tr', {}, h('th', {}, 'Area'), ROLES.map((r) => h('th', {}, r.label)));
  const rows = MODULES.map((m) => h('tr', {}, h('td', {}, m.label), ROLES.map((r) => {
    if (r.key === 'admin') return h('td', {}, badge('Full', 'ok'));
    const s = h('select', {}, levels.map(([v, l]) => h('option', { value: v }, l)));
    s.value = map[r.key + '|' + m.key] || 'none'; selects[r.key + '|' + m.key] = s;
    return h('td', {}, s);
  })));
  box.append(
    h('div', { class: 'info-box' }, 'No access: hidden. View: read only. Edit: add and change. Full: also delete. Admin always has full access. Agents only ever see their own customers, whatever is set here.'),
    h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'perm-table' }, h('thead', {}, head), h('tbody', {}, rows)))),
    h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: async (e) => {
      e.target.disabled = true;
      const payload = Object.entries(selects).map(([k, s]) => { const [role, module] = k.split('|'); return { role, module, level: s.value }; });
      const { error: err } = await sb.from('role_permissions').upsert(payload, { onConflict: 'role,module' });
      e.target.disabled = false;
      if (err) toast(friendlyError(err), 'bad'); else toast('Permissions saved');
    } }, 'Save permissions')));
}
