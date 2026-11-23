"""Traslado local de datos y entradas operativas coherentes hacia un directorio nuevo, nunca una instalación activa.

La revisión y la huella esperadas son configuración privada del job. El manifiesto identifica bytes; no sustituye
la autenticación del almacén ni la validación integral del candidato. No descarga, reconstruye ni despliega.
"""

import argparse
import re
import shutil
import sys
import tempfile
import unicodedata
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from plataforma_datos.comun.entrada_salida import comprobar_huella, json_compacto, sha256
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, RAIZ, ErrorFuente, FormatoInesperado
from plataforma_datos.cursos import admision_catalogo, almacen_catalogo
from plataforma_datos.cursos.fuentes.consorci.constantes import VERSIONES_DE_LOS_CURSOS
from plataforma_datos.orquestacion import (
    evidencias_censos,
    evidencias_ediciones,
    indices_de_canales,
    originales_troceados,
)
from plataforma_datos.orquestacion.actualizar import RUTAS_DE_LA_ENTREGA
from plataforma_datos.orquestacion.admision import exigir_admitido
from plataforma_datos.orquestacion.admision_catalogo_restaurado import admision_en_copia, firma_anterior
from plataforma_datos.orquestacion.archivos_de_generacion import ERROR_GENERICO as ERROR_GENERICO
from plataforma_datos.orquestacion.archivos_de_generacion import (
    MAX_ARCHIVO_BYTES,
    MAX_ARCHIVOS,
    GeneracionInvalida,
    _arbol,
    _camino,
    _exigir,
    _hex,
    _json,
    _propio,
    _ruta,
)
from plataforma_datos.orquestacion.archivos_de_generacion import MAX_MANIFIESTO_BYTES as MAX_MANIFIESTO_BYTES
from plataforma_datos.orquestacion.comprobaciones_remotas import ARCHIVO as COMPROBACIONES
from plataforma_datos.orquestacion.comprobaciones_remotas import leer_registro as leer_comprobaciones
from plataforma_datos.orquestacion.cuarentena_del_paquete import ARCHIVO_DE_CUARENTENA, leer_cuarentena
from plataforma_datos.orquestacion.estado_de_la_actualizacion import leer_estado, nombre_respaldo_migracion
from plataforma_datos.orquestacion.estado_panel import estado_panel
from plataforma_datos.orquestacion.indices_operativos import comprobar_indices_operativos
from plataforma_datos.orquestacion.modulos import (
    ENTRADAS_EXTERNAS,
    FUENTES_CATALOGO,
    FUENTES_CON_CATALOGO,
    MODULOS,
    carpetas,
)
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import (
    CARPETA_DE_INFORMES,
    FUENTES,
    NOMBRE_DE_INFORME,
    huellas_de_originales,
    informes_fechados,
)
from plataforma_datos.orquestacion.reconstruir import etapas
from plataforma_datos.orquestacion.sustitucion import ANTERIOR, NUEVO, ActualizacionEnCurso, cerrojo, escribir_atomico

VERSION_EDICIONES = 2
VERSION_INVENTARIO = 3
MAX_TOTAL_BYTES = 16 * 1024**3
SHA256 = re.compile(r"[0-9a-f]{64}")
REVISION = re.compile(r"[0-9a-f]{40}")
NOMBRE_JSON = re.compile(r"[a-z0-9-]+\.json")
ESTADO = f"{CARPETA_DE_INFORMES}/estado.json"
# Los archivos del paquete que conservan su versión anterior y las aceptaciones pendientes viajan con su estado.
CUARENTENA = f"{CARPETA_DE_INFORMES}/{ARCHIVO_DE_CUARENTENA}"
HISTORIAL = VERSIONES_DE_LOS_CURSOS.relative_to(RAIZ).as_posix()
AUXILIARES = ("README.md", "lecturas.json", "globales/datos-globales.json")
# Durante la activación, una entrega anterior conserva la ausencia de observaciones.
# Si existen, se incluyen en la huella de la generación y se verifica su restauración.
AUXILIARES_OPCIONALES = ("observaciones-lecturas.json",)


