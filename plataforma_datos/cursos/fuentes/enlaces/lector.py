"""Comprobación de los enlaces que Faro enseña en la formación: webs del Consorci, fichas del SOC y programas del SEPE.

Cada ciclo consulta una porción: los nunca consultados, los que fallaron la última vez y los de observación más
antigua, hasta los topes de consultas y de tiempo de `porcion_diaria.json` (`porcion.py`), y guarda por enlace el
código HTTP, la fecha, el destino final y, en un programa, la huella del PDF. De esas observaciones salen los enlaces
que se ocultan o se enseñan (`observaciones.py`): solo un 404 o un 410 observados ocultan una web o un curso, y un PDF
que responde enlaza su programa. Un fallo de red, un plazo o un 5xx no cambian nada: se anotan y se conserva lo
observado antes.

La primera vez parte de lo que el paquete anterior daba por hecho: los programas que daba por buenos siguen enlazados y
las webs rotas y los cursos fuera de la oferta siguen ocultos, «pendientes de comprobar», hasta que una consulta propia
diga otra cosa: si responde, vuelve a enseñarse; si da 404 o 410, queda oculto con su código y su fecha.

Uso: python3 -m plataforma_datos.cursos.fuentes.enlaces.lector {descargar,preparar,validar,todo}
"""

import sys
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

from plataforma_datos.comun.entrada_salida import (
    carpetas,
    controles_de_huella,
    escribir_bytes_entero,
    guardar_json,
    json_compacto,
    leer_json,
    original,
    sha256_bytes,
)
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    PAQUETE,
    Controles,
    ErrorFuente,
    FormatoInesperado,
    exigir,
)
from plataforma_datos.cursos.fuentes.enlaces import consulta
from plataforma_datos.cursos.fuentes.enlaces.candidatos import Candidato, candidatos, expuestos
from plataforma_datos.cursos.fuentes.enlaces.observaciones import (
    CONJUNTOS,
    CURSOS,
    NO_EXISTE,
    PROGRAMAS,
    RESULTADOS,
    WEBS,
    Estado,
    anotar,
    es_heredado,
    esta_oculto,
    esta_visible_el_programa,
    estado_con_evidencia,
    estado_heredado,
    evidencia,
    observacion,
    tiene_consulta_propia,
)
from plataforma_datos.cursos.fuentes.enlaces.porcion import (
    Porcion,
    dominios_con_anomalia,
    es_dia_largo,
    leer_porcion,
    orden_de_la_porcion,
    topes_del_dia,
    vencimientos_tras_el_ciclo,
)
from plataforma_datos.cursos.fuentes.formacion.exportacion import paquete_formacion
from plataforma_datos.orquestacion.admision import cerrar_validacion, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "enlaces"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
OBSERVACIONES = "observaciones.json"
VERSION = 1
# La forma de enlaces-comprobados.json en el paquete: la anterior no llevaba versión.
VERSION_DEL_PAQUETE = 2
# Lo que un ciclo consulta como mucho y lo que tarda como mucho, un día normal y el de la pasada larga, declarados en la
# configuración de la fuente: con una pausa de dos segundos por dominio, los programas del SEPE (un solo dominio) fijan
# el ritmo. Lo que no cabe espera al ciclo siguiente.
PORCION = leer_porcion()
MAX_CONSULTAS, PLAZO_S = PORCION.max_consultas, PORCION.plazo_s
MAX_CONSULTAS_DIA_LARGO, PLAZO_S_DIA_LARGO = PORCION.max_consultas_dia_largo, PORCION.plazo_s_dia_largo
TOPE, PLAZO = "tope-de-consultas", "plazo-de-la-descarga"
# Un dominio que responde tres veces seguidas 403 o 429 pide que se le deje en paz: se salta el resto del ciclo.
DOMINIO_CON_LIMITE = "dominio-con-limite"
CODIGOS_DE_LIMITE = frozenset({403, 429})
LIMITES_SEGUIDOS = 3
# Un dominio en el que la porción ve desaparecer de golpe lo que se enseña: sus 404 no cambian nada (`porcion.py`).
ANOMALIA_DE_DOMINIO = "anomalia-de-dominio"
# Por qué un ciclo no consultó todo lo pendiente; los tres llegan al panel en `salidaParcial`.
MOTIVOS = frozenset({TOPE, PLAZO, DOMINIO_CON_LIMITE})
# Lo que la cobertura de la validación cuenta de la porción: si fue la pasada larga, lo expuesto y lo enseñado que no
# cupo, las fichas que esperan a otro ciclo y los dominios con anomalía. Un ciclo anterior a la porción no los trae.
CAMPOS_DE_LA_PORCION = (
    "dia_largo",
    "expuestos",
    "expuestos_vencidos",
    "ensenados",
    "ensenados_vencidos",
    "fichas_fuera_de_la_muestra",
    "dominios_con_anomalia",
)

