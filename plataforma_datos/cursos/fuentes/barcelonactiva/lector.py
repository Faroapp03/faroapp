"""Barcelona Activa: la ficha de cada ocupación en su Catàleg d'ocupacions y las formaciones de IA del Cibernàrium.

Dos piezas de un mismo organismo público (Ajuntament de Barcelona), las dos solo como enlace: su aviso legal autoriza
ver y descargar para uso personal y prohíbe reproducir. Por eso el conjunto no guarda ningún texto de sus fichas: de
cada ficha, el código y su identificador; de cada formación, el título (el nombre mínimo para el enlace), la fecha, la
modalidad y su identificador, nunca objetivos o temarios.

- Catàleg d'ocupacions: la página pública enlaza 1.734 fichas, cada una con el código ESCO que publica («1112.1 -
  Governador/a de banc central»). Una ocupación de Faro tiene enlace si su código es exactamente ese y ese código tiene
  una sola ficha: no se emparejan nombres. El informe enlaza la ficha en catalán, la única dirección comprobada.
- Cibernàrium: el censo diario de sus formaciones del ámbito de IA (censo_ia.py, filtro `scopeIds=22` del proveedor),
  cruzado con el censo completo admitido del canal cibernarium/. Solo un censo de IA completo con un censo del canal
  admitido y completo sustituye la salida; si no, se conserva la anterior y la validación dice por qué. Una actividad
  que falta se conserva hasta que acaba su calendario (`politica_vigencia_v3`). La evidencia de las páginas va en la
  validación. El enlace de cada una es el que publica su propia página (`/ficha-actividad?activityId=`). El motor
  muestra las próximas y, detrás, las actividades en línea ya iniciadas mientras el día del informe sea anterior al de
  fin.

Además, `validar` escribe en `var/actualizacion/revisiones/barcelonactiva/` el contraste de nombres catalanes de Faro
(capturas ya admitidas) con las denominacions de Barcelona Activa: una lista para revisar, que no llega al informe.

La copia del Catàleg d'ocupacions se guardó el 07/10/2026 y permanece inmutable. El canal operativo anidado
cibernarium/ actualiza el catálogo de cursos completo mediante la API pública y el mismo normalizador del robot; un
error se propaga. Python estándar.

Uso: python3 -m plataforma_datos.cursos.fuentes.barcelonactiva.lector {descargar,preparar,validar,todo}
"""

import html
import re
import sys
import unicodedata
from collections import Counter
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import plataforma_datos.comun.fuentes.catalan.lector as catalan
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    controles_de_huella,
    guardar_json,
    guardar_jsonl,
    leer_json,
    leer_jsonl,
    original,
)
from plataforma_datos.comun.fuentes.catalan.piezas.constantes_catalan import MAX_EJEMPLOS
from plataforma_datos.comun.nucleo import (
    ADMITIDO,
    ARCHIVO_DE_PROCEDENCIA,
    CON_ERRORES,
    DATOS,
    RAIZ,
    Controles,
    FormatoInesperado,
    exigir,
)
from plataforma_datos.cursos import operacion_fuente
from plataforma_datos.cursos.fuentes.barcelonactiva import censo_ia, edicion_ia
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "barcelonactiva"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# El Catàleg d'ocupacions es una copia del 07/10/2026; las formaciones salen del censo diario.
CONSULTA_CATALOGO = "2026-10-07"
CATALOGO = f"barcelonactiva-cataleg-ocupacions-{CONSULTA_CATALOGO}.html"
ZONA = ZoneInfo("Europe/Madrid")
# Lo que escribe preparar y lee validar.
FICHAS = PREPARADO / "fichas.jsonl"
ACTIVIDADES = PREPARADO / "cibernarium.json"
CAMPOS_ACTIVIDAD = ("id", "titulo", "inicio", "fin", "modalidad")
# Motivos de una salida parcial que escribe este lector (los de la página de filtros y las plazas, en sus módulos).
CANAL_SIN_ADMITIR = "censo-del-canal-sin-admitir-completo"
MOTIVOS = frozenset({censo_ia.CENSO_IA_PARCIAL, CANAL_SIN_ADMITIR})
# El contraste de nombres, aparte del producto.
REVISION = DATOS / "revisiones" / FUENTE / "nombres-catalan.json"