# Entradas de los empaquetadores y del productor local; ningún nombre viene de una ruta libre.
ORIGENES_OPERATIVOS = {
    "vectores-movil.json": (
        "vectores-movil",
        (
            "vocabulario.json",
            "indices.json",
            "palabras.i8",
            "palabras.escala.f32",
            "palabras.peso.f32",
            "ocup_es.i8",
            "ocup_es.escala.f32",
            "ocup_ca.i8",
            "ocup_ca.escala.f32",
            "alt_es.i8",
            "alt_es.escala.f32",
        ),
    ),
    "clasificador-movil.json": ("fuentes/clasificador", ("control.json", "huellas.json")),
    "comarcas.json": ("fuentes/hoja-de-ruta", ("municipis-idescat-2026-10-21.ssv",)),
    "temarios.json": ("fuentes/hoja-de-ruta", ("extractos.json", "textos.jsonl", "procedencia.json")),
    "vectores-formacion.json": ("fuentes/recursos-fijados", ("captura.zip", "registro.json")),
    "vectores-oit.json": ("fuentes/recursos-fijados", ("captura.zip", "registro.json")),
}
DOCUMENTOS_OPERATIVOS = {
    "vectores-movil": ("huellas.json", "LICENCIA.md"),
    "fuentes/clasificador": ("README.md",),
    "fuentes/hoja-de-ruta": ("README.md",),
    "fuentes/recursos-fijados": ("README.md",),
}
# Entradas fijadas de reconstructores entregados que no son fuentes de consulta periódica.
# Sus procedencias y cuerpos se verifican como los del registro; no se recorre todo originales/.
ORIGINALES_DE_RECONSTRUCCION = {
    "metodos": "plataforma_datos.orquestacion.exportacion.metodos:paquete_metodos",
    "notas-cno11": "plataforma_datos.ocupaciones.fuentes.clasificaciones.notas_cno11:principal",
}


def sin_recuperacion(raiz: Path) -> None:
    """Exige que no quede ninguna sustitución, informe diario ni exportación a medias de una ejecución anterior.

    Raises:
        GeneracionInvalida: Si queda alguno; hay que recuperarlo antes de seguir.
    """
    rutas = {ruta for modulo in MODULOS for ruta in carpetas(modulo)} | set(RUTAS_DE_LA_ENTREGA)
    for ruta in rutas:
        for sufijo in (NUEVO, ANTERIOR):
            pendiente = raiz / f"{ruta}{sufijo}"
            _exigir(not pendiente.exists() and not pendiente.is_symlink())
    ejecuciones = raiz / CARPETA_DE_INFORMES
    if ejecuciones.exists():
        for ruta in ejecuciones.iterdir():
            _exigir(not ruta.name.startswith(("diario", ".diario")) and not ruta.name.endswith((".tmp", ".parcial")))
    _exigir(not any(raiz.glob(".datos-exportando-*")))


def originales_de_la_fuente(raiz: Path, carpeta: str) -> set[str]:
    """Selecciona los originales que una generación traslada de una fuente, vinculados por sus huellas.

    Returns:
        Las rutas relativas de la procedencia y de cada original que esta enumera.
    """
    base = f"{DATOS_RELATIVOS.as_posix()}/originales/{carpeta}"
    procedencia = _camino(raiz, f"{base}/procedencia.json")
    documento = _json(procedencia)
    _exigir(isinstance(documento, dict))
    # ESCO registra las páginas dentro del ZIP: se traslada el contenedor cuya huella las vincula.
    entradas = (
        {documento["archivo"]: documento["sha256"]}
        if {"archivo", "sha256"} <= documento.keys()
        else huellas_de_originales(documento)
    )
    indices_de_canales.completar(raiz, base, documento, entradas)
    archivos = {f"{base}/procedencia.json"}
    for nombre, huella in entradas.items():
        relativa = f"{base}/{_ruta(nombre)}"
        _hex(huella, SHA256)
        archivos |= originales_troceados.seleccionar(raiz, relativa, huella, _camino, _propio)
    return archivos


