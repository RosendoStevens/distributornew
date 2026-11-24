// App shell: sign in, menu, routing.
import { sb, configured, state, can, loadAccount, setting, roleLabel } from './db.js';
import { h, clear, toast, friendlyError, buildForm } from './ui.js';
import { dashboardPage } from './pages/dashboard.js';
import { customersPage, agentsPage, areasPage, suppliersPage, materialsPage, locationsPage } from './pages/simple.js';
import { stockPage } from './pages/stock.js';
import { purchasingPage } from './pages/purchasing.js';
import { productsPage } from './pages/products.js';
import { staffPage } from './pages/staff.js';
import { settingsPage } from './pages/settings.js';
import { auditPage } from './pages/audit.js';
import { accountPage } from './pages/account.js';

const app = document.getElementById('app');

const ROUTES = [
  { path: 'dashboard', label: 'Home', icon: '🏠', render: dashboardPage },
  { group: 'Sales' },
  { path: 'customers', label: 'Customers', icon: '🏪', module: 'customers', render: customersPage },
  { path: 'agents', label: 'Agents', icon: '🧑‍💼', module: 'agents', render: agentsPage },
  { path: 'areas', label: 'Areas', icon: '📍', module: 'areas', render: areasPage },
  { path: 'products', label: 'Products and prices', icon: '🍃', module: 'products', render: productsPage },
  { group: 'Stock and buying' },
  { path: 'stock', label: 'Stock', icon: '📦', module: 'stock', render: stockPage },
  { path: 'purchasing', label: 'Purchasing', icon: '🛒', module: 'purchasing', render: purchasingPage },
  { path: 'suppliers', label: 'Suppliers', icon: '🚚', module: 'suppliers', render: suppliersPage },
  { path: 'materials', label: 'Materials', icon: '🌿', module: 'stock', render: materialsPage },
  { path: 'locations', label: 'Warehouses', icon: '🏭', module: 'stock', render: locationsPage },
  { group: 'Admin' },
  { path: 'staff', label: 'Staff and roles', icon: '👥', module: 'users', render: staffPage },
  { path: 'settings', label: 'Settings', icon: '⚙️', module: 'settings', render: settingsPage },
  { path: 'audit', label: 'Audit log', icon: '🧾', module: 'audit', render: auditPage },
  { path: 'account', label: 'My account', icon: '🔑', render: accountPage },
];

// ---------- Theme ----------
function applyTheme() {
  let t = null;
  try { t = localStorage.getItem('theme'); } catch (e) { /* storage unavailable */ }
  if (!t) t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch (e) { /* ignore */ }
}
applyTheme();

// ---------- Screens before sign in ----------
function authShell(...kids) { clear(app).append(h('div', { class: 'auth-wrap' }, h('div', { class: 'card auth-card' }, ...kids))); }

function renderSetup() {
  authShell(h('h1', {}, 'Almost there'),
    h('p', {}, 'Open ', h('b', {}, 'config.js'), ' and paste your Supabase project URL and anon key, then reload this page.'));
}

function renderLogin(mode = 'signin') {
  const signup = mode === 'signup';
  const form = buildForm([
    ...(signup ? [{ key: 'full_name', label: 'Your name', required: true }] : []),
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'password', label: 'Password', type: 'password', required: true },
  ]);
  form.el.style.gridTemplateColumns = '1fr';
  const msg = h('div', { class: 'error-box hidden' });
  const note = h('div', { class: 'info-box hidden' });
  const fail = (m) => { msg.textContent = m; msg.classList.remove('hidden'); };

  const submit = async (e) => {
    e.preventDefault(); msg.classList.add('hidden'); note.classList.add('hidden');
    const bad = form.validate(); if (bad) return fail(bad);
    const v = form.values(); const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      if (signup) {
        if (v.password.length < 6) throw new Error('Password must be at least 6 characters.');
        const { data, error } = await sb.auth.signUp({ email: v.email, password: v.password, options: { data: { full_name: v.full_name } } });
        if (error) throw error;
        if (!data.session) { note.textContent = 'Account created. Check your email to confirm it, then sign in.'; note.classList.remove('hidden'); btn.disabled = false; return; }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: v.email, password: v.password });
        if (error) throw new Error(/invalid login/i.test(error.message) ? 'Wrong email or password.' : error.message);
      }
      await boot();
    } catch (err) { fail(friendlyError(err)); btn.disabled = false; }
  };

  authShell(
    h('h1', {}, 'Distribution Manager'),
    h('div', { class: 'muted' }, signup ? 'Create an account' : 'Sign in to continue'),
    h('form', { onsubmit: submit }, msg, note, form.el,
      h('button', { class: 'btn primary', type: 'submit' }, signup ? 'Create account' : 'Sign in')),
    h('p', { class: 'small muted', style: { marginTop: '16px' } },
      signup ? 'The very first account becomes the Admin. Later accounts wait for the Admin to approve them. ' : 'New here? ',
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); renderLogin(signup ? 'signin' : 'signup'); } }, signup ? 'Back to sign in' : 'Create an account')));
}

