// Variables de texto que reciben los lectores de configuración. Cada lector valida sus valores y decide qué
// hacer cuando falta una variable; este alias solo permite leerlas.

/** Variables de texto del entorno, de solo lectura y con ausencias explícitas. */
export type VariablesDelEntorno = Readonly<Record<string, string | undefined>>;