def _comprobar_originales_del_paquete(raiz: Path, archivos: set[str], casas: set[str]) -> None:
    """El paquete también exige sus entradas: un índice parcial no puede omitirlas ni cambiar sus huellas.

    Vale para los originales de todas las casas que viajan: las de las fuentes del registro y las de los
    reconstructores entregados.
    """
    prefijos = tuple(f"{DATOS_RELATIVOS.as_posix()}/originales/{casa}/" for casa in sorted(casas))
    for entrada in _json(_camino(raiz, "datos/manifiesto.json")).values():
        origenes = entrada.get("origenes", {})
        _exigir(isinstance(origenes, dict))
        for relativa, huella in origenes.items():
            if relativa.startswith(prefijos):
                _exigir(relativa in archivos)
                _hex(huella, SHA256)
                _exigir(originales_troceados.seleccionar(raiz, relativa, huella, _camino, _propio) <= archivos)


def _origenes_operativos(raiz: Path, manifiesto: dict) -> set[str]:
    archivos, carpetas_presentes = set(), set()
    for nombre, (carpeta, declarados) in ORIGENES_OPERATIVOS.items():
        if nombre not in manifiesto and not (raiz / "datos" / carpeta).exists():
            continue
        _exigir(nombre in manifiesto)
        nombres = set(declarados)
        esperadas = {f"datos/{carpeta}/{n}" for n in nombres}
        origenes = manifiesto[nombre].get("origenes")
        _exigir(isinstance(origenes, dict) and set(origenes) == esperadas)
        for relativa, huella in origenes.items():
            ruta = _camino(raiz, relativa)
            _propio(ruta)
            _hex(huella, SHA256)
            comprobar_huella(ruta, huella)
        archivos |= esperadas
        carpetas_presentes.add(carpeta)
    for carpeta in carpetas_presentes:
        for nombre in DOCUMENTOS_OPERATIVOS[carpeta]:
            relativa = f"datos/{carpeta}/{nombre}"
            _propio(_camino(raiz, relativa))
            archivos.add(relativa)
    comprobar_indices_operativos(raiz, manifiesto, carpetas_presentes)
    return archivos


def _datos(raiz: Path) -> set[str]:
    manifiesto = _json(_camino(raiz, "datos/manifiesto.json"))
    _exigir(isinstance(manifiesto, dict) and bool(manifiesto))
    archivos = {"datos/manifiesto.json", *(f"datos/{nombre}" for nombre in AUXILIARES)}
    for nombre in AUXILIARES_OPCIONALES:
        ruta = raiz / "datos" / nombre
        if ruta.exists() or ruta.is_symlink():
            _propio(ruta)
            archivos.add(f"datos/{nombre}")
    for nombre, entrada in manifiesto.items():
        _exigir(NOMBRE_JSON.fullmatch(nombre) is not None and nombre != "manifiesto.json")
        _exigir(isinstance(entrada, dict))
        _hex(entrada.get("sha256"), SHA256)
        ruta = _camino(raiz, f"datos/{nombre}")
        _propio(ruta)
        comprobar_huella(ruta, entrada["sha256"])
        archivos.add(f"datos/{nombre}")
    archivos |= _origenes_operativos(raiz, manifiesto)
    _exigir({r.relative_to(raiz).as_posix() for r in _arbol(raiz / "datos")} == archivos)
    return archivos


def _sin_version_catalogo(raiz: Path, fuente: str) -> bool:
    # Un intento fallido puede tener originales; no obliga a inventar una versión admitida.
    return fuente in FUENTES_CATALOGO and leer_estado(raiz).get(fuente, {}).get("ultima_version_buena") is None


