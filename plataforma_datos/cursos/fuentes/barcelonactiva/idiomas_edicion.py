"""Extrae idioma de un bloque de edición Cibernàrium, con identidad y captura comprobadas.

El horario sin botón exige una sola edición y un solo bloque. Si falta el año,
se cotejan la apertura o la agenda completa entre dos identificadores explícitos.
Las fichas históricas se vinculan por el ID de edición y el horario acreditados
en una captura API del mismo recorrido. Una URL propia con año y horarios
completos también puede cotejarse con la API de otra hora del mismo día.
"""

import hashlib
import json
import re
from collections import Counter, defaultdict
from collections.abc import Callable
from datetime import datetime, timedelta
from http import HTTPStatus
from pathlib import Path

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import recibos_compartidos
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.fuentes.barcelonactiva.ficha_edicion import (
    _BOTON,
    _Bloque,
    _calendario,
    _fecha_hora,
    _Ficha,
    _texto,
)
from plataforma_datos.cursos.fuentes.barcelonactiva.idioma_ficha import literal_de_idioma


def _url_actividad(ident: str) -> str:
    return "https://cibernarium.barcelonactiva.cat/ca/formacio?activityId=" + ident


def _urls_de_ficha(ident: str) -> tuple[str, str]:
    return _url_actividad(ident), robot.ORIGEN + "/formacio?activityId=" + ident


MAX_LITERAL = 100


class _FichaIdiomas(_Ficha):
    @staticmethod
    def _tipo(tag: str, clases: set[str]) -> str:
        if tag == "div" and {"idioma", "language"} <= clases:
            return "idioma"
        if tag == "span" and "no-places" in clases:
            return "no-places"
        return _Ficha._tipo(tag, clases)


Horario = list[tuple[str, datetime]]
Corroborar = Callable[[str, str], bool]


def horario_de_sesiones(sesiones: object) -> Horario:
    """Normaliza todas las sesiones para compararlas literalmente con las que muestra la ficha.

    Returns:
        Horas de Barcelona en orden de publicación; si falta alguna fecha u hora, lista vacía.
    """
    if not isinstance(sesiones, list):
        return []
    horas = [hora for s in sesiones if isinstance(s, dict) and (hora := _fecha_hora(s))]
    return horas if len(horas) == len(sesiones) else []


def _horario_edicion(edicion: dict) -> Horario:
    campo = edicion["hechos"].get("calendario_formacion", {})
    valor = campo.get("valor")
    if campo.get("motivo") != "conocido" or campo.get("alcance") != "edicion" or not isinstance(valor, dict):
        return []
    return horario_de_sesiones(valor.get("sesiones")) if valor.get("tipo") == "sesiones" else []


def _coincidencias(bloque: _Bloque, calendarios: dict[str, Horario]) -> dict[str, bool | None]:
    resultado = {}
    for ident, horas in calendarios.items():
        if horas:
            coincide, ano = _calendario(bloque, horas)
            if coincide:
                resultado[ident] = ano
    return resultado


def _id_bloque(
    bloque: _Bloque, actividad: str, coincidencias: dict, repeticiones: Counter, corroborar: Corroborar | None
) -> str | None:
    botones = [campo for campo in bloque.campos if campo.tipo == "botonRosaDerecha"]
    if botones:
        boton = _BOTON.fullmatch(botones[0].accion) if len(botones) == 1 else None
        if not boton or boton[1] != actividad:
            return None
        # Una acción con los dos identificadores basta si la ficha no conserva un horario cotejable.
        compatible = not coincidencias or boton[2] in coincidencias and coincidencias[boton[2]] is not None
        return boton[2] if compatible else None
    if len(coincidencias) != 1:
        return None
    [(ident, ano)] = coincidencias.items()
    if repeticiones[ident] != 1 or ano is None:
        return None
    if ano:
        return ident
    estados = [campo for campo in bloque.campos if campo.tipo == "next-edition"]
    respaldada = (
        corroborar and len(estados) == 1 and "code-DISP52" in estados[0].clases and corroborar(ident, estados[0].texto)
    )
    return ident if respaldada else None


def _acciones_de_ficha(bloques: list[_Bloque], actividad: str) -> Counter:
    return Counter(
        m[2]
        for bloque in bloques
        for campo in bloque.campos
        if campo.tipo == "botonRosaDerecha" and (m := _BOTON.fullmatch(campo.accion)) and m[1] == actividad
    )


