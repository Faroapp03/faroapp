"""Compone Cursos dentro de la candidata común; nunca descarga o sirve tráfico.

La única SQLite operativa vive en var/actualizacion/validados/catalogo-cursos.
Su promoción a una instalación pertenece a actualizar.py junto con datos/web;
este comando prepara solamente los bytes de esa candidata. Bootstrap no es consulta.
"""

import hashlib
import json
import shutil
import sqlite3
import tempfile
from contextlib import closing
from datetime import UTC, datetime, timedelta
from functools import partial
from pathlib import Path

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, RAIZ, ErrorFuente
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import entrega_catalogo as entrega
from plataforma_datos.cursos import (
    materia_cibernarium,
    operacion_fuente,
    publicar_catalogo,
    reevaluar_registros,
    registro_vigencia,
)
from plataforma_datos.cursos.fallos_almacen import AUSENTE, ILEGIBLE, VACIO
from plataforma_datos.cursos.fuentes.barcelonactiva import actualizacion as cibernarium
from plataforma_datos.cursos.fuentes.cibervoluntarios import actualizacion as ciber
from plataforma_datos.cursos.fuentes.claude_academy import actualizacion as academy
from plataforma_datos.cursos.fuentes.fundae import actualizacion as fundae
from plataforma_datos.cursos.fuentes.fundae import adquisicion as adquisicion_fundae
from plataforma_datos.cursos.fuentes.fundae import conocidos as conocidos_fundae
from plataforma_datos.cursos.fuentes.fundae import preinscripcion
from plataforma_datos.cursos.fuentes.fundae.conocidos import PUBLICADORES as PUBLICADORES_FUNDAE
from plataforma_datos.cursos.fuentes.hp_life import actualizacion as hp
from plataforma_datos.cursos.fuentes.hp_life import altas as altas_hp
from plataforma_datos.cursos.fuentes.hp_life.recepciones import fecha_utc
from plataforma_datos.orquestacion import sustitucion
from plataforma_datos.orquestacion.ordenes import con_motivo

SEMBRAR = "python -m plataforma_datos.cursos.sembrar_almacen"
# El motivo de `fundae_sin_aplicar` de un conjunto que ya no se puede calcular con las identidades actuales.
NO_RECALCULABLE = "no-recalculable"
# El aviso del panel cuando un conjunto de FUNDAE se conserva sin aplicar (`fundae_retenido`).
CONJUNTO_SIN_APLICAR = "fundae-conjunto-sin-aplicar"
# Fuentes que parten de las identidades ya admitidas (HP LIFE da altas y bajas con su índice, pero sobre cursos que
# el almacén ya conoce), con los proveedores de esas identidades: su conjunto (validado o pendiente) no se aplica
# contra un almacén que no tiene ninguna identidad suya.
PROVEEDORES_SOBRE_CURSOS_ADMITIDOS = {"hp_life": ("hp-life",)}


class AlmacenNoDisponible(ErrorFuente):
    """El almacén de Cursos falta, no se puede leer o no tiene cursos: el paso falla y no publica nada."""

    def __init__(self, codigo: str, detalle: str) -> None:
        """Compone el motivo con su código de fallos_almacen delante."""
        super().__init__(f"{codigo}: {detalle}")
        self.codigo = codigo


def _sha(ruta: Path) -> str:
    with ruta.open("rb") as archivo:
        return hashlib.file_digest(archivo, "sha256").hexdigest()


def _control(solicitud: admision.SolicitudAdmision) -> dict:
    ref = solicitud.procedencia["control-catalogo"]
    return json.loads(hp.leer_verificado(ref, admision.indices_evidencias.MAX_INDICE))


def _corte(base: Path, defecto: str) -> str:
    with closing(sqlite3.connect(base.as_uri() + "?mode=ro&immutable=1", uri=True)) as conexion:
        mayor = conexion.execute("SELECT max(corte_us) FROM evaluaciones_vigencia").fetchone()[0]
    if mayor is None:
        return defecto
    return (datetime(1970, 1, 1, tzinfo=UTC) + timedelta(microseconds=mayor)).isoformat().replace("+00:00", "Z")