def _catalogo(raiz: Path) -> set[str]:
    area = raiz / almacen_catalogo.RUTA
    if not area.exists() and not area.is_symlink():
        return set()
    solicitud = almacen_catalogo.solicitud(area)
    # Es una instantánea cerrada e inmutable. La admisión rechaza WAL, SHM y journal;
    # el cerrojo común impide publicarla mientras se seleccionan y copian sus bytes.
    admision_catalogo.exigir_snapshot_admitido(solicitud, sha256_validacion=sha256(solicitud.validacion_destino))
    return {p.relative_to(raiz).as_posix() for p in _arbol(area)}


def _carpetas_fuentes(raiz: Path) -> set[str]:
    archivos = set()
    originales_declarados = (
        {f.originales for f in FUENTES.values() if f.originales} | {"sepe"} | set(ORIGINALES_DE_RECONSTRUCCION)
    )
    for carpeta in sorted(originales_declarados):
        base = raiz / DATOS_RELATIVOS / "originales" / carpeta
        if _sin_version_catalogo(raiz, carpeta) and not (base / "procedencia.json").exists():
            _exigir(not base.exists() or not _arbol(base))
            continue
        archivos |= originales_de_la_fuente(raiz, carpeta)
    _comprobar_originales_del_paquete(raiz, archivos, originales_declarados)
    rutas = set()
    for modulo in MODULOS:
        declaradas = carpetas(modulo)
        for indice, fuente in enumerate(modulo.fuentes):
            rutas.add(declaradas[3 * indice + 2])
            preparada = declaradas[3 * indice + 1]
            # Las entradas preparadas fuera del ciclo, como las traducciones,
            # siguen siendo necesarias aunque el productor solo las valide.
            if "preparar" in etapas(False, fuente) or (raiz / preparada).exists() or (raiz / preparada).is_symlink():
                rutas.add(preparada)
    rutas |= {ruta for ruta in ENTRADAS_EXTERNAS if "/validados/" not in ruta}
    for relativa in rutas:
        if "/originales/" in relativa:
            continue
        carpeta = _camino(raiz, relativa)
        if _sin_version_catalogo(raiz, Path(relativa).name) and not carpeta.exists():
            continue
        propios = _arbol(carpeta)
        _exigir(bool(propios) or _sin_version_catalogo(raiz, Path(relativa).name))
        archivos.update(ruta.relative_to(raiz).as_posix() for ruta in propios)
    return archivos


def _informes_operativos(raiz: Path, documento: dict | None) -> set[str]:
    """Conserva la última pareja consumida y la referenciada por el estado; no toda la historia.

    Returns:
        Rutas JSON/Markdown verificadas de las ejecuciones seleccionadas.
    """
    seleccionados = set()
    informes = informes_fechados(raiz)
    if informes:
        seleccionados.add(informes[-1].relative_to(raiz).as_posix())
    if documento is not None:
        _exigir(isinstance(documento, dict) and isinstance(documento.get("actualizacion"), dict))
        referencia = documento["actualizacion"].get("informe")
        _exigir(isinstance(referencia, str))
        ruta = PurePosixPath(_ruta(referencia))
        _exigir(ruta.parent.as_posix() == CARPETA_DE_INFORMES and ruta.suffix == ".md")
        seleccionados.add(ruta.with_suffix(".json").as_posix())
    archivos = set()
    for relativa in seleccionados:
        ruta = PurePosixPath(relativa)
        _exigir(ruta.parent.as_posix() == CARPETA_DE_INFORMES and NOMBRE_DE_INFORME.fullmatch(ruta.name))
        for pareja in (relativa, ruta.with_suffix(".md").as_posix()):
            _propio(_camino(raiz, pareja))
            archivos.add(pareja)
        datos = _json(_camino(raiz, relativa))
        _exigir(
            isinstance(datos, dict) and isinstance(datos.get("utc"), str) and isinstance(datos.get("veredicto"), str)
        )
    return archivos


