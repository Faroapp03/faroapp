import { crear } from '../../dom.js';
import { fechaDelPlan, textoDocumento } from './textos-documento.js';

/** @import { PlanElegido } from './contrato.js' */
/** Un siguiente paso de orientación, separado de los cursos y sin prometer una acreditación.
 * @param {PlanElegido} plan @returns {HTMLElement[]} */
export function bloqueDeAcreditacion(plan) {
  const opcion = plan.acreditacion;
  if (!opcion) {
    return [];
  }
  const t = (/** @type {Parameters<typeof textoDocumento>[1]} */ clave) => textoDocumento(plan.idioma, clave);
  const relacion = t(opcion.relacion === 'ocupacion' ? 'acreditacionOcupacion' : 'acreditacionGrupo');
  const enlace = (/** @type {string} */ url, /** @type {string} */ texto) =>
    crear('a', { href: url, target: '_blank', rel: 'noopener noreferrer', textContent: texto });
  return [
    crear(
      'section',
      { className: 'pe-acreditacion', lang: plan.idioma },
      crear('h3', { textContent: t('acreditacion') }),
      crear('p', { textContent: `${opcion.codigo} · ${opcion.nombre}. ${relacion}.` }),
      crear('p', {}, enlace(opcion.tramite, t('acreditacionPaso'))),
      crear(
        'small',
        { className: 'pe-comprobado' },
        `${t('comprobado')}: ${fechaDelPlan(opcion.comprobado, plan.idioma)} · `,
        enlace(opcion.enlaceBoe, t('acreditacionNorma')),
      ),
    ),
  ];
}
