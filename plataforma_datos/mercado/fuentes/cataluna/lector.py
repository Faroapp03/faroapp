"""Datos oficiales por ocupación en Cataluña: censo (INE, 2021) y contratación (Observatori del Treball).

Personas ocupadas, % de mujeres y edad (INE, Censo 2021) y contratación (Observatori del Treball i Model Productiu,
los 12 meses de su copia vigente). Python estándar.

Son las fuentes primarias del estudio del ODEE y la Cambra de Comerç de Barcelona (censo y Observatori), extendidas a
todas las ocupaciones. La contratación se mide como la Cambra: personas contratadas en 12 meses, no contratos.

El periodo de la contratación no se escribe a mano: sale del propio fichero del Observatori (su `c_mes` y su
`d_periode`), y cada copia lleva en el nombre el mes en que terminan sus 12 meses. El Observatori actualiza el visor
cada trimestre y no publica calendario: `descargar` captura las tres tablas vigentes, exige un mismo periodo y
conserva el censo de 2021. Las revisiones de copias existentes requieren `--aceptar-cambio`.

Estado: admitido si todos los controles pasan. Las cifras describen al grupo de ocupación, nunca a la persona.
Depende de las validaciones de las clasificaciones (CNO-11) y de la Cambra (contraste).

Uso: python3 -m plataforma_datos.mercado.fuentes.cataluna.lector {descargar,preparar,validar,todo}
"""