def _almacen_admitido(base: Path) -> admision.SolicitudAdmision:
    """Abre el almacén y comprueba su admisión; cualquier fallo de lectura es un fallo visible del paso.

    Returns:
        La solicitud de admisión del almacén vigente.

    Raises:
        AlmacenNoDisponible: Si falta o no se puede leer con integridad.
    """
    if not base.exists():
        raise AlmacenNoDisponible(
            AUSENTE, f"no hay almacén de Cursos; restaura el conservado o siembra uno nuevo con «{SEMBRAR}»"
        )
    try:
        entrada = almacen.solicitud(base)
        admision.exigir_snapshot_admitido(entrada, sha256_validacion=_sha(entrada.validacion_destino))
    except (ValueError, OSError, sqlite3.Error) as error:
        raise AlmacenNoDisponible(
            ILEGIBLE, f"el almacén de Cursos no se puede leer con integridad ({error}); restaura el conservado"
        ) from error
    return entrada


def _huella_de_fundae(base: Path) -> str:
    entrada = almacen.solicitud(base)
    conocidas = conocidos_fundae.leer(
        almacen.EntradaCatalogo(admision=entrada, sha256_admision=_sha(entrada.validacion_destino))
    )
    return adquisicion_fundae.huella_de_identidades(conocidas)


def fundae_retenido(raiz: Path, base: Path, conjunto: dict | None = None, inicial: Path | None = None) -> str | None:
    """Por qué un conjunto de FUNDAE no se aplica a este almacén, o None.

    Se lee el conjunto dado o el admitido, sin reproducirlo.

    Un conjunto con censo guarda la huella de las identidades con las que se calculó (`identidades_sha256`) y solo se
    aplica a un almacén con esas mismas; si no coincide, se conserva sin aplicar. Esa huella se compara con la del
    almacén `inicial` (el de partida de una composición; por omisión, `base`): los conjuntos que se aplican en la misma
    pasada parten de las mismas identidades aunque uno de ellos dé altas. Sobre un almacén sin identidades FUNDAE, un
    conjunto sin altas de un censo completo no aporta nada.

    Returns:
        «calculado-con-otras-identidades», «sin-altas-del-censo» o None si se puede aplicar.
    """
    if conjunto is None:
        _, _, validado = operacion_fuente.rutas_de_la_fuente("fundae", raiz)
        ruta = validado / "fundae.json"
        conjunto = json.loads(ruta.read_text(encoding="utf-8")) if ruta.is_file() else {}
    entrada = almacen.solicitud(base)
    censo = conjunto.get("censo") or {}
    if "identidades_sha256" in censo and censo["identidades_sha256"] != _huella_de_fundae(inicial or base):
        return "calculado-con-otras-identidades"
    if not _identidades_de(entrada.snapshot.ruta, PUBLICADORES_FUNDAE) and not censo.get("altas"):
        return "sin-altas-del-censo"
    return None


def fundae_conservado_sin_aplicar(raiz: Path, base: Path) -> str | None:
    """Por qué se conserva sin aplicar algún conjunto de FUNDAE: un pendiente o el validado aún sin instalar.

    El validado ya instalado no cuenta: su huella es la de antes de sus altas.

    Returns:
        El motivo de `fundae_retenido` del primero retenido, o None si no hay ninguno.
    """
    validado = operacion_fuente.validado_sin_instalar("fundae", raiz)
    conjuntos = [
        *([] if validado is None else [validado]),
        *(c for _, c in operacion_fuente.leer_pendientes("fundae", raiz)),
    ]
    return next((m for c in conjuntos if (m := fundae_retenido(raiz, base, c)) is not None), None)


def _identidades_de(snapshot: Path, proveedores: tuple[str, ...]) -> bool:
    with closing(sqlite3.connect(snapshot.as_uri() + "?mode=ro&immutable=1", uri=True)) as conexion:
        consulta = f"SELECT 1 FROM programas WHERE proveedor_id IN ({','.join('?' * len(proveedores))}) LIMIT 1"
        return conexion.execute(consulta, proveedores).fetchone() is not None


