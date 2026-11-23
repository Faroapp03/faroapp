"""Admisión cotidiana de SQLite V10, independiente del origen de investigación.

Verifica una copia cerrada y sus artefactos de procedencia existentes mediante
la admisión común. No migra, evalúa disponibilidad, consulta fuentes ni publica.
El informe identifica bytes y revisión local; no es una firma de un tercero ni
acredita por sí mismo derechos, verdad remota o frescura de las observaciones.
"""

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

from plataforma_datos.comun.entrada_salida import temporal_hermano
from plataforma_datos.comun.nucleo import Controles, ValidacionFallida
from plataforma_datos.cursos import indices_evidencias, trozos_catalogo
from plataforma_datos.cursos.auditoria_snapshot_catalogo import (
    MAX_FILAS,
    TABLAS_COBERTURA,
    ErrorAdmisionCatalogo,
    auditar,
    comprobar_cierre,
    exigir,
)
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson
from plataforma_datos.orquestacion.admision import exigir_admitido

VERSION = 1
VERSION_INDEXADA = 2
CONJUNTO = "catalogo-cursos"
ALCANCE = "integridad_procedencia_catalogo_no_oferta_no_publicacion"
MAX_SQLITE = 512 * 1024 * 1024
# Cota de cada cuerpo, entero o reconstruido desde sus trozos.
MAX_ENTRADA = trozos_catalogo.MAX_CUERPO
MAX_TOTAL_ENTRADAS = 256 * 1024 * 1024
MAX_INFORME = 1024 * 1024
MAX_REFERENCIAS = 256
TAMANO_BLOQUE = 1024 * 1024
CONTROLES = (
    "Snapshot cerrado V10 e íntegro",
    "Entidades, versiones y referencias coherentes",
    "Índice FTS concordante",
    "Historia y unidades auditadas por el registro V10",
    "Procedencia, bytes y código conservados durante la admisión",
)
RAIZ = Path(__file__).resolve().parents[2]
ESQUEMA = Path(__file__).with_name("esquemas") / "admision_catalogo.json"
CODIGO = (
    "cursos/admision_catalogo.py",
    "cursos/indices_evidencias.py",
    "cursos/trozos_catalogo.py",
    "cursos/recibos_compartidos.py",
    "cursos/auditoria_snapshot_catalogo.py",
    "cursos/catalogo.py",
    "cursos/atribucion_temporal.py",
    "cursos/registro_vigencia.py",
    "cursos/almacen_vigencia.py",
    "cursos/contenidos_vigencia.py",
    "cursos/unidades_vigencia.py",
    "cursos/enriquecimiento_legado.py",
    "cursos/contrato_fichas.py",
    "cursos/vigencia.py",
    "cursos/oferta_continua.py",
    "cursos/retirada_proveedor.py",
    "cursos/normalizar_destinatarios.py",
    "cursos/contrato_aprendizaje.py",
    "cursos/tipos_json.py",
    "cursos/herramientas/normalizar_investigacion.py",
    "orquestacion/admision.py",
    "comun/nucleo.py",
    "comun/entrada_salida.py",
    "comun/huella_json.py",
)
CONTRATOS = (
    "admision_catalogo.json",
    "indice_evidencias.json",
    "contrato.json",
    "contrato_vigencia.json",
    "registro_vigencia.json",
    "registro_unidades_vigencia.json",
    "registro_aprendizaje.json",
    "contrato_registro_aprendizaje.json",
    "curso-destinatario-v1.json",
    "destinatarios-v1-vocabulario.json",
    "destinatarios-v1-alias.json",
)


@dataclass(frozen=True, kw_only=True)
class ReferenciaArchivo:
    """Archivo existente y huella esperada; una ruta no implica recepción nueva."""

    ruta: Path
    sha256: str


@dataclass(frozen=True, kw_only=True)
class IndiceEvidencias:
    """Inventario sellado y raíz explícita; no habilita descubrimiento de archivos."""

    archivo: ReferenciaArchivo
    raiz: Path