type Observaciones = dict[str, dict[str, Estado]]
type Consultar = Callable[[str, str], dict[str, Any]]


def _origenes() -> tuple[dict[str, Any], dict[str, Any]]:
    """El conjunto validado del Consorci y la composición de formación del paquete, de donde salen los enlaces.

    Returns:
        El Consorci y la formación.

    Raises:
        ErrorFuente: Si el Consorci o la formación no tienen validación admitida o les falta un archivo.
    """
    try:
        consorci, formacion = leer_validado("consorci"), paquete_formacion().datos
    except ErrorFuente as error:
        raise type(error)(f"enlaces: no se pueden leer los enlaces de la formación y del Consorci: {error}") from error
    exigir(isinstance(consorci, dict), "enlaces: el conjunto validado del Consorci es un objeto")
    return consorci, formacion  # type: ignore[return-value]


def _fuentes_del_paquete() -> list[Candidato]:
    """Los enlaces que Faro enseña, leídos de donde están.

    Las webs salen del conjunto validado del Consorci; las fichas y los programas, de los cursos y las especialidades
    que compone el paquete de formación desde sus preparados, con la validación admitida de `formacion`.

    Returns:
        Los candidatos de las webs, las fichas y los programas.

    Raises:
        ErrorFuente: Si el Consorci o la formación no tienen validación admitida o les falta un archivo.
    """
    return candidatos(*_origenes())


def _heredados_de_la_forma_anterior(paquete: dict[str, Any]) -> list[tuple[str, str, Estado]]:
    """Lo que el paquete sin versión tenía por enlazado y por oculto, sin código por enlace.

    Enlazados, los programas que daba por buenos; ocultos, las webs rotas y los cursos fuera de la oferta. Las webs que
    «no respondieron» una vez nunca se ocultaron y no se heredan.

    Returns:
        Los estados por (conjunto, clave).
    """
    programas, webs, cursos = paquete["programas"], paquete["webs"], paquete["cursos"]
    return [
        *(
            (PROGRAMAS, codigo, estado_heredado(f"{programas['comprobado']}T00:00:00+00:00"))
            for codigo in programas["codigos"]
        ),
        *((WEBS, web, estado_heredado(f"{webs['comprobado']}T00:00:00+00:00", oculto=True)) for web in webs["rotas"]),
        *(
            (CURSOS, curso, estado_heredado(f"{cursos['comprobado']}T00:00:00+00:00", oculto=True))
            for curso in cursos["fuera_de_la_oferta"]
        ),
    ]


def _heredados_de_la_forma_actual(paquete: dict[str, Any]) -> list[tuple[str, str, Estado]]:
    """Lo que el paquete con observaciones tenía por enlazado y por oculto: lo oculto conserva su evidencia.

    Returns:
        Los estados por (conjunto, clave).
    """
    programas = paquete["programas"]
    return [
        *(
            (PROGRAMAS, codigo, estado_heredado(f"{programas['comprobado']}T00:00:00+00:00"))
            for codigo in programas["codigos"]
        ),
        *((WEBS, oculta["url"], estado_con_evidencia(oculta)) for oculta in paquete["webs"]["ocultas"]),
        *((CURSOS, oculto["id"], estado_con_evidencia(oculto)) for oculto in paquete["cursos"]["ocultos"]),
    ]