URL_FICHA = "https://treball.barcelonactiva.cat/ca/cataleg-ocupacions?idFicha="
URL_ACTIVIDAD = "https://cibernarium.barcelonactiva.cat/ficha-actividad?activityId="
# Un enlace del árbol del catálogo:
# «<a href="?idFicha=<uuid>" class="tree-node-label"><strong>1112.1 - Nombre</strong></a>».
FICHA = re.compile(
    r'href="\?idFicha=([0-9a-f-]{36})" class="tree-node-label"><strong>(\d{4}(?:\.\d+)+) - (.*?)</strong>'
)
FICHAS_PUBLICADAS = 1734
MODALIDADES = {"ONLINE": "en-linea", "PRESENCIAL": "presencial"}
# Los finales femeninos abreviados de una denominació («Director/a», «Treballador/ora»): fuera, queda la forma base.
FEMENINO_ABREVIADO = re.compile(r"/\w{1,4}\b")
# Los meses con que el Cibernàrium escribe sus fechas, siempre en inglés (no depende de la configuración regional).
MESES_EN_INGLES = {
    mes: numero
    for numero, mes in enumerate(
        ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"), start=1
    )
}
# Fecha civil publicada: la zona se comprueba, pero no se convierte a UTC.
FECHA_CIBERNARIUM = re.compile(
    r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([A-Z][a-z]{2}) ([0-9]{1,2}) "
    r"([0-9]{2}):([0-9]{2}):([0-9]{2}) (?:CET|CEST) ([0-9]{4})"
)


def fichas_del_catalogo(pagina: str) -> list[dict[str, str]]:
    """Cada ficha del árbol del catálogo, en su orden: código, identificador y denominació (solo para el contraste).

    Returns:
        Las fichas del catálogo, en su orden.
    """
    return [
        {"codigo": codigo, "id": ficha, "nombre": html.unescape(nombre).strip()}
        for ficha, codigo, nombre in FICHA.findall(pagina)
    ]


def fecha(valor: str) -> str:
    """«Thu Oct 08 10:00:00 CEST 2026» como «2026-10-08»: la zona horaria no cambia el día.

    Returns:
        La fecha en formato AAAA-MM-DD.

    Raises:
        FormatoInesperado: Si la fecha no tiene la forma publicada o no es válida.
    """
    exigir(isinstance(valor, str), "fecha inesperada del Cibernàrium: debe ser texto")
    partes = FECHA_CIBERNARIUM.fullmatch(valor)
    if partes is None:
        raise FormatoInesperado(f"fecha inesperada del Cibernàrium: {valor!r}")
    mes, dia, hora, minuto, segundo, anio = partes.groups()
    numero_mes = MESES_EN_INGLES.get(mes)
    exigir(numero_mes is not None, f"mes inesperado del Cibernàrium: {valor!r}")
    try:
        return datetime(int(anio), numero_mes or 1, int(dia), int(hora), int(minuto), int(segundo)).date().isoformat()
    except ValueError as error:
        raise FormatoInesperado(f"fecha inesperada del Cibernàrium: {valor!r}") from error


def actividad(fila: dict[str, Any]) -> dict[str, Any]:
    """Una formación del Cibernàrium con lo justo para enlazarla: título, fechas y modalidad.

    Returns:
        La formación con título, fechas y modalidad.
    """
    exigir(isinstance(fila, dict), "actividad del Cibernàrium: debe ser un objeto")
    for campo in ("activityId", "title", "beginDateTime", "endDateTime", "formationType"):
        exigir(campo in fila, f"actividad del Cibernàrium: falta {campo}")
    identificador = fila["activityId"]
    exigir(
        type(identificador) in (str, int) and re.fullmatch(r"[0-9]+", str(identificador)) is not None,
        f"activityId inesperado del Cibernàrium: {identificador!r}",
    )
    for campo in ("title", "beginDateTime", "endDateTime", "formationType"):
        exigir(isinstance(fila[campo], str), f"actividad del Cibernàrium: {campo} debe ser texto")
    exigir(fila["formationType"] in MODALIDADES, f"modalidad inesperada: {fila['formationType']!r}")
    return {
        "id": str(identificador),
        "titulo": " ".join(fila["title"].split()),
        "inicio": fecha(fila["beginDateTime"]),
        "fin": fecha(fila["endDateTime"]),
        "modalidad": MODALIDADES[fila["formationType"]],
    }


def normalizado(texto: str) -> str:
    """Minúsculas, apóstrofo recto y espacios simples: lo que no cuenta como diferencia de nombre.

    Returns:
        El texto normalizado.
    """
    compuesto = unicodedata.normalize("NFC", texto).replace("’", "'").lower()
    return " ".join(compuesto.split())