@dataclass(frozen=True, kw_only=True)
class SolicitudAdmision:
    """Instantánea y procedencia por IDs lógicos; salida explícita en área propia."""

    snapshot: ReferenciaArchivo
    procedencia: Mapping[str, ReferenciaArchivo]
    validacion_destino: Path
    indices_evidencias: Mapping[str, IndiceEvidencias] = field(default_factory=dict)


def exigir_ruta_sin_enlaces(ruta: Path) -> None:
    """Exige que ni la ruta ni sus carpetas superiores sean enlaces simbólicos, para no salir de su zona."""
    absoluta = ruta.absolute()
    exigir(all(not p.is_symlink() for p in (absoluta, *absoluta.parents)), "Ruta o padre con enlace simbólico")


def comprobar_archivo_referenciado(referencia: ReferenciaArchivo, limite: int) -> ObjetoJson:
    """Comprueba ruta, límite y huella de una referencia; devuelve su huella y tamaño.

    Returns:
        La huella y el tamaño leídos del archivo.
    """
    exigir_ruta_sin_enlaces(referencia.ruta)
    exigir(re.fullmatch("[0-9a-f]{64}", referencia.sha256) is not None, "SHA256 esperado no válido")
    exigir(referencia.ruta.is_file(), "Referencia ausente o no regular")
    exigir(referencia.ruta.stat().st_size <= limite, "Archivo excede el límite de bytes")
    total = 0
    huella = hashlib.sha256()
    with referencia.ruta.open("rb") as archivo:
        while bloque := archivo.read(TAMANO_BLOQUE):
            total += len(bloque)
            exigir(total <= limite, "Archivo creció sobre el límite")
            huella.update(bloque)
    exigir(huella.hexdigest() == referencia.sha256, "Archivo alterado respecto a su SHA256 esperado")
    return {"sha256": referencia.sha256, "bytes": total}


def _sha(ruta: Path) -> str:
    with ruta.open("rb") as archivo:
        return hashlib.file_digest(archivo, "sha256").hexdigest()


def firma_codigo() -> ObjetoJson:
    """Identifica artefactos efectivos; no inspecciona bytecode modificado en caliente.

    Returns:
        Huellas portables de código y recursos que obligan a revalidar al cambiar.
    """
    archivos = [RAIZ / "plataforma_datos" / nombre for nombre in CODIGO]
    archivos.extend(ESQUEMA.parent / nombre for nombre in CONTRATOS)
    return {p.relative_to(RAIZ).as_posix(): _sha(p) for p in archivos}


def entrada_regular_ajena_al_destino(entrada: Path, destino: Path) -> bool:
    """Descarta una colisión entre archivos cuando ya existe la carpeta del destino.

    Un archivo regular no puede contener un destino con carpeta existente. Si el destino existe,
    el sistema compara sus identidades físicas, incluso con otras grafías o enlaces duros.

    Returns:
        True solo si esta entrada regular no puede coincidir con el destino ni contenerlo.
    """
    try:
        if not destino.parent.is_dir() or entrada.is_symlink() or not entrada.is_file():
            return False
        return not destino.exists() or not destino.samefile(entrada)
    except OSError:
        # Una ruta cambiada o ilegible pasa por la comprobación completa.
        return False


def _frontera(solicitud: SolicitudAdmision, indexadas: tuple[Path, ...] = ()) -> None:
    destino = solicitud.validacion_destino
    exigir_ruta_sin_enlaces(destino)
    entradas = [solicitud.snapshot.ruta, *(r.ruta for r in solicitud.procedencia.values()), *indexadas]
    entradas.extend(i.archivo.ruta for i in solicitud.indices_evidencias.values())
    entradas.extend(
        solicitud.snapshot.ruta.with_name(solicitud.snapshot.ruta.name + s) for s in ("-wal", "-shm", "-journal")
    )
    entradas.extend(RAIZ / "plataforma_datos" / nombre for nombre in CODIGO)
    entradas.extend(ESQUEMA.parent / nombre for nombre in CONTRATOS)
    for entrada in entradas:
        if entrada_regular_ajena_al_destino(entrada, destino):
            continue
        exigir(not destino.resolve().is_relative_to(entrada.resolve()), "Destino sobre una entrada protegida")
        exigir(not (destino.exists() and entrada.exists() and destino.samefile(entrada)), "Alias duro de entrada")