def _operativos(raiz: Path) -> set[str]:
    archivos = {HISTORIAL} | _catalogo(raiz)
    documento = None
    estado = raiz / ESTADO
    for directorio in reversed(estado.parents):
        if (directorio == raiz or directorio.is_relative_to(raiz)) and (directorio.exists() or directorio.is_symlink()):
            _propio(directorio, directorio=True)
    if estado.exists() or estado.is_symlink():
        _propio(estado)
        archivos.add(ESTADO)
        documento = _json(estado)
        origen = documento.get("origen_migracion") if isinstance(documento, dict) else None
        if origen is not None:
            _exigir(isinstance(origen, dict))
            huella = origen.get("sha256_estado")
            _hex(huella, SHA256)
            relativa = f"{CARPETA_DE_INFORMES}/{nombre_respaldo_migracion(huella)}"
            respaldo = _camino(raiz, relativa)
            _propio(respaldo)
            _exigir(sha256(respaldo) == huella)
            archivos.add(relativa)
    archivos |= _informes_operativos(raiz, documento)
    comprobaciones = raiz / COMPROBACIONES
    if comprobaciones.exists() or comprobaciones.is_symlink():
        _propio(comprobaciones)
        archivos.add(COMPROBACIONES)
    cuarentena = raiz / CUARENTENA
    if cuarentena.exists() or cuarentena.is_symlink():
        _propio(cuarentena)
        archivos.add(CUARENTENA)
    archivos |= _carpetas_fuentes(raiz)
    for fuente in ("ia-nacional", "encuestas-isco4"):
        base = f"{DATOS_RELATIVOS.as_posix()}/validados/{fuente}"
        archivos.update((f"{base}/{fuente}.json", f"{base}/validacion.json"))
    return archivos


def _admitidos(raiz: Path) -> None:
    for modulo in MODULOS:
        validado = carpetas(modulo)[2]
        if _sin_version_catalogo(raiz, modulo.id) and not (raiz / validado / "validacion.json").exists():
            # Sin versión admitida, la carpeta validada solo guarda archivos sueltos en su propia carpeta `lecturas/`.
            _exigir(not (propia := raiz / validado).exists() or set(_arbol(propia)) <= {*propia.glob("lecturas/*")})
            continue
        exigir_admitido(modulo.id, ruta=_camino(raiz, f"{validado}/validacion.json"))
        if modulo.id in FUENTES_CON_CATALOGO:
            from plataforma_datos.cursos.operacion_fuente import leer_validado

            leer_validado(modulo.id, raiz)
    for fuente in ("ia-nacional", "encuestas-isco4"):
        base = f"{DATOS_RELATIVOS.as_posix()}/validados/{fuente}"
        exigir_admitido(fuente, ruta=_camino(raiz, f"{base}/validacion.json"))
        _propio(_camino(raiz, f"{base}/{fuente}.json"))
    _exigir(isinstance(_json(_camino(raiz, HISTORIAL)), list))
    estado_panel(raiz, datetime.now(UTC))
    leer_comprobaciones(raiz)
    try:
        leer_cuarentena(raiz)
    except FormatoInesperado as error:
        # Sin saber qué conserva su versión anterior, la generación no reproduciría lo publicado.
        raise GeneracionInvalida(ERROR_GENERICO) from error


def _seleccion(raiz: Path, version: int = VERSION_INVENTARIO) -> set[str]:
    raiz = raiz.absolute()
    sin_recuperacion(raiz)
    archivos = _datos(raiz) | _operativos(raiz)
    if version >= VERSION_EDICIONES:
        archivos |= evidencias_ediciones.archivos(raiz)
    if version >= VERSION_INVENTARIO:
        archivos |= evidencias_censos.archivos(raiz)
    _exigir(len(archivos) <= MAX_ARCHIVOS)
    _admitidos(raiz)
    return archivos


