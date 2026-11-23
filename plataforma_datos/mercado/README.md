# Mercado

Los lectores de Mercado tienen una sola implementación en `fuentes/<id>/lector.py`.
El registro estático `plataforma_datos/orquestacion/reconstruir.py` conserva sus identidades,
su orden y el productor que ejecuta la cadena. Las entradas y salidas operativas siguen
en `var/actualizacion`; mover el código no actualiza sus cifras ni sus fechas.

| Fuente | Qué mide o relaciona |
| --- | --- |
| `cataluna` | Censo 2021 por ocupación y personas contratadas en doce meses del Observatori |
| `ocupados` | Personas ocupadas por ocupación y territorio en los censos INE/Idescat |
| `censo` | Censo 2021 municipal y perfiles de cada grupo de ocupación |
| `salarios` | Encuesta de Estructura Salarial cuatrienal, Cataluña y España |
| `sectores` | Reparto por actividad de cada grupo de ocupación, Censo 2021 |
| `empresas` | Uso de IA en empresas por actividad, tamaño y territorio, INE/Eurostat |
| `observatori` | Contratación, demanda y series territoriales del visor oficial |
| `ilostat` | Empleo por gran grupo ISCO-08, sexo y país, con el año de cada encuesta |
| `necesidades` | Necesidades formativas declaradas en fichas del SEPE; casa `sepe-necesidades` |
| `perfiles` | Certificados nombrados expresamente en perfiles ocupacionales del SEPE |
| `epa` | Personas ocupadas en Cataluña por gran grupo, Encuesta de Población Activa (INE, tabla 65314) |
| `eaes` | Ganancia media anual por grupo de ocupación y sexo en España, EAES (INE, tabla 28186) |
| `ofertas` | Puestos ofertados del SOC y Feina Activa, libro mensual del Observatori del Treball |

Los auxiliares de cada lector están en su carpeta `piezas/` cuando los necesita.
Los contratos ETICCE pertenecen a Empresas y viven en `fuentes/empresas/contratos/`.
Sus bytes y huellas se conservan; cambiar su ruta exige preparar y validar de nuevo,
sin reescribir la procedencia histórica. Los controles de red y archivos están en
`plataforma_datos/comun`; admisión y exportación, en `plataforma_datos/orquestacion`.

`epa`, `eaes` y `ofertas` leen su último periodo de los datos (trimestre, año y mes) y generan
su cita con él; `plataforma_datos/orquestacion/exportacion/mercado.py` lee sus conjuntos validados.
`ocupados` no sustituye a EPA y `salarios` no sustituye a EAES. TICH pertenece a IA y trabajo.

Para preparar y validar una fuente con sus entradas ya conservadas:

```sh
.venv/bin/python -m plataforma_datos.mercado.fuentes.ocupados.lector preparar
.venv/bin/python -m plataforma_datos.mercado.fuentes.ocupados.lector validar
```

Estas dos etapas son locales. Los lectores manuales comprueban sus copias; los
históricos fijos no se convierten en consultas nuevas. Los intervalos de consulta,
las frecuencias declaradas y las dependencias las fija `fuente.json` de cada fuente.
Las pruebas propias están en `pruebas/`; la comprobación del registro y las
transacciones compartidas permanecen con la cadena.

## Fichas operativas

Cada fuente tiene `fuente.json` y un README generado. El JSON gobierna la política,
las cadencias y las dependencias; el registro Python conserva el lector explícito
y su orden. Los documentos no importan código ni activan productores nuevos.

```sh
.venv/bin/python -m plataforma_datos.contratos.fuentes --tema mercado --comprobar
```

La guarda común contrasta casas, identidad del lector y configuración antes de
iniciar la actualización. Las pruebas de la cadena comparan las políticas, los
conjuntos y las dependencias de las trece fichas con una referencia fijada
(`plataforma_datos/contratos/pruebas/operacion-mercado-v1.json`) y fuerzan
divergencias para comprobar que se rechazan.