def _sin_identidades(snapshot: Path) -> tuple[str, ...]:
    """Fuentes que parten de identidades admitidas y no tienen ninguna en la instantánea (tras una siembra).

    Returns:
        Sus identificadores, en el orden de PROVEEDORES_SOBRE_CURSOS_ADMITIDOS.
    """
    with closing(sqlite3.connect(snapshot.as_uri() + "?mode=ro&immutable=1", uri=True)) as conexion:
        return tuple(
            id
            for id, proveedores in PROVEEDORES_SOBRE_CURSOS_ADMITIDOS.items()
            if conexion.execute(
                f"SELECT 1 FROM programas WHERE proveedor_id IN ({','.join('?' * len(proveedores))}) LIMIT 1",
                proveedores,
            ).fetchone()
            is None
        )


def _exigir_cursos(snapshot: Path, sin_identidades: tuple[str, ...]) -> None:
    """Un almacén sin ningún curso no se proyecta: publicaría un catálogo vacío en lugar del vigente.

    Raises:
        AlmacenNoDisponible: Si la instantánea no tiene ningún programa.
    """
    with closing(sqlite3.connect(snapshot.as_uri() + "?mode=ro&immutable=1", uri=True)) as conexion:
        if conexion.execute("SELECT 1 FROM programas LIMIT 1").fetchone() is None:
            detalle = "el almacén de Cursos no tiene ningún curso: ninguna fuente con censo propio ha dado altas"
            if sin_identidades:
                detalle += "; sin identidades admitidas no se aplican: " + ", ".join(sin_identidades)
            raise AlmacenNoDisponible(VACIO, detalle)


def _heredar_procedencias(anterior: dict, nuevo: dict) -> None:
    """Retiene las dependencias ajenas cuyo SHA sigue conservado en la nueva casa."""
    por_sha = {p["sha256"]: p["archivo"] for p in nuevo["archivos_conservados"]}
    for nombre, ref in anterior["procedencia"].items():
        if nombre in nuevo["procedencia"]:
            continue
        relativa = por_sha.get(ref["sha256"])
        entrega.exigir(relativa is not None, "Procedencia anterior sin archivo conservado: " + nombre)
        nuevo["procedencia"][nombre] = {"archivo": relativa, "sha256": ref["sha256"]}


def _aplicar_hp(raiz: Path, base: Path, trabajo: Path, salida: Path, corte: str) -> Path:
    conjunto = operacion_fuente.leer_validado("hp_life", raiz)
    if conjunto is None:
        return base
    control = _control(almacen.solicitud(base))
    # La misma recepción requiere recalcular si cambia su método, contrato o evaluador;
    # la fecha de consulta sigue en el recibo y nunca se sustituye por este corte.
    firma = {
        "recepciones": conjunto,
        "evaluador": registro_vigencia.firma_evaluador()["sha256"],
        "codigo_hp": {n: _sha(hp.RAIZ / "plataforma_datos" / n) for n in hp.ARCHIVOS_CODIGO},
        "contrato": _sha(hp.lotes.RUTA_CONTRATO),
        "politica": _sha(Path(hp.__file__).with_name("politica_vigencia_v3.json")),
    }
    huella = hashlib.sha256(operacion_fuente.json_bytes(firma)).hexdigest()
    if control["aplicados_por_fuente"].get("hp_life") == huella:
        return base
    original, _, _ = operacion_fuente.rutas_de_la_fuente("hp_life", raiz)

    def referencia(ref: dict) -> admision.ReferenciaArchivo:
        return admision.ReferenciaArchivo(ruta=almacen.ruta_relativa(original, ref["archivo"]), sha256=ref["sha256"])

    # Las pendientes son consultas admitidas cuyo catálogo no llegó a instalarse; entran con su fecha.
    filas = [*conjunto.get("pendientes", []), *conjunto["recepciones"]]
    recepciones = tuple(
        hp.RecepcionEnDisco(id=fila["id"], cuerpo=referencia(fila["cuerpo"]), recibo=referencia(fila["recibo"]))
        for fila in filas
        if fila["cuerpo"] is not None
    )
    # Un intento sin respuesta llega al registro como fallo de su unidad; no aporta contenido.
    fallos = tuple(
        hp.IntentoFallidoEnDisco(id=fila["id"], intento=referencia(fila["intento"]))
        for fila in filas
        if fila["cuerpo"] is None
    )
    # Las páginas del índice acreditan las altas del conjunto; sin ellas una alta espera a otra consulta.
    indice = tuple(
        altas_hp.PaginaIndiceEnDisco(
            pagina=pagina["pagina"], cuerpo=referencia(pagina["cuerpo"]), recibo=referencia(pagina["recibo"])
        )
        for pagina in (conjunto.get("indice") or {}).get("paginas", [])
    )
    entrada = almacen.solicitud(base)
    solicitud = hp.SolicitudHpLife(
        admision=entrada,
        sha256_admision=_sha(entrada.validacion_destino),
        recepciones=recepciones,
        fallos=fallos,
        indice=indice,
        retiradas=tuple((conjunto.get("bajas") or {}).get("retiradas", {})),
        contradicciones=tuple((conjunto.get("bajas") or {}).get("contradicciones", [])),
        gratuidad_intacta=(conjunto.get("gratuidad") or {}).get("intacta"),
        raiz_evidencias=base / "evidencias",
        area=trabajo / "hp-life",
        corte_utc=corte,
    )
    hp.preparar(solicitud)
    actualizada = hp.solicitud_admision(solicitud.area)
    nuevo = almacen.conservar(
        almacen.EntradaCatalogo(admision=actualizada, sha256_admision=_sha(actualizada.validacion_destino)),
        destino=salida,
    )
    _heredar_procedencias(control, nuevo)
    nuevo["aplicados_por_fuente"] = {**control["aplicados_por_fuente"], "hp_life": huella}
    guardar_json(salida / almacen.CONTROL, nuevo)
    admision.admitir_snapshot(almacen.solicitud(salida))
    return salida


