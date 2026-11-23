import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ARCHIVOS, leerPerfil } from '../../herramientas/cloudflare/preparar-despliegue.ts';

const raiz = fileURLToPath(new URL('../../', import.meta.url));

test('otro perfil separa cuatro Workers y dominio sin consultar el alojamiento', () => {
  const copia = mkdtempSync(join(tmpdir(), 'perfil-portable-'));
  try {
    for (const [entorno, nombres] of [
      ['produccion', ['entidad-portal', 'entidad-cursos']],
      ['ensayo', ['entidad-ensayo', 'entidad-ensayo-cursos']],
    ] as const) {
      for (const [servicio, nombre] of [
        ['principal', nombres[0]],
        ['cursos', nombres[1]],
      ] as const) {
        const archivo = ARCHIVOS[entorno][servicio];
        const config = JSON.parse(readFileSync(join(raiz, archivo), 'utf8')) as Record<string, unknown>;
        config.name = nombre;
        if (servicio === 'principal') {
          config.services = [{ binding: 'CURSOS', service: nombres[1] }];
          if (entorno === 'produccion') {
            config.routes = [{ pattern: 'otra-entidad.example', custom_domain: true }];
          }
        }
        mkdirSync(dirname(join(copia, archivo)), { recursive: true });
        writeFileSync(join(copia, archivo), JSON.stringify(config));
      }
    }
    const perfil = leerPerfil(copia);
    assert.equal(perfil.produccion.principal.name, 'entidad-portal');
    assert.equal(perfil.ensayo.cursos.name, 'entidad-ensayo-cursos');
    const archivo = join(copia, ARCHIVOS.ensayo.principal);
    const ensayo = JSON.parse(readFileSync(archivo, 'utf8')) as Record<string, unknown>;
    ensayo.name = 'entidad-portal';
    writeFileSync(archivo, JSON.stringify(ensayo));
    assert.throws(() => leerPerfil(copia), /cuatro Workers distintos/u);
  } finally {
    rmSync(copia, { recursive: true, force: true });
  }
});