def _heredados() -> list[tuple[str, str, Estado]]:
    """Lo que el paquete publicado tiene por enlazado y por oculto, para arrancar sin observaciones propias.

    Returns:
        Los estados por (conjunto, clave); vacío si el paquete no existe.

    Raises:
        FormatoInesperado: Si el paquete publicado no tiene una forma conocida.
    """
    ruta = PAQUETE / "enlaces-comprobados.json"
    if not ruta.is_file():
        return []
    paquete = leer_json(ruta)
    try:
        if isinstance(paquete, dict) and paquete.get("version") == VERSION_DEL_PAQUETE:
            return _heredados_de_la_forma_actual(paquete)
        return _heredados_de_la_forma_anterior(paquete)  # type: ignore[arg-type]
    except (KeyError, TypeError) as error:
        raise FormatoInesperado("enlaces: el paquete publicado no tiene una forma conocida") from error


def _estado_previo(candidatos_del_ciclo: list[Candidato]) -> Observaciones:
    """Las observaciones guardadas por el ciclo anterior o, la primera vez, lo que el paquete publicado daba por hecho.

    Returns:
        El estado por conjunto y dirección.
    """
    ruta = ORIGINAL / OBSERVACIONES
    if ruta.is_file():
        guardado = leer_json(original(FUENTE, OBSERVACIONES))
        exigir(isinstance(guardado, dict) and guardado.get("version") == VERSION, "enlaces: observaciones sin versión")
        return {conjunto: dict(guardado["enlaces"].get(conjunto, {})) for conjunto in CONJUNTOS}
    estado: Observaciones = {conjunto: {} for conjunto in CONJUNTOS}
    por_clave = {(c.conjunto, c.clave): c for c in candidatos_del_ciclo}
    for conjunto, clave, heredado in _heredados():
        if (conjunto, clave) in por_clave:
            estado[conjunto][por_clave[conjunto, clave].url] = heredado
    return estado


def _escribir_observaciones(estado: Observaciones, ciclo: dict[str, Any]) -> None:
    ORIGINAL.mkdir(parents=True, exist_ok=True)
    datos = (json_compacto({"version": VERSION, "ciclo": ciclo, "enlaces": estado}) + "\n").encode()
    escribir_bytes_entero(ORIGINAL / OBSERVACIONES, datos)
    entrada = {
        "archivo": OBSERVACIONES,
        "titulo": "Observaciones de los enlaces de la formación",
        "bytes": len(datos),
        "sha256": sha256_bytes(datos),
        "descargado_utc": ciclo["terminado_utc"],
    }
    guardar_json(PROCEDENCIA, {"archivos": [entrada]})


