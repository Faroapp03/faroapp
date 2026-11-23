"""Formación: une la ocupación de la persona con especialidades formativas y cursos reales, y prepara DigComp 3.0.

Cadena oficial: ocupación ESCO → CO-SISPE (tabla EURES) → especialidades del SEPE (ocupaciones relacionadas) →
especialidades del SOC (código y nombre en catalán) → cursos abiertos del SOC. Python estándar.
Depende de la validación de ESCO. Una pareja de fechas invertidas en una ficha queda por confirmar. La validación
conserva su identidad y comprueba el resto del censo. Avisa si la copia supera MAX_DIAS_COPIA_CURSOS días.
La descarga renueva solo la oferta SOC; los catálogos conservados se comprueban sin descargarlos ni sustituirlos.
El SOC no declara cuántos cursos publica: una oferta que pierde más de PERDIDA_MAXIMA de los cursos de la copia
anterior no se admite como censo completo (`censo_soc.py`). Queda pendiente de confirmación, con sus cifras, y la copia
anterior sigue siendo la vigente; una persona la confirma con `confirmar_censo.py`.

Uso: python3 -m plataforma_datos.cursos.fuentes.formacion.lector {descargar,preparar,validar,todo}
"""

import csv
import io
import json
import re
import sys
import tempfile
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    entradas_procedencia,
    guardar_json,
    guardar_jsonl,
    guardar_validacion,
    hoy_utc,
    leer_json,
    leer_jsonl,
    original,
    procedencia,
    ultimo_original,
)
from plataforma_datos.comun.hojas import leer_xlsx
from plataforma_datos.comun.lugares import municipio_legible
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    ARCHIVO_DE_VALIDACION,
    Controles,
    Descarga,
    FormatoInesperado,
    ReglaDeCambio,
    exigir,
)
from plataforma_datos.comun.red import conservar_o_sustituir, descargar_url, registro_descarga
from plataforma_datos.comun.textos_y_cifras import texto
from plataforma_datos.cursos.contrato_aprendizaje import cargar_registro
from plataforma_datos.cursos.fuentes.formacion import lectura
from plataforma_datos.cursos.fuentes.formacion.calendario_soc import calendario_curso
from plataforma_datos.cursos.fuentes.formacion.censo_soc import exigir_censo_completo, retirar_pendiente
from plataforma_datos.cursos.fuentes.formacion.constantes import (
    COLUMNAS_EURES,
    COLUMNAS_SEPE,
    DESTINATARIOS_POR_TIPO,
    FICHA_CURSO,
    FICHA_SEPE,
    FUENTE,
    HOJA_SEPE,
    INICIO_TABLA_EURES,
    MAX_DIAS_COPIA_CURSOS,
    PATRON_CURSOS,
    PREPARADOS,
    RELACIONES,
    SEPE,
    VALIDADO,
)
from plataforma_datos.cursos.fuentes.formacion.controles import Preparados, _controles_cursos
from plataforma_datos.cursos.fuentes.formacion.controles import cobertura as cobertura_de_la_cadena
from plataforma_datos.cursos.fuentes.formacion.controles import controles as controles_de_la_cadena

# es_fecha_real vive en `cursos/fuentes/formacion/controles.py`; se reexporta para las fuentes que la leen de aquí.
from plataforma_datos.cursos.fuentes.formacion.controles import es_fecha_real as es_fecha_real
from plataforma_datos.cursos.fuentes.formacion.json_soc import (
    constante_no_admitida,
    leer_json_latin1,
    objeto_sin_repetidos,
)
from plataforma_datos.cursos.fuentes.formacion.marco_digcomp import digcomp
from plataforma_datos.cursos.fuentes.formacion.registro_aprendizaje import registro_desde_marco
from plataforma_datos.ocupaciones.fuentes.esco.piezas.consultas import base_validada
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

# Canal público de oferta viva; la procedencia de los catálogos no proporciona destinos de descarga.
URL_OFERTA_SOC = "https://oficinadetreball.gencat.cat/opendata/recursos/ofertaCursos.json"
# Límite de admisión de la oferta, no de lectura HTTP: el transporte común acota ésta a MAX_DESCARGA_BYTES.
MAX_OFERTA_SOC_BYTES = 16 * 1024 * 1024
CAMPOS_OFERTA_SOC = (
    "curs",
    "tipus",
    "identificador_curs",
    "especialitat_formativa",
    "municipi_especialitat",
    "modalitat",
    "data_inici",
    "data_fi",
    "hores",
    "estat_curs",
    "nom_centre",
    "garantia_juvenil",
)

# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de preparar
# ---------------------------------------------------------------------------------------------------------------------


def _eures(por_uri: dict[str, str]) -> list[dict[str, str]]:
    """Lee la tabla EURES que relaciona cada ocupación ESCO con sus códigos CO-SISPE.

    Args:
        por_uri: Código ESCO de cada ocupación validada, por su URI.

    Returns:
        Una relación por fila de una ocupación conocida: código ESCO, código CO-SISPE, tipo de relación y etiqueta.

    Raises:
        FormatoInesperado: Si el CSV no tiene la cabecera de la tabla, le falta una columna o trae un tipo de relación
            que `RELACIONES` no conoce.
    """
    crudo = original(FUENTE, "eures-esco-cosispe-es.csv").read_text(encoding="utf-8-sig")
    # El CSV empieza con unas líneas de presentación; la tabla empieza en su cabecera.
    inicio = crudo.find(INICIO_TABLA_EURES)
    exigir(inicio >= 0, f"{FUENTE}: el CSV de EURES no tiene la cabecera «{INICIO_TABLA_EURES}»")
    filas = list(csv.reader(io.StringIO(crudo[inicio:])))
    cabecera = filas[0]
    faltan = sorted(set(COLUMNAS_EURES) - set(cabecera))
    exigir(not faltan, f"{FUENTE}: al CSV de EURES le faltan las columnas {faltan}")
    relaciones: list[dict[str, str]] = []
    for numero, fila in enumerate(filas[1:], start=2):
        if not fila:
            continue
        exigir(len(fila) >= len(cabecera), f"{FUENTE}: fila {numero} de EURES con menos columnas que la cabecera")
        registro = dict(zip(cabecera, fila, strict=False))
        codigo = por_uri.get(registro["Classification 1 URI"])
        if not codigo:
            continue
        relacion = registro["Mapping relation"].split(":")[-1]
        exigir(relacion in RELACIONES, f"{FUENTE}: relación de EURES desconocida «{relacion}»")
        relaciones.append(
            {
                "esco": codigo,
                "cosispe": registro["Classification 2 ID"].strip(),
                "relacion": RELACIONES[relacion],
                "etiqueta": texto(registro["Classification 2 PrefLabel"]),
            }
        )
    return relaciones


def _exigir_identificador_de_enlace(valor: str, campo: str, permite_barra: bool) -> None:
    """Rechaza caracteres que cambian la interpretación del enlace, sin normalizar el identificador.

    Los enlaces conservan los bytes de la fuente, incluidos espacios y paréntesis. Una barra del SOC se escapa con
    la construcción habitual; en el código SEPE sería otro segmento. Los controles Unicode (C0, DEL y C1) tampoco
    pueden ocultarse con la normalización de texto de la hoja.

    Raises:
        FormatoInesperado: Si el identificador contiene un delimitador o un carácter de control.
    """
    reservados = "&?#%+\\" + ("" if permite_barra else "/")
    valido = all(caracter not in reservados and unicodedata.category(caracter) != "Cc" for caracter in valor)
    exigir(valido, f"{FUENTE}: {campo} contiene caracteres que alteran su enlace")


