"""Observaciones de enlaces de Biblioteca, fuera del catálogo editorial.

Las capturas y decisiones de identidad viven en var, no en git. Descargar consulta
solo los enlaces HTTPS declarados; preparar/validar son locales. La admisión de un
informe con desconocidos no acredita sus enlaces. Exportar requiere contrato,
catálogo, evidencia y estados temporales actuales; nunca reescribe lecturas.json.
"""

import hashlib
import json
import sqlite3
import sys
import tempfile
from collections.abc import Iterator
from contextlib import closing, contextmanager
from dataclasses import asdict, fields
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError, URLError

from plataforma_datos.biblioteca.fuentes.enlaces_lecturas.contrato import (
    MAX_BYTES,
    SHA256,
    Captura,
    Contexto,
    Identidad,
    _Lecturas,
    es_evidencia_concluyente,
    evaluar,
    instante,
    url_web,
    validar_captura,
)
from plataforma_datos.biblioteca.fuentes.enlaces_lecturas.http import ControlHTTP, perfil_objetivo
from plataforma_datos.comun.entrada_salida import carpetas, sha256, temporal_hermano
from plataforma_datos.comun.nucleo import MAX_DESCARGA_BYTES, Descarga, FormatoInesperado, ValidacionFallida
from plataforma_datos.comun.observacion_remota import observar_original
from plataforma_datos.comun.red import descargar_url
from plataforma_datos.contratos.fuentes import cargar_fuente, comprobar_lector
from plataforma_datos.orquestacion.admision import exigir_admitido
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "enlaces_lecturas"
MODULO = "plataforma_datos.biblioteca.fuentes.enlaces_lecturas.lector"
CASA = Path(__file__).resolve().parent
CATALOGO = CASA.parent / "lecturas/catalogo.json"
CONTRATO = CASA / "contrato.json"
ARCHIVO = "observaciones-lecturas.json"
VERSION_ENTREGA = 2
VERSION_CONTRATO = 2
MAX_JSON = 8 * 1024 * 1024


def ahora() -> datetime:
    """Proporciona reloj sustituible, nunca fecha de revisión editorial.

    Returns:
        Instante UTC actual.
    """
    return datetime.now(UTC)


def _pares(pares: list[tuple[str, object]]) -> dict[str, object]:
    """Rechaza JSON con claves duplicadas.

    Returns:
        Objeto sin corrección silenciosa.

    Raises:
        FormatoInesperado: Si una clave se repite.
    """
    objeto: dict[str, object] = {}
    for clave, valor in pares:
        if clave in objeto:
            raise FormatoInesperado("enlaces_lecturas: clave repetida")
        objeto[clave] = valor
    return objeto


def _leer(ruta: Path) -> dict[str, object]:
    """Lee un objeto acotado, sin enlaces de archivos ni claves duplicadas.

    Returns:
        Documento JSON.

    Raises:
        FormatoInesperado: Si el archivo o el objeto no son verificables.
    """
    if ruta.is_symlink() or ruta.stat().st_size > MAX_JSON:
        raise FormatoInesperado("enlaces_lecturas: archivo no verificable")
    try:
        valor: object = json.loads(ruta.read_text(encoding="utf-8"), object_pairs_hook=_pares)
    except (ValueError, UnicodeError) as error:
        raise FormatoInesperado("enlaces_lecturas: JSON no válido") from error
    if not isinstance(valor, dict):
        raise FormatoInesperado("enlaces_lecturas: objeto requerido")
    return valor


