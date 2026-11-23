"""Qué se puede acreditar hoy en Cataluña: la oferta del servei d'acreditació de la Agència FP.CAT y lo que no ofrece.

Tres documentos de la Agència FP.CAT, en PDF:
- la «Llistat de l'oferta d'agrupacions d'ECP» (actualizada el 12/09/2025): las cualificaciones profesionales que el
  servicio ofrece, con familia, área, nombre y nivel, sin código;
- «Agrupacions d'ECP no disponibles…» (febrero de 2025): las cualificaciones de la familia Sanidad que no se acreditan
  porque el organismo que regula la profesión no lo prevé (Real Decreto 659/2023, art. 175.2), con su código;
- la «Guia de la persona usuària del servei d'acreditació» (agosto de 2024, posterior a la Resolució PRE/735/2024): la
  experiencia y la formación que se piden por nivel. Su PDF guarda la tabla de referencias en un flujo, que pdf.py no
  lee: los pasajes de los que salen las cifras de `cursos/fuentes/acreditacion/piezas/constantes.py` (HORAS_NIVEL_1) van
  transcritos con su página (PASAJES) y el original, con su huella.

casar() dice qué certificados del catálogo están en la oferta con seguridad: la oferta no trae códigos y su columna de
nivel tiene erratas, así que solo vale una fila cuyo final es el nombre catalán del certificado, con su nivel, y que no
casa con otro. Lo demás queda «sin comprobar»: Faro no afirma que no se acredite. no_disponibles() da los certificados
de las cualificaciones que la Agència no ofrece, por nombre y nivel dentro de la familia Sanidad (el catálogo no guarda
el código de la cualificación de referencia).

fp.gencat.cat cierra la lectura automática en su robots.txt (`Disallow: /`): los originales se obtienen a mano, con su
dirección, su fecha y su huella en la procedencia. Licencia: Llicència oberta d'ús d'informació – Catalunya.

Uso: python3 -m plataforma_datos.cursos.fuentes.agencia.lector {descargar,preparar,validar,todo}
"""

import re
import sys
import unicodedata
from collections import defaultdict
from typing import Any

from plataforma_datos.comun import pdf
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    controles_de_huella,
    guardar_jsonl,
    leer_json,
    leer_jsonl,
    original,
)
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, Controles, exigir
from plataforma_datos.comun.red import aviso_descarga_manual
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente

FUENTE = "agencia"
ORIGINAL, PREPARADO, _ = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
OFERTA_PDF = "agencia-oferta-ecp-2025-09-12.pdf"
NO_DISPONIBLES_PDF = "agencia-ecp-no-disponibles-2025-02.pdf"
GUIA_PDF = "agencia-guia-persona-usuaria-2024-08.pdf"
# Lo que escribe preparar y lee validar.
OFERTA = PREPARADO / "oferta.jsonl"
NO_DISPONIBLES = PREPARADO / "no-disponibles.jsonl"

FECHA_OFERTA = "2025-09-12"
FECHA_NO_DISPONIBLES = "2025-02"
FECHA_GUIA = "2024-08"
# Filas de la oferta: 358 con nivel y una cuyo nivel el PDF dibuja con un glifo ilegible («ó», Mediació d'assegurances).
FILAS_DE_LA_OFERTA = 359
CUALIFICACIONES_NO_DISPONIBLES = 12
# El renglón de cabecera que se repite en cada página y el pie con el número de página, que va justo antes.
CABECERAS = ("Data d'actualització", "FAMÍLIA PROFESSIONAL")
FIN_DE_FILA = re.compile(r" ([123]|ó)$")
# Código de una cualificación tal como lo escribe la lista de no disponibles («SA_2-491_3», y una vez «SA_2-628-3»).
CODIGO_NO_DISPONIBLE = re.compile(r"^SA_2-(\d{3})[_-]([123]) (.+)$")
FAMILIA_SANIDAD = "SAN"
# Pasajes de la guía, transcritos de sus páginas 8 y 9, que sostienen las cifras de
# `cursos/fuentes/acreditacion/piezas/constantes.py`.
PASAJES = {
    "experiencia": "pág. 8: «per la via de l'experiència laboral, serveis prestats mitjançant una beca o voluntariat, "
    "en els últims 15 anys […]: Experiència d'almenys 2 anys amb un mínim de 1.000 hores realitzades, en total (125 "
    "dies de 8 hores) per a unitats o estàndards de competència de nivell 1. Experiència d'almenys 3 anys amb un "
    "mínim de 2.000 hores realitzades, en total (250 dies de 8 hores) per a unitats o estàndards de competència de "
    "nivells 2 i 3.»",
    "formacion": "pág. 9: «En el cas de formació no reconeguda oficialment, en els darrers 10 anys […]: Formació "
    "relacionada de 200 hores, com a mínim, per acreditar competències de nivell 1. […] Formació relacionada de 300 "
    "hores, com a mínim, per acreditar competències de nivells 2 i 3.»",
}
CITA = (
    "Agència de Formació i Qualificació Professionals de Catalunya (Agència FP.CAT): «Llistat de l'oferta "
    "d'agrupacions d'ECP del servei d'acreditació de competències professionals» (12/09/2025), «Agrupacions d'ECP no "
    "disponibles en el servei d'acreditació…» (febrer de 2025) i «Guia de la persona usuària del servei d'acreditació "
    "de competències professionals» (agost de 2024)."
)


