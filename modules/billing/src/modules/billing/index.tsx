import type { ModuleDef } from '../types.ts';
import { Billing } from './Billing.tsx';
import { MyBilling } from './MyBilling.tsx';

const modules: ModuleDef[] = [
  { id: 'my-billing', label: 'Billing', hint: 'Balance & invoices', icon: '₿', order: 60, permission: 'billing:read', view: () => MyBilling() },
  { id: 'billing-admin', label: 'Pricing & customers', hint: 'Rates, tiers, accounts', icon: '₤', order: 70, permission: 'billing:manage', view: () => Billing() },
];
export default modules;
