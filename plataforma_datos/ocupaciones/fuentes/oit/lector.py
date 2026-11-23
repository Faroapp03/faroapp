"""OIT: tareas oficiales ISCO-08 y exposición a la IA generativa (Working Paper 140, 2025).

Descarga desde las direcciones oficiales, prepara, cruza y valida. Python estándar; sin IA.

Niveles de fuente:
  oficial         publicado por la OIT (documento CC BY 4.0 y clasificación ISCO-08).
  complementaria  material complementario que la OIT pone a disposición desde el documento oficial
                  (nota de la figura 16): notas por tarea en el repositorio del autor principal. La política
                  de acceso abierto de la OIT (desde el 3 de mayo de 2023) permite reutilizarlo sin permiso
                  citando a la OIT.

Uso: python3 -m plataforma_datos.ocupaciones.fuentes.oit.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import html
import re
import sys
from typing import Any

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    comprobar_originales,
    controles_de_huella,
    guardar_json,
    guardar_jsonl,
    leer_json,
    leer_jsonl,
)
from plataforma_datos.comun.hojas import leer_xlsx
from plataforma_datos.comun.nucleo import ADMITIDO, CON_ERRORES, Controles, exigir
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.comun.textos_y_cifras import clave_de_comparacion, numero_es, texto
from plataforma_datos.ocupaciones.fuentes.oit.piezas.constantes_oit import (
    ARCHIVOS,
    AVISO_ADAPTACION,
    AVISO_TRADUCCION,
    CIFRAS_DEL_GRUPO_PRIMARIO,
    CITA,
    CONTRASTE,
    DOCUMENTO,
    ESTRUCTURA,
    FRASES_POLITICA,
    FUENTE,
    GRADIENTES,
    GRUPOS_PRIMARIOS_ISCO08,
    HOLGURA,
    LICENCIA,
    MAX_FILAS_AUTOR_SIN_TAREA,
    MODELOS_DE_LA_NOTA,
    NIVEL_DEL_GRUPO_PRIMARIO,
    NOTAS_AUTOR,
    OCUPACIONES,
    OCUPACIONES_TABLA_A1,
    ORIGINAL,
    PATRON_AVISO,
    POLITICA,
    PROCEDENCIA,
    PROHIBIDO,
    TAREAS,
    TOLERANCIA_A1,
)
from plataforma_datos.ocupaciones.fuentes.oit.piezas.tabla_a1_oit import (
    decodificar_html,
    equivalencia_del_original,
    leer_tabla_a1,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

# El método con el que el autor fija la nota de una tarea cuando sus dos modelos discrepan; puede quedar fuera del
# margen entre ellos.
METODO_RECONCILIADO = "reconciled"

# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de preparar
# ---------------------------------------------------------------------------------------------------------------------


def _tareas_oficiales(bruto: str) -> list[dict[str, Any]]:
    """Separa las tareas de la lista «Tasks include» de un grupo: «(a) … (b) …».

    Args:
        bruto: El texto de la celda, con saltos de línea.

    Returns:
        Cada tarea con su índice (desde 1), su letra y su texto, en el orden del texto.
    """
    plano = bruto.replace("\r", " ").replace("\n", " ")
    # Cada tarea va desde su letra entre paréntesis hasta la letra siguiente (seguida de un espacio) o el final; la
    # letra y el texto salen de la misma pasada, así que cada texto conserva su letra.
    tramos = re.findall(r"\(([a-z])\)\s*(.*?)(?=\([a-z]\)\s|$)", plano, re.S)
    return [
        {"indice": indice, "letra": letra, "texto_en": texto(tramo).rstrip(";.").strip()}
        for indice, (letra, tramo) in enumerate(tramos, 1)
    ]


def _codigo_isco(celda: object) -> str:
    """Lee un código ISCO-08 de una celda: Excel guarda algunos como número («1111.0»).

    Args:
        celda: El valor de la celda.

    Returns:
        El código como texto, sin el «.0» final.
    """
    return texto(celda).removesuffix(".0")


def _isco_oficial() -> dict[str, dict[str, Any]]:
    """Lee los grupos primarios de la clasificación ISCO-08 oficial.

    Returns:
        Código del grupo primario → su título, su definición y sus tareas oficiales.
    """
    grupos = {}
    for fila in leer_xlsx(ORIGINAL / ESTRUCTURA):
        codigo = _codigo_isco(fila.get("ISCO 08 Code", ""))
        if texto(fila.get("Level", "")) != NIVEL_DEL_GRUPO_PRIMARIO or len(codigo) != CIFRAS_DEL_GRUPO_PRIMARIO:
            continue
        grupos[codigo] = {
            "titulo_en": texto(fila.get("Title EN", "")),
            "definicion_en": texto(fila.get("Definition", "")),
            "tareas": _tareas_oficiales(fila.get("Tasks include", "")),
        }
    return grupos


def _numero(fila: dict[str, str], campo: str) -> float | None:
    """Lee el número de una celda.

    Args:
        fila: Una fila del archivo del autor.
        campo: La columna.

    Returns:
        El número, o None si la celda está vacía.
    """
    return float(fila[campo]) if fila.get(campo) not in (None, "") else None


def _nota_autor(fila: dict[str, str]) -> dict[str, Any]:
    """Lee la nota por tarea de una fila del archivo del autor.

    Args:
        fila: Una fila del archivo del autor.

    Returns:
        La nota, las de los dos modelos, la de 2023, el método, las justificaciones y las cifras de su ocupación.
    """
    return {
        "texto_autor": texto(fila["Task_ISCO"]),
        "indice_autor": int(float(fila["taskID"])),
        "nota": float(fila["score_2025"]),
        "modelo_gpt4o": _numero(fila, "predicted_score_2025_gpt4o"),
        "modelo_gemini": _numero(fila, "predicted_score_2025_gemini"),
        "nota_2023": _numero(fila, "score_2023"),
        "metodo": texto(fila.get("source", "")),
        "justificacion_gpt4o": texto(fila.get("prediction_justification_gpt4o", "")),
        "justificacion_gemini": texto(fila.get("prediction_justification_gemini", "")),
        "media_ocupacion_autor": float(fila["mean_score_2025"]),
        "sd_ocupacion_autor": float(fila["SD_2025"]),
        "gradiente_autor": GRADIENTES.get(texto(fila["potential25"]), texto(fila["potential25"])),
    }


def _cruzar_notas(
    isco: dict[str, dict[str, Any]],
) -> tuple[dict[tuple[str, int], dict[str, Any]], list[dict[str, Any]]]:
    """Asigna cada nota del autor a su tarea oficial por texto normalizado dentro de cada ocupación.

    El orden del autor no siempre coincide con el oficial.

    Args:
        isco: Los grupos primarios oficiales con sus tareas.

    Returns:
        Las notas por (ocupación, índice oficial) y las filas del autor que no corresponden a ninguna tarea oficial.

    Raises:
        FormatoInesperado: Si una tarea oficial recibe dos notas del autor.
    """
    oficiales = {
        (codigo, clave_de_comparacion(tarea["texto_en"])): tarea["indice"]
        for codigo, grupo in isco.items()
        for tarea in grupo["tareas"]
    }
    notas: dict[tuple[str, int], dict[str, Any]] = {}
    sin_tarea = []
    for fila in leer_xlsx(ORIGINAL / NOTAS_AUTOR):
        codigo = _codigo_isco(fila["ISCO_08"]).zfill(CIFRAS_DEL_GRUPO_PRIMARIO)
        clave = (codigo, clave_de_comparacion(fila["Task_ISCO"]))
        nota = _nota_autor(fila)
        if clave not in oficiales:
            sin_tarea.append(
                {
                    "isco08": codigo,
                    "indice_autor": nota["indice_autor"],
                    "texto": nota["texto_autor"],
                    "nota": nota["nota"],
                }
            )
            continue
        exigir((codigo, oficiales[clave]) not in notas, f"tarea oficial con dos notas del autor: {clave}")
        notas[(codigo, oficiales[clave])] = nota
    return notas, sin_tarea


def _grupo_primario(codigo: str, grupo: dict[str, Any], a1: dict[str, Any] | None) -> dict[str, Any]:
    """Compone la fila de un grupo primario ISCO-08 con su nota oficial, si la tiene.

    Args:
        codigo: Código del grupo primario.
        grupo: Su título y sus tareas oficiales.
        a1: Su fila de la tabla A1, o None si no está en ella.

    Returns:
        La fila de `ocupaciones.jsonl`.
    """
    return {
        "isco08": codigo,
        "titulo_en": grupo["titulo_en"],
        "tareas_oficiales": len(grupo["tareas"]),
        "media": a1["media"] if a1 else None,
        "sd": a1["sd"] if a1 else None,
        "gradiente": a1["gradiente"] if a1 else None,
        "nivel_fuente": "oficial" if a1 else None,
        "origen": "ILO WP140, tabla A1" if a1 else "Sin nota en la tabla A1",
    }


def _margen(nota: dict[str, Any]) -> list[float] | None:
    """Calcula el margen entre las notas de los dos modelos.

    Args:
        nota: La nota del autor de una tarea.

    Returns:
        [mínimo, máximo] redondeados a 4 decimales, o None si falta alguna de las dos.
    """
    modelos = [valor for valor in (nota["modelo_gpt4o"], nota["modelo_gemini"]) if valor is not None]
    if len(modelos) != MODELOS_DE_LA_NOTA:
        return None
    return [round(min(modelos), 4), round(max(modelos), 4)]


def _tarea(codigo: str, tarea: dict[str, Any], nota: dict[str, Any] | None) -> dict[str, Any]:
    """Compone la fila de una tarea oficial con la nota complementaria del autor, si la tiene.

    Args:
        codigo: Código del grupo primario.
        tarea: La tarea oficial (índice, letra y texto).
        nota: La nota del autor, o None si no la tiene.

    Returns:
        La fila de `tareas.jsonl`.
    """
    fila = {
        "id": f"{codigo}-{tarea['indice']}",
        "isco08": codigo,
        "indice": tarea["indice"],
        "letra": tarea["letra"],
        "texto_en": tarea["texto_en"],
        "nivel_texto": "oficial",
        "origen_texto": "ISCO-08, estructura y definiciones (OIT)",
    }
    if not nota:
        return fila
    fila.update(
        nota=round(nota["nota"], 4),
        margen=_margen(nota),
        modelo_gpt4o=nota["modelo_gpt4o"],
        modelo_gemini=nota["modelo_gemini"],
        nota_2023=nota["nota_2023"],
        metodo=nota["metodo"],
        nivel_nota="complementaria",
        origen_nota="Notas por tarea del autor principal (WP140, figura 16)",
        indice_autor=nota["indice_autor"],
        texto_autor=nota["texto_autor"],
        justificacion_gpt4o=nota["justificacion_gpt4o"],
        justificacion_gemini=nota["justificacion_gemini"],
    )
    return fila


def _notas_por_ocupacion(notas: dict[tuple[str, int], dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Agrupa las notas del autor por ocupación, en una sola pasada.

    Args:
        notas: Las notas por (ocupación, índice oficial).

    Returns:
        Código del grupo primario → sus notas, en el orden de `notas`.
    """
    por_ocupacion: dict[str, list[dict[str, Any]]] = {}
    for (codigo, _), nota in notas.items():
        por_ocupacion.setdefault(codigo, []).append(nota)
    return por_ocupacion


