import { cifra as cifraConMiles } from '../scripts/cifras.js';
import { crear } from '../scripts/dom.js';
import { texto } from '../scripts/textos.js';
import { textoHumano as humano } from './textos-accesos-humanos.js';

/** @typedef {import('../../src/administracion/instituciones.ts').Institucion} Institucion */
/** @param {string} rotulo @param {string} valor */
function cifra(rotulo, valor) {
  return crear('div', {}, crear('dt', { textContent: rotulo }), crear('dd', { textContent: valor }));
}
/** @param {Institucion} i @param {readonly HTMLElement[]} claves */
function identificadores(i, claves) {
  return crear(
    'details',
    { className: 'panel-humano-detalles' },
    crear('summary', { textContent: humano('identificadores') }),
    crear('p', {}, crear('strong', { textContent: humano('institucionId') }), crear('code', { textContent: i.id })),
    crear('p', { className: 'ayuda', textContent: humano('institucionAyuda') }),
    ...(claves.length ? claves : [crear('p', { textContent: humano('sinClaves') })]),
  );
}
/** @param {Institucion} i
 * @param {{claves:readonly HTMLElement[],acciones:HTMLElement|null,fecha:(valor:string|null)=>string}} opciones */
export function tarjetaInstitucion(i, opciones) {
  const tarjeta = crear('article', { className: 'institucion institucion-humana' });
  tarjeta.append(
    crear(
      'header',
      { className: 'panel-humano-cabecera' },
      crear('h3', { textContent: i.nombre }),
      crear('span', { className: 'panel-humano-estado', textContent: texto(`panel.instituciones.estado.${i.estado}`) }),
    ),
    crear(
      'dl',
      { className: 'panel-humano-cifras' },
      cifra(humano('consultas'), cifraConMiles(i.consultas)),
      cifra(humano('claves'), cifraConMiles(i.claves.length)),
    ),
    crear(
      'p',
      { className: 'panel-humano-fecha' },
      `${texto('panel.instituciones.ultima-conexion')}: ${opciones.fecha(i.ultimaConexion)}`,
    ),
  );
  if (i.invitacion) {
    tarjeta.append(
      crear('p', {
        className: 'ayuda',
        textContent: `${texto('panel.instituciones.caducidad')}: ${opciones.fecha(i.invitacion.caducaEn)}`,
      }),
    );
  }
  if (opciones.acciones) {
    tarjeta.append(opciones.acciones);
  }
  const detalle = identificadores(i, opciones.claves);
  detalle.append(
    crear('p', {}, `${texto('panel.instituciones.correo')}: ${i.correo ?? texto('panel.instituciones.sin-correo')}`),
  );
  tarjeta.append(detalle);
  return tarjeta;
}