def coinciden(denominacio: str, nombre_faro: str) -> bool:
    """Si una denominació de Barcelona Activa y un nombre de Faro dicen lo mismo (el criterio está en `contraste`).

    Returns:
        Si ambos nombres coinciden una vez normalizados.
    """
    formas_barcelona_activa = {normalizado(denominacio), normalizado(FEMENINO_ABREVIADO.sub("", denominacio))}
    formas_faro = {normalizado(nombre_faro), *(normalizado(parte) for parte in nombre_faro.split("/"))}
    return bool(formas_barcelona_activa & formas_faro)


def nombres_de_faro() -> dict[str, str]:
    """El nombre catalán de cada ocupación ESCO de Faro, el mismo que lleva el paquete catalan.json.

    Lee las traducciones ya guardadas; si falta una, conserva el castellano de origen. No llama a IA.

    Returns:
        El nombre catalán de cada código ESCO.
    """
    nombres: dict[str, str] = {}
    traducciones = catalan.traducciones()
    for nombre, origen in catalan.origenes().items():
        if nombre.startswith("ocupaciones-"):
            nombres.update(origen["textos"])
            nombres.update(traducciones.get(nombre, {}).get("textos", {}))
    return nombres


def enlaces(fichas: list[dict[str, str]]) -> tuple[dict[str, str], list[str]]:
    """El identificador de la ficha de cada código con una sola ficha, y los códigos con varias (sin enlace).

    Returns:
        El identificador de ficha por código y los códigos con varias fichas.
    """
    veces = Counter(ficha["codigo"] for ficha in fichas)
    unicos = {ficha["codigo"]: ficha["id"] for ficha in fichas if veces[ficha["codigo"]] == 1}
    return dict(sorted(unicos.items())), sorted(codigo for codigo, cuantas in veces.items() if cuantas > 1)


def contraste(fichas: list[dict[str, str]], faro: dict[str, str]) -> dict[str, Any]:
    """Los nombres catalanes de Faro que no coinciden con la denominació de Barcelona Activa del mismo código.

    Returns:
        Los nombres que no coinciden, con los recuentos del contraste.
    """
    distintos = []
    comparados = 0
    for ficha in fichas:
        nombre_faro = faro.get(ficha["codigo"])
        if not nombre_faro:
            continue
        comparados += 1
        if not coinciden(ficha["nombre"], nombre_faro):
            distintos.append({"codigo": ficha["codigo"], "faro": nombre_faro, "barcelona_activa": ficha["nombre"]})
    return {
        "para": "Revisión de los nombres catalanes de Faro (traducidos con IA). No llega al informe ni cambia nada.",
        "criterio": "Coinciden si, en minúsculas y con espacios y apóstrofos normalizados, la denominació (o la misma "
        "sin los finales femeninos abreviados, «/a», «/ora»…) es igual al nombre de Faro o a una de sus formas "
        "separadas por «/».",
        "comparados": comparados,
        "coinciden": comparados - len(distintos),
        "distintos": distintos,
    }


def descargar(aceptar_cambio: bool = False) -> None:
    """Actualiza el canal API Cibernàrium y su censo de IA, conservando los originales ocupacionales.

    El registro común de adquisiciones (`adquisicion_por_fuente`) encadena las dos consultas.

    Args:
        aceptar_cambio: Si se acepta un original que ya no coincide con su procedencia (`--aceptar-cambio`).
    """
    operacion_fuente.descargar(FUENTE, aceptar_cambio)


def dia_civil(instante_utc: str) -> str:
    """El día civil en Barcelona (Europe/Madrid) de un instante UTC de un recibo.

    Returns:
        El día en formato AAAA-MM-DD.
    """
    return datetime.fromisoformat(instante_utc.replace("Z", "+00:00")).astimezone(ZONA).date().isoformat()


def cita(desde: str, hasta: str) -> str:
    """La cita de la fuente: el catálogo con el día de su copia y las formaciones con los días en que se vieron.

    Args:
        desde: El día (AAAA-MM-DD) en que se vio por última vez la formación publicada que lleva más tiempo sin verse.
        hasta: El de la más reciente.

    Returns:
        La cita, con los días como los escribe el castellano (DD/MM/AAAA).
    """
    cuando = f"el {_dia_es(desde)}" if desde == hasta else f"entre el {_dia_es(desde)} i el {_dia_es(hasta)}"
    return (
        "Barcelona Activa (Ajuntament de Barcelona): Catàleg d'ocupacions, consultat el "
        f"{_dia_es(CONSULTA_CATALOGO)}, i formacions d'intel·ligència artificial del Cibernàrium, consultades "
        f"{cuando}."
    )


