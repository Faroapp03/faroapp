"""Admite presencia FUNDAE en candidata sin sustituir comprobaciones directas.

No modifica negocio, anuncios, ediciones, títulos o fechas de ninguna entidad.
Las observaciones de catálogo no crean ofertas disponibles. Un estado producido
por otra fuente, incluido el alias Ciber, exige transición explícita y se conserva.
"""

import hashlib
import sqlite3
from contextlib import closing
from pathlib import Path

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import catalogo, politicas_vigencia, vigencia
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fuentes.fundae import adquisicion, censo_digitalizate, conocidos, digitalizate

CODIGO = ("adquisicion.py", "censo_digitalizate.py", "conocidos.py", "actualizacion.py", "politica_vigencia_v2.json")


def _sha(ruta: Path) -> str:
    with ruta.open("rb") as archivo:
        return hashlib.file_digest(archivo, "sha256").hexdigest()


def firma(conjunto: dict) -> str:
    """Identifica la aplicación, sin transformar revisión en recepción remota.

    Returns:
        Huella de conjunto, código y evaluador usados, con fechas originales.
    """
    return sha256_json(
        {
            "conjunto": conjunto,
            "codigo": {n: _sha(Path(__file__).with_name(n)) for n in CODIGO},
            "evaluador": registro.firma_evaluador()["sha256"],
        }
    )


def recalcular(original: Path, conjunto: dict, entidades: dict) -> dict:
    """El conjunto que sale de sus propias capturas con esas entidades conocidas.

    Usa el índice admitido, no el último intento: originales puede contener una consulta posterior fallida y nunca
    debe invalidar la versión buena.

    Returns:
        El conjunto calculado para ese almacén, sin su `procedencia_sha256`.
    """
    procedencia = {
        "schema_version": 1,
        "fuente_id": "fundae",
        "capturas": conjunto["recepciones"],
        "auxiliares": conjunto["auxiliares"],
        **({"censo": conjunto["censo"]["documento"]} if "censo" in conjunto else {}),
    }
    return adquisicion.calcular(original, procedencia, entidades)


def _conservar(original: Path, captura: dict, destino: Path, inventario: dict) -> None:
    """Copia las referencias de una captura al catálogo; un archivo ya conservado no se duplica.

    El catálogo de entrada puede guardar los mismos bytes con otro nombre (por ejemplo, compactados
    en `evidencias/conservadas/`): se reutiliza esa ruta en vez de copiarlos otra vez.
    """
    for campo in ("cuerpo", "recibo", "metadatos", "intento"):
        ref = captura.get(campo)
        if ref is None:
            continue
        contenido = comun.leer_conservado(original, ref)
        relativa = next(
            (n for n, h in sorted(inventario.items()) if h == ref["sha256"] and n.startswith("evidencias/")),
            "evidencias/fundae/" + ref["sha256"] + (".body" if campo == "cuerpo" else ".json"),
        )
        origen = admision.ReferenciaArchivo(ruta=almacen.ruta_relativa(original, ref["archivo"]), sha256=ref["sha256"])
        exigir(hashlib.sha256(contenido).hexdigest() == ref["sha256"], "Referencia FUNDAE alterada")
        almacen.copiar_evidencia(origen, destino / relativa)
        inventario[relativa] = ref["sha256"]


