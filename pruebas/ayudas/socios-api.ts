/** Capacidades explícitas sintéticas para pruebas unitarias; los E2E usan SQLite y DO reales. */

import type { UsoConectividad } from '../../src/administracion/accesos.ts';
import type { AdministracionApi } from '../../src/api/controles-administrativos.ts';
import type { CuentaDeAcceso } from '../../src/api/socios/almacen-publico.ts';
import type { Socio } from '../../src/api/socios/registro.ts';
import type { OpcionesDeSocios } from '../../src/api/socios/servidor-socios.ts';
export class SociosDePrueba {
  readonly socios = new Map<string, Socio>();
  readonly cuentas = new Map<string, number>();
  readonly revocaciones = new Map<string, number>();
  readonly usos: UsoConectividad[] = [];
  fallo = false;
  private disponible(): void {
    if (this.fallo) {
      throw new TypeError('Fallo sintético, no debe aparecer en la respuesta');
    }
  }
  async buscarInstitucion(id: string): Promise<Socio | null> {
    this.disponible();
    return this.socios.get(id) ?? null;
  }
  async consumir(cuentas: readonly CuentaDeAcceso[]): Promise<boolean> {
    this.disponible();
    if (cuentas.some(({ clave, limite }) => (this.cuentas.get(clave) ?? 0) >= limite)) {
      return false;
    }
    for (const { clave } of cuentas) {
      this.cuentas.set(clave, (this.cuentas.get(clave) ?? 0) + 1);
    }
    return true;
  }
  async revocar(jti: string, caduca: number): Promise<void> {
    this.disponible();
    this.revocaciones.set(jti, caduca);
  }
  async revocado(jti: string): Promise<boolean> {
    this.disponible();
    return this.revocaciones.has(jti);
  }
  opciones(): OpcionesDeSocios {
    return {
      almacen: this,
      instituciones: {
        buscarInstitucion: (id) => this.buscarInstitucion(id),
        consultarInvitacion: async () => {
          this.disponible();
          return null;
        },
        activarInvitacion: async () => {
          this.disponible();
          return { estado: 'no_disponible' };
        },
      },
      accesos: {
        registrarAcceso: async (uso) => {
          this.disponible();
          this.usos.push(uso);
        },
      },
    };
  }
}

/** Política y registro explícitos para pruebas portables de los canales factuales. */
export function administracionDeAgentes() {
  const usos: UsoConectividad[] = [];
  const opciones: AdministracionApi = {
    leerControles: async () => ({ version: 2, revision: 0, api: 'deshabilitada', mcp: true, a2a: true }),
    registrarAcceso: async (uso) => {
      usos.push(uso);
    },
  };
  return { opciones, usos };
}
