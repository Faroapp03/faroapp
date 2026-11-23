"""Citilab: los cursos de su web, como hechos con enlace a su ficha oficial.

Citilab (Fundació pel Foment de la Societat del Coneixement, Cornellà de Llobregat) publica sus formaciones en su web,
un WordPress con API pública: `descargar` lee una vez por ejecución las fichas de formación y los dos vocabularios que
las clasifican (a quién se dirigen y de qué tratan), con una pausa entre peticiones y el agente de usuario común. Su
robots.txt y sus condiciones se revisaron el 06/10/2026: no había prohibición y se autorizaba usar los contenidos
«con fines informativos y de servicio, siempre que se cite o se haga referencia a la fuente». La copia se queda en
var/actualizacion/originales/: el paquete público solo guarda los hechos que se sacan de ella.

`preparar` saca de cada ficha solo hechos: título, a quién se dirige, modalidad, requisitos, horas, horario, fechas,
coste y lugar, leídos de las secciones del texto («A QUI S'ADREÇA?», «DURADA I HORARI», «COST», «LLOC»…). Lo que no se
puede leer con seguridad queda en `None`: el informe lo dice como «consúltalo en Citilab» y nunca lo inventa. No se
guardan descripciones, objetivos, imágenes ni logos. Solo pasan las fichas en catalán (las de castellano son de 2017)
que admiten a personas adultas; las demás quedan en el resumen con su motivo. `validar` lo comprueba. Python estándar.

Uso: python3 -m plataforma_datos.cursos.fuentes.citilab.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import html
import re
import sys
from datetime import date
from typing import Any, NamedTuple
from urllib.parse import urlsplit

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    controles_de_huella,
    guardar_json,
    hoy_utc,
    leer_json,
    procedencia,
)
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, Controles, exigir
from plataforma_datos.comun.periodos import MESES_CA
from plataforma_datos.cursos.fuentes.citilab import lectura
from plataforma_datos.cursos.fuentes.citilab.constantes import CONSULTAS, FUENTE, LICENCIA, VOCABULARIOS
from plataforma_datos.cursos.fuentes.citilab.lectura_de_fechas import (
    control_de_fechas,
    fichas_sin_confirmar,
    guardar_pendientes,
    revision_de_fechas,
)
from plataforma_datos.cursos.fuentes.citilab.paginacion import descargar_recurso, leer_coleccion
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
CURSOS = PREPARADO / "cursos.json"
# Página pública con todas las formaciones: donde la persona ve lo que el informe no muestra.
LISTADO = "https://www.citilab.eu/formacio-tecnologia-informacio-comunicacio/"
NOMBRE_FUENTE = "Citilab · fichas de formación de citilab.eu"
CITA = "Fuente: Citilab (citilab.eu)"
# Públicos que admiten a personas adultas. Los demás (8–12, 12–16, +6, familias, escuelas…) son de infancia y juventud.
PUBLICOS_ADULTOS = frozenset(
    {
        "adults",
        "persones-grans",
        "16-anys",
        "12-anys",
        "public-en-general-12-anys",
        "persones-en-situacio-datur",
        "docents",
    }
)
# El término de un vocabulario que no está en la copia se escribe con este prefijo y el control de validar lo detecta.
PREFIJO_DESCONOCIDO = "desconocido-"
MESES = {nombre: numero for numero, nombre in enumerate(MESES_CA, start=1)}
DIAS = {"dilluns": 1, "dimarts": 2, "dimecres": 3, "dijous": 4, "divendres": 5, "dissabte": 6, "diumenge": 7}
HORAS_POR_DIA = 24
MINUTOS_POR_HORA = 60
# La sección «LLOC» tiene esta forma: nombre del lugar, dirección y, en la tercera línea, municipio y código postal.
LINEAS_DEL_LUGAR = 3
LINEA_DEL_MUNICIPIO = LINEAS_DEL_LUGAR - 1
# Inicio y fin de un curso sin «Inici» ni «Final»: la primera y la última de al menos dos fechas de sesión.
MIN_FECHAS_DE_SESIONES = 2
FECHA = re.compile(r"(\d{1,2})\s+(?:de\s+|d')(" + "|".join(map(re.escape, MESES)) + r")\s+de\s+(\d{4})")
# Días que comparten mes y año con la fecha que los sigue: «del 3 al 5 de març de 2026», «3, 10 i 17 de març de 2026».
# Solo cuando la redacción dice sin duda que son días: la cadena empieza la línea o la introduce «del», «els dies»,
# «dies», «sessions:» o «entre» (o su forma en castellano) y termina en «i», «al» o «a». Así no se leen como días un
# grupo, una sesión, unas plazas ni una franja horaria («de 10 a 12 i 3 de març»): ante la duda, solo la fecha completa.
DIAS_PREVIOS = re.compile(
    r"(?:^|\b(?:del|els dies|dies|sessions:|entre|los días|días|sesiones:)\s+)"
    r"((?:\d{1,2}\s*,\s*)*\d{1,2}\s+(?:i|y|al|a)\s+)$"
)
FRANJA = re.compile(r"\bd(?:e\s+|')(\d{1,2})(?::(\d{2}))?\s*h?\s+a\s+(\d{1,2})(?::(\d{2}))?")
DIA = re.compile(r"\b(" + "|".join(map(re.escape, DIAS)) + r")\b")
HORAS = re.compile(r"^(\d+(?:[.,]\d+)?)\s*hores")
SESIONES = re.compile(r"^\d+(?:[.,]\d+)?\s*hores[^\d]*(\d+)\s*sessions")
PRECIO = re.compile(r"(\d+(?:[.,]\d+)?)\s*euros")
DESCUENTO_PARO = re.compile(r"(\d+)\s*% de descompte per a adults a l'atur")
CODIGO_POSTAL = re.compile(r"\b(\d{5})\b")
# Las secciones de la ficha que se leen; las demás (descripción, objetivos, programa) no se guardan.
SECCIONES = {
    "A QUI S'ADREÇA?": "publico",
    "MODALITAT": "modalidad",
    "PRE-REQUISITS": "requisitos",
    "REQUISITS": "requisitos",
    "DURADA I HORARI": "duracion",
    "DIA I HORARI": "duracion",
    "COST": "coste",
    "LLOC": "lugar",
}
# Encabezados que cierran una sección sin abrir otra que se lea.
OTRAS_SECCIONES = {
    "DESCRIPCIÓ",
    "INFORMACIÓ ÚTIL",
    "OBJECTIU",
    "OBJECTIUS",
    "OBJECTIUS I METODOLOGIA",
    "CONTACTE",
    "PROGRAMA",
}


# ---------------------------------------------------------------------------------------------------------------------
# Lectura de la ficha
# ---------------------------------------------------------------------------------------------------------------------


def normalizar(texto: str) -> str:
    """Una línea de texto: apóstrofos rectos y espacios simples (`split()` junta también los espacios de no separación).

    Returns:
        La línea normalizada.
    """
    return " ".join(texto.replace("’", "'").split())


def lineas(contenido_html: str) -> list[str]:
    """El texto de la ficha, línea a línea, sin estilos, iconos ni etiquetas.

    Returns:
        Las líneas no vacías del texto, normalizadas.
    """
    sin_estilos = re.sub(r"<(style|script|svg)\b.*?</\1>", "", contenido_html, flags=re.S)
    con_saltos = re.sub(r"<br\s*/?>|</?(?:p|h[1-6]|div|li|ul|ol)\b[^>]*>", "\n", sin_estilos)
    texto = html.unescape(re.sub(r"<[^>]+>", "", con_saltos))
    return [linea for linea in (normalizar(bruta) for bruta in texto.split("\n")) if linea]


def secciones(lineas_de_la_ficha: list[str]) -> dict[str, list[str]]:
    """Las líneas de cada sección que se lee, por su nombre en SECCIONES.

    Returns:
        Por nombre de sección, sus líneas, en el orden de la ficha.
    """
    leidas: dict[str, list[str]] = {}
    actual = None
    for linea in lineas_de_la_ficha:
        if linea in SECCIONES:
            actual = SECCIONES[linea]
            leidas.setdefault(actual, [])
        elif linea in OTRAS_SECCIONES:
            actual = None
        elif actual:
            leidas[actual].append(linea)
    return leidas


def fecha(linea: str) -> str | None:
    """La primera fecha en catalán de una línea («1 d'octubre de 2026»), en AAAA-MM-DD; None si no hay.

    Returns:
        La fecha AAAA-MM-DD, o None si la línea no trae una fecha posible.
    """
    encontrada = FECHA.search(linea.lower())
    if not encontrada:
        return None
    dia, mes, anio = encontrada.groups()
    return _fecha_iso(anio, mes, dia)


def _fecha_iso(anio: str, mes: str, dia: str) -> str | None:
    """Una fecha leída en AAAA-MM-DD.

    Returns:
        La fecha, o None si es imposible («31 de febrer»): no se inventa, la ficha se queda sin esa fecha.
    """
    try:
        return date(int(anio), MESES[mes], int(dia)).isoformat()
    except ValueError:
        return None


def fechas_de_linea(linea: str) -> list[str]:
    """Todas las fechas de una línea, también los días de un rango o de una lista que comparten mes y año.

    Returns:
        Las fechas AAAA-MM-DD posibles, en el orden de la línea.
    """
    texto, leidas, desde = linea.lower(), [], 0
    for encontrada in FECHA.finditer(texto):
        dia, mes, anio = encontrada.groups()
        # `^` solo vale al principio de la línea, no tras la fecha anterior: la búsqueda empieza en `desde`.
        previos = DIAS_PREVIOS.search(texto, desde, encontrada.start())
        for numero in [*(re.findall(r"\d{1,2}", previos.group(1)) if previos else []), dia]:
            leida = _fecha_iso(anio, mes, numero)
            if leida:
                leidas.append(leida)
        desde = encontrada.end()
    return leidas


def fechas(duracion: list[str]) -> tuple[str | None, str | None]:
    """Inicio y fin: los que dicen «Inici» y «Final» o, si no, la primera y la última fecha de las sesiones.

    Returns:
        La fecha de inicio y la de fin (cada una None si no consta).
    """
    inicio = next((fecha(linea) for linea in duracion if linea.lower().startswith("inici")), None)
    fin = next((fecha(linea) for linea in duracion if linea.lower().startswith("final")), None)
    if inicio or fin:
        return inicio, fin
    todas = sorted(leida for linea in duracion for leida in fechas_de_linea(linea))
    if len(todas) >= MIN_FECHAS_DE_SESIONES:
        return todas[0], todas[-1]
    return (todas[0] if todas else None), None


def _hora(horas: str, minutos: str | None) -> str | None:
    """Una hora en HH:MM.

    Returns:
        La hora con dos cifras y sus minutos («09:00»), o None si queda fuera de un día.
    """
    if int(horas) >= HORAS_POR_DIA or int(minutos or 0) >= MINUTOS_POR_HORA:
        return None
    return f"{int(horas):02d}:{minutos or '00'}"


def _horas_de_la_franja(rango: re.Match[str]) -> tuple[str, str] | None:
    """Lee dos horas válidas en orden, o deja la franja sin dato.

    Returns:
        El inicio y el fin HH:MM, o None si las horas son imposibles o no avanzan en el mismo día.
    """
    desde_h, desde_m, hasta_h, hasta_m = rango.groups()
    desde, hasta = _hora(desde_h, desde_m), _hora(hasta_h, hasta_m)
    return (desde, hasta) if desde is not None and hasta is not None and desde < hasta else None


def horario(duracion: list[str]) -> list[dict[str, Any]] | None:
    """Las franjas semanales: días (1 = lunes), desde, hasta y si es a distancia. None si alguna no se puede leer.

    Una línea con días y sin franja pasa sus días a las franjas de las líneas siguientes («Cada divendres:» y debajo
    «de 10:00 a 12:00 hores»). Las líneas de fechas, horas totales o sesiones no son franjas.

    Returns:
        Las franjas, o None si no hay ninguna, alguna no dice sus días o tiene horas imposibles o invertidas.
    """
    franjas: list[dict[str, Any]] = []
    dias_pendientes: list[int] = []
    for linea in (bruta.lower() for bruta in duracion):
        if FECHA.search(linea):
            continue
        dias = [DIAS[dia] for dia in DIA.findall(linea)]
        rango = FRANJA.search(linea)
        if dias and not rango:
            dias_pendientes = dias
            continue
        if not rango:
            continue
        dias = dias or dias_pendientes
        if not dias:
            return None
        horas = _horas_de_la_franja(rango)
        if horas is None:
            return None
        desde, hasta = horas
        franjas.append(
            {
                "dias": sorted(set(dias)),
                "desde": desde,
                "hasta": hasta,
                "a_distancia": "virtual" in linea or "en línia" in linea,
            }
        )
    return franjas or None


def numero(patron: re.Pattern[str], lineas_de_la_seccion: list[str]) -> float | None:
    """El primer número que sigue el patrón en una sección («32 hores»); None si no hay.

    Args:
        patron: El patrón, con el número en su primer grupo.
        lineas_de_la_seccion: Las líneas de la sección.

    Returns:
        El número capturado, o None si ninguna línea sigue el patrón.
    """
    for linea in lineas_de_la_seccion:
        encontrado = patron.search(linea.lower())
        if encontrado:
            return float(encontrado.group(1).replace(",", "."))
    return None


def coste(lineas_de_coste: list[str]) -> dict[str, Any]:
    """Si es gratuito, su precio, si pide el carnet de Citilaber y el descuento por estar en paro, si lo dice.

    Returns:
        Si es gratuito (None si no se sabe), el precio en euros, el carnet de Citilaber y el descuento por paro.
    """
    primera = lineas_de_coste[0].lower() if lineas_de_coste else ""
    precio = numero(PRECIO, lineas_de_coste[:1])
    # Gratuito si lo dice la primera línea; de pago si da un precio; si no dice ninguna de las dos, no se sabe.
    gratuito: bool | None = None
    if primera.startswith("gratuït"):
        gratuito = True
    elif precio is not None:
        gratuito = False
    descuento = numero(DESCUENTO_PARO, lineas_de_coste)
    return {
        "gratuito": gratuito,
        "precio_eur": precio,
        "carnet_citilaber": any("carnet de citilaber" in linea.lower() for linea in lineas_de_coste),
        "descuento_paro_pct": descuento,
    }


def lugar(lineas_del_lugar: list[str]) -> dict[str, str] | None:
    """Nombre, dirección, municipio y código postal, si la sección tiene esa forma; si no, None.

    Returns:
        El nombre, la dirección, el municipio y el código postal, o None si la sección no tiene esa forma.
    """
    if len(lineas_del_lugar) < LINEAS_DEL_LUGAR:
        return None
    postal = CODIGO_POSTAL.search(lineas_del_lugar[LINEA_DEL_MUNICIPIO])
    if not postal:
        return None
    return {
        "nombre": lineas_del_lugar[0],
        "direccion": lineas_del_lugar[1],
        "municipio": lineas_del_lugar[LINEA_DEL_MUNICIPIO].split(",")[0].strip(),
        "codigo_postal": postal.group(1),
    }


def modalidad(lineas_de_modalidad: list[str]) -> str | None:
    """«presencial» o «en-linea» (con o sin apoyo presencial); None si dice otra cosa.

    Returns:
        «presencial», «en-linea» o None.
    """
    primera = lineas_de_modalidad[0].lower() if lineas_de_modalidad else ""
    if primera.startswith("presencial"):
        return "presencial"
    return "en-linea" if primera.startswith("en línia") else None


def requisitos(lineas_de_requisitos: list[str]) -> str | None:
    """«ninguno», «prueba» (una prueba o un test de acceso) u «otros»; None si la ficha no lo dice.

    Returns:
        «ninguno», «prueba», «otros» o None.
    """
    if not lineas_de_requisitos:
        return None
    texto = " ".join(lineas_de_requisitos).lower()
    # «Cap» («ninguno») como palabra entera: «Capacitat…» es un requisito.
    if re.match(r"cap\b", texto):
        return "ninguno"
    return "prueba" if re.search(r"\b(prova|test)\b", texto) else "otros"


def trata_la_ia(titulo: str, lineas_de_la_ficha: list[str]) -> bool:
    """Si el título o el texto de la ficha hablan de inteligencia artificial («IA» en mayúsculas, como palabra).

    Returns:
        True si habla de inteligencia artificial.
    """
    texto = " ".join([titulo, *lineas_de_la_ficha])
    return "intel·ligència artificial" in texto.lower() or bool(re.search(r"\bIA\b", texto))


def _comprobar_forma(ficha: object) -> None:
    """Exige que una ficha de la API tenga los campos que se leen, con su tipo.

    Args:
        ficha: Una ficha tal como llega de la API (JSON ya analizado).

    Raises:
        FormatoInesperado: Si no es un objeto o le falta un campo o tiene otro tipo; el mensaje nombra la ficha.
    """
    exigir(isinstance(ficha, dict), f"{FUENTE}: una ficha de la API no es un objeto: {str(ficha)[:80]}")
    nombre = f"{FUENTE}: ficha {ficha.get('id')!r}"
    exigir(type(ficha.get("id")) is int and ficha["id"] > 0, f"{nombre}: «id» no es un entero positivo")
    for campo in ("title", "content"):
        exigir(
            isinstance(ficha.get(campo), dict) and isinstance(ficha[campo].get("rendered"), str),
            f"{nombre}: «{campo}.rendered» no es un texto",
        )
    for campo in ("link", "modified"):
        exigir(isinstance(ficha.get(campo), str), f"{nombre}: «{campo}» no es un texto")
    for campo in ("public", "tipus-formacio"):
        exigir(isinstance(ficha.get(campo), list), f"{nombre}: «{campo}» no es una lista")
        exigir(
            all(type(termino) is int and termino > 0 for termino in ficha[campo]),
            f"{nombre}: «{campo}» contiene un término que no es un entero positivo",
        )


def hechos(ficha: dict[str, Any], vocabularios: dict[str, dict[int, str]]) -> dict[str, Any]:
    """Los hechos de una ficha de la API, sin su texto.

    Returns:
        Los hechos del curso: identificación, público, temas, modalidad, requisitos, horas, fechas, horario, coste y
        lugar.
    """
    _comprobar_forma(ficha)
    # El título, tal como lo publica Citilab (con su apóstrofo tipográfico): solo se juntan los espacios.
    titulo = " ".join(html.unescape(ficha["title"]["rendered"]).split())
    texto = lineas(ficha["content"]["rendered"])
    leidas = secciones(texto)
    duracion = leidas.get("duracion", [])
    inicio, fin = fechas(duracion)
    franjas = horario(duracion)
    return {
        "id": ficha["id"],
        "titulo": titulo,
        "enlace": ficha["link"],
        "modificado": ficha["modified"][:10],
        "publico": sorted(
            vocabularios["public"].get(termino, f"{PREFIJO_DESCONOCIDO}{termino}") for termino in ficha["public"]
        ),
        "temas": sorted(
            vocabularios["tipus-formacio"].get(tema, f"{PREFIJO_DESCONOCIDO}{tema}") for tema in ficha["tipus-formacio"]
        ),
        "trata_ia": trata_la_ia(titulo, texto),
        "modalidad": modalidad(leidas.get("modalidad", [])),
        "requisitos": requisitos(leidas.get("requisitos", [])),
        "horas": numero(HORAS, duracion),
        "sesiones": numero(SESIONES, duracion),
        "inicio": inicio,
        "fin": fin,
        "horario": franjas,
        "periodico": franjas is not None and inicio is None and fin is None,
        "coste": coste(leidas.get("coste", [])),
        "lugar": lugar(leidas.get("lugar", [])),
    }


def _duracion(ficha: dict[str, Any]) -> list[str]:
    """Las líneas de la sección de duración y horario de una ficha, de donde salen sus fechas.

    Returns:
        Las líneas de la sección, o ninguna si la ficha no la tiene.
    """
    return secciones(lineas(ficha["content"]["rendered"])).get("duracion", [])


def motivo_de_exclusion(curso: dict[str, Any]) -> str | None:
    """Por qué una ficha no se usa: en castellano o solo para infancia y juventud; None si se usa.

    Returns:
        «en-castellano», «solo-infancia-y-juventud» o None si la ficha se usa.
    """
    if urlsplit(curso["enlace"]).path.startswith("/es/"):
        return "en-castellano"
    return "solo-infancia-y-juventud" if PUBLICOS_ADULTOS.isdisjoint(curso["publico"]) else None


# ---------------------------------------------------------------------------------------------------------------------
# Etapas
# ---------------------------------------------------------------------------------------------------------------------


def calendario_de_la_ficha(ficha: dict[str, Any]) -> lectura.Calendario:
    """Las líneas de duración de una ficha y las fechas de inicio y de fin que se leen de ellas.

    Returns:
        Las líneas, el inicio y el fin (cada fecha None si no consta).
    """
    duracion = _duracion(ficha)
    return duracion, *fechas(duracion)


def descargar(aceptar_cambio: bool = False, hoy: date | None = None) -> lectura.Resultado:
    """Descarga la copia del día, página a página y con una pausa entre peticiones, y registra su procedencia.

    Con la copia ya guardada emite la lectura de sus fichas; si no se puede emitir, el resultado lo dice y nada más
    cambia. Una página caída detiene la descarga antes de emitir: sin copia entera no hay lectura.

    Returns:
        La lectura emitida y los problemas que impidieron emitirla, si los hubo.
    """
    dia = (hoy or hoy_utc()).isoformat()
    registros: list[dict[str, Any]] = []
    totales: dict[str, dict[str, int]] = {}
    for recurso, campos, titulo in CONSULTAS:
        del_recurso, totales[recurso] = descargar_recurso(ORIGINAL, (recurso, campos, titulo), dia, aceptar_cambio)
        registros += del_recurso
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": NOMBRE_FUENTE,
            "licencia": LICENCIA,
            "cita": CITA,
            "copia": dia,
            "totales": totales,
            "archivos": registros,
        },
    )
    return lectura.emitir(ORIGINAL, registros, totales, calendario_de_la_ficha)


class CopiaDeCitilab(NamedTuple):
    """Una copia leída: su fecha, sus fichas y los vocabularios (id → slug) por recurso."""

    dia: str
    fichas: list[dict[str, Any]]
    vocabularios: dict[str, dict[int, str]]


def _leer_vocabulario(registrada: dict[str, Any], recurso: str) -> dict[int, str]:
    """Lee un vocabulario con ids únicos y slugs de texto.

    Returns:
        El mapa id → slug sin conversiones ni términos sobrescritos.
    """
    terminos = leer_coleccion(registrada, recurso)
    contexto = f"{FUENTE}: vocabulario «{recurso}»"
    exigir(isinstance(terminos, list), f"{contexto}: no es una lista")
    vocabulario: dict[int, str] = {}
    for termino in terminos:
        exigir(isinstance(termino, dict), f"{contexto}: un término no es un objeto")
        identificador, slug = termino.get("id"), termino.get("slug")
        exigir(type(identificador) is int and identificador > 0, f"{contexto}: «id» no es un entero positivo")
        exigir(isinstance(slug, str) and bool(slug), f"{contexto}: «slug» no es un texto no vacío")
        exigir(identificador not in vocabulario, f"{contexto}: id {identificador} repetido")
        vocabulario[identificador] = slug
    return vocabulario


def leer_copia() -> CopiaDeCitilab:
    """La fecha de la copia más reciente, sus fichas y sus vocabularios (id → slug), comprobados con su huella.

    Returns:
        La fecha de la copia, sus fichas y, por recurso, el vocabulario id → slug.
    """
    registrada = procedencia(FUENTE)
    fichas = leer_coleccion(registrada, CONSULTAS[0][0])
    vocabularios = {recurso: _leer_vocabulario(registrada, recurso) for recurso in VOCABULARIOS}
    return CopiaDeCitilab(registrada["copia"], fichas, vocabularios)


def _exigir_identificadores_unicos(cursos: list[dict[str, Any]]) -> None:
    """Rechaza una copia con identidades de ficha repetidas, sin descartar ni fusionar cursos."""
    exigir(len({curso["id"] for curso in cursos}) == len(cursos), f"{FUENTE}: identificadores de ficha repetidos")


def preparar() -> None:
    """Saca los hechos de cada ficha y los guarda con el motivo de las que no se usan."""
    dia, fichas, vocabularios = leer_copia()
    cursos = sorted((hechos(ficha, vocabularios) for ficha in fichas), key=lambda curso: curso["id"])
    _exigir_identificadores_unicos(cursos)
    for curso in cursos:
        curso["excluido"] = motivo_de_exclusion(curso)
    leidas = {curso["id"]: (curso["inicio"], curso["fin"]) for curso in cursos}
    revisiones = [
        revision_de_fechas(ficha["id"], ficha["content"]["rendered"], _duracion(ficha), *leidas[ficha["id"]])
        for ficha in sorted(fichas, key=lambda ficha: ficha["id"])
    ]
    guardar_json(CURSOS, {"copia": dia, "listado": LISTADO, "cursos": cursos, "lectura_de_fechas": revisiones})
    usados = [curso for curso in cursos if not curso["excluido"]]
    print(f"Copia del {dia}: {len(fichas)} fichas, {len(usados)} para personas adultas en catalán")


def _controles(preparados: dict[str, Any]) -> Controles:
    """Los controles de la copia y de los hechos sacados de ella.

    Returns:
        Los controles, con su resultado.
    """
    cursos = preparados["cursos"]
    _exigir_identificadores_unicos(cursos)
    controles = Controles()
    registrada = procedencia(FUENTE)
    controles_de_huella(controles, ORIGINAL, registrada)
    usados = [curso for curso in cursos if not curso["excluido"]]
    controles.comprobar(preparados["copia"] == registrada["copia"], "los hechos son de la copia registrada")
    controles.comprobar(bool(usados), "al menos un curso para personas adultas")
    enlaces = [urlsplit(curso["enlace"]) for curso in cursos]
    controles.comprobar(
        all(enlace.scheme == "https" and enlace.hostname == "www.citilab.eu" for enlace in enlaces),
        "cada enlace es la ficha oficial en https://www.citilab.eu",
    )
    controles.comprobar(
        not any(
            termino.startswith(PREFIJO_DESCONOCIDO) for curso in cursos for termino in curso["publico"] + curso["temas"]
        ),
        "cada término de público y de tema está en su vocabulario",
    )
    controles.comprobar(
        all(curso["inicio"] is None or curso["fin"] is None or curso["inicio"] <= curso["fin"] for curso in usados),
        "ningún curso termina antes de empezar",
    )
    controles.comprobar(
        all(curso["coste"]["gratuito"] is not False or curso["coste"]["precio_eur"] is not None for curso in usados),
        "cada curso de pago dice su precio",
    )
    pendientes = fichas_sin_confirmar(preparados, {curso["id"] for curso in usados}, ORIGINAL)
    controles.comprobar(*control_de_fechas(pendientes))
    return controles


def validar() -> None:
    """Comprueba la copia y guarda su validación y, si se admite, los cursos que exporta el paquete."""
    preparados = leer_json(CURSOS)
    controles = _controles(preparados)
    usados = [
        {clave: valor for clave, valor in curso.items() if clave != "excluido"}
        for curso in preparados["cursos"]
        if not curso["excluido"]
    ]
    sin_dato = {
        campo: sum(1 for curso in usados if curso[campo] is None) for campo in ("inicio", "fin", "horario", "horas")
    }
    informe = {
        "estado": "Admitido" if controles.admitido else "Con errores",
        "comprobado_utc": ahora_utc(),
        "copia": preparados["copia"],
        "cobertura": {
            "fichas": len(preparados["cursos"]),
            "usadas": len(usados),
            "gratuitas": sum(1 for curso in usados if curso["coste"]["gratuito"] is True),
            "sin_dato": sin_dato,
            "excluidas": [
                {"id": curso["id"], "titulo": curso["titulo"], "motivo": curso["excluido"]}
                for curso in preparados["cursos"]
                if curso["excluido"]
            ],
        },
        "limites": "Las fechas, el horario y el precio salen del texto de cada ficha: lo que no se puede leer queda "
        "vacío y el informe remite a Citilab. Sin plazas ni enlace de inscripción. El estado que publica Citilab no se "
        "usa: el momento de cada curso sale de sus fechas y de la fecha del informe.",
        "controles": controles.lista,
    }
    conjunto = {"fuente": CITA, "copia": preparados["copia"], "listado": LISTADO, "cursos": usados}
    guardar_pendientes(ORIGINAL, fichas_sin_confirmar(preparados, {curso["id"] for curso in usados}, ORIGINAL))
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida de la orden: 0 si cada etapa termina bien.
    """
    etapas = {"preparar": preparar, "validar": validar}
    return principal_fuente_con_descarga(__doc__, descargar=descargar, preparacion_y_validacion=etapas, argumentos=argv)


if __name__ == "__main__":
    sys.exit(main())
