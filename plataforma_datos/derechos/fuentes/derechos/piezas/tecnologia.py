"""Derechos ante la IA y la tecnología en el trabajo: qué se cita, qué se resume y cómo se comprueba cada cosa.

Tres piezas, todas de fuentes oficiales y comprobadas letra a letra contra sus originales:
- citas literales y breves del Estatuto de los Trabajadores (art. 64.4.d: la representación tiene derecho a conocer los
  parámetros de los algoritmos que deciden sobre el trabajo) y de la Ley Orgánica 3/2018 (LOPDGDD, arts. 87 a 90:
  intimidad con los dispositivos digitales, desconexión, videovigilancia y geolocalización), del texto consolidado del
  BOE, con su enlace y la fecha de esa versión;
- los puntos que Faro resume de las recomendaciones del Consell de Relacions Laborals (CRL) de 2025 a la negociación
  colectiva: el resumen es de Faro y está en el motor; aquí va el pasaje literal del documento oficial en que se apoya
  cada punto, con su página, para que un punto sin apoyo no pueda entrar;
- las nueve cláusulas sectoriales que el anexo del mismo documento pone de ejemplo (pp. 57–65): solo datos, que el
  informe no pinta. Cada una se admite si su referencia y su artículo están en la página citada; las de banca y química
  se comprueban además en su texto del BOE.

El PDF del CRL guarda sus referencias en flujos, que `pdf.py` no lee: sus pasajes se comprueban en la extracción de
texto por páginas que acompaña a la captura, registrada con su huella junto a la del PDF. Python estándar.
"""

import re
from collections.abc import Callable
from copy import deepcopy
from typing import Any

from plataforma_datos.comun import boe
from plataforma_datos.comun.nucleo import exigir

# Una cita es breve: como mucho dos fragmentos de 300 caracteres o menos (criterios de selección del conjunto).
MAX_FRAGMENTOS = 2
MAX_CARACTERES = 300
# La única excepción: la letra d del art. 64.4 del Estatuto tiene 304 caracteres, y cortarla quitaría «incluida la
# elaboración de perfiles», que es lo que la hace útil. Se cita entera, y solo se admite si es un párrafo completo.
LETRAS_ENTERAS = {"estatuto-64-4-d": "d) "}

# Lo que se conserva del texto extraído del PDF: el latín (hasta el bloque IPA, U+0250) y la puntuación general
# (U+2000–U+20FF: comillas, guiones, puntos suspensivos). Lo demás son glifos de viñetas e iconos.
FIN_DEL_LATIN = 0x250
PUNTUACION_GENERAL = range(0x2000, 0x2100)

ESTATUTO = "BOE-A-2015-11430"
LOPDGDD = "BOE-A-2018-16673"