@dataclass
class _Presupuesto:
    """Cotas compartidas por procedencia, índices y todos sus archivos físicos.

    El presupuesto cuenta bytes almacenados: cada archivo físico (cuerpo entero,
    manifiesto o trozo) se lee una sola vez por admisión. Así la admisión sigue
    acotando su lectura de disco aunque muchas capturas compartan trozos.
    """

    restante: int
    archivos: int
    trozos_vistos: dict[Path, int] = field(default_factory=dict)

    def comprobar(self, referencia: ReferenciaArchivo, limite: int) -> ObjetoJson:
        """Verifica bytes esperados y descuenta el consumo del único presupuesto.

        Returns:
            SHA y bytes efectivos comprobados.
        """
        resultado = comprobar_archivo_referenciado(referencia, min(limite, self.restante))
        self.restante -= resultado["bytes"]
        return resultado

    def comprobar_evidencia(self, referencia: ReferenciaArchivo, limite: int) -> ObjetoJson:
        """Verifica un cuerpo entero o su manifiesto y trozos, sin releer trozos compartidos.

        El cuerpo reconstruido respeta el mismo límite por entrada. Su huella completa
        se verificó al conservarlo y se verifica en cada lectura de su contenido; aquí
        quedan comprobados el manifiesto, cada trozo por su huella y los tamaños.

        Returns:
            SHA y bytes del cuerpo original, iguales para un cuerpo entero o por trozos.

        Raises:
            ErrorAdmisionCatalogo: Si el manifiesto, un trozo o el presupuesto no lo admiten.
        """
        exigir_ruta_sin_enlaces(referencia.ruta)
        exigir(re.fullmatch("[0-9a-f]{64}", referencia.sha256) is not None, "SHA256 esperado no válido")
        exigir(referencia.ruta.is_file(), "Referencia ausente o no regular")
        try:
            manifiesto = trozos_catalogo.manifiesto_de(referencia.ruta, referencia.sha256, limite=limite)
            if manifiesto is None:
                return self.comprobar(referencia, limite)
            fisicos = referencia.ruta.stat().st_size
            exigir(fisicos <= self.restante, "Archivo excede el límite de bytes")
            self.restante -= fisicos
            self.restante -= trozos_catalogo.comprobar_almacenado(
                referencia.ruta, manifiesto, self.trozos_vistos, restante=self.restante
            )
        except trozos_catalogo.ErrorTrozos as error:
            raise ErrorAdmisionCatalogo(str(error)) from error
        return {"sha256": referencia.sha256, "bytes": manifiesto.bytes}


def leer_pruebas_indice_referenciado(referencia: ReferenciaArchivo) -> tuple[indices_evidencias.PruebaIndexada, ...]:
    """Lee un índice de evidencias con su tope de tamaño, exige su huella y devuelve las pruebas que enumera.

    Returns:
        Las pruebas que enumera el índice.
    """
    with referencia.ruta.open("rb") as archivo:
        contenido = archivo.read(indices_evidencias.MAX_INDICE + 1)
    exigir(hashlib.sha256(contenido).hexdigest() == referencia.sha256, "Índice cambió durante su lectura")
    return indices_evidencias.leer_indice(contenido)


