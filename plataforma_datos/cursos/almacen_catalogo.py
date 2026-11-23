"""Conservación portable de la única instantánea de Cursos y sus pruebas ya admitidas.

No evalúa, interpreta fuentes ni inventa fechas. El control indexa bytes
verificados; la autoridad de admisión sigue siendo admision_catalogo.
"""

import hashlib
import json
import re
import shutil
import sqlite3
import stat
import tempfile
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import indices_evidencias, recibos_compartidos, trozos_catalogo
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo, exigir

RUTA = DATOS_RELATIVOS / "validados" / "catalogo-cursos"
CONTROL = "control-catalogo.json"


@dataclass(frozen=True, kw_only=True)
class EntradaCatalogo:
    """Admisión fijada externamente; no busca la última carpeta por fecha."""

    admision: admision.SolicitudAdmision
    sha256_admision: str


def _sha(ruta: Path) -> str:
    with ruta.open("rb") as archivo:
        return hashlib.file_digest(archivo, "sha256").hexdigest()


def ruta_relativa(raiz: Path, relativa: str) -> Path:
    """Resuelve la ruta de una evidencia dentro de `raiz`, que debe ser canónica, interior y sin enlaces.

    Returns:
        La ruta dentro de `raiz`.

    Raises:
        ErrorEntregaCatalogo: Si la ruta no es canónica, sale de `raiz` o atraviesa un enlace.
    """
    ruta = Path(relativa)
    exigir(
        bool(ruta.parts) and not ruta.is_absolute() and ".." not in ruta.parts and ruta.as_posix() == relativa,
        "Ruta de catálogo no canónica",
    )
    destino = raiz / ruta
    exigir(all(not p.is_symlink() for p in (destino.absolute(), *destino.absolute().parents)), "Ruta enlazada")
    return destino


def copiar_evidencia(referencia: admision.ReferenciaArchivo, destino: Path) -> None:
    """Conserva una evidencia verificada; un cuerpo grande queda como manifiesto y trozos compartidos.

    Raises:
        ErrorEntregaCatalogo: Si la entrada no coincide con su huella o el destino choca.
    """
    try:
        cuerpo = trozos_catalogo.leer(referencia.ruta, referencia.sha256, limite=admision.MAX_ENTRADA)
    except trozos_catalogo.ErrorTrozos as error:
        raise ErrorEntregaCatalogo("Entrada alterada antes de conservar") from error
    try:
        trozos_catalogo.conservar(destino, cuerpo, referencia.sha256)
    except trozos_catalogo.ErrorTrozos as error:
        raise ErrorEntregaCatalogo(str(error)) from error


def leer_evidencia(ruta: Path, sha256: str, motivo: str) -> bytes:
    """Lee un cuerpo conservado, entero o por trozos, solo tras verificar huella y tamaño.

    Returns:
        Bytes originales del cuerpo.

    Raises:
        ErrorEntregaCatalogo: Con el motivo del llamador si falta o no coincide.
    """
    try:
        return trozos_catalogo.leer(ruta, sha256, limite=admision.MAX_ENTRADA)
    except trozos_catalogo.ErrorTrozos as error:
        raise ErrorEntregaCatalogo(motivo) from error


def _copiar_snapshot(referencia: admision.ReferenciaArchivo, destino: Path) -> None:
    # La SQLite se abre directamente: se copia entera y nunca se trocea.
    exigir(_sha(referencia.ruta) == referencia.sha256, "Entrada alterada antes de conservar")
    if destino.exists():
        exigir(
            destino.is_file() and destino.stat().st_nlink == 1 and _sha(destino) == referencia.sha256,
            "Colisión de evidencia conservada",
        )
        return
    destino.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(referencia.ruta, destino)
    exigir(_sha(destino) == referencia.sha256, "Copia de evidencia distinta")


