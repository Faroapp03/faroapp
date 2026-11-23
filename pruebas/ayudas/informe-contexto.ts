// Paquete admitido → señal empresarial general y contexto censal independiente.
import { fileURLToPath } from 'node:url';
import { construirInforme } from '../../src/dominio/informe.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { renderizarInformeBreve } from '../../src/presentacion/informe-breve.ts';

export const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
export function caso(datos: Datos = DATOS, idioma: 'es' | 'ca' = 'es', isco08 = '4110') {
  const informe = construirInforme(
    {
      isco08,
      fecha: '2026-10-23',
      sinIa: true,
      tareas: [
        {
          id: 'una',
          texto: 'Tarea oficial',
          tiempo: 'mucho',
          referencia: { tareaOit: `${isco08}-1`, relacion: 'propia' },
        },
      ],
    },
    datos,
    { idioma, formacion: null },
  );
  const breve = construirInformeBreve(informe, datos);
  return { breve, html: renderizarInformeBreve(breve, informe, { incrustado: true }) };
}