def _efecto_filas_sin_tarea(
    sin_tarea: list[dict[str, Any]], notas: dict[tuple[str, int], dict[str, Any]], a1: dict[str, Any]
) -> list[dict[str, Any]]:
    """Calcula el efecto de las filas del autor que no son tareas oficiales sobre la media de su ocupación.

    Args:
        sin_tarea: Las filas del autor sin tarea oficial.
        notas: Las notas por (ocupación, índice oficial).
        a1: La tabla A1 por código.

    Returns:
        Cada fila con la media publicada en la tabla A1 y la media de su ocupación sin ella y con ella.

    Raises:
        FormatoInesperado: Si la ocupación de una fila no tiene ninguna otra nota con la que hacer la media.
    """
    por_ocupacion = _notas_por_ocupacion(notas)
    efecto = []
    for fila in sin_tarea:
        propias = [nota["nota"] for nota in por_ocupacion.get(fila["isco08"], [])]
        exigir(bool(propias), f"la fila del autor sin tarea oficial de {fila['isco08']} no tiene otras notas")
        con_la_fila = [*propias, fila["nota"]]
        efecto.append(
            {
                **fila,
                "media_publicada_a1": a1.get(fila["isco08"], {}).get("media"),
                "media_sin_la_fila": round(sum(propias) / len(propias), 4),
                "media_con_la_fila": round(sum(con_la_fila) / len(con_la_fila), 4),
            }
        )
    return efecto