def solicitud(area: Path) -> admision.SolicitudAdmision:
    """Reconstruye referencias del control conservado, sin admitirlas por su mera presencia.

    Returns:
        Solicitud que aún exige su informe/SHA de admisión externo.
    """
    ruta = area / CONTROL
    admision.exigir_ruta_sin_enlaces(ruta)
    dato = ruta.lstat()
    exigir(
        stat.S_ISREG(dato.st_mode) and dato.st_nlink == 1 and dato.st_size <= indices_evidencias.MAX_INDICE,
        "Control no regular, enlazado o excesivo",
    )
    with ruta.open("rb") as archivo:
        contenido = archivo.read(indices_evidencias.MAX_INDICE + 1)
    # Entrada no confiable: la misma lectura acotada valida rutas, SHA, duplicados y números JSON.
    indices_evidencias.leer_indice(contenido)
    control = json.loads(contenido)
    exigir(
        set(control)
        in (
            {"schema_version", "snapshot_sha256", "procedencia", "archivos_conservados", "aplicados_por_fuente"},
            {
                "schema_version",
                "snapshot_sha256",
                "procedencia",
                "archivos_conservados",
                "aplicados_por_fuente",
                "conservacion",
            },
        ),
        "Campos de control incompatibles",
    )
    exigir(type(control["schema_version"]) is int and control["schema_version"] == 1, "Versión de control desconocida")
    exigir(
        isinstance(control["snapshot_sha256"], str) and re.fullmatch("[0-9a-f]{64}", control["snapshot_sha256"]),
        "SHA de instantánea incompatible",
    )
    procedencia = control["procedencia"]
    exigir(
        isinstance(procedencia, dict) and 0 < len(procedencia) <= admision.MAX_REFERENCIAS - 2,
        "Procedencia vacía o excesiva",
    )
    referencias = {}
    for id, ref in procedencia.items():
        exigir(
            isinstance(id, str)
            and re.fullmatch("[a-z0-9][a-z0-9_-]{0,79}", id)
            and id not in {"control-catalogo", "catalogo-evidencias"},
            "ID de procedencia incompatible",
        )
        # Reutiliza el contrato de rutas/SHA, sin confiar en los metadatos locales.
        prueba = indices_evidencias.validar_prueba_indexada(ref)
        referencias[id] = admision.ReferenciaArchivo(ruta=ruta_relativa(area, prueba.archivo), sha256=prueba.sha256)
    aplicados = control["aplicados_por_fuente"]
    exigir(
        isinstance(aplicados, dict)
        and set(aplicados) <= {"hp_life", "cibervoluntarios", "claude_academy", "fundae", "barcelonactiva"},
        "Fuentes aplicadas desconocidas",
    )
    exigir(
        all(isinstance(sha, str) and re.fullmatch("[0-9a-f]{64}", sha) for sha in aplicados.values()),
        "SHA de fuente aplicada incompatible",
    )
    indices_regenerables(control)
    inventario = {p["archivo"]: p["sha256"] for p in control["archivos_conservados"]}
    for archivo, sha in inventario.items():
        if archivo.startswith("evidencias/eventos/"):
            exigir(archivo == "evidencias/eventos/" + sha + ".json", "Ruta de evento no canónica")
            ruta_evento = ruta_relativa(area, archivo)
            admision.comprobar_archivo_referenciado(
                admision.ReferenciaArchivo(ruta=ruta_evento, sha256=sha), admision.MAX_INFORME
            )
            evento = recibos_compartidos.leer_json(ruta_evento.read_bytes())
            exigir(
                isinstance(evento, dict)
                and isinstance(evento.get("metadatos_sha256"), str)
                and re.fullmatch("[0-9a-f]{64}", evento["metadatos_sha256"]),
                "Evento con referencia de metadatos incompatible",
            )
            metadatos = "evidencias/metadatos/" + evento["metadatos_sha256"] + ".json"
            exigir(inventario.get(metadatos) == evento["metadatos_sha256"], "Evento sin metadatos inventariados")
            leer_documento(area, {"archivo": archivo, "sha256": sha})
    referencias["control-catalogo"] = admision.ReferenciaArchivo(
        ruta=ruta, sha256=hashlib.sha256(contenido).hexdigest()
    )
    return admision.SolicitudAdmision(
        snapshot=admision.ReferenciaArchivo(ruta=area / "catalogo.sqlite3", sha256=control["snapshot_sha256"]),
        procedencia=referencias,
        indices_evidencias={
            "catalogo-evidencias": admision.IndiceEvidencias(archivo=referencias["control-catalogo"], raiz=area)
        },
        validacion_destino=area / "validacion.json",
    )


