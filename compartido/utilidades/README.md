Utilidades puras que comparten la app y los motores, sin lógica de ningún motor: la app las usa sin cargar el motor
de cursos, y el motor las importa de aquí y las reexporta con el mismo nombre. Nada de aquí importa de `motores/` ni de
`src/` (pruebas/motores/fusible-cursos.test.ts lo comprueba): lo poco que necesitan de `src/comun/` (el día en milisegundos, el
orden por código y el alfabético) está escrito aquí igual.

- `fechas.ts`: diasEntreFechas, los días entre dos fechas AAAA-MM-DD (la usan la acreditación del informe y el motor).
- `orden-de-convocatorias.ts`: los órdenes puros de lo que enseña el informe: ordenDeConvocatorias (SOC y Consorci, por
  momento, inicio y nombre) e itinerarioCitilab (los cursos de Citilab de un tramo, por requisitos, inicio y título).
- `ficha-de-barcelona-activa.ts`: fichaDeBarcelonaActiva, la ficha del Catàleg d'ocupacions de una ocupación ESCO. Es
  un dato de la ocupación, no de la formación: el informe la enseña en su contexto aunque no esté el motor.

La puerta del motor de cursos y su límite conocido se explican en `motores/cursos/README.md`.
