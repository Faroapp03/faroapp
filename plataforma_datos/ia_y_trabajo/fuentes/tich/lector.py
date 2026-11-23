"""Uso declarado de la IA generativa en el trabajo por grupo de ocupación: microdatos de la TIC-H 2025 del INE.

La Encuesta sobre Equipamiento y Uso de TIC en los Hogares (TIC-H) 2025 preguntó por primera vez si la persona había
usado alguna herramienta de IA generativa en los tres meses anteriores y para qué. El INE publica el uso por trabajo
solo en tres grupos (ocupaciones manuales, no manuales y TIC, tabla 76444); sus microdatos públicos traen la
ocupación a 2 cifras de la ISCO-08 (`OCUPACION`), con la que aquí se calcula para cada grupo:

- el porcentaje ponderado (factor `FACTOR_P`) de personas ocupadas que usaron IA generativa por motivos de trabajo;
- su intervalo del 95 %: el de Korn–Graubard (proporcion_de_encuesta), Clopper–Pearson con el tamaño efectivo de
  Kish, n_ef = (Σw)² / Σw², ajustado por los grados de libertad del diseño (secciones menos estratos). Recoge la pérdida
  de precisión de los pesos, no la de los conglomerados: el contraste con los errores que publica el INE la mide.

Solo se da un grupo con 100 personas encuestadas o más (`MIN_MUESTRA`) y que pase la regla de publicación de
proporciones del NCHS (proporcion_de_encuesta.regla_nchs); si no, su gran grupo, si pasa. Cataluña se da aparte en lo
que su muestra permite (manuales, no manuales y grandes grupos de 100 o más). Cada grupo lleva su clase, manual o no
manual (`clase_por_isco2`): con ella el informe da, de quienes no la usan, cuántos no saben cómo, con la cifra de
Cataluña del Idescat (`tic_llars`), que exportar_paquete añade al paquete. La clase es un hecho de cada edición
(clases_de_ocupacion.py): un grupo tiene la clase que reúne al menos el 95 % de sus entrevistas en esa edición; si
ninguna llega, no tiene clase: el dato lo declara (`grupos_sin_clase`), el panel cuenta cuántos hay y el informe no da
para él esa línea. El informe de validación guarda el reparto en entrevistas de cada grupo con las dos clases.

El paso desde la CNO-11 sale de la correspondencia oficial del INE que Faro ya tiene (clasificaciones), pero la TIC-H
no llega a la ISCO-08 por ese camino: el entrevistador anota la ocupación directamente a 2 cifras con la lista del
anexo II de la metodología (pregunta 73a). Donde los dos caminos llevan a las mismas personas a grupos distintos, el
paso no usa el grupo de 2 cifras: los grandes grupos 1 y 4 se dan enteros, y el 25 y el 35 forman un bloque
(`GRANDES_GRUPOS_ENTEROS`, `BLOQUES`).

Controles con alarma: los microdatos reproducen las cifras publicadas de la tabla de uso (población y uso por trabajo de
cada grupo); y la regla de los bloques se comprueba sola con la EPA en la ISCO-08 a 2 cifras (Eurostat `lfsa_egai2d`):
con otro año de la TIC-H, un grupo que la entrevista reparta de otra forma que la correspondencia se da en su gran grupo
(ver «Reparto con la EPA»). Solo la edición nueva, antes de incorporarse, lee sus PDF de metodología y cuestionario,
con la biblioteca `pypdf` (documentos_de_la_edicion.py).

Ediciones: el catálogo de INEbase dice qué edición hay. Si anuncia resultados de un año posterior al calculado, la
consulta termina bien, conserva y publica la edición calculada y registra lo observado en la procedencia y en el dato
(`edicion_nueva`): «pendiente-de-incorporar» si el último ZIP de microdatos es del mismo año que esos resultados, y
«publicada-sin-microdatos» si no. Lleva la huella del catálogo consultado y la primera fecha en que se vio ese año en
ese estado, que no cambia aunque cambien los bytes del catálogo; si el catálogo vuelve a la edición calculada, la
observación se retira. No es un fallo de consulta: no suma para los reintentos ni pone el módulo en rojo; el panel la
recibe en la fila de la fuente (`edicionNueva`) y el informe la dice con el día de Barcelona en que se observó, si no es
posterior a la fecha del informe. La validación exige su forma (año de cuatro cifras, instante ISO, huella de 64
hexadecimales) y que case con la edición y la huella del catálogo de la procedencia. Un catálogo con un año anterior al
calculado, o con microdatos de un año sin sus resultados, detiene la consulta. El dato declara los años que mide
(`anios_medidos`, en orden, sin repetir y terminando en el calculado), de los que el informe deriva cómo ha ido la
cifra. Con la edición nueva pendiente de incorporar, la consulta localiza por su título, desde el catálogo, la tabla de
uso y la de errores de ese año y la dirección de su metodología y de su cuestionario, con una sola coincidencia en cada
paso (navegacion.py), y las deja en la procedencia con la dirección y la huella de cada página recorrida
(`tablas_edicion_nueva`); si un paso no se puede dar (sin coincidencia o con varias, de otro año, fuera de INEbase,
redirigido, sin UTF-8 o por la red), queda su motivo cerrado y su detalle (`tablas_edicion_nueva_detenida`) y la fuente
conserva la edición calculada. La edición admitida, con sus tablas, el año de la EPA con que se contrasta, sus secciones
censales en muestra y la huella de su metodología y de su cuestionario, sale del estado de la edición
(`validados/tich/edicion.json`, edicion.py), que solo escribe la validación al admitir el conjunto, entero o nada; sin
estado, es la primera (2025). Los originales de cada edición viven en `originales/tich/<año>/` con su procedencia, y la
de la operación los registra con esa ruta; un original suelto en `originales/tich/` pasa a la carpeta de su año con su
huella comprobada, en una consulta; los sueltos solo se retiran en una consulta posterior, en la que no se ha migrado
nada, y si la última validación admitida leyó la procedencia que apunta a las copias (`originales_validados` de su
informe). Un suelto se retira solo si tanto él como su copia conservan la huella registrada, y lo retirado queda en
`sueltos-retirados.json`. El dato publicado guarda la huella del catálogo de la primera observación de ese año y
estado, para no cambiar con cada consulta; la de cada consulta queda en la procedencia y en el panel.

Observaciones defectuosas: una observación anterior mal formada no bloquea la consulta; se descarta con su motivo
(`edicion_nueva_descartada` en la procedencia y un control de la validación) y la edición nueva se observa de nuevo con
la fecha de esa consulta. Si el panel no puede verificar la procedencia, la fila de la fuente queda sin `edicionNueva` y
con su aviso (`avisoEdicion`), y el resto del panel sigue.

Tablas publicadas y motivo de no uso: la tabla de errores se lee en sus dos formas conocidas, la de 2025 (cuatro
columnas, comunidades con código) y la de 2026 (tres columnas, «Total nacional» como una fila más y comunidades sin
código), reconocidas por su cabecera; otra forma detiene la lectura (tablas_publicadas.py). Para Cataluña se calcula
además, por clase manual o no manual, el porcentaje de quienes no usaron la IA generativa que no sabían cómo usarla
(motivos_no_uso.py), la base de la tabla 3.4.2 del Idescat. Es un cálculo de contraste para `tic_llars`, no una cifra
publicada: se estima con dos entrevistas o más (lo que necesita el intervalo) y va al preparado y al informe de
validación (`contraste_no_sabe_como`, con la descripción de `IAG_NO3` en el diseño de registro), nunca al paquete.
`IAG_NO3` no es obligatoria: si la edición no la trae, el cálculo queda sin clases y `tic_llars` se valida sin contraste
del motivo; `tich` no falla. Enunciado y muestra: la preparación de la edición admitida comprueba en su diseño de
registro, que llega con los microdatos, que `IAG` e `IAG_TRAB` conservan cada parte de la pregunta (pregunta, periodo,
opción de uso por trabajo y códigos); una parte distinta detiene la preparación y dice cuál. Sus PDF no se vuelven a
leer: las secciones censales en muestra (2.500 en España y 216 en Cataluña en 2025) y la huella de su metodología y de
su cuestionario están en el estado de la edición, y dan los grados de libertad. La edición nueva sí los lee, y compara
su cuestionario por partes, antes de incorporarse (candidata.py).

Universo: todas las estimaciones por grupo se calculan con las personas ocupadas de 16 a 74 años, el universo de la
encuesta y de sus tablas; con él, la población de cada grupo que publica el INE coincide con la de la tabla, con una
persona de margen por el redondeo; una fila sin edad detiene la lectura. La tabla de uso trae celdas que
el INE no publica («..»): no tienen cifra, y solo detiene la lectura que falte la de un grupo que se contrasta.

Reparto con la EPA: un grupo que se daría a 2 cifras y cuya cuota dentro de su gran grupo no está entre la mitad y el
doble de la de la EPA del año de la edición o, mientras Eurostat no la publique, de la del año que declara el estado de
la edición (`epa_anio`, también en el dato; epa_por_anio.py: cada consulta pide el año de la edición y, cuando llega, se
usa y la validación lo registra en el estado), o que no tiene cuota en ella, se da en su gran grupo, y el dato lo dice
con su motivo (`grupos_en_su_gran_grupo`; el panel cuenta cuántos). El gran grupo que los recibe tiene que tener cifra y
cumplir la misma regla en el total de ocupados; si no, la validación se detiene, para que un error sistemático no quede
oculto bajo muchas bajadas (reparto_con_la_epa.py).

Incorporación de la edición nueva: con la edición nueva pendiente de incorporar y navegada entera, la consulta baja a
`originales/tich/<año>/`, con su procedencia, sus microdatos, sus dos tablas, su EPA (la de su año si Eurostat la
publica; si no, la del año declarado, copiada de la admitida, sin pedirla dos veces) y su metodología y su cuestionario;
es la candidata (`candidata` en la procedencia de la operación; candidata.py). Un fallo al bajarla no tumba la consulta:
la deja detenida con motivo «tablas» (`candidata_detenida`), con las peticiones hechas hasta el fallo. Cada consulta
vuelve a pedir todos sus originales y acepta los bytes nuevos con su huella nueva, porque la candidata no es lo
publicado: si el INE corrige un original en la misma dirección, el intento siguiente lo ve. La cobertura de la consulta
cuenta sus peticiones. La preparación la calcula con los mismos pasos que la admitida, en `preparados/tich/candidata/` y
con las huellas de los originales de que sale, y además lee sus documentos: las secciones en muestra de su metodología y
el enunciado de su cuestionario, por partes. La validación la contrasta con los mismos controles. Si los pasa todos, se
publica la suya, con la serie de años que mide; el estado de la edición pasa a ella, con sus secciones y la huella de
sus dos documentos, y la procedencia de la operación registra sus originales y retira la observación de la edición
nueva. Esa consulta pidió también los originales de la edición anterior, los índices navegados y los dos PDF: la
procedencia los conserva tal como estaban registrados en `consulta_de_la_incorporacion` (`anterior`, `indices` y
`documentos`) y la cobertura de ese día cuenta exactamente esas peticiones, más el catálogo y el sondeo de la EPA; la
consulta del día siguiente escribe la procedencia normal, sin ese bloque. Si no, se publica la admitida, y el informe de
validación (`candidata_detenida`) y el panel dicen que la nueva está «detenida-por-controles», con un motivo de lista
cerrada: «enunciado-distinto» (con las partes que cambian), «tablas» (tablas, documentos u originales no localizados o
no descargados) o «controles» (otro control que no pasa, nombrado en el detalle). Nada se decide por fecha ni por plazo:
solo por lo observado y validado. El panel exige además que el año del estado de la edición sea el del conjunto
validado, y la exportación, que sea el del paquete; si no, el panel lo avisa («edicion-no-coincide») y la exportación se
detiene.

Enunciado retocado: un cambio del enunciado nunca se da por bueno solo; deja la candidata en «enunciado-distinto» y el
panel dice qué parte cambió. Para admitir un retoque que no cambia lo que se pregunta (una coma, un ejemplo más en la
lista), se añade a `VARIANTES_ACEPTADAS` (documentos_de_la_edicion.py), para ese año y esa parte, el fragmento del
cuestionario que sustituye al de la serie, con su evidencia en el comentario de la entrada: la dirección y la huella del
cuestionario del INE, y la página y el texto donde se lee; se añade una prueba con ese cuestionario y la preparación
siguiente lo compara con él. Un retoque de la descripción de `IAG` o `IAG_TRAB` en el diseño de registro se admite
igual, en `VARIANTES_DEL_DISENO`, por año, variable y parte, con su evidencia (el diseño de registro del INE, con la
huella de sus microdatos); los códigos no admiten variantes.

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.tich.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import csv
import io
import json
import sys
import time
import zipfile
from collections.abc import Callable, Container, Iterable, Mapping
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    comprobar_originales,
    controles_de_huella,
    guardar_json,
    leer_json,
    original,
)
from plataforma_datos.comun.estadisticas import LICENCIA_INE, LICENCIA_TEXTO_INE
from plataforma_datos.comun.lugares import CODIGO_INE_DE_CATALUNA as CATALUNA
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    ARCHIVO_DE_VALIDACION,
    ArchivoDescargable,
    Controles,
    FormatoInesperado,
    exigir,
    leer_del_zip,
)
from plataforma_datos.comun.red import (
    PAUSA_ENTRE_PETICIONES_S,
    descubrimiento_previo_unico,
    descubrir_edicion,
)
from plataforma_datos.ia_y_trabajo.fuentes.tich import candidata, epa_por_anio
from plataforma_datos.ia_y_trabajo.fuentes.tich import edicion as estado
from plataforma_datos.ia_y_trabajo.fuentes.tich import edicion_nueva as ediciones
from plataforma_datos.ia_y_trabajo.fuentes.tich.clases_de_ocupacion import (
    clase_de_cada_grupo,
    con_las_dos_clases,
    control_de_las_clases,
    frase_de_los_sin_clase,
    sin_clase,
)
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import (
    BLOQUES,
    CATALOGO,
    CODIFICACION_MICRODATOS,
    CONDICIONES_MICRODATOS,
    EPA_DATASET,
    ESTIMACIONES,
    FICHERO_CUESTIONARIO,
    FILA_CONTRASTE,
    FUENTE,
    FUERZAS_ARMADAS,
    GRANDES_GRUPOS_ENTEROS,
    GRUPOS_PUBLICADOS,
    MARGEN_POBLACION_PERSONAS,
    MARGEN_PORCENTAJE,
    MAX_MIEMBRO_BYTES,
    MIN_MUESTRA,
    NO_SABE,
    ORIGINAL,
    POBLACION_PUBLICADA,
    PROCEDENCIA,
    PUBLICADAS,
    RESULTADOS,
    TOTAL_DEL_GRUPO,
    USO_POR_TRABAJO,
    VALIDADO,
    VARIABLES,
    VARIABLES_OPCIONALES,
    cita,
    nombre_fuente,
)
from plataforma_datos.ia_y_trabajo.fuentes.tich.documentos_de_la_edicion import (
    EnunciadoDistinto,
    de_la_admitida,
    diferencias_del_diseno,
)
from plataforma_datos.ia_y_trabajo.fuentes.tich.ediciones import edicion_del_catalogo
from plataforma_datos.ia_y_trabajo.fuentes.tich.errores_del_ine import contraste_errores_ine
from plataforma_datos.ia_y_trabajo.fuentes.tich.estimacion import (
    calcular,
    clases_por_isco2,
    contraste_por_comunidad,
    del_universo,
    estimar,
    grados_del_diseno,
    poblacion_por_isco2,
)
from plataforma_datos.ia_y_trabajo.fuentes.tich.motivos_no_uso import no_sabian_como
from plataforma_datos.ia_y_trabajo.fuentes.tich.navegacion import tablas_de_la_edicion_nueva
from plataforma_datos.ia_y_trabajo.fuentes.tich.reparto_con_la_epa import (
    control_de_sus_grandes_grupos,
    en_la_regla,
    grupos_a_su_gran_grupo,
    razon_del_bloque,
    razones_de_cuota,
)
from plataforma_datos.ia_y_trabajo.fuentes.tich.tablas_publicadas import errores_publicados, uso_publicado
from plataforma_datos.orquestacion.admision import cerrar_validacion, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

# El estado de la edición admitida (edicion.py): lo escribe solo validar, tras admitir el conjunto.
ESTADO_EDICION = estado.ESTADO
# Lo preparado de la candidata, aparte de lo de la admitida (candidata.py).
PREPARADA = candidata.PREPARADA

# ---------------------------------------------------------------------------------------------------------------------
# Lectura
# ---------------------------------------------------------------------------------------------------------------------


def _original(edicion: Mapping[str, Any], nombre: str) -> Path:
    """Un original de la edición, en la carpeta de su año y comprobado con la procedencia de ese año.

    Returns:
        Su ruta.
    """
    return original(FUENTE, nombre, estado.carpeta(edicion, ORIGINAL))


def _cuestionario(edicion: Mapping[str, Any]) -> tuple[list[dict[str, str]], dict[str, Any]]:
    """Filas del fichero del cuestionario de la edición (solo las variables que se usan) y su diseño de registro.

    Returns:
        Las filas y el diseño de registro.

    Raises:
        EnunciadoDistinto: Si el diseño de registro no trae la pregunta de la serie (documentos_de_la_edicion.py).
    """
    nombres = estado.nombres(edicion)
    with zipfile.ZipFile(_original(edicion, nombres.microdatos)) as externo:
        interno = zipfile.ZipFile(io.BytesIO(leer_del_zip(externo, FICHERO_CUESTIONARIO, MAX_MIEMBRO_BYTES)))
    with interno:
        diseno = json.loads(leer_del_zip(interno, nombres.diseno, MAX_MIEMBRO_BYTES))
        if diferencias := diferencias_del_diseno(diseno, edicion["anio"]):
            raise EnunciadoDistinto(diferencias)
        texto = leer_del_zip(interno, nombres.datos, MAX_MIEMBRO_BYTES).decode(CODIFICACION_MICRODATOS)
    lector = csv.DictReader(io.StringIO(texto), delimiter="\t")
    exigir(set(VARIABLES) <= set(lector.fieldnames or ()), f"{nombres.datos}: faltan variables de {VARIABLES}")
    leidas = (*VARIABLES, *(variable for variable in VARIABLES_OPCIONALES if variable in (lector.fieldnames or ())))
    return [{variable: fila[variable] for variable in leidas} for fila in lector], diseno


def _epa_por_isco2(edicion: Mapping[str, Any]) -> dict[str, float]:
    """Personas ocupadas de la EPA (miles) por grupo ISCO-08 de 2 cifras, del JSON-stat de Eurostat lfsa_egai2d.

    Returns:
        {grupo ISCO-08 de 2 cifras: miles de personas ocupadas}.
    """
    nombre = estado.nombres(edicion).epa
    datos = json.loads(_original(edicion, nombre).read_text(encoding="utf-8"))
    exigir(datos.get("extension", {}).get("id") == EPA_DATASET, f"{nombre}: no es la tabla {EPA_DATASET}")
    posiciones = datos["dimension"]["isco08"]["category"]["index"]
    valores = datos["value"]
    exigir(isinstance(valores, (dict, list)), f"{nombre}: value no es un objeto ni una lista JSON-stat")
    if isinstance(valores, list):
        valores = {str(posicion): valor for posicion, valor in enumerate(valores)}
    valores = {
        codigo[2:]: valores.get(str(posicion))
        for codigo, posicion in posiciones.items()
        if codigo.startswith("OC") and len(codigo) == len("OC") + 2
    }
    return {grupo: valor for grupo, valor in sorted(valores.items()) if valor is not None}


# ---------------------------------------------------------------------------------------------------------------------
# Cifras publicadas
# ---------------------------------------------------------------------------------------------------------------------


def _publicadas_errores(edicion: Mapping[str, Any]) -> dict[str, float]:
    """De la tabla de errores, el error estándar relativo (%) de la variable de contraste en España y por comunidad.

    Returns:
        {ámbito: error estándar relativo en %}, de cualquiera de las dos formas de la tabla (tablas_publicadas.py).
    """
    nombre = estado.nombres(edicion).errores
    texto = _original(edicion, nombre).read_text(encoding="utf-8-sig")
    return errores_publicados(texto, nombre, FILA_CONTRASTE)


def _publicadas_uso(edicion: Mapping[str, Any]) -> dict[str, dict[str, float]]:
    """De la tabla de uso, para cada grupo publicado: su población y su % de uso por trabajo.

    Returns:
        {grupo publicado: población y % de uso}.
    """
    nombre = estado.nombres(edicion).uso
    cifras_de_la_tabla = uso_publicado(_original(edicion, nombre).read_text(encoding="utf-8-sig"), nombre)
    cifras = {}
    for grupo, (_, _, rotulo) in GRUPOS_PUBLICADOS.items():
        del_grupo = {
            categoria: valor
            for (poblacion, caracteristica, categoria), valor in cifras_de_la_tabla.items()
            if (poblacion, caracteristica) == (POBLACION_PUBLICADA, rotulo)
        }
        exigir(
            del_grupo.get(TOTAL_DEL_GRUPO) is not None and del_grupo.get(USO_POR_TRABAJO) is not None,
            f"{nombre}: falta la cifra publicada del grupo «{rotulo}»",
        )
        cifras[grupo] = {"poblacion": del_grupo[TOTAL_DEL_GRUPO], "pct": del_grupo[USO_POR_TRABAJO]}
    return cifras


# ---------------------------------------------------------------------------------------------------------------------
# Validación y conjunto para el motor
# ---------------------------------------------------------------------------------------------------------------------


def _controles_publicadas(controles: Controles, estimaciones: dict[str, Any], publicadas: dict[str, Any]) -> None:
    """Los microdatos reproducen la población y el % de uso por trabajo de la tabla de uso de la edición."""
    for grupo, publicada in publicadas["uso"].items():
        calculada = estimaciones["espana_grupos"][grupo]
        if "pct" not in calculada or "poblacion" not in calculada:
            controles.comprobar(False, f"{grupo}: sin cifra con muestra suficiente para contrastar con la tabla de uso")
            continue
        diferencia = calculada["poblacion"] - publicada["poblacion"]
        controles.comprobar(
            abs(diferencia) <= MARGEN_POBLACION_PERSONAS
            and abs(calculada["pct"] - publicada["pct"]) < MARGEN_PORCENTAJE,
            f"{grupo}: los microdatos dan {calculada['pct']} % de uso por trabajo y {calculada['poblacion']} personas, "
            f"como la tabla de uso ({publicada['pct']} % y {round(publicada['poblacion'])}; "
            f"diferencia {diferencia:.0f})",
        )


def _controles_grupos(
    controles: Controles, estimaciones: dict[str, Any], grupos_isco: Iterable[str], isco: Container[str]
) -> None:
    """Grupos ISCO-08 del diseño que existen, y cifras solo con muestra suficiente e intervalos coherentes."""
    codigos = set(grupos_isco) - {NO_SABE}
    controles.comprobar(
        all(codigo in isco for codigo in codigos),
        f"los {len(codigos)} grupos ISCO-08 de 2 cifras del diseño de registro existen en la CIUO-08",
    )
    con_cifra = [grupo for grupos in estimaciones.values() for grupo in grupos.values() if "pct" in grupo]
    controles.comprobar(
        all(
            grupo["muestra"] >= MIN_MUESTRA and grupo["ic95"][0] <= grupo["pct"] <= grupo["ic95"][1]
            for grupo in con_cifra
        ),
        f"las {len(con_cifra)} cifras con dato tienen {MIN_MUESTRA} personas encuestadas o más y su intervalo las "
        "contiene",
    )


def cifra_por_isco2(conjunto: dict[str, Any], grupo: str) -> dict[str, Any] | None:
    """La cifra que corresponde a un grupo ISCO-08 de 2 cifras al que se llega desde la CNO-11.

    Por este orden: la de su bloque, si está en uno; la del grupo, si la tiene; la de su gran grupo, si la tiene.

    Returns:
        La cifra del grupo, o None si no tiene.
    """
    bloque = conjunto["bloque_por_isco2"].get(grupo)
    if bloque:
        return conjunto["espana_bloques"].get(bloque)
    return conjunto["espana_isco2"].get(grupo) or conjunto["espana_isco1"].get(grupo[:1])


def _suprimido_por_la_regla(estimaciones: dict[str, Any], grupo: str) -> bool:
    """Si un grupo de 2 cifras se queda sin cifra porque la del último nivel de su cadena no pasa la regla del NCHS.

    Returns:
        True si la regla deja al grupo sin cifra.
    """
    bloque = BLOQUES.get(grupo)
    ultima = estimaciones["espana_bloques"].get(bloque) if bloque else estimaciones["espana_isco1"].get(grupo[:1])
    return bool(ultima) and "pct" in ultima and not ultima["regla_nchs"]["publicable"]


def _controles_correspondencia(controles: Controles, conjunto: dict[str, Any], estimaciones: dict[str, Any]) -> None:
    """Cada código CNO-11 civil llega a una cifra: la de su bloque, su grupo ISCO-08 de 2 cifras o su gran grupo.

    Se quedan sin cifra las fuerzas armadas (ISCO-08 0), sin muestra suficiente en ningún nivel, y los grupos cuyo gran
    grupo tampoco pasa la regla de publicación del NCHS: el informe no da cifra antes que dar una que no se sostiene.
    """
    sin_cifra = sorted(
        {
            grupo
            for grupos in conjunto["isco2_por_cno11"].values()
            for grupo in grupos
            if not grupo.startswith(FUERZAS_ARMADAS) and cifra_por_isco2(conjunto, grupo) is None
        }
    )
    por_otra_razon = [grupo for grupo in sin_cifra if not _suprimido_por_la_regla(estimaciones, grupo)]
    controles.comprobar(
        not por_otra_razon,
        f"los {len(conjunto['isco2_por_cno11'])} códigos CNO-11 de 4 cifras llevan a una cifra: la de su bloque, la "
        "de su grupo ISCO-08 de 2 cifras o la de su gran grupo (salvo las fuerzas armadas"
        + (f" y los grupos {sin_cifra}, cuyo gran grupo no pasa la regla del NCHS)" if sin_cifra else ")")
        + (f"; sin cifra por otra razón: {por_otra_razon[:5]}" if por_otra_razon else ""),
    )


def _controles_regla(controles: Controles, estimaciones: dict[str, Any]) -> dict[str, Any]:
    """La regla del NCHS aplicada: qué cifras no se presentan y por qué; ninguna presentada pide revisión ni nota.

    Returns:
        Las cifras que no se presentan, con su motivo.
    """
    con_cifra = {
        f"{nivel}/{codigo}": grupo for nivel, grupos in estimaciones.items() for codigo, grupo in grupos.items()
    }
    con_cifra = {clave: grupo for clave, grupo in con_cifra.items() if "pct" in grupo}
    presentadas = {clave: grupo["regla_nchs"] for clave, grupo in con_cifra.items() if _publicable(grupo)}
    con_aviso = sorted(
        clave for clave, regla in presentadas.items() if regla["revision"] or not regla["complemento_fiable"]
    )
    controles.comprobar(
        not con_aviso,
        f"ninguna de las {len(presentadas)} cifras que se presentan pide la revisión estadística del NCHS (p = 0 o 1, "
        "o menos de 8 grados de libertad) ni la nota de un complemento poco fiable"
        + (f"; con aviso: {con_aviso}" if con_aviso else ""),
    )
    return {
        "norma": "NCHS Data Presentation Standards for Proportions (Parker y otros, 2017, Vital Health Stat 2(175)): "
        "no se presenta si n < 30 o n efectiva < 30, si el intervalo de Korn–Graubard mide 0,30 o más, o si mide más "
        "de 0,05 y menos de 0,30 con un ancho relativo de más del 130 %",
        "cifras_con_dato": len(con_cifra),
        "se_presentan": len(presentadas),
        "no_se_presentan": {
            clave: {"pct": grupo["pct"], "ic95": grupo["ic95"], "motivos": grupo["regla_nchs"]["motivos"]}
            for clave, grupo in con_cifra.items()
            if clave not in presentadas
        },
    }


def _controles_epa(controles: Controles, preparado: dict[str, Any], conjunto: dict[str, Any]) -> dict[str, Any]:
    """La regla de los bloques se cumple: cada grupo que se da a 2 cifras y cada bloque, con la EPA. Da las razones.

    Returns:
        Las razones de cuota de los grupos y de los bloques.
    """
    poblacion, epa = preparado["poblacion_isco2"], preparado["epa_isco2"]
    razones = razones_de_cuota(poblacion, epa)
    usados = {grupo: razones[grupo] for grupo in conjunto["espana_isco2"] if grupo in razones}
    # Un grupo que se da a 2 cifras sin cuota en la EPA no tiene razón que comprobar: el control falla y lo nombra.
    sin_razon = sorted(set(conjunto["espana_isco2"]) - set(razones))
    fuera = {grupo: razon for grupo, razon in usados.items() if not en_la_regla(razon)}
    controles.comprobar(
        not sin_razon and not fuera,
        f"los {len(usados)} grupos que se dan a 2 cifras tienen dentro de su gran grupo, en la TIC-H, entre la mitad "
        f"y el doble de la cuota de la EPA (Eurostat lfsa_egai2d): de ×{min(usados.values(), default=None)} a "
        f"×{max(usados.values(), default=None)}"
        + (f"; sin cuota en la EPA: {sin_razon}" if sin_razon else "")
        + (f"; fuera: {fuera}" if fuera else ""),
    )
    bloques: dict[str, float] = {}
    for bloque in sorted(set(BLOQUES.values())):
        bloques[bloque] = razon_del_bloque(
            (grupo for grupo, su_bloque in BLOQUES.items() if su_bloque == bloque), poblacion, epa
        )
        controles.comprobar(
            en_la_regla(bloques[bloque]),
            f"el bloque {bloque} tiene en la TIC-H ×{bloques[bloque]} la cuota de la EPA en el total de ocupados, "
            "entre la mitad y el doble",
        )
    return {"razon_de_cuota_en_su_gran_grupo": razones, "razon_de_cuota_de_cada_bloque": bloques}


def isco2_por_cno11(correspondencia: dict[str, list[dict[str, str]]]) -> dict[str, list[str]]:
    """Grupos ISCO-08 de 2 cifras de cada código CNO-11 de 4 cifras, según la correspondencia oficial del INE.

    Returns:
        {código CNO-11: grupos ISCO-08 de 2 cifras}.
    """
    grupos: dict[str, set[str]] = {}
    for isco, pares in correspondencia.items():
        for par in pares:
            grupos.setdefault(par["cno11"], set()).add(isco[:2])
    return {cno: sorted(isco) for cno, isco in sorted(grupos.items())}


def _publicable(grupo: dict[str, Any]) -> bool:
    """Si un grupo tiene cifra que se presenta: con MIN_MUESTRA personas o más y pasando la regla del NCHS.

    Returns:
        True si la cifra se presenta.
    """
    return "pct" in grupo and grupo["regla_nchs"]["publicable"]


def _con_cifra(grupos: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Solo los grupos con cifra que se presenta, con los campos del paquete: los demás no pasan al motor.

    Returns:
        {grupo: campos del paquete} de los que tienen cifra.
    """
    return {
        codigo: {campo: valor for campo, valor in grupo.items() if campo != "regla_nchs"}
        for codigo, grupo in grupos.items()
        if _publicable(grupo)
    }


