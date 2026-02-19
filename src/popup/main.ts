import { mount } from 'svelte';
import Popup from './Popup.svelte';

if (new URLSearchParams(window.location.search).get('mode') === 'window') {
  document.body.classList.add('window-mode');
}

const app = mount(Popup, { target: document.getElementById('app')! });

export default app;