def _difiere(autor: dict[str, Any], a1: dict[str, Any]) -> bool:
    """Compara las cifras de una ocupación en el archivo del autor con las de la tabla A1.

    Args:
        autor: Una nota del autor, con la media, la desviación y el gradiente de su ocupación.
        a1: La fila de la ocupación en la tabla A1.

    Returns:
        True si la media, la desviación o el gradiente difieren más allá del redondeo (TOLERANCIA_A1).
    """
    return (
        abs(round(autor["media_ocupacion_autor"], 2) - a1["media"]) > TOLERANCIA_A1
        or abs(round(autor["sd_ocupacion_autor"], 2) - a1["sd"]) > TOLERANCIA_A1
        or autor["gradiente_autor"] != a1["gradiente"]
    )


def _diferencias_autor_a1(notas: dict[tuple[str, int], dict[str, Any]], a1: dict[str, Any]) -> list[dict[str, Any]]:
    """Busca las ocupaciones cuyas cifras en el archivo del autor no coinciden con la tabla A1 oficial.

    La media, la desviación y el gradiente del grupo se leen de la primera nota del autor de la ocupación.

    Args:
        notas: Las notas por (ocupación, índice oficial).
        a1: La tabla A1 por código.

    Returns:
        Cada ocupación que difiere, con las cifras de la tabla A1 y las del autor, por código.
    """
    por_ocupacion = _notas_por_ocupacion(notas)
    diferencias = []
    for codigo in sorted(a1):
        nota = next(iter(por_ocupacion.get(codigo, [])), None)
        if not nota or not _difiere(nota, a1[codigo]):
            continue
        oficial = a1[codigo]
        diferencias.append(
            {
                "isco08": codigo,
                "tabla_a1": {"media": oficial["media"], "sd": oficial["sd"], "gradiente": oficial["gradiente"]},
                "autor": {
                    "media": nota["media_ocupacion_autor"],
                    "sd": nota["sd_ocupacion_autor"],
                    "gradiente": nota["gradiente_autor"],
                },
            }
        )
    return diferencias


# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de validar
# ---------------------------------------------------------------------------------------------------------------------


def _en_margen(tarea: dict[str, Any]) -> bool:
    """Comprueba que la nota queda dentro del margen de sus dos modelos, con HOLGURA a cada lado.

    Args:
        tarea: Una tarea con nota.

    Returns:
        True si está dentro, si no tiene margen o si es reconciliada (estas pueden quedar fuera).
    """
    if tarea["margen"] is None or tarea["metodo"] == METODO_RECONCILIADO:
        return True
    minimo, maximo = tarea["margen"]
    # Equivale a mínimo − HOLGURA ≤ nota ≤ máximo + HOLGURA; se escribe sobre `nota + HOLGURA` porque, en coma
    # flotante, reordenar las sumas puede cambiar el resultado justo en el borde.
    return minimo <= tarea["nota"] + HOLGURA <= maximo + 2 * HOLGURA


def _con_nota(tareas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Filtra las tareas que tienen nota del autor.

    Args:
        tareas: Las tareas oficiales.

    Returns:
        Las que tienen nota, en su orden.
    """
    return [tarea for tarea in tareas if "nota" in tarea]


def _con_tabla_a1(ocupaciones: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Filtra las ocupaciones con nota oficial en la tabla A1.

    Args:
        ocupaciones: Los grupos primarios.

    Returns:
        Los que tienen media, en su orden.
    """
    return [ocupacion for ocupacion in ocupaciones if ocupacion["media"] is not None]


def _desordenadas(tareas: list[dict[str, Any]]) -> list[str]:
    """Busca las tareas que el autor numera en un orden distinto del oficial.

    Args:
        tareas: Las tareas oficiales.

    Returns:
        Los identificadores de las tareas con nota cuyo índice del autor no es el oficial.
    """
    return [tarea["id"] for tarea in _con_nota(tareas) if tarea["indice_autor"] != tarea["indice"]]


def _comprobar_cobertura(
    controles: Controles, ocupaciones: list[dict[str, Any]], tareas: list[dict[str, Any]], contraste: dict[str, Any]
) -> None:
    """Grupos ISCO-08 y tabla A1 completos; cada fila del autor, asignada a una tarea o documentada."""
    excluidas = contraste["notas_del_autor_sin_tarea_oficial"]
    filas_autor = len(leer_xlsx(ORIGINAL / NOTAS_AUTOR))
    controles.comprobar(
        len(ocupaciones) == GRUPOS_PRIMARIOS_ISCO08,
        f"{GRUPOS_PRIMARIOS_ISCO08} grupos primarios ISCO-08 en la clasificación oficial",
    )
    controles.comprobar(
        len(_con_tabla_a1(ocupaciones)) == OCUPACIONES_TABLA_A1,
        f"{OCUPACIONES_TABLA_A1} ocupaciones con nota en la tabla A1 oficial",
    )
    controles.comprobar(
        len(_con_nota(tareas)) + len(excluidas) == filas_autor,
        f"las {numero_es(filas_autor)} filas del autor quedan asignadas o documentadas",
    )
    controles.comprobar(
        len(excluidas) <= MAX_FILAS_AUTOR_SIN_TAREA,
        "como mucho una fila del autor no es tarea oficial (se excluye y se documenta)",
    )
    controles.comprobar(
        not contraste["tareas_oficiales_sin_nota"], "toda tarea oficial de una ocupación con tabla A1 tiene nota"
    )


def _comprobar_notas(controles: Controles, ocupaciones: list[dict[str, Any]], tareas: list[dict[str, Any]]) -> None:
    """Notas por tarea: en rango, dentro del margen de sus modelos y de ocupaciones con tabla A1."""
    con_nota = _con_nota(tareas)
    controles.comprobar(all(0 <= tarea["nota"] <= 1 for tarea in con_nota), "notas entre 0 y 1")
    controles.comprobar(
        all(_en_margen(tarea) for tarea in con_nota),
        "la nota queda dentro del margen de sus dos modelos, salvo tareas reconciliadas",
    )
    controles.comprobar(
        {tarea["isco08"] for tarea in con_nota} <= {ocupacion["isco08"] for ocupacion in _con_tabla_a1(ocupaciones)},
        "las tareas con nota pertenecen a ocupaciones de la tabla A1",
    )


def _aviso_del_documento(documento: str, tipo: str) -> str:
    """Extrae el aviso que el documento exige en una «translation» o una «adaptation», entero.

    Args:
        documento: El HTML del documento.
        tipo: «translation» o «adaptation».

    Returns:
        El aviso, o una cadena vacía si no está.
    """
    plano = texto(html.unescape(re.sub(r"<[^>]+>", " ", documento)))
    encontrado = re.search(PATRON_AVISO.format(tipo=tipo), plano)
    return encontrado.group(0) if encontrado else ""


def _comprobar_licencia(controles: Controles, procedencia: dict[str, Any]) -> None:
    """La política de reutilización de la OIT y los avisos de la licencia del documento, literales y enteros."""
    politica = (ORIGINAL / POLITICA).read_text(encoding="utf-8", errors="replace")
    controles.comprobar(
        all(frase in politica for frase in FRASES_POLITICA),
        "la política oficial de la OIT permite reutilizar sus productos, incluidas bases de datos, sin solicitar "
        "permiso y citando la fuente",
    )
    documento = decodificar_html((ORIGINAL / DOCUMENTO).read_bytes())
    aviso_adaptacion = _aviso_del_documento(documento, "adaptation")
    aviso_traduccion = _aviso_del_documento(documento, "translation")
    controles.comprobar(
        bool(aviso_adaptacion)
        and bool(aviso_traduccion)
        and procedencia["aviso_traduccion"] == aviso_traduccion
        and procedencia["aviso_adaptacion"] == aviso_adaptacion,
        "los avisos de traducción y de adaptación de la procedencia son, enteros, los del documento oficial (página 2)",
    )


def _controles(
    ocupaciones: list[dict[str, Any]],
    tareas: list[dict[str, Any]],
    contraste: dict[str, Any],
    procedencia: dict[str, Any],
) -> Controles:
    """Reúne los controles de los originales, de la cobertura, de las notas y de la licencia de la OIT.

    Args:
        ocupaciones: Los grupos primarios preparados.
        tareas: Las tareas preparadas.
        contraste: El contraste con el archivo del autor.
        procedencia: La procedencia de los originales.

    Returns:
        Los controles registrados.
    """
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    _comprobar_cobertura(controles, ocupaciones, tareas, contraste)
    _comprobar_notas(controles, ocupaciones, tareas)
    _comprobar_licencia(controles, procedencia)
    return controles


def _cobertura(
    ocupaciones: list[dict[str, Any]], tareas: list[dict[str, Any]], contraste: dict[str, Any]
) -> dict[str, Any]:
    """Resume lo que cubren las notas oficiales y las del autor.

    Args:
        ocupaciones: Los grupos primarios preparados.
        tareas: Las tareas preparadas.
        contraste: El contraste con el archivo del autor.

    Returns:
        Los recuentos de grupos, tareas, notas, reconciliadas y diferencias, y la diferencia media entre modelos.
    """
    con_nota = _con_nota(tareas)
    margenes = [tarea["margen"][1] - tarea["margen"][0] for tarea in con_nota if tarea["margen"]]
    return {
        "grupos_isco08": len(ocupaciones),
        "grupos_con_tabla_a1": len(_con_tabla_a1(ocupaciones)),
        "grupos_sin_nota": [ocupacion["isco08"] for ocupacion in ocupaciones if ocupacion["media"] is None],
        "tareas_oficiales": len(tareas),
        "tareas_con_nota": len(con_nota),
        "tareas_con_orden_distinto_en_el_autor": len(_desordenadas(tareas)),
        "tareas_reconciliadas": sum(tarea["metodo"] == METODO_RECONCILIADO for tarea in con_nota),
        "diferencia_media_entre_modelos": round(sum(margenes) / len(margenes), 4) if margenes else None,
        "ocupaciones_con_diferencias_autor_vs_a1": len(contraste["ocupaciones_con_diferencias"]),
    }


def _conjunto_validado(
    ocupaciones: list[dict[str, Any]], tareas: list[dict[str, Any]], procedencia: dict[str, Any]
) -> dict[str, Any]:
    """Compone la versión ligera para el motor: nota por ocupación y por tarea, con la cita y el aviso de adaptación.

    Args:
        ocupaciones: Los grupos primarios preparados.
        tareas: Las tareas preparadas.
        procedencia: La procedencia, con la cita y el aviso.

    Returns:
        El conjunto validado de la OIT.
    """
    return {
        "fuente": {"cita": procedencia["cita"], "aviso_adaptacion": procedencia["aviso_adaptacion"]},
        "ocupaciones": {
            ocupacion["isco08"]: {
                "titulo_en": ocupacion["titulo_en"],
                "media": ocupacion["media"],
                "sd": ocupacion["sd"],
                "gradiente": ocupacion["gradiente"],
            }
            for ocupacion in ocupaciones
        },
        "tareas": {
            tarea["id"]: {
                "isco08": tarea["isco08"],
                "indice": tarea["indice"],
                "texto_en": tarea["texto_en"],
                "nota": tarea.get("nota"),
                "margen": tarea.get("margen"),
                "metodo": tarea.get("metodo"),
            }
            for tarea in tareas
        },
    }


# ---------------------------------------------------------------------------------------------------------------------
# Etapas
# ---------------------------------------------------------------------------------------------------------------------


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga cada archivo desde su dirección oficial y registra su procedencia.

    Un original que ya no coincide con su procedencia detiene la descarga, salvo con `aceptar_cambio`.
    """
    registros = descargar_originales(ARCHIVOS, ORIGINAL, aceptar_cambio, equivalencia_del_original)
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": "OIT",
            "licencia": LICENCIA,
            "cita": CITA,
            "aviso_adaptacion": AVISO_ADAPTACION,
            "aviso_traduccion": AVISO_TRADUCCION,
            "prohibido": PROHIBIDO,
            "archivos": registros,
        },
    )


def preparar() -> None:
    """Cruza la tabla A1, la clasificación ISCO-08 y las notas del autor, y guarda los preparados."""
    comprobar_originales(FUENTE)
    a1 = leer_tabla_a1()
    isco = _isco_oficial()
    notas, sin_tarea = _cruzar_notas(isco)
    ocupaciones = [_grupo_primario(codigo, isco[codigo], a1.get(codigo)) for codigo in sorted(isco)]
    tareas = [
        _tarea(codigo, tarea, notas.get((codigo, tarea["indice"])))
        for codigo in sorted(isco)
        for tarea in isco[codigo]["tareas"]
    ]
    guardar_jsonl(OCUPACIONES, ocupaciones)
    guardar_jsonl(TAREAS, tareas)
    guardar_json(
        CONTRASTE,
        {
            "notas_del_autor_sin_tarea_oficial": _efecto_filas_sin_tarea(sin_tarea, notas, a1),
            "tareas_oficiales_sin_nota": [
                tarea["id"] for tarea in tareas if "nota" not in tarea and tarea["isco08"] in a1
            ],
            "ocupaciones_con_diferencias": _diferencias_autor_a1(notas, a1),
        },
    )
    con_nota = sum("nota" in tarea for tarea in tareas)
    print("ocupaciones ISCO-08", len(ocupaciones), "· tareas oficiales", len(tareas), "· con nota", con_nota)


def validar() -> None:
    """Comprueba los preparados contra sus originales y guarda la validación y el conjunto para el motor."""
    ocupaciones = leer_jsonl(OCUPACIONES)
    tareas = leer_jsonl(TAREAS)
    contraste = leer_json(CONTRASTE)
    procedencia = leer_json(PROCEDENCIA)
    controles = _controles(ocupaciones, tareas, contraste, procedencia)
    estado = CON_ERRORES
    if controles.admitido:
        estado = (
            f"{ADMITIDO}: nota por ocupación oficial (tabla A1, CC BY 4.0); nota por tarea como material "
            "complementario de la OIT, reutilizable citando a la OIT según su política de acceso abierto."
        )
    informe = {
        "estado": estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": _cobertura(ocupaciones, tareas, contraste),
        "filas_del_autor_excluidas": contraste["notas_del_autor_sin_tarea_oficial"],
        "tareas_con_orden_distinto_en_el_autor": _desordenadas(tareas),
        "ocupaciones_con_diferencias": contraste["ocupaciones_con_diferencias"],
        "regla": "Para cada ocupación manda la tabla A1 oficial. La nota por tarea es complementaria y se muestra "
        "con su margen entre modelos.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: _conjunto_validado(ocupaciones, tareas, procedencia))


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos de la línea de órdenes; sin ellos, los del proceso.

    Returns:
        El código de salida de la orden.
    """
    etapas = {"preparar": preparar, "validar": validar}
    return principal_fuente_con_descarga(__doc__, descargar, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