function renderPending() {
  authShell(h('h1', {}, 'Waiting for approval'),
    h('p', {}, 'Your account (' + state.user.email + ') has been created. The Admin needs to approve it before you can use the system.'),
    h('button', { class: 'btn', onclick: async () => { await boot(); } }, 'Check again'), ' ',
    h('button', { class: 'btn', onclick: signOut }, 'Sign out'));
}

async function signOut() { await sb.auth.signOut(); await boot(); }

// ---------- Main shell ----------
let contentEl = null;

function renderShell() {
  const company = setting('company', {});
  const navItems = [];
  let pendingGroup = null;
  for (const r of ROUTES) {
    if (r.group) { pendingGroup = r.group; continue; }
    if (r.module && !can(r.module, 'view')) continue;
    if (pendingGroup) { navItems.push(h('div', { class: 'nav-group' }, pendingGroup)); pendingGroup = null; }
    navItems.push(h('a', { href: '#/' + r.path, 'data-path': r.path, onclick: closeMenu }, h('span', { class: 'ico' }, r.icon), r.label));
  }
  const nav = h('nav', { class: 'nav' }, navItems);
  const side = h('aside', { class: 'sidebar', id: 'sidebar' },
    h('div', { class: 'brand' }, h('div', { class: 'name' }, company.name || 'Distribution Manager'), h('div', { class: 'sub' }, 'Distribution Manager')),
    nav,
    h('div', { class: 'side-foot' },
      h('div', {}, h('b', {}, state.profile.full_name || state.profile.email)), h('div', { class: 'muted' }, roleLabel(state.profile.role)),
      h('div', { style: { marginTop: '8px', display: 'flex', gap: '8px' } },
        h('button', { class: 'btn sm', onclick: toggleTheme }, '🌓 Theme'), h('button', { class: 'btn sm', onclick: signOut }, 'Sign out'))));
  const scrim = h('div', { class: 'scrim', id: 'scrim', onclick: closeMenu });
  contentEl = h('div', { class: 'content', id: 'content' });
  const main = h('div', { class: 'main' },
    h('div', { class: 'topbar' }, h('button', { class: 'btn sm', 'aria-label': 'Menu', onclick: openMenu }, '☰'),
      h('b', {}, company.name || 'Distribution Manager')),
    contentEl);
  clear(app).append(h('div', { class: 'shell' }, side, scrim, main));
}
function openMenu() { document.getElementById('sidebar').classList.add('open'); document.getElementById('scrim').classList.add('show'); }
function closeMenu() { const s = document.getElementById('sidebar'); if (s) { s.classList.remove('open'); document.getElementById('scrim').classList.remove('show'); } }

async function route() {
  if (!contentEl || !state.profile || !state.profile.active) return;
  const path = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
  const r = ROUTES.find((x) => x.path === path) || ROUTES.find((x) => x.path === 'dashboard');
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === r.path));
  window.scrollTo(0, 0);
  if (r.module && !can(r.module, 'view')) {
    clear(contentEl).append(h('div', { class: 'card pad' }, h('h2', {}, 'No access'), h('p', { class: 'muted' }, 'Your role does not include this area.')));
    return;
  }
  clear(contentEl).append(h('div', { class: 'muted' }, 'Loading…'));
  try { await r.render(contentEl); }
  catch (e) { console.error(e); clear(contentEl).append(h('div', { class: 'error-box' }, 'Something went wrong: ' + friendlyError(e))); }
}

async function boot() {
  if (!configured) return renderSetup();
  try { await loadAccount(); }
  catch (e) { console.error(e); return authShell(h('h1', {}, 'Cannot connect'), h('p', {}, friendlyError(e)), h('button', { class: 'btn', onclick: boot }, 'Try again')); }
  if (!state.user) return renderLogin();
  if (!state.profile) return authShell(h('h1', {}, 'Account not ready'), h('p', {}, 'Your profile was not found. Ask the Admin, or sign out and try again.'), h('button', { class: 'btn', onclick: signOut }, 'Sign out'));
  if (!state.profile.active) return renderPending();
  renderShell();
  if (!location.hash) location.hash = '#/dashboard'; else await route();
}

window.addEventListener('hashchange', route);
if (configured) sb.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_OUT' && state.user) boot(); });
boot();