def _aplicar_academy(raiz: Path, base: Path, salida: Path, corte: str, conjunto: dict | None = None) -> Path:
    conjunto = operacion_fuente.leer_validado("claude_academy", raiz) if conjunto is None else conjunto
    if conjunto is None:
        return base
    entrada = almacen.solicitud(base)
    control = _control(entrada)
    if control["aplicados_por_fuente"].get("claude_academy") == academy.firma(conjunto):
        return base
    original, _, _ = operacion_fuente.rutas_de_la_fuente("claude_academy", raiz)
    academy.aplicar(
        almacen.EntradaCatalogo(admision=entrada, sha256_admision=_sha(entrada.validacion_destino)),
        conjunto=conjunto,
        original=original,
        destino=salida,
        corte=corte,
    )
    return salida


def _aplicar_ciber(raiz: Path, base: Path, salida: Path, corte: str, conjunto: dict | None = None) -> Path:
    conjunto = operacion_fuente.leer_validado("cibervoluntarios", raiz) if conjunto is None else conjunto
    if conjunto is None:
        return base
    entrada = almacen.solicitud(base)
    control = _control(entrada)
    if control["aplicados_por_fuente"].get("cibervoluntarios") == ciber.firma(conjunto):
        return base
    original, _, _ = operacion_fuente.rutas_de_la_fuente("cibervoluntarios", raiz)
    ciber.aplicar(
        almacen.EntradaCatalogo(admision=entrada, sha256_admision=_sha(entrada.validacion_destino)),
        conjunto=conjunto,
        original=original,
        destino=salida,
        corte=corte,
    )
    return salida