def indices_regenerables(control: dict) -> set[str]:
    """Identifica únicamente el índice HP actual, nunca cuerpos, recibos o históricos previos.

    La ausencia de contrato compacto conserva todos los archivos como prefijo histórico.

    Returns:
        Rutas declaradas y ligadas al mismo inventario/procedencia admitidos.
    """
    if "conservacion" not in control:
        return set()
    contrato = control["conservacion"]
    exigir(
        isinstance(contrato, dict) and set(contrato) == {"version", "indices_regenerables"},
        "Contrato de conservación incompatible",
    )
    exigir(type(contrato["version"]) is int and contrato["version"] == 1, "Versión de conservación desconocida")
    declarados = contrato["indices_regenerables"]
    exigir(isinstance(declarados, dict) and set(declarados) <= {"control-hp"}, "Índices regenerables desconocidos")
    rutas = set()
    for id, ref in declarados.items():
        prueba = indices_evidencias.validar_prueba_indexada(ref)
        exigir(
            prueba.archivo == f"indices/{id}.json"
            and control["procedencia"].get(id) == ref
            and ref in control["archivos_conservados"],
            "Índice regenerable fuera de su referencia exacta",
        )
        rutas.add(prueba.archivo)
    return rutas


def _conservar_procedencia(origen: admision.SolicitudAdmision, destino: Path) -> tuple[dict, dict, dict]:
    procedencia, pruebas, regenerables = {}, {}, {}
    compartido = origen.procedencia.get("control-catalogo")
    anterior = json.loads(compartido.ruta.read_bytes()) if compartido is not None else None
    previos_regenerables = indices_regenerables(anterior) if anterior is not None else set()
    for id, ref in origen.procedencia.items():
        if id == "control-catalogo":
            if anterior is not None and "conservacion" not in anterior:
                relativa = "evidencias/conservadas/" + ref.sha256 + ".control-catalogo.json"
                copiar_evidencia(ref, ruta_relativa(destino, relativa))
                pruebas[relativa] = ref.sha256
            continue
        regenerable = id == "control-hp" and (
            anterior is None or anterior["procedencia"][id]["archivo"] in previos_regenerables
        )
        relativa = f"indices/{id}.json" if regenerable else "procedencia/" + ref.sha256 + ".ref"
        copiar_evidencia(ref, ruta_relativa(destino, relativa))
        procedencia[id] = {"archivo": relativa, "sha256": ref.sha256}
        pruebas[relativa] = ref.sha256
        if regenerable:
            regenerables[id] = procedencia[id]
    return procedencia, pruebas, regenerables


def _recibo_admision(entrada: EntradaCatalogo, destino: Path, pruebas: dict) -> dict | None:
    origen = entrada.admision
    if "control-hp" not in origen.procedencia or "control-catalogo" in origen.procedencia:
        return None
    ref = origen.procedencia["control-hp"]
    contenido = admision.comprobar_archivo_referenciado(ref, indices_evidencias.MAX_INDICE)
    exigir(contenido["sha256"] == ref.sha256, "Control HP alterado")
    control = json.loads(ref.ruta.read_bytes())
    exigir(control.get("fuente_id") == "hp_life", "Control de otro productor")
    entradas = control["entradas"]
    huellas = set(pruebas.values())
    exigir(
        all(r[clave] in huellas for r in entradas["recepciones"] for clave in ("cuerpo_sha256", "recibo_sha256")),
        "Recibo de admisión sin sus pruebas físicas",
    )
    evaluaciones = []
    with closing(sqlite3.connect(origen.snapshot.ruta.as_uri() + "?mode=ro&immutable=1", uri=True)) as conexion:
        for fila in control["evaluaciones"]:
            registro = conexion.execute(
                "SELECT id,corte_us,huella_evaluador,huella_registro FROM evaluaciones_vigencia WHERE id=?",
                (fila["evaluacion_id"],),
            ).fetchone()
            exigir(registro is not None, "Evaluación del recibo ausente de la instantánea")
            evaluaciones.append(
                dict(zip(("id", "corte_us", "evaluador_sha256", "registro_sha256"), registro, strict=True))
            )
    dato = {
        "schema_version": 1,
        "tipo": "admision_snapshot_no_comprobacion_remota",
        "fuente_id": "hp_life",
        "snapshot_entrada_sha256": entradas["snapshot_sha256"],
        "snapshot_salida_sha256": origen.snapshot.sha256,
        "admision_entrada_sha256": entradas["admision_sha256"],
        "admision_salida_sha256": entrada.sha256_admision,
        "codigo_productor_sha256": entradas["codigo_sha256"],
        "codigo_admision_sha256": hashlib.sha256(admision.bytes_json_admision(admision.firma_codigo())).hexdigest(),
        "corte_utc": entradas["corte_utc"],
        "recepciones": entradas["recepciones"],
        "evaluaciones": evaluaciones,
    }
    cuerpo = admision.bytes_json_admision(dato)
    sha = hashlib.sha256(cuerpo).hexdigest()
    relativa = "admisiones/" + sha + ".json"
    salida = ruta_relativa(destino, relativa)
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_bytes(cuerpo)  # Candidata nueva: la promoción existente ocurre después de la admisión completa.
    pruebas[relativa] = sha
    return {"archivo": relativa, "sha256": sha}


