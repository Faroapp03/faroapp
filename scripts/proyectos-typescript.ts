import { EXTENSIONES } from '../src/plataforma/extensiones.ts';

/**
 * Proyectos de TypeScript en el orden de la verificación y sus opciones particulares: los de la aplicación y, tras el
 * del navegador, los de cada extensión instalada: el que declara su registro y el de su carpeta de pruebas.
 */
export const PROYECTOS_TYPESCRIPT: readonly {
  readonly nombre: string;
  readonly proyecto: string;
  readonly sinEmitir: boolean;
}[] = [
  { nombre: 'TypeScript estricto', proyecto: 'tsconfig.json', sinEmitir: false },
  { nombre: 'TypeScript navegador', proyecto: 'tsconfig.web.json', sinEmitir: false },
  ...EXTENSIONES.flatMap(({ proyectoTypeScript, carpetaDePruebas }) => [
    { ...proyectoTypeScript, sinEmitir: false },
    {
      nombre: `${proyectoTypeScript.nombre}, pruebas`,
      proyecto: `${carpetaDePruebas}/tsconfig.json`,
      sinEmitir: false,
    },
  ]),
  { nombre: 'TypeScript pruebas web', proyecto: 'tsconfig.pruebas-web.json', sinEmitir: false },
  { nombre: 'TypeScript service worker', proyecto: 'tsconfig.service-worker.json', sinEmitir: false },
  { nombre: 'TypeScript motor navegador', proyecto: 'tsconfig.navegador.json', sinEmitir: true },
];
