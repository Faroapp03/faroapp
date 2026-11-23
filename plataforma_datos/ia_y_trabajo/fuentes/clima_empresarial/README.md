# Idescat: IA y competencias en establecimientos de Cataluña

Generado de `fuente.json`; editar el descriptor y regenerar.

La IA y las competencias en los establecimientos de Cataluña: Enquesta de clima empresarial del Idescat.

ID: `clima_empresarial` · tema: `ia_y_trabajo` · institución: Idescat.
Lector estático: `plataforma_datos.ia_y_trabajo.fuentes.clima_empresarial.lector`. Casa de datos: `clima-empresarial`.

## Alcance

- El módulo de actualidad trata temas variables; algunos se repiten sin una periodicidad fija. Dos de sus ediciones alimentan Faro, con las tablas de Cataluña (columna «Total»), literales, en `f=ssv`:
- - «Intel·ligència artificial» (2.º trimestre de 2024): % de establecimientos que usan alguna tecnología de IA, IA generativa, y qué trabajadores la usan (personal cualificado, directivo o poco cualificado); - «Necessitats formatives i ocupacionals» (4.º trimestre de 2025): % de establecimientos que dan «mucha» importancia a las competencias tecnológicas y digitales (la IA incluida) al contratar.
- Son porcentajes de establecimientos, no de empresas ni de personas, y su universo no es el de la encuesta europea (Eurostat cuenta empresas de 10 o más personas): son de Cataluña y no se comparan con Europa. El Idescat no permite modificar sus datos: cada cifra va tal como la publica, con su fila y su columna comprobadas por su texto. Python estándar.

## Recursos y condiciones de uso

- `recurso-01` (url): Idescat, Enquesta de clima empresarial, mòdul d'actualitat: Ús de tecnologies d'intel·ligència artificial. Per sector d'activitat (Catalunya. 2n trimestre del 2024)
  Ubicación: https://www.idescat.cat/pub/?id=clem&n=18149&lang=es&f=ssv. Licencia: Aviso legal del Idescat (https://www.idescat.cat/institut/web/?lang=es) y condiciones de uso de sus API (https://www.idescat.cat/dev/api/?lang=es): reutilización permitida citando la fuente («Fuente: elaboración propia a partir de datos del Idescat») con la fecha de la última actualización, enlazando con idescat.cat, sin modificar los datos al presentarlos y sin sugerir que el Idescat apoya el uso.
- `recurso-02` (url): Idescat, Enquesta de clima empresarial, mòdul d'actualitat: Treballadors que fan servir tecnologies d'intel·ligència artificial a l'establiment. Per sector d'activitat (Catalunya. 2n trimestre del 2024)
  Ubicación: https://www.idescat.cat/pub/?id=clem&n=18162&lang=es&f=ssv. Licencia: Aviso legal del Idescat (https://www.idescat.cat/institut/web/?lang=es) y condiciones de uso de sus API (https://www.idescat.cat/dev/api/?lang=es): reutilización permitida citando la fuente («Fuente: elaboración propia a partir de datos del Idescat») con la fecha de la última actualización, enlazando con idescat.cat, sin modificar los datos al presentarlos y sin sugerir que el Idescat apoya el uso.
- `recurso-03` (url): Idescat, Enquesta de clima empresarial, mòdul d'actualitat: Valoració de la importància de diferents habilitats o competències per realitzar contractacions de personal. Per sector d'activitat (Catalunya. 4t trimestre del 2025)
  Ubicación: https://www.idescat.cat/pub/?id=clem&n=22205&lang=es&f=ssv. Licencia: Aviso legal del Idescat (https://www.idescat.cat/institut/web/?lang=es) y condiciones de uso de sus API (https://www.idescat.cat/dev/api/?lang=es): reutilización permitida citando la fuente («Fuente: elaboración propia a partir de datos del Idescat») con la fecha de la última actualización, enlazando con idescat.cat, sin modificar los datos al presentarlos y sin sugerir que el Idescat apoya el uso.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consulta` (remoto): Tablas SSV oficiales del Idescat, edición conocida, con sus rótulos y bases. La consulta del recurso no acredita que se haya descubierto una edición posterior.
  Recursos: recurso-01, recurso-02, recurso-03. Autenticación: El lector no configura credenciales de autenticación para estos recursos públicos; no acredita acceso a otros servicios.
  - Cuotas y límites oficiales de servicio no acreditados por este descriptor; rigen los límites de transporte y validación del lector.
  - Este descriptor no acredita la disponibilidad remota actual; una URL conservada no acredita consulta satisfactoria ni una tarea instalada.
  - La comprobación del recurso conocido no acredita una revisión general de ediciones o disposiciones posteriores.

## Operación actual

Política: `edición`. Consulta red: sí.
Frecuencia declarada: trimestral, con temas variables y sin periodicidad fija por tema (Idescat). Aviso de renovación: no definido días.
Originales: `clima-empresarial`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| clima_empresarial | cambiante | edicion-conocida | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:preparar, lector.py:validar, plataforma_datos/orquestacion/admision.py:exigir_admitido.

Retirada: Se conserva la admisión del conjunto y sus guardas actuales. Un fallo o una ausencia de captura no se convierte en retirada de entidades ni en disponibilidad confirmada.

Conservación: Originales, procedencias, preparados y validaciones conservan sus casas actuales en var/actualizacion. Esta ficha no habilita limpieza automática ni cambia fechas históricas, periodos, licencias o retención.

## Reproducción

```sh
python -m plataforma_datos.ia_y_trabajo.fuentes.clima_empresarial.lector preparar
python -m plataforma_datos.ia_y_trabajo.fuentes.clima_empresarial.lector validar
python -m plataforma_datos.contratos.fuentes --fuente clima_empresarial --tema ia_y_trabajo --comprobar
```