import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    comprobar_originales,
    conserva_su_huella,
    entradas_procedencia,
    guardar_json,
    guardar_jsonl,
    leer_json,
    leer_jsonl,
    original,
    procedencia,
    sha256_bytes,
)
from plataforma_datos.comun.nucleo import (
    ArchivoDescargable,
    ArchivoFaltante,
    Controles,
    ReglaDeCambio,
    exigir,
)
from plataforma_datos.comun.observacion_remota import observar_original
from plataforma_datos.comun.red import conservar_o_sustituir, descargar_url, registro_descarga
from plataforma_datos.comun.textos_y_cifras import pct, personas_anteriores
from plataforma_datos.mercado.fuentes.cataluna.piezas.captura_cataluna import CENSOS_FIJOS, TABLAS, filas_capturadas
from plataforma_datos.mercado.fuentes.cataluna.piezas.constantes_cataluna import (
    CAMPOS_CENSO,
    CAMPOS_CONTRATACION,
    CENSO,
    CITA_CENSO,
    CITA_OBSERVATORI,
    CITA_OBSERVATORI_SIN_FECHA,
    CONTEXTO,
    CONTRATACION,
    EDAD_JOVEN,
    EDAD_MAYOR,
    FUENTE,
    MESES,
    MIN_VARIACION,
    OBSERVATORI,
    ORIGINAL,
    PATRON_ACTUALIZACION,
    PATRON_OBSERVATORI,
    SEXO_MUJER_OBSERVATORI,
    TABLA_CONTRATACION,
    TABLA_MUJERES,
    TABLA_TOTALES,
    TERRITORIO,
    VISOR,
)
from plataforma_datos.mercado.fuentes.cataluna.piezas.controles_cataluna import (
    controles_censo,
    controles_conjunto_censo,
    controles_contraste_censo,
    controles_contraste_contratacion,
    controles_observatori,
    controles_totales_observatori,
)
from plataforma_datos.mercado.fuentes.censo.piezas.constantes_censo import HOMBRE_CENSO, MUJER_CENSO, OCUPACION
from plataforma_datos.mercado.fuentes.observatori.piezas.constantes_observatori import LICENCIA as LICENCIA_OBSERVATORI
from plataforma_datos.ocupaciones.fuentes.clasificaciones.lector import (
    CODIGO_NO_CONSTA,
    TOTAL_OCUPACIONES,
    codigo_de_ocupacion,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

# Piezas internas

# El nombre de una copia del Observatori en la procedencia, compilado una vez.
_COPIA_DEL_OBSERVATORI = re.compile(PATRON_OBSERVATORI)


def _items(tabla: str, periodo: str) -> list[dict[str, Any]]:
    """Filas de un archivo del Observatori, de la copia de un periodo.

    Args:
        tabla: El fichero del Observatori.
        periodo: El mes AAAA-MM de la copia (`periodo_archivado`), leído una vez por etapa.

    Returns:
        Las filas («items») del fichero, en el orden del Observatori.
    """
    filas = filas_capturadas(original(FUENTE, OBSERVATORI.format(tabla, periodo)).read_bytes(), tabla)
    exigir(_mes_con_guion(str(filas[0]["c_mes"])) == periodo, f"{tabla}: periodo distinto del registrado {periodo}")
    return filas


def _censo(nombre: str, campo: str) -> dict[str, dict[str, float]]:
    """Filas de Cataluña de una consulta del censo: {código: {valor de la variable: personas}}.

    Las filas sin código de ocupación («No consta») se agrupan aparte.

    Returns:
        Por código de ocupación (o «No consta»), las personas de cada valor de la variable que desglosa la consulta.
    """
    consulta = leer_json(original(FUENTE, nombre))
    # La tercera variable de la consulta es la que la desglosa (sexo o grupo de edad).
    variable = [metadato["row"] for metadato in consulta["metadata"]][2]
    personas: dict[str, dict[str, float]] = {}
    for fila in consulta["data"]:
        if fila["ID_RESIDENCIA_N1"] != TERRITORIO:
            continue
        codigo = codigo_de_ocupacion(fila[campo])
        por_valor = personas.setdefault(codigo, Counter())
        por_valor[fila[variable]] += fila["SPERSONAS"]
    return personas


def _pct_de_fraccion(fraccion: float | None) -> float | None:
    """Fracción del Observatori (0,25) como porcentaje con un decimal (25,0); `None` si no hay dato.

    Returns:
        El porcentaje con un decimal, o None si la fracción no consta.
    """
    if fraccion is None:
        return None
    return pct(parte=fraccion, total=1)


def _contratacion(registro: dict[str, Any], mujeres: dict[str, float | None], cno: dict[str, Any]) -> dict[str, Any]:
    """Fila de contratación de una ocupación de 4 cifras del Observatori.

    Returns:
        La fila de la ocupación con sus personas contratadas, su variación (solo si es publicable), sus contratos y sus
        porcentajes.
    """
    codigo = registro["c_grup_primari"]
    personas, variacion = registro["eo_per_cont_com_anual"], registro["eo_per_cont_var_anual"]
    anterior = personas_anteriores(personas, variacion)
    publicable = (
        variacion is not None
        and personas is not None
        and personas >= MIN_VARIACION
        and (anterior or 0) >= MIN_VARIACION
    )
    demandantes = registro["eo_dno_mitj"]
    return {
        "cno11": codigo,
        "titulo": cno.get(codigo, {}).get("titulo"),
        "nombre_ca": registro["d_grup_primari_cno11"],
        "mes": registro["c_mes"],
        "personas_contratadas": personas,
        "personas_contratadas_anterior": anterior,
        "variacion_pct": round(100 * variacion, 1) if publicable else None,
        "contratos": registro["eo_cont_sum_12m"],
        "pct_indefinidos": _pct_de_fraccion(registro["eo_perc_indef_tot_cont"]),
        "pct_mujeres_contratos": _pct_de_fraccion(mujeres.get(codigo)),
        "demandantes_no_ocupados": round(demandantes) if demandantes is not None else None,
    }


def _variacion_conjunto(filas: list[dict[str, Any]]) -> float:
    """Variación de la suma de personas contratadas en todas las ocupaciones con dato en los dos años.

    Una persona contratada en dos ocupaciones cuenta en las dos: por eso es el «conjunto de ocupaciones» y no el total.

    Returns:
        La variación en %, con un decimal.
    """
    con_dato = [fila for fila in filas if fila["personas_contratadas"] and fila["personas_contratadas_anterior"]]
    actual = sum(fila["personas_contratadas"] for fila in con_dato)
    anterior = sum(fila["personas_contratadas_anterior"] for fila in con_dato)
    exigir(anterior != 0, f"{FUENTE}: no hay base del año anterior para calcular la variación del conjunto")
    return round(100 * (actual / anterior - 1), 1)


def _preparar_censo(nivel: str, campo: str, cno: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """Resume el censo por sexo y edad a un nivel de la CNO-11 y guarda sus filas, ordenadas por código.

    Devuelve también el conjunto de Cataluña de ese nivel (`conjunto_de_cataluna`).

    Returns:
        El resumen por código de ese nivel y el conjunto de Cataluña de ese nivel.
    """
    sexo = _censo(f"ine-censo2021-ocu{nivel}-sexo.json", campo)
    edad = _censo(f"ine-censo2021-ocu{nivel}-edad.json", campo)
    censo = resumen_censo(sexo, edad)
    filas = [
        {"cno11": codigo, "titulo": cno.get(codigo, {}).get("titulo"), **resumen}
        for codigo, resumen in sorted(censo.items())
    ]
    guardar_jsonl(CENSO[nivel], filas)
    return censo, conjunto_de_cataluna(sexo, edad)


def _preparar_contratacion(cno: dict[str, Any], periodo: str) -> list[dict[str, Any]]:
    """Resume la contratación por ocupación de 4 cifras y la guarda ordenada por código.

    Args:
        cno: Las ocupaciones de la CNO-11.
        periodo: El mes AAAA-MM de la copia del Observatori.

    Returns:
        Las filas de contratación, en el orden del fichero del Observatori.
    """
    mujeres = {
        registro["c_grup_primari"]: registro["eo_perc_cont_ocup_sexe"]
        for registro in _items(TABLA_MUJERES, periodo)
        if registro["d_sexe"] == SEXO_MUJER_OBSERVATORI
    }
    filas = [_contratacion(registro, mujeres, cno) for registro in _items(TABLA_CONTRATACION, periodo)]
    guardar_jsonl(CONTRATACION, sorted(filas, key=lambda fila: fila["cno11"]))
    return filas


def _por_codigo(ruta: Path) -> dict[str, dict[str, Any]]:
    """Filas preparadas de un archivo, por código CNO-11.

    Returns:
        Cada fila del archivo, por su código CNO-11.
    """
    return {fila["cno11"]: fila for fila in leer_jsonl(ruta)}


def _campos(fila: dict[str, Any], campos: tuple[str, ...]) -> dict[str, Any]:
    """Solo los campos indicados de una fila.

    Returns:
        Un diccionario con esos campos, en el orden de `campos`.
    """
    return {campo: fila[campo] for campo in campos}


def _que_constan(por_codigo: dict[str, Any]) -> dict[str, Any]:
    """Las filas de un nivel del censo sin la de «No consta».

    Returns:
        Un diccionario con las filas cuyo código consta.
    """
    return {codigo: fila for codigo, fila in por_codigo.items() if codigo != CODIGO_NO_CONSTA}


def _sumar_valores(por_codigo: dict[str, Any]) -> dict[str, float]:
    """Las personas de cada valor de la variable (sexo o grupo de edad), sumadas en todos los grupos con código.

    Returns:
        Por valor de la variable, las personas de todos los grupos con código.
    """
    total: Counter[str] = Counter()
    for por_valor in _que_constan(por_codigo).values():
        total.update(por_valor)
    return dict(total)


def _mes_con_guion(c_mes: str) -> str:
    """El mes de la sonda del Observatori (AAAAMM) como AAAA-MM, la forma en que se compara con el archivado.

    Args:
        c_mes: El mes con seis cifras («202606»).

    Returns:
        El mes con guion («2026-06»).
    """
    return f"{c_mes[:4]}-{c_mes[4:]}"


def _cobertura(censo3: dict[str, Any], censo2: dict[str, Any], contratacion: dict[str, Any]) -> dict[str, int]:
    """Grupos con datos del censo (sin «no consta») y ocupaciones con contratación, con y sin variación publicable.

    Returns:
        Los recuentos de grupos del censo a 3 y 2 cifras y de ocupaciones con contratación y sin variación.
    """
    return {
        "censo_cno3": len(_que_constan(censo3)),
        "censo_cno2": len(_que_constan(censo2)),
        "contratacion_cno4": len(contratacion),
        "contratacion_sin_variacion": sum(fila["variacion_pct"] is None for fila in contratacion.values()),
    }


def _conjunto_validado(
    censo3: dict[str, Any], censo2: dict[str, Any], contratacion: dict[str, Any], contexto: dict[str, Any]
) -> dict[str, Any]:
    """Versión para el motor: cifras del censo a 3 y 2 cifras y contratación a 4 cifras.

    Returns:
        El conjunto que exporta el paquete (cataluna.json), con sus fuentes y su periodo.
    """
    return {
        "fuentes": fuentes(),
        "periodo_contratacion": contexto["periodo"],
        "min_variacion": MIN_VARIACION,
        "variacion_conjunto_ocupaciones": contexto["variacion_conjunto_ocupaciones"],
        "ocupados_cno3": {codigo: _campos(fila, CAMPOS_CENSO) for codigo, fila in _que_constan(censo3).items()},
        "ocupados_cno2": {codigo: _campos(fila, CAMPOS_CENSO) for codigo, fila in _que_constan(censo2).items()},
        "contratacion_cno4": {codigo: _campos(fila, CAMPOS_CONTRATACION) for codigo, fila in contratacion.items()},
    }


# Funciones públicas


def periodo_archivado() -> str:
    """El mes final (AAAA-MM) de la copia más reciente del Observatori que consta en la procedencia.

    Returns:
        El mes AAAA-MM de la copia más reciente.
    """
    nombres = [entrada["archivo"] for entrada in entradas_procedencia(procedencia(FUENTE))]
    periodos = [
        coincidencia.group(1) for coincidencia in map(_COPIA_DEL_OBSERVATORI.fullmatch, nombres) if coincidencia
    ]
    exigir(bool(periodos), f"{FUENTE}: ninguna copia del Observatori en su procedencia", ArchivoFaltante)
    exigir(
        all(1 <= int(periodo[5:]) <= len(MESES) for periodo in periodos),
        f"{FUENTE}: mes inesperado en las copias del Observatori: {periodos}",
    )
    return max(periodos)


def archivo_del_observatori(tabla: str) -> str:
    """Nombre de la copia vigente de un fichero del Observatori.

    Returns:
        El nombre del archivo de la copia vigente de esa tabla (observatori-<tabla>-<AAAA-MM>.json).
    """
    return OBSERVATORI.format(tabla, periodo_archivado())


def periodo_en_castellano(periodo: str) -> str:
    """El periodo del Observatori («juny de 2026») como lo dice el informe: «12 meses a junio de 2026».

    Returns:
        El rótulo «12 meses a <mes> de <año>».
    """
    mes, _, anio = periodo.partition(" de ")
    exigir(mes in MESES and anio.isdigit(), f"periodo del Observatori desconocido: «{periodo}»")
    return f"12 meses a {MESES[mes]} de {anio}"


def fuentes() -> dict[str, str]:
    """Las citas del censo y del Observatori; la del Observatori, con el periodo de su fichero y su actualización.

    Returns:
        Las citas por fuente («censo», «observatori»).
    """
    periodo = periodo_archivado()
    total = _items(TABLA_TOTALES, periodo)[0]
    nombre = OBSERVATORI.format(TABLA_CONTRATACION, periodo)
    entrada = next(
        (entrada for entrada in entradas_procedencia(procedencia(FUENTE)) if entrada["archivo"] == nombre), None
    )
    exigir(entrada is not None, f"{FUENTE}: {nombre} no consta en la procedencia", ArchivoFaltante)
    actualizacion = re.search(PATRON_ACTUALIZACION, entrada.get("version", ""))
    if actualizacion is None:
        exigir(
            entrada.get("version") == f"Dades a {total['d_periode']}", f"{nombre}: versión del Observatori desconocida"
        )
        cita = CITA_OBSERVATORI_SIN_FECHA.format(periodo=total["d_periode"])
    else:
        cita = CITA_OBSERVATORI.format(periodo=total["d_periode"], actualizacion=actualizacion.group(1))
    return {
        "censo": CITA_CENSO,
        "observatori": cita,
    }


def edad_de(grupo: str) -> int:
    """Edad inicial de un grupo de edad del censo, tal como lo nombra la API: «30-34», «65 y más».

    Args:
        grupo: El nombre del grupo, que empieza por su edad inicial.

    Returns:
        La edad inicial, en años.

    Raises:
        FormatoInesperado: Si el nombre no empieza por una cifra.
    """
    inicial = re.match(r"\d+", grupo)
    exigir(inicial is not None, f"grupo de edad del censo desconocido: «{grupo}»")
    return int(inicial.group())


def resumen_censo(sexo: dict[str, Any], edad: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Ocupados, % de mujeres, % de menores de 30 y % de 55 o más por código de ocupación.

    Returns:
        Por código, las personas ocupadas y los porcentajes de mujeres, de menores de 30 y de 55 o más.
    """
    filas: dict[str, dict[str, Any]] = {}
    for codigo, por_sexo in sexo.items():
        total = por_sexo.get(HOMBRE_CENSO, 0) + por_sexo.get(MUJER_CENSO, 0)
        por_edad = edad.get(codigo, {})
        total_edad = sum(por_edad.values())
        jovenes = sum(personas for grupo, personas in por_edad.items() if edad_de(grupo) < EDAD_JOVEN)
        mayores = sum(personas for grupo, personas in por_edad.items() if edad_de(grupo) >= EDAD_MAYOR)
        filas[codigo] = {
            "ocupados": round(total),
            "pct_mujeres": pct(por_sexo.get(MUJER_CENSO, 0), total),
            "pct_menores_30": pct(jovenes, total_edad),
            "pct_55_o_mas": pct(mayores, total_edad),
        }
    return filas


def conjunto_de_cataluna(sexo: dict[str, Any], edad: dict[str, Any]) -> dict[str, Any]:
    """Ocupados y porcentajes de todas las ocupaciones juntas, sumando las personas de cada grupo (sin «No consta»).

    El INE no publica el total por separado en estas consultas: se suman las cifras de cada grupo antes de dividir,
    no las medias de los grupos, para que cada persona pese lo mismo.

    Returns:
        Las personas ocupadas y los tres porcentajes del conjunto de Cataluña.
    """
    return resumen_censo({TOTAL_OCUPACIONES: _sumar_valores(sexo)}, {TOTAL_OCUPACIONES: _sumar_valores(edad)})[
        TOTAL_OCUPACIONES
    ]


def archivos(periodo: str) -> list[ArchivoDescargable]:
    """Declara las tres tablas vigentes; los cuatro censos de 2021 son referencias locales fijas.

    Returns:
        Los recursos oficiales que se consultan en esta actualización.
    """
    return [
        {
            "archivo": OBSERVATORI.format(tabla, periodo),
            "nivel": "oficial",
            "titulo": f"Observatori del Treball, {tabla}: datos a {periodo}",
            "url": f"{VISOR}/{tabla}.json",
            "licencia": LICENCIA_OBSERVATORI,
        }
        for tabla in TABLAS
    ]


def descargar(aceptar_cambio: bool = False) -> None:
    """Captura las tres tablas de un periodo coherente y comprueba íntegro el censo histórico local."""
    comprobar_originales(FUENTE)
    documento = procedencia(FUENTE)
    previos = {entrada["archivo"]: entrada for entrada in entradas_procedencia(documento)}
    exigir(len(previos) == len(entradas_procedencia(documento)), f"{FUENTE}: archivos duplicados en procedencia")
    exigir(set(CENSOS_FIJOS) <= previos.keys(), f"{FUENTE}: faltan referencias fijas del censo 2021")
    archivado, periodo = periodo_archivado(), None
    registros, codigos = [], {}
    for tabla in TABLAS:
        url = f"{VISOR}/{tabla}.json"
        descarga = descargar_url(url)
        filas = filas_capturadas(descarga.datos, tabla)
        mes = _mes_con_guion(str(filas[0]["c_mes"]))
        periodo = mes if periodo is None else periodo
        exigir(
            mes == periodo and mes >= archivado,
            f"{tabla}: periodo {mes}, se esperaba {periodo} sin retroceder de {archivado}",
        )
        archivo = next(archivo for archivo in archivos(periodo) if archivo["url"] == url)
        previo = previos.get(archivo["archivo"])
        regla = ReglaDeCambio(huella_registrada=previo["sha256"] if previo else None, aceptar_cambio=aceptar_cambio)
        datos = conservar_o_sustituir(ORIGINAL / archivo["archivo"], descarga, regla)
        observar_original(url, descarga, datos)
        registro = (
            {**previo, "bytes": len(datos), "url_final": descarga.url_final, "content_type": descarga.content_type}
            if previo and previo["sha256"] == sha256_bytes(datos)
            else registro_descarga(archivo, descarga, datos, None, version=f"Dades a {filas[0]['d_periode']}")
        )
        registros.append(registro)
        codigos[tabla] = {fila.get("c_grup_primari") for fila in filas}
    exigir(codigos[TABLA_CONTRATACION] <= codigos[TABLA_MUJERES], f"{FUENTE}: faltan ocupaciones en la tabla por sexo")
    revisada = any(previos.get(entrada["archivo"], {}).get("sha256") != entrada["sha256"] for entrada in registros)
    if revisada:
        registros = [{**entrada, "version": f"Dades a {filas[0]['d_periode']}"} for entrada in registros]
        documento = {
            **documento,
            "cita": f"{CITA_CENSO} {CITA_OBSERVATORI_SIN_FECHA.format(periodo=filas[0]['d_periode'])}",
        }
    guardar_json(
        ORIGINAL / "procedencia.json",
        {
            **documento,
            "archivos": [entrada for nombre, entrada in previos.items() if nombre in CENSOS_FIJOS] + registros,
        },
    )


def preparar() -> None:
    """Resume el censo a 3 y 2 cifras y la contratación a 4 cifras, y guarda el contexto de Cataluña."""
    cno = leer_validado("clasificaciones")["cno11"]
    # Censo: 3 cifras y, para los grupos que el INE no publica a 3 cifras (591–599, fuerzas armadas), 2 cifras.
    censo3, _ = _preparar_censo("3", OCUPACION["3"], cno)
    censo2, conjunto_censo = _preparar_censo("2", OCUPACION["2"], cno)
    periodo = periodo_archivado()
    filas = _preparar_contratacion(cno, periodo)
    conjunto = _variacion_conjunto(filas)
    total = _items(TABLA_TOTALES, periodo)[0]
    guardar_json(
        CONTEXTO,
        {
            "periodo": periodo_en_castellano(total["d_periode"]),
            "mes": total["c_mes"],
            "variacion_conjunto_ocupaciones": conjunto,
            "personas_contratadas_total": total["eo_per_cont_com_anual"],
            "contratos_total": total["eo_cont_sum_12m"],
            "ocupados_censo_total": round(sum(fila["ocupados"] for fila in censo2.values())),
            "conjunto_censo": conjunto_censo,
        },
    )
    print(
        f"Censo: {len(censo3)} grupos de 3 cifras y {len(censo2)} de 2 · Observatori: {len(filas)} ocupaciones · "
        f"variación del conjunto {conjunto} %"
    )


def validar() -> None:
    """Comprueba códigos, totales y porcentajes, contrasta con la Cambra y guarda la validación y el conjunto."""
    cno = leer_validado("clasificaciones")["cno11"]
    cambra = leer_validado("cambra")
    censo3 = _por_codigo(CENSO["3"])
    censo2 = _por_codigo(CENSO["2"])
    contratacion = _por_codigo(CONTRATACION)
    contexto = leer_json(CONTEXTO)
    archivos = entradas_procedencia(procedencia(FUENTE))
    controles = Controles()
    controles.comprobar(
        all(conserva_su_huella(ORIGINAL, archivo) for archivo in archivos), f"huella de los {len(archivos)} originales"
    )
    controles_censo(controles, censo3, censo2, cno)
    controles_conjunto_censo(controles, censo2, contexto)
    controles_contraste_censo(controles, censo3, cambra)
    controles_observatori(controles, contratacion, cno, contexto)
    controles_totales_observatori(controles, contratacion, contexto)
    contraste_aplicable = controles_contraste_contratacion(controles, contratacion, cambra, contexto)
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": _cobertura(censo3, censo2, contratacion),
        "limites": "Datos del grupo de ocupación, no de personas. El censo es de 2021. La contratación mide "
        "personas contratadas en 12 meses, no personas ocupadas; su variación no permite atribuir causas a la IA. "
        "Las rutas del Observatori no son una API documentada.",
        "controles": controles.lista,
    }
    if not contraste_aplicable:
        informe["contraste_taula13"] = (
            "No aplicable: septiembre de 2025 queda fuera del intervalo entre los dos años de contratación de esta "
            "copia; se comprueban códigos, cobertura, totales, porcentajes y bases de la captura vigente."
        )
    cerrar_validacion(FUENTE, informe, controles, lambda: _conjunto_validado(censo3, censo2, contratacion, contexto))


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida de la orden: 0 si cada etapa termina bien.
    """
    etapas = {"preparar": preparar, "validar": validar}
    return principal_fuente_con_descarga(__doc__, descargar, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