def _dia_es(dia: str) -> str:
    return f"{dia[8:]}/{dia[5:7]}/{dia[:4]}"


def anterior() -> dict[str, Any] | None:
    """El conjunto de la última validación admitida, para conservarlo si el censo de hoy no lo sustituye.

    Returns:
        El conjunto anterior, o None si nunca se admitió.
    """
    if not (VALIDADO / "validacion.json").is_file():
        return None
    informe = leer_json(VALIDADO / "validacion.json")
    if not str(informe.get("estado", "")).startswith(ADMITIDO):
        return None
    return {
        "conjunto": leer_json(VALIDADO / f"{FUENTE}.json"),
        "evidencias": informe.get("evidencias", []),
        "vistas": informe.get("vistas", {}),
    }


def componer_cibernarium(
    lectura: dict[str, Any], censo: dict[str, Any] | None, previa: dict[str, Any] | None
) -> dict[str, Any]:
    """Las formaciones de IA que se publican: del censo de IA completo, cruzado con el censo completo admitido.

    Un censo de IA parcial, o un censo del canal sin admitir o parcial, no sustituye la salida: se conserva la anterior
    y queda dicho por qué. Con los dos completos entra cada actividad del ámbito de IA que también publica el censo
    admitido. Una actividad publicada antes que falta se conserva mientras su propio calendario no haya acabado
    (`politica_vigencia_v3`: una ausencia no retira; el calendario publicado sí).

    Returns:
        Actividades, día de la consulta, evidencia de las páginas, lo conservado y retirado, o la consulta parcial.

    Raises:
        FormatoInesperado: Si el censo no sustituye la salida y no hay una anterior que conservar.
    """
    motivo = None
    if not lectura["completo"]:
        motivo = lectura["motivo"]
    elif censo is None or censo.get("censo_completo") is not True:
        motivo = CANAL_SIN_ADMITIR
    if motivo is not None:
        exigir(previa is not None, f"Cibernàrium sin salida anterior que conservar ({motivo})")
        # Lo republicado pasa por `_conservada`: hoy no se ha visto, así que su botón de inscripción no consta.
        return {
            "cibernarium": [_conservada(a) for a in previa["conjunto"]["cibernarium"]],
            "consulta": previa["conjunto"]["consulta"],
            "evidencias": previa["evidencias"],
            "vistas": vistas_previas(previa),
            "conservadas": [a["id"] for a in previa["conjunto"]["cibernarium"]],
            "retiradas": [],
            "consulta_parcial": {"motivo": motivo, "paginas_caidas": lectura["caidas"]},
            "descartadas": [],
            "avisos": lectura["avisos"],
        }
    dia = dia_civil(lectura["paginas"][0]["consultado_utc"])
    nuevas, retiradas, descartadas, avisos = _vistas_hoy(lectura, set(censo["censo"]["actividades"]))
    vistas = dict.fromkeys(nuevas, dia)
    anteriores = vistas_previas(previa) if previa else {}
    conservadas = []
    for previa_actividad in previa["conjunto"]["cibernarium"] if previa else []:
        id = previa_actividad["id"]
        if id in nuevas or any(r["id"] == id for r in retiradas):
            continue
        if id in lectura["fichas_cerradas"]:
            retiradas.append({"id": id, "motivo": "ficha-404-410"})
        elif previa_actividad["fin"] < dia:
            retiradas.append({"id": id, "motivo": "calendario-acabado"})
        else:
            conservadas.append(_conservada(previa_actividad))
            vistas[id] = anteriores[id]
    publicadas = sorted([*nuevas.values(), *conservadas], key=lambda a: (a["inicio"], a["id"]))
    return {
        "cibernarium": publicadas,
        "consulta": dia,
        "evidencias": lectura["paginas"],
        "vistas": vistas,
        "conservadas": sorted(a["id"] for a in conservadas),
        "retiradas": retiradas,
        "descartadas": descartadas,
        "avisos": [*lectura["avisos"], *avisos],
    }


