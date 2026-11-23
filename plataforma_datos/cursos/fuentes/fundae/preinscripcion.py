"""Incorpora ediciones de formación subvencionada a la única SQLite de Cursos."""

import hashlib
import json
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

from plataforma_datos.comun.entrada_salida import guardar_json, leer_json
from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import catalogo, contrato_fichas, politicas_vigencia, vigencia
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fuentes.fundae import auditoria_preinscripcion, ediciones, hechos, tramite
from plataforma_datos.cursos.hechos_entrega_catalogo import GENERAL_FUNDAE

RECIBO = "recibo-preinscripcion-fundae"
PREFIJO = "fundae:edicion:"
PADRE = "fundae:oferta:programa:"
PUBLICADOR = "fundae:publicador:catalogo:3"
METODO = "fundae:preinscripcion:1"


def _sha(ruta: Path) -> str:
    with ruta.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def _observacion(  # noqa: PLR0913, PLR0917 - Identidad de difusión, fila y extremos temporales distintos.
    codigo: str, id_nativo: str, plazo: dict, prueba: dict, posicion: int, inicio_utc: str
) -> tuple[dict, dict]:
    """El calendario se observa en la fila que porta el identificador de la propia difusión.

    Returns:
        Oferta e intento de comprobación del plazo para el registro de vigencia.
    """
    id_edicion = PREFIJO + id_nativo
    oferta = {"id": id_edicion, "fuente_id": "fundae", "url": tramite.ficha(codigo)}
    fila = f"/centrosRFO/{posicion}"
    soporte = {"url": prueba["url"], "capturado_utc": prueba["consultado_utc"], "sha256": prueba["cuerpo"]["sha256"]}

    def evidencia(alcance: str, localizador: str) -> dict:
        return {**soporte, "alcance": alcance, "localizador": {"tipo": "campo", "valor": localizador}}

    calendario = evidencia("calendario", fila)
    original = {
        "fechas_matricula": plazo,
        "vinculos_calendarios": {
            "fechas_matricula": {
                "tipo": "relacion-estructurada",
                "valor": fila + "/idDifusionAccionFormativa",
                "edicion": {"id": id_edicion, "url": None},
                "evidencia": {k: v for k, v in calendario.items() if k != "alcance"},
            }
        },
    }
    dia = hechos.dia_civil(prueba["consultado_utc"])
    if plazo["inicio"] <= dia <= plazo["fin"]:
        original["estado"] = "actual_matricula_abierta"
    dato = {
        "tipo": "ficha",
        "resultado": "correcta",
        "url_consultada": prueba["url"],
        "intentado_el": inicio_utc,
        "terminado_el": prueba["consultado_utc"],
        "detalle": {
            "codigo_http": 200,
            "url_final": prueba["url"],
            "tipo_destino": "ficha",
            "identidad_observada": id_edicion,
            "datos_edicion": contrato_fichas.normalizar_datos_edicion(original),
            "acceso_abierto": None,
        },
        "evidencias": [
            evidencia("identidad", fila + "/idDifusionAccionFormativa"),
            evidencia("disponibilidad", fila + "/fechaPreinscripcionInicio"),
            calendario,
        ],
    }
    return oferta, {"id": METODO + ":" + sha256_json(dato), **dato}


def _datos(edicion: auditoria_preinscripcion.Edicion) -> dict:
    d = edicion.datos
    return {
        "especialidad": d["especialidad"],
        "entidad_formadora": d["entidad"],
        "preinscripcion": d["preinscripcion"],
        "gratuidad_subvencionada_acreditada": True,
        "tramite_preinscripcion_acreditado": True,
        "colectivos_publicados": d["colectivos"],
        "sector": d["sector"],
        "requiere_cuenta": True,
        "modalidad": "en-linea",
        "horas_publicadas": d["horas"],
        "equivalencia_difusion": edicion.contraste["equivalencia"],
        "coste_formacion": {"alcance": GENERAL_FUNDAE, "importe": 0, "moneda": "EUR"},
        "costes_publicados": {"formacion": "gratis_formacion"},
    }


def _prueba(p: dict, archivos: dict) -> dict:
    sha = p["cuerpo"]["sha256"]
    return {"url": p["url"], "capturado_utc": p["consultado_utc"], "sha256": sha, "archivo": archivos[sha]}


