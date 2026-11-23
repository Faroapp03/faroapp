"""Entrega canónica V10 desde una instantánea admitida; no repite investigación.

La preparación conserva el corte, la decisión y las fechas del registro por
unidad tipada. No ejecuta el evaluador, migra, consulta fuentes o publica oferta.
El consumidor recibe solo bytes estáticos y aplica su reloj al límite publicado sin rejuvenecer fechas.
"""

import hashlib
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from plataforma_datos.comun.entrada_salida import sha256, temporal_hermano
from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import Controles, ValidacionFallida
from plataforma_datos.cursos import (
    admision_catalogo,
    catalogo,
    contenido_academy,
    contenido_aprendizaje,
    contenido_ciber,
    contenido_cibernarium,
    materia_cibernarium,
    materia_objetivos,
    nivel_itinerario_cibernarium,
    registro_vigencia,
    retirada_en_el_catalogo,
    vigencia,
)
from plataforma_datos.cursos import contrato_entrega_catalogo as contrato
from plataforma_datos.cursos.clasificacion import emision, registro
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fronteras_entrega_catalogo import FronteraEscritura
from plataforma_datos.cursos.fuentes.barcelonactiva import actualizacion as cibernarium
from plataforma_datos.cursos.fuentes.barcelonactiva import idiomas_edicion
from plataforma_datos.cursos.fuentes.cibervoluntarios import actualizacion as ciber
from plataforma_datos.cursos.fuentes.fundae import idioma_programa
from plataforma_datos.cursos.hechos_entrega_catalogo import proyectar_hechos
from plataforma_datos.cursos.json_entrega_catalogo import bytes_json, leer_json_de_entrega
from plataforma_datos.cursos.json_entrega_catalogo import json_controlado as _json_controlado
from plataforma_datos.cursos.json_entrega_catalogo import leer_bytes as _leer_bytes
from plataforma_datos.cursos.referencias_entrega_catalogo import ClaveReferencia, naturalezas
from plataforma_datos.cursos.seleccion_entrega_catalogo import estado_interno_de_unidad, seleccionar
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson
from plataforma_datos.cursos.unidades_vigencia import TipoUnidad
from plataforma_datos.orquestacion.admision import exigir_admitido

CONJUNTO = "catalogo-cursos"
PUBLICO = CONJUNTO + ".json"
LINAJE = "linaje-privado.json"
CATEGORIA_CIBERNARIUM_STEAM_PER_INFANTS = "1907"
MAX_NATURALEZAS = 128 * 1024 * 1024
MAX_PUBLICO = 32 * 1024 * 1024
MAX_FILA = 4 * 1024 * 1024
ESQUEMA = Path(__file__).with_name("esquemas") / "entrega_catalogo.json"
CONTROLES = (
    "Snapshot V10 y procedencia admitidos sin replay",
    "Contrato público cerrado y registro por unidad conservados",
)


@dataclass(frozen=True, kw_only=True)
class SolicitudEntrega:
    """Admisión existente, área propia, corte técnico explícito y la instalación cuya regla de retirada decide."""

    admision: admision_catalogo.SolicitudAdmision
    instalacion: Path
    sha256_admision: str
    area: Path
    corte_utc: str
    naturalezas_referencias_id: str | None = None