def archivar_documento(contenido: bytes, destino: Path, pruebas: dict, *, campos_evento: frozenset[str]) -> dict:
    """Conserva un evento y una sola copia de sus metadatos en candidata privada.

    Returns:
        Referencia física del evento; ambos archivos quedan en el inventario admitido.
    """
    metadatos, evento = recibos_compartidos.separar(contenido, campos_evento=campos_evento)
    salida = None
    for cuerpo, prefijo in ((metadatos, "evidencias/metadatos/"), (evento, "evidencias/eventos/")):
        sha = hashlib.sha256(cuerpo).hexdigest()
        relativa = prefijo + sha + ".json"
        ruta = ruta_relativa(destino, relativa)
        if ruta.exists():
            exigir(
                ruta.is_file() and ruta.stat().st_nlink == 1 and ruta.read_bytes() == cuerpo, "Colisión de documento"
            )
        else:
            ruta.parent.mkdir(parents=True, exist_ok=True)
            # Solo candidata nueva; cualquier interrupción descarta toda esta candidata.
            with ruta.open("xb") as archivo:
                archivo.write(cuerpo)
        pruebas[relativa] = sha
        salida = {"archivo": relativa, "sha256": sha}
    return salida


def leer_documento_indexado(referencia: admision.ReferenciaArchivo, referencias: dict) -> dict:
    """Reconstruye un documento por referencias SHA, aun tras la conservación portable.

    Returns:
        Documento íntegro. Los metadatos deben estar en el índice admitido; no se
        deducen rutas históricas ni se buscan alternativas por contenido parecido.
    """
    admision.comprobar_archivo_referenciado(referencia, admision.MAX_INFORME)
    contenido = referencia.ruta.read_bytes()
    dato = recibos_compartidos.leer_json(contenido)
    if "formato_recibo" in dato:
        meta = referencias.get(dato.get("metadatos_sha256"))
        exigir(meta is not None, "Metadatos actuales fuera del índice admitido")
        admision.comprobar_archivo_referenciado(meta, admision.MAX_INFORME)
        contenido = recibos_compartidos.reconstruir(contenido, meta.ruta.read_bytes())
    return recibos_compartidos.leer_json(contenido)


def leer_documento(area: Path, referencia: dict) -> dict:
    """Verifica el documento archivado íntegro o reconstruye el compartido exacto.

    Returns:
        Datos originales completos, sin interpretar una admisión como consulta remota.
    """
    ruta = ruta_relativa(area, referencia["archivo"])
    ref = admision.ReferenciaArchivo(ruta=ruta, sha256=referencia["sha256"])
    admision.comprobar_archivo_referenciado(ref, admision.MAX_INFORME)
    contenido = ruta.read_bytes()
    dato = recibos_compartidos.leer_json(contenido)
    if "formato_recibo" in dato:
        exigir(
            isinstance(dato.get("metadatos_sha256"), str) and re.fullmatch("[0-9a-f]{64}", dato["metadatos_sha256"]),
            "Referencia de metadatos incompatible",
        )
        meta = ruta_relativa(area, "evidencias/metadatos/" + dato["metadatos_sha256"] + ".json")
        admision.comprobar_archivo_referenciado(
            admision.ReferenciaArchivo(ruta=meta, sha256=dato["metadatos_sha256"]), admision.MAX_INFORME
        )
        contenido = recibos_compartidos.reconstruir(contenido, meta.read_bytes())
        dato = recibos_compartidos.leer_json(contenido)
    return dato


