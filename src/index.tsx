import { mount } from '@oarkflow/lithe/dom';
import { App } from './app.tsx';
import './styles/app.css';
import './styles/modules.css';

const root = document.getElementById('app');
if (!root) {
  throw new Error('#app mount point is missing from the page');
}

mount(root, <App />);
