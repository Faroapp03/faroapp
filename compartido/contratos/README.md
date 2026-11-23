Contratos puros que comparten la app y los motores, sin lógica de ningún motor: la app los usa sin cargar el motor.
Nada de aquí importa de `motores/` ni de `src/` (pruebas/motores/fusible-cursos.test.ts lo comprueba).

- `oferta-de-formacion.ts`: la oferta de formación del despliegue (OfertaDeFormacion, OFERTA_POR_DEFECTO,
  MODOS_FORMACION_ABIERTA y descripcionDeLaOferta). El motor de cursos la reexporta en
  `motores/cursos/src/oferta-de-formacion.ts`.
- `formacion-del-informe.ts`: dos datos fijos de la formación (CATALOGO_SEPE, el buscador del catálogo del SEPE, que
  usa también el plan de aprendizaje, y MAX_DIAS_COPIA_CURSOS, la antigüedad máxima de una copia de cursos), que el
  motor de cursos reexporta.
- `filtros-de-cursos.ts`: las opciones de los filtros de la sección «Cursos» (OPCIONES_DE_CURSOS) y las fuentes de la
  bolsa (FUENTES_DE_CURSOS). `/api/cursos` valida con ellas sus filtros y OpenAPI los describe sin cargar el motor, que
  las reexporta.
- Los contratos de los datos del paquete que usa el motor de cursos y que necesitan, sin cargar el motor, el tipo del
  paquete (`src/dominio/tipos-paquete.ts`) y el del informe (`src/dominio/tipos-informe.ts`): `tipos-formacion.ts` (SEPE, SOC,
  Consorci, enlaces comprobados y ACTIC, y la formación del informe), `tipos-citilab.ts`, `tipos-formacion-abierta.ts`,
  `tipos-barcelona-activa.ts`, `tipos-fundae.ts` y `tipos-comarcas-y-temarios.ts`. El motor de cursos los reexporta con
  el mismo nombre de siempre.
- `tipos-eures.ts`: la correspondencia EURES entre ESCO y CO-SISPE (`datos/correspondencia-eures.json`), que lee la
  búsqueda de ocupaciones con el núcleo del paquete; `formacion.json` lleva la misma.
- `idioma.ts`: los idiomas de Faro (IDIOMAS e Idioma); `src/comun/idioma.ts` los reexporta con sus valores por defecto.

Con ellos, ningún motor importa del otro, ni siquiera tipos: los dos importan sus contratos de aquí
(`pruebas/motores/motores-independientes.test.ts` lo comprueba).

La puerta del motor de cursos (`src/plataforma/motor-de-cursos.ts`) y su trabajador propio, que corta una operación que
no termina a tiempo, se explican en `motores/cursos/README.md`.
