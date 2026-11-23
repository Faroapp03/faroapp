"""Estimación por diseño de la exposición a la IA generativa con microdatos de encuestas (ISCO-08 a 4 dígitos).

La parte del empleo con ocupación declarada que está en grupos primarios ISCO-08 con gradiente 1–4 («alguna») o 4
(«alta») de la OIT (WP140, tabla A1 y tabla 5), con sus cotas (Manski: lo que no se asigna a un grupo primario sin
suponer nada, no expuesto en la cota mínima y expuesto en la máxima) y su error de muestreo por linealización de Taylor
del cociente, con reposición en la primera etapa. Lo usa cada encuesta de `encuestas_isco4`.

Python estándar.
"""

import math
from collections.abc import Iterable, Mapping
from operator import add
from typing import Any, NamedTuple

from plataforma_datos.comun.entrada_salida import leer_json, ruta_del_conjunto
from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.medidas_de_exposicion import MEDIDAS, cotas_de_exposicion

Z_95 = 1.959964
MUESTRA_MINIMA = 30  # NCHS, Parker y otros (2017), Series 2 n.º 175: n ≥ 30 sobre la cifra que se publica
# Si el empleo sin grupo primario ISCO-08 pasa de esta parte, la cifra puntual dependería de un reparto supuesto: solo
# se publican las cotas.
TOPE_SIN_CORRESPONDENCIA = 0.05
FUERZAS_ARMADAS = ("01", "02", "03")
# Cifras de un grupo primario de ISCO-08.
CIFRAS_DEL_GRUPO_PRIMARIO = 4
# Un estrato necesita al menos dos UPM para tener varianza entre ellas.
UPM_MINIMAS_POR_ESTRATO = 2
# Una estimación por réplicas necesita el peso principal y al menos dos réplicas.
COLUMNAS_MINIMAS_DE_PESOS = 3


class Persona(NamedTuple):
    """Una observación de la encuesta: ocupación ISCO-08 (None si no se declara), peso y unidad de diseño."""

    ocupada: bool
    codigo: str | None
    peso: float
    estrato: str
    conglomerado: str


class Estructura(NamedTuple):
    """Lo que hace falta para asignar un código: notas de la OIT, grupos ISCO-08 y subgrupos comparables."""

    grad: dict[str, str | None]
    isco4: set[str]
    comparables: dict[str, bool]
    validos: set[str]  # los códigos de la estructura publicada; otro código es un error de codificación
    # Subgrupos propios de la clasificación nacional, sin equivalente en ISCO-08, con los grupos primarios donde
    # ISCO-08 pone ese empleo: se acotan sobre ellos.
    propios: Mapping[str, tuple[str, ...]]


def isco4_oficial() -> set[str]:
    """Los 436 grupos primarios de ISCO-08, de la fuente `clasificaciones` (la estructura oficial de la OIT).

    Returns:
        Los códigos de 4 cifras de los grupos primarios.
    """
    return {
        codigo
        for codigo in leer_json(ruta_del_conjunto("clasificaciones"))["isco08_es"]
        if len(codigo) == CIFRAS_DEL_GRUPO_PRIMARIO
    }


def subgrupos_comparables(codigos: set[str], isco4: set[str]) -> dict[str, bool]:
    """Por subgrupo de 2 dígitos, si sus grupos primarios son exactamente los de ISCO-08.

    Returns:
        Para cada subgrupo de 2 dígitos, `True` si coincide con ISCO-08.
    """
    return {
        grupo: {cod for cod in codigos if cod[:2] == grupo} == {cod for cod in isco4 if cod[:2] == grupo}
        for grupo in sorted({cod[:2] for cod in codigos | isco4})
    }