def _anos_entre_botones(
    bloques: list[_Bloque], grupos: list[dict], programa: str, serie: list[tuple[str, str]]
) -> set[str]:
    """Compara cada posición con la edición correspondiente de una misma captura API.

    Returns:
        Ediciones con el año corroborado al quedar entre dos botones identificados.
    """
    if len(serie) != len(bloques) or len({ident for ident, _ in serie}) != len(serie):
        return set()
    anclas = []
    for i, (bloque, grupo, (ident, estado)) in enumerate(zip(bloques, grupos, serie, strict=True)):
        if not bloque.selector.endswith(f".item{i + 1}") or set(grupo) != {ident} or grupo[ident] is None:
            return set()
        botones = [c for c in bloque.campos if c.tipo == "botonRosaDerecha"]
        llenas = [c.texto for c in bloque.campos if c.tipo == "no-places"]
        if botones:
            boton = _BOTON.fullmatch(botones[0].accion) if len(botones) == 1 else None
            if not boton or boton.groups() != (programa, ident) or estado != "DISP0" or llenas:
                return set()
            anclas.append(i)
        elif estado != "DISP3" or llenas != ["sense places"]:
            return set()
    if not anclas:
        return set()
    return {ident for ident, _ in serie[anclas[0] + 1 : anclas[-1]]}


def idiomas_por_edicion(
    cuerpo: bytes,
    *,
    actividad_id: str,
    titulo: str,
    calendarios: dict[str, Horario] | None = None,
    corroborar_apertura: Corroborar | None = None,
) -> dict[str, tuple[str, str]]:
    """Lee el idioma del bloque identificado por la acción o el horario completo de una sola edición.

    Returns:
        Edición a literal y selector si el bloque y el calendario de la edición son inequívocos.
    """
    ficha = _abrir_ficha(cuerpo, actividad_id, titulo)
    return _leer_bloques(ficha, actividad_id, calendarios or {}, corroborar_apertura, []) if ficha else {}


def _abrir_ficha(cuerpo: bytes, actividad_id: str, titulo: str) -> _FichaIdiomas | None:
    ficha = _FichaIdiomas()
    ficha.feed(cuerpo.decode("utf-8"))
    ficha.close()
    if len(ficha.urls) == 1 and ficha.urls.issubset(_urls_de_ficha(actividad_id)) and ficha.titulos == {_texto(titulo)}:
        return ficha
    return None


def _leer_bloques(
    ficha: _FichaIdiomas,
    actividad_id: str,
    calendarios: dict,
    corroborar_apertura: Corroborar | None,
    serie_nativa: list,
) -> dict[str, tuple[str, str]]:
    coincidencias = [_coincidencias(bloque, calendarios) for bloque in ficha.bloques]
    if serie_nativa:
        con_ano = _anos_entre_botones(ficha.bloques, coincidencias, actividad_id, serie_nativa)
        for grupo in coincidencias:
            for ident in con_ano & grupo.keys():
                grupo[ident] = True
    acciones = _acciones_de_ficha(ficha.bloques, actividad_id)
    repeticiones = Counter(ident for grupo in coincidencias for ident in grupo)
    selectores = Counter(b.selector for b in ficha.bloques)
    candidatos: dict[str, list[tuple[str, str] | None]] = defaultdict(list)
    for bloque, grupo in zip(ficha.bloques, coincidencias, strict=True):
        ident = _id_bloque(bloque, actividad_id, grupo, repeticiones, corroborar_apertura)
        tiene_boton = any(c.tipo == "botonRosaDerecha" for c in bloque.campos)
        if ident is None or acciones[ident] != int(tiene_boton):
            continue
        if (
            tiene_boton
            and ident in calendarios
            and ident not in grupo
            and (serie_nativa or any(c.tipo in ("dates", "activity-session-date") for c in bloque.campos))
        ):
            continue
        campos = [x for x in bloque.campos if x.tipo == "idioma" and x.texto.startswith("idioma:")]
        literal = literal_de_idioma(campos[0].texto[len("idioma:") :]) if len(campos) == 1 else ""
        valida = selectores[bloque.selector] == 1 and len(literal) <= MAX_LITERAL and _codigos(literal)
        candidatos[ident].append((literal, bloque.selector + " .idioma.language") if valida else None)
    return {ident: valores[0] for ident, valores in candidatos.items() if len(valores) == 1 and valores[0]}