CITADAS = (
    {
        "id": "estatuto-64-4-d",
        "fuente": "Estatuto de los Trabajadores, art. 64.4.d",
        "norma": ESTATUTO,
        "articulo": 64,
        "fragmentos": [
            "El comité de empresa, con la periodicidad que proceda en cada caso, tendrá derecho a:",
            "Ser informado por la empresa de los parámetros, reglas e instrucciones en los que se basan los algoritmos "
            "o sistemas de inteligencia artificial que afectan a la toma de decisiones que pueden incidir en las "
            "condiciones de trabajo, el acceso y mantenimiento del empleo, incluida la elaboración de perfiles.",
        ],
    },
    {
        "id": "lopdgdd-87",
        "fuente": "Ley Orgánica 3/2018 (LOPDGDD), art. 87",
        "norma": LOPDGDD,
        "articulo": 87,
        "fragmentos": [
            "Los trabajadores y los empleados públicos tendrán derecho a la protección de su intimidad en el uso de "
            "los dispositivos digitales puestos a su disposición por su empleador.",
            "Los trabajadores deberán ser informados de los criterios de utilización a los que se refiere este "
            "apartado.",
        ],
    },
    {
        "id": "lopdgdd-88",
        "fuente": "Ley Orgánica 3/2018 (LOPDGDD), art. 88",
        "norma": LOPDGDD,
        "articulo": 88,
        "fragmentos": [
            "Los trabajadores y los empleados públicos tendrán derecho a la desconexión digital a fin de garantizar, "
            "fuera del tiempo de trabajo legal o convencionalmente establecido, el respeto de su tiempo de descanso, "
            "permisos y vacaciones, así como de su intimidad personal y familiar."
        ],
    },
    {
        "id": "lopdgdd-89",
        "fuente": "Ley Orgánica 3/2018 (LOPDGDD), art. 89",
        "norma": LOPDGDD,
        "articulo": 89,
        "fragmentos": [
            "Los empleadores habrán de informar con carácter previo, y de forma expresa, clara y concisa, a los "
            "trabajadores o los empleados públicos y, en su caso, a sus representantes, acerca de esta medida.",
            "En ningún caso se admitirá la instalación de sistemas de grabación de sonidos ni de videovigilancia en "
            "lugares destinados al descanso o esparcimiento de los trabajadores o los empleados públicos, tales como "
            "vestuarios, aseos, comedores y análogos.",
        ],
    },
    {
        "id": "lopdgdd-90",
        "fuente": "Ley Orgánica 3/2018 (LOPDGDD), art. 90",
        "norma": LOPDGDD,
        "articulo": 90,
        "fragmentos": [
            "Con carácter previo, los empleadores habrán de informar de forma expresa, clara e inequívoca a los "
            "trabajadores o los empleados públicos y, en su caso, a sus representantes, acerca de la existencia y "
            "características de estos dispositivos."
        ],
    },
)

# Cada punto del resumen de Faro y los pasajes del documento del CRL (versión en castellano) en que se apoya.
RECOMENDACIONES = (
    {
        "id": "informacion-sin-pedirla",
        "pagina": 30,
        "anclas": [
            "no requiere que la RLPT solicite acceso a esta información porque la empresa está obligada a facilitarla",
            "El artículo afecta a cualesquiera herramientas digitales con software que contenga algoritmos",
        ],
    },
    {
        "id": "deber-de-formar",
        "pagina": 33,
        "anclas": [
            "la introducción de herramientas basadas en algoritmos o sistemas de IA (de acuerdo con los artículos "
            "4.2.b y 23.1.d del ET)",
            "alfabetización tecnológica del artículo 4 del RIA",
        ],
    },
    {
        "id": "formacion-en-el-convenio",
        "pagina": 34,
        "anclas": [
            "Apostar por la formación continua de las personas trabajadoras para la mejora de las competencias "
            "digitales",
            "se puede prever la aplicación de medidas de flexibilidad horaria",
        ],
    },
    {
        "id": "impacto-de-genero",
        "pagina": 29,
        "anclas": [
            "Realizar un diagnóstico de impacto de género entre mujeres y hombres cuando una empresa utiliza "
            "algoritmos o sistemas de decisión automatizada."
        ],
    },
)


def clausula(sector: str, referencia: str, articulos: list[str], paginas: list[int], resumen: str) -> dict[str, Any]:
    """Una cláusula sectorial del anexo: su boletín, su número y su fecha salen de la referencia que cita el CRL.

    Returns:
        La cláusula, con su boletín, su número y su fecha.
    """
    boletin = re.search(r"(BOE|DOGC) núm\. (\d+), de (\d{1,2})\.(\d{1,2})\.(\d{4})", referencia)
    exigir(boletin is not None, f"{sector}: la referencia no cita su boletín")
    diario, numero, dia, mes, anio = boletin.groups()
    codigo = re.search(r"\b(\d{14})\b", referencia)
    return {
        "sector": sector,
        "convenio": referencia.split(" (")[0],
        "codigo_convenio": codigo.group(1) if codigo else None,
        "articulos": articulos,
        "boletin": diario,
        "numero_boletin": int(numero),
        "fecha_publicacion": f"{anio}-{int(mes):02d}-{int(dia):02d}",
        "paginas": paginas,
        "referencia": referencia,
        "resumen": resumen,
    }


