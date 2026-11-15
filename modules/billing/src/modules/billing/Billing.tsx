import { onMount, signal } from '@oarkflow/lithe/core';
import { For, Show } from '@oarkflow/lithe/dom';
import { Alert } from '../../components/ui/Alert.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { api, attempt, fmtTime, formData, resource } from '../../lib/api.ts';
import type { Json } from '../../lib/secure-client.ts';
import { Status, toneFor } from '../../ui/bits.tsx';
import { money, toMinor } from '../../ui/money.ts';

/**
 * What a unit of usage costs and who has paid. The price of a unit comes from the rate
 * card for the customer's plan and is copied onto each meter when it is
 * registered, so a later rate change never reprices a meter that already
 * exists. Accounts are prepaid (a charge needs funds) unless given a credit limit.
 */
export function Billing() {
    const picked = signal<string | undefined>(undefined);
  const pic = resource(() => api.get(`/billing/admin/customers/${encodeURIComponent(String(picked.value))}`));
  const tiers = resource(() => api.get('/billing/admin/tiers'));
  onMount(() => { void tiers.reload(); });

  const choose = (id: string) => { picked.value = id; void pic.reload(); };
  
  async function setRate(e: Event) {
    const f = formData(e);
    const minor = toMinor(f.price);
    if (minor === undefined) { window.alert('Enter the price as a number like 10 or 10.50.'); return; }
    await attempt(() => api.put('/billing/admin/rates', { plan: f.plan, currency: f.currency.toUpperCase(), priceMinor: minor }), 'Rate saved. It applies to meters registered from now on.');
  }
  async function openAccount(e: Event) {
    const f = formData(e);
    const credit = f.credit ? toMinor(f.credit) : 0;
    if (credit === undefined) { window.alert('Enter the credit limit as a number, or leave it empty for prepaid.'); return; }
    if (await attempt(() => api.put(`/billing/admin/customers/${picked.value}/account`, { currency: f.currency.toUpperCase(), creditLimitMinor: credit }), 'Account saved')) void pic.reload();
  }
  async function topUp(e: Event) {
    const f = formData(e);
    const minor = toMinor(f.amount);
    if (minor === undefined || minor === 0) { window.alert('Enter the amount as a number like 500 or 500.50.'); return; }
    if (await attempt(() => api.post(`/billing/admin/customers/${picked.value}/topup`, { currency: f.currency.toUpperCase(), amountMinor: minor, ref: f.ref }), 'Balance added')) void pic.reload();
  }
  async function refund(e: Event) {
    const f = formData(e);
    const minor = toMinor(f.amount);
    if (minor === undefined || minor === 0) { window.alert('Enter the amount as a number like 500 or 500.50.'); return; }
    const path = f.kind === 'adjust' ? 'adjust' : 'refund';
    const signed = f.kind === 'adjust' && f.direction === 'debit' ? -minor : minor;
    if (await attempt(() => api.post(`/billing/admin/customers/${picked.value}/${path}`, { currency: f.currency.toUpperCase(), amountMinor: signed, ref: f.ref, reason: f.reason }), path === 'refund' ? 'Payment refunded' : 'Adjustment recorded')) void pic.reload();
  }
  async function setAlert(e: Event) {
    const f = formData(e);
    const level = f.level === '' ? 0 : toMinor(f.level);
    if (level === undefined) { window.alert('Enter the level as a number, or leave it empty for no warning.'); return; }
    if (await attempt(() => api.put(`/billing/admin/customers/${picked.value}/alert`, { currency: f.currency.toUpperCase(), levelMinor: level }), 'Warning level saved')) void pic.reload();
  }
  async function saveTier(e: Event) {
    const f = formData(e);
    const pct = Number(f.percent);
    if (!(pct > 0 && pct <= 95)) { window.alert('Enter a discount between 0.01 and 95 percent.'); return; }
    if (await attempt(() => api.put('/billing/admin/tiers', { plan: f.plan, currency: f.currency.toUpperCase(), fromUnits: Number(f.from), discountBps: Math.round(pct * 100) }), 'Band saved')) void tiers.reload();
  }
  async function removeTier(t: Json) {
    if (await attempt(() => api.del('/billing/admin/tiers', { plan: t.plan, currency: t.currency, fromUnits: t.fromUnits }), 'Band removed')) void tiers.reload();
  }
  async function setPrice(id: string, text: string) {
    const minor = toMinor(text);
    if (minor === undefined) { window.alert('Enter the price as a number like 10 or 10.50.'); return; }
    if (await attempt(() => api.put(`/billing/admin/meters/${id}/price`, { priceMinor: minor }), 'Meter price changed')) void pic.reload();
  }

  return (
    <div class="fh-panels">
      <Card eyebrow="Pricing" title="Price per unit">
        <p class="fh-auth-card__lede">The price a customer pays for each unit, by plan and currency. A meter takes this price when it is registered and keeps it; a denied scan is never charged.</p>
        <form class="fh-form ui-grid" onSubmit={(e: Event) => void setRate(e)}>
          <label class="fh-field"><span>Plan</span><select name="plan"><option value="standard">standard</option><option value="enterprise">enterprise</option></select></label>
          <label class="fh-field"><span>Currency</span><input name="currency" value="USD" maxlength="3" minlength="3" required /></label>
          <label class="fh-field"><span>Price per unit (e.g. 10)</span><input name="price" inputmode="decimal" required /></label>
          <Button type="submit" class="fh-form__submit">Save rate</Button>
        </form>
      </Card>

      <Card eyebrow="Volume discounts" title="Cheaper units for busy businesses">
        <p class="fh-auth-card__lede">From a number of units in a calendar month, a customer pays a lower price. The highest band it has reached applies to its next scan.</p>
        <table class="ui-table"><thead><tr><th>Plan</th><th>Currency</th><th>From (units / month)</th><th>Discount</th><th /></tr></thead><tbody>
          <For each={() => (tiers.data.value?.tiers as Json[] | undefined) ?? []} key={(t: Json) => `${t.plan}${t.currency}${t.fromUnits}`} fallback={<tr><td colSpan={5} class="fh-muted">No discount bands: every scan costs its full price.</td></tr>}>
            {(t: Json) => <tr><td>{t.plan}</td><td>{t.currency}</td><td>{String(t.fromUnits)}</td><td>{`${(Number(t.discountBps) / 100).toFixed(2)}%`}</td><td><Button variant="ghost" onClick={() => void removeTier(t)}>Remove</Button></td></tr>}
          </For></tbody></table>
        <form class="fh-form ui-grid" onSubmit={(e: Event) => void saveTier(e)}>
          <label class="fh-field"><span>Plan</span><select name="plan"><option value="standard">standard</option><option value="enterprise">enterprise</option></select></label>
          <label class="fh-field"><span>Currency</span><input name="currency" value="USD" maxlength="3" minlength="3" required /></label>
          <label class="fh-field"><span>From (units in a month)</span><input name="from" type="number" min="1" required /></label>
          <label class="fh-field"><span>Discount (%)</span><input name="percent" inputmode="decimal" required /></label>
          <Button type="submit">Save band</Button>
        </form>
      </Card>

      <Card eyebrow="Customers" title="Choose a customer">
        <p class="fh-auth-card__lede">A customer is whoever is billed: an organisation (its tenant id) in a multi-tenant deployment, otherwise an account id.</p>
        <form class="fh-form ui-inline" onSubmit={(e: Event) => { const f = formData(e); if (f.customer) choose(f.customer); }}>
          <label class="fh-field"><span>Customer id</span><input name="customer" required /></label>
          <Button type="submit" variant="subtle">Manage billing</Button>
        </form>
      </Card>

      <Show when={() => Boolean(picked.value)}>
        <Card eyebrow="Billing" title={() => String(`Customer ${String(picked.value)}`)}>
          <Status r={pic as never} />
          <dl class="ui-kvs">
            <For each={() => (pic.data.value?.accounts as Json[] | undefined) ?? []} key={(a: Json) => a.currency} fallback={<div class="ui-kv"><dt>Accounts</dt><dd>None yet. Open one below.</dd></div>}>
              {(a: Json) => <div class="ui-kv"><dt>{`Balance (${a.currency})`}</dt><dd>{`${money(a.currency, a.balanceMinor)}${Number(a.creditLimitMinor) > 0 ? ` · credit limit ${money(a.currency, a.creditLimitMinor)}` : ' · prepaid'}${a.low ? ' · LOW' : ''}`}</dd></div>}
            </For>
          </dl>
          <div class="fh-form ui-grid">
            <form class="fh-form" onSubmit={(e: Event) => void openAccount(e)}>
              <label class="fh-field"><span>Currency</span><input name="currency" value="USD" maxlength="3" minlength="3" required /></label>
              <label class="fh-field"><span>Credit limit (empty = prepaid)</span><input name="credit" inputmode="decimal" /></label>
              <Button type="submit" variant="subtle">Open / update account</Button>
            </form>
            <form class="fh-form" onSubmit={(e: Event) => void topUp(e)}>
              <label class="fh-field"><span>Currency</span><input name="currency" value="USD" maxlength="3" minlength="3" required /></label>
              <label class="fh-field"><span>Amount received</span><input name="amount" inputmode="decimal" required /></label>
              <label class="fh-field"><span>Payment reference (stops a double entry)</span><input name="ref" maxlength="64" required /></label>
              <Button type="submit">Add balance</Button>
            </form>
          </div>
          <Alert tone="info">Adding the same payment reference twice adds the money once. Record a payment only after it has actually been received.</Alert>
        </Card>

        <Card eyebrow="Refunds" title="Refund a payment or correct a balance">
          <p class="fh-auth-card__lede">A refund returns money that was paid; it cannot take a prepaid balance below zero. A correction adds or removes an amount. Both need a reference (so they are recorded once) and a reason, and both are in the audit trail.</p>
          <form class="fh-form ui-grid" onSubmit={(e: Event) => void refund(e)}>
            <label class="fh-field"><span>What</span><select name="kind"><option value="refund">Refund a payment</option><option value="adjust">Correct the balance</option></select></label>
            <label class="fh-field"><span>Correction is a</span><select name="direction"><option value="credit">credit (adds)</option><option value="debit">debit (removes)</option></select></label>
            <label class="fh-field"><span>Currency</span><input name="currency" value="USD" maxlength="3" minlength="3" required /></label>
            <label class="fh-field"><span>Amount</span><input name="amount" inputmode="decimal" required /></label>
            <label class="fh-field"><span>Reference</span><input name="ref" maxlength="64" required /></label>
            <label class="fh-field"><span>Reason</span><input name="reason" maxlength="200" required minlength="3" /></label>
            <Button type="submit" variant="danger">Record</Button>
          </form>
          <form class="fh-form ui-grid" onSubmit={(e: Event) => void setAlert(e)}>
            <label class="fh-field"><span>Currency</span><input name="currency" value="USD" maxlength="3" minlength="3" required /></label>
            <label class="fh-field"><span>Warn the business under (empty = off)</span><input name="level" inputmode="decimal" /></label>
            <Button type="submit" variant="subtle">Set warning level</Button>
          </form>
        </Card>

        <Card eyebrow="Online payments" title="Payments through the gateway">
          <table class="ui-table"><thead><tr><th>When</th><th>Packs</th><th>Amount</th><th>Status</th><th>Order</th></tr></thead><tbody>
            <For each={() => (pic.data.value?.orders as Json[] | undefined) ?? []} key={(o: Json) => o.id} fallback={<tr><td colSpan={5} class="fh-muted">None yet.</td></tr>}>
              {(o: Json) => <tr><td>{fmtTime(String(o.createdAt))}</td><td>{String(o.units)}</td><td>{money(o.currency, o.amountMinor)}</td><td>{String(o.status)}</td><td><code>{String(o.id).slice(0, 14)}</code></td></tr>}
            </For></tbody></table>
        </Card>

        <Card eyebrow="Meters" title="Meter prices">
          <table class="ui-table"><thead><tr><th>Meter</th><th>Location</th><th>Price per unit</th><th>Status</th><th>Change price</th></tr></thead><tbody>
            <For each={() => (pic.data.value?.meters as Json[] | undefined) ?? []} key={(s: Json) => s.id} fallback={<tr><td colSpan={5} class="fh-muted">No meters registered.</td></tr>}>
              {(s: Json) => {
                let draft = '';
                return (
                  <tr><td>{s.name}</td><td>{s.location || '—'}</td><td>{money(s.currency, s.priceMinor)}</td><td><Badge tone={s.status === 'active' ? 'ok' : 'neutral'} dot>{String(s.status)}</Badge></td>
                    <td><input style="width:7rem" inputmode="decimal" placeholder="e.g. 8" onInput={(e: Event) => { draft = (e.currentTarget as HTMLInputElement).value; }} /> <Button variant="ghost" onClick={() => void setPrice(String(s.id), draft)}>Set</Button></td></tr>
                );
              }}
            </For></tbody></table>
        </Card>

        <Card eyebrow="Ledger" title="Recent charges and payments">
          <table class="ui-table"><thead><tr><th>When</th><th>Type</th><th>Amount</th><th>Balance after</th><th>Reference</th></tr></thead><tbody>
            <For each={() => (pic.data.value?.recent as Json[] | undefined) ?? []} key={(r: Json) => r.id} fallback={<tr><td colSpan={5} class="fh-muted">Nothing yet.</td></tr>}>
              {(r: Json) => <tr><td>{fmtTime(String(r.createdAt))}</td><td>{r.kind}</td><td>{money(r.currency, r.amountMinor)}</td><td>{money(r.currency, r.balanceAfter)}</td><td>{String(r.ref ?? '').slice(0, 14)}</td></tr>}
            </For></tbody></table>
        </Card>
      </Show>
    </div>
  );
}
