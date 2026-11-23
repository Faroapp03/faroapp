/**
 * Extensiones instaladas, una línea por extensión, encima de `export {};`. Esa exportación vacía se queda siempre:
 * sin ninguna extensión, mantiene el archivo como módulo en todos los proyectos de TypeScript, también en los que no
 * tratan como módulo un archivo sin importaciones ni exportaciones, y la aplicación sirve solo el recorrido real. Por
 * eso `biome.json` no aplica a este archivo la regla que la marca como inútil junto a otras exportaciones.
 */

export {};