def clase(codigo: str | None, estructura: Estructura) -> str:
    """Clase de un código: «fuera», «invalido», «exacta» o «acotada».

    «fuera»: fuerzas armadas o sin ocupación; «invalido»: fuera de la estructura publicada; «exacta»: grupo primario
    con nota en un subgrupo comparable; «acotada»: el resto.

    Returns:
        Una de «fuera», «invalido», «exacta» o «acotada».
    """
    if codigo is None or codigo[:2] in FUERZAS_ARMADAS:
        return "fuera"
    if codigo not in estructura.validos:
        return "invalido"
    comparable = estructura.comparables.get(codigo[:2], False)
    return "exacta" if comparable and codigo in estructura.isco4 and codigo in estructura.grad else "acotada"


def cotas(codigo: str, estructura: Estructura) -> dict[str, tuple[float, float]]:
    """(mínimo, máximo) de la fracción expuesta, por medida: exacta o sobre los grupos ISCO-08 de su subgrupo.

    Returns:
        Por medida, el par (mínimo, máximo) de la fracción expuesta, entre 0 y 1.
    """
    if clase(codigo, estructura) == "exacta":
        return cotas_de_exposicion([codigo], estructura.grad)
    if codigo[:2] in estructura.propios:
        return cotas_de_exposicion(estructura.propios[codigo[:2]], estructura.grad)
    return cotas_de_exposicion([grupo for grupo in estructura.grad if grupo[:2] == codigo[:2]], estructura.grad)


def varianza_del_cociente(estratos: dict[str, list[list[float]]], campo: int, cociente: float, total: float) -> float:
    """Varianza linealizada de Σy/Σx: z = (y − R·x)/X por UPM y Σ_h n_h/(n_h − 1) Σ_j (z_hj − z̄_h)².

    Returns:
        La varianza del cociente, en las unidades de la fracción al cuadrado.
    """
    varianza = 0.0
    for filas in estratos.values():
        if len(filas) < UPM_MINIMAS_POR_ESTRATO:
            continue  # un estrato con una sola UPM no aporta varianza estimable (Stata: singleunit(certainty))
        lineal = [(fila[campo] - cociente * fila[0]) / total for fila in filas]
        media = sum(lineal) / len(lineal)
        varianza += len(lineal) / (len(lineal) - 1) * sum((valor - media) ** 2 for valor in lineal)
    return varianza


def _muestra(celdas: dict[str, int], estratos: dict[str, list[list[float]]], conglomerados: int) -> dict[str, Any]:
    """Tamaño de la muestra, celdas pequeñas (regla del NCHS) y unidades del diseño.

    Returns:
        El tamaño de la muestra, las celdas pequeñas y las unidades del diseño.
    """
    pequenas = {codigo: cuantas for codigo, cuantas in celdas.items() if cuantas < MUESTRA_MINIMA}
    personas = sum(celdas.values())
    return {
        "personas": personas,
        "celdas": len(celdas),
        "celdas_de_menos_de_30": len(pequenas),
        "personas_en_celdas_de_menos_de_30": sum(pequenas.values()),
        "regla_nchs_n_30": personas >= MUESTRA_MINIMA,
        "estratos": len(estratos),
        "conglomerados": conglomerados,
        "estratos_con_una_sola_upm": sum(1 for filas in estratos.values() if len(filas) == 1),
    }