def _archivos_codigo() -> tuple[Path, ...]:
    propios = tuple(
        Path(__file__).parent / n
        for n in (
            "entrega_catalogo.py",
            "json_entrega_catalogo.py",
            "contrato_entrega_catalogo.py",
            "hechos_entrega_catalogo.py",
            "calendario_entrega.py",
            "fronteras_entrega_catalogo.py",
            "referencias_entrega_catalogo.py",
            "seleccion_entrega_catalogo.py",
            "politicas_vigencia.py",
            "fallo_de_consulta.py",
            "aprendizaje_entrega.py",
            "aprendizaje_ciber.py",
            "contenido_aprendizaje.py",
            "contenido_academy.py",
            "contenido_ciber.py",
            "fuentes/cibervoluntarios/nivel_actividad.py",
            "contenido_cibernarium.py",
            "materia_cibernarium.py",
            "nivel_itinerario_cibernarium.py",
            "materia_objetivos.py",
            "nivel_objetivos_fundae.py",
            "materia_sugerencias_cibernarium.py",
            "nivel_sugerencias_cibernarium.py",
            "materia_censos_cibernarium.py",
            "operacion_fuente.py",
            "fuentes/barcelonactiva/censo_ia.py",
            "fuentes/barcelonactiva/ambitos.py",
            *("fuentes/barcelonactiva/" + n for n in cibernarium.CODIGO),
            *(n.removeprefix("cursos/") for n in ciber.CODIGO),
            "fuentes/fundae/idioma_programa.py",
            "fuentes/claude_academy/control_actual.py",
            "fuentes/claude_academy/idioma_curso.py",
            "fuentes/claude_academy/condiciones_formacion.py",
            "fuentes/claude_academy/condiciones_publicadas.py",
            "fuentes/claude_academy/acceso_publico.py",
            "fuentes/claude_academy/lector.py",
            "fuentes/fundae/hechos.py",
            "contrato_aprendizaje.py",
            "publicar_catalogo.py",
            "fuentes/hp_life/lector.py",
            "fuentes/hp_life/recepciones.py",
            "fuentes/hp_life/actualizacion.py",
            *registro.CODIGO,
            *retirada_en_el_catalogo.CODIGO,
        )
    )
    raiz = Path(__file__).resolve().parents[2]
    return (
        *propios,
        ESQUEMA,
        Path(__file__).parent / "esquemas/registro_aprendizaje.json",
        raiz / "config/formacion/aprendizaje-revisado.json",
        raiz / "src/catalogo-cursos/indicadores-tema.json",
        raiz / "src/catalogo-cursos/indicadores-objetivos.json",
    )


def _codigo() -> ObjetoJson:
    raiz = Path(__file__).resolve().parents[2]
    return {p.relative_to(raiz).as_posix(): sha256(p) for p in _archivos_codigo()}


def frontera_de_entrega(solicitud: SolicitudEntrega) -> FronteraEscritura:
    """Delimita la entrega: las entradas que no pueden cambiar y la zona donde se puede escribir.

    Returns:
        La frontera de escritura de la entrega.
    """
    admision = solicitud.admision
    base = admision.snapshot.ruta
    entradas = (
        base,
        admision.validacion_destino,
        *(r.ruta for r in admision.procedencia.values()),
        *admision_catalogo.rutas_evidencias_indexadas(admision),
        *(base.with_name(base.name + s) for s in ("-wal", "-shm", "-journal")),
        *_archivos_codigo(),
    )
    exigir(
        all(not p.resolve().is_relative_to(solicitud.area.resolve()) for p in entradas),
        "El área contiene una entrada protegida",
    )
    return FronteraEscritura(area=solicitud.area, entradas=entradas)


def comprobar_entradas_de_entrega(solicitud: SolicitudEntrega) -> ObjetoJson:
    """Comprueba la instantánea admitida y la frontera, y devuelve la identidad de las entradas.

    Returns:
        La identidad de las entradas, para contrastarla de nuevo al terminar.
    """
    vigencia.instante_utc(solicitud.corte_utc, "corte de proyección")
    frontera_de_entrega(solicitud).comprobar(solicitud.area)
    informe = admision_catalogo.exigir_snapshot_admitido(
        solicitud.admision, sha256_validacion=solicitud.sha256_admision
    )
    nombre = solicitud.naturalezas_referencias_id
    exigir(nombre is None or nombre in solicitud.admision.procedencia, "Naturalezas sin referencia admitida")
    entrada = {
        "schema_version": 3,
        "admision_sha256": solicitud.sha256_admision,
        "snapshot": informe["snapshot"],
        "procedencia": informe["procedencia"],
        "codigo_admision": informe["codigo_sha256"],
        "codigo_proyeccion": _codigo(),
        "corte_proyeccion_utc": solicitud.corte_utc,
        "naturalezas_referencias_id": nombre,
        "regla_de_retirada": retirada_en_el_catalogo.estado_en_el_linaje(solicitud.instalacion),
    }
    if "indices_evidencias" in informe:
        entrada["indices_evidencias"] = informe["indices_evidencias"]
    return entrada