def preparar_registro(ofertas: list[dict], capturas: Path) -> list[dict]:
    """Genera pistas históricas con botón y huella. Este DTO solo conserva las ediciones publicadas.

    Returns:
        Pistas ordenadas por identidad de edición.
    """
    resultado = []
    for oferta in ofertas:
        if oferta.get("proveedor_id") != "cibernarium" or oferta.get("unidad", {}).get("tipo") != "edicion":
            continue
        unidad = oferta["unidad"]
        actividad = unidad["programa_id"].removeprefix("cibernarium:")
        edicion = unidad["id"].removeprefix("cibernarium-edicion:")
        if not actividad.isdecimal() or not edicion.isdecimal():
            continue
        ruta = capturas / f"cibernarium-ficha-{actividad}.html"
        if not ruta.is_file():
            continue
        cuerpo = ruta.read_bytes()
        huella = hashlib.sha256(cuerpo).hexdigest()
        ref = next(
            (r for r in oferta["referencias"] if r["url"] == _url_actividad(actividad) and r["sha256"] == huella), None
        )
        if ref is None:
            continue
        encontrado = idiomas_por_edicion(cuerpo, actividad_id=actividad, titulo=oferta["titulo_programa"]).get(edicion)
        if not encontrado:
            continue
        literal, selector = encontrado
        resultado.append(
            {
                "unidad": unidad,
                "proveedor_id": oferta["proveedor_id"],
                "titulo": oferta["titulo_programa"],
                "modalidad": oferta["hechos"]["modalidad"],
                "sincronia": oferta["hechos"]["sincronia"],
                "idioma_original": oferta["hechos"]["idiomas_declarados"],
                "literal": literal,
                "evidencia": {
                    "url": ref["url"],
                    "sha256": huella,
                    "capturadoEl": ref["fecha_referencia"],
                    "localizador": selector,
                },
            }
        )
    return sorted(resultado, key=lambda x: x["unidad"]["id"])


def escribir_registro(ofertas: list[dict], capturas: Path, destino: Path) -> None:
    """Escribe bytes deterministas, sin variar el archivo cuando el contenido coincide."""
    contenido = (
        json.dumps({"version": 1, "registros": preparar_registro(ofertas, capturas)}, ensure_ascii=False, indent=2)
        + "\n"
    )
    if not destino.exists() or destino.read_text(encoding="utf-8") != contenido:
        destino.write_text(contenido, encoding="utf-8")


def _cuerpo_indizado(indice: dict, sha: str) -> bytes | None:
    ref = indice.get(sha)
    if ref is None:
        return None
    cuerpo = ref.ruta.read_bytes()
    return cuerpo if hashlib.sha256(cuerpo).hexdigest() == sha else None


def _coincide_apertura(actividades: list, programa: str, ident: str, horario: Horario, aviso: str) -> bool:
    propias = [a for a in actividades if a.get("activityId") == programa]
    if len(propias) != 1 or not isinstance(propias[0].get("listEditions"), list):
        return False
    ediciones = [e for e in propias[0]["listEditions"] if isinstance(e, dict) and e.get("activityId") == ident]
    if len(ediciones) != 1:
        return False
    e = ediciones[0]
    literal = e.get("registrationDesc")
    if e.get("registrationCode") != "DISP52" or not isinstance(literal, str) or _texto(literal) != aviso:
        return False
    datos = robot.normalizar_edicion("cibernarium:" + programa, propias[0], e)["datos"]
    apertura = datos.get("apertura_inscripcion")
    if not apertura or horario_de_sesiones(datos["sesiones"]) != horario:
        return False
    fecha = datetime.fromisoformat(apertura)
    return fecha.year == horario[0][1].year and fecha <= horario[0][1]


def _apertura_en_api(programa: str, edicion: dict, horario: Horario, aviso: str, indice: dict) -> bool:
    from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion

    if len(horario) != 1:
        return False
    ident = edicion["id"].removeprefix("cibernarium-edicion:")
    for ref in edicion.get("referencias", []):
        try:
            desde = adquisicion.inicio_de_pagina(ref["url"])
            cuerpo = _cuerpo_indizado(indice, ref["sha256"])
            if cuerpo:
                _, actividades = robot.validar_pagina(json.loads(cuerpo), desde)
                if _coincide_apertura(actividades, programa, ident, horario, aviso):
                    return True
        except (FormatoInesperado, ValueError, KeyError, TypeError):
            continue
    return False


