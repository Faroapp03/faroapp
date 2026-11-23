"""Datos de la hoja de ruta personal: la comarca de cada municipio y el temario oficial de cada especialidad.

- datos/comarcas.json: los 947 municipios de Cataluña con su comarca, de la lista del Idescat «Codis territorials:
  municipis» (descargada el 21/10/2026; la copia y su huella están en el producto). El motor de
  cursos la usa para saber si un curso presencial es de la comarca de la persona. Lleva también las equivalencias de
  los nombres de municipio de las fuentes de cursos que no están tal cual en el Idescat, cada una con su fuente y su
  motivo (EQUIVALENCIAS_DE_MUNICIPIOS); el paso comprueba cada una contra la lista.
- datos/temarios.json: «Qué aprenderás» de cada especialidad, con el objetivo general y los módulos tal como los
  publica su ficha oficial (SEPE, Consorci per a la Formació Contínua de Catalunya o FUNDAE), literales y en su idioma:
  sin resumir ni traducir. Sale de las entradas fijadas de datos/fuentes/hoja-de-ruta:
  extractos.json, textos.jsonl y procedencia.json.

Cada paso lee la fuente de datos/fuentes/hoja-de-ruta, comprueba su huella y escribe el paquete y su entrada
en datos/manifiesto.json con los orígenes y su huella (exportar_paquete.py la conserva si los bytes no cambian). Python
estándar, sin red.

Uso: python3 -m plataforma_datos.cursos.fuentes.hoja_de_ruta.lector {comarcas,temarios,todo} [--comprobar]
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import comprobar_huella, relativa, sha256, sha256_bytes
from plataforma_datos.comun.estadisticas import CITA_IDESCAT, LICENCIA_IDESCAT
from plataforma_datos.comun.nucleo import PAQUETE, RAIZ, FormatoInesperado, exigir
from plataforma_datos.comun.socrata import LICENCIA_DE_LA_GENERALITAT

FUENTES = RAIZ / "datos/fuentes/hoja-de-ruta"

# ------------------------------------------------------------------------------------------------ Comarcas (Idescat)

MUNICIPIOS_IDESCAT = FUENTES / "municipis-idescat-2026-10-21.ssv"
HUELLA_MUNICIPIOS = "25c1277a50d8d66a726c7707d9d65585c7d6d562149bc1a4eda24919dfb5f84e"
URL_MUNICIPIOS = "https://www.idescat.cat/codis/?id=50&n=9&f=ssv"
CONSULTA_MUNICIPIOS = "2026-10-21"
MUNICIPIOS_ESPERADOS = 947
COMARCAS_ESPERADAS = 43
CABECERA_MUNICIPIOS = "Codi;Nom;Codi comarca;Nom comarca;"
CODIGO_MUNICIPIO = re.compile(r"^\d{6}$")
CODIGO_COMARCA = re.compile(r"^\d{2}$")
PROVINCIAS = ("08", "17", "25", "43")
COLUMNAS_MUNICIPIOS = 4
CITA_LISTA_IDESCAT = "Idescat, «Codis territorials: municipis», consultado el 21/10/2026"
# Nombres de municipio de las fuentes de cursos que no están tal cual en la lista del Idescat. Sin «fuenteDelCurso», la
# equivalencia vale para cualquier fuente, porque el nombre solo corresponde a un municipio de la lista; con ella, solo
# para los cursos de esa fuente, porque el nombre es ambiguo y lo resuelve la dirección de su propia ficha.
EQUIVALENCIAS_DE_MUNICIPIOS: tuple[dict[str, str], ...] = (
    {
        "nombre": "Palamós",
        "codigo": "171181",
        "motivo": "«Palamós» ya no está en la lista: el único municipio con ese nombre es «Palamós i Sant Joan» "
        "(171181, el 17118 del INE con su dígito de control).",
        "fuente": CITA_LISTA_IDESCAT,
    },
    {
        "nombre": "Cornellà",
        "codigo": "080734",
        "fuenteDelCurso": "citilab",
        "motivo": "Hay dos Cornellà en la lista (de Llobregat, 080734, y del Terri, 170561). La ficha de cada curso de "
        "Citilab da como lugar «Citilab, Pl. Can Suris, s/n, 08940»: la plaza de Can Suris de Cornellà de Llobregat. "
        "«Cornellà» en otra fuente sigue sin comarca.",
        "fuente": "Fichas de Citilab (citilab.eu), lugar de cada curso, copia del 06/10/2026; " + CITA_LISTA_IDESCAT,
    },
)


def comarcas_de(texto: str) -> dict[str, Any]:
    """La tabla municipio → comarca de la lista de municipios del Idescat (`f=ssv`, separada por «;»).

    Args:
        texto: El contenido del archivo, ya leído.

    Returns:
        El contenido de datos/comarcas.json.

    Raises:
        FormatoInesperado: Si la cabecera, los códigos o los recuentos no son los esperados.
    """
    lineas = texto.lstrip("﻿").splitlines()
    exigir(CABECERA_MUNICIPIOS in lineas, f"la lista del Idescat no tiene la cabecera «{CABECERA_MUNICIPIOS}»")
    filas = [linea.split(";") for linea in lineas[lineas.index(CABECERA_MUNICIPIOS) + 1 :] if linea.strip()]
    municipios: list[list[str]] = []
    comarcas: dict[str, str] = {}
    for fila in filas:
        exigir(len(fila) >= COLUMNAS_MUNICIPIOS, f"fila del Idescat incompleta: {';'.join(fila)}")
        codigo, nombre, codigo_comarca, comarca = (parte.strip() for parte in fila[:COLUMNAS_MUNICIPIOS])
        exigir(bool(CODIGO_MUNICIPIO.match(codigo)), f"código de municipio inesperado: {codigo!r}")
        exigir(codigo[:2] in PROVINCIAS, f"municipio fuera de Cataluña: {codigo}")
        exigir(bool(CODIGO_COMARCA.match(codigo_comarca)), f"código de comarca inesperado: {codigo_comarca!r}")
        exigir(bool(nombre) and bool(comarca), f"municipio sin nombre o sin comarca: {codigo}")
        exigir(comarcas.get(codigo_comarca, comarca) == comarca, f"la comarca {codigo_comarca} tiene dos nombres")
        comarcas[codigo_comarca] = comarca
        municipios.append([codigo, nombre, codigo_comarca])
    exigir(
        len(municipios) == MUNICIPIOS_ESPERADOS, f"{len(municipios)} municipios; se esperaban {MUNICIPIOS_ESPERADOS}"
    )
    exigir(len({m[0] for m in municipios}) == len(municipios), "hay códigos de municipio repetidos")
    exigir(len(comarcas) == COMARCAS_ESPERADAS, f"{len(comarcas)} comarcas; se esperaban {COMARCAS_ESPERADAS}")
    equivalencias = [equivalencia_comprobada(e, municipios) for e in EQUIVALENCIAS_DE_MUNICIPIOS]
    return {
        "formato": 1,
        "fuente": "Institut d'Estadística de Catalunya (Idescat), «Codis territorials: municipis»",
        "url": URL_MUNICIPIOS,
        "consultado": CONSULTA_MUNICIPIOS,
        "cita": f"{CITA_IDESCAT}. Códigos territoriales de los municipios, consultados el 21/10/2026.",
        "licencia": LICENCIA_IDESCAT,
        "campos": ["codigo", "nombre", "comarca"],
        "comarcas": dict(sorted(comarcas.items())),
        "municipios": sorted(municipios),
        "equivalencias": equivalencias,
    }


def _empieza_por(nombre: str, prefijo: str) -> bool:
    """Si un nombre de la lista empieza por otro como palabra entera («Palamós i Sant Joan» por «Palamós»).

    Returns:
        Si es el mismo nombre o lo sigue un espacio.
    """
    return nombre == prefijo or nombre.startswith(f"{prefijo} ")


def equivalencia_comprobada(equivalencia: dict[str, str], municipios: list[list[str]]) -> dict[str, str]:
    """Comprueba una equivalencia de nombre de municipio contra la lista del Idescat.

    El nombre no puede estar tal cual en la lista. Sin «fuenteDelCurso», el código tiene que ser el único municipio
    cuyo nombre empieza por él; con ella, el nombre tiene que ser ambiguo (varios municipios) y el código, uno de ellos.

    Args:
        equivalencia: nombre, codigo, motivo, fuente y, si solo vale para una fuente de cursos, fuenteDelCurso.
        municipios: La lista del Idescat, como [código, nombre, código de comarca].

    Returns:
        La equivalencia, con el nombre del municipio en el Idescat.

    Raises:
        FormatoInesperado: Si la lista no la sostiene.
    """
    nombre, codigo = equivalencia["nombre"], equivalencia["codigo"]
    exigir(bool(equivalencia.get("motivo")) and bool(equivalencia.get("fuente")), f"«{nombre}» sin motivo o fuente")
    exigir(all(m[1] != nombre for m in municipios), f"«{nombre}» ya está tal cual en la lista del Idescat")
    candidatos = [m for m in municipios if _empieza_por(m[1], nombre)]
    exigir(any(m[0] == codigo for m in candidatos), f"«{nombre}»: {codigo} no es un municipio con ese nombre")
    if equivalencia.get("fuenteDelCurso"):
        exigir(len(candidatos) > 1, f"«{nombre}» no es ambiguo: no hace falta limitarlo a una fuente")
    else:
        exigir(len(candidatos) == 1, f"«{nombre}» es ambiguo: {', '.join(m[1] for m in candidatos)}")
    idescat = next(m[1] for m in candidatos if m[0] == codigo)
    return {**equivalencia, "idescat": idescat}


# -------------------------------------------------------------------------------------- Temarios («Qué aprenderás»)

EXTRACTOS = FUENTES / "extractos.json"
TEXTOS = FUENTES / "textos.jsonl"
PROCEDENCIA = FUENTES / "procedencia.json"
HUELLAS_TEMARIOS = {
    "extractos.json": "6d0c30dd87a8cfcdeeae78e0d92848807cd1d9c3ac443db3821a328cad08fdc6",
    "textos.jsonl": "2357d636c6d278d0d9c9291db5ef08112df9bd16e8db98474aa42fbea73f34ab",
    "procedencia.json": "13075929798143e3dc3234a209fc33559812760136471f5c1f2dbfa4ef2471f5",
}
TEMARIOS_ESPERADOS = 415

LICENCIAS_DE_LOS_TEMARIOS = {
    "SEPE": (
        "Aviso legal del SEPE, Ley 37/2007 y RD 1495/2011: reutilización citando «Origen de los datos: SEPE» y la "
        "fecha de la consulta, sin desnaturalizar el sentido ni sugerir aval."
    ),
    "Consorci": LICENCIA_DE_LA_GENERALITAT.format(cita=" («Consorci per a la Formació Contínua de Catalunya»)"),
    "FUNDAE": (
        "FUNDAE no publica una licencia de reutilización: se copian literales el objetivo y los contenidos de la ficha "
        "pública de la especialidad, citando la fuente y con el enlace a su PDF."
    ),
}
ORGANISMOS = {
    "SEPE": "Servicio Público de Empleo Estatal (SEPE), fichero de especialidades formativas",
    "Consorci": "Consorci per a la Formació Contínua de Catalunya (Conforcat), catàleg d'especialitats",
    "FUNDAE": "Fundación Estatal para la Formación en el Empleo (FUNDAE), especialidades formativas",
}

OBJETIVO = re.compile(
    r"(?:Objetivo general|Objectiu general):? (?P<objetivo>.+?) "
    r"(?=Relación de módulos|Relació de mòduls|Modalidad(?:es)? de impartición|Modalitats? d'impartició)"
)
FIN_DE_LOS_MODULOS = r"(?P<fin> Modalidad(?:es)? de impartición| Modalitats? d'impartició|$)"
MODULOS_ES = re.compile(rf"Relación de módulos(?: de formación)? (?P<seccion>.*?){FIN_DE_LOS_MODULOS}")
MODULOS_CA = re.compile(rf"Relació de mòduls(?: de formació)? (?P<seccion>.*?){FIN_DE_LOS_MODULOS}")
MODULO = re.compile(r"(?:Módulo|Mòdul) (?P<n>\d+):? (?P<nombre>[^…]+?) \d+(?:[.,]\d+)? (?:horas|hores)(?= |$)")
CONTENIDOS = re.compile(r"CONTENIDOS FORMATIVOS:? (?P<seccion>.*)$")
APARTADO = re.compile(r"(?<![\d.])(?P<n>\d{1,2})\. (?P<nombre>.+?)(?= \d{1,2}\.\d| \d{1,2}\. |$)")
CORTE = "…"


def _seguidos(encontrados: list[tuple[int, str]]) -> list[str]:
    """Los nombres numerados desde 1 sin saltos: el primero que no sigue la cuenta cierra la lista.

    Returns:
        Los nombres, en orden.
    """
    nombres: list[str] = []
    for numero, nombre in encontrados:
        if numero != len(nombres) + 1:
            break
        nombres.append(nombre)
    return nombres


def _modulos_de_la_ficha(texto: str) -> tuple[list[str], bool]:
    """Los módulos de una ficha del SEPE o del Consorci («Módulo 1 Nombre 7 horas»), literales.

    Returns:
        Los nombres y si la lista está completa (el extracto llega hasta la modalidad).
    """
    seccion = MODULOS_CA.search(texto) or MODULOS_ES.search(texto)
    if seccion is None:
        return [], False
    cuerpo = seccion["seccion"]
    nombres = _seguidos([(int(m["n"]), m["nombre"].strip()) for m in MODULO.finditer(cuerpo)])
    completa = bool(seccion["fin"]) and CORTE not in cuerpo
    return nombres, completa


def _modulos_de_fundae(texto: str) -> tuple[list[str], bool]:
    """Los apartados de primer nivel de «CONTENIDOS FORMATIVOS» de FUNDAE («1. FUNCIONES.»), literales.

    El extracto acaba cortado: el último apartado, que puede estar a medias, no se toma.

    Returns:
        Los nombres y si la lista está completa (nunca: el extracto no llega al final).
    """
    seccion = CONTENIDOS.search(texto)
    if seccion is None:
        return [], False
    encontrados = [(int(m["n"]), m["nombre"].strip()) for m in APARTADO.finditer(seccion["seccion"])]
    nombres = _seguidos(encontrados[:-1])
    return [nombre.removesuffix(".").strip() for nombre in nombres], False


def temario_de(texto: str, fuente: str) -> dict[str, Any] | None:
    """El objetivo general y los módulos de un extracto, literales, con su idioma.

    Args:
        texto: El extracto de la ficha oficial.
        fuente: SEPE, Consorci o FUNDAE.

    Returns:
        objetivo (o None si el extracto no lo trae entero), modulos, modulosCompletos e idioma; None si no hay nada.
    """
    limpio = re.sub(r"\s+", " ", texto).strip()
    objetivo = OBJETIVO.search(limpio)
    texto_del_objetivo = objetivo["objetivo"].strip() if objetivo and CORTE not in objetivo["objetivo"] else None
    modulos, completos = _modulos_de_fundae(limpio) if fuente == "FUNDAE" else _modulos_de_la_ficha(limpio)
    if texto_del_objetivo is None and not modulos:
        return None
    catalan = re.search(r"Objectiu general|Relació de mòduls|Mòdul \d", limpio) is not None
    return {
        "objetivo": texto_del_objetivo,
        "modulos": modulos,
        "modulosCompletos": completos,
        "idioma": "ca" if catalan else "es",
    }


def temarios_de(extractos: dict[str, str], fichas: list[dict[str, Any]], consultado: str) -> dict[str, Any]:
    """«Qué aprenderás» de cada especialidad, con la fuente de su ficha.

    Args:
        extractos: El extracto de cada código de especialidad.
        fichas: Las filas de textos.jsonl (código, fuente y dirección de cada ficha).
        consultado: El día en que se descargaron las fichas (AAAA-MM-DD).

    Returns:
        El contenido de datos/temarios.json.

    Raises:
        FormatoInesperado: Si falta la procedencia de algún extracto o la fuente no es conocida.
    """
    procedencia = {fila["codigo"]: fila for fila in fichas}
    temarios: dict[str, Any] = {}
    sin_temario: list[str] = []
    for codigo in sorted(extractos):
        ficha = procedencia.get(codigo)
        exigir(ficha is not None, f"el extracto de {codigo} no tiene procedencia en textos.jsonl")
        assert ficha is not None
        exigir(ficha.get("fuente") in ORGANISMOS, f"fuente desconocida para {codigo}: {ficha.get('fuente')!r}")
        exigir(str(ficha.get("url", "")).startswith("https://"), f"la ficha de {codigo} no tiene dirección")
        temario = temario_de(extractos[codigo], ficha["fuente"])
        if temario is None:
            sin_temario.append(codigo)
            continue
        temarios[codigo] = {
            **temario,
            "fuente": {"organismo": ficha["fuente"], "url": ficha["url"]},
            "consultado": consultado,
        }
    return {
        "formato": 1,
        "consultado": consultado,
        "fuentes": {
            nombre: {"nombre": organismo, "licencia": LICENCIAS_DE_LOS_TEMARIOS[nombre]}
            for nombre, organismo in ORGANISMOS.items()
        },
        "aviso": (
            "Objetivo general y módulos copiados literales de la ficha oficial de cada especialidad, en su idioma; "
            "los extractos pueden acabar cortados: modulosCompletos dice si la lista llega al final."
        ),
        "sinTemario": sin_temario,
        "temarios": temarios,
    }


# ------------------------------------------------------------------------------------------------- Escritura


def _bytes(contenido: object) -> bytes:
    """El JSON compacto, con salto final.

    Returns:
        Sus bytes en UTF-8.
    """
    return (json.dumps(contenido, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def escribir(
    nombre: str, contenido: object, origenes: list[Path], carpeta: Path = PAQUETE, comprobar: bool = False
) -> bool:
    """Escribe un archivo del paquete y su entrada en el manifiesto (o, con `comprobar`, mira si están al día).

    Args:
        nombre: El archivo de datos/ («comarcas.json» o «temarios.json»).
        contenido: Lo que se escribe, en JSON compacto con salto final.
        origenes: Las fuentes de datos/fuentes/hoja-de-ruta, con su huella en la entrada.
        carpeta: La carpeta del paquete.
        comprobar: Solo comprobar, sin escribir.

    Returns:
        Si el archivo y su entrada están al día (al escribir, siempre).
    """
    datos = _bytes(contenido)
    entrada = {"origenes": {relativa(r): sha256(r) for r in origenes}, "sha256": sha256_bytes(datos)}
    ruta_manifiesto = carpeta / "manifiesto.json"
    manifiesto = json.loads(ruta_manifiesto.read_text(encoding="utf-8")) if ruta_manifiesto.exists() else {}
    destino = carpeta / nombre
    if comprobar:
        return destino.exists() and destino.read_bytes() == datos and manifiesto.get(nombre) == entrada
    destino.write_bytes(datos)
    manifiesto[nombre] = entrada
    ruta_manifiesto.write_text(json.dumps(manifiesto, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return True


def paso_comarcas(carpeta: Path = PAQUETE, comprobar: bool = False) -> bool:
    """Lee la lista del Idescat de datos/fuentes/hoja-de-ruta, comprueba su huella y escribe datos/comarcas.json.

    Returns:
        Si está al día (con `comprobar`) o True tras escribir.
    """
    exigir(sha256(MUNICIPIOS_IDESCAT) == HUELLA_MUNICIPIOS, "la lista de municipios del Idescat no es la registrada")
    contenido = comarcas_de(MUNICIPIOS_IDESCAT.read_text(encoding="utf-8"))
    return escribir("comarcas.json", contenido, [MUNICIPIOS_IDESCAT], carpeta, comprobar)


def paso_temarios(carpeta: Path = PAQUETE, comprobar: bool = False) -> bool:
    """Lee los extractos y su procedencia del producto y escribe datos/temarios.json.

    Returns:
        Si está al día (con `comprobar`) o True tras escribir.
    """
    for ruta in (EXTRACTOS, TEXTOS, PROCEDENCIA):
        comprobar_huella(ruta, HUELLAS_TEMARIOS[ruta.name])
    extractos = json.loads(EXTRACTOS.read_text(encoding="utf-8"))
    fichas = [json.loads(linea) for linea in TEXTOS.read_text(encoding="utf-8").splitlines() if linea.strip()]
    procedencia = json.loads(PROCEDENCIA.read_text(encoding="utf-8"))
    exigir(len(extractos) == TEMARIOS_ESPERADOS, f"{len(extractos)} extractos; se esperaban {TEMARIOS_ESPERADOS}")
    consultado = str(procedencia.get("fecha", ""))[:10]
    exigir(bool(re.match(r"^\d{4}-\d{2}-\d{2}$", consultado)), "procedencia.json no tiene la fecha de la descarga")
    contenido = temarios_de(extractos, fichas, consultado)
    return escribir("temarios.json", contenido, [EXTRACTOS, TEXTOS, PROCEDENCIA], carpeta, comprobar)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta un paso, o los dos; con --comprobar, solo dice si están al día.

    Returns:
        0 si todo ha ido bien (o está al día); 1 si no.
    """
    analizador = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    analizador.add_argument("paso", choices=["comarcas", "temarios", "todo"])
    analizador.add_argument("--comprobar", action="store_true")
    argumentos = analizador.parse_args(argv)
    pasos = {"comarcas": paso_comarcas, "temarios": paso_temarios}
    elegidos = list(pasos) if argumentos.paso == "todo" else [argumentos.paso]
    al_dia = True
    for nombre in elegidos:
        try:
            bien = pasos[nombre](comprobar=argumentos.comprobar)
        except FormatoInesperado as error:
            print(f"{nombre}: {error}", file=sys.stderr)
            return 1
        al_dia = al_dia and bien
        estado = ("al día" if bien else "no está al día") if argumentos.comprobar else "escrito"
        print(f"{nombre}.json: {estado}")
    return 0 if al_dia else 1


if __name__ == "__main__":
    sys.exit(main())
