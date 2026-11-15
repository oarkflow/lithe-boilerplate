import type { ModuleDef } from '../types.ts';
import { Accounts } from './Accounts.tsx';
import { Security } from './Security.tsx';

const modules: ModuleDef[] = [
  { id: 'security', label: 'Security', hint: 'Authenticator & password', icon: '🔒', order: 20, view: () => Security() },
  { id: 'accounts', label: 'Accounts', hint: 'People & roles', icon: '👥', order: 40, permission: 'accounts:read', view: () => Accounts() },
];
export default modules;
