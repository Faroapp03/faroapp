"""FUNDAE: ediciones en teleformación de la oferta estatal de formación subvencionada para personas trabajadoras.

FUNDAE (Fundación Estatal para la Formación en el Empleo) publica en su buscador, sin registro, las ediciones de los
cursos gratuitos que financia el SEPE para toda España: quién los imparte, el plazo de preinscripción y a qué colectivos
se dirigen. FUNDAE no publica una licencia de reutilización de su API. Faro guarda solo hechos de cada edición, con el
enlace oficial; nunca los contactos (correos, teléfonos, direcciones y CIF) que trae la API, y un control para la
validación si alguno se cuela.

Las ediciones salen del canal diario: el índice público de formación subvencionada que consulta catalogos/ descubre
las especialidades en teleformación con la inscripción abierta, y ediciones.py consulta la ficha de cada una y de cada
edición abierta (fundae/ediciones/). Cada edición publicada lleva en la validación la evidencia de su índice y de sus
tres fichas (cuerpo, recibo, huella y hora). salida.py aplica las reglas de vigencia: una ausencia o un fallo de
consulta conservan la edición con su prueba. La retirada requiere un plazo individual que acredite el cierre.
Un índice caído conserva la salida anterior y consta como consulta parcial. Un plazo abierto permite solicitar plaza.

Uso: python3 -m plataforma_datos.cursos.fuentes.fundae.lector {descargar,preparar,validar,todo}
"""

import hashlib
import json
import sys
from collections.abc import Callable
from http import HTTPStatus
from typing import Any

from plataforma_datos.comun.entrada_salida import ahora_utc, carpetas, guardar_json, leer_json
from plataforma_datos.comun.nucleo import ADMITIDO, CON_ERRORES, RAIZ, Controles, FormatoInesperado, exigir
from plataforma_datos.cursos import operacion_fuente
from plataforma_datos.cursos.fuentes.fundae import adquisicion, auditoria_preinscripcion, ediciones, hechos, salida
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "fundae"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
# Lo que escribe preparar y lee validar.
LEIDAS = PREPARADO / "ediciones.json"
# Motivos de una consulta parcial que escribe este lector (además de los de corte de descarga.py).
INDICE_CAIDO, FICHAS_FALLIDAS = "indice-caido", "fichas-fallidas"
MOTIVOS = frozenset({INDICE_CAIDO, FICHAS_FALLIDAS})

BUSCADOR = "https://experienciafundae.es/formacion-subvencionada"
CONDICIONES = "https://www.fundae.es/trabajadores"
LIMITES = (
    "Ediciones descubiertas en el índice público de formación subvencionada, cada una con su ficha consultada. Un "
    "plazo abierto no garantiza plaza, y la fecha de inicio de las clases no se publica. Un curso sectorial es para "
    "quien trabaja en una empresa de ese sector."
)


def _dia_es(dia: str) -> str:
    return f"{dia[8:]}/{dia[5:7]}/{dia[:4]}"


def cita(desde: str, hasta: str) -> str:
    """La cita de la fuente, con los días que acredita la evidencia publicada, escritos como en castellano.

    Args:
        desde: El día (AAAA-MM-DD) de la ficha más antigua de la que sale lo publicado.
        hasta: El de la más reciente.

    Returns:
        La cita: «consultadas el D» si coinciden; «consultadas entre el A y el B» si no.
    """
    cuando = f"el {_dia_es(desde)}" if desde == hasta else f"entre el {_dia_es(desde)} y el {_dia_es(hasta)}"
    return (
        "FUNDAE (Fundación Estatal para la Formación en el Empleo): ediciones en teleformación de la oferta de "
        f"formación subvencionada para personas trabajadoras, consultadas {cuando}."
    )