def _registrar(base: Path, oferta: dict, obs: dict | None, corte: str, politica: dict) -> None:
    historial = registro.observaciones_hasta(base, tipo="edicion", id=oferta["id"], corte=corte)
    if obs:
        iguales = [o for o in historial if o["id"] == obs["id"]]
        exigir(not iguales or iguales == [obs], "Observación de preinscripción con contenido distinto")
        if not iguales:
            historial = [*historial, obs]
    registro.registrar_evaluacion(
        base,
        registro.SolicitudEvaluacion(
            edicion_id=oferta["id"], oferta=oferta, observaciones=historial, politica=politica, ahora=corte
        ),
    )


def _archivar(capturas: dict, destino: Path, inventario: dict) -> dict:
    por_sha = {s: p for p, s in sorted(inventario.items()) if p.startswith("evidencias/")}
    for carpeta, cap in capturas.values():
        for campo in ("cuerpo", "recibo", "metadatos"):
            ref = cap.get(campo)
            if not ref or ref["sha256"] in por_sha:
                continue
            s = ref["sha256"]
            ruta = f"evidencias/fundae-ediciones/{s}." + ("body" if campo == "cuerpo" else "json")
            almacen.copiar_evidencia(
                admision.ReferenciaArchivo(ruta=almacen.ruta_relativa(carpeta, ref["archivo"]), sha256=s),
                destino / ruta,
            )
            por_sha[s], inventario[ruta] = ruta, s
    return por_sha


def _preparar_lote(base: Path, candidatas: list, gratuidad: dict, archivos: dict, revisadas: list) -> dict:
    with closing(sqlite3.connect(base.as_uri() + "?mode=ro&immutable=1", uri=True)) as cx:
        padres = dict(cx.execute("SELECT id,proveedor_id FROM programas"))
        publicador = cx.execute("SELECT 1 FROM proveedores WHERE id=?", (PUBLICADOR,)).fetchone()
    programas, nativas = [], list(revisadas)
    for e in candidatas:
        d = e.datos
        padre = PADRE + d["especialidad"]
        pruebas = [_prueba(e.pruebas[n], archivos) for n in ("indice", "difusiones", "colectivos")]
        pruebas.append(_prueba(gratuidad, archivos))
        if padre not in padres:
            programas.append(
                {
                    "id": padre,
                    "proveedor_id": PUBLICADOR,
                    "titulo": d["nombre"],
                    "url": tramite.ficha(d["especialidad"]),
                    "tipo_unidad": "programa",
                    "evidencias": [pruebas[0]],
                    "etiquetas": [],
                    "datos": {"codigo_especialidad": d["especialidad"], "id_catalogo_fuente": 3},
                }
            )
            padres[padre] = PUBLICADOR
        exigir(padres[padre] == PUBLICADOR, "Programa FUNDAE de otro publicador")
        nativas.append({"id": PREFIJO + d["id"], "programa_id": padre, "datos": _datos(e), "evidencias": pruebas})
    observada = max(
        (r["capturado_utc"] for e in nativas for r in e["evidencias"]),
        key=lambda s: vigencia.instante_utc(s, "captura"),
    )
    proveedores = (
        []
        if publicador
        else [
            {"id": PUBLICADOR, "nombre": "FUNDAE · Formación subvencionada", "territorio": "España", "naturaleza": None}
        ]
    )
    return {
        "schema_version": 1,
        "fuente_lote": METODO,
        "observado_utc": observada,
        "proveedores": proveedores,
        "programas": programas,
        "ediciones": nativas,
    }


def _ediciones_previas(base: Path) -> dict:
    with closing(sqlite3.connect(base.as_uri() + "?mode=ro&immutable=1", uri=True)) as cx:
        filas = cx.execute(
            "SELECT e.id, e.programa_id, e.datos FROM ediciones e JOIN programas p ON e.programa_id=p.id "
            "WHERE p.proveedor_id=? AND e.id LIKE ? AND e.programa_id LIKE ?",
            (PUBLICADOR, PREFIJO + "%", PADRE + "%"),
        )
        return {
            ident.removeprefix(PREFIJO): {**json.loads(datos), "especialidad": padre.removeprefix(PADRE)}
            for ident, padre, datos in filas
        }


