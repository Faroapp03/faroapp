"""La lectura de la preinscripción de FUNDAE (catálogo 3): lo que cada descarga de fichas deja dicho en el registro.

El índice de formación subvencionada dice qué especialidades en teleformación están abiertas; de cada una se pide la
ficha de difusiones (`descarga.py`). Cada difusión es una edición con su plazo de preinscripción. Al terminar la
descarga se emite una sola lectura, la de las ediciones, con el identificador que tienen en el catálogo
(`fundae:edicion:<id>`). Solo se registra: nada de lo que se publica cambia.

Decisiones de esta fuente (las demás están en `lecturas/como-engancha-una-fuente-su-lectura.md`):

- Ámbito: `fundae:preinscripcion`, cada difusión con su preinscripción abierta el día de su ficha, también si Faro la
  descarta por otra razón (sin programa oficial, sin entidad): llegó en la captura y no debe parecer una salida.
- Hora: el fin de la consulta del índice, que abre la descarga.
- Censo incompleto: la descarga se cortó por su tope de consultas o de tiempo (`limite_alcanzado`) o alguna ficha no
  respondió (`consulta_fallida`). Con el índice caído no hay censo y no se emite nada.
- Total declarado: ninguno; el índice no dice cuántas ediciones hay.
- Vigente: las ediciones que Faro lee completas (`ediciones.leer`), las que puede publicar.
- Forma: nivel `edicion`; rutas `edicion.<campo>` de las filas de difusiones de toda la captura.
- Vocabularios cerrados que la fuente ya valida: el nombre de cada área de interés que acota la consulta
  (`ediciones.AREAS`) y los colectivos (`hechos.COLECTIVOS`).
- Qué explica una salida: su plazo de preinscripción vencido en la ficha de hoy (`fin_publicado`). El catálogo 3 no
  publica bajas: una edición que desaparece de la ficha sin plazo vencido queda sin explicar.
- Declaraciones para la regla de retirada: el fin de la preinscripción de cada edición presente.

La hora de la lectura es la de la captura, nunca la del reloj.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos.fuentes.fundae import ediciones, hechos, lectura
from plataforma_datos.cursos.lecturas.contrato_lectura import FORMATO_INSTANTE, ValorNuevo, huella_de_ids
from plataforma_datos.cursos.lecturas.emision import Censo, emitir_lectura
from plataforma_datos.cursos.retirada_por_evidencia import Declaracion
from plataforma_datos.cursos.tipos_json import ObjetoJson

AMBITO = "fundae:preinscripcion"
PREFIJO = "fundae:edicion:"
NIVELES = ("edicion",)
CAMPO_AREA = "indice.descripcionAreasInteres."
CAMPO_COLECTIVO = "colectivo."


@dataclass(frozen=True, kw_only=True)
class Captura:
    """Lo que dejó la descarga: lo que leyó `ediciones.leer` y, tal cual, las filas de difusiones y de colectivos."""

    leida: dict[str, Any]
    filas: dict[str, dict[str, Any]]
    colectivos: tuple[dict[str, Any], ...]


def capturar(fundae: Path, documento: dict[str, Any]) -> Captura:
    """Lee lo conservado por la descarga: sus ediciones, las filas de cada ficha de difusiones y las de colectivos.

    Returns:
        La captura.

    Raises:
        FormatoInesperado: Si lo conservado no es una captura íntegra de FUNDAE.
    """
    carpeta = fundae / ediciones.CARPETA
    filas, colectivos = {}, []
    for entrada in documento["especialidades"]:
        dato, _ = ediciones.respuesta(carpeta, entrada["difusiones"], ediciones.url_difusiones(entrada["codigo"]))
        try:
            for fila in [] if dato is None else hechos.difusiones(dato):
                filas[str(fila["idDifusionAccionFormativa"])] = fila
        except FormatoInesperado:
            continue
        for id, captura in entrada["colectivos"].items():
            lista, _ = ediciones.respuesta(carpeta, captura, ediciones.url_colectivos(int(id)))
            if isinstance(lista, list):
                colectivos.extend(fila for fila in lista if isinstance(fila, dict))
    return Captura(leida=ediciones.leer(fundae, documento), filas=filas, colectivos=tuple(colectivos))


def _abiertas(leida: dict[str, Any]) -> set[str]:
    """Las difusiones con la preinscripción abierta el día de su ficha, y las que llegaron sin un plazo legible.

    Returns:
        Sus identificadores nativos.
    """
    abiertas = {id for id, p in leida["plazos"].items() if p["inicio"] <= p["dia"] <= p["fin"]}
    sin_plazo = {d["id"] for d in leida["descartadas"] if d["id"] is not None and d["id"] not in leida["plazos"]}
    return abiertas | sin_plazo


def _ids(captura: Captura) -> frozenset[str]:
    return frozenset(PREFIJO + id for id in _abiertas(captura.leida))


def _rutas_de_campos(captura: Captura) -> tuple[str, ...]:
    return tuple(sorted({"edicion." + campo for fila in captura.filas.values() for campo in fila}))


def _valores_nuevos(captura: Captura) -> tuple[ValorNuevo, ...]:
    """Lo que la captura trae en los dos vocabularios cerrados que la fuente valida y no reconoce.

    Returns:
        Los valores nuevos, ordenados y sin repetir.
    """
    nuevos = set()
    for id, nombres in (captura.leida["areas"] or {}).items():
        nuevos.update((CAMPO_AREA + str(id), nombre) for nombre in nombres if nombre != ediciones.AREAS[id])
    for fila in captura.colectivos:
        conocido = hechos.COLECTIVOS.get(fila.get("idColectivo"))
        if conocido is None:
            nuevos.add((CAMPO_COLECTIVO + "idColectivo", str(fila.get("idColectivo"))))
        elif fila.get("descripcionColectivos") != conocido[1]:
            nuevos.add((CAMPO_COLECTIVO + "descripcionColectivos", str(fila.get("descripcionColectivos"))))
    return tuple(ValorNuevo(campo=campo, valor=valor) for campo, valor in sorted(nuevos))


def _incompleta(leida: dict[str, Any]) -> str | None:
    """Por qué la descarga no cubre todas las especialidades del índice, si no las cubre.

    Returns:
        `limite_alcanzado` si se cortó por su tope, `consulta_fallida` si alguna ficha no respondió, o None.
    """
    if leida["corte"]:
        return "limite_alcanzado"
    return "consulta_fallida" if leida["fallidas"] else None


def _instante(texto: str) -> str:
    return datetime.fromisoformat(texto).astimezone(UTC).strftime(FORMATO_INSTANTE)


def _explicar(leida: dict[str, Any]) -> Callable[[str], str | None]:
    """Explica la salida de una edición cuyo plazo de preinscripción ya venció en la ficha de hoy.

    Returns:
        La función que la emisión aplica a cada edición que sale.
    """

    def explicar(id: str) -> str | None:
        plazo = leida["plazos"].get(id.removeprefix(PREFIJO))
        return "fin_publicado" if plazo is not None and plazo["fin"] < plazo["dia"] else None

    return explicar


def censo_de_ediciones(captura: Captura) -> Censo:
    """El censo de las ediciones de la descarga.

    El bruto son todas las difusiones de las fichas que respondieron, abiertas o no.

    Returns:
        El censo listo para emitir.
    """
    leida = captura.leida
    motivo = _incompleta(leida)
    return Censo(
        fuente=lectura.FUENTE,
        ambito=AMBITO,
        observado_utc=_instante(leida["indice"]["consultado_utc"]),
        completa=motivo is None,
        motivo_incompleta=motivo,
        ids=_ids(captura),
        recuento_bruto=len(set(leida["plazos"]) | _abiertas(leida)),
        recuento_vigente=len(leida["ediciones"]),
        niveles=NIVELES,
        rutas_de_campos=_rutas_de_campos(captura),
        valores_nuevos=_valores_nuevos(captura),
        explicar_salida=_explicar(leida),
    )


def _preparar(fundae: Path, documento: dict[str, Any]) -> tuple[Path, Censo]:
    """Lee lo conservado y lo convierte en lo que sabe la emisión.

    Returns:
        La raíz de la instalación y el censo de ediciones.

    Raises:
        ErrorLecturaFundae: Si el índice no respondió: sin él no hay censo.
    """
    raiz = lectura.raiz_de(fundae / lectura.CANAL)
    captura = capturar(fundae, documento)
    if captura.leida["indice_caido"]:
        raise lectura.ErrorLecturaFundae("el índice del catálogo 3 no respondió")
    return raiz, censo_de_ediciones(captura)


def emitir(fundae: Path, documento: dict[str, Any]) -> lectura.Resultado:
    """Emite la lectura de las ediciones de una descarga recién terminada.

    El registro es telemetría: si algo impide emitirla, se dice en el resultado y la adquisición sigue como habría
    seguido. Solo se recogen los errores de los datos y del disco; un defecto del código no se esconde.

    Returns:
        La lectura emitida y los problemas, si los hubo.
    """
    try:
        raiz, censo = _preparar(fundae, documento)
    except (OSError, ValueError, FormatoInesperado) as error:
        problema = f"la lectura de la preinscripción no se pudo preparar ({error})"
        return lectura.Resultado(emisiones=(), problemas=(problema,))
    try:
        emision = emitir_lectura(raiz, censo)
    except (OSError, ValueError) as error:
        return lectura.Resultado(emisiones=(), problemas=(f"la lectura de {AMBITO} no se pudo emitir ({error})",))
    return lectura.Resultado(emisiones=(emision,), problemas=emision.problemas)


def _cierre(fin: str) -> str:
    """El instante en que cierra una preinscripción: el comienzo del día siguiente a su último día, en España.

    Returns:
        El instante en UTC y al segundo.
    """
    dia = datetime.strptime(fin, "%Y-%m-%d").replace(tzinfo=hechos.ZONA) + timedelta(days=1)
    return dia.astimezone(UTC).strftime(FORMATO_INSTANTE)


def declaraciones(lectura_emitida: ObjetoJson, captura: Captura) -> dict[str, tuple[Declaracion, ...]]:
    """El fin de la preinscripción de cada edición de una lectura, para la regla de retirada.

    La captura tiene que ser la de esa lectura: sus ediciones presentes deben dar la huella de identificadores de la
    lectura. Cada declaración lleva la huella de los dos campos literales de la ficha que dicen el plazo.

    Returns:
        Las declaraciones por identificador de edición; una sin plazo legible no aparece.

    Raises:
        ErrorLecturaFundae: Si la lectura no es la de la preinscripción de FUNDAE o no es la de esa captura.
    """
    if lectura_emitida["fuente"] != lectura.FUENTE or lectura_emitida["ambito"] != AMBITO:
        raise lectura.ErrorLecturaFundae("las declaraciones salen de una lectura de la preinscripción de FUNDAE")
    if huella_de_ids(_ids(captura)) != lectura_emitida["ids_sha256"]:
        raise lectura.ErrorLecturaFundae("la captura no es la de esta lectura")
    declaradas = {}
    for id in sorted(_abiertas(captura.leida) & set(captura.leida["plazos"])):
        fila = captura.filas[id]
        literal = {c: fila.get(c) for c in ("fechaPreinscripcionInicio", "fechaPreinscripcionFin")}
        declaradas[PREFIJO + id] = (
            Declaracion(
                lectura_id=lectura_emitida["lectura_id"],
                canal="fin_publicado",
                sha256=sha256_json(literal),
                cierra_el=_cierre(captura.leida["plazos"][id]["fin"]),
            ),
        )
    return declaradas