def exposicion_por_diseno(personas: Iterable[Persona], estructura: Estructura) -> dict[str, Any]:
    """Las cifras, sus cotas y su error de muestreo (linealización de Taylor del cociente, con reposición en la UPM).

    Returns:
        Las cifras con sus cotas y su error de muestreo.
    """
    por_upm: dict[tuple[str, str], list[float]] = {}
    # Por UPM: [empleo dentro, expuesto mínimo y máximo de cada medida].
    campos = 1 + 2 * len(MEDIDAS)
    empleo = fuera = invalido = sin_correspondencia = 0.0
    celdas: dict[str, int] = {}
    por_codigo: dict[str, dict[str, tuple[float, float]]] = {}
    for persona in personas:
        fila = por_upm.setdefault((persona.estrato, persona.conglomerado), [0.0] * campos)
        if not persona.ocupada:
            continue
        exigir(persona.peso > 0, "encuesta: una persona ocupada sin peso positivo")
        exigir(math.isfinite(persona.peso), "encuesta: una persona ocupada con peso no finito")
        empleo += persona.peso
        tipo = clase(persona.codigo, estructura)
        if tipo in {"fuera", "invalido"} or persona.codigo is None:
            fuera += persona.peso
            invalido += persona.peso if tipo == "invalido" else 0.0
            continue
        sin_correspondencia += persona.peso if tipo == "acotada" else 0.0
        if persona.codigo not in por_codigo:
            por_codigo[persona.codigo] = cotas(persona.codigo, estructura)
        celdas[persona.codigo] = celdas.get(persona.codigo, 0) + 1
        fila[0] += persona.peso
        for indice, medida in enumerate(MEDIDAS):
            minimo, maximo = por_codigo[persona.codigo][medida]
            fila[1 + 2 * indice] += persona.peso * minimo
            fila[2 + 2 * indice] += persona.peso * maximo
    exigir(bool(celdas), "encuesta: no hay personas ocupadas con ocupación declarada")
    totales = [sum(fila[campo] for fila in por_upm.values()) for campo in range(campos)]
    exigir(
        math.isfinite(empleo) and all(math.isfinite(total) for total in totales),
        "encuesta: los totales ponderados no son finitos",
    )
    dentro = totales[0]
    estratos: dict[str, list[list[float]]] = {}
    for (estrato, _), fila in por_upm.items():
        estratos.setdefault(estrato, []).append(fila)
    parte_sin = sin_correspondencia / dentro
    resultado: dict[str, Any] = {}
    for indice, medida in enumerate(MEDIDAS):
        cociente = totales[1 + 2 * indice] / dentro
        tipico = 100 * math.sqrt(varianza_del_cociente(estratos, 1 + 2 * indice, cociente, dentro))
        minimo, maximo = 100 * cociente, 100 * totales[2 + 2 * indice] / dentro
        exacta = round(minimo, 3) == round(maximo, 3)  # lo acotado no cambia la cifra
        resultado[medida] = {
            "valor": round(minimo, 3) if parte_sin <= TOPE_SIN_CORRESPONDENCIA or exacta else None,
            "cota_minima": round(minimo, 3),
            "cota_maxima": round(maximo, 3),
            "error_tipico": round(tipico, 3),
            "desde_95": round(max(0.0, minimo - Z_95 * tipico), 3),
            "hasta_95": round(min(100.0, maximo + Z_95 * tipico), 3),
        }
    return {
        **resultado,
        "empleo": round(empleo),
        "empleo_dentro": round(dentro),
        "parte_fuera": round(fuera / empleo, 5),
        "parte_codigo_invalido": round(invalido / empleo, 6),
        "parte_sin_correspondencia": round(parte_sin, 5),
        "muestra": _muestra(celdas, estratos, len(por_upm)),
    }


def _comprobar_pesos_replicados(pesos: list[float], columnas: int) -> int:
    """Comprueba forma y dominio de los pesos de una persona antes de agregarlos.

    Returns:
        El número común de columnas, incluido el peso principal.
    """
    exigir(len(pesos) >= COLUMNAS_MINIMAS_DE_PESOS, "encuesta: se necesitan al menos dos réplicas")
    exigir(not columnas or len(pesos) == columnas, "encuesta: los pesos no tienen el mismo número de réplicas")
    exigir(pesos[0] > 0, "encuesta: una persona ocupada sin peso positivo")
    exigir(
        all(math.isfinite(peso) and peso >= 0 for peso in pesos),
        "encuesta: un peso principal o de réplica no finito o negativo",
    )
    return len(pesos)