def comprobar_ciclo(  # noqa: PLR0913 - Los topes y las dependencias de un ciclo, con nombre, para poder probarlo.
    candidatos_del_ciclo: list[Candidato],
    previo: Observaciones,
    pedir: Consultar,
    *,
    max_consultas: int | None = None,
    plazo_s: float | None = None,
    reloj: Callable[[], float] = time.monotonic,
    expuestos_hoy: frozenset[tuple[str, str]] = frozenset(),
    hoy: datetime | None = None,
    porcion: Porcion = PORCION,
) -> tuple[Observaciones, dict[str, Any]]:
    """Consulta la porción del ciclo hasta el tope de consultas o el plazo y anota cada observación.

    Los enlaces que ya no son candidatos dejan de guardarse. Un enlace sin consultar en este ciclo conserva su estado.
    En un dominio con anomalía (`porcion.dominios_con_anomalia`), sus 404 y 410 se anotan sin concluir.

    Args:
        candidatos_del_ciclo: Los enlaces que Faro enseña hoy.
        previo: Las observaciones del ciclo anterior.
        pedir: Consulta una dirección de un conjunto y devuelve su observación.
        max_consultas: El tope de consultas del ciclo; por omisión, el de la fecha del ciclo (`porcion.topes_del_dia`).
        plazo_s: El tiempo máximo del ciclo, en segundos; por omisión, el de la fecha del ciclo.
        reloj: Un reloj monótono, para las pruebas.
        expuestos_hoy: Los (conjunto, dirección) que la persona ve hoy junto a un curso publicado.
        hoy: El instante del ciclo, en UTC; por omisión, ahora.
        porcion: Los demás topes del ciclo: antigüedad de lo expuesto, muestra de fichas y anomalía de dominio.

    Returns:
        Las observaciones nuevas y lo que hizo el ciclo: consultas, enlaces sin consultar, por qué se cortó, qué
        dominios se saltó por responder tres veces seguidas 403 o 429, cuáles tuvieron anomalía y cuánto de lo
        expuesto quedó sin comprobar dentro de su antigüedad máxima.
    """
    instante = hoy or datetime.now(UTC)
    tope_del_dia, plazo_del_dia = topes_del_dia(porcion, instante)
    max_consultas = tope_del_dia if max_consultas is None else max_consultas
    plazo_s = plazo_del_dia if plazo_s is None else plazo_s
    estado: Observaciones = {conjunto: {} for conjunto in CONJUNTOS}
    for candidato in candidatos_del_ciclo:
        guardado = previo[candidato.conjunto].get(candidato.url)
        if guardado is not None:
            estado[candidato.conjunto][candidato.url] = guardado
    orden = orden_de_la_porcion(candidatos_del_ciclo, estado, expuestos_hoy, instante, porcion)
    limite = reloj() + plazo_s
    corte = None
    hechas: list[tuple[Candidato, dict[str, Any]]] = []
    seguidos: dict[str, int] = {}
    frenados: set[str] = set()
    for candidato in orden.por_consultar:
        if len(hechas) >= max_consultas:
            corte = TOPE
            break
        if reloj() >= limite:
            corte = PLAZO
            break
        dominio = urlsplit(candidato.url).hostname or ""
        if dominio in frenados:
            continue
        nueva = pedir(candidato.url, candidato.conjunto)
        hechas.append((candidato, nueva))
        seguidos[dominio] = seguidos.get(dominio, 0) + 1 if nueva["codigo_http"] in CODIGOS_DE_LIMITE else 0
        if seguidos[dominio] >= LIMITES_SEGUIDOS:
            frenados.add(dominio)
    anomalos = dominios_con_anomalia(((c.url, estado[c.conjunto].get(c.url), n) for c, n in hechas), porcion)
    for candidato, nueva in hechas:
        if nueva["resultado"] == NO_EXISTE and (urlsplit(candidato.url).hostname or "") in anomalos:
            nueva = observacion(
                nueva["observado_el"], nueva["codigo_http"], nueva["url_final"], motivo=ANOMALIA_DE_DOMINIO
            )
        estado[candidato.conjunto][candidato.url] = anotar(estado[candidato.conjunto].get(candidato.url), nueva)
    ciclo = {
        "terminado_utc": datetime.now(UTC).replace(microsecond=0).isoformat(),
        "candidatos": len(orden.por_consultar),
        "consultadas": len(hechas),
        "sin_consultar": len(orden.por_consultar) - len(hechas),
        "corte": corte,
        "dominios_con_limite": sorted(frenados),
        "dominios_con_anomalia": sorted(anomalos),
        "fichas_fuera_de_la_muestra": orden.fichas_fuera_de_la_muestra,
        "dia_largo": es_dia_largo(porcion, instante),
        **vencimientos_tras_el_ciclo(candidatos_del_ciclo, estado, expuestos_hoy, instante, porcion),
    }
    return estado, ciclo


def descargar(_aceptar_cambio: bool = False) -> None:
    """Consulta el ciclo de enlaces y guarda sus observaciones con su procedencia.

    Args:
        _aceptar_cambio: La opción común de las descargas. Aquí no hay un original que proteger: cada ciclo reescribe
            las observaciones con lo nuevo y conserva lo anterior de lo que no consulta.
    """
    # La fecha del ciclo decide si es el día de la pasada larga; se toma una vez y se pasa al ciclo como dato.
    hoy = datetime.now(UTC)
    consorci, formacion = _origenes()
    candidatos_del_ciclo = candidatos(consorci, formacion)
    previo = _estado_previo(candidatos_del_ciclo)
    estado, ciclo = comprobar_ciclo(
        candidatos_del_ciclo,
        previo,
        consulta.consultar,
        max_consultas=MAX_CONSULTAS_DIA_LARGO if es_dia_largo(PORCION, hoy) else MAX_CONSULTAS,
        plazo_s=PLAZO_S_DIA_LARGO if es_dia_largo(PORCION, hoy) else PLAZO_S,
        hoy=hoy,
        expuestos_hoy=expuestos(consorci, formacion),
    )
    _escribir_observaciones(estado, ciclo)
    print(
        f"{ciclo['consultadas']} consultas de {ciclo['candidatos']} enlaces"
        + (f"; ciclo cortado por {ciclo['corte']}" if ciclo["corte"] else "")
        + (
            f"; dominios saltados por sus límites: {', '.join(ciclo.get('dominios_con_limite', []))}"
            if ciclo.get("dominios_con_limite", [])
            else ""
        )
        + (
            f"; dominios con anomalía: {', '.join(ciclo['dominios_con_anomalia'])}"
            if ciclo["dominios_con_anomalia"]
            else ""
        )
    )