def clave(texto: str) -> str:
    """Normaliza un nombre para compararlo.

    Pasa a minúsculas, cambia «’» por «'», quita los acentos (NFKD), escribe «l·l» y «l.l» como «ll» y convierte
    cualquier otro signo, incluido el apóstrofo, en un espacio.

    Args:
        texto: El nombre.

    Returns:
        El nombre normalizado, con los espacios simples.
    """
    descompuesto = unicodedata.normalize("NFKD", texto.lower().replace("’", "'"))
    sin_acentos = "".join(letra for letra in descompuesto if not unicodedata.combining(letra)).replace("l·l", "ll")
    return re.sub(r"[^a-z0-9]+", " ", sin_acentos.replace("l.l", "ll")).strip()


def filas_de_la_oferta(renglones: list[str]) -> list[dict[str, Any]]:
    """Lee la oferta por cualificación: el texto (familia, área y nombre seguidos) y el nivel.

    Los renglones partidos se unen hasta el nivel; la cabecera de cada página y el número de página se saltan.

    Args:
        renglones: Los renglones del PDF de la oferta.

    Returns:
        Una fila por cualificación, con «texto» y «nivel» (None si no se lee).

    Raises:
        FormatoInesperado: Si al final queda texto de una fila sin nivel.
    """
    limpios = [renglon.strip() for renglon in renglones if renglon.strip()]
    filas, pendiente = [], ""
    for posicion, renglon in enumerate(limpios):
        siguiente = limpios[posicion + 1] if posicion + 1 < len(limpios) else ""
        if renglon.startswith(CABECERAS):
            continue
        if renglon.isdigit() and (not siguiente or siguiente.startswith(CABECERAS)):
            continue  # el número de página
        pendiente = f"{pendiente} {renglon}".strip()
        final = FIN_DE_FILA.search(pendiente)
        if final:
            nivel = int(final.group(1)) if final.group(1).isdigit() else None
            filas.append({"texto": pendiente[: final.start()], "nivel": nivel})
            pendiente = ""
    exigir(not pendiente, f"agencia: fila final sin nivel: {pendiente}")
    return filas


def cualificaciones_no_disponibles(renglones: list[str]) -> list[dict[str, Any]]:
    """Lee las cualificaciones de la lista de no disponibles.

    Args:
        renglones: Los renglones del PDF de la lista.

    Returns:
        Una por renglón que la nombra: código normalizado («SAN491_3»), nombre y nivel.
    """
    lista = []
    for renglon in renglones:
        encontrado = CODIGO_NO_DISPONIBLE.match(renglon.strip())
        if encontrado:
            numero, nivel, nombre = encontrado.groups()
            lista.append({"codigo": f"SAN{numero}_{nivel}", "nombre": nombre.strip(), "nivel": int(nivel)})
    return lista


def _acaba_en(texto: str, nombre: str) -> bool:
    """Indica si el texto normalizado acaba en el nombre normalizado, empezando en límite de palabra.

    Args:
        texto: El texto de una fila, normalizado (`clave`).
        nombre: El nombre de un certificado, normalizado.

    Returns:
        True si el nombre no está vacío y el texto es él o acaba en un espacio seguido de él.
    """
    return bool(nombre) and (texto == nombre or texto.endswith(f" {nombre}"))