def _sepe() -> list[dict[str, Any]]:
    """Lee las especialidades formativas del SEPE con sus ocupaciones relacionadas (códigos CO-SISPE de 8 cifras).

    Returns:
        Una especialidad por fila de la hoja exportada del buscador del SEPE.

    Raises:
        FormatoInesperado: Si a una fila le falta una de las columnas de `COLUMNAS_SEPE`.
    """
    xlsx = original(SEPE, procedencia(SEPE)["archivo"])
    especialidades: list[dict[str, Any]] = []
    for fila in leer_xlsx(xlsx, hoja=HOJA_SEPE):
        crudas = {texto(columna): valor for columna, valor in fila.items()}
        faltan = sorted(set(COLUMNAS_SEPE) - crudas.keys())
        exigir(not faltan, f"{SEPE}: a la hoja de especialidades le faltan las columnas {faltan}")
        _exigir_identificador_de_enlace(str(crudas["CÓDIGO"]), "código SEPE", permite_barra=False)
        celdas = {columna: texto(valor) for columna, valor in crudas.items()}
        relacionadas = celdas.get("OCUPACIONES RELACIONADAS", "")
        especialidades.append(
            {
                "codigo": celdas["CÓDIGO"],
                "denominacion": celdas["DENOMINACIÓN"],
                "version": celdas["VERSIÓN"],
                "familia": celdas["FAMILIA PROFESIONAL"],
                "area": celdas["ÁREA PROFESIONAL"],
                "nivel": celdas["NIVEL DE CUALIFICACIÓN"],
                "modalidad": celdas["MODALIDAD DE IMPARTICIÓN"],
                "horas": celdas["DURACIÓN TOTAL"],
                # Códigos de ocupación de la CNO-11: de 8 cifras (CO-SISPE), de 6 o de 4 (grupo), seguidos de su nombre.
                "ocupaciones": sorted(set(re.findall(r"(?:^|, ?)([0-9]{4}|[0-9]{6}|[0-9]{8}) - ", relacionadas))),
                # Algunas especialidades describen sus ocupaciones solo con texto, sin código: se guarda, pero no sirve
                # para una relación oficial.
                "ocupaciones_texto": relacionadas if relacionadas not in ("", "-") else "",
                "ficha": FICHA_SEPE + celdas["CÓDIGO"] + ".pdf",
            }
        )
    return especialidades


def _soc_especialidades() -> dict[str, dict[str, Any]]:
    """Lee las especialidades del SOC con su código y su nombre en catalán y en castellano.

    Returns:
        Una especialidad por código, con la primera fila que el archivo publica de cada una.
    """
    soc: dict[str, dict[str, Any]] = {}
    for registro in leer_json(original(FUENTE, "soc-especialidades.json")):
        # La copia repite especialidades en varias filas; se conserva la primera. Recuento en constantes_formacion.
        soc.setdefault(
            registro["codiespecialitat"],
            {
                "codigo": registro["codiespecialitat"],
                "nombre_ca": texto(registro.get("desccat")),
                "nombre_es": texto(registro.get("desccas")),
                "horas": registro.get("hores"),
                "certificado": registro.get("certprof"),
                "familia": registro.get("famprofcodi"),
            },
        )
    return soc


def _curso(registro: dict[str, Any], por_nombre: dict[str, set[str]]) -> dict[str, Any]:
    """Compone un curso del SOC, sin datos de contacto, con las especialidades cuyo nombre coincide con el suyo.

    Conserva su tipo oficial y, si DESTINATARIOS_POR_TIPO lo conoce, a quién se dirige. El municipio se escribe con
    la forma de su nombre oficial (partículas en minúscula y elisiones), como en el resto de fuentes.

    Args:
        registro: Fila de ofertaCursos.json tal como la publica el SOC.
        por_nombre: Códigos de especialidad por la clave de su nombre en catalán (`clave_nombre`).

    Returns:
        El curso con los campos que lee el motor.
    """
    _exigir_identificador_de_enlace(registro["identificador_curs"], "identificador SOC", permite_barra=True)
    tipo = texto(registro["tipus"])
    return {
        "id": registro["identificador_curs"],
        "curso": registro["curs"],
        "nombre": texto(registro["especialitat_formativa"]),
        "especialidades": sorted(por_nombre.get(clave_nombre(registro["especialitat_formativa"]), ())),
        "modalidad": texto(registro["modalitat"]).capitalize(),
        "municipio": municipio_legible(registro["municipi_especialitat"]),
        **calendario_curso(registro),
        "horas": registro["hores"],
        "estado": texto(registro["estat_curs"]),
        "centro": texto(registro["nom_centre"]),
        "garantia_juvenil": registro["garantia_juvenil"] == "SI",
        "enlace": FICHA_CURSO + registro["identificador_curs"].replace("/", "%2F"),
        "tipo": tipo,
        "destinatarios": DESTINATARIOS_POR_TIPO.get(tipo),
    }


