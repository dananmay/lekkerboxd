import { mount } from 'svelte';
import ScoringDoc from './ScoringDoc.svelte';

const app = mount(ScoringDoc, { target: document.getElementById('app')! });

export default app;