def _guardar(solicitud: SolicitudEntrega, ruta: Path, cuerpo: bytes, *, publica: bool = False) -> None:
    frontera = frontera_de_entrega(solicitud)
    frontera.comprobar(ruta, publica=publica)
    if ruta.exists() and ruta.stat().st_size == len(cuerpo) and ruta.read_bytes() == cuerpo:
        return
    ruta.parent.mkdir(parents=True, exist_ok=True)
    temporal = None
    try:
        with temporal_hermano(ruta.parent, prefijo="." + ruta.name + "-") as archivo:
            temporal = Path(archivo.name)
            archivo.write(cuerpo)
        frontera.comprobar(ruta, publica=publica)
        temporal.replace(ruta)
    finally:
        if temporal is not None:
            temporal.unlink(missing_ok=True)


def _naturalezas(solicitud: SolicitudEntrega) -> dict[ClaveReferencia, ObjetoJson]:
    nombre = solicitud.naturalezas_referencias_id
    if nombre is None:
        return {}
    documento = leer_json_de_entrega(solicitud.admision.procedencia[nombre].ruta, MAX_NATURALEZAS)
    exigir(
        isinstance(documento, dict) and isinstance(documento.get("mapa_acceso"), list), "Mapa de referencias inválido"
    )
    exigir(len(documento["mapa_acceso"]) <= contrato.MAX_FILAS, "Mapa de referencias excesivo")
    for item in documento["mapa_acceso"]:
        _validar_naturaleza(item)
    return naturalezas(documento)


def _validar_naturaleza(item: ValorJson) -> None:
    exigir(isinstance(item, dict) and isinstance(item.get("soporte"), dict), "Soporte de referencia inválido")
    exigir(isinstance(item.get("catalogo_id"), str) and bool(item["catalogo_id"]), "Referencia sin ID")
    principal = item.get("prueba_principal")
    exigir(isinstance(principal, dict), "Referencia sin prueba principal")
    catalogo.exigir_url_publica(principal.get("url"), "URL de referencia")
    catalogo.exigir_sha256(principal.get("sha256"), "SHA de referencia")
    vigencia.instante_utc(principal.get("capturado_utc"), "fecha de referencia")
    for campo in ("recibido_utc", "fecha_declarada_utc"):
        valor = item["soporte"].get(campo)
        if valor is not None:
            vigencia.instante_utc(valor, campo)


def _filas(conexion: sqlite3.Connection, tabla: str, columnas: tuple[str, ...]) -> list[ObjetoJson]:
    filas = conexion.execute("SELECT " + ",".join(columnas) + " FROM " + tabla + " ORDER BY id").fetchmany(
        contrato.MAX_FILAS + 1
    )
    exigir(len(filas) <= contrato.MAX_FILAS, "Límite de filas: " + tabla)
    return [dict(fila) for fila in filas]


def _datos(fila: ObjetoJson) -> ObjetoJson:
    cuerpo = fila.pop("datos").encode()
    exigir(len(cuerpo) <= MAX_FILA, "Datos de entidad sobre el límite")
    dato = _json_controlado(cuerpo)
    exigir(isinstance(dato, dict), "Datos de entidad no son objeto")
    return dato


