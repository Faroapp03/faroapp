// Cuánta gente trabaja en cada grupo CIUO-08 en Cataluña, para desempatar candidatas que casan igual de bien con la
// palabra del oficio: «maestra» casa igual con «maestro de educación primaria» que con «maestro cervecero», pero en
// Cataluña hay decenas de miles de maestras y muy pocos maestros cerveceros. Es una probabilidad previa, no un
// sustituto del texto: suma como mucho BONO_FRECUENCIA (ocupaciones.ts) y solo a las candidatas que ya encajan.
// Fuente: datos/ocupados.json (Idescat, población ocupada por subgrupos de la CNO-11, el último año publicado), ya en
// el paquete. Cada grupo CIUO-08 toma los ocupados de los subgrupos CNO-11 de 3 cifras que le corresponden según la
// correspondencia oficial del INE; un subgrupo que corresponde a varios grupos CIUO-08 se reparte entre ellos.

import type { Datos } from '../../../../src/dominio/tipos-paquete.ts';

/** Clave de ocupados.json para el total de todos los grupos, que no es un subgrupo. */
const TODOS_LOS_GRUPOS = 'total';
/** Cifras de un subgrupo de la CNO-11. */
const CIFRAS_DEL_SUBGRUPO = 3;

/** La frecuencia relativa de cada grupo, preparada una vez por paquete. */
const frecuenciaPorDatos = new WeakMap<Datos, ReadonlyMap<string, number>>();

/** La cifra del último año publicado de una fila de ocupados.json, o undefined si no hay ninguna positiva. */
function ultimaCifra(porAnio: Record<string, { ocupados?: number } | undefined>): number | undefined {
  const ultimo = Object.keys(porAnio).sort().at(-1);
  const cifra = ultimo === undefined ? undefined : porAnio[ultimo]?.ocupados;
  return typeof cifra === 'number' && cifra > 0 ? cifra : undefined;
}

/**
 * Los ocupados del último año publicado de cada subgrupo de la CNO-11 de 3 cifras. Si Idescat no publica un subgrupo
 * que sí usa la correspondencia (en Cataluña, todo el 59, «protección y seguridad»: policía, bomberos, vigilantes…),
 * se reparte por igual entre esos subgrupos lo que queda del total de su subgrupo de 2 cifras tras restar los
 * publicados. Sin esto, la policía no tenía frecuencia y perdía frente a «mozo» o «inspector».
 */
function ocupadosPorSubgrupo(datos: Datos, usados: ReadonlySet<string>): Map<string, number> {
  const ocupados = datos.ocupados;
  if (!ocupados) {
    return new Map();
  }
  const porSubgrupo = publicadosPorSubgrupo(ocupados.cataluna_cno3);
  for (const [dos, subgrupos] of sinCifraPorSubgrupoDeDos(usados, porSubgrupo)) {
    const fila = ocupados.cataluna_cno2[dos];
    const resto = (fila ? (ultimaCifra(fila) ?? 0) : 0) - publicadosDe(dos, porSubgrupo);
    for (const subgrupo of resto > 0 ? subgrupos : []) {
      porSubgrupo.set(subgrupo, resto / subgrupos.length);
    }
  }
  return porSubgrupo;
}

/** Los subgrupos de 3 cifras que Idescat publica, con su cifra del último año. */
function publicadosPorSubgrupo(
  cno3: Record<string, Record<string, { ocupados?: number } | undefined>>,
): Map<string, number> {
  const porSubgrupo = new Map<string, number>();
  for (const [subgrupo, porAnio] of Object.entries(cno3)) {
    const cifra = ultimaCifra(porAnio);
    if (subgrupo !== TODOS_LOS_GRUPOS && cifra !== undefined) {
      porSubgrupo.set(subgrupo, cifra);
    }
  }
  return porSubgrupo;
}

/** Los subgrupos de 3 cifras usados por la correspondencia que no tienen cifra, por su subgrupo de 2 cifras. */
function sinCifraPorSubgrupoDeDos(usados: ReadonlySet<string>, publicados: ReadonlyMap<string, number>) {
  const sinCifra = new Map<string, string[]>();
  for (const subgrupo of [...usados].filter((s) => !publicados.has(s))) {
    const dos = subgrupo.slice(0, 2);
    sinCifra.set(dos, [...(sinCifra.get(dos) ?? []), subgrupo]);
  }
  return sinCifra;
}

/** La suma de los subgrupos de 3 cifras publicados dentro de un subgrupo de 2 cifras. */
function publicadosDe(dos: string, publicados: ReadonlyMap<string, number>): number {
  return [...publicados].reduce((suma, [tres, cifra]) => suma + (tres.startsWith(dos) ? cifra : 0), 0);
}

/**
 * La frecuencia de cada grupo CIUO-08 en Cataluña, de 0 (el grupo con menos ocupados) a 1 (el que más), en escala
 * logarítmica: de 1.000 a 10.000 ocupados sube lo mismo que de 10.000 a 100.000.
 *
 * @param datos - El paquete de datos.
 * @returns Grupo CIUO-08 → su frecuencia; los grupos sin cifras no están.
 */
export function frecuenciaDeLosGrupos(datos: Datos): ReadonlyMap<string, number> {
  const guardada = frecuenciaPorDatos.get(datos);
  if (guardada) {
    return guardada;
  }
  const subgruposDe = new Map(
    Object.entries(datos.clasificaciones.isco08_a_cno11).map(([isco08, correspondencias]) => [
      isco08,
      new Set(correspondencias.map(({ cno11 }) => cno11.slice(0, CIFRAS_DEL_SUBGRUPO))),
    ]),
  );
  const porSubgrupo = ocupadosPorSubgrupo(datos, new Set([...subgruposDe.values()].flatMap((s) => [...s])));
  // Un subgrupo que corresponde a varios grupos CIUO-08 reparte sus ocupados entre ellos a partes iguales.
  const gruposPorSubgrupo = new Map<string, number>();
  for (const subgrupos of subgruposDe.values()) {
    for (const subgrupo of subgrupos) {
      gruposPorSubgrupo.set(subgrupo, (gruposPorSubgrupo.get(subgrupo) ?? 0) + 1);
    }
  }
  const logaritmos = new Map<string, number>();
  for (const [isco08, subgrupos] of subgruposDe) {
    const total = [...subgrupos].reduce(
      (suma, subgrupo) => suma + (porSubgrupo.get(subgrupo) ?? 0) / (gruposPorSubgrupo.get(subgrupo) ?? 1),
      0,
    );
    if (total > 0) {
      logaritmos.set(isco08, Math.log(total));
    }
  }
  const valores = [...logaritmos.values()];
  const minimo = Math.min(...valores);
  const rango = Math.max(...valores) - minimo || 1;
  const frecuencia = new Map([...logaritmos].map(([isco08, valor]) => [isco08, (valor - minimo) / rango]));
  frecuenciaPorDatos.set(datos, frecuencia);
  return frecuencia;
}
