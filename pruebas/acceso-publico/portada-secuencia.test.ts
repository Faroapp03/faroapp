import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PORTADA_PUBLICA } from '../../src/plataforma/cloudflare/portada-publica.ts';

test('la portada presenta el texto y la entrada después de la marca y respeta movimiento reducido', () => {
  assert.match(PORTADA_PUBLICA, /\.marca\{[^}]*animation:aparecer 2s ease-in-out 1\.5s both/u);
  assert.match(PORTADA_PUBLICA, /\.intro\{[^}]*animation:aparecer 2s ease-in-out 3s both/u);
  assert.match(PORTADA_PUBLICA, /\.acceso\{[^}]*animation:fundir 2s ease-in-out 4s both/u);
  assert.match(PORTADA_PUBLICA, /@keyframes fundir\{from\{opacity:0\}to\{opacity:1\}\}/u);
  assert.match(
    PORTADA_PUBLICA,
    /@media\(prefers-reduced-motion:reduce\)\{\.imagen,\.marca,\.intro,\.acceso\{animation:none\}/u,
  );
});