def _referencias(conexion: sqlite3.Connection, tipos: dict[ClaveReferencia, ObjetoJson]) -> dict[str, list[ObjetoJson]]:
    salida = {}
    filas = conexion.execute(
        "SELECT v.programa_id,v.edicion_id,e.url,e.capturado_utc,e.sha256 FROM vinculos_evidencia v "
        "JOIN evidencias e ON e.id=v.evidencia_id ORDER BY e.id,v.id"
    )
    for indice, fila in enumerate(filas):
        exigir(indice < contrato.MAX_FILAS, "Límite total de referencias")
        identidad = (
            ("programa:" + fila["programa_id"]) if fila["programa_id"] is not None else "edicion:" + fila["edicion_id"]
        )
        clave = (fila["programa_id"], fila["url"], fila["sha256"], fila["capturado_utc"])
        tipo = tipos.get(clave, {"naturaleza_fecha": "no_acreditada", "naturaleza_documento": "no_acreditada"})
        salida.setdefault(identidad, []).append(
            {
                "url": fila["url"],
                "sha256": fila["sha256"],
                "fecha_referencia": fila["capturado_utc"],
                "alcance": "entidad",
                **tipo,
            }
        )
    return salida


def _vigencias(base: Path, tipo: TipoUnidad, corte: str, ids: set[str]) -> tuple[dict, dict, str, dict]:
    salida, revision, cursor, evaluaciones = {}, None, None, {}
    while True:
        pagina = registro_vigencia.listar_unidades(
            base, tipo=tipo, limite=100, despues_de=cursor, revision_esperada=revision
        )
        exigir(pagina["estado_registro"] == "disponible", "Registro no disponible; no fabricar lista vacía")
        revision = pagina["revision"]
        for fila in pagina["unidades"]:
            id_unidad = fila["unidad"]["id"]
            exigir(fila["unidad"]["tipo"] == tipo and id_unidad not in salida, "Página de otro dominio o repetida")
            salida[id_unidad] = estado_interno_de_unidad(fila, corte)
            if id_unidad in ids:
                evaluaciones[id_unidad] = fila["evaluacion"]
        exigir(len(salida) <= contrato.MAX_FILAS, "Límite total de vigencias")
        cursor = pagina["siguiente"]
        if cursor is None:
            return salida, pagina["cobertura"], revision, evaluaciones