def _de_paso(grupos: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Los grupos de 2 cifras con cifra que el paso desde la CNO-11 usa: ni de un gran grupo entero ni de un bloque.

    Returns:
        {grupo: campos del paquete} de los que usa el paso.
    """
    return {
        codigo: grupo
        for codigo, grupo in _con_cifra(grupos).items()
        if codigo[:1] not in GRANDES_GRUPOS_ENTEROS and codigo not in BLOQUES
    }


def _conjunto_validado(
    preparado: dict[str, Any],
    correspondencia: dict[str, list[dict[str, str]]],
    bajados: Mapping[str, str] | None = None,
    *,
    edicion: estado.Edicion,
) -> dict[str, Any]:
    """Versión para el motor: uso por trabajo por grupo, la clase de cada grupo y el paso desde la CNO-11.

    Returns:
        El conjunto para el motor.
    """
    estimaciones = preparado["estimaciones"]
    return {
        "fuentes": {"tich": cita(edicion["anio"], edicion["tablas"])},
        "anio": edicion["anio"],
        "pregunta": "Uso de alguna herramienta de IA generativa por motivos profesionales (trabajo) en los últimos "
        "3 meses",
        "poblacion": "Personas ocupadas de 16 a 74 años",
        "metodo": "Cálculo propio con los microdatos: porcentaje ponderado; intervalo del 95 % de Korn–Graubard "
        "(Clopper–Pearson con el tamaño efectivo de Kish, ajustado por los grados de libertad del diseño: secciones "
        "menos estratos; Korn y Graubard, 1998). No recoge los conglomerados, que el fichero público no identifica: "
        "el contraste con los errores de muestreo del INE lo mide. Solo se dan las cifras que pasan la regla de "
        "presentación de proporciones del NCHS (Parker y otros, 2017). Desde la CNO-11 se llega a un bloque (25+35), "
        "a un grupo de 2 cifras o al gran grupo (enteros, el 1 y el 4).",
        "min_muestra": MIN_MUESTRA,
        "espana_isco2": {g: v for g, v in _de_paso(estimaciones["espana_isco2"]).items() if g not in (bajados or {})},
        # Los grupos que la EPA no confirma, con su motivo: se dan en su gran grupo (reparto_con_la_epa.py).
        "grupos_en_su_gran_grupo": dict(bajados or {}),
        "epa_anio": edicion["epa_anio"],
        "espana_isco1": _con_cifra(estimaciones["espana_isco1"]),
        "espana_bloques": _con_cifra(estimaciones["espana_bloques"]),
        "bloque_por_isco2": dict(BLOQUES),
        "grandes_grupos_enteros": list(GRANDES_GRUPOS_ENTEROS),
        "espana_grupos": _con_cifra(estimaciones["espana_grupos"]),
        "cataluna_isco1": _con_cifra(estimaciones["cataluna_isco1"]),
        "cataluna_grupos": _con_cifra(estimaciones["cataluna_grupos"]),
        "clase_por_isco2": clase_de_cada_grupo(preparado["clases_por_isco2"]),
        "grupos_sin_clase": sin_clase(preparado["clases_por_isco2"]),
        "isco2_por_cno11": isco2_por_cno11(correspondencia),
    }


# ---------------------------------------------------------------------------------------------------------------------
# Etapas
# ---------------------------------------------------------------------------------------------------------------------


def _edicion_del_catalogo_utf8(contenido: bytes) -> dict[str, int | str]:
    """Lee la edición del catálogo del INE, que debe llegar en UTF-8 estricto.

    Returns:
        La edición anunciada por el catálogo.

    Raises:
        FormatoInesperado: Si el catálogo no es UTF-8 válido o no identifica una edición.
    """
    try:
        pagina = contenido.decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        raise FormatoInesperado("TIC-H: el catálogo del INE no es UTF-8 válido") from error
    return edicion_del_catalogo(pagina)


def _originales_validados() -> list[str]:
    """Los originales, con su ruta de año, que leyó la última validación admitida, según su informe.

    Returns:
        Los originales; vacíos si no hay validación o no está admitida.
    """
    ruta = VALIDADO / ARCHIVO_DE_VALIDACION
    informe = leer_json(ruta) if ruta.exists() else {}
    leidos = informe.get("originales_validados")
    admitida = str(informe.get("estado", "")).startswith("Admitido")
    return leidos if admitida and isinstance(leidos, list) else []


def descargar(aceptar_cambio: bool = False) -> None:
    """Comprueba la edición del catálogo antes de descargar los cuatro originales de la edición admitida.

    La edición admitida es la del estado de la edición (edicion.py); sus originales van a la carpeta de su año, con su
    procedencia, y la procedencia de la operación los registra con esa ruta.

    Una edición más reciente que la admitida queda en la procedencia como observación (`edicion_nueva`), con la
    primera fecha en que se vio con ese año y ese estado y la huella del catálogo consultado; la consulta termina bien
    y conserva la edición admitida, así que no cuenta como fallo para los reintentos. Si el catálogo vuelve a anunciar
    la edición admitida, la observación se retira. La preparación y validación de originales históricos no consultan
    el catálogo.

    Raises:
        FormatoInesperado: Si el catálogo es incoherente con la edición admitida o no llega del INE en UTF-8, o si la
            observación anterior no tiene la forma esperada.
    """
    archivo_catalogo: ArchivoDescargable = {
        "archivo": CATALOGO,
        "nivel": "oficial",
        "titulo": "INE, TIC-H: catálogo de resultados y microdatos",
        "url": RESULTADOS,
        "licencia": LICENCIA_INE,
    }
    migrado = estado.migrar_originales_planos(ORIGINAL)
    estado.retirar_sueltos_migrados(ORIGINAL, [] if migrado else _originales_validados(), ahora_utc())
    admitida = estado.leer(ESTADO_EDICION)
    # El índice es una sonda mutable: se guardan los bytes observados, no se usan como contrato del método.
    edicion, registrar = descubrir_edicion(
        archivo_catalogo,
        ORIGINAL,
        redireccion="TIC-H: el catálogo del INE redirige a una dirección inesperada",
        leer=_edicion_del_catalogo_utf8,
        comprobar=lambda leida: ediciones.comprobar_edicion(leida, admitida["anio"]),
        previo=lambda: descubrimiento_previo_unico(PROCEDENCIA, CATALOGO, "TIC-H"),
    )
    time.sleep(PAUSA_ENTRE_PETICIONES_S)
    carpeta = estado.carpeta(admitida, ORIGINAL)
    carpeta.mkdir(parents=True, exist_ok=True)
    registros, epa_anio, sondeo = epa_por_anio.originales_de_la_edicion(admitida, carpeta, aceptar_cambio)
    citada = {
        "fuente": nombre_fuente(admitida["anio"], admitida["tablas"]),
        "cita": cita(admitida["anio"], admitida["tablas"]),
        "licencia": LICENCIA_INE,
        "licencia_texto": LICENCIA_TEXTO_INE,
        "condiciones_microdatos": CONDICIONES_MICRODATOS,
    }
    catalogo = registrar()
    del_anio = {"anio": admitida["anio"], "epa_anio": epa_anio, **sondeo, **citada, "archivos": registros}
    guardar_json(carpeta / ARCHIVO_DE_PROCEDENCIA, del_anio)
    anterior = leer_json(PROCEDENCIA) if PROCEDENCIA.exists() else None
    observada = ediciones.observar(edicion, catalogo, anterior, ahora_utc(), admitida["anio"])
    tablas = tablas_de_la_edicion_nueva(observada.get("edicion_nueva"), RESULTADOS, (ORIGINAL / CATALOGO).read_bytes)
    con_su_epa = estado.valida({**admitida, "epa_anio": epa_anio})
    de_la_candidata = candidata.descargar(tablas, con_su_epa, registros, ORIGINAL)
    captura = ediciones.captura_de_la_observacion(observada, (ORIGINAL / CATALOGO).read_bytes, ORIGINAL)
    guardar_json(
        PROCEDENCIA,
        {
            **citada,
            "edicion": edicion,
            **observada,
            **captura,
            **tablas,
            **de_la_candidata,
            # Como siempre en TIC-H, el catálogo se registra al completar los originales.
            "descubrimiento": [catalogo],
            "pagina_microdatos": "https://www.ine.es/dyngs/INEbase/es/operacion.htm?c=Estadistica_C&cid="
            "1254736176741&menu=resultados&idp=1254735976608",
            "archivos": estado.en_la_operacion(admitida, registros),
        },
    )


def _preparar_edicion(
    edicion: Mapping[str, Any], documentos_de: Callable[[dict[str, Any]], dict[str, Any]]
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Las estimaciones de una edición y las cifras publicadas con que se contrastan.

    La admitida y la candidata se preparan con los mismos pasos; solo cambia de dónde sale lo que dicen sus
    documentos: la admitida no lee sus PDF (lo guardó su estado al admitirla, edicion.py), y la candidata los lee
    (candidata.py).

    Args:
        edicion: La edición: su año, sus tablas y el año de su EPA.
        documentos_de: Con el diseño de registro, sus secciones en muestra y su enunciado (`leer_documentos`).

    Returns:
        El preparado, con la edición completa, y las cifras publicadas.
    """
    filas, diseno = _cuestionario(edicion)
    filas = del_universo(filas)
    documentos = documentos_de(diseno)
    edicion = estado.con_lo_leido(edicion, documentos)
    estimaciones = calcular(filas, documentos["secciones_en_muestra"])
    secciones_de_cataluna = documentos["secciones_en_muestra"]["cataluna"]
    cataluna = grados_del_diseno((fila for fila in filas if fila["CCAA"] == CATALUNA), secciones_de_cataluna)
    print(f"{edicion['anio']}: {len(filas)} cuestionarios · {len(estimaciones['espana_isco2'])} grupos ISCO-08")
    preparado = {
        "edicion": edicion,
        **documentos,
        "variables": list(VARIABLES),
        "grupos_isco": diseno["codelists"]["T_OCUPA"],
        "clases_por_isco2": clases_por_isco2(filas),
        "estimaciones": estimaciones,
        "poblacion_isco2": poblacion_por_isco2(filas),
        "epa_isco2": _epa_por_isco2(edicion),
        "contraste_errores": contraste_por_comunidad(filas),
        # Cálculo de contraste para tic_llars, no una cifra que se publique (motivos_no_uso.py).
        "contraste_no_sabe_como": no_sabian_como(filas, cataluna, estimar, diseno),
    }
    return preparado, {"uso": _publicadas_uso(edicion), "errores": _publicadas_errores(edicion)}


def preparar() -> None:
    """Calcula la edición admitida y, si la hay, la candidata, con las cifras publicadas con que se contrastan."""
    estado.migrar_originales_planos(ORIGINAL)
    comprobar_originales(FUENTE)
    admitida = epa_por_anio.con_la_epa_descargada(estado.leer(ESTADO_EDICION), ORIGINAL)
    preparado, publicadas = _preparar_edicion(
        admitida, lambda diseno: de_la_admitida(diseno, admitida["secciones"], admitida["documentos"], admitida["anio"])
    )
    guardar_json(ESTIMACIONES, preparado)
    guardar_json(PUBLICADAS, publicadas)
    candidata.preparar(leer_json(PROCEDENCIA), _preparar_edicion, ORIGINAL, PREPARADA)


def _validacion(
    preparado: dict[str, Any],
    publicadas: dict[str, Any],
    registrados: dict[str, Any],
    del_dato: dict[str, Any],
    clasificaciones: dict[str, Any],
) -> tuple[Controles, dict[str, Any], dict[str, Any]]:
    """Los controles, el informe y el conjunto de una edición preparada.

    Args:
        preparado: Lo preparado de la edición.
        publicadas: Sus cifras publicadas.
        registrados: La procedencia con sus originales (`archivos`), cuyas huellas se comprueban.
        del_dato: Lo que el dato declara de sus ediciones (años medidos y edición nueva observada).
        clasificaciones: Las clasificaciones validadas.

    Returns:
        Los controles, el informe de validación y el conjunto.
    """
    edicion = estado.valida(preparado["edicion"])
    estimaciones = preparado["estimaciones"]
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, registrados)
    _controles_publicadas(controles, estimaciones, publicadas)
    _controles_grupos(controles, estimaciones, preparado["grupos_isco"], clasificaciones["isco08_es"])
    diferencias = preparado["enunciado"]["diferencias"]
    controles.comprobar(
        not diferencias,
        "IAG e IAG_TRAB conservan su enunciado y sus códigos en el diseño de registro"
        + (f"; cambia: {diferencias}" if diferencias else ""),
    )
    # Un grupo que la EPA del año disponible no confirma se da en su gran grupo (reparto_con_la_epa.py).
    poblacion, epa = preparado["poblacion_isco2"], preparado["epa_isco2"]
    bajados = grupos_a_su_gran_grupo(_de_paso(estimaciones["espana_isco2"]), razones_de_cuota(poblacion, epa))
    conjunto = {
        **_conjunto_validado(preparado, clasificaciones["isco08_a_cno11"], bajados, edicion=edicion),
        **del_dato,
    }
    control_de_las_clases(controles, preparado["clases_por_isco2"], conjunto)
    _controles_correspondencia(controles, conjunto, estimaciones)
    regla = _controles_regla(controles, estimaciones)
    contraste_ine = contraste_errores_ine(controles, preparado["contraste_errores"], publicadas["errores"])
    contraste_epa = _controles_epa(controles, preparado, conjunto)
    control_de_sus_grandes_grupos(controles, bajados, _con_cifra(estimaciones["espana_isco1"]), poblacion, epa)
    con_muestra = [grupo for grupo in estimaciones["espana_isco2"].values() if "pct" in grupo]
    presentables = _con_cifra(estimaciones["espana_isco2"])
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {
            "grupos_isco2_con_cifra": len(conjunto["espana_isco2"]),
            "grupos_isco2_sin_muestra": len(estimaciones["espana_isco2"]) - len(con_muestra),
            "grupos_isco2_fuera_por_la_regla_nchs": len(con_muestra) - len(presentables),
            "grupos_isco2_en_gran_grupo_o_bloque": len(presentables) - len(conjunto["espana_isco2"]),
            "bloques_con_cifra": len(conjunto["espana_bloques"]),
            "cataluna_grupos_con_cifra": len(conjunto["cataluna_grupos"]) + len(conjunto["cataluna_isco1"]),
        },
        "originales_validados": [entrada["archivo"] for entrada in registrados["archivos"]],
        "contraste_con_la_epa": contraste_epa,
        "regla_de_publicacion": regla,
        "contraste_con_los_errores_del_ine": contraste_ine,
        "contraste_no_sabe_como": preparado["contraste_no_sabe_como"],
        # El reparto en entrevistas de cada grupo con las dos clases en esta edición (clases_de_ocupacion.py).
        "grupos_con_las_dos_clases": con_las_dos_clases(preparado["clases_por_isco2"]),
        "secciones_en_muestra": preparado["secciones_en_muestra"],
        "enunciado": preparado["enunciado"],
        "limites": "Uso declarado por las personas ocupadas de 16 a 74 años del grupo, el universo de la encuesta y "
        "de sus tablas (basta una vez en tres meses), no adopción en las empresas ni cambio en el empleo."
        " El contraste con la EPA usa a los ocupados de 15 a 74 años de "
        f"Eurostat de {edicion['epa_anio']}, comparados como cuotas dentro de cada gran grupo; un grupo que no la "
        "cumple se da en su gran grupo (grupos_en_su_gran_grupo). Cálculo propio con microdatos, no "
        "una tabla del INE; el intervalo no "
        "recoge los conglomerados del diseño (ver el contraste con los errores del INE). "
        f"{ediciones.serie_medida(conjunto)}{frase_de_los_sin_clase(conjunto)} La ocupación la anota el "
        "entrevistador a 2 cifras de la ISCO-08, no se deduce de la CNO-11: el paso desde la CNO-11 da enteros los "
        "grandes grupos 1 y 4 y junta el 25 y el 35. Los propietarios de bares y comercios (CNO 5000 y 5300) "
        "reciben la cifra de su grupo de servicios, aunque la entrevista anota a menudo a los empresarios con "
        "asalariados como directores.",
        "controles": controles.lista,
    }
    return controles, informe, conjunto