def _bytes(valor: object) -> bytes:
    """Serializa de forma determinista sin fechas propias.

    Returns:
        JSON UTF-8 estable.
    """
    return (json.dumps(valor, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def _guardar(ruta: Path, datos: bytes) -> None:
    """Reemplaza solo el destino propio y no reescribe contenido idéntico.

    Raises:
        FormatoInesperado: Si el destino es un enlace de archivos.
    """
    if ruta.is_symlink():
        raise FormatoInesperado("enlaces_lecturas: destino enlazado")
    if ruta.exists() and ruta.read_bytes() == datos:
        return
    ruta.parent.mkdir(parents=True, exist_ok=True)
    temporal = None
    try:
        with temporal_hermano(ruta.parent, prefijo=".observacion-") as archivo:
            temporal = Path(archivo.name)
            archivo.write(datos)
        temporal.replace(ruta)
    finally:
        if temporal is not None:
            temporal.unlink(missing_ok=True)


def objetivos(catalogo: Path | None = None) -> list[dict[str, str | None]]:
    """Proyecta IDs/enlaces sin reinterpretar idiomas, títulos ni criterios editoriales.

    Returns:
        Un registro por lectura, con sus variantes de enlace.

    Raises:
        FormatoInesperado: Si faltan IDs/enlaces o se repiten IDs.
    """
    filas = _leer(CATALOGO if catalogo is None else catalogo).get("lecturas")
    if not isinstance(filas, list) or not filas:
        raise FormatoInesperado("enlaces_lecturas: catálogo sin lecturas")
    salida: list[dict[str, str | None]] = []
    ids: set[str] = set()
    for fila in filas:
        if not isinstance(fila, dict) or not isinstance(fila.get("id"), str) or fila["id"] in ids:
            raise FormatoInesperado("enlaces_lecturas: ID ausente o repetido")
        ids.add(fila["id"])
        for campo in ("enlace", "enlace_ca"):
            url = fila.get(campo)
            if url is not None and not isinstance(url, str):
                raise FormatoInesperado("enlaces_lecturas: enlace no textual")
            if campo == "enlace" or url is not None:
                salida.append({"objetivo": fila["id"] + ":" + campo, "id": fila["id"], "campo": campo, "url": url})
    return salida


def _contexto() -> Contexto:
    """Comprueba el contrato técnico y la ficha operativa real.

    Returns:
        Reloj y plazo declarados.

    Raises:
        FormatoInesperado: Ante contrato desconocido o plazo no válido.
    """
    descriptor = cargar_fuente(FUENTE, tema="biblioteca")
    comprobar_lector(descriptor, identificador=FUENTE, modulo=MODULO, casa=FUENTE)
    contrato = _leer(CONTRATO)
    dias = contrato.get("validez_dias")
    if (
        set(contrato) != {"version", "validez_dias"}
        or type(contrato["version"]) is not int
        or contrato["version"] != VERSION_CONTRATO
        or type(dias) is not int
        or dias <= 0
    ):
        raise FormatoInesperado("enlaces_lecturas: contrato técnico no válido")
    return Contexto(ahora(), dias)


def conservar(captura: Captura, cuerpo: bytes | None) -> None:
    """Conserva captura inmutable por huella; no actualiza un registro mutable por llegada."""
    validar_captura(captura, cuerpo, _contexto())
    original = carpetas(FUENTE).original
    if cuerpo is not None:
        _guardar(original / "cuerpos" / str(captura.cuerpo_sha256), cuerpo)
    registro = _bytes(asdict(captura))
    _guardar(original / "capturas" / (hashlib.sha256(registro).hexdigest() + ".json"), registro)


def _recibir(url: str) -> tuple[Captura, Descarga | None, dict[str, object]]:
    """Usa el transporte serial común y conserva fallos como hechos, sin inferir bajas.

    Returns:
        Captura, respuesta solo si fue completa y hechos HTTP recibidos, aunque no hubiera cuerpo.
    """
    control = ControlHTTP(url, ahora)
    descarga = None
    cabeceras, perfil = perfil_objetivo(url)
    try:
        descarga = descargar_url(
            url, cabeceras, perfil=perfil, maximo_bytes=MAX_BYTES, comprobar_cabeceras=control.comprobar
        )
    except HTTPError as error:
        control.anotar(error.code, error.url, error.headers or {})
        error.close()
        captura = _fallo(url, "http_error", type(error).__name__, error.code)
    except (URLError, TimeoutError, OSError, FormatoInesperado) as error:
        captura = _fallo(url, "fallo_temporal", type(getattr(error, "reason", error)).__name__)
    else:
        captura = Captura(
            url=url,
            url_final=descarga.url_final,
            capturado_utc=ahora().isoformat(),
            cuerpo_sha256=hashlib.sha256(descarga.datos).hexdigest(),
            content_type=descarga.content_type,
            resultado="respuesta",
            codigo_http=None,
        )
    return captura, descarga, control.hechos(descarga is not None)


def _fallo(url: str, resultado: str, error_tipo: str, codigo_http: int | None = None) -> Captura:
    """Conserva un intento fallido sin afirmar que no existe el recurso.

    Returns:
        Captura sin cuerpo ni destino acreditados, con fecha real del intento terminado.
    """
    return Captura(
        url=url,
        url_final=None,
        capturado_utc=ahora().isoformat(),
        cuerpo_sha256=None,
        content_type="",
        resultado=resultado,
        codigo_http=codigo_http,
        error_tipo=error_tipo,
    )


def conservar_http(captura: Captura, hechos: dict[str, object]) -> None:
    """Conserva el recibo técnico inmutable ligado a la captura, sin reescribir historia v1."""
    documento = {
        **hechos,
        "captura_sha256": hashlib.sha256(_bytes(asdict(captura))).hexdigest(),
        "finalizado_utc": captura.capturado_utc,
        "resultado": captura.resultado,
        "error_tipo": captura.error_tipo,
    }
    contenido = _bytes(documento)
    _guardar(carpetas(FUENTE).original / "http" / (hashlib.sha256(contenido).hexdigest() + ".json"), contenido)


def descargar(_aceptar_cambio: bool = False) -> None:
    """Consulta cada URL externa una vez; no sustituye originales ni modifica el catálogo."""
    _contexto()
    urls = dict.fromkeys(fila["url"] for fila in objetivos() if fila["url"] and fila["url"].startswith("https://"))
    for url in urls:
        assert isinstance(url, str)
        url_web(url)
        captura, descarga, hechos = _recibir(url)
        conservar(captura, None if descarga is None else descarga.datos)
        conservar_http(captura, hechos)
        if descarga is not None:
            observar_original(url, descarga, descarga.datos)
    _registrar_originales()


def _captura_en(ruta: Path, contexto: Contexto) -> tuple[Captura, Path | None]:
    """Verifica una captura y su cuerpo antes de cualquier selección.

    Returns:
        Metadatos comprobados y localizador del contenido, sin retener los bytes.

    Raises:
        FormatoInesperado: Ante huella, campos, tamaño o causalidad no válidos.
    """
    if sha256(ruta) != ruta.stem:
        raise FormatoInesperado("enlaces_lecturas: captura alterada")
    dato = _leer(ruta)
    if set(dato) != {campo.name for campo in fields(Captura)}:
        raise FormatoInesperado("enlaces_lecturas: campos de captura no válidos")
    captura = Captura(**dato)
    archivo, cuerpo = None, None
    if captura.cuerpo_sha256 is not None:
        if not isinstance(captura.cuerpo_sha256, str) or SHA256.fullmatch(captura.cuerpo_sha256) is None:
            raise FormatoInesperado("enlaces_lecturas: huella no válida")
        archivo = carpetas(FUENTE).original / "cuerpos" / captura.cuerpo_sha256
        if archivo.is_symlink() or archivo.stat().st_size > MAX_DESCARGA_BYTES:
            raise FormatoInesperado("enlaces_lecturas: cuerpo no verificable")
        cuerpo = archivo.read_bytes()
    validar_captura(captura, cuerpo, contexto)
    return captura, archivo


def _anotar(historia: sqlite3.Connection, captura: Captura, archivo: Path | None) -> None:
    """Mantiene un índice temporal y detecta simultáneos UTC aunque cambie su grafía.

    Raises:
        FormatoInesperado: Si dos capturas distintas declaran el mismo instante por URL.
    """
    try:
        historia.execute(
            "INSERT INTO capturas VALUES (?, ?, ?, ?)",
            (
                captura.url,
                instante(captura.capturado_utc).isoformat(timespec="microseconds"),
                _bytes(asdict(captura)).decode(),
                None if archivo is None else str(archivo),
            ),
        )
    except sqlite3.IntegrityError as error:
        raise FormatoInesperado("enlaces_lecturas: capturas simultáneas contradictorias") from error


@contextmanager
def _historia(contexto: Contexto) -> Iterator[sqlite3.Connection]:
    """Verifica el historial en disco sin límite vitalicio ni cargarlo entero en memoria.

    El índice solo contiene metadatos, nunca cuerpos ni decisiones nuevas. Se
    cierra y elimina al salir, también ante excepción o interrupción de Python.

    Yields:
        Índice privado para seleccionar candidatos de la operación actual.
    """
    with (
        tempfile.TemporaryDirectory(prefix="biblioteca-historial-") as temporal,
        closing(sqlite3.connect(Path(temporal) / "indice.sqlite3")) as historia,
    ):
        historia.execute("PRAGMA cache_size = -512")
        historia.execute(
            "CREATE TABLE capturas (url TEXT NOT NULL, instante TEXT NOT NULL, datos TEXT NOT NULL, "
            "archivo TEXT, UNIQUE(url, instante))"
        )
        for ruta in (carpetas(FUENTE).original / "capturas").glob("*.json"):
            captura, archivo = _captura_en(ruta, contexto)
            _anotar(historia, captura, archivo)
        yield historia


def _capturas(historia: sqlite3.Connection, url: str) -> Iterator[tuple[Captura, Path | None]]:
    """Recorre una URL de la más reciente a la más antigua, sin materializar su historia.

    Yields:
        Captura comprobada y archivo de cuerpo, cuando lo hubo.
    """
    with closing(
        historia.execute("SELECT datos, archivo FROM capturas WHERE url = ? ORDER BY instante DESC", (url,))
    ) as cursor:
        for dato, archivo in cursor:
            yield Captura(**json.loads(dato)), None if archivo is None else Path(archivo)


def _identidades() -> dict[str, list[Identidad]]:
    """Lee evidencias revisadas acumuladas; el robot no inventa ni sustituye decisiones.

    Returns:
        Evidencias históricas por objetivo; ausencia significa identidad desconocida.

    Raises:
        FormatoInesperado: Ante versión, estructura o evidencias incompletas.
    """
    ruta = carpetas(FUENTE).original / "identidades.json"
    if not ruta.exists():
        return {}
    documento = _leer(ruta)
    if (
        set(documento) != {"version", "decisiones"}
        or type(documento["version"]) is not int
        or documento["version"] != 1
    ):
        raise FormatoInesperado("enlaces_lecturas: decisiones no válidas")
    decisiones = documento["decisiones"]
    if not isinstance(decisiones, dict):
        raise FormatoInesperado("enlaces_lecturas: decisiones deben ser objeto")
    salida = {}
    for objetivo, lista in decisiones.items():
        if not isinstance(lista, list):
            raise FormatoInesperado("enlaces_lecturas: se requiere lista de evidencias por objetivo")
        salida[objetivo] = [_identidad(dato) for dato in lista]
    return salida


def _identidad(dato: object) -> Identidad:
    """Comprueba una evidencia explícita sin derivarla de títulos o fechas de proceso.

    Returns:
        Identidad vinculada a URL y captura revisada.

    Raises:
        FormatoInesperado: Si falta un campo, URL, huella o fecha verificable.
    """
    if not isinstance(dato, dict) or set(dato) != {campo.name for campo in fields(Identidad)}:
        raise FormatoInesperado("enlaces_lecturas: identidad incompleta")
    identidad = Identidad(**dato)
    url_web(identidad.url)
    url_web(identidad.url_final)
    instante(identidad.revisado_utc)
    huellas = [identidad.cuerpo_sha256]
    if identidad.texto_sha256 is not None:
        huellas.append(identidad.texto_sha256)
    if any(not isinstance(huella, str) or SHA256.fullmatch(huella) is None for huella in huellas):
        raise FormatoInesperado("enlaces_lecturas: identidad sin huella")
    return identidad


def _vista(
    captura: Captura, archivo: Path | None, decisiones: list[Identidad], contexto: Contexto, lecturas: _Lecturas
) -> dict[str, object]:
    """Evalúa una captura sin cargar el historial entero de cuerpos en memoria.

    Returns:
        Vista técnica bajo la revisión específica más reciente de esos bytes.
    """
    compatibles = [
        identidad
        for identidad in decisiones
        if (identidad.url, identidad.url_final, identidad.cuerpo_sha256)
        == (captura.url, captura.url_final, captura.cuerpo_sha256)
        and instante(identidad.revisado_utc) <= contexto.ahora
    ]
    identidad = max(compatibles, key=lambda valor: instante(valor.revisado_utc)) if compatibles else None
    cuerpo = archivo.read_bytes() if archivo is not None else None
    return evaluar(captura, cuerpo, identidad, contexto, _lecturas=lecturas)


def _confirmacion(
    capturas: Iterator[tuple[Captura, Path | None]],
    decisiones: list[Identidad],
    contexto: Contexto,
    lecturas: _Lecturas,
) -> dict[str, object] | None:
    """Busca confirmación solo entre capturas con revisión específica temporalmente posible.

    Returns:
        La confirmación más reciente, sin parsear el resto de cuerpos históricos.
    """
    revisadas = {
        (identidad.url, identidad.url_final, identidad.cuerpo_sha256)
        for identidad in decisiones
        if instante(identidad.revisado_utc) <= contexto.ahora
    }
    if revisadas:
        for captura, archivo in capturas:
            if (captura.url, captura.url_final, captura.cuerpo_sha256) in revisadas:
                vista = _vista(captura, archivo, decisiones, contexto, lecturas)
                if vista["estado"] == "verificado":
                    return vista
    return None


def _estado_objetivo(
    fila: dict[str, str | None],
    historia: sqlite3.Connection,
    identidades: dict[str, list[Identidad]],
    contexto: Contexto,
    lecturas: _Lecturas,
) -> dict[str, object]:
    """Selecciona por captura efectiva antes de extraer, conservando confirmación tras fallo.

    Returns:
        Último intento, última evidencia concluyente y última confirmación, sin cambiar sus fechas.
    """
    url = fila["url"]
    if url is None or not url.startswith("https://"):
        return {
            **fila,
            "estado": "no_aplica_consulta_remota",
            "ultimo_intento": None,
            "ultima_confirmacion": None,
            "ultima_evidencia": None,
        }
    decisiones = identidades.get(fila["objetivo"], [])
    ultimo, confirmada = None, None
    with closing(_capturas(historia, url)) as capturas:
        primera = next(capturas, None)
        if primera is not None:
            ultimo = _vista(*primera, decisiones, contexto, lecturas)
            confirmada = (
                ultimo if ultimo["estado"] == "verificado" else _confirmacion(capturas, decisiones, contexto, lecturas)
            )
    evidencia = ultimo if ultimo is not None and es_evidencia_concluyente(ultimo["estado"]) else None
    if ultimo is not None and evidencia is None:
        with closing(_capturas(historia, url)) as capturas:
            next(capturas, None)
            for captura, archivo in capturas:
                vista = _vista(captura, archivo, decisiones, contexto, lecturas)
                if es_evidencia_concluyente(vista["estado"]):
                    evidencia = vista
                    break
    return {
        **fila,
        "estado": ultimo["estado"] if ultimo else "sin_observacion",
        "ultimo_intento": ultimo,
        "ultima_confirmacion": confirmada,
        "ultima_evidencia": evidencia,
    }


def _crear() -> dict[str, object]:
    """Construye un informe actual sin fecha de ejecución que rejuvenezca observaciones.

    Returns:
        Cobertura completa del catálogo con desconocidos explícitos por objetivo.
    """
    contexto = _contexto()
    identidades = _identidades()
    lecturas = _Lecturas((sha256(CONTRATO), sha256(CASA / "contrato.py"), sha256(CASA / "pdf.py")))
    with _historia(contexto) as historia:
        filas = [_estado_objetivo(fila, historia, identidades, contexto, lecturas) for fila in objetivos()]
    return {
        "version": VERSION_ENTREGA,
        "catalogo_sha256": sha256(CATALOGO),
        "validez_dias": contexto.validez_dias,
        "revision_editorial": "fuera_del_alcance",
        "objetivos": filas,
        "verificados": sum(fila["estado"] == "verificado" for fila in filas),
    }


def firmas_en(casa: Path, catalogo: Path, original: Path) -> dict[str, str]:
    """Firma la casa y evidencia reales, también al verificar desde otra raíz.

    Returns:
        Huellas portables de todas las entradas efectivas, sin seguir enlaces.

    Raises:
        FormatoInesperado: Si una evidencia o contrato es un enlace de archivos.
    """
    rutas = [*casa.glob("*.py"), casa / "contrato.json", casa / "fuente.json", catalogo]
    rutas += [ruta for ruta in original.rglob("*") if ruta.is_file()]
    if any(ruta.is_symlink() for ruta in rutas):
        raise FormatoInesperado("enlaces_lecturas: entrada enlazada")
    return {
        str(ruta.relative_to(casa))
        if ruta.is_relative_to(casa)
        else "catalogo_editorial"
        if ruta == catalogo
        else "original/" + str(ruta.relative_to(original)): sha256(ruta)
        for ruta in sorted(rutas)
    }


def _firmas() -> dict[str, str]:
    """Liga admisión a código, contratos, catálogo y todas las evidencias efectivas.

    Returns:
        Huellas actuales sin información del equipo.
    """
    return firmas_en(CASA, CATALOGO, carpetas(FUENTE).original)


def _registrar_originales() -> None:
    """Indexa evidencia real para el respaldo común; la proyección editorial es inequívocamente local.

    No asigna una fecha de descarga a la proyección ni convierte su presencia en
    consulta remota. El historial completo se incluye sin borrar ninguna captura.

    Raises:
        FormatoInesperado: Si una evidencia enlazada no puede inventariarse como propia.
    """
    original = carpetas(FUENTE).original
    catalogo_sha = sha256(CATALOGO)
    proyeccion = {
        "tipo": "proyeccion_local_de_objetivos_editoriales",
        "consulta_remota": False,
        "catalogo_sha256": catalogo_sha,
        "objetivos": objetivos(),
    }
    _guardar(original / "objetivos" / (catalogo_sha + ".json"), _bytes(proyeccion))
    rutas = [ruta for ruta in original.rglob("*") if ruta.is_file() and ruta != original / "procedencia.json"]
    if any(ruta.is_symlink() for ruta in rutas):
        raise FormatoInesperado("enlaces_lecturas: evidencia enlazada")
    archivos = [
        {"archivo": str(ruta.relative_to(original)), "sha256": sha256(ruta), "bytes": ruta.stat().st_size}
        for ruta in sorted(rutas)
    ]
    _guardar(
        original / "procedencia.json",
        _bytes(
            {
                "tipo": "inventario_de_evidencias_y_proyecciones_locales",
                "alcance": "Índice para conservar integridad; no acredita consulta remota ni revisión editorial nueva.",
                "archivos": archivos,
            }
        ),
    )


def preparar() -> None:
    """Prepara solo observaciones; ninguna fecha editorial se modifica."""
    datos = _bytes(_crear())
    _registrar_originales()
    _guardar(carpetas(FUENTE).preparado / ARCHIVO, datos)


def validar() -> None:
    """Admite hechos íntegros con desconocidos explícitos; no certifica todos los enlaces.

    Raises:
        ValidacionFallida: Si las entradas o preparado no corresponden a esta comprobación.
    """
    firmas = _firmas()
    datos = _bytes(_crear())
    if (carpetas(FUENTE).preparado / ARCHIVO).read_bytes() != datos or _firmas() != firmas:
        raise ValidacionFallida("enlaces_lecturas: preparado o entradas cambiaron")
    _guardar(carpetas(FUENTE).validado / ARCHIVO, datos)
    informe = {
        "estado": "Admitido",
        "entradas": firmas,
        "conjunto_sha256": hashlib.sha256(datos).hexdigest(),
        "alcance": "admisión estructural; desconocidos no cuentan como enlaces verificados",
        "controles": [{"control": "identidad, integridad y causalidad por objetivo", "resultado": "correcto"}],
    }
    _guardar(carpetas(FUENTE).validacion, _bytes(informe))


def exportar(destino: Path) -> Path:
    """Exporta con reemplazo seguro solo la admisión vigente bajo las entradas y el reloj actuales.

    Returns:
        Destino explícito de observaciones, fuera del catálogo editorial.

    Raises:
        ValidacionFallida: Si cambió contrato, evidencia, catálogo, cuerpo o caducidad.
    """
    informe = exigir_admitido(FUENTE, ruta=carpetas(FUENTE).validacion)
    datos = (carpetas(FUENTE).validado / ARCHIVO).read_bytes()
    if (
        informe.get("entradas") != _firmas()
        or informe.get("conjunto_sha256") != hashlib.sha256(datos).hexdigest()
        or datos != _bytes(_crear())
    ):
        raise ValidacionFallida("enlaces_lecturas: admisión alterada o vencida; preparar y validar otra vez")
    _guardar(Path(destino), datos)
    return destino


def main(argv: list[str] | None = None) -> int:
    """Usa la CLI y recepción comunes, sin disparar red al importar.

    Returns:
        Código de la etapa pedida.
    """
    return principal_fuente_con_descarga(__doc__, descargar, {"preparar": preparar, "validar": validar}, argv)


if __name__ == "__main__":
    sys.exit(main())
