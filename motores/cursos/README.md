# Motor de consultas de cursos

Este motor responde consultas factuales sobre la formación del paquete: catálogo, formación oficial de una
ocupación y formación del informe JSON. Su entrada pública es `src/index.ts`. No importa el motor de Ocupaciones,
ni siquiera por tipos; los contratos compartidos pertenecen a `compartido/contratos/`.

La selección personal por etapas se ejecuta en el dispositivo mediante `src/seleccion-formacion/` y la ruta local
`/local/formacion/seleccionar`. Usa el catálogo público admitido y su compañero de aprendizaje, con vigencia,
requisitos y abstención. Su documento se imprime completo en tantas páginas A4 como necesite; no envía el perfil a esta API ni al Worker de Cursos.

## Consumidores factuales

- `/api/cursos` llama a `catalogoDeCursos`. Los filtros se validan con el contrato compartido sin cargar el motor.
- MCP, A2A y la API para socios conservan `formacion_oficial`, mediante `formacionDeLaOcupacion`.
- El informe JSON completo conserva `formacionDelInforme`, con formación oficial, transversal, Citilab, abierta y
  otros grupos. `pruebas/ayudas/informe-con-formacion.ts` compone el informe de forma síncrona para pruebas.
- El informe laboral breve tiene dos hojas y no depende de este motor.

## Aislamiento y fallos

`src/plataforma/motor-de-cursos.ts` carga el motor por una sola puerta. La lista cerrada
`OPERACIONES_DE_CURSOS` contiene `catalogoDeCursos`, `formacionDelInforme` y `formacionDeLaOcupacion`.
Los argumentos y resultados conservan el tipo de esas funciones. Los resultados son valores; no se aceptan
referencias de recursos de otro trabajador ni orígenes de archivos en las consultas.

En Node y navegador las operaciones corren en un trabajador propio. Los datos se mandan una vez por identidad
del objeto a cada trabajador, antes de su primera consulta. La cola inicia el plazo de cada operación al atenderla.
Un cálculo bloqueado termina el trabajador y la siguiente consulta abre otro; cerrar la puerta resuelve pendientes
y no la vuelve a abrir. Ocupaciones sigue respondiendo sin esperar a Cursos.

En Cloudflare, el Worker principal usa el binding privado `CURSOS` hacia `worker-cursos.ts`, sin rutas públicas.
Cada petición se basta sola con el paquete de su isolate. El principal conserva su plazo de espera. La construcción
separa los módulos Data, comprueba sus huellas, límites y exportaciones, y exige que el motor de Cursos no entre
en el Worker principal. Ninguno incorpora el modelo del recomendador.

La puerta distingue `ausente`, `averiado` y `bloqueado`. Un fallo de los datos de Cursos anotado por los cargadores
no derriba el núcleo del paquete: `/api/cursos` responde 503, las consultas de formación notifican indisponibilidad
y el informe laboral breve sigue idéntico. Los cargadores no reparan los datos ni sustituyen archivos corruptos.

`pruebas/motores/fusible-cursos*.test.ts`, `pruebas/cloudflare/cloudflare-cursos.test.ts`, `pruebas/administracion/administracion-node.test.ts` y
`pruebas/motores/motores-independientes.test.ts` comprueban estas fronteras. Los ensayos del navegador comprueban también
el trabajador anidado y la copia sin conexión. Una comprobación local no acredita un despliegue remoto de Cloudflare.

## Exportaciones que solo usan las pruebas

Fuera del motor solo se importa `src/index.ts`. Dentro, siete exportaciones de módulos internos no tienen
consumidor en el producto y se conservan porque fijan una conducta que la entrada pública no deja comprobar:

| Exportación | Módulo | Qué fija su prueba |
|---|---|---|
| `CRITERIO_DIGITAL_TRANSVERSAL` | `criterio-digital-transversal.ts` | El criterio original del bloque digital, con el que se reproduce la medición publicada; la entrada pública aplica la adenda vigente salvo que se le pase otro criterio. |
| `ADENDA_DIGITAL_TRANSVERSAL` | `criterio-digital-transversal.ts` | La tabla exacta de la adenda y que es el criterio vigente. |
| `CARPETA_DE_PROGRAMAS` y `direccionDelPrograma` | `enlaces-comprobados.ts` | La dirección del programa oficial y su codificación en los bordes (código vacío, caracteres reservados y sustituto aislado, que lanza `URIError`); el paquete de datos no contiene esos códigos. |
| `ordenAbierto` | `formacion-abierta.ts` | Que el orden de la formación abierta es antisimétrico y transitivo en todos los pares de prueba. |
| `ordenDePrevistas` | `formacion-consorci.ts` | Que el orden de las acciones previstas desempata por modalidad y municipio, y que es estable ante copias. |
| `tramoCitilab` | `formacion-citilab.ts` | El tramo de cada combinación de temas e IA, incluidas combinaciones que el catálogo publicado no contiene. |