CLAUSULAS = (
    clausula(
        "Industria química",
        "XXI Convenio colectivo general de la industria química (código de convenio núm. 99004235011981; BOE núm. "
        "41, de 17.2.2025)",
        ["Artículo 10. Nuevas tecnologías e inteligencia artificial"],
        [57, 58],
        "Información y consulta sobre la implantación de tecnologías e IA, formación para nuevas funciones, evaluación "
        "de efectos y control humano.",
    ),
    clausula(
        "Banca",
        "XXV Convenio colectivo del sector de la banca (código de convenio núm. 99000585011981; BOE núm. 1, de "
        "1.1.2025)",
        ["Artículo 80. Derechos digitales"],
        [58, 59],
        "Formación en competencias digitales (apartado 4) e intervención humana e información a la representación "
        "sobre decisiones automatizadas (apartado 5).",
    ),
    clausula(
        "Establecimientos financieros de crédito",
        "Convenio colectivo para los establecimientos financieros de crédito (código de convenio núm. "
        "99001945011981; BOE núm. 175, de 24.7.2023)",
        ["Artículo 35. Derechos digitales"],
        [59, 60],
        "Educación digital e información sobre la lógica, los datos y los resultados de los sistemas automatizados.",
    ),
    clausula(
        "Mediación de seguros privados",
        "Convenio colectivo de empresas de mediación de seguros privados (antes agentes y corredores de seguros) "
        "(código de convenio núm. 99000165011987; BOE núm. 273, de 15.11.2023)",
        ["Artículo 12. Transformación digital", "Artículo 15. Uso de la inteligencia artificial en las relaciones"],
        [60, 61],
        "Formación ante la transformación digital y principios de transparencia, control humano y no discriminación "
        "en el uso de la IA.",
    ),
    clausula(
        "Construcción",
        "VII Convenio colectivo general del sector de la construcción (código de convenio núm. 99005585011900; BOE "
        "núm. 228, de 23.9.2023)",
        ["Artículo 31. Ordenación del trabajo"],
        [61, 62],
        "Protección de datos, proporcionalidad e información sobre las tecnologías de control laboral.",
    ),
    clausula(
        "Corcho",
        "IX Convenio colectivo estatal del corcho (BOE núm. 214, de 7.9.2023)",
        ["Artículo 108. La transformación digital"],
        [62],
        "Información previa a la representación sobre la transformación digital y sus efectos en el empleo y la "
        "organización.",
    ),
    clausula(
        "Grandes almacenes",
        "Convenio colectivo del sector de grandes almacenes 2023-2026 (código de convenio núm. 99002405011982; BOE "
        "núm. 137, de 9.6.2023)",
        ["Artículo 27 bis. Desconexión digital"],
        [62, 63],
        "Formación y sensibilización sobre la desconexión y el uso de las tecnologías de comunicación.",
    ),
    clausula(
        "Hostelería y turismo de Cataluña",
        "Convenio colectivo interprovincial del sector de la industria de hostelería y turismo de Cataluña (código de "
        "convenio núm. 79000275011992; DOGC núm. 8827, de 5.1.2023)",
        ["Disposición adicional 2a"],
        [63, 64],
        "Garantías y deber de información sobre las tecnologías de control en el trabajo.",
    ),
    clausula(
        "Metal",
        "IV Convenio colectivo estatal de la industria, las nuevas tecnologías y los servicios del sector del metal "
        "(código de convenio núm. 99003435011900), BOE núm. 10, de 12.1.2022)",
        ["Artículo 117. La transformación digital", "Artículo 122. Disposiciones comunes"],
        [64, 65],
        "Información sobre la transformación digital y garantías comunes de los derechos digitales.",
    ),
)