def casar(certificados: list[dict[str, Any]], filas: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Busca los certificados que están en la oferta con seguridad: nombre al final, mismo nivel, uno a uno.

    Args:
        certificados: Los certificados, con su nombre en catalán y su nivel.
        filas: Las filas de la oferta (`filas_de_la_oferta`).

    Returns:
        Por código de certificado, su fila; solo los que casan con una fila que no casa con otro.
    """
    candidatos: dict[str, list[int]] = defaultdict(list)
    por_fila: dict[int, list[str]] = defaultdict(list)
    claves_de_filas = [clave(fila["texto"]) for fila in filas]  # una normalización por fila, no por pareja
    for certificado in certificados:
        nombre = clave(certificado.get("nombre_ca") or "")
        for posicion, clave_de_fila in enumerate(claves_de_filas):
            if _acaba_en(clave_de_fila, nombre):
                candidatos[certificado["codigo"]].append(posicion)
                por_fila[posicion].append(certificado["codigo"])
    niveles = {certificado["codigo"]: certificado["nivel"] for certificado in certificados}
    seguros = {}
    for codigo, posiciones in candidatos.items():
        if (
            len(posiciones) == 1
            and len(por_fila[posiciones[0]]) == 1
            and filas[posiciones[0]]["nivel"] == niveles[codigo]
        ):
            seguros[codigo] = filas[posiciones[0]]
    return seguros


def no_disponibles(certificados: list[dict[str, Any]], lista: list[dict[str, Any]]) -> dict[str, str]:
    """Busca los certificados de Sanidad cuya cualificación no se ofrece.

    Args:
        certificados: Los certificados, con familia, nombre en catalán y nivel.
        lista: Las cualificaciones no disponibles (`cualificaciones_no_disponibles`).

    Returns:
        Por código de certificado, el de su cualificación; solo cuando un único certificado coincide.
    """
    sanidad = [
        (clave(certificado.get("nombre_ca") or ""), certificado)
        for certificado in certificados
        if certificado["familia"] == FAMILIA_SANIDAD
    ]
    resultado = {}
    for cualificacion in lista:
        nombre = clave(cualificacion["nombre"])
        iguales = [
            certificado["codigo"]
            for clave_del_certificado, certificado in sanidad
            if clave_del_certificado == nombre and certificado["nivel"] == cualificacion["nivel"]
        ]
        if len(iguales) == 1:
            resultado[iguales[0]] = cualificacion["codigo"]
    return resultado


def _texto(nombre: str) -> list[str]:
    """Lee los renglones de un PDF guardado de esta fuente, tras comprobar su huella.

    Args:
        nombre: El archivo original.

    Returns:
        Sus renglones de texto.
    """
    return pdf.texto(original(FUENTE, nombre).read_bytes())


def descargar() -> None:
    """Los originales no se descargan con código: fp.gencat.cat cierra la lectura automática en su robots.txt."""
    aviso_descarga_manual(
        FUENTE,
        "fp.gencat.cat prohíbe la lectura automática en su robots.txt; los tres PDF se guardan a mano desde su "
        "dirección oficial y una versión nueva se registra en la procedencia y se vuelve a validar.",
    )


def preparar() -> None:
    """Lee las filas de la oferta y las cualificaciones no disponibles; de la guía, comprueba la huella."""
    filas = filas_de_la_oferta(_texto(OFERTA_PDF))
    lista = cualificaciones_no_disponibles(_texto(NO_DISPONIBLES_PDF))
    original(FUENTE, GUIA_PDF)  # solo exige que exista y comprueba su huella; no se lee
    guardar_jsonl(OFERTA, filas)
    guardar_jsonl(NO_DISPONIBLES, lista)
    print(f"Oferta: {len(filas)} filas · no disponibles: {len(lista)}")


def _controles(controles: Controles, filas: list[dict[str, Any]], lista: list[dict[str, Any]]) -> None:
    """Las filas de la oferta, como mucho una sin nivel, y las cualificaciones no disponibles con código distinto."""
    sin_nivel = [fila["texto"] for fila in filas if fila["nivel"] is None]
    controles.comprobar(len(filas) == FILAS_DE_LA_OFERTA, f"la oferta tiene {FILAS_DE_LA_OFERTA} filas ({len(filas)})")
    controles.comprobar(len(sin_nivel) <= 1, f"como mucho una fila sin nivel legible ({len(sin_nivel)})")
    controles.comprobar(
        len(lista) == CUALIFICACIONES_NO_DISPONIBLES
        and len({cualificacion["codigo"] for cualificacion in lista}) == len(lista),
        f"{CUALIFICACIONES_NO_DISPONIBLES} cualificaciones no disponibles, con código distinto ({len(lista)})",
    )


def validar() -> None:
    """Comprueba las tres lecturas y guarda el conjunto que lee `cursos/fuentes/acreditacion/piezas/validacion.py`."""
    filas, lista = leer_jsonl(OFERTA), leer_jsonl(NO_DISPONIBLES)
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, leer_json(PROCEDENCIA))
    _controles(controles, filas, lista)
    informe = {
        "estado": "Admitido" if controles.admitido else "Con errores",
        "comprobado_utc": ahora_utc(),
        "cobertura": {"filas_de_la_oferta": len(filas), "no_disponibles": len(lista)},
        "limites": (
            "La oferta no trae códigos y su columna de nivel tiene erratas: un certificado solo cuenta como ofrecido "
            "si su nombre catalán y su nivel casan con una sola fila. Lo que no casa queda sin comprobar."
        ),
        "controles": controles.lista,
    }
    conjunto = {
        "cita": CITA,
        "oferta": {"actualizada": FECHA_OFERTA, "filas": filas},
        "no_disponibles": {"actualizada": FECHA_NO_DISPONIBLES, "cualificaciones": lista},
        "guia": {"actualizada": FECHA_GUIA, "pasajes": PASAJES},
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos (sin el nombre del programa); None lee los del proceso.

    Returns:
        El código de salida de la orden.
    """
    etapas = {"descargar": descargar, "preparar": preparar, "validar": validar}
    return principal_fuente(__doc__, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
