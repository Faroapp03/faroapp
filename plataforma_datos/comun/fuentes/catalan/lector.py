"""Traducción de Faro al catalán de los datos oficiales: origen, procedencia, validación sin IA y combinación.

No es una fuente oficial: ESCO y las tareas de la OIT no tienen versión catalana, y esta es una traducción de Faro hecha
con IA, con el aviso de traducción de la OIT. Los nombres de los grupos sí la tienen: el paquete lleva los oficiales
del Idescat (comun/fuentes/idescat/lector.py), literales, y no su traducción, que se conserva solo como texto de
contraste.
Sigue la cadena de las demás fuentes, en var/actualizacion/preparados/catalan/:

  origen/<tipo>-<parte>.json         lo que hay que traducir, en castellano: lo escribe `descargar` a partir del
                                     castellano validado, en partes que no se solapan (una `muestra` y el resto)
  traducciones/<tipo>-<parte>.json   la traducción de una parte, con su procedencia (modelo, fecha, estado y marca):
                                     la escribe una persona o un modelo, fuera de esta cadena y sin la API de Faro
  procedencia.json                   huella y claves de cada archivo, y el aviso de traducción de la OIT (`preparar`)

Tipos y claves: `tareas` («<id>.corto», «<id>.texto» y, si existen, «<id>.ia_podria» y «<id>.lo_tuyo»), `grupos`
(código ISCO-08 de 1 a 4 cifras) y `ocupaciones` (código ESCO). `validar` comprueba cada traducción sin IA y escribe
var/actualizacion/validados/catalan/validacion.json; lo que no está traducido, o cuyo castellano ya no es el vigente,
no es un error: no se exporta y el motor lo muestra en castellano. Depende de las validaciones de la OIT, de
las clasificaciones, de ESCO y de los textos. Python estándar.

Uso: python3 -m plataforma_datos.comun.fuentes.catalan.lector {descargar,preparar,validar,todo}
"""

import json
import math
import re
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    guardar_json,
    guardar_validacion,
    leer_json,
    relativa,
    sha256,
    sha256_bytes,
)
from plataforma_datos.comun.fuentes.catalan.piezas.comprobaciones_catalan import (
    COMPROBACIONES,
    problemas_de_claves,
    problemas_de_forma,
    problemas_de_iguales,
    problemas_de_procedencia,
    problemas_por_comprobacion,
)
from plataforma_datos.comun.fuentes.catalan.piezas.constantes_catalan import (
    CAMPOS_TAREA,
    CONTROL_CLAVES,
    CONTROL_IGUALES,
    CONTROL_ORIGEN,
    CONTROL_PROCEDENCIA,
    ESTADO,
    ESTADO_ADMITIDO,
    FUENTE,
    MARCA,
    MAX_CLAVES_POR_PARTE,
    MAX_EJEMPLOS,
    MUESTRA,
    ORIGEN,
    PARTE_MUESTRA,
    PREPARADO,
    PROCEDENCIA,
    TIPOS,
    TRADUCCIONES,
    VALIDADO,
)
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_VALIDACION,
    CON_ERRORES,
    Controles,
    ErrorFuente,
    FormatoInesperado,
    ValidacionFallida,
    exigir,
)
from plataforma_datos.ocupaciones.fuentes.esco.piezas.consultas import base_validada
from plataforma_datos.ocupaciones.fuentes.textos.lector import CAMPOS_REDACCION, aviso_traduccion
from plataforma_datos.ocupaciones.fuentes.textos.lector import archivos_validados as textos_validados
from plataforma_datos.ocupaciones.fuentes.textos.lector import combinar as combinar_textos
from plataforma_datos.orquestacion.admision import exigir_admitido, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente

# Orden que rehace una etapa de esta fuente; los mensajes de error la citan entera.
ORDEN_DE_LA_FUENTE = "python -m plataforma_datos.comun.fuentes.catalan.lector"