def _registrar(base: Path, programa: dict, observacion: dict, corte: str) -> dict:
    exigir(observacion["tipo"] == "catalogo", "FUNDAE agregador no aporta una ficha directa")
    with closing(sqlite3.connect(base.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)) as conexion:
        tiene_ediciones = (
            conexion.execute("SELECT 1 FROM ediciones WHERE programa_id=? LIMIT 1", (programa["id"],)).fetchone()
            is not None
        )
    if tiene_ediciones:
        return {
            "id": programa["id"],
            "tipo_presencia": "programa_con_ediciones",
            "conservada_fuente_directa": None,
            "evaluacion": None,
        }
    anterior = registro.consultar_unidad(base, tipo="recurso", id=programa["id"])["evaluacion"]
    if anterior is not None and anterior["entradas"]["oferta"]["fuente_id"] != "fundae":
        return {
            "id": programa["id"],
            "conservada_fuente_directa": anterior["entradas"]["oferta"]["fuente_id"],
            "evaluacion": None,
        }
    historial = registro.observaciones_hasta(base, tipo="recurso", id=programa["id"], corte=corte)
    iguales = [o for o in historial if o["id"] == observacion["id"]]
    exigir(not iguales or iguales == [observacion], "Observación FUNDAE de la misma recepción en conflicto")
    with closing(sqlite3.connect(base)) as conexion:
        huella = conexion.execute("SELECT huella FROM programas WHERE id=?", (programa["id"],)).fetchone()[0]
    evaluacion = registro.registrar_unidad(
        base,
        registro.SolicitudEvaluacionUnidad(
            unidad=registro.UnidadEvaluable(tipo="recurso", id=programa["id"], huella=huella),
            oferta={"id": programa["id"], "fuente_id": "fundae", "url": programa["url"]},
            observaciones=historial if iguales else [*historial, observacion],
            politica=politicas_vigencia.leer_politica("fundae", "2"),
            ahora=corte,
        ),
    )
    referencia = {campo: evaluacion[campo] for campo in ("evaluacion_id", "repetida", "actual")}
    return {"id": programa["id"], "conservada_fuente_directa": None, "evaluacion": referencia}


def _dar_altas(conjunto: dict, original: Path, destino: Path, inventario: dict, corte: str) -> list[dict]:
    """Da de alta, con su destino y su proveedor, los recursos nuevos de un censo completo de Digitalízate.

    Cada alta entra por el mismo camino y con las mismas validaciones que las demás (`catalogo.cargar_lote`, con sus
    capturas comprobadas) y registra su presencia en el censo. Un censo parcial no da altas.

    Returns:
        El resultado del registro de cada alta.
    """
    censo = conjunto.get("censo")
    if not censo or not censo["altas"]:
        return []
    for captura in censo_digitalizate.capturas(censo["documento"]):
        _conservar(original, captura, destino, inventario)
    lectura = censo_digitalizate.leer(original, censo["documento"])
    exigir(lectura["completo"], "Altas de Digitalízate desde un censo que no es completo")
    archivo = {h: n for n, h in sorted(inventario.items())}
    programas = []
    for rid in censo["altas"]:
        visto = lectura["recursos"][rid]
        prueba = visto["evidencia"]
        evidencia = {
            "url": prueba["url"],
            "capturado_utc": prueba["consultado_utc"],
            "sha256": prueba["cuerpo"]["sha256"],
            "archivo": archivo[prueba["cuerpo"]["sha256"]],
        }
        programas.append(censo_digitalizate.programa(visto, evidencia))
    base = destino / "catalogo.sqlite3"
    # El lote lleva la fecha de la consulta más reciente de las fichas que acreditan sus altas, no la de la aplicación.
    fechas = [lectura["recursos"][rid]["evidencia"]["consultado_utc"] for rid in censo["altas"]]
    observado = max(fechas, key=lambda f: vigencia.instante_utc(f, "ficha de Digitalízate"))
    lote = {"schema_version": 1, "observado_utc": observado, "fuente_lote": "fundae:censo-digitalizate:1"}
    lote.update(proveedores=[], programas=programas, ediciones=[])
    with closing(sqlite3.connect(base)) as conexion:
        # Un almacén recién sembrado aún no tiene el publicador: la primera alta lo incorpora.
        if conexion.execute("SELECT 1 FROM proveedores WHERE id=?", (digitalizate.PUBLICADOR_ID,)).fetchone() is None:
            lote["proveedores"] = [digitalizate.PROVEEDOR_PUBLICADOR]
    catalogo.cargar_lote(base, lote, True, destino)
    return [_registrar(base, p, adquisicion.observacion_censo(p, lectura, None), corte) for p in programas]


