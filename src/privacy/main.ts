import { mount } from 'svelte';
import PrivacyPolicy from './PrivacyPolicy.svelte';

const app = mount(PrivacyPolicy, { target: document.getElementById('app')! });

export default app;