def _tareas_en_castellano() -> dict[str, str]:
    """Reúne los textos validados de las tareas oficiales, una clave por campo («4226-1.corto»).

    El campo «texto_es» pasa a llamarse «texto».

    Returns:
        El texto en castellano de cada clave.
    """
    archivos = textos_validados()
    claves = {}
    for identificador, tarea in combinar_textos(archivos=archivos)["tareas"].items():
        campos = {"corto": tarea["corto"], "texto": tarea["texto_es"]}
        if all(tarea.get(campo) for campo in CAMPOS_REDACCION):
            campos.update({campo: tarea[campo] for campo in CAMPOS_REDACCION})
        claves.update({f"{identificador}.{campo}": texto for campo, texto in campos.items()})
    return claves


def _grupos_en_castellano() -> dict[str, str]:
    """Reúne los títulos validados de la CIUO-08 en castellano, de 1 a 4 cifras.

    Returns:
        El título de cada grupo, por su código.
    """
    return dict(leer_validado("clasificaciones")["isco08_es"])


def _ocupaciones_en_castellano() -> dict[str, str]:
    """Reúne los títulos de las ocupaciones de la base ESCO validada, abierta solo para leer (como el exportador).

    Returns:
        El título de cada ocupación, por su código ESCO.
    """
    with base_validada() as base:
        return dict(base.execute("SELECT codigo_esco,titulo_es FROM ocupaciones"))


def castellano_vigente() -> dict[str, dict[str, str]]:
    """Reúne, por tipo, cada clave con su texto en castellano validado: lo que se traduce y contra lo que se contrasta.

    Returns:
        Por tipo (tareas, grupos, ocupaciones), el texto de cada clave.
    """
    return {
        "tareas": _tareas_en_castellano(),
        "grupos": _grupos_en_castellano(),
        "ocupaciones": _ocupaciones_en_castellano(),
    }


# ---------------------------------------------------------------------------------------------------------------------
# Claves y partes
# ---------------------------------------------------------------------------------------------------------------------


def unidad(tipo: str, clave: str) -> str:
    """Halla el elemento al que pertenece una clave.

    Args:
        tipo: El tipo de claves (TIPOS).
        clave: La clave.

    Returns:
        La tarea en `tareas` («4226-1.corto» → «4226-1»); en los demás tipos, la propia clave.
    """
    return clave.rsplit(".", 1)[0] if tipo == "tareas" else clave


def orden(tipo: str, clave: str) -> tuple[tuple[int, ...], int]:
    """Calcula el orden natural de una clave: los grupos por su jerarquía (1, 11, 111…), los demás por sus números.

    Args:
        tipo: El tipo de claves (TIPOS).
        clave: La clave.

    Returns:
        Los números del elemento y, en tareas, la posición del campo en CAMPOS_TAREA (0 en los demás tipos).
    """
    elemento = unidad(tipo, clave)
    numeros = (
        tuple(int(cifra) for cifra in elemento) if tipo == "grupos" else tuple(map(int, re.split(r"[.-]", elemento)))
    )
    campo = CAMPOS_TAREA.index(clave.rsplit(".", 1)[1]) if tipo == "tareas" else 0
    return numeros, campo


def ordenadas(tipo: str, claves: Iterable[str]) -> list[str]:
    """Ordena unas claves en su orden natural.

    Args:
        tipo: El tipo de claves (TIPOS).
        claves: Las claves.

    Returns:
        Las claves ordenadas.
    """
    return sorted(claves, key=lambda clave: orden(tipo, clave))


def _unidades(tipo: str, claves: Iterable[str]) -> list[list[str]]:
    """Agrupa las claves por elemento, en orden: los campos de una tarea van siempre juntos.

    Args:
        tipo: El tipo de claves (TIPOS).
        claves: Las claves.

    Returns:
        Las claves de cada elemento, en orden natural.
    """
    grupos: dict[str, list[str]] = {}
    for clave in ordenadas(tipo, claves):
        grupos.setdefault(unidad(tipo, clave), []).append(clave)
    return list(grupos.values())