def _soc_cursos(soc: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Lee los cursos abiertos del SOC, sin datos de contacto; el nombre del curso es el de su especialidad en catalán.

    Args:
        soc: Especialidades del SOC por código, para reconocer la de cada curso por su nombre.

    Returns:
        Un curso por número de curso, con la primera fila que publica la copia más reciente.
    """
    por_nombre: defaultdict[str, set[str]] = defaultdict(set)
    for especialidad in soc.values():
        por_nombre[clave_nombre(especialidad["nombre_ca"])].add(especialidad["codigo"])
    cursos: dict[str, dict[str, Any]] = {}
    for registro in leer_json_latin1(ultimo_original(FUENTE, PATRON_CURSOS).read_bytes()):
        if registro["curs"] not in cursos:
            cursos[registro["curs"]] = _curso(registro, por_nombre)
    return cursos


def _fecha_de_la_copia() -> date:
    """Lee la fecha de la copia más reciente de los cursos del SOC, la del nombre del archivo en su procedencia.

    Returns:
        La fecha más reciente entre los archivos de cursos registrados.

    Raises:
        FormatoInesperado: Si la procedencia no registra ninguna copia de los cursos.
    """
    nombres = [entrada["archivo"] for entrada in entradas_procedencia(procedencia(FUENTE))]
    coincidencias = (re.fullmatch(PATRON_CURSOS, nombre) for nombre in nombres)
    fechas = [coincidencia.group(1) for coincidencia in coincidencias if coincidencia]
    exigir(bool(fechas), f"{FUENTE}: ninguna copia de los cursos del SOC en su procedencia")
    return date.fromisoformat(max(fechas))


def _aviso_copia_antigua(copia: date, hoy: date) -> str | None:
    """Compone el aviso de una copia de los cursos que ha quedado atrás.

    Args:
        copia: Día de la copia de los cursos.
        hoy: Día en que se valida.

    Returns:
        El aviso si la copia tiene más de MAX_DIAS_COPIA_CURSOS días; si no, `None`.
    """
    dias = (hoy - copia).days
    if dias <= MAX_DIAS_COPIA_CURSOS:
        return None
    return (
        f"Aviso: la copia de los cursos del SOC es del {copia.strftime('%d/%m/%Y')}, de hace {dias} días (más de "
        f"{MAX_DIAS_COPIA_CURSOS}): conviene guardar una copia nueva de ofertaCursos.json y volver a preparar."
    )


def _avisar_de_copia_antigua(hoy: date) -> None:
    """Avisa por la salida de errores si la copia de los cursos ha quedado atrás; no hace fallar la validación."""
    aviso = _aviso_copia_antigua(_fecha_de_la_copia(), hoy)
    if aviso:
        print(aviso, file=sys.stderr)


# ---------------------------------------------------------------------------------------------------------------------
# Piezas públicas
# ---------------------------------------------------------------------------------------------------------------------


def clave_nombre(nombre: str | None) -> str:
    """Compone la clave con que se comparan los nombres de especialidad.

    Args:
        nombre: Nombre de la especialidad o del curso, o `None`.

    Returns:
        El nombre sin tildes, en minúsculas, solo con letras, cifras y espacios simples; vacío si no hay nombre.
    """
    sin_tildes = unicodedata.normalize("NFD", (nombre or "").lower()).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", sin_tildes)).strip()


def ocupaciones_esco() -> dict[str, str]:
    """Lee las ocupaciones ESCO validadas.

    Returns:
        La URI de cada ocupación, por su código ESCO.
    """
    with base_validada() as base:
        return dict(base.execute("SELECT codigo_esco, uri FROM ocupaciones").fetchall())


# ---------------------------------------------------------------------------------------------------------------------
# Etapas
# ---------------------------------------------------------------------------------------------------------------------


def comprobar_descarga_soc(descarga: Descarga) -> int:
    """Valida el cuerpo completo antes de conservarlo; no comprueba plazas ni inscripción.

    Returns:
        El número de cursos distintos («curs») de la oferta.

    Raises:
        FormatoInesperado: Si el JSON, sus campos o fechas no se pueden interpretar íntegramente.
    """
    exigir(descarga.url_final == URL_OFERTA_SOC, "SOC: destino final distinto del canal de oferta")
    exigir(descarga.content_type.split(";", 1)[0].strip().lower() == "application/json", "SOC: respuesta no JSON")
    exigir(0 < len(descarga.datos) <= MAX_OFERTA_SOC_BYTES, "SOC: tamaño de oferta fuera del límite")
    try:
        filas = json.loads(
            descarga.datos.decode("latin-1"),
            object_pairs_hook=objeto_sin_repetidos,
            parse_constant=constante_no_admitida,
        )
        exigir(isinstance(filas, list) and bool(filas), "SOC: oferta sin lista de cursos")
        cursos: dict[str, dict[str, Any]] = {}
        for fila in filas:
            exigir(
                isinstance(fila, dict) and all(isinstance(fila.get(campo), str) for campo in CAMPOS_OFERTA_SOC),
                "SOC: curso sin sus campos de texto",
            )
            exigir(
                bool(fila["curs"] and fila["identificador_curs"] and fila["especialitat_formativa"]), "SOC: curso vacío"
            )
            cursos.setdefault(fila["curs"], _curso(fila, {}))
    except (ValueError, RecursionError) as error:
        raise FormatoInesperado("SOC: oferta JSON incompleta o fechas no interpretables") from error
    controles = Controles()
    # Reutiliza las reglas de fechas, horas e identidad de la validación, tras la misma deduplicación por «curs».
    exigir(
        any("incidencia_calendario" not in curso for curso in cursos.values()),
        "SOC: todos los cursos tienen un calendario contradictorio",
    )
    _controles_cursos(controles, list(cursos.values()))
    exigir(controles.admitido, "SOC: campos de cursos no admitidos: " + "; ".join(controles.fallidos))
    return len(cursos)


def conservar_oferta_soc(descarga: Descarga, registrada: dict[str, Any], instante: str, aceptar_cambio: bool) -> None:
    """Prepara procedencia antes de cambiar la copia; restaura ésta si falla promover la procedencia.

    No constituye una transacción de los dos archivos ante apagón o terminación del proceso.

    Raises:
        OSError: Si falla una escritura o promoción; conserva el error después de restaurar la copia previa.
    """
    carpeta = carpetas(FUENTE).original
    nombre = f"soc-cursos-{instante[:10]}.json"
    entradas = entradas_procedencia(registrada)
    copias = [e for e in entradas if re.fullmatch(PATRON_CURSOS, e["archivo"])]
    exigir(bool(copias) and all(e["archivo"] <= nombre for e in copias), "SOC: copia previa ausente o futura")
    anterior = next((e for e in copias if e["archivo"] == nombre), None)
    ultima = max(copias, key=lambda e: e["archivo"])
    archivo = {
        "archivo": nombre,
        "nivel": "oficial",
        "titulo": "Cursos formativos del Servei Públic d'Ocupació de Catalunya (SOC)",
        "url": URL_OFERTA_SOC,
        "licencia": ultima.get("licencia") or ultima["condiciones"],
    }
    fechada = anterior if anterior and "descargado_utc" in anterior else None
    nueva = {**registro_descarga(archivo, descarga, descarga.datos, fechada), "comprobado_remoto_utc": instante}
    documentos = [nueva if e["archivo"] == nombre else e for e in entradas]
    if anterior is None:
        documentos.append(nueva)
    destino = carpeta / nombre
    previo = destino.read_bytes() if destino.exists() else None
    regla = ReglaDeCambio(huella_registrada=ultima["sha256"], aceptar_cambio=aceptar_cambio)
    with tempfile.TemporaryDirectory(prefix=".oferta-soc-", dir=carpeta) as temporal:
        salida = Path(temporal) / ARCHIVO_DE_PROCEDENCIA
        guardar_json(salida, {**registrada, "archivos": documentos})
        conservar_o_sustituir(destino, descarga, regla)
        try:
            salida.replace(carpeta / ARCHIVO_DE_PROCEDENCIA)
        except OSError:
            if previo is None:
                destino.unlink()
            else:
                conservar_o_sustituir(
                    destino,
                    Descarga(previo, URL_OFERTA_SOC, "application/json"),
                    ReglaDeCambio(aceptar_cambio=True),
                )
            raise


def descargar(aceptar_cambio: bool = False) -> lectura.Resultado:
    """Comprueba catálogos conservados y renueva solo la oferta SOC con fecha real de consulta remota.

    La oferta recibida y válida deja su lectura antes de decidir si se admite: también la que queda pendiente de
    confirmación, que es la que pierde más cursos. Si la lectura no se puede emitir, el resultado lo dice y nada más
    cambia.

    Returns:
        La lectura emitida y los problemas que impidieron emitirla, si los hubo.
    """
    comprobar_originales(FUENTE)
    comprobar_originales(SEPE)
    registrada = procedencia(FUENTE)
    descarga = descargar_url(URL_OFERTA_SOC)
    cursos = comprobar_descarga_soc(descarga)
    instante = ahora_utc()
    leida = lectura.emitir(carpetas(FUENTE).original, descarga.datos, instante)
    exigir_censo_completo(descarga, cursos, registrada, instante)
    conservar_oferta_soc(descarga, registrada, instante, aceptar_cambio)
    retirar_pendiente()
    return leida


def preparar() -> None:
    """Prepara EURES, el catálogo del SEPE, las especialidades y cursos del SOC y DigComp 3.0."""
    por_uri = {uri: codigo for codigo, uri in ocupaciones_esco().items()}
    eures = _eures(por_uri)
    especialidades = _sepe()
    soc = _soc_especialidades()
    cursos = _soc_cursos(soc)
    guardar_jsonl(PREPARADOS["eures"], eures)
    guardar_jsonl(PREPARADOS["especialidades"], especialidades)
    guardar_jsonl(PREPARADOS["soc"], list(soc.values()))
    guardar_jsonl(PREPARADOS["cursos"], list(cursos.values()))
    # El marco conserva su idioma y escalas; no atribuye competencias a los cursos.
    marco = digcomp(leer_json(original(FUENTE, "digcomp-3.0.jsonld")))
    guardar_json(PREPARADOS["digcomp"], marco)
    referencia = next(e for e in entradas_procedencia(procedencia(FUENTE)) if e["archivo"] == "digcomp-3.0.jsonld")
    guardar_json(PREPARADOS["registro_aprendizaje"], registro_desde_marco(marco, referencia))
    print(
        f"EURES {len(eures)} relaciones · SEPE {len(especialidades)} especialidades · "
        f"SOC {len(soc)} especialidades y {len(cursos)} cursos"
    )


def validar() -> None:
    """Comprueba la cadena de formación y guarda su validación con la cobertura de la cadena oficial."""
    comprobar_originales(FUENTE)
    comprobar_originales(SEPE)
    esco = ocupaciones_esco()
    preparados = Preparados(
        eures=leer_jsonl(PREPARADOS["eures"]),
        especialidades=leer_jsonl(PREPARADOS["especialidades"]),
        soc=leer_jsonl(PREPARADOS["soc"]),
        cursos=leer_jsonl(PREPARADOS["cursos"]),
        digcomp=leer_json(PREPARADOS["digcomp"]),
    )
    controles = controles_de_la_cadena(esco, preparados)
    referencia = next(e for e in entradas_procedencia(procedencia(FUENTE)) if e["archivo"] == "digcomp-3.0.jsonld")
    marco_original = digcomp(leer_json(original(FUENTE, "digcomp-3.0.jsonld")))
    registro = registro_desde_marco(marco_original, referencia)
    controles.comprobar(
        preparados.digcomp == marco_original, "DigComp: preparado idéntico a sus originales comprobados"
    )
    controles.comprobar(
        leer_json(PREPARADOS["registro_aprendizaje"]) == registro == cargar_registro()[0],
        "DigComp: registro preparado, original y vocabulario admitido coinciden; un cambio requiere revisión",
    )
    cobertura = cobertura_de_la_cadena(esco, preparados.eures, preparados.especialidades, preparados.cursos)
    fechas_pendientes = sorted(c["curso"] for c in preparados.cursos if c.get("incidencia_calendario"))
    guardar_validacion(
        VALIDADO / ARCHIVO_DE_VALIDACION,
        {
            "estado": controles.estado,
            "comprobado_utc": ahora_utc(),
            "cobertura": cobertura,
            **({"calendarios_soc_por_confirmar": fechas_pendientes} if fechas_pendientes else {}),
            "limites": (
                "El catálogo del SEPE no incluye los certificados de profesionalidad antiguos (2008–2011) que "
                "el SOC sigue impartiendo: esos cursos no tienen relación oficial con ocupaciones. Faro puede "
                "sugerirla por significado, marcada como sugerencia."
            ),
            "controles": controles.lista,
        },
    )
    controles.imprimir()
    print("Cobertura:", cobertura)
    _avisar_de_copia_antigua(hoy_utc())
    controles.exigir(FUENTE)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la etapa pedida en la línea de órdenes con el ejecutor común de las fuentes.

    Args:
        argv: Argumentos de la línea de órdenes; `None` lee los del proceso.

    Returns:
        El código de salida del proceso.
    """
    etapas = {"preparar": preparar, "validar": validar}
    return principal_fuente_con_descarga(__doc__, descargar, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
