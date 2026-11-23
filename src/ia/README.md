# Reglas lingüísticas de las tareas

El motor local de ocupaciones utiliza `infinitivo.ts` para convertir la primera palabra de una tarea cuando
identifica un único verbo oficial y su contexto permite hacerlo. Ante una ambigüedad conserva el texto.

`verbos-de-las-tareas.ts` conserva el vocabulario derivado del paquete oficial y sus grafías de origen.
`frases.ts` comprueba la forma morfológica del infinitivo en castellano y catalán y la mayúscula inicial.
Estas funciones no realizan llamadas de red ni generan textos.

La limpieza de datos personales y la moderación del recorrido pertenecen a `src/seguridad/` y a la API.