# Las dos cláusulas cuyo convenio está en la captura, con lo que debe decir su texto del BOE.
EN_EL_BOE = {
    "Industria química": ("BOE-A-2025-3083", ["Artículo 10. Nuevas Tecnologías e inteligencia artificial."]),
    "Banca": ("BOE-A-2025-47", ["Artículo 80. Derechos digitales.", "4. Derecho a la educación digital."]),
}


def bloques_de_articulos(contenido: bytes) -> dict[int, tuple[str, list[str]]]:
    """Cada artículo del texto consolidado del BOE: su bloque (el ancla de su enlace) y sus párrafos, sin las notas.

    El texto de un artículo va de su título al bloque siguiente; las notas de modificación del BOE («Se añade…»,
    «Téngase en cuenta…») no son texto del artículo y se quitan.

    Returns:
        {número de artículo: (ancla del bloque, párrafos)}.
    """
    articulos: dict[int, tuple[str, list[str]]] = {}
    bloque, numero, lineas = "", None, []
    for linea in [*boe.texto_de_html(contenido), "[Bloque 0: #fin]"]:
        marca = re.fullmatch(r"\[Bloque \d+: #([\w-]+)\]", linea)
        if marca:
            if numero is not None:
                articulos[numero] = (bloque, lineas)
            bloque, numero, lineas = marca.group(1), None, []
            continue
        titulo = re.match(r"Artículo (\d+)\. ", linea)
        if titulo and numero is None and not lineas:
            numero = int(titulo.group(1))
        if not re.match(r"(Se (añade|modifica|suprime|redacta)|Téngase en cuenta|Subir$|Jurisprudencia$)", linea):
            lineas.append(linea)
    return articulos


def equivalencia(norma: str) -> Callable[[bytes, bytes], bool]:
    """Si dos copias del texto consolidado de una norma dicen lo mismo en los artículos que se citan de ella.

    La página del BOE cambia de bytes de una consulta a otra sin que cambie su texto: si la copia nueva dice lo mismo en
    los artículos citados y tiene la misma fecha de actualización, la registrada se conserva sin que nadie lo decida;
    si no, el cambio lo revisa una persona (--aceptar-cambio).

    Args:
        norma: El identificador BOE de la norma.

    Returns:
        La comparación entre la copia registrada y la nueva: True si dicen lo mismo.
    """
    numeros = {cita["articulo"] for cita in CITADAS if cita["norma"] == norma}

    def equivalentes(previo: bytes, nuevo: bytes) -> bool:
        antes, despues = bloques_de_articulos(previo), bloques_de_articulos(nuevo)
        mismos = all(numero in antes and numero in despues and antes[numero] == despues[numero] for numero in numeros)
        return mismos and version_consolidada(previo) == version_consolidada(nuevo)

    return equivalentes


def version_consolidada(contenido: bytes) -> str:
    """La fecha de la última actualización publicada del texto consolidado, en ISO (AAAA-MM-DD).

    Returns:
        La fecha, en ISO (AAAA-MM-DD).
    """
    fecha = re.search(
        r"Última actualización publicada el (\d{2})/(\d{2})/(\d{4})", " ".join(boe.texto_de_html(contenido))
    )
    exigir(fecha is not None, "el texto consolidado no dice su última actualización")
    dia, mes, anio = fecha.groups()
    return f"{anio}-{mes}-{dia}"