def _vistas_hoy(lectura: dict[str, Any], admitidas: set[str]) -> tuple[dict, list[dict], list[dict], list[dict]]:
    """Las formaciones del censo de IA que también trae el censo admitido; las cerradas en la fuente no se ofrecen.

    Una actividad sin fecha o con otra forma no para la preparación: se descarta con su motivo y el resto sigue.

    Returns:
        Las que se publican, por identificador, con su edición propia si la publica; las cerradas; las descartadas;
        y los avisos de plazas que no se pudieron leer, cada uno con su motivo.
    """
    nuevas, retiradas, descartadas, avisos = {}, [], [], []
    for fila, pagina, localizador in lectura["ubicadas"]:
        try:
            leida = actividad(fila)
        except FormatoInesperado as error:
            descartadas.append({"id": str(fila.get("activityId")), "motivo": str(error)})
            continue
        if "cibernarium:" + leida["id"] not in admitidas:
            continue
        if edicion_ia.cerrada_en_la_fuente(fila):
            retiradas.append({"id": leida["id"], "motivo": "cerrada-en-la-fuente"})
            continue
        edicion, aviso = edicion_ia.edicion(fila, pagina, localizador)
        if aviso is not None:
            avisos.append({"id": leida["id"], "motivo": aviso})
        nuevas[leida["id"]] = {**leida, **({"edicion": edicion} if edicion else {})}
    return nuevas, retiradas, descartadas, avisos


def vistas_previas(previa: dict[str, Any]) -> dict[str, str]:
    """El día en que se vio por última vez cada formación de la salida anterior.

    Returns:
        Por identificador, el día anotado en su validación o, si no lo anotó, el de su consulta.
    """
    consulta = previa["conjunto"]["consulta"]
    return {a["id"]: previa["vistas"].get(a["id"], consulta) for a in previa["conjunto"]["cibernarium"]}


def _conservada(publicada: dict[str, Any]) -> dict[str, Any]:
    """Una formación que falta en el censo, tal como se publicó; solo lleva la edición que leyó el censo de IA.

    De esa edición se conservan sus hechos con su fecha, salvo el botón de inscripción, que no consta: solo vale el
    que se ve el día de la consulta.

    Returns:
        La formación con sus campos y, si la tiene, su edición propia.
    """
    edicion = publicada.get("edicion")
    propia = (
        isinstance(edicion, dict)
        and edicion.get("vinculacion") == "id-edicion-publicado"
        and edicion.get("plazas") in (None, "sin-plazas")
        and edicion["evidencia"]["localizador"].startswith("activities[")
    )
    if not propia:
        return {k: publicada[k] for k in CAMPOS_ACTIVIDAD}
    # El botón es un hecho de hoy: de una formación que hoy no se ha visto no consta.
    inscripcion = {**edicion["inscripcion"], "botonVisible": None}
    return {**{k: publicada[k] for k in CAMPOS_ACTIVIDAD}, "edicion": {**edicion, "inscripcion": inscripcion}}


def preparar() -> None:
    """Lee las fichas del catálogo y compone las formaciones de IA desde el censo de IA y el del canal.

    Raises:
        FormatoInesperado: Si una página o una actividad tiene una forma inesperada.
    """
    fichas = fichas_del_catalogo(original(FUENTE, CATALOGO).read_text(encoding="utf-8"))
    operacion_fuente.preparar(FUENTE)
    lectura = censo_ia.leer(ORIGINAL, leer_json(ORIGINAL / censo_ia.CARPETA / "procedencia.json"))
    # El censo del canal que se acaba de preparar: validar exige que sea el mismo que admite.
    _, preparado_canal, _ = operacion_fuente.rutas_de_la_fuente(FUENTE, RAIZ)
    censo = leer_json(preparado_canal / "recepciones.json")
    compuesta = {**componer_cibernarium(lectura, censo, anterior()), "censo_sha256": censo["procedencia_sha256"]}
    # Primero se interpreta todo: una fila defectuosa no deja un catálogo preparado junto a actividades antiguas.
    guardar_jsonl(FICHAS, fichas)
    guardar_json(ACTIVIDADES, compuesta)
    print(f"{len(fichas)} fichas del catálogo · {len(compuesta['cibernarium'])} formaciones de IA del Cibernàrium")


