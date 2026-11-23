"""Textos en castellano de las tareas oficiales de la OIT: procedencia, validación y combinación para el motor.

No es una fuente oficial: son textos de Faro sobre las tareas oficiales ISCO-08 (con el aviso de traducción de la OIT),
que se aportan a mano como capturas de autoría en var/actualizacion/preparados/textos/ (véase README):

  tareas-piloto.json       redacción manual del caso piloto
  tareas-generadas.jsonl   redactado con IA
  tareas-traducidas.jsonl  traducido con IA

Las herramientas de IA que redactaron y tradujeron los textos no forman parte de este producto: `descargar` muestra
de cuáles proceden y la procedencia registra su nombre de origen. Los campos `herramienta` e `instrucciones`
conservan identificadores históricos, no rutas ni órdenes disponibles. El modelo, la fecha y la huella de instrucciones
proceden de cada captura aportada; no se recalculan con el código actual. Los identificadores no resuelven archivos
ni ejecutan herramientas.

Las etapas siguen la interfaz común: `descargar` explica de dónde salen, `preparar` registra su procedencia (huella de
cada archivo y, de lo generado con IA, modelo, fecha y huella de las instrucciones) y `validar` los contrasta con las
tareas oficiales validadas de la OIT. Depende de la validación de la OIT. Python estándar.

Uso: python3 -m plataforma_datos.ocupaciones.fuentes.textos.lector {descargar,preparar,validar,todo}
"""

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    entradas_procedencia,
    guardar_json,
    leer_json,
    relativa,
    requerir,
    sha256_bytes,
)
from plataforma_datos.comun.nucleo import (
    ADMITIDO,
    ARCHIVO_DE_PROCEDENCIA,
    CON_ERRORES,
    Controles,
    FormatoInesperado,
    ValidacionFallida,
    exigir,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion, exigir_admitido, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente

FUENTE = "textos"
PREPARADO = carpetas(FUENTE).preparado
PROCEDENCIA = PREPARADO / ARCHIVO_DE_PROCEDENCIA
PILOTO = "tareas-piloto.json"
GENERADAS = "tareas-generadas.jsonl"
TRADUCIDAS = "tareas-traducidas.jsonl"
# Orden de preferencia al combinar: la redacción manual manda sobre la generada, y esta sobre la traducción.
ARCHIVOS = (PILOTO, GENERADAS, TRADUCIDAS)
ORIGENES = {
    PILOTO: {
        "origen": "Redacción manual del caso piloto (recepcionista 4226 y contable 4311).",
        "herramienta": None,
        "instrucciones": None,
    },
    GENERADAS: {
        "origen": "Redacción completa con IA a partir de las justificaciones publicadas con la nota de la OIT.",
        "herramienta": "redactar-tareas",
        "instrucciones": "instruccionesRedactar",
    },
    TRADUCIDAS: {
        "origen": "Traducción con IA del título y el texto de las tareas oficiales en inglés.",
        "herramienta": "traducir-tareas-oficiales",
        "instrucciones": "instruccionesTraducirOficiales",
    },
}
CAMPOS_TEXTO = ("corto", "texto_es", "estado")
CAMPOS_REDACCION = ("ia_podria", "lo_tuyo")
CAMPOS_DE_LO_GENERADO = ("corto", "texto_es", *CAMPOS_REDACCION, "estado")
ARCHIVOS_CON_IA = (GENERADAS, TRADUCIDAS)
# Lo que cada línea generada con IA registra de sí misma: sin ello no se sabe qué versión la produjo.
CAMPOS_GENERACION = ("modelo", "fecha", "huella_instrucciones")
# Recuentos de la procedencia: cuántas líneas tienen cada modelo, fecha, huella de instrucciones y estado.
RECUENTOS = {
    "modelo": "modelos",
    "fecha": "fechas",
    "huella_instrucciones": "huellas_instrucciones",
    "estado": "estados",
}
# Lo que la validación repite de la procedencia de cada archivo: el paquete del motor no lo copia.
CAMPOS_DE_LA_GENERACION = ("herramienta", "instrucciones", "modelos", "fechas", "huellas_instrucciones")
ESTADO_ADMITIDO = f"{ADMITIDO}: textos de Faro sobre tareas oficiales; el estado de cada uno dice si se hizo con IA"
# El estado de cada texto, que es el de su archivo. El motor solo conoce estos tres (EstadoTexto, en
# src/dominio/tipos-paquete.ts) y avisa de la IA según el estado: cualquier otro valor ocultaría el aviso.
ESTADO_DE_CADA_ARCHIVO = {PILOTO: "redacción manual", GENERADAS: "redactado con IA", TRADUCIDAS: "traducido con IA"}
ESTADOS = tuple(ESTADO_DE_CADA_ARCHIVO.values())
ESTADO_PILOTO = ESTADO_DE_CADA_ARCHIVO[PILOTO]
MAX_IDS_EN_UN_AVISO = 5


# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas
# ---------------------------------------------------------------------------------------------------------------------


def _ruta(nombre: str) -> Path:
    """Ruta de un archivo de textos, que tiene que existir.

    Returns:
        La ruta.
    """
    return requerir(PREPARADO / nombre)


def _capturar() -> dict[str, bytes]:
    """Lee una vez cada archivo, en el orden de preferencia.

    Returns:
        Nombre y bytes que comparten los controles, la combinación y sus huellas.
    """
    return {nombre: _ruta(nombre).read_bytes() for nombre in ARCHIVOS}


def _contenido(nombre: str, datos: bytes) -> dict[str, Any] | list[dict[str, Any]]:
    """Decodifica una captura JSON o JSONL, señalando el archivo y la línea defectuosa.

    Returns:
        El objeto del piloto o los registros del archivo JSONL.

    Raises:
        FormatoInesperado: Si no es JSON válido o el piloto no contiene tareas por identificador.
    """
    try:
        contenido = datos.decode("utf-8")
        if nombre != PILOTO:
            registros = []
            for numero, linea in enumerate(contenido.split("\n"), start=1):
                if linea.strip():
                    try:
                        registros.append(json.loads(linea))
                    except ValueError as error:
                        raise FormatoInesperado(f"{nombre}, línea {numero}: {error}") from error
            return registros
        piloto = json.loads(contenido)
    except ValueError as error:
        raise FormatoInesperado(f"{nombre} no es JSON válido en UTF-8: {error}") from error
    exigir(isinstance(piloto, dict) and isinstance(piloto.get("tareas"), dict), f"{nombre}: faltan tareas por id")
    exigir(all(isinstance(tarea, dict) for tarea in piloto["tareas"].values()), f"{nombre}: tarea sin campos")
    return piloto


def _lineas(nombre: str, archivos: dict[str, bytes] | None = None) -> list[dict[str, Any]]:
    """Textos como registros con id válido; el piloto guarda un diccionario por tarea.

    Returns:
        Los registros, cada uno con su id.
    """
    datos = archivos[nombre] if archivos is not None else _ruta(nombre).read_bytes()
    contenido = _contenido(nombre, datos)
    lineas = (
        [{"id": identificador, **tarea} for identificador, tarea in contenido["tareas"].items()]
        if nombre == PILOTO
        else contenido
    )
    for numero, linea in enumerate(lineas, start=1):
        exigir(
            isinstance(linea, dict) and isinstance(linea.get("id"), str) and bool(linea["id"].strip()),
            f"{nombre}, registro {numero}: falta un id de texto no vacío",
        )
    return lineas


def _recuento(lineas: list[dict[str, Any]], campo: str) -> dict[str, int]:
    """Cuántas líneas tienen cada valor de un campo, de más a menos frecuente.

    Returns:
        {valor: líneas}, de más a menos frecuente.
    """
    return dict(Counter(str(linea[campo]) for linea in lineas if campo in linea).most_common())


def _registro_procedencia(nombre: str) -> dict[str, Any]:
    """Entrada de la procedencia de un archivo: su origen, su huella y, de lo generado con IA, con qué se generó.

    Returns:
        La entrada de procedencia del archivo.
    """
    datos = _ruta(nombre).read_bytes()
    lineas = _lineas(nombre, {nombre: datos})
    registro = {"archivo": nombre, **ORIGENES[nombre], "registros": len(lineas), "sha256": sha256_bytes(datos)}
    for campo, clave in RECUENTOS.items():
        registro[clave] = _recuento(lineas, campo)
    return registro


def _campos_completos(tarea: dict[str, Any]) -> bool:
    """Si una tarea tiene todos los campos de texto obligatorios, y ninguno vacío.

    Returns:
        True si están todos y ninguno está vacío.
    """
    return all(isinstance(tarea.get(campo), str) and tarea[campo].strip() for campo in CAMPOS_TEXTO)


def _redaccion_emparejada(tarea: dict[str, Any]) -> bool:
    """Si una tarea tiene ambos campos de redacción como texto no vacío, o ninguno.

    Returns:
        True si tiene ambos como texto no vacío o ninguno.
    """
    return not any(campo in tarea for campo in CAMPOS_REDACCION) or all(
        isinstance(tarea.get(campo), str) and tarea[campo].strip() for campo in CAMPOS_REDACCION
    )


def _con_estado(nombre: str, lineas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Las líneas con su estado: el piloto no lo escribe, porque toda su redacción es manual.

    Returns:
        Las líneas, cada una con su estado.
    """
    if nombre != PILOTO:
        return lineas
    return [{"estado": ESTADO_PILOTO, **linea} for linea in lineas]


def _textos_que_faltan(
    lineas: list[dict[str, Any]], campos: tuple[str, ...], tareas: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    """Los textos de las tareas que aún no tienen uno en `tareas`, con solo los campos indicados (manda el primero).

    Returns:
        {tarea: sus campos presentes}, solo de las tareas que aún no tienen texto.
        Los ausentes quedan para el control del archivo; así su informe no se pierde por KeyError.
    """
    nuevos: dict[str, dict[str, Any]] = {}
    for registro in lineas:
        if registro["id"] not in tareas and registro["id"] not in nuevos:
            nuevos[registro["id"]] = {campo: registro[campo] for campo in campos if campo in registro}
    return nuevos


def _huellas_correctas(procedencia: dict[str, Any], archivos: dict[str, bytes]) -> bool:
    """Si cada archivo de textos coincide con la huella registrada en su procedencia.

    Returns:
        True si todos coinciden.
    """
    registrados = {entrada["archivo"]: entrada["sha256"] for entrada in entradas_procedencia(procedencia)}
    return all(registrados.get(nombre) == sha256_bytes(archivos[nombre]) for nombre in ARCHIVOS)


def _comprobar_archivo(
    controles: Controles, nombre: str, oficiales: dict[str, Any], archivos: dict[str, bytes] | None = None
) -> None:
    """Controles de un archivo: tareas únicas y oficiales, campos completos, su estado y, si es IA, su versión."""
    lineas = _con_estado(nombre, _lineas(nombre, archivos))
    identificadores = [linea["id"] for linea in lineas]
    controles.comprobar(len(set(identificadores)) == len(identificadores), f"{nombre}: ninguna tarea repetida")
    # El archivo de GENERADAS es la redacción completa con IA: combinar() copia de él los dos campos de redacción.
    correctos = not problemas_de_textos(
        lineas, oficiales, (ESTADO_DE_CADA_ARCHIVO[nombre],), con_redaccion=nombre == GENERADAS
    )
    controles.comprobar(correctos, f"{nombre}: {len(lineas)} textos correctos")
    if nombre != PILOTO:
        registran = all(
            all(isinstance(linea.get(campo), str) and linea[campo].strip() for campo in CAMPOS_GENERACION)
            for linea in lineas
        )
        controles.comprobar(registran, f"{nombre}: cada texto registra modelo, fecha y huella de las instrucciones")


def _controles(
    procedencia: dict[str, Any],
    oficiales: dict[str, Any],
    archivos: dict[str, bytes] | None = None,
    combinados: dict[str, Any] | None = None,
) -> Controles:
    """Huellas frente a la procedencia y controles de cada archivo y de la combinación que se exporta.

    Returns:
        Los controles registrados.
    """
    archivos = _capturar() if archivos is None else archivos
    controles = Controles()
    controles.comprobar(_huellas_correctas(procedencia, archivos), f"huella de los {len(ARCHIVOS)} archivos de textos")
    for nombre in ARCHIVOS:
        _comprobar_archivo(controles, nombre, oficiales, archivos)
    combinados = combinar(archivos) if combinados is None else combinados
    combinadas = [{"id": identificador, **tarea} for identificador, tarea in combinados["tareas"].items()]
    controles.comprobar(not problemas_de_textos(combinadas, oficiales), "la combinación que se exporta es correcta")
    return controles


def _generacion(entrada: dict[str, Any]) -> dict[str, Any]:
    """Con qué se generó un archivo, tal como consta en su procedencia.

    Returns:
        La generación que consta en la procedencia.
    """
    return {campo: entrada[campo] for campo in CAMPOS_DE_LA_GENERACION}


def _cobertura(oficiales: dict[str, Any], tareas: dict[str, Any]) -> dict[str, Any]:
    """Cuántas tareas oficiales tienen texto y en qué estado.

    Returns:
        Las tareas con texto, en total y por estado.
    """
    return {
        "tareas_oficiales": len(oficiales),
        "tareas_con_texto": len(tareas),
        "tareas_oficiales_sin_texto": sorted(set(oficiales) - set(tareas)),
        "estados": dict(Counter(str(tarea.get("estado", "sin estado")) for tarea in tareas.values()).most_common()),
    }


# ---------------------------------------------------------------------------------------------------------------------
# Lo que usan el exportador y las pruebas
# ---------------------------------------------------------------------------------------------------------------------


def problemas_de_textos(
    lineas: list[dict[str, Any]],
    oficiales: dict[str, Any],
    estados: tuple[str, ...] = ESTADOS,
    con_redaccion: bool = False,
) -> list[str]:
    """Da los motivos por los que unos textos no se pueden exportar.

    Tarea ajena, campo vacío, redacción a medias o un estado que no es uno de `estados`: por defecto, cualquiera de
    los tres; en cada archivo, solo el suyo.

    Args:
        lineas: Los textos, cada uno con su `id`.
        oficiales: Las tareas oficiales de la OIT, por id.
        estados: Los estados admitidos.
        con_redaccion: Si cada texto tiene que traer «La IA podría» y «Lo tuyo» (el archivo de redacción con IA).

    Returns:
        Los motivos; vacía si se pueden exportar.
    """
    ajenas = sorted(linea["id"] for linea in lineas if linea["id"] not in oficiales)
    incompletas = sorted(linea["id"] for linea in lineas if not _campos_completos(linea))
    desparejadas = sorted(linea["id"] for linea in lineas if not _redaccion_emparejada(linea))
    con_otro_estado = sorted(linea["id"] for linea in lineas if linea.get("estado") not in estados)
    sin_redaccion = sorted(
        linea["id"] for linea in lineas if con_redaccion and not all(linea.get(campo) for campo in CAMPOS_REDACCION)
    )
    casos = [
        (ajenas, "no son tareas oficiales de la OIT"),
        (incompletas, f"les falta alguno de {', '.join(CAMPOS_TEXTO)}"),
        (desparejadas, "no tienen ambos campos «La IA podría» y «Lo tuyo» como texto no vacío"),
        (con_otro_estado, "tienen un estado distinto de " + " o ".join(f"«{estado}»" for estado in estados)),
        (sin_redaccion, "no traen «La IA podría» y «Lo tuyo», que son su redacción"),
    ]
    return [
        f"{len(ids)} textos {motivo} ({', '.join(ids[:MAX_IDS_EN_UN_AVISO])}"
        f"{'…' if len(ids) > MAX_IDS_EN_UN_AVISO else ''})"
        for ids, motivo in casos
        if ids
    ]


def validar_textos(tareas: dict[str, dict[str, Any]], oficiales: dict[str, Any]) -> None:
    """Lanza `ValidacionFallida` con los motivos de `problemas_de_textos`."""
    fallos = problemas_de_textos([{"id": identificador, **tarea} for identificador, tarea in tareas.items()], oficiales)
    exigir(not fallos, "textos: " + "; ".join(fallos), ValidacionFallida)


def aviso_traduccion() -> str:
    """Aviso de traducción OIT literal, de var/actualizacion/originales/oit/procedencia.json.

    Returns:
        El aviso, literal.
    """
    return leer_json(carpetas("oit").original / ARCHIVO_DE_PROCEDENCIA)["aviso_traduccion"]


def combinar(archivos: dict[str, bytes] | None = None) -> dict[str, Any]:
    """Textos de tareas tal como se exportan al motor, con el aviso de traducción de la OIT.

    Orden de preferencia: la redacción manual del piloto, la redacción completa con IA (con «La IA podría» y
    «Lo tuyo») y, por último, la traducción con IA del título y el texto. Cada tarea conserva su estado
    («redacción manual», «redactado con IA» o «traducido con IA»). El estado del conjunto se calcula de su
    contenido: cuántas tareas hay en cada estado (el que trae el archivo del piloto solo habla de las suyas).

    Args:
        archivos: Captura de archivos_validados, o None para capturar los archivos actuales.

    Returns:
        Los textos por tarea, con el aviso de traducción.
    """
    archivos = _capturar() if archivos is None else archivos
    textos = _contenido(PILOTO, archivos[PILOTO])
    tareas = textos["tareas"]
    for tarea in tareas.values():
        tarea.setdefault("estado", ESTADO_PILOTO)
    tareas.update(_textos_que_faltan(_lineas(GENERADAS, archivos), CAMPOS_DE_LO_GENERADO, tareas))
    tareas.update(_textos_que_faltan(_lineas(TRADUCIDAS, archivos), CAMPOS_TEXTO, tareas))
    # Solo se hace legible la etiqueta del resumen: el estado original permanece y su control puede rechazarlo.
    estados = Counter(str(tarea.get("estado", "sin estado")) for tarea in tareas.values())
    textos["estado"] = "; ".join(f"{cantidad} tareas: {estado}" for estado, cantidad in estados.most_common())
    textos["aviso_traduccion"] = aviso_traduccion()
    return textos


def rutas() -> list[Path]:
    """Rutas de los archivos de textos, en el orden de preferencia de la combinación.

    Returns:
        Las rutas, en orden de preferencia.
    """
    return [_ruta(nombre) for nombre in ARCHIVOS]


def archivos_validados() -> dict[str, bytes]:
    """Captura los archivos y exige que sean los bytes admitidos por la validación.

    Returns:
        Nombre y bytes admitidos, en el orden de preferencia de la combinación.
    """
    validacion = exigir_admitido(FUENTE)
    archivos = _capturar()
    validados = all(validacion["sha256"].get(nombre) == sha256_bytes(datos) for nombre, datos in archivos.items())
    exigir(
        validados,
        "textos: los archivos no son los validados; ejecutar "
        "python3 -m plataforma_datos.ocupaciones.fuentes.textos.lector validar",
        ValidacionFallida,
    )
    return archivos


# ---------------------------------------------------------------------------------------------------------------------
# Etapas
# ---------------------------------------------------------------------------------------------------------------------


def descargar() -> None:
    """Explica la entrada manual de capturas y su procedencia histórica, sin ejecutar herramientas de autoría."""
    print("textos: se aportan capturas JSON/JSONL de autoría (véase README). Identificadores históricos, no órdenes:")
    for nombre in ARCHIVOS_CON_IA:
        print(f"  {nombre}: {ORIGENES[nombre]['herramienta']}")
    print(f"Después, «preparar» registra su procedencia en {relativa(PROCEDENCIA)}.")


def preparar() -> None:
    """Registra la procedencia de los textos: huella de cada archivo y con qué modelo e instrucciones se generaron."""
    procedencia = {
        "fuente": "Faro · textos en castellano de las tareas oficiales de la OIT",
        "nivel": "elaboración propia sobre una fuente oficial",
        "aviso_traduccion": aviso_traduccion(),
        "archivos": [_registro_procedencia(nombre) for nombre in ARCHIVOS],
    }
    guardar_json(PROCEDENCIA, procedencia)
    print(", ".join(f"{entrada['archivo']} {entrada['registros']}" for entrada in procedencia["archivos"]))


def validar() -> None:
    """Contrasta los textos con su procedencia y con las tareas oficiales, y guarda la validación."""
    procedencia = leer_json(PROCEDENCIA)
    oficiales = leer_validado("oit")["tareas"]
    archivos = _capturar()
    combinados = combinar(archivos)
    controles = _controles(procedencia, oficiales, archivos, combinados)
    informe = {
        "estado": ESTADO_ADMITIDO if controles.admitido else CON_ERRORES,
        "comprobado_utc": ahora_utc(),
        "cobertura": _cobertura(oficiales, combinados["tareas"]),
        "sha256": {nombre: sha256_bytes(datos) for nombre, datos in archivos.items()},
        "generacion": {entrada["archivo"]: _generacion(entrada) for entrada in entradas_procedencia(procedencia)},
        "limites": "Textos de Faro, no de la OIT. Los generados con IA lo dicen en su estado («traducido con "
        "IA» o «redactado con IA»); el paquete del motor no copia su modelo, fecha ni huella de instrucciones, "
        "que constan aquí. Los controles miden la forma; la fidelidad de lo hecho con IA no está medida.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos; None toma los de la línea de órdenes.

    Returns:
        El código de salida del proceso.
    """
    etapas = {"descargar": descargar, "preparar": preparar, "validar": validar}
    return principal_fuente(__doc__, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