def citas_comprobadas(normas: dict[str, bytes], dia: str) -> list[dict[str, Any]]:
    """Las citas con su enlace al artículo y la fecha de su versión, solo si cada fragmento está letra a letra.

    Returns:
        Las citas, cada una con su enlace y la fecha de su versión.
    """
    citas = []
    for cita in CITADAS:
        exigir(len(cita["fragmentos"]) <= MAX_FRAGMENTOS, f"{cita['id']}: más de {MAX_FRAGMENTOS} fragmentos")
        exigir(cita["norma"] in normas, f"falta el texto consolidado de {cita['norma']}")
        articulos = bloques_de_articulos(normas[cita["norma"]])
        exigir(cita["articulo"] in articulos, f"{cita['id']}: el artículo no está en el texto consolidado")
        bloque, parrafos = articulos[cita["articulo"]]
        texto = " ".join(parrafos)
        for fragmento in cita["fragmentos"]:
            # Solo las citas de LETRAS_ENTERAS pueden pasar de MAX_CARACTERES, y solo si son su párrafo completo.
            entera = cita["id"] in LETRAS_ENTERAS and LETRAS_ENTERAS[cita["id"]] + fragmento in parrafos
            exigir(len(fragmento) <= MAX_CARACTERES or entera, f"{cita['id']}: un fragmento largo que no es una letra")
            exigir(fragmento in texto, f"{cita['id']}: «{fragmento[:40]}…» no está en su artículo")
        citas.append(
            {
                "id": cita["id"],
                "fuente": cita["fuente"],
                "enlace": f"https://www.boe.es/buscar/act.php?id={cita['norma']}#{bloque}",
                "fragmentos": list(cita["fragmentos"]),
                "version_consolidada": version_consolidada(normas[cita["norma"]]),
                "consultado": dia,
            }
        )
    return citas


def texto_de_pagina(texto: str) -> str:
    """El texto de una página del PDF, con los espacios normalizados y sin los glifos sueltos de sus viñetas.

    Las viñetas y los iconos del documento salen de la extracción como caracteres de otras escrituras (࡟, ჿ, ￼):
    se quitan para que un pasaje que cruza una viñeta o un salto de línea se lea seguido.

    Returns:
        El texto de la página.
    """
    limpio = "".join(
        letra if ord(letra) < FIN_DEL_LATIN or ord(letra) in PUNTUACION_GENERAL else " " for letra in texto
    )
    return " ".join(limpio.split())


def recomendaciones_comprobadas(paginas: dict[int, str]) -> list[dict[str, Any]]:
    """Los puntos del resumen del CRL, solo si cada pasaje en que se apoyan está en su página.

    Returns:
        Los puntos del resumen, cada uno con su página.
    """
    for punto in RECOMENDACIONES:
        for ancla in punto["anclas"]:
            exigir(ancla in paginas.get(punto["pagina"], ""), f"{punto['id']}: «{ancla[:40]}…» no está en su página")
    return deepcopy(list(RECOMENDACIONES))


def clausulas_comprobadas(paginas: dict[int, str], convenios: dict[str, bytes]) -> list[dict[str, Any]]:
    """Las nueve cláusulas, si su referencia y sus artículos están en sus páginas y, si hay texto del BOE, en él.

    Returns:
        Las cláusulas comprobadas.
    """
    # EN_EL_BOE se indexa por el rótulo del sector de CLAUSULAS: uno que no casa dejaría su cláusula sin comprobar.
    sin_clausula = sorted(set(EN_EL_BOE) - {registro["sector"] for registro in CLAUSULAS})
    exigir(not sin_clausula, f"sectores de EN_EL_BOE sin cláusula en CLAUSULAS: {sin_clausula}")
    registros = []
    for registro in CLAUSULAS:
        texto = " ".join(paginas.get(pagina, "") for pagina in registro["paginas"])
        for pasaje in [registro["referencia"], *registro["articulos"]]:
            exigir(pasaje in texto, f"{registro['sector']}: «{pasaje[:40]}…» no está en sus páginas")
        boe_id, lineas = EN_EL_BOE.get(registro["sector"], (None, []))
        if boe_id:
            exigir(boe_id in convenios, f"{registro['sector']}: falta el convenio {boe_id}")
            oficial = " ".join(boe.texto_de_html(convenios[boe_id]))
            exigir(boe_id in oficial, f"{registro['sector']}: el texto no es el de {boe_id}")
            exigir(all(linea in oficial for linea in lineas), f"{registro['sector']}: su artículo no está en el BOE")
        registros.append(
            {**deepcopy(registro), "enlace": f"https://www.boe.es/diario_boe/txt.php?id={boe_id}" if boe_id else None}
        )
    return registros