def _controles(
    controles: Controles, fichas: list[dict[str, Any]], actividades: list[dict[str, Any]], faro: dict[str, str]
) -> None:
    """Las fichas y las formaciones publicadas, cada código una ocupación de Faro y cada formación con su título."""
    ids = {ficha["id"] for ficha in fichas}
    fuera = sorted({ficha["codigo"] for ficha in fichas} - set(faro))
    controles.comprobar(
        len(fichas) == FICHAS_PUBLICADAS and len(ids) == len(fichas),
        f"{FICHAS_PUBLICADAS} fichas en el catálogo, cada una con su identificador ({len(fichas)}; {len(ids)} ids)",
    )
    controles.comprobar(
        not fuera, f"cada código publicado es una ocupación ESCO de Faro (fuera: {fuera[:MAX_EJEMPLOS]})"
    )
    controles.comprobar(
        bool(actividades) and len({formacion["id"] for formacion in actividades}) == len(actividades),
        f"formaciones de IA distintas, cada una con su identificador ({len(actividades)})",
    )
    controles.comprobar(
        all(formacion["inicio"] <= formacion["fin"] and formacion["titulo"] for formacion in actividades),
        "cada formación tiene título, y su inicio no es posterior a su final",
    )


def validar() -> None:
    """Admite el canal y comprueba las dos lecturas; guarda el conjunto que lee el motor y el contraste de nombres.

    Raises:
        FormatoInesperado: Si las formaciones no se cruzaron con el censo que el canal acaba de admitir.
    """
    operacion_fuente.validar(FUENTE)
    fichas, compuesta = leer_jsonl(FICHAS), leer_json(ACTIVIDADES)
    admitido = operacion_fuente.leer_validado(FUENTE, RAIZ)
    exigir(
        admitido is not None and admitido["procedencia_sha256"] == compuesta["censo_sha256"],
        "Formaciones de IA cruzadas con un censo distinto del admitido por cibernarium/; vuelve a preparar",
    )
    actividades = compuesta["cibernarium"]
    faro = nombres_de_faro()
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, leer_json(PROCEDENCIA))
    _controles(controles, fichas, actividades, faro)
    ocupaciones, ambiguos = enlaces(fichas)
    revision = contraste(fichas, faro)
    informe = {
        "estado": ADMITIDO if controles.admitido else CON_ERRORES,
        "comprobado_utc": ahora_utc(),
        "cobertura": {
            "fichas": len(fichas),
            "ocupaciones_de_faro": len(faro),
            "ocupaciones_con_enlace": len(ocupaciones),
            "codigos_con_varias_fichas": ambiguos,
            "formaciones_ia": len(actividades),
            "conservadas": len(compuesta["conservadas"]),
            "retiradas": compuesta["retiradas"],
            "nombres_comparados": revision["comparados"],
            "nombres_que_coinciden": revision["coinciden"],
        },
        "limites": (
            "Solo enlaces: Barcelona Activa no permite reproducir sus fichas. El enlace va por el código ESCO exacto; "
            "no dice nada del contenido de la ficha ni de si su formación es la del SOC. Las formaciones salen del "
            "censo diario del ámbito de IA del Cibernàrium: las plazas y los cambios de fecha se consultan allí."
        ),
        "controles": controles.lista,
        "evidencias": compuesta["evidencias"],
        "vistas": compuesta["vistas"],
    }
    if "consulta_parcial" in compuesta:
        informe["consulta_parcial"] = compuesta["consulta_parcial"]
    for clave in ("descartadas", "avisos"):
        if compuesta.get(clave):
            informe[clave] = compuesta[clave]
    dias = [compuesta["vistas"][a["id"]] for a in actividades]
    conjunto = {
        "cita": cita(min(dias), max(dias)) if dias else cita(compuesta["consulta"], compuesta["consulta"]),
        "consulta": compuesta["consulta"],
        "url_ficha": URL_FICHA,
        "url_actividad": URL_ACTIVIDAD,
        "ocupaciones": ocupaciones,
        "cibernarium": actividades,
    }
    if controles.admitido:
        guardar_json(REVISION, revision)
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto)
    if controles.admitido:
        from plataforma_datos.cursos import materia_cibernarium

        materia_cibernarium.guardar_censo_admitido(RAIZ)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida del proceso: 0 si todo va bien.
    """
    # La orquestación pasa `--aceptar-cambio` a las fuentes de política renovable, como a las demás de cursos.
    return principal_fuente_con_descarga(__doc__, descargar, {"preparar": preparar, "validar": validar}, argv)


if __name__ == "__main__":
    sys.exit(main())