def validar() -> None:
    """Contrasta la admitida y la candidata con las tablas del INE y guarda la validación, el conjunto y el estado.

    Si la candidata pasa todos sus controles, se publica la suya y el estado y la procedencia de la operación pasan a
    ella; si está detenida, se publica la admitida y el informe de validación dice por qué (candidata.py). Si la
    admitida no pasa sus controles y la candidata sí, se incorpora la candidata y su informe lo dice
    (`admitida_con_errores`, con el año de la admitida y sus controles fallidos).

    El orden de escritura al incorporar es el conjunto y la validación, luego el estado de la edición y por último la
    procedencia de la operación. Si el proceso se corta entre la validación y el estado, el dato publicado es el de la
    edición nueva y el estado sigue en la anterior: el panel avisa («edicion-no-coincide») y la exportación se detiene
    por el cruce de años, y la siguiente ejecución, con la candidata aún registrada, repite la incorporación entera.
    """
    clasificaciones = leer_validado("clasificaciones")
    preparado, procedencia = leer_json(ESTIMACIONES), leer_json(PROCEDENCIA)
    edicion = estado.valida(preparado["edicion"])
    exigir(
        {**edicion, "epa_anio": ""} == {**estado.leer(ESTADO_EDICION), "epa_anio": ""},
        "TIC-H: lo preparado es de otra edición que la admitida; repetir preparar",
    )
    del_dato = ediciones.ediciones_del_dato(procedencia, edicion["anio"], edicion["anios_medidos"])
    controles, informe, conjunto = _validacion(preparado, leer_json(PUBLICADAS), procedencia, del_dato, clasificaciones)
    informe = {**informe, **ediciones.aviso_de_descarte(procedencia)}
    resultado = candidata.validar(
        procedencia,
        lambda *preparada: _validacion(*preparada, clasificaciones=clasificaciones),
        PREPARADA,
        admitida=conjunto,
    )
    if resultado is not None and "conjunto" in resultado:
        nueva = resultado["edicion"]
        sin_admitir = {"admitida_con_errores": {"anio": edicion["anio"], "controles": controles.fallidos}}
        informe_nuevo = {**resultado["informe"], **({} if controles.admitido else sin_admitir)}
        cerrar_validacion(FUENTE, informe_nuevo, resultado["controles"], lambda: resultado["conjunto"])
        # El estado y la procedencia pasan a la edición nueva solo con su conjunto admitido y guardado.
        estado.guardar(nueva, ESTADO_EDICION)
        guardar_json(PROCEDENCIA, candidata.operacion_con_la_incorporada(procedencia, nueva))
        return
    if resultado is not None:
        informe = {**informe, "candidata_detenida": candidata.en_el_informe(procedencia, resultado)}
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto)
    # Solo con el conjunto admitido: si un control falla, cerrar_validacion se detiene antes y el estado no cambia.
    estado.guardar(edicion, ESTADO_EDICION)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta las etapas de la TIC-H del INE desde la línea de órdenes: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos; None toma los de la línea de órdenes.

    Returns:
        El código de salida del proceso.
    """
    return principal_fuente_con_descarga(
        __doc__,
        descargar=descargar,
        preparacion_y_validacion={"preparar": preparar, "validar": validar},
        argumentos=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
