// Company details, VAT switch, commission settings and head of sales override tiers.
import { sb, can, setting, loadSettings } from '../db.js';
import { h, clear, buildForm, rowsEditor, syncRows, toast, friendlyError } from '../ui.js';

export async function settingsPage(container) {
  const canEdit = can('settings', 'edit');
  const ro = !canEdit;

  async function saveSetting(key, value) {
    const { error } = await sb.from('settings').upsert({ key, value }, { onConflict: 'key' });
    if (error) throw error;
    await loadSettings();
  }

  const section = (title, hint, formEl, onSave, canSave = canEdit) => {
    const msg = h('div', { class: 'error-box hidden' });
    return h('div', { class: 'card pad', style: { marginBottom: '14px' } },
      h('h2', {}, title), hint ? h('div', { class: 'muted small', style: { margin: '2px 0 12px' } }, hint) : null,
      msg, formEl,
      canSave ? h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn primary', onclick: async (e) => {
        msg.classList.add('hidden'); e.target.disabled = true;
        try { await onSave(); toast('Saved'); } catch (err) { msg.textContent = friendlyError(err); msg.classList.remove('hidden'); }
        e.target.disabled = false;
      } }, 'Save')) : null);
  };

  // Company
  const company = setting('company', {});
  const companyForm = buildForm([
    { key: 'name', label: 'Company name', required: true, readonly: ro },
    { key: 'phone', label: 'Phone', type: 'tel', readonly: ro },
    { key: 'email', label: 'Email', type: 'email', readonly: ro },
    { key: 'currency', label: 'Currency', readonly: true },
    { key: 'address', label: 'Address (printed on invoices)', type: 'textarea', readonly: ro },
  ], { currency: 'LKR', ...company });

  // VAT
  const vat = setting('vat', {});
  const vatForm = buildForm([
    { key: 'enabled', label: 'Charge VAT on invoices', type: 'checkbox', readonly: ro },
    { key: 'rate', label: 'VAT rate (%)', type: 'number', step: '0.01', min: 0, readonly: ro },
    { key: 'number', label: 'VAT registration number', readonly: ro },
  ], vat);

  // Commission
  const comm = setting('commission', {});
  const commForm = buildForm([
    { key: 'earn_on', label: 'Commission is earned', readonly: true },
    { key: 'override_basis', label: 'Head of sales override is calculated on', type: 'select', readonly: ro,
      options: [{ value: 'sales', label: 'Total sales value' }, { value: 'profit', label: 'Gross profit' }] },
  ], { earn_on: 'When the invoice is paid', override_basis: comm.override_basis || 'sales' });

  // Head of sales tiers
  const seeTiers = can('overrides', 'view');
  const tierEdit = can('overrides', 'edit');
  let tierRows = [];
  let tierEd = null;
  if (seeTiers) {
    const { data } = await sb.from('head_override_tiers').select('*').order('min_monthly_sales');
    tierRows = data || [];
    tierEd = rowsEditor(
      [{ key: 'min_monthly_sales', label: 'Monthly sales from (LKR)', step: '0.01', min: 0 }, { key: 'rate_percent', label: 'Override rate (%)', step: '0.0001', min: 0 }],
      tierRows, { readonly: !tierEdit, addLabel: 'Add sales tier' });
  }

  clear(container).append(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'),
      canEdit ? null : h('div', { class: 'muted small' }, 'You can view settings but not change them.'))),
    section('Company', 'Shown on invoices and in the menu.', companyForm.el, async () => {
      const p = companyForm.validate(); if (p) throw new Error(p);
      const v = companyForm.values(); v.currency = 'LKR';
      await saveSetting('company', v);
    }),
    section('VAT', 'VAT is off for now. Turn it on later and the rate will be used on new invoices.', vatForm.el, async () => {
      const v = vatForm.values();
      if (v.enabled && (v.rate == null || v.rate <= 0)) throw new Error('Enter the VAT rate.');
      await saveSetting('vat', { enabled: !!v.enabled, rate: v.rate ?? 0, number: v.number || '' });
    }),
    section('Commission', 'Commission is paid on payment: partial payments earn commission in proportion to the amount paid.', commForm.el, async () => {
      await saveSetting('commission', { earn_on: 'payment', override_basis: commForm.values().override_basis || 'sales' });
    }),
    seeTiers ? section('Head of sales override tiers',
      'The override rate depends on the total sales of all agents in a month. The highest tier reached applies. Example: from LKR 1,000,000 a month the rate is 1%.',
      tierEd.el, async () => {
        const rows = tierEd.values();
        if (rows.some((r) => r.min_monthly_sales == null || r.rate_percent == null)) throw new Error('Each tier needs a sales amount and a rate.');
        await syncRows(sb, 'head_override_tiers', tierRows, rows, {});
        const { data } = await sb.from('head_override_tiers').select('*').order('min_monthly_sales');
        tierRows = data || [];
      }, tierEdit) : null);
}