def _dia(instante: str) -> str:
    return instante[:10]


def conjunto_del_paquete(candidatos_del_ciclo: list[Candidato], estado: Observaciones) -> dict[str, Any]:
    """Lo que enseña el paquete: los programas enlazados y los enlaces ocultos, cada uno con su evidencia.

    Returns:
        Los tres conjuntos. `comprobado` de los programas es el día de la comprobación más antigua de los enlazados.
    """
    por_conjunto = {c: [x for x in candidatos_del_ciclo if x.conjunto == c] for c in CONJUNTOS}
    programas = [c for c in por_conjunto[PROGRAMAS] if esta_visible_el_programa(estado[PROGRAMAS].get(c.url))]
    dias_programas = [_dia(estado[PROGRAMAS][c.url]["concluyente"]["observado_el"]) for c in programas]
    ocultos = {
        conjunto: [
            {**evidencia(c.url, estado[conjunto][c.url]), **({"id": c.clave} if conjunto == CURSOS else {})}
            for c in por_conjunto[conjunto]
            if esta_oculto(estado[conjunto].get(c.url))
        ]
        for conjunto in (WEBS, CURSOS)
    }
    return {
        "programas": {
            "comprobado": min(dias_programas, default=None),
            "candidatas": len(por_conjunto[PROGRAMAS]),
            "codigos": sorted(c.clave for c in programas),
        },
        "webs": {
            "comprobado": _ultimo_dia(estado[WEBS]),
            "candidatas": len(por_conjunto[WEBS]),
            "ocultas": sorted(ocultos[WEBS], key=lambda e: e["url"]),
        },
        "cursos": {
            "comprobado": _ultimo_dia(estado[CURSOS]),
            "candidatos": len(por_conjunto[CURSOS]),
            "ocultos": sorted(ocultos[CURSOS], key=lambda e: e["id"]),
        },
    }


def _ultimo_dia(estados: dict[str, Estado]) -> str | None:
    observaciones = [e["ultima"] or e["concluyente"] for e in estados.values()]
    dias = [_dia(o["observado_el"]) for o in observaciones if o is not None]
    return max(dias, default=None)


def cifras(candidatos_del_ciclo: list[Candidato], estado: Observaciones) -> dict[str, int]:
    """Los recuentos que lee el panel: enlaces con una consulta propia concluyente, ocultos y sin comprobar.

    Returns:
        `comprobados`, `ocultos` y `sin_comprobar`; los programas no enlazados que respondieron otra cosa no se ocultan.
    """
    comprobados = sum(tiene_consulta_propia(estado[c.conjunto].get(c.url)) for c in candidatos_del_ciclo)
    ocultos = sum(c.conjunto != PROGRAMAS and esta_oculto(estado[c.conjunto].get(c.url)) for c in candidatos_del_ciclo)
    return {"comprobados": comprobados, "ocultos": ocultos, "sin_comprobar": len(candidatos_del_ciclo) - comprobados}