def rutas_evidencias_indexadas(solicitud: SolicitudAdmision) -> tuple[Path, ...]:
    """Expone las entradas efectivas para proteger fronteras de consumidores.

    Verifica bytes/estructura del índice. La integridad de sus cuerpos se exige
    mediante admitir_snapshot/exigir_snapshot_admitido, no mediante este auxiliar.

    Returns:
        Índices y rutas declaradas, sin descubrir archivos o ejecutar código.
    """
    exigir(len(solicitud.indices_evidencias) <= MAX_REFERENCIAS, "Demasiados índices")
    presupuesto = _Presupuesto(restante=MAX_TOTAL_ENTRADAS, archivos=indices_evidencias.MAX_ARCHIVOS)
    rutas = []
    for indice in solicitud.indices_evidencias.values():
        presupuesto.comprobar(indice.archivo, indices_evidencias.MAX_INDICE)
        pruebas = leer_pruebas_indice_referenciado(indice.archivo)
        exigir(len(pruebas) <= presupuesto.archivos, "Demasiados archivos indexados en la solicitud")
        presupuesto.archivos -= len(pruebas)
        rutas.extend((indice.archivo.ruta, *(indice.raiz / p.archivo for p in pruebas)))
    return tuple(rutas)


def _indice_comprobado(
    indice: IndiceEvidencias, presupuesto: _Presupuesto, usadas: set[Path]
) -> tuple[ObjetoJson, tuple[Path, ...]]:
    resumen = presupuesto.comprobar(indice.archivo, indices_evidencias.MAX_INDICE)
    pruebas = leer_pruebas_indice_referenciado(indice.archivo)
    exigir(len(pruebas) <= presupuesto.archivos, "Demasiados archivos indexados en la solicitud")
    presupuesto.archivos -= len(pruebas)
    rutas, total = [], 0
    for prueba in pruebas:
        ruta = indice.raiz / prueba.archivo
        exigir(ruta.resolve() not in usadas, "Archivo repetido entre índices de evidencias")
        usadas.add(ruta.resolve())
        referencia = ReferenciaArchivo(ruta=ruta, sha256=prueba.sha256)
        comprobada = presupuesto.comprobar_evidencia(referencia, MAX_ENTRADA)
        exigir(ruta.stat().st_nlink == 1, "Evidencia indexada con enlaces duros")
        total += comprobada["bytes"]
        rutas.append(ruta)
    return {"indice": resumen, "archivos": len(pruebas), "bytes_archivos": total}, tuple(rutas)


def _entradas(solicitud: SolicitudAdmision) -> ObjetoJson:
    cantidad = len(solicitud.procedencia) + len(solicitud.indices_evidencias)
    exigir(solicitud.procedencia and cantidad <= MAX_REFERENCIAS, "Procedencia vacía o excesiva")
    for nombre in (*solicitud.procedencia, *solicitud.indices_evidencias):
        exigir(
            isinstance(nombre, str) and re.fullmatch("[a-z0-9][a-z0-9_-]{0,79}", nombre), "ID de procedencia inválido"
        )
    exigir(
        not solicitud.procedencia.keys() & solicitud.indices_evidencias.keys(), "ID de índice repetido en procedencia"
    )
    presupuesto = _Presupuesto(restante=MAX_TOTAL_ENTRADAS, archivos=indices_evidencias.MAX_ARCHIVOS)
    # El almacén conserva también la procedencia por trozos cuando pasa del umbral: se verifica como evidencia.
    procedencia = {n: presupuesto.comprobar_evidencia(r, MAX_ENTRADA) for n, r in sorted(solicitud.procedencia.items())}
    indices, rutas, usadas = {}, [], set()
    for nombre, indice in sorted(solicitud.indices_evidencias.items()):
        resumen, archivos = _indice_comprobado(indice, presupuesto, usadas)
        indices[nombre] = resumen
        rutas.extend(archivos)
    _frontera(solicitud, tuple(rutas))
    snapshot = comprobar_archivo_referenciado(solicitud.snapshot, MAX_SQLITE)
    comprobar_cierre(solicitud.snapshot.ruta)
    entradas = {"snapshot": snapshot, "procedencia": procedencia, "codigo_sha256": firma_codigo()}
    if indices:
        entradas["indices_evidencias"] = indices
    return entradas