def _revisiones(
    anteriores: dict, cierres: dict, archivo: auditoria_preinscripcion.Archivo, precio: dict, web_distinta: dict | None
) -> dict:
    """Conserva cada hecho anterior salvo que haya una prueba positiva de un cambio para esa edición.

    Returns:
        Datos modificados de cada edición acompañados de las pruebas del cambio.
    """
    resultado = {}
    for ident, previa in anteriores.items():
        datos, pruebas = dict(previa), []
        if precio["gratuita"] is False or ident in archivo.precios_por_revisar:
            datos["gratuidad_subvencionada_acreditada"] = False
            datos.pop("coste_formacion", None)
            costes = dict(datos.get("costes_publicados", {}))
            costes.pop("formacion", None)
            if costes:
                datos["costes_publicados"] = costes
            else:
                datos.pop("costes_publicados", None)
            pruebas.append(archivo.precios_por_revisar.get(ident) or precio)
        if ident in archivo.condiciones_por_revisar or web_distinta:
            datos["tramite_preinscripcion_acreditado"] = False
            pruebas.append(archivo.condiciones_por_revisar.get(ident) or web_distinta)
        if ident in cierres:
            datos["preinscripcion"] = cierres[ident]["plazo"]
            pruebas.append(cierres[ident]["prueba"])
        if pruebas and (datos != previa or ident in cierres):
            resultado[ident] = (datos, pruebas)
    return resultado


def _tramite_observado(archivo: auditoria_preinscripcion.Archivo, corte: str) -> tuple:
    carpeta_web = archivo.original / "tramite"
    estado_web, ultimo = tramite.contraste_actual(carpeta_web, corte)
    interfaz = tramite.leer(carpeta_web)
    doc, sha_web = {}, None
    if interfaz is not None:
        doc, meta_web, sha_web = interfaz
        if vigencia.instante_utc(meta_web["fin_utc"], "recepción del trámite") > archivo.corte:
            doc, sha_web = {}, None
    if estado_web == "tramite-cambiado":
        doc, sha_web = ultimo, None
    recibos_web = {n: doc[n]["recibo"]["sha256"] for n in ("pagina", "principal", "componente") if n in doc}
    for n, sha in recibos_web.items():
        archivo.capturas[sha] = carpeta_web, doc[n]
    distinta = None
    if estado_web == "tramite-cambiado":
        # El cuerpo es público y forma parte de la cadena comprobada por contraste_actual.
        cap = list(ultimo.values())[-1]
        distinta = ediciones.evidencia(cap, comun.leer_recibo(carpeta_web, cap))
    return estado_web, sha_web, recibos_web, distinta


@dataclass
class _PlanEdiciones:
    archivo: auditoria_preinscripcion.Archivo
    elegibles: list
    precio: dict
    revisiones: dict
    cierres: dict

    def cargar(self, destino: Path, archivos: dict, corte: str) -> None:
        """Registra los cambios de negocio y evalúa cada unidad con sus observaciones archivadas."""
        politica = politicas_vigencia.leer_politica("fundae", "3")
        sqlite = destino / "catalogo.sqlite3"
        filas = [
            {
                "id": PREFIJO + i,
                "programa_id": PADRE + datos["especialidad"],
                "datos": datos,
                "evidencias": [_prueba(p, archivos) for p in pruebas],
            }
            for i, (datos, pruebas) in self.revisiones.items()
        ]
        lote = _preparar_lote(sqlite, self.elegibles, self.precio, archivos, filas)
        catalogo.cargar_lote(sqlite, lote, True, destino)
        for e in self.elegibles:
            d, p = e.datos, e.pruebas["difusiones"]
            _, meta = self.archivo.leer("difusiones", p, ediciones.url_difusiones(d["especialidad"]))
            oferta, obs = _observacion(
                d["especialidad"], d["id"], d["preinscripcion"], p, e.contraste["posicion"], meta["inicio_utc"]
            )
            _registrar(sqlite, oferta, obs, corte, politica)
        for ident, (datos, _) in self.revisiones.items():
            oferta = {"id": PREFIJO + ident, "fuente_id": "fundae", "url": tramite.ficha(datos["especialidad"])}
            cierre = self.cierres.get(ident)
            obs = None
            if cierre:
                _, obs = _observacion(
                    datos["especialidad"],
                    ident,
                    cierre["plazo"],
                    cierre["prueba"],
                    cierre["posicion"],
                    cierre["inicio_utc"],
                )
            _registrar(sqlite, oferta, obs, corte, politica)