def _aplicar_fundae(  # noqa: PLR0913 - Comparte la firma de las demás fuentes y añade el almacén de partida.
    raiz: Path,
    base: Path,
    salida: Path,
    corte: str,
    conjunto: dict | None = None,
    *,
    inicial: Path | None = None,
    retenidos: list[str] | None = None,
) -> Path:
    entrada = almacen.solicitud(base)
    if fundae_retenido(raiz, base, conjunto, inicial) is not None:
        return base
    # El pendiente se acaba de contrastar con su base de partida. El lector reproduce el validado con la de la raíz.
    base_contrastada = (inicial or base) if conjunto is not None else raiz / almacen.RUTA
    conjunto = operacion_fuente.leer_validado("fundae", raiz) if conjunto is None else conjunto
    if conjunto is None:
        return base
    original, _, _ = operacion_fuente.rutas_de_la_fuente("fundae", raiz)
    en_catalogo = almacen.EntradaCatalogo(admision=entrada, sha256_admision=_sha(entrada.validacion_destino))
    huella_del_censo = (conjunto.get("censo") or {}).get("identidades_sha256")
    if huella_del_censo is not None and base != base_contrastada:
        conocidas = conocidos_fundae.leer(en_catalogo)
        if huella_del_censo != adquisicion_fundae.huella_de_identidades(conocidas):
            # Un conjunto anterior dio altas. Se reproducen las capturas con las mismas identidades que se compararon.
            try:
                conjunto = fundae.recalcular(original, conjunto, conocidas)
            except (ErrorFuente, ValueError, KeyError, TypeError, OSError):
                if retenidos is not None:
                    retenidos.append(NO_RECALCULABLE)
                return base
    if _control(entrada)["aplicados_por_fuente"].get("fundae") == fundae.firma(conjunto):
        return base
    fundae.aplicar(
        en_catalogo,
        conjunto=conjunto,
        original=original,
        destino=salida,
        corte=corte,
    )
    return salida


def _aplicar_cibernarium(
    raiz: Path, base: Path, salida: Path, corte: str, conjunto: dict | tuple[dict, str] | None = None
) -> Path:
    pendiente = conjunto is not None
    corte_materia = corte
    if isinstance(conjunto, tuple):
        conjunto, corte_materia = conjunto
    conjunto = operacion_fuente.leer_validado("barcelonactiva", raiz) if conjunto is None else conjunto
    if conjunto is None:
        return base
    entrada = almacen.solicitud(base)
    nueva = base
    if _control(entrada)["aplicados_por_fuente"].get("barcelonactiva") != cibernarium.firma(conjunto):
        original, _, _ = operacion_fuente.rutas_de_la_fuente("barcelonactiva", raiz)
        cibernarium.aplicar(
            almacen.EntradaCatalogo(admision=entrada, sha256_admision=_sha(entrada.validacion_destino)),
            conjunto=conjunto,
            original=original,
            destino=salida,
            corte=corte,
        )
        nueva = salida
    entrada = almacen.solicitud(nueva)
    materia = salida.with_name(salida.name + "-materia")
    if materia_cibernarium.incorporar(
        almacen.EntradaCatalogo(admision=entrada, sha256_admision=_sha(entrada.validacion_destino)),
        raiz=raiz,
        ciclo_materia=materia_cibernarium.CicloMateria(conjunto, pendiente),
        destino=materia,
        corte=corte_materia,
    ):
        return materia
    return nueva


def _publicar_candidata(raiz: Path, nueva: Path, externo: Path, corte: str, sin_identidades: tuple[str, ...]) -> dict:
    """Proyecta y valida la entrega antes de publicar la candidata.

    Returns:
        Referencia pública preparada para la candidata.
    """
    admision_final = almacen.solicitud(nueva)
    _exigir_cursos(admision_final.snapshot.ruta, sin_identidades)
    proyeccion = entrega.SolicitudEntrega(
        admision=admision_final,
        instalacion=raiz,
        sha256_admision=_sha(admision_final.validacion_destino),
        area=externo / "proyeccion",
        corte_utc=materia_cibernarium.corte_proyeccion(
            admision_final, _corte(admision_final.snapshot.ruta, corte), corte
        ),
    )
    entrega.preparar(proyeccion)
    entrega.validar(proyeccion)
    referencia = publicar_catalogo.publicar(proyeccion, web=raiz / "web")
    return referencia


