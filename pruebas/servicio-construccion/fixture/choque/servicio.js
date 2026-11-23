import { deA } from './a.js';
import { deB } from './b.js';
import { VERSION } from './generado.js';

self.addEventListener('install', () => [deA(), deB(), VERSION]);
