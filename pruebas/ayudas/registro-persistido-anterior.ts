/** Estado SQLite anterior sintético, solo para demostrar conservación sin reabrir sus métodos retirados. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { Socio } from '../../src/api/socios/registro.ts';
export function sembrarSocioPersistido(db: DatabaseSync, socio: Socio): void {
  db.exec(`CREATE TABLE IF NOT EXISTS publico_socios (
    id TEXT PRIMARY KEY, huella TEXT NOT NULL CHECK(length(huella)=64),
    cuota INTEGER NOT NULL CHECK(cuota BETWEEN 1 AND 1000000)) STRICT`);
  db.prepare('INSERT INTO publico_socios(id,huella,cuota) VALUES(?,?,?)').run(
    socio.id,
    socio.huellas[0] ?? '',
    socio.consultasPorHora,
  );
}
export function socioPersistido(db: DatabaseSync, id: string): Socio | null {
  const f = db.prepare('SELECT id,huella,cuota FROM publico_socios WHERE id=?').get(id);
  if (!f) {
    return null;
  }
  assert(typeof f.id === 'string' && typeof f.huella === 'string' && typeof f.cuota === 'number');
  return { id: f.id, huellas: [f.huella], consultasPorHora: f.cuota };
}

export function sembrarSocioEnArchivo(archivo: string, socio: Socio): void {
  const db = new DatabaseSync(archivo);
  try {
    sembrarSocioPersistido(db, socio);
  } finally {
    db.close();
  }
}
export function socioEnArchivo(archivo: string, id: string): Socio | null {
  const db = new DatabaseSync(archivo, { readOnly: true });
  try {
    return socioPersistido(db, id);
  } finally {
    db.close();
  }
}
