"""Preparación offline de recursos HP en copia V9; admisión común, sin publicación.

Procesa recepciones explícitas de identidades conocidas y de altas que una página del
índice acredita, y las retiradas que el censo completo del índice y la ficha afirman. No descarga, migra una base
ni interpreta una ficha como edición.
La promoción de un directorio nuevo solo ocurre tras completar y admitir su copia.
"""

import contextlib
import hashlib
import json
import shutil
import sqlite3
import tempfile
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo, catalogo, trozos_catalogo
from plataforma_datos.cursos.atribucion_temporal import CanalesAtribuidos, ContratoCanal
from plataforma_datos.cursos.fuentes.hp_life import altas, evaluacion, gratuidad, lector, pendientes, retiradas
from plataforma_datos.cursos.fuentes.hp_life import lotes_actualizacion as lotes
from plataforma_datos.cursos.fuentes.hp_life import observaciones_vigencia as puente
from plataforma_datos.cursos.fuentes.hp_life.recepciones import (
    MAX_CUERPO,
    MAX_RECIBO,
    fecha_utc,
    leer_recepcion,
)
from plataforma_datos.cursos.tipos_json import ObjetoJson

RAIZ = Path(__file__).resolve().parents[4]
ARCHIVOS_CODIGO = (
    "cursos/fuentes/hp_life/lector.py",
    "cursos/fuentes/hp_life/indice.py",
    "cursos/fuentes/hp_life/altas.py",
    "cursos/fuentes/hp_life/evaluacion.py",
    "cursos/fuentes/hp_life/retiradas.py",
    "cursos/fuentes/hp_life/gratuidad.py",
    "cursos/fuentes/hp_life/pendientes.py",
    "cursos/fuentes/hp_life/recepciones.py",
    "cursos/fuentes/hp_life/observaciones_vigencia.py",
    "cursos/fuentes/hp_life/lotes_actualizacion.py",
    "cursos/fuentes/hp_life/actualizacion.py",
    "cursos/politicas_vigencia.py",
)


@dataclass(frozen=True, kw_only=True)
class RecepcionEnDisco:
    """Referencias inmutables; id=None identifica FAQ general, nunca otra edición."""

    id: str | None
    cuerpo: admision.ReferenciaArchivo
    recibo: admision.ReferenciaArchivo


@dataclass(frozen=True, kw_only=True)
class IntentoFallidoEnDisco:
    """Intento sin respuesta de una unidad conocida; registra el fallo sin aportar contenido."""

    id: str
    intento: admision.ReferenciaArchivo


@dataclass(frozen=True, kw_only=True)
class SolicitudHpLife:
    """Base admitida, corte y entradas explícitos; no consulta HOME ni descubre carpetas."""

    admision: admision.SolicitudAdmision
    sha256_admision: str
    recepciones: tuple[RecepcionEnDisco, ...]
    raiz_evidencias: Path
    area: Path
    corte_utc: str
    fallos: tuple[IntentoFallidoEnDisco, ...] = ()
    indice: tuple[altas.PaginaIndiceEnDisco, ...] = ()
    retiradas: tuple[str, ...] = ()
    contradicciones: tuple[str, ...] = ()
    gratuidad_intacta: bool | None = None


def _sha(ruta: Path) -> str:
    with ruta.open("rb") as archivo:
        return hashlib.file_digest(archivo, "sha256").hexdigest()


def leer_verificado(referencia: admision.ReferenciaArchivo, limite: int) -> bytes:
    """Lee una evidencia conservada, entera o por trozos, y la devuelve solo si coincide con su huella.

    Returns:
        Los bytes verificados.

    Raises:
        ErrorFichaHpLife: Si la referencia no es un archivo regular, atraviesa un enlace, excede `limite` o está
            alterada.
    """
    ruta = referencia.ruta
    if any(p.is_symlink() for p in (ruta.absolute(), *ruta.absolute().parents)) or not ruta.is_file():
        raise lector.ErrorFichaHpLife("Referencia de recepción no regular o enlazada")
    try:
        # Un cuerpo conservado puede estar entero o por trozos; solo se devuelve verificado.
        return trozos_catalogo.leer(ruta, referencia.sha256, limite=limite)
    except trozos_catalogo.ErrorTrozos as error:
        raise lector.ErrorFichaHpLife("Referencia de recepción excedida o alterada") from error