def dias_de_la_evidencia(ediciones: list[dict[str, Any]], evidencias: dict[str, Any]) -> list[str]:
    """Los días civiles de las fichas de las que sale lo publicado (difusiones, entidad y colectivos de cada edición).

    Así la cita no rejuvenece lo conservado ni lo que sale de una ficha reutilizada.

    Returns:
        Los días, ordenados y sin repetir.
    """
    return sorted(
        {
            hechos.dia_civil(evidencias[e["id"]][ficha]["consultado_utc"])
            for e in ediciones
            for ficha in ("difusiones", "centro", "colectivos")
        }
    )


def descargar(aceptar_cambio: bool = False) -> None:
    """Consulta los índices públicos (catalogos/) y, del índice recibido, las fichas de sus ediciones abiertas.

    El registro común de adquisiciones (`adquisicion_por_fuente`) encadena las dos consultas.

    Args:
        aceptar_cambio: Si se acepta un original que ya no coincide con su procedencia (`--aceptar-cambio`).
    """
    operacion_fuente.descargar(FUENTE, aceptar_cambio)


def anterior() -> dict[str, Any] | None:
    """Las ediciones y evidencias de la última salida admitida, para no dar de baja lo que no se ha observado.

    Returns:
        Conjunto, ediciones y evidencias anteriores, o None si nunca se admitió.
    """
    if not (VALIDADO / "validacion.json").is_file():
        return None
    informe = leer_json(VALIDADO / "validacion.json")
    if not str(informe.get("estado", "")).startswith(ADMITIDO):
        return None
    conjunto = leer_json(VALIDADO / f"{FUENTE}.json")
    return {"conjunto": conjunto, "ediciones": conjunto["ediciones"], "evidencias": informe.get("evidencias", {})}


def componer_preparado(lectura: dict[str, Any], previa: dict[str, Any] | None) -> dict[str, Any]:
    """Lo que preparar deja para validar: la salida nueva o, con el índice caído, la anterior tal cual.

    Returns:
        Conjunto, evidencias, lo conservado y retirado, y la consulta parcial si la hubo.

    Raises:
        FormatoInesperado: Si el índice cayó y no hay una salida anterior que conservar.
    """
    if lectura["indice_caido"]:
        exigir(previa is not None, "Índice FUNDAE caído sin salida anterior que conservar", FormatoInesperado)
        return {
            "conjunto": previa["conjunto"],
            "evidencias": previa["evidencias"],
            "conservadas": sorted(e["id"] for e in previa["ediciones"]),
            "retiradas": [],
            "indice": lectura["indice"],
            "consulta_parcial": {"motivo": INDICE_CAIDO, "indice": lectura["indice"]},
        }
    compuesta = salida.componer(lectura, previa)
    consulta = hechos.dia_civil(lectura["indice"]["consultado_utc"])
    dias = dias_de_la_evidencia(compuesta["ediciones"], compuesta["evidencias"])
    preparado = {
        "conjunto": {
            "cita": cita(dias[0], dias[-1]) if dias else cita(consulta, consulta),
            "consulta": consulta,
            "buscador": BUSCADOR,
            "condiciones": CONDICIONES,
            "ediciones": compuesta["ediciones"],
        },
        "evidencias": compuesta["evidencias"],
        "conservadas": compuesta["conservadas"],
        "retiradas": compuesta["retiradas"],
        "indice": lectura["indice"],
    }
    parcial = consulta_parcial(lectura)
    if parcial:
        preparado["consulta_parcial"] = parcial
    preparado.update(areas=lectura["areas"], a_revisar=lectura["a_revisar"])
    if lectura["descartadas"]:
        preparado["descartadas"] = lectura["descartadas"]
    return preparado


def consulta_parcial(lectura: dict[str, Any]) -> dict[str, Any] | None:
    """Por qué una consulta con el índice respondido no cubre todas sus fichas: fallos, corte por tope.

    Returns:
        Los motivos con su detalle, o None si se leyeron todas.
    """
    motivos = {}
    if lectura["fallidas"]:
        motivos[FICHAS_FALLIDAS] = lectura["fallidas"]
    if lectura["corte"]:
        motivos[lectura["corte"]["motivo"]] = lectura["sin_consultar"]
    if not motivos:
        return None
    return {"motivo": ", ".join(motivos), "fichas": lectura["fallidas"], "sin_consultar": lectura["sin_consultar"]}