def _registros(raiz: Path, nombres: set[str]) -> list[dict[str, Any]]:
    registros = []
    total = 0
    for nombre in sorted(nombres):
        ruta = _camino(raiz, nombre)
        _propio(ruta)
        tamano = ruta.stat().st_size
        total += tamano
        _exigir(total <= MAX_TOTAL_BYTES)
        registros.append({"ruta": nombre, "bytes": tamano, "sha256": sha256(ruta)})
    return registros


def _resumen(manifiesto: dict[str, Any], huella: str) -> dict[str, Any]:
    return {
        "version": 1,
        "revisionCodigo": manifiesto["revisionCodigo"],
        "sha256Manifiesto": huella,
        "archivos": len(manifiesto["archivos"]),
        "bytesTotales": manifiesto["bytesTotales"],
    }


def _comprobar_rutas(nombres: list[str]) -> None:
    rutas = set(nombres)
    prefijos = {}
    for nombre in nombres:
        partes = nombre.split("/")
        _exigir(nombre.startswith(("datos/", f"{DATOS_RELATIVOS.as_posix()}/")))
        for indice in range(1, len(partes) + 1):
            prefijo = "/".join(partes[:indice])
            _exigir(indice == len(partes) or prefijo not in rutas)
            clave = unicodedata.normalize("NFC", prefijo).casefold()
            _exigir(clave not in prefijos or prefijos[clave] == prefijo)
            prefijos[clave] = prefijo


def _comprobar_inventario(manifiesto: dict[str, Any]) -> None:
    nombres = []
    total = 0
    huellas = {}
    for registro in manifiesto["archivos"]:
        _exigir(isinstance(registro, dict) and set(registro) == {"ruta", "bytes", "sha256"})
        nombre = _ruta(registro["ruta"])
        _exigir(type(registro["bytes"]) is int and 0 <= registro["bytes"] <= MAX_ARCHIVO_BYTES)
        _hex(registro["sha256"], SHA256)
        total += registro["bytes"]
        _exigir(total <= MAX_TOTAL_BYTES)
        nombres.append(nombre)
        huellas[nombre] = registro["sha256"]
    _exigir(nombres == sorted(set(nombres)) and total == manifiesto["bytesTotales"])
    _exigir(huellas.get("datos/manifiesto.json") == manifiesto["manifiestoPaqueteSha256"])
    _exigir(huellas.get(ESTADO) == manifiesto["estadoSha256"])
    _comprobar_rutas(nombres)


def leer_manifiesto_generacion(origen: Path, revision: str, huella: str) -> dict[str, Any]:
    """Lee el manifiesto acotado y valida expectativas e inventario sin abrir archivos de contenido.

    Returns:
        Manifiesto validado para preparar las rutas; todavía no acredita sus blobs ni su admisión.
    """
    _hex(revision, REVISION)
    _hex(huella, SHA256)
    _propio(origen, directorio=True)
    ruta = origen / "manifiesto.json"
    _propio(ruta)
    comprobar_huella(ruta, huella)
    manifiesto = _json(ruta)
    claves = {"version", "revisionCodigo", "manifiestoPaqueteSha256", "estadoSha256", "archivos", "bytesTotales"}
    _exigir(isinstance(manifiesto, dict) and set(manifiesto) == claves)
    _exigir(type(manifiesto["version"]) is int and manifiesto["version"] in (1, VERSION_EDICIONES, VERSION_INVENTARIO))
    _exigir(manifiesto["revisionCodigo"] == revision)
    _hex(manifiesto["manifiestoPaqueteSha256"], SHA256)
    if manifiesto["estadoSha256"] is not None:
        _hex(manifiesto["estadoSha256"], SHA256)
    _exigir(isinstance(manifiesto["archivos"], list) and 0 < len(manifiesto["archivos"]) <= MAX_ARCHIVOS)
    _exigir(type(manifiesto["bytesTotales"]) is int and 0 <= manifiesto["bytesTotales"] <= MAX_TOTAL_BYTES)
    _comprobar_inventario(manifiesto)
    return manifiesto