def componer(*, raiz: Path = RAIZ, corte_utc: str | None = None) -> dict:
    """Prepara admisión, instantánea y publicación únicamente dentro de la candidata.

    Sin recepción nueva conserva el corte registrado y los bytes de la instantánea;
    proyectar o copiar no renueva la comprobación de una fuente. El consumidor
    solo retira una oferta al alcanzar su límite publicado.

    Returns:
        Referencia pública y estado de los productores, sin afirmar activación real.

    Raises:
        AlmacenNoDisponible: Si el almacén falta, no se puede leer o queda sin cursos; no se publica nada.
        sustitucion.RecuperacionIncompleta: Si debe conservarse la candidata para recuperación.
    """
    base = raiz / almacen.RUTA
    corte = corte_utc or datetime.now(UTC).isoformat().replace("+00:00", "Z")
    fecha_utc(corte)
    sin_identidades = _sin_identidades(_almacen_admitido(base).snapshot.ruta)
    retenidos = [m for m in [fundae_conservado_sin_aplicar(raiz, base)] if m]
    temporales = raiz / DATOS_RELATIVOS / "preparados"
    temporales.mkdir(parents=True, exist_ok=True)
    local = Path(tempfile.mkdtemp(dir=temporales, prefix=".componer-cursos-"))
    externo = Path(tempfile.mkdtemp(prefix="componer-cursos-", dir=Path(tempfile.gettempdir()).resolve(strict=True)))
    conservar = False
    try:
        nueva = (
            base
            if "hp_life" in sin_identidades
            else _aplicar_hp(raiz, base, externo, local / "hp" / almacen.RUTA, corte)
        )
        for fuente, nombre, aplicar in (
            ("cibervoluntarios", "ciber", _aplicar_ciber),
            ("claude_academy", "academy", _aplicar_academy),
            ("fundae", "fundae", partial(_aplicar_fundae, inicial=base, retenidos=retenidos)),
            ("barcelonactiva", "cibernarium", _aplicar_cibernarium),
        ):
            if fuente in sin_identidades:
                continue
            # Los ciclos admitidos sin catálogo instalado van antes, cada uno con su corte y sus auxiliares.
            for numero, (propio, pendiente) in enumerate(operacion_fuente.leer_pendientes(fuente, raiz)):
                destino = local / f"{nombre}-pendiente-{numero}" / almacen.RUTA
                if fuente == "barcelonactiva":
                    nueva = _aplicar_cibernarium(raiz, nueva, destino, propio, (pendiente, corte))
                else:
                    nueva = aplicar(raiz, nueva, destino, propio, pendiente)
            nueva = aplicar(raiz, nueva, local / nombre / almacen.RUTA, corte)
        nueva = preinscripcion.aplicar_si_cambia(raiz, nueva, local / "fundae-ediciones" / almacen.RUTA, corte)
        nueva = reevaluar_registros.aplicar_si_cambia(nueva, local / "reevaluacion" / almacen.RUTA, corte)
        if nueva != base:
            final = local / "raiz" / almacen.RUTA
            final.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(nueva, final)
            nueva = final
        referencia = _publicar_candidata(raiz, nueva, externo, corte, sin_identidades)
        if nueva != base:
            # Es una candidata sin tráfico; la entrega común promueve SQLite y web juntas después del gate.
            sustitucion.sustituir(raiz, local / "raiz", (almacen.RUTA.as_posix(),), diario=local / "diario.json")
        return {
            "estado": "candidata_preparada",
            # Fuentes que no aportan hasta tener identidades admitidas; el panel las ve en ámbar por su módulo.
            "sin_identidades": list(sin_identidades),
            # Un pendiente de FUNDAE que se conserva sin aplicar (por ejemplo, de antes de una siembra): por qué.
            **({"fundae_sin_aplicar": retenidos[0]} if retenidos else {}),
            "referencia": referencia,
            "snapshot_sha256": _sha(base / "catalogo.sqlite3"),
            "publicacion_confirmada": None,
        }
    except sustitucion.RecuperacionIncompleta:
        conservar = True
        print(f"Recuperación de candidata pendiente. Conservar {local} y {externo}")
        raise
    finally:
        if not conservar:
            shutil.rmtree(local)
            shutil.rmtree(externo)


def main() -> int:
    """Entrada fijada por el ciclo común, sobre su propia copia de trabajo.

    Returns:
        Código con motivo legible; no instala ni activa una generación.
    """

    def ejecutar() -> None:
        print(json.dumps(componer(), ensure_ascii=False))

    return con_motivo(ejecutar)


if __name__ == "__main__":
    raise SystemExit(main())