def _colecciones(
    conexion: sqlite3.Connection,
    vigencias: dict[str, dict[str, ObjetoJson]],
    tipos: dict[ClaveReferencia, ObjetoJson],
    condiciones: dict[tuple[str, str], ObjetoJson] | None = None,
    materias: dict[str, ObjetoJson] | None = None,
) -> ObjetoJson:
    referencias = _referencias(conexion, tipos)
    unidades = _filas(conexion, "programas", ("id", "proveedor_id", "tipo_unidad", "titulo", "url", "datos"))
    ediciones = _filas(conexion, "ediciones", ("id", "programa_id", "datos"))
    variantes = _filas(conexion, "variantes", ("id", "programa_id", "datos"))
    proveedores = {u["id"]: u["proveedor_id"] for u in unidades}
    for grupo, prefijo, alcance in (
        (unidades, "programa:", "unidad"),
        (ediciones, "edicion:", "edicion"),
        (variantes, "", "unidad"),
    ):
        for fila in grupo:
            proveedor = fila.get("proveedor_id") or proveedores[fila["programa_id"]]
            extra = (condiciones or {}).get((prefijo.removesuffix(":"), fila["id"]), {}) if prefijo else {}
            datos = _datos(fila)
            fila["hechos"] = proyectar_hechos(
                datos, alcance=alcance, proveedor_id=proveedor, condiciones_actuales=extra
            )
            if proveedor == "cibervoluntarios" and extra.get("nivel_actividad") is not None:
                fila["nivel_actividad"] = extra["nivel_actividad"]
            # La categoría del programa acredita el público de todas sus ediciones.
            if (
                fila.get("proveedor_id") == "cibernarium"
                and str(datos.get("categoria_id_publicada")) == CATEGORIA_CIBERNARIUM_STEAM_PER_INFANTS
            ):
                fila["motivo_retencion_publicacion"] = "cibernarium_solo_infancia"
            if prefijo == "edicion:" and fila["id"].startswith("fundae:edicion:"):
                exigir(
                    proveedor == "fundae:publicador:catalogo:3" and datos.get("requiere_cuenta") is True,
                    "Edición FUNDAE sin trámite identificado",
                )
                fila["preinscripcion"] = {
                    "inicio": datos["preinscripcion"]["inicio"],
                    "fin": datos["preinscripcion"]["fin"],
                    "centro": datos["entidad_formadora"],
                    "sector": datos["sector"],
                    "colectivos": datos["colectivos_publicados"],
                }
                fila["equivalencia_difusion"] = datos["equivalencia_difusion"]
                fila["gratuidad_subvencionada_acreditada"] = datos.get("gratuidad_subvencionada_acreditada")
                fila["tramite_preinscripcion_acreditado"] = datos.get("tramite_preinscripcion_acreditado")
            if prefijo:
                propias = referencias.get(prefijo + fila["id"], [])
                vinculadas = {(r["url"], r["sha256"], r["fecha_referencia"]): r for r in propias}
                for ref in extra.get("referencias", []):
                    vinculadas.setdefault((ref["url"], ref["sha256"], ref["fecha_referencia"]), ref)
                fila["referencias"] = (
                    [vinculadas[k] for k in sorted(vinculadas)] if extra.get("referencias") else propias
                )
    recursos = {u["id"] for u in unidades} - {e["programa_id"] for e in ediciones}
    exigir(set(vigencias["recurso"]) == recursos, "Dominio de recursos distinto del registro")
    exigir(set(vigencias["edicion"]) == {e["id"] for e in ediciones}, "Dominio de ediciones distinto del registro")
    for grupo, tipo in ((unidades, "recurso"), (ediciones, "edicion")):
        for fila in grupo:
            fila["vigencia"] = vigencias[tipo].get(fila["id"])
            fila["evidencia_materia"] = materias.get(fila["id"]) if tipo == "edicion" and materias is not None else None
    return {
        "proveedores": _filas(conexion, "proveedores", ("id", "nombre")),
        "unidades": unidades,
        "ediciones": ediciones,
        "variantes": variantes,
        "anuncios": _filas(conexion, "anuncios", ("id", "variante_id", "proveedor_id", "centro_id")),
    }


def _condiciones_actuales(
    solicitud: SolicitudEntrega, ids: set[str], ids_ciber: set[str], ids_cibernarium: set[str], evaluaciones: dict
) -> dict[tuple[str, str], ObjetoJson]:
    """Añade hechos actuales admitidos sin modificar prosa ni negocio nativos.

    Returns:
        Datos de la captura seleccionada para la misma unidad y corte público.
    """
    referencias = contenido_aprendizaje.referencias_de_evidencia_indexadas(solicitud.admision)
    actuales = contenido_academy.actuales(solicitud.admision, ids, referencias)
    return {
        **{
            ("programa", id): contenido_academy.datos_para_entrega(actual, solicitud.corte_utc)
            for id, actual in actuales.items()
        },
        **{
            ("programa", id): datos
            for id, datos in contenido_ciber.actuales(
                solicitud.admision, ids_ciber, referencias, evaluaciones["recurso"], solicitud.corte_utc
            ).items()
        },
        **{
            ("edicion", id): datos
            for id, datos in contenido_cibernarium.actuales(
                solicitud.admision, ids_cibernarium, referencias, evaluaciones["edicion"], solicitud.corte_utc
            ).items()
        },
    }