def _capturas_pendientes(ediciones: dict, url: str) -> dict:
    capturas = defaultdict(set)
    for ident, edicion in ediciones.items():
        if edicion["hechos"]["idiomas_declarados"]["motivo"] in ("no_consta_en_evidencia", "sin_soporte_de_campo"):
            for ref in edicion.get("referencias", []):
                if ref["url"] == url:
                    capturas[ref["sha256"]].add(ident)
    return capturas


def _enriquecer_programa(programa: dict, ediciones: dict, indice: dict) -> int:
    actividad = programa["id"].removeprefix("cibernarium:")
    horarios = {ident: horas for ident, fila in ediciones.items() if (horas := _horario_edicion(fila))}
    capturas = _capturas_pendientes(ediciones, _url_actividad(actividad))

    def corroborar(ident: str, aviso: str) -> bool:
        return _apertura_en_api(actividad, ediciones[ident], horarios[ident], aviso, indice)

    lecturas = defaultdict(set)
    for sha, interesadas in capturas.items():
        cuerpo = _cuerpo_indizado(indice, sha)
        if not cuerpo:
            continue
        try:
            resultados = idiomas_por_edicion(
                cuerpo,
                actividad_id=actividad,
                titulo=programa["titulo"],
                calendarios=horarios,
                corroborar_apertura=corroborar,
            )
        except (UnicodeDecodeError, ValueError, FormatoInesperado):
            continue
        for ident in interesadas & resultados.keys():
            lecturas[ident].add(resultados[ident][0])
    cambios = 0
    for ident, literales in lecturas.items():
        if len(literales) == 1 and (codigos := _codigos(next(iter(literales)))):
            hecho = ediciones[ident]["hechos"]["idiomas_declarados"]
            ediciones[ident]["hechos"]["idiomas_declarados"] = {
                **hecho,
                "valor": codigos,
                "motivo": "conocido",
                "alcance": "edicion",
            }
            cambios += 1
    return cambios


def _codigos(literal: str) -> list[str]:
    nombres = {
        "català": "ca",
        "catalán": "ca",
        "castellà": "es",
        "castellano": "es",
        "español": "es",
        "anglès": "en",
        "inglés": "en",
    }
    partes = [x.strip() for x in re.split(r"\s*(?:,|/|\bi\b|\by\b)\s*", literal) if x.strip()]
    return sorted({nombres[x] for x in partes}) if partes and all(x in nombres for x in partes) else []


# Las dos piezas deben pertenecer al mismo recorrido del proveedor.
VENTANA_DE_CAPTURA = timedelta(minutes=15)
MAX_RECIBO_HTTP = 4096


def _piezas_de_recibos(indice: dict) -> tuple[dict, dict]:
    metadatos, eventos = {}, defaultdict(list)
    for sha, ref in indice.items():
        if ref.ruta.stat().st_size > MAX_RECIBO_HTTP:
            continue
        crudo = ref.ruta.read_bytes()
        if b'"metadatos_sha256"' not in crudo and b'"cuerpo_sha256"' not in crudo:
            continue
        if hashlib.sha256(crudo).hexdigest() != sha:
            continue
        try:
            doc = recibos_compartidos.leer_json(crudo)
            if not isinstance(doc, dict):
                continue
            if doc.get("formato_recibo") == 1 and isinstance(doc.get("metadatos_sha256"), str):
                eventos[doc["metadatos_sha256"]].append(crudo)
            elif _es_ficha_recibida(doc):
                metadatos[sha] = crudo
        except (UnicodeDecodeError, ValueError, FormatoInesperado):
            continue
    return metadatos, eventos


def _referencias_ficha_indizadas(indice: dict) -> dict:
    """Reproduce los recibos HTTP de fichas oficiales conservadas en la admisión.

    Returns:
        Cuerpos, instantes de recepción y tamaño por ID del programa de la ficha.
    """
    metadatos, eventos = _piezas_de_recibos(indice)
    fichas = defaultdict(set)
    for sha, meta in metadatos.items():
        for evento in eventos[sha]:
            try:
                dato = recibos_compartidos.leer_json(recibos_compartidos.reconstruir(evento, meta))
                fecha = robot.fecha_utc(dato["fin_utc"])
                if robot.fecha_utc(dato["inicio_utc"]) <= fecha and dato["cuerpo_sha256"] in indice:
                    programa = dato["url_final"].split("activityId=")[1]
                    fichas[programa].add(
                        (dato["cuerpo_sha256"], dato["fin_utc"], dato["bytes"], None, dato["url_final"])
                    )
            except (FormatoInesperado, ValueError, KeyError, TypeError):
                continue
    return fichas