def _conservar_candidata(entrada: EntradaCatalogo, *, destino: Path) -> dict:
    """Trabaja únicamente en candidata nueva y privada, que el llamador aún no promueve.

    Returns:
        Control admitido; cualquier fallo deja esta candidata fuera de la ruta final.
    """
    origen = entrada.admision
    admision.exigir_snapshot_admitido(origen, sha256_validacion=entrada.sha256_admision)
    exigir(not destino.exists(), "El destino del catálogo debe ser nuevo")
    entradas = [
        origen.snapshot.ruta,
        origen.validacion_destino,
        *(r.ruta for r in origen.procedencia.values()),
        *admision.rutas_evidencias_indexadas(origen),
    ]
    exigir(
        all(
            not p.resolve().is_relative_to(destino.resolve()) and not destino.resolve().is_relative_to(p.resolve())
            for p in entradas
        ),
        "Destino sobre una entrada protegida",
    )
    admision.exigir_ruta_sin_enlaces(destino)
    destino.mkdir(parents=True)
    _copiar_snapshot(origen.snapshot, destino / "catalogo.sqlite3")
    procedencia, pruebas, regenerables = _conservar_procedencia(origen, destino)
    informe = admision.ReferenciaArchivo(ruta=origen.validacion_destino, sha256=entrada.sha256_admision)
    exigir(_sha(informe.ruta) == informe.sha256, "Informe de admisión alterado")
    procedencia["admision-entrada"] = archivar_documento(
        informe.ruta.read_bytes(),
        destino,
        pruebas,
        campos_evento=frozenset({"snapshot", "procedencia", "indices_evidencias", "cobertura"}),
    )
    prueba_por_sha = {}
    for indice in origen.indices_evidencias.values():
        for prueba in admision.leer_pruebas_indice_referenciado(indice.archivo):
            ref = admision.ReferenciaArchivo(ruta=indice.raiz / prueba.archivo, sha256=prueba.sha256)
            prueba_por_sha[ref.sha256] = ref
    conservadas = set(pruebas.values())
    # Mantiene las rutas que el catálogo nativo utiliza, sin deducir fechas desde su carpeta.
    with closing(sqlite3.connect(origen.snapshot.ruta.as_uri() + "?mode=ro&immutable=1", uri=True)) as conexion:
        for archivo, sha in conexion.execute("SELECT archivo,sha256 FROM evidencias WHERE archivo IS NOT NULL"):
            if sha in prueba_por_sha:
                relativa = "evidencias/" + archivo
                copiar_evidencia(prueba_por_sha[sha], ruta_relativa(destino, relativa))
                pruebas[relativa] = sha
                conservadas.add(sha)
    for sha, ref in prueba_por_sha.items():
        if sha not in conservadas:
            relativa = "evidencias/conservadas/" + sha + ".ref"
            copiar_evidencia(ref, ruta_relativa(destino, relativa))
            pruebas[relativa] = sha
    recibo = _recibo_admision(entrada, destino, pruebas)
    if recibo is not None:
        procedencia["recibo-admision"] = recibo
    control = {
        "schema_version": 1,
        "snapshot_sha256": origen.snapshot.sha256,
        "procedencia": procedencia,
        "archivos_conservados": [{"archivo": p, "sha256": sha} for p, sha in sorted(pruebas.items())],
        "aplicados_por_fuente": (
            json.loads(origen.procedencia["control-catalogo"].ruta.read_bytes())["aplicados_por_fuente"]
            if "control-catalogo" in origen.procedencia
            else {}
        ),
        "conservacion": {"version": 1, "indices_regenerables": regenerables},
    }
    (destino / CONTROL).write_text(json.dumps(control, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
    admision.exigir_snapshot_admitido(origen, sha256_validacion=entrada.sha256_admision)
    admision.admitir_snapshot(solicitud(destino))
    return control


def conservar(entrada: EntradaCatalogo, *, destino: Path) -> dict:
    """Materializa una entrada admitida y promueve solo su candidata completa.

    Las copias interiores pueden quedar parciales ante un corte, pero nunca se
    confunden con el destino operativo. Un intento nuevo usa otra candidata;
    no repara ni sobrescribe archivos de una candidata interrumpida. Un corte
    no capturable puede dejar su temporal privado para revisión, sin admisión final.

    Returns:
        Control de archivos y fuentes aplicadas. No publica ni sustituye el origen.
    """
    exigir(not destino.exists(), "El destino del catálogo debe ser nuevo")
    admision.exigir_ruta_sin_enlaces(destino)
    destino.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destino.parent, prefix=".catalogo-") as temporal:
        candidata = Path(temporal) / "candidata"
        control = _conservar_candidata(entrada, destino=candidata)
        exigir(not destino.exists(), "El destino apareció durante la conservación")
        candidata.rename(destino)
    return control
