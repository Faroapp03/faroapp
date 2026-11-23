/** Canales públicos del proveedor, no de un docente ni de una matrícula individual. */
/** @import { OpcionPlan } from './contrato.js' */
/** @typedef {{telefono?:string,correo?:string,url:string,fuente:string,comprobadoEl:string}} ContactoProveedor */

/** @type {Readonly<Record<string, Readonly<ContactoProveedor>>>} */
const CONTACTOS = Object.freeze({
  cibervoluntarios: Object.freeze({
    telefono: '+34 91 542 29 00',
    correo: 'fundacion@cibervoluntarios.org',
    url: 'https://www.cibervoluntarios.org/es/contacto',
    fuente: 'https://www.cibervoluntarios.org/es/contacto',
    comprobadoEl: '2026-10-27',
  }),
  cibernarium: Object.freeze({
    telefono: '900 533 175',
    url: 'https://cibernarium.barcelonactiva.cat/contacte',
    fuente: 'https://cibernarium.barcelonactiva.cat/contacte',
    comprobadoEl: '2026-10-27',
  }),
  'hp-life': Object.freeze({
    correo: 'support-lifeglobal@hp.com',
    url: 'https://www.life-global.org/es/help',
    fuente: 'https://www.life-global.org/es/help',
    comprobadoEl: '2026-10-27',
  }),
});

/** Un publicador agregador no hereda el contacto de todas sus entidades.
 * @param {OpcionPlan} opcion @returns {Readonly<ContactoProveedor>|null} */
export function contactoDeOpcion(opcion) {
  const proveedor = opcion.oferta.proveedor_id;
  if (proveedor === 'fundae:publicador:catalogo:1' && opcion.oferta.url === 'https://ciber.be/introduccion-ecommerce') {
    return CONTACTOS.cibervoluntarios ?? null;
  }
  return Object.hasOwn(CONTACTOS, proveedor) ? (CONTACTOS[proveedor] ?? null) : null;
}