def bytes_json_admision(dato: ValorJson) -> bytes:
    """Serializa JSON canónico; las huellas de la admisión se calculan sobre estos bytes exactos.

    Returns:
        Los bytes UTF-8 del JSON canónico, con salto de línea final.
    """
    return (
        json.dumps(dato, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n"
    ).encode()


def _informe(entradas: ObjetoJson, cobertura: ObjetoJson) -> ObjetoJson:
    controles = Controles()
    for etiqueta in CONTROLES:
        controles.comprobar(True, etiqueta)
    return {
        "schema_version": VERSION_INDEXADA if "indices_evidencias" in entradas else VERSION,
        "tipo": "catalogo-sqlite",
        "estado": "Admitido",
        "version_sqlite": 10,
        "alcance": ALCANCE,
        "publicacion_confirmada": None,
        "controles": controles.lista,
        **entradas,
        "cobertura": cobertura,
    }


def _guardar(solicitud: SolicitudAdmision, cuerpo: bytes, entradas: ObjetoJson) -> None:
    destino = solicitud.validacion_destino
    exigir(len(cuerpo) <= MAX_INFORME, "Informe excesivo")
    _frontera(solicitud)
    if destino.exists() and destino.stat().st_size == len(cuerpo) and destino.read_bytes() == cuerpo:
        return
    destino.parent.mkdir(parents=True, exist_ok=True)
    temporal = None
    try:
        with temporal_hermano(destino.parent, prefijo="." + destino.name + "-") as archivo:
            temporal = Path(archivo.name)
            archivo.write(cuerpo)
            archivo.flush()
        exigir(_entradas(solicitud) == entradas, "Entradas cambiaron antes del reemplazo")
        temporal.replace(destino)
    finally:
        if temporal is not None:
            temporal.unlink(missing_ok=True)


def admitir_snapshot(solicitud: SolicitudAdmision) -> ObjetoJson:
    """Audita y admite la instantánea operativa sin reconstruir su importación inicial.

    Returns:
        Informe estándar vinculado a las entradas y al código congelados.
    """
    entradas = _entradas(solicitud)
    cobertura = auditar(solicitud.snapshot.ruta)
    exigir(_entradas(solicitud) == entradas, "Entradas cambiaron durante la auditoría")
    informe = _informe(entradas, cobertura)
    _guardar(solicitud, bytes_json_admision(informe), entradas)
    return informe


def exigir_snapshot_admitido(solicitud: SolicitudAdmision, *, sha256_validacion: str) -> ObjetoJson:
    """Comprueba la admisión y sus vínculos sin repetir auditoría ni evaluar oferta.

    Esta lectura pertenece a preparación/exportación, nunca a cada petición web.

    Returns:
        Informe verificado; disponer de él no acredita publicación o frescura.

    Raises:
        ErrorAdmisionCatalogo: Si falta una guarda o cambió cualquier entrada.
    """
    entradas = _entradas(solicitud)
    comprobar_archivo_referenciado(
        ReferenciaArchivo(ruta=solicitud.validacion_destino, sha256=sha256_validacion), MAX_INFORME
    )
    try:
        informe = exigir_admitido(CONJUNTO, ruta=solicitud.validacion_destino)
    except (ValueError, ValidacionFallida) as error:
        raise ErrorAdmisionCatalogo("Informe de admisión no válido") from error
    cobertura = informe.get("cobertura")
    exigir(isinstance(cobertura, dict) and set(cobertura) == set(TABLAS_COBERTURA), "Cobertura incompatible")
    exigir(all(type(n) is int and 0 <= n <= MAX_FILAS for n in cobertura.values()), "Recuentos no válidos")
    exigir(
        bytes_json_admision(informe) == bytes_json_admision(_informe(entradas, cobertura)),
        "Contrato o vínculos del informe incompatibles",
    )
    exigir(
        solicitud.validacion_destino.read_bytes() == bytes_json_admision(informe),
        "Informe no canónico o con claves repetidas",
    )
    exigir(_entradas(solicitud) == entradas, "Entradas cambiaron durante la lectura")
    comprobar_archivo_referenciado(
        ReferenciaArchivo(ruta=solicitud.validacion_destino, sha256=sha256_validacion), MAX_INFORME
    )
    return informe
