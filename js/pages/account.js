// My account: details and change password.
import { sb, state, roleLabel } from '../db.js';
import { h, clear, buildForm, toast, friendlyError } from '../ui.js';

export async function accountPage(container) {
  const p = state.profile;
  const form = buildForm([
    { key: 'pw', label: 'New password', type: 'password', required: true, hint: 'At least 6 characters.' },
    { key: 'pw2', label: 'Repeat new password', type: 'password', required: true },
  ]);
  const msg = h('div', { class: 'error-box hidden' });

  clear(container).append(
    h('div', { class: 'page-head' }, h('h1', {}, 'My account')),
    h('div', { class: 'card pad', style: { marginBottom: '14px', maxWidth: '560px' } },
      h('h2', {}, p.full_name || p.email),
      h('div', { class: 'muted' }, p.email), h('div', { class: 'muted' }, roleLabel(p.role) + (p.phone ? ' · ' + p.phone : ''))),
    h('div', { class: 'card pad', style: { maxWidth: '560px' } },
      h('h2', { style: { marginBottom: '10px' } }, 'Change password'), msg, form.el,
      h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn primary', onclick: async (e) => {
        msg.classList.add('hidden');
        const bad = form.validate(); const v = form.values();
        const fail = (m) => { msg.textContent = m; msg.classList.remove('hidden'); };
        if (bad) return fail(bad);
        if (v.pw.length < 6) return fail('Password must be at least 6 characters.');
        if (v.pw !== v.pw2) return fail('The two passwords do not match.');
        e.target.disabled = true;
        const { error } = await sb.auth.updateUser({ password: v.pw });
        e.target.disabled = false;
        if (error) return fail(friendlyError(error));
        form.setValue('pw', ''); form.setValue('pw2', ''); toast('Password changed');
      } }, 'Change password'))));
}
