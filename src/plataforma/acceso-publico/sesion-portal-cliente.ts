import { AlmacenPublicoDurable } from './durable.ts';

export class SesionesPortalDurable extends AlmacenPublicoDurable {
  async registrarSesion(huella: string, caduca: number): Promise<void> {
    await this.enviar('/portal/registrar', { huella, caduca }, (v) =>
      v && typeof v === 'object' && 'correcto' in v && v.correcto === true ? true : undefined,
    );
  }
  async sesionesDisponibles(): Promise<boolean> {
    return this.enviar('/portal/disponible', {}, (v) =>
      v && typeof v === 'object' && 'disponible' in v && typeof v.disponible === 'boolean' ? v.disponible : undefined,
    );
  }
  async sesionActiva(huella: string): Promise<boolean> {
    return this.enviar('/portal/activa', { huella }, (v) =>
      v && typeof v === 'object' && 'activa' in v && typeof v.activa === 'boolean' ? v.activa : undefined,
    );
  }
  async revocarSesion(huella: string): Promise<void> {
    await this.enviar('/portal/revocar', { huella }, (v) =>
      v && typeof v === 'object' && 'correcto' in v && v.correcto === true ? true : undefined,
    );
  }
}
