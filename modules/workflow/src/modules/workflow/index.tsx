import './workflow.css';
import type { ModuleDef } from '../types.ts';
import { Cases } from './Cases.tsx';
import { FormSettings } from './FormSettings.tsx';
import { Requests } from './Requests.tsx';
import { Workflows } from './Workflows.tsx';

const modules: ModuleDef[] = [
  { id: 'requests', label: 'My cases', hint: 'Apply & follow', icon: '✎', order: 10, permission: 'workflow:apply', view: () => Requests() },
  { id: 'cases', label: 'Cases', hint: 'Work the queue', icon: '✔', order: 30, permission: 'workflow:work', view: () => Cases() },
  { id: 'workflows', label: 'Workflow definitions', hint: 'Edit & publish', icon: '⛓', order: 80, permission: 'workflow:manage', view: () => Workflows() },
  { id: 'forms', label: 'Form settings', hint: 'Labels, required, timings', icon: '▤', order: 85, permission: 'workflow:manage', view: () => FormSettings() },
];
export default modules;
