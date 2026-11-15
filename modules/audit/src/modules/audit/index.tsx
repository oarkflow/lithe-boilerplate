import type { ModuleDef } from '../types.ts';
import { Audit } from './Audit.tsx';

const modules: ModuleDef[] = [
  { id: 'audit', label: 'Audit log', hint: 'Tamper-evident history', icon: '📜', order: 90, permission: 'audit:read', view: () => Audit() },
];
export default modules;
