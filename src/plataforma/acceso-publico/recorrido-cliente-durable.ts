import { leerDocumentoRecorrido, leerResultadoRecorrido, type ModoRecorrido } from '../../administracion/recorrido.ts';
import { leerDocumentoSecciones, VERSION_SECCIONES_PUBLICAS } from '../../administracion/secciones-web.js';
import { type AccesoSesionPanel, leerAccesoSesionPanel } from '../../administracion/sesion.ts';
import {
  type DecisionDelLimite,
  type IdentificadoresLimite,
  VERSION_CONTRATO_LIMITE,
} from './limite-continuo-sqlite.ts';
import { SesionUnicaDurable } from './sesion-unica-cliente-durable.ts';

function objeto(valor: unknown, campo: string): valor is Record<string, unknown> {
  return !!valor && typeof valor === 'object' && !Array.isArray(valor) && Object.keys(valor).join(',') === campo;
}
export class AlmacenRecorridoDurable extends SesionUnicaDurable {
  async leerSeccionesConAutoridad(permitirInicial = false) {
    return this.enviar('/secciones/autoridad', { permitirInicial }, (valor) => {
      if (!objeto(valor, 'secciones') || !valor.secciones || typeof valor.secciones !== 'object') {
        return undefined;
      }
      const doc = valor.secciones as Record<string, unknown>;
      if (
        Object.keys(doc).sort().join(',') !== 'autoridad,revision,secciones,version' ||
        doc.version !== VERSION_SECCIONES_PUBLICAS ||
        typeof doc.autoridad !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(doc.autoridad)
      ) {
        return undefined;
      }
      const validado = leerDocumentoSecciones({ version: 3, revision: doc.revision, secciones: doc.secciones });
      return { ...validado, version: VERSION_SECCIONES_PUBLICAS, autoridad: doc.autoridad };
    });
  }
  async consumirIntentoRecorrido(clave: IdentificadoresLimite): Promise<DecisionDelLimite> {
    return this.enviar('/recorrido/intento', { version: VERSION_CONTRATO_LIMITE, clave, espejo: true }, (valor) => {
      if (objeto(valor, 'saturado') && valor.saturado === true) {
        return 'saturado';
      }
      return objeto(valor, 'permitido') && typeof valor.permitido === 'boolean' ? valor.permitido : undefined;
    });
  }
  async decidirIntentoPrivado(clave: IdentificadoresLimite, valido: boolean): Promise<boolean> {
    return this.enviar('/privado/intento', { version: VERSION_CONTRATO_LIMITE, clave, valido }, (valor) =>
      objeto(valor, 'permitido') && typeof valor.permitido === 'boolean' ? valor.permitido : undefined,
    );
  }
  async leerRecorrido() {
    return this.enviar('/recorrido/leer', {}, (valor) =>
      objeto(valor, 'recorrido') ? leerDocumentoRecorrido(valor.recorrido) : undefined,
    );
  }
  async leerRecorridoDeSesion(acceso: AccesoSesionPanel) {
    return this.enviar('/recorrido/leer-sesion', { acceso: leerAccesoSesionPanel(acceso) }, leerResultadoRecorrido);
  }
  async cambiarRecorridoDeSesion(acceso: AccesoSesionPanel, revisionEsperada: number, modo: ModoRecorrido) {
    return this.enviar(
      '/recorrido/cambiar-sesion',
      { acceso: leerAccesoSesionPanel(acceso), revisionEsperada, modo },
      (valor) => {
        const resultado = leerResultadoRecorrido(valor);
        if (
          resultado.estado === 'cambiado' &&
          (resultado.recorrido.revision !== revisionEsperada + 1 || resultado.recorrido.modo !== modo)
        ) {
          return undefined;
        }
        if (resultado.estado === 'conflicto' && resultado.recorrido.revision === revisionEsperada) {
          return undefined;
        }
        return resultado;
      },
    );
  }
}