def _guardar(ruta: Path, dato: ObjetoJson) -> None:
    ruta.write_text(
        json.dumps(dato, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n",
        encoding="utf-8",
    )


def _referencia(ruta: Path) -> admision.ReferenciaArchivo:
    return admision.ReferenciaArchivo(ruta=ruta, sha256=_sha(ruta))


def _referencias_conservadas(area: Path, pruebas: list[ObjetoJson]) -> dict[str, admision.ReferenciaArchivo]:
    """Traduce un inventario declarado a referencias físicas del contrato común.

    Returns:
        Referencias por identidad estable de la ruta relativa, con el SHA esperado.

    Raises:
        ErrorFichaHpLife: Si una ruta sale del ámbito de evidencias o pendientes.
    """
    referencias = {}
    for prueba in pruebas:
        relativa = Path(prueba["archivo"])
        if relativa.is_absolute() or ".." in relativa.parts or relativa.parts[0] not in ("evidencias", "pendientes"):
            raise lector.ErrorFichaHpLife("Ruta de evidencia fuera de la preparación")
        clave = "evidencia-" + hashlib.sha256(relativa.as_posix().encode()).hexdigest()
        referencias[clave] = admision.ReferenciaArchivo(ruta=area / relativa, sha256=prueba["sha256"])
    return referencias


def _heredar_evidencias(solicitud: SolicitudHpLife, area: Path) -> list[ObjetoJson]:
    """Conserva hechos, recibos y el prefijo histórico; recompone los índices actuales.

    Returns:
        Inventario de hechos íntegro, sin encadenar copias de índices regenerables.

    Raises:
        ErrorFichaHpLife: Si el inventario no está ligado a las mismas referencias admitidas.
    """
    compartido = solicitud.admision.procedencia.get("control-catalogo")
    if compartido is not None:
        raiz = compartido.ruta.parent
        if solicitud.admision.indices_evidencias.get("catalogo-evidencias") != admision.IndiceEvidencias(
            archivo=compartido, raiz=raiz
        ):
            raise lector.ErrorFichaHpLife("Catálogo compartido sin su índice admitido exacto")
        control = json.loads(leer_verificado(compartido, admision.MAX_ENTRADA))
        regenerables = almacen_catalogo.indices_regenerables(control)
        pruebas = [
            p
            for p in control["archivos_conservados"]
            if p["archivo"] not in regenerables and not pendientes.reemplazable(p["archivo"])
        ]
        for prueba in pruebas:
            relativa = Path(prueba["archivo"])
            lotes._conservar(raiz / relativa, area / relativa, prueba["sha256"])
        if "conservacion" not in control:
            # Prefijo histórico anterior: no se elimina ni reclasifica ningún byte existente.
            relativa = "evidencias/conservadas/" + compartido.sha256 + ".control-catalogo.json"
            lotes._conservar(compartido.ruta, area / relativa, compartido.sha256)
            pruebas.append({"archivo": relativa, "sha256": compartido.sha256})
        return pruebas
    referencia_control = solicitud.admision.procedencia.get("control-hp")
    if referencia_control is None:
        return []
    control = json.loads(leer_verificado(referencia_control, admision.MAX_ENTRADA))
    pruebas = [p for p in control["archivos_conservados"] if not pendientes.reemplazable(p["archivo"])]
    raiz_anterior = referencia_control.ruta.parent
    indice = solicitud.admision.indices_evidencias.get("hp-evidencias")
    if indice is not None and indice != admision.IndiceEvidencias(archivo=referencia_control, raiz=raiz_anterior):
        raise lector.ErrorFichaHpLife("Índice histórico distinto del control admitido")
    for clave, referencia in _referencias_conservadas(raiz_anterior, pruebas).items():
        if indice is None and solicitud.admision.procedencia.get(clave) != referencia:
            raise lector.ErrorFichaHpLife("Inventario histórico sin referencia física admitida exacta")
        relativa = referencia.ruta.relative_to(raiz_anterior)
        lotes._conservar(referencia.ruta, area / relativa, referencia.sha256)
    return pruebas


def solicitud_admision(area: Path) -> admision.SolicitudAdmision:
    """Expone el único informe de admisión y sus dependencias reales al proyector común.

    Returns:
        Referencias actuales; cambiar código, contrato o política exige revalidar.

    """
    procedencia = {
        "control-hp": _referencia(area / "control-hp-life.json"),
        "lotes-hp": _referencia(area / "lotes-hp-life.json"),
        "admision-base": _referencia(area / "admision-base.json"),
        "contrato-hp": _referencia(lotes.RUTA_CONTRATO),
        "politica-hp": _referencia(Path(__file__).with_name("politica_vigencia_v3.json")),
    }
    for nombre in ARCHIVOS_CODIGO:
        clave = "codigo-" + Path(nombre).stem.replace("_", "-")
        procedencia[clave] = _referencia(RAIZ / "plataforma_datos" / nombre)
    return admision.SolicitudAdmision(
        snapshot=_referencia(area / "catalogo.sqlite3"),
        procedencia=procedencia,
        validacion_destino=area / "validacion.json",
        indices_evidencias={"hp-evidencias": admision.IndiceEvidencias(archivo=procedencia["control-hp"], raiz=area)},
    )


def validar(area: Path) -> ObjetoJson:
    """Comprueba procedencia y admisión existentes sin migrar ni evaluar de nuevo.

    Returns:
        Informe común verificado; no es una autorización de publicación.
    """
    return admision.exigir_snapshot_admitido(solicitud_admision(area), sha256_validacion=_sha(area / "validacion.json"))


def _entradas(solicitud: SolicitudHpLife) -> ObjetoJson:
    fecha_utc(solicitud.corte_utc)
    admision.exigir_snapshot_admitido(solicitud.admision, sha256_validacion=solicitud.sha256_admision)
    if (
        type(solicitud.recepciones) is not tuple
        or type(solicitud.fallos) is not tuple
        or not (solicitud.recepciones or solicitud.fallos)
    ):
        raise lector.ErrorFichaHpLife("Recepciones conocidas deben ser una tupla no vacía")
    filas, legibles = [], []
    vistas = set()
    for entrada in solicitud.recepciones:
        cuerpo, recibo = leer_verificado(entrada.cuerpo, MAX_CUERPO), leer_verificado(entrada.recibo, MAX_RECIBO)
        fila = {
            "id": entrada.id,
            "cuerpo_sha256": hashlib.sha256(cuerpo).hexdigest(),
            "recibo_sha256": hashlib.sha256(recibo).hexdigest(),
        }
        # Una unidad puede traer recepciones pendientes de ciclos anteriores; la misma, no.
        if (entrada.id, fila["recibo_sha256"]) in vistas:
            raise lector.ErrorFichaHpLife("Identidad de recepción repetida en el mismo corte")
        vistas.add((entrada.id, fila["recibo_sha256"]))
        with contextlib.suppress(lector.ErrorFichaHpLife):
            # Una recepción ilegible sigue su camino propio: se conserva como pendiente.
            legibles.append((entrada, leer_recepcion(cuerpo, recibo)))
        filas.append(fila)
    # Solo la recepción más reciente de cada unidad describe su contenido actual.
    legibles = [(e, r) for e, r in legibles if e.id is not None]
    sustituidas = {e.recibo.sha256 for e, _r in legibles} - evaluacion.vigentes(legibles)
    anteriores = [f for f in filas if f["recibo_sha256"] in sustituidas]
    filas = [f for f in filas if f["recibo_sha256"] not in sustituidas]
    fallos = []
    for fallo in solicitud.fallos:
        fila = {
            "id": fallo.id,
            "intento_sha256": hashlib.sha256(leer_verificado(fallo.intento, MAX_RECIBO)).hexdigest(),
        }
        if (fallo.id, fila["intento_sha256"]) in vistas:
            raise lector.ErrorFichaHpLife("Intento fallido repetido en el mismo corte")
        vistas.add((fallo.id, fila["intento_sha256"]))
        fallos.append(fila)
    entradas = {
        "snapshot_sha256": solicitud.admision.snapshot.sha256,
        "admision_sha256": solicitud.sha256_admision,
        "corte_utc": solicitud.corte_utc,
        "recepciones": filas,
        "codigo_sha256": {n: _sha(RAIZ / "plataforma_datos" / n) for n in ARCHIVOS_CODIGO},
        "contrato_sha256": _sha(lotes.RUTA_CONTRATO),
        "politica_sha256": _sha(Path(__file__).with_name("politica_vigencia_v3.json")),
    }
    if solicitud.indice:
        entradas["indice"] = [
            {
                "pagina": p.pagina,
                "cuerpo_sha256": hashlib.sha256(leer_verificado(p.cuerpo, MAX_CUERPO)).hexdigest(),
                "recibo_sha256": hashlib.sha256(leer_verificado(p.recibo, MAX_RECIBO)).hexdigest(),
            }
            for p in sorted(solicitud.indice, key=lambda p: p.pagina)
        ]
    if solicitud.retiradas or solicitud.contradicciones:
        entradas["bajas"] = {
            "retiradas": sorted(solicitud.retiradas),
            "contradicciones": sorted(solicitud.contradicciones),
        }
    if anteriores:
        entradas["anteriores"] = anteriores
    if fallos:
        entradas["fallos"] = fallos
    # Sin ficha leída en este corte, la unidad conserva la recepción vigente del control anterior.
    sin_ficha = ({f["id"] for f in fallos} | {e.id for e, _r in legibles}) - {f["id"] for f in filas}
    entradas["recepciones"].extend(_vigentes_heredadas(solicitud, sin_ficha))
    return entradas


def _vigentes_heredadas(solicitud: SolicitudHpLife, ids: set[str]) -> list[ObjetoJson]:
    """Mantiene la última recepción válida de las unidades que hoy solo traen un fallo.

    Un fallo de consulta no retira el contenido acreditado: la recepción vigente del
    control admitido anterior sigue describiendo la unidad, con su fecha original.

    Returns:
        Filas del control anterior para esas unidades, marcadas como heredadas.
    """
    referencia = solicitud.admision.procedencia.get("control-hp")
    if referencia is None or not ids:
        return []
    anterior = json.loads(leer_verificado(referencia, admision.MAX_ENTRADA))
    return [
        {"id": f["id"], "cuerpo_sha256": f["cuerpo_sha256"], "recibo_sha256": f["recibo_sha256"], "heredada": True}
        for f in anterior["entradas"]["recepciones"]
        if f["id"] in ids
    ]


def _frontera(solicitud: SolicitudHpLife) -> None:
    area = solicitud.area.absolute()
    entradas = [
        solicitud.admision.snapshot.ruta,
        solicitud.admision.validacion_destino,
        RAIZ,
    ]
    entradas.extend(r.ruta for r in solicitud.admision.procedencia.values())
    entradas.extend(admision.rutas_evidencias_indexadas(solicitud.admision))
    entradas.extend(p.ruta for r in solicitud.recepciones for p in (r.cuerpo, r.recibo))
    entradas.extend(f.intento.ruta for f in solicitud.fallos)
    entradas.extend(r.ruta for p in solicitud.indice for r in (p.cuerpo, p.recibo))
    if any(p.is_symlink() for p in (area, *area.parents)):
        raise lector.ErrorFichaHpLife("El área propia no admite enlaces")
    for origen in entradas:
        if area.resolve().is_relative_to(origen.resolve()) or origen.resolve().is_relative_to(area.resolve()):
            raise lector.ErrorFichaHpLife("El área de preparación invade una entrada o el producto")


def _pendiente(
    entrada: RecepcionEnDisco, cuerpo: bytes, recibo: bytes, area: Path, causa: tuple[str, str]
) -> ObjetoJson:
    # Conserva entradas no adaptables completas; no fabrica completitud para un recibo histórico.
    motivo, corte = causa
    return pendientes.registrar(
        pendientes.Pendiente(entrada.id, cuerpo, entrada.cuerpo.sha256, recibo, entrada.recibo.sha256, motivo, corte),
        area,
    )


def _procesar(
    solicitud: SolicitudHpLife, area: Path, contrato: ContratoCanal, entradas: ObjetoJson
) -> tuple[list[lotes.PlanRecurso], list[ObjetoJson]]:
    planes, control = [], []
    acreditadas = altas.acreditaciones(solicitud.indice, lambda r: leer_verificado(r, MAX_CUERPO))
    with closing(sqlite3.connect((area / "catalogo.sqlite3").as_uri() + "?mode=ro&immutable=1", uri=True)) as conexion:
        conexion.row_factory = sqlite3.Row
        proyectan = {f["recibo_sha256"] for f in entradas["recepciones"]}
        for entrada in solicitud.recepciones:
            cuerpo, recibo = leer_verificado(entrada.cuerpo, MAX_CUERPO), leer_verificado(entrada.recibo, MAX_RECIBO)
            try:
                recepcion = leer_recepcion(cuerpo, recibo)
            except lector.ErrorFichaHpLife as error:
                control.append(_pendiente(entrada, cuerpo, recibo, area, (str(error), solicitud.corte_utc)))
                continue
            if fecha_utc(recepcion.captura.recibido_utc) > fecha_utc(solicitud.corte_utc):
                raise lector.ErrorFichaHpLife("Recepción posterior al corte; no se inventa una fecha")
            pruebas = lotes.conservar_recepcion(recepcion, area / "evidencias")
            if entrada.id is None:
                faq = lector.extraer_condiciones_generales(cuerpo, recepcion.captura)
                control.append(
                    {
                        "id": None,
                        "estado": "faq-general-separada",
                        "evidencias": pruebas,
                        "gratuidad_declarada_general": bool(faq.gratuidad) or None,
                    }
                )
                continue
            oferta = {"id": entrada.id, "fuente_id": "hp_life", "url": recepcion.captura.url_solicitada}
            observacion = gratuidad.condicionar(
                puente.construir_observacion(recepcion, oferta=oferta), solicitud.gratuidad_intacta
            )
            if not altas.conocido(conexion, entrada.id):
                plan = altas.planificar_alta(recepcion, observacion, acreditadas.get(entrada.id))
                if entrada.recibo.sha256 in proyectan and plan is None:
                    control.append(
                        _pendiente(
                            entrada,
                            cuerpo,
                            recibo,
                            area,
                            (gratuidad.motivo_de_alta_pendiente(solicitud.gratuidad_intacta), solicitud.corte_utc),
                        )
                    )
                    continue
                if plan is not None:
                    planes.append(plan)
                    pruebas = [*pruebas, *lotes.conservar_recepcion(plan.acreditacion, area / "evidencias")]
                programa = {"id": entrada.id}
            elif entrada.recibo.sha256 in proyectan:
                plan = lotes.planificar_recurso(conexion, recepcion, contrato, observacion)
                programa = plan.programa
                planes.append(plan)
            else:
                # Recepción anterior de la misma unidad: entra en su historial, no proyecta datos viejos.
                programa = lotes.programa_recibido(conexion, recepcion)
            if programa["id"] != entrada.id:
                raise lector.ErrorFichaHpLife("ID de entrada distinto de la unidad nativa solicitada")
            control.append(
                {
                    "id": entrada.id,
                    "estado": "recepcion-completa",
                    "observacion": observacion,
                    "evidencias": pruebas,
                    "metodo": puente.METODO,
                }
            )
        control.extend(retiradas.procesar_fallos(solicitud, lambda r: leer_verificado(r, MAX_RECIBO), conexion, area))
        control.extend(retiradas.procesar(solicitud, lambda r: leer_verificado(r, MAX_CUERPO), conexion, area))
    return planes, control


def _cargar(
    planes: list[lotes.PlanRecurso], solicitud: SolicitudHpLife, area: Path, contrato: ContratoCanal
) -> tuple[list[ObjetoJson], list[ObjetoJson]]:
    entradas, canales, antecedentes = [], [], []
    for plan in planes:
        actuales = list(plan.canales)
        lotes.conservar_canales(actuales, solicitud.raiz_evidencias, area / "evidencias")
        antecedentes.extend(e for c in actuales for e in c["evidencias"])
        if plan.lote is None:
            continue
        pruebas = lotes.conservar_recepcion(plan.recepcion, area / "evidencias")
        acreditacion = lotes.conservar_recepcion(plan.acreditacion, area / "evidencias") if plan.acreditacion else []
        anterior = next((c for c in actuales if c["canal"] == contrato.clave), None)
        proyectado = {k: v for k, v in plan.lote["programas"][0].items() if k not in ("evidencias", "etiquetas")}
        if (
            anterior is not None
            and anterior["evidencias"] == pruebas
            and sha256_json(proyectado) == sha256_json(plan.programa)
        ):
            continue
        nuevos = [c for c in actuales if c["canal"] != contrato.clave]
        if plan.acreditacion is None:
            nuevos.append(
                {"entidad": "programa", "id": plan.programa["id"], "canal": contrato.clave, "evidencias": pruebas}
            )
            evidencias = [e for c in nuevos for e in c["evidencias"]]
        else:
            # Una alta no tiene negocio anterior que anclar: su ficha y su página del índice son su canal de origen.
            nuevos.append(
                {
                    "entidad": "programa",
                    "id": plan.programa["id"],
                    "canal": altas.CANAL_ALTA,
                    "evidencias": [*pruebas, *acreditacion],
                }
            )
            evidencias = [e for c in nuevos for e in c["evidencias"]]
        plan.lote["programas"][0]["evidencias"] = evidencias
        entradas.append(plan.lote)
        canales.append(tuple(nuevos))
    if entradas:
        catalogo.cargar_lotes(
            area / "catalogo.sqlite3",
            entradas,
            True,
            area / "evidencias",
            canales_temporales=CanalesAtribuidos(canales_por_lote=tuple(canales), contratos=(contrato,)),
        )
    return entradas, antecedentes


def _archivos_conservados(
    filas: list[ObjetoJson], antecedentes: list[ObjetoJson], heredadas: list[ObjetoJson]
) -> list[ObjetoJson]:
    """Enumera pruebas esperadas desde sus contratos, sin descubrir ni rehacer sus SHA.

    Returns:
        Rutas relativas y huellas declaradas; la admisión común verificará sus bytes.

    Raises:
        ErrorFichaHpLife: Si una misma ruta declara contenidos diferentes.
    """
    reescritos = {a["archivo"] for fila in filas if fila["estado"] == "pendiente" for a in fila["archivos"]}
    pruebas = [
        *(p for p in heredadas if p["archivo"] not in reescritos),
        *({"archivo": "evidencias/" + e["archivo"], "sha256": e["sha256"]} for e in antecedentes),
    ]
    for fila in filas:
        if fila["estado"] == "pendiente":
            pruebas.extend(fila["archivos"])
        else:
            pruebas.extend({"archivo": "evidencias/" + e["archivo"], "sha256": e["sha256"]} for e in fila["evidencias"])
    esperadas = {}
    for prueba in pruebas:
        ruta, sha = prueba["archivo"], prueba["sha256"]
        if ruta in esperadas and esperadas[ruta] != sha:
            raise lector.ErrorFichaHpLife("Una ruta de evidencia declara SHA diferentes")
        esperadas[ruta] = sha
    return [{"archivo": ruta, "sha256": sha} for ruta, sha in sorted(esperadas.items())]


def _preparar(solicitud: SolicitudHpLife, area: Path, entradas: ObjetoJson) -> ObjetoJson:
    contrato = lotes.leer_contrato()
    shutil.copyfile(solicitud.admision.snapshot.ruta, area / "catalogo.sqlite3")
    if _sha(area / "catalogo.sqlite3") != solicitud.admision.snapshot.sha256:
        raise lector.ErrorFichaHpLife("La copia no conserva la instantánea de entrada")
    shutil.copyfile(solicitud.admision.validacion_destino, area / "admision-base.json")
    heredadas = _heredar_evidencias(solicitud, area)
    planes, filas = _procesar(solicitud, area, contrato, entradas)
    heredadas = pendientes.retirar_resueltos(area, filas, heredadas)
    cargados, antecedentes = _cargar(planes, solicitud, area, contrato)
    evaluaciones = evaluacion.evaluar(filas, area, solicitud.corte_utc)
    control = {
        "schema_version": 1,
        "fuente_id": "hp_life",
        "entradas": entradas,
        "recepciones": filas,
        "archivos_conservados": _archivos_conservados(filas, antecedentes, heredadas),
        "evaluaciones": evaluaciones,
        "censo_completo": False,
        "publicacion_confirmada": None,
    }
    _guardar(area / "lotes-hp-life.json", {"schema_version": 1, "lotes": cargados})
    _guardar(area / "control-hp-life.json", control)
    if _entradas(solicitud) != entradas:
        raise lector.ErrorFichaHpLife("Las entradas cambiaron durante la preparación")
    admision.admitir_snapshot(solicitud_admision(area))
    return control


def preparar(solicitud: SolicitudHpLife) -> ObjetoJson:
    """Prepara y admite una copia nueva; cualquier fallo impide promoverla.

    Returns:
        Control privado. Repetir entradas/corte idénticos verifica y conserva bytes y mtime.

    Raises:
        ErrorFichaHpLife: Si el destino invade entradas, cambió el corte o hay conflicto de identidad.
    """
    _frontera(solicitud)
    entradas = _entradas(solicitud)
    if solicitud.area.exists():
        control = json.loads((solicitud.area / "control-hp-life.json").read_bytes())
        if control.get("entradas") != entradas:
            raise lector.ErrorFichaHpLife("El área existente pertenece a otra preparación")
        validar(solicitud.area)
        return control
    solicitud.area.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=solicitud.area.parent, prefix=".hp-life-") as temporal:
        area = Path(temporal)
        control = _preparar(solicitud, area, entradas)
        if solicitud.area.exists():
            raise lector.ErrorFichaHpLife("El destino apareció durante la preparación")
        area.rename(solicitud.area)
    return control