def preparar() -> None:
    """Lee el índice y las fichas conservadas y compone las ediciones con la salida anterior."""
    documento = leer_json(ORIGINAL / ediciones.CARPETA / "procedencia.json")
    preparado = componer_preparado(ediciones.leer(ORIGINAL, documento), anterior())
    guardar_json(LEIDAS, preparado)
    print(f"{len(preparado['conjunto']['ediciones'])} ediciones de FUNDAE")
    operacion_fuente.preparar(FUENTE)


def evidencia_conservada(evidencias: dict[str, Any], identificador: str) -> bool:
    """Si las cuatro consultas de una edición tienen evidencia y sus cuerpos y recibos siguen conservados intactos.

    Returns:
        True si la evidencia está completa y cada archivo citado conserva su huella.
    """
    if not salida.con_evidencia(evidencias, identificador):
        return False
    for nombre, prueba in evidencias[identificador].items():
        carpeta = ORIGINAL / (operacion_fuente.CANALES[FUENTE] if nombre == "indice" else ediciones.CARPETA)
        for referencia in (prueba["cuerpo"], prueba["recibo"]):
            try:
                operacion_fuente.leer_conservado(carpeta, referencia)
            except (FormatoInesperado, OSError):
                return False
    return True


def controlar(
    controles: Controles,
    preparado: dict[str, Any],
    *,
    conservada: Callable[[dict[str, Any], str], bool] = evidencia_conservada,
) -> None:
    """Cada edición única, con plazo abierto el día del índice, colectivos, evidencia de sus fichas y sin contactos.

    Args:
        controles: Donde se anotan los controles.
        preparado: Lo que deja `componer_preparado`.
        conservada: Cómo se comprueba la evidencia de una edición (por omisión, también sus archivos).
    """
    publicadas = preparado["conjunto"]["ediciones"]
    indice_respondido = preparado.get("indice", {}).get("http") == HTTPStatus.OK
    retiradas = preparado.get("retiradas", [])
    cierres = retiradas and all(r["motivo"] in ("plazo-vencido", "plazo-no-abierto-en-su-ficha") for r in retiradas)
    cero_acreditado = indice_respondido and (not preparado.get("consulta_parcial") or cierres)
    controles.comprobar(bool(publicadas) or cero_acreditado, f"ediciones o cierre verificables ({len(publicadas)})")
    controles.comprobar(
        len({e["id"] for e in publicadas}) == len(publicadas), "cada edición aparece una vez, con su identificador"
    )
    dia = preparado["conjunto"]["consulta"]
    controles.comprobar(
        all(e["preinscripcion"]["inicio"] <= e["preinscripcion"]["fin"] for e in publicadas)
        and all(dia <= e["preinscripcion"]["fin"] for e in publicadas),
        "el plazo de preinscripción de cada edición está en orden y no había vencido el día de la consulta",
    )
    controles.comprobar(
        all(e["colectivos"] and len(set(e["colectivos"])) == len(e["colectivos"]) for e in publicadas),
        "cada edición dice a qué colectivos se dirige, sin repetirlos",
    )
    controles.comprobar(
        all(e["horas"] > 0 and e["nombre"] and e["entidad"] and e["sector"] for e in publicadas),
        "cada edición tiene nombre, horas, entidad formadora y sector",
    )
    sin_evidencia = [e["id"] for e in publicadas if not conservada(preparado["evidencias"], e["id"])]
    controles.comprobar(
        not sin_evidencia, f"cada edición tiene la evidencia conservada de su índice y sus fichas ({sin_evidencia})"
    )
    if "areas" in preparado:
        # Con el índice caído no hay nombres que comprobar: la salida es la anterior.
        esperadas = {str(id): [nombre] for id, nombre in ediciones.AREAS.items()}
        publicadas_areas = {str(id): n for id, n in (preparado["areas"] or {}).items()}
        controles.comprobar(
            preparado["areas"] is None or publicadas_areas == esperadas,
            f"las áreas de interés que acotan la consulta conservan su nombre en el índice ({publicadas_areas})",
        )
    con_contacto = [e["id"] for e in publicadas if hechos.CONTACTO.search(json.dumps(e, ensure_ascii=False))]
    controles.comprobar(not con_contacto, f"ninguna edición guarda un correo o un teléfono ({con_contacto})")