def _repartir_en(unidades: list[list[str]], partes: int) -> list[list[str]]:
    """Reparte los elementos en `partes` partes consecutivas y equilibradas por número de claves.

    Args:
        unidades: Las claves de cada elemento, en orden.
        partes: Cuántas partes (al menos una).

    Returns:
        Las partes no vacías, con las claves de sus elementos.
    """
    total = sum(len(elemento) for elemento in unidades)
    reparto: list[list[str]] = [[] for _ in range(partes)]
    acumuladas = 0
    for elemento in unidades:
        reparto[min(partes - 1, acumuladas * partes // total)].extend(elemento)
        acumuladas += len(elemento)
    return [parte for parte in reparto if parte]


def repartir(tipo: str, claves: Iterable[str]) -> list[list[str]]:
    """Reparte las claves en el menor número de partes equilibradas de como mucho MAX_CLAVES_POR_PARTE.

    Las tareas no se parten: sus campos van siempre en la misma parte.

    Args:
        tipo: El tipo de claves (TIPOS).
        claves: Las claves que se reparten.

    Returns:
        Las partes, cada una con sus claves en orden natural; vacía si no hay claves.

    Raises:
        ErrorFuente: Si un elemento tiene más claves que MAX_CLAVES_POR_PARTE (no cabría en ninguna parte).
    """
    unidades = _unidades(tipo, claves)
    total = sum(len(elemento) for elemento in unidades)
    if not total:
        return []
    # Como mucho, una parte por clave: entonces cada elemento va solo en la suya, y cabe si ningún elemento (los
    # campos de una tarea) pasa de MAX_CLAVES_POR_PARTE.
    for partes in range(math.ceil(total / MAX_CLAVES_POR_PARTE), total + 1):
        reparto = _repartir_en(unidades, partes)
        if all(len(parte) <= MAX_CLAVES_POR_PARTE for parte in reparto):
            return reparto
    raise ErrorFuente(
        f"catalan: un elemento de {tipo} tiene más de {MAX_CLAVES_POR_PARTE} claves y no cabe en una parte"
    )


def claves_de_la_muestra(tipo: str, castellano: dict[str, str]) -> list[str]:
    """Elige las claves de la muestra de un tipo que existen en el castellano vigente (en tareas, todos sus campos).

    Args:
        tipo: El tipo de claves (TIPOS).
        castellano: El castellano vigente de ese tipo, por clave.

    Returns:
        Las claves de los elementos de MUESTRA, en orden natural.
    """
    elegidos = set(MUESTRA[tipo])
    return ordenadas(tipo, [clave for clave in castellano if unidad(tipo, clave) in elegidos])


def plan_de_partes(tipo: str, castellano: dict[str, str], muestra: list[str] | None = None) -> dict[str, list[str]]:
    """Reparte las claves de un tipo: la muestra y el resto, numerado desde «01».

    Una clave de la muestra ya escrita que el castellano vigente no tiene se deja fuera: un castellano que cambia no
    es un error.

    Args:
        tipo: El tipo de claves (TIPOS).
        castellano: El castellano vigente de ese tipo, por clave.
        muestra: Las claves de la muestra ya escrita; None, la de MUESTRA.

    Returns:
        Las claves de cada parte, por nombre de parte, solo las del castellano vigente.
    """
    if muestra is None:
        en_la_muestra = claves_de_la_muestra(tipo, castellano)
    else:
        en_la_muestra = [clave for clave in muestra if clave in castellano]
    apartadas = set(en_la_muestra)
    resto = [clave for clave in castellano if clave not in apartadas]
    plan = {PARTE_MUESTRA: ordenadas(tipo, en_la_muestra)}
    plan.update({f"{numero:02d}": parte for numero, parte in enumerate(repartir(tipo, resto), start=1)})
    return plan


# ---------------------------------------------------------------------------------------------------------------------
# Archivos
# ---------------------------------------------------------------------------------------------------------------------


def nombre_de_parte(tipo: str, parte: str) -> str:
    """Nombra el archivo de una parte, el mismo para su origen y para su traducción.

    Args:
        tipo: El tipo de claves (TIPOS).
        parte: La parte («muestra», «01»…).

    Returns:
        «<tipo>-<parte>.json».
    """
    return f"{tipo}-{parte}.json"


# Los bytes de cada archivo de origen y de traducción, leídos una sola vez: la huella, los controles y la combinación
# salen del mismo contenido, aunque un archivo cambie mientras tanto.
Archivos = dict[Path, bytes]


def rutas() -> list[Path]:
    """Lista todos los archivos de origen y de traducción: los orígenes del paquete del motor.

    Returns:
        Las rutas, primero los orígenes y después las traducciones, cada carpeta en orden de nombre.
    """
    return [ruta for carpeta in (ORIGEN, TRADUCCIONES) if carpeta.exists() for ruta in sorted(carpeta.glob("*.json"))]


def leer_archivos() -> Archivos:
    """Lee una vez los bytes de cada archivo de origen y de traducción.

    Returns:
        Los bytes de cada ruta de `rutas()`, en su orden.
    """
    return {ruta: ruta.read_bytes() for ruta in rutas()}


def _cargar(ruta: Path, datos: bytes) -> dict[str, Any]:
    """Interpreta los bytes ya leídos de un archivo JSON.

    Args:
        ruta: El archivo, para el motivo del error.
        datos: Sus bytes.

    Returns:
        Su contenido.

    Raises:
        FormatoInesperado: Si no es JSON válido en UTF-8.
    """
    try:
        return json.loads(datos.decode("utf-8"))
    except ValueError as error:
        raise FormatoInesperado(f"{relativa(ruta)} no es JSON válido: {error}") from error


def _de_la_carpeta(carpeta: Path, archivos: Archivos | None) -> dict[str, dict[str, Any]]:
    """Interpreta los archivos JSON de una carpeta, por nombre.

    Args:
        carpeta: ORIGEN o TRADUCCIONES.
        archivos: Los bytes ya leídos; None los lee ahora.

    Returns:
        El contenido de cada archivo de la carpeta, por nombre; ninguno si la carpeta no existe.
    """
    leidos = leer_archivos() if archivos is None else archivos
    return {ruta.name: _cargar(ruta, datos) for ruta, datos in leidos.items() if ruta.parent == carpeta}


def origenes(archivos: Archivos | None = None) -> dict[str, dict[str, Any]]:
    """Interpreta los archivos de origen.

    Args:
        archivos: Los bytes ya leídos; None los lee ahora.

    Returns:
        Cada archivo de origen, por nombre.

    Raises:
        FormatoInesperado: Si un origen no es un objeto con textos de tipo cadena.
    """
    contenidos = _de_la_carpeta(ORIGEN, archivos)
    for nombre, contenido in contenidos.items():
        problemas = problemas_de_forma(contenido)
        exigir(not problemas, f"{relativa(ORIGEN / nombre)}: {'; '.join(problemas)}")
    return contenidos


def traducciones(archivos: Archivos | None = None) -> dict[str, dict[str, Any]]:
    """Interpreta los archivos de traducción.

    Args:
        archivos: Los bytes ya leídos; None los lee ahora.

    Returns:
        Cada archivo de traducción, por nombre (el mismo que su origen).
    """
    return _de_la_carpeta(TRADUCCIONES, archivos)


def huellas(archivos: Archivos | None = None) -> dict[str, str]:
    """Calcula la huella por su ruta dentro del preparado catalán («origen/tareas-01.json»).

    Args:
        archivos: Los bytes ya leídos; None calcula la huella de cada archivo leyéndolo ahora.

    Returns:
        El SHA-256 de cada archivo.
    """
    if archivos is None:
        return {ruta.relative_to(PREPARADO).as_posix(): sha256(ruta) for ruta in rutas()}
    return {ruta.relative_to(PREPARADO).as_posix(): sha256_bytes(datos) for ruta, datos in archivos.items()}


def archivos_validados() -> Archivos:
    """Lee una vez los archivos de origen y traducción y comprueba que son los validados.

    La combinación que se exporta sale de estos mismos bytes: lo exportado es lo que se comprobó.

    Returns:
        Los bytes de cada archivo.

    Raises:
        ValidacionFallida: Si la fuente no está admitida o algún archivo no es el que se validó.
    """
    validacion = exigir_admitido(FUENTE)
    archivos = leer_archivos()
    exigir(
        validacion.get("sha256") == huellas(archivos),
        f"catalan: los archivos no son los validados; ejecutar {ORDEN_DE_LA_FUENTE} todo",
        ValidacionFallida,
    )
    return archivos


def _escribir_origen(tipo: str, parte: str, textos: dict[str, str]) -> None:
    """Escribe una parte de origen si no existe; si existe, no la reescribe y lo dice."""
    ruta = ORIGEN / nombre_de_parte(tipo, parte)
    if ruta.exists():
        print(f"{relativa(ruta)}: ya existe, no se reescribe")
        return
    guardar_json(ruta, {"tipo": tipo, "parte": parte, "claves": len(textos), "textos": textos})
    print(f"{relativa(ruta)}: {len(textos)} claves")


# ---------------------------------------------------------------------------------------------------------------------
# Comprobaciones de los archivos (las de cada texto y cada traducción, en comprobaciones_catalan.py)
# ---------------------------------------------------------------------------------------------------------------------


def _problemas_de_origenes(archivos: dict[str, dict[str, Any]]) -> list[str]:
    """Revisa los archivos de origen: tipo y parte acordes con su nombre, recuento cierto y sin claves en dos partes.

    Args:
        archivos: El contenido de cada archivo de origen, por nombre.

    Returns:
        Un problema por archivo, «<archivo>: <motivo>».
    """
    problemas, vistas = [], {tipo: set() for tipo in TIPOS}
    for nombre, origen in archivos.items():
        tipo, textos = origen.get("tipo"), origen.get("textos", {})
        if tipo not in TIPOS or nombre != nombre_de_parte(str(tipo), str(origen.get("parte"))):
            problemas.append(f"{nombre}: tipo o parte que no cuadran con su nombre")
            continue
        if origen.get("claves") != len(textos):
            problemas.append(f"{nombre}: «claves» no es el número de textos")
        repetidas = vistas[tipo].intersection(textos)
        if repetidas:
            problemas.append(f"{nombre}: claves en otra parte ({', '.join(sorted(repetidas)[:MAX_EJEMPLOS])})")
        vistas[tipo].update(textos)
    return problemas


def _con_ejemplos(descripcion: str, problemas: list[str]) -> str:
    """Redacta un control: su descripción y, si falla, cuántos problemas hay y los primeros.

    Args:
        descripcion: La descripción del control.
        problemas: Sus problemas.

    Returns:
        La descripción, con los MAX_EJEMPLOS primeros problemas si los hay.
    """
    if not problemas:
        return descripcion
    return f"{descripcion}: {len(problemas)} problemas ({'; '.join(problemas[:MAX_EJEMPLOS])})"


def _problemas_de_traducciones(
    origenes_por_nombre: dict[str, Any], traducciones_por_nombre: dict[str, Any]
) -> dict[str, list[str]]:
    """Reúne, por control de las traducciones, sus problemas como «archivo: detalle».

    Args:
        origenes_por_nombre: El contenido de cada archivo de origen, por nombre.
        traducciones_por_nombre: El contenido de cada archivo de traducción, por nombre.

    Returns:
        Los problemas de cada control (vacío si se cumple).
    """
    por_control: dict[str, list[str]] = {
        CONTROL_ORIGEN: [],
        CONTROL_CLAVES: [],
        CONTROL_PROCEDENCIA: [],
        CONTROL_IGUALES: [],
        **{descripcion: [] for descripcion, _ in COMPROBACIONES},
    }
    for nombre, traduccion in traducciones_por_nombre.items():
        origen = origenes_por_nombre.get(nombre)
        if origen is None:
            por_control[CONTROL_ORIGEN].append(nombre)
            continue
        forma = problemas_de_forma(traduccion)
        if forma:
            # Sin su forma, ninguna clave se puede comparar con su origen: cuenta como claves que faltan.
            por_control[CONTROL_CLAVES] += [f"{nombre}: {problema}" for problema in forma]
            continue
        por_control[CONTROL_CLAVES] += [f"{nombre}: {problema}" for problema in problemas_de_claves(traduccion, origen)]
        por_control[CONTROL_PROCEDENCIA] += [
            f"{nombre}: {problema}" for problema in problemas_de_procedencia(traduccion)
        ]
        por_control[CONTROL_IGUALES] += [
            f"{nombre}: {problema}" for problema in problemas_de_iguales(traduccion, origen)
        ]
        for descripcion, claves in problemas_por_comprobacion(traduccion, origen).items():
            por_control[descripcion] += [f"{nombre}: {clave}" for clave in claves]
    return por_control


def _huellas_registradas(procedencia: dict[str, Any]) -> dict[str, str]:
    """Lee la huella de cada archivo según la procedencia, por su ruta dentro de var/actualizacion/preparados/catalan.

    Args:
        procedencia: La procedencia registrada por preparar.

    Returns:
        El SHA-256 registrado de cada archivo.
    """
    entradas = [*procedencia.get("origen", []), *procedencia.get("traducciones", [])]
    return {entrada["archivo"]: entrada["sha256"] for entrada in entradas}


def controles(procedencia: dict[str, Any], archivos: Archivos | None = None) -> Controles:
    """Aplica los controles que bloquean la exportación: huellas, orígenes y cada comprobación de las traducciones.

    Args:
        procedencia: La procedencia registrada por preparar.
        archivos: Los bytes ya leídos; None los lee ahora.

    Returns:
        Los controles, cumplidos o no.
    """
    leidos = leer_archivos() if archivos is None else archivos
    aplicados = Controles()
    aplicados.comprobar(huellas(leidos) == _huellas_registradas(procedencia), f"huella de los {len(leidos)} archivos")
    todos = origenes(leidos)
    aplicados.comprobar(*_resultado("orígenes coherentes y sin claves en dos partes", _problemas_de_origenes(todos)))
    for descripcion, problemas in _problemas_de_traducciones(todos, traducciones(leidos)).items():
        aplicados.comprobar(*_resultado(f"traducciones: {descripcion}", problemas))
    return aplicados


def _resultado(descripcion: str, problemas: list[str]) -> tuple[bool, str]:
    """Prepara lo que se pasa a Controles.comprobar.

    Args:
        descripcion: La descripción del control.
        problemas: Sus problemas.

    Returns:
        Si no hay problemas, y la descripción con sus ejemplos.
    """
    return not problemas, _con_ejemplos(descripcion, problemas)


# ---------------------------------------------------------------------------------------------------------------------
# Lo vigente: cobertura, desactualizadas y combinación
# ---------------------------------------------------------------------------------------------------------------------


def _traducidas(castellano: dict[str, dict[str, str]], archivos: Archivos) -> dict[str, dict[str, dict[str, str]]]:
    """Separa por tipo las claves traducidas: `vigentes` (su castellano no ha cambiado) y `desactualizadas`.

    Args:
        castellano: El castellano vigente, por tipo y clave.
        archivos: Los bytes ya leídos de los orígenes y las traducciones.

    Returns:
        Por tipo, cada clave traducida con su texto, en «vigentes» o «desactualizadas».
    """
    resultado = {tipo: {"vigentes": {}, "desactualizadas": {}} for tipo in TIPOS}
    todos = origenes(archivos)
    for nombre, traduccion in traducciones(archivos).items():
        origen = todos.get(nombre)
        if origen is None or origen.get("tipo") not in TIPOS:
            continue
        if problemas_de_forma(traduccion):
            continue  # el control de claves ya la rechaza; aquí no se lee
        tipo, originales = origen["tipo"], origen.get("textos", {})
        for clave, texto in traduccion.get("textos", {}).items():
            vigente = clave in originales and castellano[tipo].get(clave) == originales[clave]
            resultado[tipo]["vigentes" if vigente else "desactualizadas"][clave] = texto
    return resultado


def cobertura(castellano: dict[str, dict[str, str]], archivos: Archivos | None = None) -> dict[str, Any]:
    """Resume por tipo, a título informativo, cuánto está traducido.

    Args:
        castellano: El castellano vigente, por tipo y clave.
        archivos: Los bytes ya leídos; None los lee ahora.

    Returns:
        Por tipo: claves, traducidas y vigentes, desactualizadas, partes, partes sin traducir y claves sin parte.
    """
    leidos = leer_archivos() if archivos is None else archivos
    traducidas, todos, hechas = _traducidas(castellano, leidos), origenes(leidos), set(traducciones(leidos))
    resumen = {}
    for tipo in TIPOS:
        partes = sorted(nombre for nombre, origen in todos.items() if origen.get("tipo") == tipo)
        en_partes = {clave for nombre in partes for clave in todos[nombre].get("textos", {})}
        resumen[tipo] = {
            "claves": len(castellano[tipo]),
            "traducidas": len(traducidas[tipo]["vigentes"]),
            "desactualizadas": sorted(traducidas[tipo]["desactualizadas"], key=lambda clave: orden(tipo, clave)),
            "partes": partes,
            "partes_sin_traducir": [nombre for nombre in partes if nombre not in hechas],
            "claves_sin_parte": len(set(castellano[tipo]) - en_partes),
        }
    return resumen


def _agrupar_por_tarea(vigentes: dict[str, str]) -> dict[str, dict[str, str]]:
    """Agrupa las claves de tareas como `{id: {campo: texto}}`, con los campos en su orden.

    Args:
        vigentes: Las traducciones vigentes de las tareas, por clave.

    Returns:
        Por tarea, el texto de cada campo.
    """
    tareas: dict[str, dict[str, str]] = {}
    for clave in ordenadas("tareas", vigentes):
        identificador, campo = clave.rsplit(".", 1)
        tareas.setdefault(identificador, {})[campo] = vigentes[clave]
    return tareas


def nombres_oficiales(idescat: dict[str, Any] | None = None) -> dict[str, Any]:
    """Toma los nombres de grupo oficiales del Idescat (comun/fuentes/idescat/lector.py), literales.

    La CIUO-2008 (ca) sustituye a la traducción de los grupos ISCO-08, y la CCO-2011 (ca) da el nombre de los grupos
    CNO-11 que tienen uno solo.

    Args:
        idescat: Lo validado del Idescat; None lo lee.

    Returns:
        Los grupos ISCO-08, los grupos CNO-11 y la cita, licencia y fecha de consulta de los nombres.
    """
    oficiales = idescat if idescat is not None else leer_validado("idescat")
    return {
        "grupos": oficiales["isco08_ca"],
        "grupos_cno11": oficiales["cno11_ca"],
        "fuente_grupos": {clave: oficiales[clave] for clave in ("cita", "licencia", "consultado")},
    }


def combinar(
    castellano: dict[str, dict[str, str]] | None = None,
    aviso: str | None = None,
    idescat: dict[str, Any] | None = None,
    archivos: Archivos | None = None,
) -> dict[str, Any]:
    """Compone lo que se exporta al motor, con la forma de `DatosCatalan`.

    Las traducciones vigentes de las tareas y de las ocupaciones ESCO, y los nombres oficiales de los grupos (nunca su
    traducción con IA).

    Args:
        castellano: El castellano vigente; None lo lee de lo validado.
        aviso: El aviso de traducción de la OIT; None, el vigente.
        idescat: Lo validado del Idescat; None lo lee.
        archivos: Los bytes de los orígenes y las traducciones (los de `archivos_validados()`); None los lee ahora.

    Returns:
        Idioma, marca, estado, aviso, tareas, grupos, ocupaciones, grupos CNO-11 y fuente de los grupos.
    """
    vigente = castellano if castellano is not None else castellano_vigente()
    traducidas = _traducidas(vigente, leer_archivos() if archivos is None else archivos)
    ocupaciones = traducidas["ocupaciones"]["vigentes"]
    oficiales = nombres_oficiales(idescat)
    return {
        "idioma": "ca",
        "marca": MARCA,
        "estado": ESTADO,
        "aviso_traduccion": aviso if aviso is not None else aviso_traduccion(),
        "tareas": _agrupar_por_tarea(traducidas["tareas"]["vigentes"]),
        "grupos": {clave: oficiales["grupos"][clave] for clave in ordenadas("grupos", oficiales["grupos"])},
        "ocupaciones": {clave: ocupaciones[clave] for clave in ordenadas("ocupaciones", ocupaciones)},
        "grupos_cno11": oficiales["grupos_cno11"],
        "fuente_grupos": oficiales["fuente_grupos"],
    }


# ---------------------------------------------------------------------------------------------------------------------
# Etapas
# ---------------------------------------------------------------------------------------------------------------------


def descargar() -> None:
    """Escribe las partes de origen que falten, en castellano validado; las que ya existen no se reescriben."""
    castellano = castellano_vigente()
    for tipo in TIPOS:
        muestra = origenes().get(nombre_de_parte(tipo, PARTE_MUESTRA))
        claves_muestra = list(muestra["textos"]) if muestra else None
        for parte, claves in plan_de_partes(tipo, castellano[tipo], claves_muestra).items():
            _escribir_origen(tipo, parte, {clave: castellano[tipo][clave] for clave in claves})
    print(f"Las traducciones de cada parte van en {relativa(TRADUCCIONES)}, con el mismo nombre que su origen.")


def _registro(ruta: Path, contenido: dict[str, Any]) -> dict[str, Any]:
    """Registra un archivo en la procedencia: su ruta, su huella y cuántas claves tiene.

    Args:
        ruta: El archivo.
        contenido: Su contenido.

    Returns:
        La entrada de la procedencia.

    Raises:
        FormatoInesperado: Si el archivo no es un objeto con textos de tipo cadena.
    """
    problemas = problemas_de_forma(contenido)
    exigir(not problemas, f"{relativa(ruta)}: {'; '.join(problemas)}")
    return {
        "archivo": ruta.relative_to(PREPARADO).as_posix(),
        "sha256": sha256(ruta),
        "claves": len(contenido["textos"]),
    }


def preparar() -> None:
    """Registra la procedencia de cada archivo de origen y de traducción, y el aviso de traducción de la OIT."""
    exigir(
        ORIGEN.exists(),
        f"catalan: falta {relativa(ORIGEN)}; ejecutar {ORDEN_DE_LA_FUENTE} descargar",
        ValidacionFallida,
    )
    procedencia = {
        "fuente": "Faro · traducción al catalán de los datos oficiales",
        "nivel": MARCA,
        "aviso_traduccion": aviso_traduccion(),
        "origen": [
            {**_registro(ORIGEN / nombre, origen), "tipo": origen.get("tipo"), "parte": origen.get("parte")}
            for nombre, origen in origenes().items()
        ],
        "traducciones": [
            {**_registro(TRADUCCIONES / nombre, traduccion), "procedencia": traduccion.get("procedencia")}
            for nombre, traduccion in traducciones().items()
        ],
    }
    guardar_json(PROCEDENCIA, procedencia)
    print(f"{len(procedencia['origen'])} archivos de origen y {len(procedencia['traducciones'])} de traducción")


def validar() -> None:
    """Comprueba las traducciones sin IA frente a su origen y al castellano vigente, y guarda la validación."""
    procedencia = leer_json(PROCEDENCIA)
    castellano = castellano_vigente()
    archivos = leer_archivos()  # una sola lectura: lo que se comprueba es lo que queda registrado por su huella
    controles_de_validacion = controles(procedencia, archivos)
    resumen = cobertura(castellano, archivos)
    guardar_validacion(
        VALIDADO / ARCHIVO_DE_VALIDACION,
        {
            "estado": ESTADO_ADMITIDO if controles_de_validacion.admitido else CON_ERRORES,
            "comprobado_utc": ahora_utc(),
            "cobertura": resumen,
            "sha256": huellas(archivos),
            "limites": "Traducido con IA. Los controles miden la forma, no la fidelidad. "
            "Lo no traducido y lo desactualizado no se exportan: el motor lo muestra en castellano. "
            "Los grupos no se exportan traducidos: el paquete lleva sus nombres oficiales del Idescat.",
            "controles": controles_de_validacion.lista,
        },
    )
    controles_de_validacion.imprimir()
    for tipo, datos in resumen.items():
        sin_traducir = len(datos["partes_sin_traducir"])
        print(
            f"{tipo}: {datos['traducidas']} de {datos['claves']} claves traducidas; {sin_traducir} partes sin traducir"
        )
    controles_de_validacion.exigir(FUENTE)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la interfaz de línea de órdenes de la fuente con su ejecutor común.

    Args:
        argv: Los argumentos (sin el nombre del programa); None lee los del proceso.

    Returns:
        El código de salida de la orden.
    """
    etapas = {"descargar": descargar, "preparar": preparar, "validar": validar}
    return principal_fuente(__doc__, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