def aplicar(entrada: almacen.EntradaCatalogo, *, conjunto: dict, original: Path, destino: Path, corte: str) -> dict:
    """Crea y admite una instantánea conservando entrada y negocio de todas las fuentes.

    Returns:
        Control admitido con recibo de presencia y fallos por canal. La política
        debe estar registrada explícitamente por la integración común antes de usarla.
    """
    entidades = conocidos.leer(entrada)
    programas = {p["id"]: p for p in entidades["programas"]}
    exigir(
        recalcular(original, conjunto, entidades) == {k: v for k, v in conjunto.items() if k != "procedencia_sha256"},
        "Conjunto FUNDAE no reproducido desde sus capturas",
    )
    exigir(
        conjunto.get("schema_version") == 1 and conjunto.get("fuente_id") == "fundae", "Conjunto FUNDAE incompatible"
    )
    control = almacen.conservar(entrada, destino=destino)
    inventario = {p["archivo"]: p["sha256"] for p in control["archivos_conservados"]}
    for captura in conjunto["auxiliares"].values():
        _conservar(original, captura, destino, inventario)
    altas = _dar_altas(conjunto, original, destino, inventario, corte)
    resultados, presencias_programas, vistos = list(altas), [], set()
    for fila in conjunto["observaciones_catalogo"]:
        id = fila["id"]
        exigir(id in programas and id not in vistos, "Observación FUNDAE repetida o de entidad no admitida")
        vistos.add(id)
        resultado = _registrar(destino / "catalogo.sqlite3", programas[id], fila["observacion"], corte)
        resultados.append(resultado)
        if resultado["evaluacion"] is None:
            presencias_programas.append({"programa_id": id, "observacion": fila["observacion"]})
    codigo = {}
    for nombre in CODIGO:
        ruta = Path(__file__).with_name(nombre)
        sha = _sha(ruta)
        relativa = "evidencias/codigo/" + sha + ".ref"
        almacen.copiar_evidencia(admision.ReferenciaArchivo(ruta=ruta, sha256=sha), destino / relativa)
        inventario[relativa], codigo[nombre] = sha, sha
    recibo = {
        "schema_version": 1,
        "fuente_id": "fundae",
        "metodo": conjunto["metodo"],
        "firma": firma(conjunto),
        "snapshot_entrada_sha256": entrada.admision.snapshot.sha256,
        "snapshot_salida_sha256": _sha(destino / "catalogo.sqlite3"),
        "corte_evaluacion_utc": corte,
        "codigo": codigo,
        "resultados": resultados,
        "presencias_programas": presencias_programas,
        "fallos": conjunto["fallos"],
    }
    control["procedencia"]["recibo-fundae"] = almacen.archivar_documento(
        comun.json_bytes(recibo),
        destino,
        inventario,
        campos_evento=frozenset(
            {
                "firma",
                "snapshot_entrada_sha256",
                "snapshot_salida_sha256",
                "corte_evaluacion_utc",
                "resultados",
                "presencias_programas",
                "fallos",
            }
        ),
    )
    control["snapshot_sha256"] = recibo["snapshot_salida_sha256"]
    control["archivos_conservados"] = [{"archivo": n, "sha256": h} for n, h in sorted(inventario.items())]
    # Un índice caído ya consta como fallo de consulta de sus unidades: sin consulta nueva no hay nada
    # que volver a evaluar. Un corte histórico (ciclo pendiente) que no queda actual no se da por aplicado.
    if resultados and all(r["evaluacion"] is None or r["evaluacion"]["actual"] for r in resultados):
        control["aplicados_por_fuente"]["fundae"] = recibo["firma"]
    guardar_json(destino / almacen.CONTROL, control)
    admision.admitir_snapshot(almacen.solicitud(destino))
    return control