def informe_de(preparado: dict[str, Any], controles: Controles) -> dict[str, Any]:
    """El informe de la validación: cobertura, controles, evidencia de cada edición publicada y consulta parcial.

    Returns:
        El informe que guarda `cerrar_validacion`.
    """
    publicadas = preparado["conjunto"]["ediciones"]
    informe = {
        "estado": ADMITIDO if controles.admitido else CON_ERRORES,
        "conjunto_sha256": hashlib.sha256(operacion_fuente.json_bytes(preparado["conjunto"])).hexdigest(),
        "comprobado_utc": ahora_utc(),
        "cobertura": {
            "ediciones": len(publicadas),
            "conservadas": len(preparado["conservadas"]),
            "retiradas": preparado["retiradas"],
            "admiten": {c: sum(c in e["colectivos"] for e in publicadas) for c, _ in hechos.COLECTIVOS.values()},
            "asalariados_y_autonomos": sum({"asalariados", "autonomos"} <= set(e["colectivos"]) for e in publicadas),
            "intersectoriales": sum(e["sector"] == "INTERSECTORIAL" for e in publicadas),
        },
        "limites": LIMITES,
        "controles": controles.lista,
        "evidencias": {e["id"]: preparado["evidencias"].get(e["id"]) for e in publicadas},
    }
    for clave in ("consulta_parcial", "descartadas", "a_revisar"):
        if preparado.get(clave):
            informe[clave] = preparado[clave]
    return informe


def validar() -> None:
    """Admite el canal diario y, con su índice admitido, las ediciones que lee el motor.

    Raises:
        FormatoInesperado: Si las fichas no salen del índice que el canal acaba de admitir.
    """
    operacion_fuente.validar(FUENTE)
    admitido = operacion_fuente.leer_validado(FUENTE, RAIZ)
    preparado = leer_json(LEIDAS)
    exigir(
        admitido is not None
        and admitido["auxiliares"]["subvencionada"]["recibo"]["sha256"] == preparado["indice"]["recibo"]["sha256"],
        "Ediciones FUNDAE de un índice distinto del admitido por catalogos/",
        FormatoInesperado,
    )
    controles = Controles()
    controlar(controles, preparado)
    informe = informe_de(preparado, controles)
    # Un censo de Digitalízate parcial no da altas ni bajas: el panel lo dice con su motivo.
    motivo_censo = (admitido.get("censo") or {}).get("motivo")
    if motivo_censo:
        informe["avisos"] = [{"id": None, "motivo": motivo_censo}]
    catalogos, _ = adquisicion.pagina(
        ORIGINAL / operacion_fuente.CANALES[FUENTE], admitido["auxiliares"]["catalogos"], "catalogos"
    )
    if catalogos is not None and not auditoria_preinscripcion.formacion_gratuita(catalogos):
        informe.setdefault("avisos", []).append({"id": None, "motivo": "catalogo-3-gratuidad-por-revisar"})
    cerrar_validacion(FUENTE, informe, controles, lambda: preparado["conjunto"])


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida del proceso: 0 si todo va bien.
    """
    # La orquestación pasa `--aceptar-cambio` a las fuentes de política renovable, como a las demás de cursos.
    return principal_fuente_con_descarga(__doc__, descargar, {"preparar": preparar, "validar": validar}, argv)


if __name__ == "__main__":
    sys.exit(main())
