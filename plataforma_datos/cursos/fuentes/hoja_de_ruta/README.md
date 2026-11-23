# Hoja de ruta: comarcas y temarios desde entradas fijadas

Generado de `fuente.json`; editar el descriptor y regenerar.

Productor local de datos/comarcas.json y datos/temarios.json desde originales fijados de datos/fuentes/hoja-de-ruta. Contrasta sus huellas y conserva la procedencia en datos/manifiesto.json; no adquiere datos remotos ni ofrece la interfaz preparar/validar.

ID: `hoja_de_ruta` · tema: `cursos` · institución: Equipo Faro, elaboración local con procedencia individual de Idescat, SEPE, Consorci y FUNDAE.
Lector estático: `plataforma_datos.cursos.fuentes.hoja_de_ruta.lector`. Sin casa de datos operativa.

## Alcance

- Comarcas: 947 municipios y 43 comarcas de la copia Idescat del 21/10/2026, con códigos y recuentos comprobados y equivalencias explícitas de nombres. Esta elaboración no crea otro lector remoto de Idescat ni sustituye la fuente de clasificaciones ocupacionales.
- Temarios: 415 extractos fijados de especialidades, con objetivo y módulos literales en su idioma, procedencia por ficha y modulosCompletos. Extractos incompletos no se declaran contenidos completos.
- El comando todo --comprobar solo compara entregas y manifiesto; todo genera ambas entregas locales. Ningún comando consulta red ni confirma vigencia actual del curso o del contenido remoto.

## Recursos y condiciones de uso

- `municipios` (archivo): Copia local de https://www.idescat.cat/codis/?id=50&n=9&f=ssv; consulta histórica 21/10/2026, SHA256 25c1277a50d8d66a726c7707d9d65585c7d6d562149bc1a4eda24919dfb5f84e.
  Ubicación: datos/fuentes/hoja-de-ruta/municipis-idescat-2026-10-21.ssv. Licencia: Aviso legal del Idescat (https://www.idescat.cat/institut/web/?lang=es) y condiciones de uso de sus API (https://www.idescat.cat/dev/api/?lang=es): reutilización permitida citando la fuente («Fuente: elaboración propia a partir de datos del Idescat») con la fecha de la última actualización, enlazando con idescat.cat, sin modificar los datos al presentarlos y sin sugerir que el Idescat apoya el uso.
- `temarios` (familia): Extractos, textos y procedencia fijados; cada archivo se contrasta con HUELLAS_TEMARIOS del lector antes de generar.
  Ubicación: datos/fuentes/hoja-de-ruta/{extractos.json,textos.jsonl,procedencia.json}. Licencia: SEPE: Aviso legal del SEPE, Ley 37/2007 y RD 1495/2011: reutilización citando «Origen de los datos: SEPE» y la fecha de la consulta, sin desnaturalizar el sentido ni sugerir aval. | Consorci: Llicència oberta d'ús d'informació – Catalunya (https://web.gencat.cat/ca/generalitat/dades-indicadors/dades-obertes/llicencies): citar la fuente («Consorci per a la Formació Contínua de Catalunya») e informar de la fecha de la última actualización; no alterar el contenido ni desnaturalizar su sentido; sin sublicencia ni uso de logotipos, marcas o símbolos de la Generalitat. | FUNDAE: FUNDAE no publica una licencia de reutilización: se copian literales el objetivo y los contenidos de la ficha pública de la especialidad, citando la fuente y con el enlace a su PDF.
- `entregas` (familia): Entregas locales y manifiesto; conservan las condiciones y procedencia de cada recurso, sin conceder una licencia nueva conjunta.
  Ubicación: datos/{comarcas.json,temarios.json,manifiesto.json}. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `entradas-locales` (local): Producción local explícita; la lista Idescat y cada ficha de especialidad son procedencias del dato, no conexiones remotas nuevas.
  Recursos: municipios, temarios, entregas. Autenticación: No usa credenciales ni consulta red.
  - Solo lee los archivos fijados del producto y sus hashes declarados; no descubre ni descarga nuevas versiones.
  - La fecha consultado procede de la captura/procedencia conservada, no del reloj de ejecución.
  - Generar escribe en datos/ y su manifiesto; comprobar no escribe. No es una lectura pura candidata.

## Operación actual

Modalidad: `productor-local`.
Producción local explícita desde entradas fijadas. No consulta red ni forma parte de los módulos automáticos.
Sin casa operativa var, cadencia remota ni conjuntos de comprobación añadidos.
La comprobación solo lee; la generación escribe las entregas declaradas y su manifiesto.
Contratos y controles: lector.py:paso_comarcas, lector.py:paso_temarios, lector.py:escribir, lector.py:HUELLA_MUNICIPIOS, lector.py:HUELLAS_TEMARIOS, plataforma_datos/cursos/pruebas/test_hoja_de_ruta.py.

Retirada: No retira cursos ni deduce cierre o falsedad por ausencia de entradas; una huella, recuento o procedencia inválida falla explícitamente antes de aceptar ese recurso.

Conservación: Conserva bytes de originales y fechas históricas. Las entregas se derivan determinísticamente; generar conserva los orígenes y hashes en el manifiesto, sin afirmar comprobación remota nueva. Ninguna política automática de retención o activación se añade.

## Reproducción

```sh
python -m plataforma_datos.cursos.fuentes.hoja_de_ruta.lector todo --comprobar
python -m plataforma_datos.cursos.fuentes.hoja_de_ruta.lector todo
python -m plataforma_datos.contratos.fuentes --fuente hoja_de_ruta --tema cursos --comprobar
```
Los argumentos documentan el CLI real; el descriptor no se usa para ejecutar órdenes.