def _es_ficha_recibida(meta: dict) -> bool:
    final = meta.get("url_final")
    if not isinstance(final, str):
        return False
    pid = final.rpartition("activityId=")[2]
    return (
        final in _urls_de_ficha(pid)
        and pid.isascii()
        and pid.isdecimal()
        and meta.get("url") in (robot.url_ficha(pid), final)
        and meta.get("http") == HTTPStatus.OK
        and meta.get("completo") is True
        and meta.get("error") is None
        and isinstance(meta.get("content_type"), str)
        and meta["content_type"].split(";", 1)[0].strip().lower() == "text/html"
        and type(meta.get("bytes")) is int
        and isinstance(meta.get("cuerpo_sha256"), str)
    )


def _agenda_nativa(actividad: dict) -> tuple[dict, list]:
    pid = actividad["activityId"]
    calendario, serie = {}, []
    for ed in actividad["listEditions"]:
        ident = robot.identificador(ed["activityId"])
        datos = robot.normalizar_edicion("cibernarium:" + pid, actividad, ed)["datos"]
        horas = horario_de_sesiones(datos["sesiones"])
        if not horas or ident in calendario:
            return {}, []
        calendario[ident] = horas
        serie.append((ident, ed.get("registrationCode")))
    return calendario, serie


def _leer_agenda_cruzada(actividad: dict, cercanas: list, interesadas: dict, indice: dict, lecturas: dict) -> None:
    pid, titulo = actividad["activityId"], actividad["title"]
    horarios, serie = _agenda_nativa(actividad)
    propias = {
        k
        for k in horarios.keys() & interesadas.keys()
        if horarios[k] == interesadas[k][1] and _texto(titulo) == interesadas[k][0]
    }
    if not propias:
        return
    for (sha, fecha, tam, solo_edicion, url), mismo_recorrido in cercanas:
        cuerpo = _cuerpo_indizado(indice, sha)
        if not cuerpo or tam not in (None, len(cuerpo)):
            continue
        ficha = _abrir_ficha(cuerpo, pid, titulo)
        if not ficha or ficha.urls != {url}:
            continue
        lengua = _leer_bloques(ficha, pid, horarios, None, serie)
        if not mismo_recorrido:
            lengua = _ficha_propia_con_ano(pid, ficha, horarios, lengua)
        for ident in propias & lengua.keys():
            if solo_edicion is None or solo_edicion == ident:
                lecturas[ident][lengua[ident][0]].add((url, sha, fecha))


def _ficha_propia_con_ano(pid: str, ficha: _FichaIdiomas, horarios: dict, lengua: dict) -> dict:
    # Dos recorridos del día solo se vinculan si URL e ID de la edición son el mismo
    # y el bloque que aporta el idioma muestra todas las horas y el año explícitos.
    if pid in lengua:
        literal, selector = lengua[pid]
        for bloque in ficha.bloques:
            if selector == bloque.selector + " .idioma.language" and _calendario(bloque, horarios[pid]) == (True, True):
                return {pid: (literal, selector)}
    return {}


def _fichas_del_dia(referencias: set, at: datetime) -> list:
    del_dia = []
    for ref in referencias:
        fin = robot.fecha_utc(ref[1])
        mismo_recorrido = abs(fin - at) <= VENTANA_DE_CAPTURA
        if mismo_recorrido or fin.date() == at.date():
            del_dia.append((ref, mismo_recorrido))
    return del_dia


def _paginas_de_pendientes(por_programa: dict, programas: dict) -> tuple[dict, dict, dict]:
    from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion

    por_pagina, pend, propias = defaultdict(dict), {}, defaultdict(set)
    for programa, hermanas in por_programa.items():
        for ident, fila in hermanas.items():
            hecho = fila["hechos"]["idiomas_declarados"]
            horario = _horario_edicion(fila)
            if hecho["motivo"] not in ("no_consta_en_evidencia", "sin_soporte_de_campo") or not horario:
                continue
            for ref in fila.get("referencias", []):
                try:
                    at = robot.fecha_utc(ref["fecha_referencia"])
                    if ref["url"] in _urls_de_ficha(programa.removeprefix("cibernarium:")):
                        propias[programa.removeprefix("cibernarium:")].add(
                            (ref["sha256"], ref["fecha_referencia"], None, ident, ref["url"])
                        )
                    elif "typeView=list" in ref["url"]:
                        inicio = adquisicion.inicio_de_pagina(ref["url"])
                        por_pagina[ref["sha256"], at, inicio][ident] = (_texto(programas[programa]["titulo"]), horario)
                        pend[ident] = (fila, hecho)
                except (FormatoInesperado, ValueError, KeyError, TypeError):
                    continue
    return por_pagina, pend, propias