def _comprobar_archivos(base: Path, manifiesto: dict[str, Any]) -> set[str]:
    for registro in manifiesto["archivos"]:
        ruta = _camino(base, registro["ruta"])
        _propio(ruta)
        _exigir(ruta.stat().st_size == registro["bytes"])
        comprobar_huella(ruta, registro["sha256"])
    reales = {ruta.relative_to(base).as_posix() for ruta in _arbol(base)}
    _exigir(reales == {r["ruta"] for r in manifiesto["archivos"]})
    return reales


def _manifiesto_con_contenido(origen: Path, revision: str, huella: str) -> dict[str, Any]:
    manifiesto = leer_manifiesto_generacion(origen, revision, huella)
    _exigir({ruta.name for ruta in origen.iterdir()} == {"manifiesto.json", "contenido"})
    return manifiesto


def _comprobar_copia_recuperada(copia: Path, manifiesto: dict[str, Any], codigo_candidato: Path | None = None) -> None:
    nombres = _comprobar_archivos(copia, manifiesto)
    recibo = (almacen_catalogo.RUTA / "validacion.json").as_posix()
    huella = next((r["sha256"] for r in manifiesto["archivos"] if r["ruta"] == recibo), None)
    with admision_en_copia(copia, huella, codigo_candidato):
        _exigir(nombres == _seleccion(copia, manifiesto["version"]))


def verificar_descarga_temporal(temporal: Path, revision: str, huella: str) -> None:
    """Verifica la recepción exclusiva del transporte y deja los bytes sellados antes de su promoción."""
    manifiesto = _manifiesto_con_contenido(temporal, revision, huella)
    _comprobar_copia_recuperada(temporal / "contenido", manifiesto)


def verificar_generacion(origen: Path, revision_esperada: str, sha256_esperada: str) -> dict[str, Any]:
    """Verifica inventario, admisión y expectativas privadas antes de usar una generación.

    Returns:
        Manifiesto completo validado; no deriva confianza de su propia etiqueta.
    """
    manifiesto = _manifiesto_con_contenido(origen, revision_esperada, sha256_esperada)
    contenido = origen / "contenido"
    _exigir(_comprobar_archivos(contenido, manifiesto) == _seleccion(contenido, manifiesto["version"]))
    return manifiesto


def _destino_nuevo(origen: Path, destino: Path) -> None:
    _propio(origen, directorio=True)
    _propio(destino.parent, directorio=True)
    _exigir(not destino.exists() and not destino.is_symlink())
    _exigir(not destino.resolve().is_relative_to(origen.resolve()))
    _exigir(not origen.resolve().is_relative_to(destino.resolve()))


def _copiar(origen: Path, destino: Path, nombres: set[str]) -> None:
    for nombre in sorted(nombres):
        ruta = _camino(origen, nombre)
        _propio(ruta)
        salida = destino / nombre
        salida.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ruta, salida, follow_symlinks=False)


def exportar_generacion(raiz: Path, destino: Path, revision_codigo: str) -> dict[str, Any]:
    """Exporta bajo el cerrojo existente, sin cambiar datos o estado del origen.

    Returns:
        Recibo saneado de la generación promovida; destino debe ser nuevo.
    """
    _hex(revision_codigo, REVISION)
    _destino_nuevo(raiz, destino)
    temporal = Path(tempfile.mkdtemp(prefix=".generacion-", dir=destino.parent))
    try:
        with cerrojo(raiz):
            nombres = _seleccion(raiz)
            registros = _registros(raiz, nombres)
            contenido = temporal / "contenido"
            contenido.mkdir()
            _copiar(raiz, contenido, nombres)
            manifiesto = {
                "version": VERSION_INVENTARIO,
                "revisionCodigo": revision_codigo,
                "manifiestoPaqueteSha256": sha256(raiz / "datos/manifiesto.json"),
                "estadoSha256": sha256(raiz / ESTADO) if ESTADO in nombres else None,
                "archivos": registros,
                "bytesTotales": sum(r["bytes"] for r in registros),
            }
            escribir_atomico(temporal / "manifiesto.json", json_compacto(manifiesto) + "\n")
            huella = sha256(temporal / "manifiesto.json")
            verificar_generacion(temporal, revision_codigo, huella)
            _exigir(not destino.exists() and not destino.is_symlink())
            temporal.rename(destino)
        return _resumen(manifiesto, huella)
    finally:
        if temporal.exists():
            shutil.rmtree(temporal)


