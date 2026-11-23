"""El conjunto de la acreditación que exporta el paquete del motor."""

from typing import Any
from urllib.parse import urlsplit

from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.cursos.fuentes.acreditacion.piezas.constantes import (
    CITA_BOE,
    CITA_INE,
    CITA_SOC,
    PAGINAS_REGISTRADAS,
    SIN_ENLACE,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.descarga import nombre_de_disposicion
from plataforma_datos.cursos.fuentes.acreditacion.piezas.preparacion import registrados
from plataforma_datos.cursos.fuentes.acreditacion.piezas.relacion_con_ocupaciones import Relaciones
from plataforma_datos.cursos.fuentes.acreditacion.piezas.validacion import de_cataluna, punto_de_informacion

# Los valores de «oferta_cataluna» que lee el motor (contrato con el motor, en TypeScript).
OFERTA_SI = "si"
OFERTA_SIN_COMPROBAR = "sin-comprobar"


def _nombre_en_dos_idiomas(fila: dict[str, Any]) -> dict[str, str]:
    """El nombre en castellano y en catalán de una unidad o un certificado.

    Returns:
        El nombre, con una clave por idioma.
    """
    return {"es": fila["nombre_es"], "ca": fila["nombre_ca"]}


def _unidad_exportada(unidad: dict[str, Any], equivalencias: dict[str, list[dict[str, str]]]) -> dict[str, Any]:
    """Lo que el motor usa de una unidad: código, nombre en los dos idiomas, módulo, horas y unidades actuales.

    Returns:
        La unidad con los campos que usa el motor.
    """
    return {
        "codigo": unidad["codigo"],
        "nombre": _nombre_en_dos_idiomas(unidad),
        "modulo": unidad["modulo"],
        "horas": unidad["horas"],
        "actuales": [
            {"codigo": actual["codigo"], "nombre": actual["nombre"]}
            for actual in equivalencias.get(unidad["codigo"], [])
        ],
    }


def _certificado_exportado(certificado: dict[str, Any], urls: dict[str, str], en_la_oferta: set[str]) -> dict[str, Any]:
    """Lo que el motor usa de un certificado relacionable.

    `oferta_cataluna` es «si» solo si casar() lo encuentra con seguridad en la oferta de la Agència FP.CAT; si no,
    «sin-comprobar»: la oferta no trae códigos, así que no estar casado no quiere decir que no se pueda pedir.

    Returns:
        El certificado con los campos que usa el motor.
    """
    anexo = certificado["anexo"]
    archivo = nombre_de_disposicion(anexo["real_decreto"])
    exigir(archivo in urls, f"acreditacion: sin dirección del BOE para el Real Decreto {anexo['real_decreto']}")
    return {
        "oferta_cataluna": OFERTA_SI if certificado["codigo"] in en_la_oferta else OFERTA_SIN_COMPROBAR,
        "nombre": _nombre_en_dos_idiomas(certificado),
        "nivel": certificado["nivel"],
        "horas": certificado["horas"],
        "familia": certificado["familia"],
        "real_decreto": anexo["real_decreto"],
        "boe": urls[archivo],
        "unidades": [_unidad_exportada(unidad, certificado["equivalencias"]) for unidad in certificado["unidades"]],
    }


def conjunto_validado(
    certificados: list[dict[str, Any]],
    normas: dict[str, Any],
    relaciones_propuestas: Relaciones,
    revision: dict[str, Any],
) -> dict[str, Any]:
    """El paquete del motor: las relaciones de cada ocupación y grupo, sus certificados, los enlaces y las fechas.

    Solo van las ocupaciones y los grupos con algún certificado. El catálogo incluye todos los certificados con
    anexo, tengan o no una relación admitida: `mercado/fuentes/perfiles/lector.py` y
    `cursos/fuentes/certificados2016/lector.py` comprueban en él los códigos que
    relacionan. `relaciones` contiene las ocupaciones y los grupos; `revision` conserva por separado la procedencia
    de cada relación (procedencia_de_la_revision).

    Returns:
        El paquete del motor, listo para escribir.
    """
    entradas = registrados()
    urls = {entrada["archivo"]: entrada["url"] for entrada in entradas}
    fechas = [
        entrada["descargado_utc"][:10]
        for entrada in entradas
        if urlsplit(entrada["url"]).hostname in ("www.boe.es", "boe.es")
    ]
    exigir(bool(fechas), "acreditacion: sin copias del BOE registradas")
    ocupaciones = {
        esco: [[codigo, variante] for codigo, variante in encontradas.items()]
        for esco, encontradas in relaciones_propuestas.ocupaciones.items()
        if encontradas
    }
    grupos = {isco: sorted(encontradas) for isco, encontradas in relaciones_propuestas.grupos.items() if encontradas}
    cataluna = de_cataluna(certificados)
    en_la_oferta = set(cataluna["en_la_oferta"])
    return {
        "fuentes": {"boe": CITA_BOE, "ine": CITA_INE, "soc": CITA_SOC},
        "fecha_boe": max(fechas),
        "comprobado": min(pagina["comprobado"] for pagina in PAGINAS_REGISTRADAS.values()),
        "horas_nivel_1": normas["horas_nivel_1"]["cifra"],
        "no_disponibles": sorted(cataluna["no_disponibles"]),
        "oferta_actualizada": cataluna["oferta_actualizada"],
        "enlaces": {clave: pagina["url"] for clave, pagina in PAGINAS_REGISTRADAS.items() if clave not in SIN_ENLACE},
        "punto_de_informacion": punto_de_informacion(PAGINAS_REGISTRADAS),
        "relaciones": {"ocupaciones": ocupaciones, "grupos": grupos},
        "revision": revision,
        "certificados": {
            certificado["codigo"]: _certificado_exportado(certificado, urls, en_la_oferta)
            for certificado in certificados
            if certificado["anexo"]
        },
    }