def _controles(controles: Controles, candidatos_del_ciclo: list[Candidato], observaciones: dict[str, Any]) -> None:
    estado = observaciones["enlaces"]
    controles.comprobar(
        observaciones.get("version") == VERSION and set(estado) == set(CONJUNTOS),
        "las observaciones tienen la versión esperada y los tres conjuntos",
    )
    direcciones = {
        c.conjunto: {x.url for x in candidatos_del_ciclo if x.conjunto == c.conjunto} for c in candidatos_del_ciclo
    }
    controles.comprobar(
        all(set(estado[conjunto]) <= direcciones.get(conjunto, set()) for conjunto in CONJUNTOS),
        "toda observación es de un enlace que Faro enseña hoy",
    )
    propias = [e["ultima"] for conjunto in CONJUNTOS for e in estado[conjunto].values() if e["ultima"] is not None]
    controles.comprobar(
        all(o["resultado"] in RESULTADOS and (o["codigo_http"] is not None or o["motivo"]) for o in propias),
        "cada consulta propia guarda su código HTTP o el motivo por el que no lo hay",
    )
    controles.comprobar(
        all(e["ultima"]["observado_el"] for conjunto in CONJUNTOS for e in estado[conjunto].values() if e["ultima"]),
        "cada consulta propia guarda su fecha",
    )
    ocultos = [e for conjunto in (WEBS, CURSOS) for e in estado[conjunto].values() if esta_oculto(e)]
    controles.comprobar(
        all(e["concluyente"]["codigo_http"] in (404, 410) or es_heredado(e) for e in ocultos),
        "solo un 404 o un 410 observados ocultan un enlace, salvo lo heredado del paquete anterior sin consulta propia",
    )
    controles.comprobar(
        all(estado[conjunto] for conjunto in CONJUNTOS if direcciones.get(conjunto)),
        "cada conjunto con enlaces tiene alguna observación",
    )


def preparar() -> None:
    """Compone, de las observaciones, lo que enseña el paquete y los recuentos del panel."""
    observaciones = leer_json(original(FUENTE, OBSERVACIONES))
    exigir(isinstance(observaciones, dict), "enlaces: las observaciones deben ser un objeto JSON")
    candidatos_del_ciclo = _fuentes_del_paquete()
    estado = observaciones["enlaces"]
    guardar_json(
        PREPARADO / "enlaces.json",
        {
            "paquete": conjunto_del_paquete(candidatos_del_ciclo, estado),
            "cifras": cifras(candidatos_del_ciclo, estado),
            "ciclo": observaciones["ciclo"],
        },
    )
    print(f"{len(candidatos_del_ciclo)} enlaces; {observaciones['ciclo']['consultadas']} consultas en el ciclo")


def validar() -> None:
    """Comprueba las observaciones y guarda el conjunto que se publica en el paquete."""
    observaciones = leer_json(original(FUENTE, OBSERVACIONES))
    preparado = leer_json(PREPARADO / "enlaces.json")
    exigir(
        isinstance(observaciones, dict) and isinstance(preparado, dict),
        "enlaces: observaciones y preparado son objetos",
    )
    candidatos_del_ciclo = _fuentes_del_paquete()
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, leer_json(PROCEDENCIA))
    _controles(controles, candidatos_del_ciclo, observaciones)
    controles.comprobar(
        preparado["paquete"] == conjunto_del_paquete(candidatos_del_ciclo, observaciones["enlaces"]),
        "lo preparado sale de las observaciones guardadas",
    )
    ciclo = observaciones["ciclo"]
    informe: dict[str, Any] = {
        "estado": controles.estado,
        "comprobado_utc": ciclo["terminado_utc"],
        "observaciones_sha256": sha256_bytes((ORIGINAL / OBSERVACIONES).read_bytes()),
        "cobertura": {
            **preparado["cifras"],
            "candidatos": ciclo["candidatos"],
            "consultadas": ciclo["consultadas"],
            **{campo: ciclo[campo] for campo in CAMPOS_DE_LA_PORCION if campo in ciclo},
        },
        "limites": (
            "Un enlace se oculta solo con un 404 o un 410 observados; un fallo de red, un plazo o un 5xx conservan lo "
            "observado antes. Los enlaces que no caben en el tope de un ciclo se consultan en los siguientes."
        ),
        "controles": controles.lista,
    }
    motivos = [
        *([ciclo["corte"]] if ciclo["corte"] is not None else []),
        *([DOMINIO_CON_LIMITE] if ciclo.get("dominios_con_limite", []) else []),
    ]
    if motivos:
        informe["consulta_parcial"] = {"motivo": ", ".join(motivos)}
    cerrar_validacion(FUENTE, informe, controles, lambda: {"version": VERSION_DEL_PAQUETE, **preparado["paquete"]})


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

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