def _proyectar(solicitud: SolicitudEntrega) -> tuple[ObjetoJson, ObjetoJson]:
    base = solicitud.admision.snapshot.ruta
    conexion = sqlite3.connect(base.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    conexion.row_factory = sqlite3.Row
    try:
        conexion.execute("BEGIN")
        exigir(
            conexion.execute("PRAGMA user_version").fetchone()[0] == catalogo.VERSION_SQLITE_CONTENIDOS,
            "Solo se admite la instantánea V10",
        )
        estados, cobertura, revisiones, evaluaciones = {}, {}, {}, {}
        ids = {r[0] for r in conexion.execute("SELECT id FROM programas WHERE proveedor_id='anthropic'")}
        ids_ciber = {
            r[0]
            for r in conexion.execute(
                "SELECT id FROM programas WHERE proveedor_id='cibervoluntarios' OR id='fundae:1:3462'"
            )
        }
        ids_cibernarium = {
            r[0]
            for r in conexion.execute(
                "SELECT e.id FROM ediciones e JOIN programas p ON p.id=e.programa_id WHERE p.proveedor_id='cibernarium'"
            )
        }
        for tipo, objetivos in (("recurso", ids_ciber), ("edicion", ids_cibernarium)):
            estados[tipo], cobertura[tipo], revisiones[tipo], evaluaciones[tipo] = _vigencias(
                base, tipo, solicitud.corte_utc, objetivos
            )
        actuales = _condiciones_actuales(solicitud, ids, ids_ciber, ids_cibernarium, evaluaciones)
        materias = materia_cibernarium.actuales(solicitud.admision, ids_cibernarium, solicitud.corte_utc)
        exigir(
            isinstance(materias, dict)
            and set(materias) <= ids_cibernarium
            and all(isinstance(evidencia, dict) for evidencia in materias.values()),
            "Evidencias de materia fuera del dominio admitido",
        )
        colecciones = _colecciones(conexion, estados, _naturalezas(solicitud), actuales, materias)
        referencias_objetivos = contenido_aprendizaje.referencias_de_evidencia_indexadas(solicitud.admision)
        materia_objetivos.aplicar_fundae(colecciones, referencias_objetivos)
        nivel_itinerario_cibernarium.aplicar(colecciones, referencias_objetivos)
        materiales_objetivos = contenido_ciber.seleccionados(
            solicitud.admision, ids_ciber, referencias_objetivos, evaluaciones["recurso"]
        )
        materia_objetivos.aplicar_ciber(colecciones, materiales_objetivos)
        idiomas_edicion.aplicar_a_colecciones(
            colecciones, contenido_aprendizaje.referencias_de_evidencia_indexadas(solicitud.admision)
        )
        idioma_programa.aplicar_a_colecciones(
            colecciones, contenido_aprendizaje.referencias_de_evidencia_indexadas(solicitud.admision)
        )
        privado = {
            "schema_version": contrato.VERSION,
            "corte_proyeccion_utc": solicitud.corte_utc,
            "revision_registros": revisiones,
            "derechos": contrato.DERECHOS,
            "disponibilidad_actual": "no_determinada",
            **colecciones,
            "cobertura": cobertura,
        }
        retiradas = retirada_en_el_catalogo.retiradas_del_catalogo(solicitud.instalacion)
        publico = emision.clasificar_entrega(seleccionar(privado, solicitud.corte_utc, retiradas=retiradas))
        contrato.validar_publico(publico)
        return privado, publico
    finally:
        conexion.close()


def _preparacion(solicitud: SolicitudEntrega) -> tuple[ObjetoJson, ObjetoJson]:
    entrada = comprobar_entradas_de_entrega(solicitud)
    privado, publico = _proyectar(solicitud)
    exigir(entrada == comprobar_entradas_de_entrega(solicitud), "Entradas cambiaron durante proyección")
    linaje = {"entrada": entrada, "catalogo_privado": privado}
    exigir(
        len(bytes_json(publico)) <= MAX_PUBLICO and len(bytes_json(linaje)) <= MAX_PUBLICO,
        "Proyección sobre el límite",
    )
    return linaje, publico


def preparar(solicitud: SolicitudEntrega) -> ObjetoJson:
    """Conserva el catálogo completo privado y prepara solo ofertas acreditadas públicas.

    Returns:
        Cobertura del catálogo y de esta selección pública, nunca un censo remoto.
    """
    linaje, publico = _preparacion(solicitud)
    for nombre, valor in ((PUBLICO, publico), (LINAJE, linaje)):
        _guardar(solicitud, solicitud.area / "preparado" / nombre, bytes_json(valor))
    return {"privada": linaje["catalogo_privado"]["cobertura"], "publica": publico["cobertura"]}


def _informe(linaje: ObjetoJson, publico: ObjetoJson) -> ObjetoJson:
    controles = Controles()
    for control in CONTROLES:
        controles.comprobar(True, control)
    return {
        "schema_version": 2,
        "estado": "Admitido",
        "entradas": sha256_json(linaje),
        "conjunto_sha256": hashlib.sha256(bytes_json(publico)).hexdigest(),
        "cobertura": {"privada": linaje["catalogo_privado"]["cobertura"], "publica": publico["cobertura"]},
        "controles": controles.lista,
    }


def validar(solicitud: SolicitudEntrega) -> ObjetoJson:
    """Reproduce la proyección desde admisión V10 y admite sus bytes exactos.

    Returns:
        Informe común vinculado al linaje privado y al único artefacto público.
    """
    linaje, publico = _preparacion(solicitud)
    preparado = solicitud.area / "preparado"
    for nombre, esperado in ((PUBLICO, publico), (LINAJE, linaje)):
        frontera_de_entrega(solicitud).comprobar(preparado / nombre)
        exigir(
            _leer_bytes(preparado / nombre, MAX_PUBLICO) == bytes_json(esperado),
            "Preparado público o linaje alterado",
        )
    informe = _informe(linaje, publico)
    for nombre, valor in ((PUBLICO, publico), (LINAJE, linaje), ("validacion.json", informe)):
        _guardar(solicitud, solicitud.area / "validado" / nombre, bytes_json(valor))
    return informe


def exportar(solicitud: SolicitudEntrega, *, destino: Path) -> Path:
    """Exporta solo las ofertas admitidas, sin recalcular o exponer diagnósticos.

    Returns:
        Destino explícito, reemplazado atómicamente o intacto si es idéntico.

    Raises:
        ValidacionFallida: Si la admisión, el linaje o los bytes ya no corresponden.
    """
    entrada = comprobar_entradas_de_entrega(solicitud)
    area = solicitud.area / "validado"
    for nombre in ("validacion.json", LINAJE, PUBLICO):
        frontera_de_entrega(solicitud).comprobar(area / nombre)
    _leer_bytes(area / "validacion.json", MAX_PUBLICO)
    informe = exigir_admitido(CONJUNTO, ruta=area / "validacion.json")
    publico, linaje = (
        leer_json_de_entrega(area / PUBLICO, MAX_PUBLICO),
        leer_json_de_entrega(area / LINAJE, MAX_PUBLICO),
    )
    contrato.validar_publico(publico)
    exigir(isinstance(linaje, dict) and set(linaje) == {"entrada", "catalogo_privado"}, "Linaje incompatible")
    if bytes_json(linaje["entrada"]) != bytes_json(entrada) or bytes_json(informe) != bytes_json(
        _informe(linaje, publico)
    ):
        raise ValidacionFallida("Admisión desactualizada; preparar y validar de nuevo")
    cuerpo = bytes_json(publico)
    if _leer_bytes(area / PUBLICO, MAX_PUBLICO) != cuerpo:
        raise ValidacionFallida("Conjunto admitido alterado")
    exigir(entrada == comprobar_entradas_de_entrega(solicitud), "Entradas cambiaron antes de exportar")
    _guardar(solicitud, destino, cuerpo, publica=True)
    return destino
