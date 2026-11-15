import type { ModuleDef } from '../types.ts';
import { Access } from './Access.tsx';

const modules: ModuleDef[] = [
  { id: 'access', label: 'Access control', hint: 'Roles & permissions', icon: '🛡', order: 50, permission: 'rbac:manage', view: () => Access() },
];
export default modules;