def restaurar_generacion(
    origen: Path, destino_nuevo: Path, revision_esperada: str, sha256_esperada: str
) -> dict[str, Any]:
    """Restaura solo a un directorio nuevo y exclusivo; no mezcla un checkout ni instalación existente.

    Returns:
        Recibo saneado tras verificar y promover los dos árboles.
    """
    return _restaurar(origen, destino_nuevo, revision_esperada, sha256_esperada, None)


def restaurar_base_candidata(
    origen: Path, destino: Path, revision: str, sha256_esperada: str, codigo_candidato: Path
) -> dict[str, Any]:
    """Retiene la admisión vigente en los operativos privados antes del primer lector del motor.

    Returns:
        Recibo de la base sellada que se usó para preparar la copia de trabajo.
    """
    return _restaurar(origen, destino, revision, sha256_esperada, codigo_candidato)


def _restaurar(
    origen: Path, destino_nuevo: Path, revision_esperada: str, sha256_esperada: str, codigo_candidato: Path | None
) -> dict[str, Any]:
    _destino_nuevo(origen, destino_nuevo)
    manifiesto = _manifiesto_con_contenido(origen, revision_esperada, sha256_esperada)
    contenido = origen / "contenido"
    nombres = _comprobar_archivos(contenido, manifiesto)
    if firma_anterior(contenido) is None:
        _exigir(nombres == _seleccion(contenido, manifiesto["version"]))
    temporal = Path(tempfile.mkdtemp(prefix=".restaurando-", dir=destino_nuevo.parent))
    try:
        _copiar(contenido, temporal, nombres)
        _comprobar_copia_recuperada(temporal, manifiesto, codigo_candidato)
        _exigir(not destino_nuevo.exists() and not destino_nuevo.is_symlink())
        temporal.rename(destino_nuevo)
        return _resumen(manifiesto, sha256_esperada)
    finally:
        if temporal.exists():
            shutil.rmtree(temporal)


def main(argv: list[str] | None = None) -> int:
    """Interfaz local cerrada, con JSON saneado o un error genérico.

    Returns:
        Cero tras verificar/exportar/restaurar; uno si falla una entrada u operación.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("accion", choices=("exportar", "verificar", "restaurar"))
    parser.add_argument("origen", type=Path)
    parser.add_argument("--destino", type=Path)
    parser.add_argument("--revision-codigo", required=True)
    parser.add_argument("--sha256-manifiesto")
    args = parser.parse_args(argv)
    try:
        if args.accion == "exportar":
            _exigir(args.destino is not None)
            resultado = exportar_generacion(args.origen, args.destino, args.revision_codigo)
        elif args.accion == "restaurar":
            _exigir(args.destino is not None and args.sha256_manifiesto is not None)
            resultado = restaurar_generacion(args.origen, args.destino, args.revision_codigo, args.sha256_manifiesto)
        else:
            _exigir(args.sha256_manifiesto is not None and args.destino is None)
            manifiesto = verificar_generacion(args.origen, args.revision_codigo, args.sha256_manifiesto)
            resultado = _resumen(manifiesto, args.sha256_manifiesto)
    except (ActualizacionEnCurso, ErrorFuente, OSError, ValueError, TypeError, KeyError, RecursionError):
        print(ERROR_GENERICO, file=sys.stderr)
        return 1
    print(json_compacto(resultado))
    return 0


if __name__ == "__main__":
    sys.exit(main())
