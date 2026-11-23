"""Vincula el descubrimiento de la ETICCE y sus seis tablas con los originales admitidos."""

import json
from pathlib import Path

import plataforma_datos.mercado.fuentes.empresas.lector as empresas
import plataforma_datos.mercado.fuentes.empresas.piezas.contrato_eticce as contrato_eticce
from plataforma_datos.comun.estadisticas import API_TEMPUS
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.comun.observacion_remota import VERSION_VINCULADA, identidad_recurso
from plataforma_datos.mercado.fuentes.empresas.piezas import calendario_ine, plantilla_tic
from plataforma_datos.orquestacion.cobertura_originales import (
    carpeta_originales,
    leer_procedencia,
    original_vinculado,
    por_nombre,
)

MAX_PROCEDENCIA_BYTES = 1 << 20
INDICE = "ine-eticce-resultados.html"


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ValueError("Cobertura de empresas no verificable.")


def _vinculado(carpeta: Path, esperado: dict, registros: dict, peticiones: dict) -> bytes:
    url = esperado["url"]
    registro = registros[esperado["archivo"]]
    peticion = peticiones[identidad_recurso(url)]
    finales = {url}
    if url.startswith(API_TEMPUS + "/"):
        # Tempus sirve las mismas tablas desde su caché, sin permitir otro host, tabla o filtro.
        finales.add(url.replace("/js/", "/jsCache/", 1))
    return original_vinculado(carpeta, esperado, registro, peticion, urls_finales=finales)


def _descubrir(carpeta: Path, registros: dict, peticiones: dict) -> dict:
    _exigir(set(registros) == {INDICE, *(f"ine-eticce-capitulo-{parte}.html" for parte in empresas.CAPITULOS)})
    indice = _vinculado(
        carpeta, empresas.archivo_de_descubrimiento("resultados", empresas.RESULTADOS), registros, peticiones
    )
    anio, direcciones = empresas.capitulos(indice.decode("utf-8", "strict"))
    _exigir(anio is not None and set(direcciones) == set(empresas.CAPITULOS))
    tablas = {}
    paginas = {}
    for parte, direccion in direcciones.items():
        capitulo = _vinculado(carpeta, empresas.archivo_de_descubrimiento(parte, direccion), registros, peticiones)
        paginas[parte] = capitulo.decode("utf-8", "strict")
        tabla = empresas.tabla_del_capitulo(paginas[parte], empresas.CAPITULOS[parte][1])
        _exigir(tabla is not None)
        tablas[parte] = tabla
    return {
        "anio": anio,
        "nombre": f"{anio - 1}–1T{anio}",
        "tablas": tablas,
        "encontrada_en": empresas.RESULTADOS,
        **empresas.descubrir_plantilla(anio, paginas),
    }


def _comprobar(raiz: Path, evidencia: dict) -> None:
    _exigir(type(evidencia) is dict and type(evidencia.get("version")) is int)
    _exigir(evidencia["version"] == VERSION_VINCULADA and evidencia["fuente"] == empresas.FUENTE)
    carpeta = carpeta_originales(raiz, empresas.FUENTE)
    procedencia = leer_procedencia(carpeta, MAX_PROCEDENCIA_BYTES)
    _exigir(type(procedencia) is dict and type(evidencia["peticiones"]) is list)
    peticiones = {peticion["recurso_sha256"]: peticion for peticion in evidencia["peticiones"]}
    descubrimiento = por_nombre(procedencia["descubrimiento"])
    registros = por_nombre(procedencia["archivos"])
    edicion = _descubrir(carpeta, descubrimiento, peticiones)
    declarada = procedencia["edicion"]
    revisada = contrato_eticce.es_contrato_2026(declarada)
    _exigir(declarada == {**edicion, **({"contrato_ine": contrato_eticce.IDENTIFICADOR} if revisada else {})})
    archivos = empresas.archivos_del_ine(edicion)
    if revisada:
        # Un histórico reutilizado puede admitirse localmente, pero no acredita la consulta remota completa.
        _exigir(all(not procedencia[campo].get("continuidad") for campo in ("eurostat", "eurostat_cataluna")))
        archivos += [empresas.archivo_de_notas(parte, edicion) for parte in empresas.CAPITULOS]
        archivos += [empresas.archivo_de_eurostat_disponible(regional) for regional in (False, True)]
    else:
        archivos += [
            empresas.archivo_de_eurostat(edicion["anio"]),
            empresas.archivo_de_eurostat_cataluna(edicion["anio"]),
        ]
    if "plantilla_tic" in edicion:
        archivos += [*plantilla_tic.archivos(edicion), *plantilla_tic.archivos(edicion, notas=True)]
    # El calendario de publicaciones del INE, del que salen las fechas de la edición.
    archivos.append(calendario_ine.CALENDARIO)
    esperadas = len(empresas.CAPITULOS) + 1 + len(archivos)
    _exigir(len(peticiones) == len(evidencia["peticiones"]) == esperadas)
    _exigir(set(registros) == {archivo["archivo"] for archivo in archivos})
    for archivo in archivos:
        cuerpo = _vinculado(carpeta, archivo, registros, peticiones)
        if revisada:
            _comprobar_contrato(edicion, archivo["archivo"], cuerpo)

    if "plantilla_tic" in edicion:
        for parte, archivo, notas in zip(
            sorted(edicion["plantilla_tic"]["tablas"]),
            plantilla_tic.archivos(edicion),
            plantilla_tic.archivos(edicion, notas=True),
            strict=True,
        ):
            cuerpo = _vinculado(carpeta, archivo, registros, peticiones)
            pagina = _vinculado(carpeta, notas, registros, peticiones)
            plantilla_tic.normalizar(parte, json.loads(cuerpo), pagina.decode("utf-8", "strict"), edicion)
    _exigir(
        set(peticiones)
        == {identidad_recurso(registro["url"]) for registro in (*descubrimiento.values(), *registros.values())}
    )


def _comprobar_contrato(edicion: dict, nombre: str, cuerpo: bytes) -> None:
    """Las cuatro firmas y sus notas proceden de los mismos cuerpos HTTP vinculados."""
    for parte, descriptor in zip(sorted(edicion["tablas"]), empresas.archivos_del_ine(edicion), strict=True):
        if nombre == descriptor["archivo"]:
            _exigir(contrato_eticce.definicion_conocida(parte, empresas.definicion_ine_de_series(json.loads(cuerpo))))
        elif nombre == empresas.archivo_de_notas(parte, edicion)["archivo"]:
            contrato_eticce.comprobar_notas(parte, cuerpo.decode("utf-8", "strict"))


def comprobada(raiz: Path, evidencia: dict) -> bool:
    """Exige los cuerpos exactos de la edición: doce en el contrato histórico y dieciséis en el revisado.

    El padre valida el recibo v2 del intento vigente y llama solo después de admitir las tres etapas. Aquí se
    recalculan edición y consultas desde los HTML vinculados; no basta con confiar en las URL de procedencia.
    No repite la validación estadística, renueva fechas históricas ni acredita activación del paquete.

    Returns:
        True solo con todos los recursos actuales íntegros. La continuidad histórica no renueva esa comprobación.
    """
    try:
        _comprobar(raiz, evidencia)
    except (OSError, ValueError, TypeError, KeyError, RecursionError, FormatoInesperado):
        return False
    return True
