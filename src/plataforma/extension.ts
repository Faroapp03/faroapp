/**
 * Contrato de una extensión instalable: una carpeta de la web que añade una variante de recorrido con todo lo que
 * el servidor y las herramientas necesitan saber de ella. La aplicación real no nombra ninguna extensión: las conoce
 * por el registro de `extensiones-instaladas.ts`, y retirar una es borrar su carpeta y su línea en ese registro.
 *
 * Las rutas de la web son relativas a `web/`, sin barra inicial, salvo las rutas protegidas y las de sección, que son
 * rutas de URL con barra inicial. Las rutas del repositorio son relativas a su raíz.
 */
import type { IdSeccionPublica } from '../administracion/secciones-web.js';
import type { VarianteRecorrido } from './variantes-recorrido.ts';

/**
 * Una importación con dirección calculada que el empaquetado del navegador admite, con su motivo. Las demás
 * importaciones de los guiones son literales; una calculada que no figura en la lista detiene la construcción.
 */
export interface ImportacionCalculada {
  /** El módulo, relativo a `web/`. */
  readonly archivo: string;
  /** El argumento de import(), tal como está escrito. */
  readonly argumento: string;
  /**
   * Qué hace el empaquetado: `reintento` la dirige a la entrada estable del módulo; `motor` la deja apuntando al motor
   * empaquetado, que se carga por su dirección fija; `literal` la escribe como cadena y el módulo va en su trozo.
   */
  readonly tratamiento: 'reintento' | 'motor' | 'literal';
  /** Lo que carga, relativo a `web/`. */
  readonly objetivo: string;
  readonly motivo: string;
}

export interface Extension {
  /** Variante de recorrido que aporta; es también su identificador en el registro. */
  readonly id: Exclude<VarianteRecorrido, 'real'>;
  /** Página de entrada de la variante, relativa a `web/`. */
  readonly entrada: string;
  /**
   * Rutas de URL que solo se sirven tras la autoridad de recorrido. Una ruta terminada en «/» protege esa carpeta,
   * escrita con o sin la barra final, y todo lo que contiene; las demás se comparan completas.
   */
  readonly rutasProtegidas: readonly string[];
  /** Páginas, relativas a `web/`, que llevan la barrera de versión de la copia sin conexión. */
  readonly paginasConVersion: readonly string[];
  /** Rutas de URL que se suman a cada sección pública y que gobierna su interruptor. */
  readonly rutasDeSeccion: Readonly<Partial<Record<IdSeccionPublica, readonly string[]>>>;
  /** Lo que la comprobación de seguridad de contenido admite en los guiones de la extensión, relativos a `web/`. */
  readonly excepcionesCsp: {
    /** Carpetas cuyos guiones son módulos de la web, con su barra final. */
    readonly carpetasDeJavaScript: readonly string[];
    /** Guiones que insertan HTML a través de la política de confianza, con el número de inserciones. */
    readonly htmlInsertado: Readonly<Record<string, number>>;
    /** Enlaces informativos de otro origen que un guion muestra sin conectarse a ellos. */
    readonly enlacesInformativos: Readonly<Record<string, readonly string[]>>;
  };
  /** Copias generadas de módulos compartidos: ruta de la fuente y ruta de la copia, ambas del repositorio. */
  readonly publicacionesComunes: Readonly<Record<string, string>>;
  /** Proyecto de TypeScript propio, con el nombre con el que aparece en la verificación. */
  readonly proyectoTypeScript: { readonly nombre: string; readonly proyecto: string };
  /** Carpeta de pruebas propia, relativa a la raíz del repositorio. */
  readonly carpetaDePruebas: string;
  /** Las importaciones con dirección calculada de los guiones de la extensión que admite el empaquetado. */
  readonly importacionesCalculadas: readonly ImportacionCalculada[];
}
