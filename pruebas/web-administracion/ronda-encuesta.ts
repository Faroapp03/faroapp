/** Los resultados de la encuesta tal como los envía el servidor: los de una ronda, con la lista de todas las rondas. */

interface ResultadosDeRonda {
  readonly abierta: boolean;
  readonly totales: Readonly<Record<'participante' | 'profesional', { emitidos: number; consumidos: number }>>;
}
/** Una ronda cerrada anterior, con un nombre tan largo como admite el servidor si `largo`. */
export function rondaAnterior(numero: number, largo = false) {
  return {
    numero,
    nombre: largo ? '𝔄'.repeat(60) : `Grupo ${numero}`,
    inicio: '2026-10-01',
    cierre: '2026-10-15',
    abierta: false,
    invitaciones: 0,
    respuestas: 0,
  };
}
/**
 * Los resultados de la ronda «Piloto Citilab», abierta o cerrada como ellos, tras `anteriores` rondas ya cerradas; sus
 * invitaciones y respuestas son las de los totales.
 */
export function enRonda<T extends ResultadosDeRonda>(
  resultados: T,
  anteriores: ReturnType<typeof rondaAnterior>[] = [],
) {
  const { participante, profesional } = resultados.totales;
  const ronda = {
    numero: anteriores.length + 1,
    nombre: 'Piloto Citilab',
    inicio: '2026-11-02',
    cierre: resultados.abierta ? null : '2026-11-20',
    abierta: resultados.abierta,
    invitaciones: participante.emitidos + profesional.emitidos,
    respuestas: participante.consumidos + profesional.consumidos,
  };
  return { version: 3, ronda, rondas: [...anteriores, ronda], ...resultados };
}
