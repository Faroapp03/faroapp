/** Dos orientaciones editoriales por prerrequisitos explícitos de la captura concreta. */
import type { NivelClasificado } from './clasificacion.ts';
import type { OfertaCatalogo } from './contrato.ts';

const CASOS = new Map([
  [
    'claude-academy:introduction-to-evals',
    {
      titulo: 'Introduction to evals',
      url: 'https://academy.claude.com/courses/introduction-to-evals',
      sha256: 'c69457470da76b05707367bfa39d4d4e2d5f748bd6fb61f90a4ddd7fa93a542c',
      fecha: '2026-11-18T07:47:00.034955Z',
      motivo: {
        es: 'El curso pide haber completado Claude Platform 101 o saber enviar una petición a la API de mensajes y leer la respuesta. Los ejercicios usan Python y YAML.',
        ca: 'El curs demana haver completat Claude Platform 101 o saber enviar una petició a l’API de missatges i llegir la resposta. Els exercicis fan servir Python i YAML.',
      },
    },
  ],
  [
    'claude-academy:tool-use-with-the-messages-api',
    {
      titulo: 'Tool use with the Messages API',
      url: 'https://academy.claude.com/courses/tool-use-with-the-messages-api',
      sha256: '8ea318f314292dde2600dac7de938f35f8e90b707b41f8da45098e53bc6c6ccc',
      fecha: '2026-11-18T07:47:22.009890Z',
      motivo: {
        es: 'El curso pide haber programado un bucle de uso de herramientas o haber completado Claude Platform 101. También pide saber leer ejemplos en Python y JSON.',
        ca: 'El curs demana haver programat un bucle d’ús d’eines o haver completat Claude Platform 101. També demana saber llegir exemples en Python i JSON.',
      },
    },
  ],
]);
export function nivelAcademy(oferta: OfertaCatalogo): NivelClasificado | null {
  const dato = CASOS.get(oferta.unidad.id);
  if (
    !dato ||
    oferta.proveedor_id !== 'anthropic' ||
    oferta.unidad.tipo !== 'recurso' ||
    oferta.unidad.programa_id !== oferta.unidad.id ||
    oferta.titulo_programa !== dato.titulo ||
    oferta.url !== dato.url ||
    !oferta.referencias.some((r) => r.url === dato.url && r.sha256 === dato.sha256) ||
    oferta.referencias.some(
      (r) => r.url === dato.url && r.sha256 !== dato.sha256 && Date.parse(r.fecha_referencia) > Date.parse(dato.fecha),
    )
  ) {
    return null;
  }
  return {
    valor: 'intermedio',
    origen: 'faro',
    literal: null,
    alcance: 'orientacion',
    escala: 'inicial-intermedio-avanzado',
    motivo: dato.motivo,
    evidencia: { url: dato.url, sha256: dato.sha256, capturadoEl: dato.fecha, localizador: 'Prerequisites' },
  };
}