def _aplicar_agendas_archivadas(paginas: tuple[dict, dict, dict], indice: dict) -> int:
    por_pagina, pend, propias = paginas
    if not por_pagina:
        return 0
    fichas = _referencias_ficha_indizadas(indice)
    for pid, urls in propias.items():
        fichas[pid].update(urls)
    lecturas = defaultdict(lambda: defaultdict(set))
    for (sha, at, inicio), candidatas in por_pagina.items():
        cuerpo = _cuerpo_indizado(indice, sha)
        if not cuerpo:
            continue
        try:
            _, actividades = robot.validar_pagina(recibos_compartidos.leer_json(cuerpo), inicio)
            for actividad in actividades:
                cercanas = _fichas_del_dia(fichas.get(actividad["activityId"], set()), at)
                if cercanas and any(e["activityId"] in candidatas for e in actividad["listEditions"]):
                    _leer_agenda_cruzada(actividad, cercanas, candidatas, indice, lecturas)
        except (FormatoInesperado, ValueError, KeyError, TypeError):
            continue
    return _incorporar_agendas(pend, lecturas)


def _incorporar_agendas(pend: dict, lecturas: dict) -> int:
    cambios = 0
    for ident, idiomas in lecturas.items():
        fila, hecho_inicial = pend[ident]
        hecho = fila["hechos"]["idiomas_declarados"]
        codigos = {tuple(_codigos(lit)) for lit in idiomas}
        if hecho["valor"]:
            if codigos != {tuple(hecho["valor"])}:
                fila["hechos"]["idiomas_declarados"] = hecho_inicial
                cambios -= 1
            continue
        if len(codigos) != 1:
            continue
        respaldos = set().union(*idiomas.values())
        hecho.update(valor=list(codigos.pop()), motivo="conocido", alcance="edicion")
        conocidas = {(r["url"], r["sha256"], r["fecha_referencia"]) for r in fila["referencias"]}
        for url, sha, fecha in sorted(respaldos - conocidas):
            fila["referencias"].append(
                {
                    "url": url,
                    "sha256": sha,
                    "fecha_referencia": fecha,
                    "alcance": "entidad",
                    "naturaleza_fecha": "recepcion_conservada",
                    "naturaleza_documento": "no_acreditada",
                }
            )
        cambios += 1
    return cambios


def aplicar_a_colecciones(colecciones: dict, referencias_indexadas: dict) -> int:
    """Contrasta las capturas por edición con los horarios de todas sus hermanas, incluidas las no publicadas.

    Returns:
        Número de ediciones que pasan a tener un idioma declarado por el proveedor.
    """
    programas = {p["id"]: p for p in colecciones["unidades"] if p["proveedor_id"] == "cibernarium"}
    por_programa = defaultdict(dict)
    for e in colecciones["ediciones"]:
        actividad = e["programa_id"].removeprefix("cibernarium:")
        ident = e["id"].removeprefix("cibernarium-edicion:")
        if e["programa_id"] in programas and actividad.isdecimal() and ident.isdecimal():
            por_programa[e["programa_id"]][ident] = e
    paginas = _paginas_de_pendientes(por_programa, programas)
    cambios = sum(
        _enriquecer_programa(programas[p], ediciones, referencias_indexadas) for p, ediciones in por_programa.items()
    )
    return cambios + _aplicar_agendas_archivadas(paginas, referencias_indexadas)


def main() -> None:
    """Regenera el índice histórico con una entrega admitida y sus fichas conservadas."""
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalogo", required=True, type=Path)
    parser.add_argument("--capturas", required=True, type=Path)
    parser.add_argument("--salida", required=True, type=Path)
    argumentos = parser.parse_args()
    entrega = json.loads(argumentos.catalogo.read_text(encoding="utf-8"))
    escribir_registro(entrega["ofertas"], argumentos.capturas, argumentos.salida)


if __name__ == "__main__":
    main()