def _ya_aplicada(base: Path, entrada: admision.SolicitudAdmision, firma: str) -> bool:
    referencia = entrada.procedencia.get(RECIBO)
    if referencia is None:
        return False
    control = leer_json(base / almacen.CONTROL)
    indice = {
        x["sha256"]: admision.ReferenciaArchivo(ruta=almacen.ruta_relativa(base, x["archivo"]), sha256=x["sha256"])
        for x in control["archivos_conservados"]
    }
    return almacen.leer_documento_indexado(referencia, indice)["firma"] == firma


def aplicar_si_cambia(raiz: Path, base: Path, destino: Path, corte: str) -> Path:
    """Incorpora observaciones nuevas verificadas y conserva la historia de cada edición y de sus plazos.

    Returns:
        Directorio admitido con los cambios, o el de entrada si la operación no aporta hechos.
    """
    original_catalogos, _, validado_catalogos = comun.rutas_de_la_fuente("fundae", raiz)
    original, validado = original_catalogos.parent, validado_catalogos.parent
    if not all((validado / n).is_file() for n in ("fundae.json", "validacion.json", "catalogos/fundae.json")):
        return base
    archivo, candidatas, retenidas, precio = auditoria_preinscripcion.candidatas(original, validado, corte)
    estado_web, sha_web, recibos_web, distinta = _tramite_observado(archivo, corte)
    previas = _ediciones_previas(base / "catalogo.sqlite3")
    elegibles = (
        candidatas if (precio["gratuita"] is True and sha_web and estado_web in ("acreditado", "sin-intento")) else []
    )
    claves = {e.datos["id"]: {n: p["recibo"]["sha256"] for n, p in e.pruebas.items()} for e in elegibles}
    pendientes = {i: d for i, d in previas.items() if i not in claves}
    indice = leer_json(validado_catalogos / "fundae.json")["auxiliares"]["subvencionada"]
    cierres = archivo.cierres_individuales(pendientes, indice)
    revisiones = _revisiones(pendientes, cierres, archivo, precio, distinta)
    if not elegibles and not revisiones:
        return base
    codigo = {
        n: _sha(Path(__file__).with_name(n))
        for n in (
            "preinscripcion.py",
            "auditoria_preinscripcion.py",
            "tramite.py",
            "adquisicion.py",
            "ediciones.py",
            "hechos.py",
            "lector.py",
            "salida.py",
            "politica_vigencia_v3.json",
        )
    }
    recibos_cierres = {i: c["prueba"]["recibo"]["sha256"] for i, c in cierres.items()}
    firma = sha256_json(
        [
            claves,
            retenidas,
            recibos_cierres,
            recibos_web,
            estado_web,
            precio["recibo"]["sha256"],
            codigo,
            registro.firma_evaluador()["sha256"],
        ]
    )
    entrada = almacen.solicitud(base)
    migrar = any(
        previas.get(i, {}).get(k) is not True
        for i in claves
        for k in ("gratuidad_subvencionada_acreditada", "tramite_preinscripcion_acreditado")
    )
    if not migrar and not any(i not in cierres for i in revisiones) and _ya_aplicada(base, entrada, firma):
        return base
    entrada_validada = almacen.EntradaCatalogo(admision=entrada, sha256_admision=_sha(entrada.validacion_destino))
    control = almacen.conservar(entrada_validada, destino=destino)
    inventario = {r["archivo"]: r["sha256"] for r in control["archivos_conservados"]}
    archivos = _archivar(archivo.capturas, destino, inventario)
    sqlite = destino / "catalogo.sqlite3"
    plan = _PlanEdiciones(archivo, elegibles, precio, revisiones, cierres)
    plan.cargar(destino, archivos, corte)
    recibo = {
        "schema_version": 1,
        "firma": firma,
        "ediciones": claves,
        "retenidas": retenidas,
        "cierres": recibos_cierres,
        "codigo": codigo,
        "formulario": recibos_web,
        "estado_formulario": estado_web,
        "componente_sha256": sha_web,
        "gratuidad": precio["recibo"]["sha256"],
        "gratuidad_acreditada": precio["gratuita"],
        "corte": corte,
    }
    control["procedencia"][RECIBO] = almacen.archivar_documento(
        comun.json_bytes(recibo), destino, inventario, campos_evento=frozenset({"corte"})
    )
    control["snapshot_sha256"] = _sha(sqlite)
    control["archivos_conservados"] = [{"archivo": n, "sha256": s} for n, s in sorted(inventario.items())]
    guardar_json(destino / almacen.CONTROL, control)
    admision.admitir_snapshot(almacen.solicitud(destino))
    return destino
