/**
 * Las rondas de la encuesta en SQLite (esquema-sqlite.ts las crea): cada una con su nombre, el día en que se abrió y el
 * día en que se cerró, si se conocen, y si está abierta. Solo una puede estarlo, y la base lo garantiza con un índice
 * único. Cerrar una ronda borra las huellas que quedan sin usar, así que sus recuentos ya no pueden cambiar; abrir otra
 * después crea sus propias celdas a cero sin tocar las de las anteriores.
 */
import type { SqlAccesoPublico } from '../plataforma/acceso-publico/sqlite.ts';
import { entero, leerDia, leerNombreRonda, MAX_RONDAS, type RondaEncuesta } from './contrato.ts';
import { CUESTIONARIO } from './cuestionario.ts';
import { crearCeldas, ESQUEMA, exigir } from './esquema-sqlite.ts';

/** Comprueba que el esquema y el cuestionario guardados son los vigentes antes de leer o escribir nada. */
export function exigirVigente(sql: SqlAccesoPublico): void {
  const filas = sql.filas('SELECT version,cuestionario FROM encuesta_estado WHERE id=1');
  const fila = filas[0];
  exigir(filas.length === 1 && fila?.version === ESQUEMA && fila.cuestionario === CUESTIONARIO);
}
/** Todas las rondas, en orden, con los códigos emitidos y usados en sus lotes. */
export function rondas(sql: SqlAccesoPublico): RondaEncuesta[] {
  exigirVigente(sql);
  const filas = sql.filas(`SELECT r.numero, r.nombre, r.inicio, r.cierre, r.abierta,
      coalesce(sum(l.emitidos),0) AS invitaciones, coalesce(sum(l.consumidos),0) AS respuestas
    FROM encuesta_rondas r LEFT JOIN encuesta_lotes l ON l.ronda = r.numero GROUP BY r.numero ORDER BY r.numero`);
  exigir(filas.length >= 1 && filas.length <= MAX_RONDAS);
  return filas.map((fila) => {
    exigir(entero(fila.numero) && fila.numero >= 1 && (fila.abierta === 0 || fila.abierta === 1));
    exigir(entero(fila.invitaciones) && entero(fila.respuestas) && fila.respuestas <= fila.invitaciones);
    return {
      numero: fila.numero,
      nombre: leerNombreRonda(fila.nombre),
      inicio: fila.inicio === null ? null : leerDia(fila.inicio),
      cierre: fila.cierre === null ? null : leerDia(fila.cierre),
      abierta: fila.abierta === 1,
      invitaciones: fila.invitaciones,
      respuestas: fila.respuestas,
    };
  });
}
/** El número de la ronda abierta, o null si todas están cerradas. */
export function rondaAbierta(sql: SqlAccesoPublico): number | null {
  exigirVigente(sql);
  const filas = sql.filas('SELECT numero FROM encuesta_rondas WHERE abierta=1');
  exigir(filas.length <= 1);
  const numero = filas[0]?.numero;
  if (numero === undefined) {
    return null;
  }
  exigir(entero(numero));
  return numero;
}
/**
 * Abre una ronda nueva con ese nombre el día dado y sus celdas a cero. No abre ninguna si ya hay una abierta, para no
 * repartir las respuestas de un mismo grupo entre dos rondas, ni si ya están todas las que caben.
 */
export function abrirRondaSqlite(
  sql: SqlAccesoPublico,
  nombre: string,
  dia: string,
): { estado: 'abierta'; numero: number } | { estado: 'ronda_abierta' | 'lleno' } {
  const ronda = leerNombreRonda(nombre);
  const inicio = leerDia(dia);
  if (rondaAbierta(sql) !== null) {
    return { estado: 'ronda_abierta' };
  }
  const cuenta = sql.filas('SELECT count(*) AS n, coalesce(max(numero),0) AS ultima FROM encuesta_rondas')[0];
  exigir(cuenta !== undefined && entero(cuenta.n) && entero(cuenta.ultima));
  if (cuenta.n >= MAX_RONDAS) {
    return { estado: 'lleno' };
  }
  const numero = cuenta.ultima + 1;
  sql.ejecutar('INSERT INTO encuesta_rondas VALUES(?,?,?,NULL,1)', numero, ronda, inicio);
  crearCeldas(sql, numero);
  return { estado: 'abierta', numero };
}
/**
 * Cierra la ronda abierta el día dado y borra las huellas que quedan: ningún código sin usar vuelve a servir y sus
 * recuentos quedan congelados. Sin ronda abierta no cambia nada. Devuelve el número de la ronda cerrada, o null.
 */
export function cerrarRondaSqlite(sql: SqlAccesoPublico, dia: string): number | null {
  const cierre = leerDia(dia);
  const numero = rondaAbierta(sql);
  if (numero === null) {
    return null;
  }
  // Un reloj atrasado no deja una ronda que se cierra antes de abrirse: se cierra el mismo día en que se abrió.
  sql.ejecutar(
    'UPDATE encuesta_rondas SET abierta=0, cierre=CASE WHEN inicio IS NOT NULL AND inicio>? THEN inicio ELSE ? END WHERE numero=?',
    cierre,
    cierre,
    numero,
  );
  // Solo la ronda abierta tiene códigos sin usar: al cerrar las anteriores ya se borraron los suyos.
  sql.ejecutar('DELETE FROM encuesta_codigos');
  return numero;
}