def exposicion_por_replicas(
    personas: Iterable[tuple[str | None, list[float]]], estructura: Estructura
) -> dict[str, Any]:
    """Las cifras, sus cotas y su error de muestreo con pesos replicados de cada persona ocupada.

    Cada persona da su código ISCO-08 (None si no se declara) y sus pesos: el principal y después las réplicas. La
    varianza de cada cifra es Σ_r (θ_r − θ)² / (R − 1), con θ_r la cifra con la réplica r y θ la del peso principal
    (convención del IBGE para la PNAD Contínua: réplicas bootstrap, desviaciones respecto de la cifra principal).

    Returns:
        Las cifras con sus cotas y su error de muestreo por réplicas.
    """
    por_codigo: dict[str | None, list[float]] = {}
    cuantas: dict[str | None, int] = {}
    columnas = 0
    for codigo, pesos in personas:
        columnas = _comprobar_pesos_replicados(pesos, columnas)
        previo = por_codigo.get(codigo)
        por_codigo[codigo] = pesos if previo is None else list(map(add, previo, pesos))
        cuantas[codigo] = cuantas.get(codigo, 0) + 1
    exigir(bool(por_codigo), "encuesta: no hay personas ocupadas")
    empleo = sum(pesos[0] for pesos in por_codigo.values())
    fuera = invalido = sin_correspondencia = 0.0
    dentro = [0.0] * columnas
    minimo = {medida: [0.0] * columnas for medida in MEDIDAS}
    maximo = dict.fromkeys(MEDIDAS, 0.0)
    celdas: dict[str, int] = {}
    for codigo, pesos in por_codigo.items():
        tipo = clase(codigo, estructura)
        if codigo is None or tipo in {"fuera", "invalido"}:
            fuera += pesos[0]
            invalido += pesos[0] if tipo == "invalido" else 0.0
            continue
        sin_correspondencia += pesos[0] if tipo == "acotada" else 0.0
        celdas[codigo] = cuantas[codigo]
        dentro = list(map(add, dentro, pesos))
        for medida, (bajo, alto) in cotas(codigo, estructura).items():
            minimo[medida] = [suma + peso * bajo for suma, peso in zip(minimo[medida], pesos, strict=True)]
            maximo[medida] += pesos[0] * alto
    exigir(bool(celdas), "encuesta: no hay personas ocupadas con ocupación declarada")
    exigir(
        math.isfinite(empleo) and all(math.isfinite(total) for total in dentro),
        "encuesta: los totales ponderados no son finitos",
    )
    exigir(
        all(total > 0 for total in dentro),
        "encuesta: cada réplica necesita un total positivo con ocupación declarada",
    )
    parte_sin = sin_correspondencia / dentro[0]
    resultado: dict[str, Any] = {}
    for medida in MEDIDAS:
        cifras = [expuesto / total for expuesto, total in zip(minimo[medida], dentro, strict=True)]
        varianza = sum((cifra - cifras[0]) ** 2 for cifra in cifras[1:]) / (columnas - 2)
        tipico = 100 * math.sqrt(varianza)
        bajo, alto = 100 * cifras[0], 100 * maximo[medida] / dentro[0]
        exacta = round(bajo, 3) == round(alto, 3)
        resultado[medida] = {
            "valor": round(bajo, 3) if parte_sin <= TOPE_SIN_CORRESPONDENCIA or exacta else None,
            "cota_minima": round(bajo, 3),
            "cota_maxima": round(alto, 3),
            "error_tipico": round(tipico, 3),
            "desde_95": round(max(0.0, bajo - Z_95 * tipico), 3),
            "hasta_95": round(min(100.0, alto + Z_95 * tipico), 3),
        }
    pequenas = {codigo: cuenta for codigo, cuenta in celdas.items() if cuenta < MUESTRA_MINIMA}
    personas_dentro = sum(celdas.values())
    return {
        **resultado,
        "empleo": round(empleo),
        "empleo_dentro": round(dentro[0]),
        "parte_fuera": round(fuera / empleo, 5),
        "parte_codigo_invalido": round(invalido / empleo, 6),
        "parte_sin_correspondencia": round(parte_sin, 5),
        "muestra": {
            "personas": personas_dentro,
            "celdas": len(celdas),
            "celdas_de_menos_de_30": len(pequenas),
            "personas_en_celdas_de_menos_de_30": sum(pequenas.values()),
            "regla_nchs_n_30": personas_dentro >= MUESTRA_MINIMA,
            "replicas": columnas - 1,
        },
    }
