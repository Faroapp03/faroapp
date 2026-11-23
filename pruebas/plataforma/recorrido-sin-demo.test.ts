import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('sin demo la autoridad conserva el estado histórico y permite una recuperación administrativa explícita', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../ayudas/recorrido-sin-demo.ts', import.meta.url))], {
    stdio: 'pipe',
  });
});
