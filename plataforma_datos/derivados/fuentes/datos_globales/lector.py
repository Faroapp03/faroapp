"""Datos globales («Faro en el mundo»): el archivo `datos-globales.json` que leen el panel de comparación y el globo.

No descarga nada: compone, con la forma del contrato común (versión 1), lo que ya validaron otras fuentes:

- `mundo-eurostat`: empresas que usan IA (serie desde 2021), personas que usan IA generativa y personas de 25 a 64
  años en formación (serie desde 2021), por país europeo, en la UE-27 y, la formación, en Cataluña (ES51);
- `empresas`: las empresas que usan IA en Cataluña (Eurostat, región ES51), la misma medida que la de los países;
- `tic-llars`: la IA generativa en Cataluña (Idescat, a partir de la TIC-H del INE), en la base de los usuarios de
  internet, la misma que `PC_IND_IU3` de Eurostat (los indicadores «-usuarios-internet»);
- `clima-empresarial`: los establecimientos de Cataluña que usan IA, quién la usa y si valoran las competencias
  digitales al contratar (Idescat); solo Cataluña, cobertura «cataluna», nunca comparados con Europa;
- `ue-eurostat`: la UE-27 en conjunto (Parte II): empresas que usan IA por tamaño, tecnología, uso y motivo, IA
  generativa por finalidad, edad y estudios, capacidades digitales, especialistas en TIC y formación en TIC;
- `decada-digital`: las metas para 2030 de la Decisión (UE) 2022/2481 (artículo 4) que mide un indicador del
  archivo, con su texto literal, en el bloque `metas`; el número de especialistas en TIC va en `recuentos`;
- `eurobarometro`: opinión (Eurobarómetro especial 554, QB5, QB6.1–QB6.3, QB11.1–QB11.5 y QB3), en el bloque
  `encuestas` con «opinion»;
- `ceo-panel`: opinión de Cataluña (CEO, Panel Ciutadà 2025, pregunta 26: de 7 a 10 en la probabilidad de que las
  máquinas o la IA sustituyan a las personas en la mayoría de los trabajos), en `encuestas`, solo de Cataluña;
- `ilostat`: el peso de cada gran grupo ISCO-08 en el empleo y la parte de mujeres en él, en cada país con encuesta;
- `ia-nacional`: el uso de la IA por las empresas medido por una estadística oficial nacional fuera de la UE (hoy, EE.
  UU., Canadá y Australia), cada país con su indicador y su definición, sin comparar; Islandia, el Reino Unido, Brasil,
  Suiza e Israel, igual, cada uno en su propio módulo (`ia-nacional-<iso3>`); y, aparte, el uso de la IA generativa
  por las personas de Corea del Sur (`ia-nacional-kor`, indicador `personas-ia-nacional-kor`);
- `encuestas-isco4`: la exposición a la IA generativa CALCULADA con microdatos de encuestas oficiales de empleo (hoy,
  Brasil, Chile, Colombia y Uruguay), con los gradientes de la OIT (WP140), en el bloque `calculados` con «calculado»
  (`catalogo_calculado.py`): cada cifra con su intervalo del 95 % y su método, o sus cotas, y su encuesta y su cita;
- `territorios`: el código ISO 3166-1 alfa-3 y el nombre en castellano y en catalán de cada país;
- `clasificaciones` e `idescat`: el nombre oficial de cada gran grupo en las dos lenguas (en catalán, el de la
  CIUO-2008 (ca), salvo el del gran grupo 9, que es el de la CCO-2011 (ca): `GRUPOS_CON_NOMBRE_DE_LA_CCO`).

Cada cifra lleva su año y, si su fuente la marca, su nota; cada indicador dice si es medido o estimado, su fuente, su
licencia y si se compara entre territorios. Solo territorios: ninguna cifra describe a una persona. La fecha
`generado` es la de la consulta más reciente de las fuentes que se vuelven a consultar en cada actualización
(mundo-eurostat, ue-eurostat, ilostat, las medidas nacionales, tic-llars y clima-empresarial), no la del día en que se
compone,
para que las mismas entradas den siempre los mismos bytes. Python estándar.

Uso: python3 -m plataforma_datos.derivados.fuentes.datos_globales.lector {descargar,preparar,validar,todo}
"""

import sys
from datetime import date
from typing import Any, cast

import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional.lector as ia_nacional
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_bra.lector as ia_nacional_bra
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_che.lector as ia_nacional_che
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_gbr.lector as ia_nacional_gbr
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isl.lector as ia_nacional_isl
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isr.lector as ia_nacional_isr
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_kor.lector as ia_nacional_kor
from plataforma_datos.comun.entrada_salida import ahora_utc, carpetas, guardar_json, leer_json
from plataforma_datos.comun.fuentes.territorios.lector import iso2_de_eurostat
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado, exigir
from plataforma_datos.derivados.fuentes.datos_globales.piezas.catalogo_calculado import (
    ENCUESTAS as ENCUESTAS_CALCULADAS,
)
from plataforma_datos.derivados.fuentes.datos_globales.piezas.catalogo_calculado import calculados
from plataforma_datos.derivados.fuentes.datos_globales.piezas.catalogo_ue import (
    ANIO_DE_LAS_METAS,
    ENCUESTAS,
    INDICADORES_UE,
    METAS,
    NORMA_DE_LAS_METAS,
    RECUENTO_ESPECIALISTAS_TIC,
    para_el_contrato,
)
from plataforma_datos.derivados.fuentes.datos_globales.piezas.constantes_datos_globales import (
    AGREGADO,
    CATALUNA,
    COBERTURA_CATALUNA,
    COBERTURA_UE,
    ENCUESTA_DEL_CEO,
    GRANDES_GRUPOS,
    INDICADORES_DE_CATALUNA,
    INDICADORES_EUROSTAT,
    MARCAS_SIN_NOTA,
    NATURALEZA_OPINION,
    NOTA_DE_LA_MARCA,
    NOTA_POCO_FIABLE,
    PAIS,
    REGION,
    UE27,
    UNIDAD_DEL_RECUENTO,
    UNIDAD_PORCENTAJE,
    VERSION_DEL_CONTRATO,
    indicador_de_empleo,
    indicador_de_mujeres,
    nota_de_la_marca,
)
from plataforma_datos.derivados.fuentes.datos_globales.piezas.contrato_datos_globales import problemas_del_contrato
from plataforma_datos.ia_y_trabajo.fuentes.eurobarometro.lector import CAMPO_LEGIBLE, FUENTE_LEGIBLE
from plataforma_datos.orquestacion.admision import cerrar_validacion, exigir_admitido, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente

FUENTE = "datos-globales"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
# Lo que escribe preparar y valida validar: el archivo entero, con la forma del contrato.
COMPUESTO = PREPARADO / f"{FUENTE}.json"
# La medida de Cataluña que es la misma que la de los países: todas las actividades de la encuesta, sin el sector
# financiero (`isoc_r_eb_ain2`, el agregado de `isoc_eb_ai`).
ACTIVIDADES_DE_LA_ENCUESTA = "C10-S951_X_K"
_TEXTO, _TABLA, _ENTERO, _CIFRA = str, dict, int, (int, float)
# Las medidas nacionales fuera de la UE: cada fuente con los indicadores de sus países; cada país, en una sola fuente.
MEDIDAS_NACIONALES: dict[str, dict[str, dict[str, object]]] = {
    "ia-nacional": ia_nacional.INDICADORES_NACIONALES,
    "ia-nacional-isl": ia_nacional_isl.INDICADORES_NACIONALES,
    "ia-nacional-gbr": ia_nacional_gbr.INDICADORES_NACIONALES,
    "ia-nacional-bra": ia_nacional_bra.INDICADORES_NACIONALES,
    "ia-nacional-che": ia_nacional_che.INDICADORES_NACIONALES,
    "ia-nacional-isr": ia_nacional_isr.INDICADORES_NACIONALES,
    "ia-nacional-kor": ia_nacional_kor.INDICADORES_NACIONALES,
}
INDICADOR_NACIONAL = {iso3: fila for filas in MEDIDAS_NACIONALES.values() for iso3, fila in filas.items()}
# Las fuentes que se vuelven a consultar en cada actualización: la fecha `generado` es la más reciente de sus consultas.
RECONSULTADAS = ("mundo-eurostat", "ue-eurostat", "ilostat", *MEDIDAS_NACIONALES, "tic-llars", "clima-empresarial")
# El contrato entre cada fuente y la composición: lo que se lee de su conjunto validado (ruta de claves fijas) y de qué
# tipo es. Un conjunto que no lo trae se detiene al leerlo, diciendo la fuente y la ruta, no con un KeyError después.
FORMA_DE_LAS_ENTRADAS: dict[str, tuple[tuple[tuple[str, ...], type | tuple[type, ...]], ...]] = {
    "mundo-eurostat": ((("cifras",), _TABLA), (("consultado",), _TEXTO)),
    "ue-eurostat": ((("cifras",), _TABLA), (("recuentos",), _TABLA), (("consultado",), _TEXTO)),
    "decada-digital": ((("url",), _TEXTO),),
    "eurobarometro": ((("preguntas",), _TABLA), (("licencia",), _TEXTO), (("url",), _TEXTO), (("anio",), _ENTERO)),
    "ceo-panel": (
        *(((campo,), _TEXTO) for campo in ("pregunta", "respuesta", "base", "campo", "fuente", "tabla", "licencia")),
        (("url",), _TEXTO),
        (("cifra",), _CIFRA),
        (("anio",), _ENTERO),
    ),
    "empresas": ((("cataluna_por_seccion", "actividades", ACTIVIDADES_DE_LA_ENCUESTA, "por_anio"), _TABLA),),
    "tic-llars": ((("cifras",), _TABLA), (("consultado",), _TEXTO)),
    "clima-empresarial": ((("cifras",), _TABLA), (("consultado",), _TEXTO)),
    "ilostat": ((("paises",), _TABLA), (("consultado",), _TEXTO)),
    **dict.fromkeys(MEDIDAS_NACIONALES, ((("paises",), _TABLA), (("consultado",), _TEXTO))),
    "encuestas-isco4": tuple(((iso3,), _TABLA) for iso3 in ENCUESTAS_CALCULADAS),
    "territorios": ((("paises",), _TABLA),),
    "clasificaciones": ((("isco08_es",), _TABLA),),
    "idescat": ((("isco08_ca",), _TABLA), (("cno11_ca",), _TABLA)),
}
# Los grandes grupos que se nombran en catalán como en la CCO-2011 (ca), la clasificación catalana de ocupaciones
# vigente (Decret 27/2012), y no como en la CIUO-2008 (ca). El 9 es «Ocupacions elementals» en la CCO-2011, el nombre
# de la ISCO-08 («Elementary occupations») y el del castellano («Ocupaciones elementales»); la CIUO-2008 (ca) lo titula
# «Treballadors no qualificats». Los dos son nombres oficiales del Idescat, literales.
GRUPOS_CON_NOMBRE_DE_LA_CCO = ("9",)
ENTRADAS = tuple(FORMA_DE_LAS_ENTRADAS)
NOMBRE_DE_CATALUNA = {"es": "Cataluña", "ca": "Catalunya"}
# Lo que el panel compara y el globo pinta, por su código: tiene que estar.
IMPRESCINDIBLES = {
    "empresas-ia": (CATALUNA, UE27, "ESP", "DEU", "FRA", "ITA"),
    "formacion-adultos": (CATALUNA, UE27, "ESP", "DEU", "FRA", "ITA"),
    "personas-ia-generativa-usuarios-internet": (CATALUNA, UE27, "ESP", "DEU", "FRA", "ITA"),
    "establecimientos-ia-personal-cualificado": (CATALUNA,),
    "personas-ia-generativa": (UE27, "ESP", "DEU", "FRA", "ITA"),
    "empleo-isco-4": ("ESP", "DEU", "FRA", "ITA", "USA"),
    "mujeres-isco-4": ("ESP", "DEU", "FRA", "ITA", "USA"),
}


# ---------------------------------------------------------------------------------------------------------------------
# Componer
# ---------------------------------------------------------------------------------------------------------------------


def _campo[T](conjunto: object, fuente: str, ruta: tuple[str, ...], tipo: type[T] | tuple[type[T], ...]) -> T:
    """Lee un campo requerido con el tipo esperado y diagnostica su fuente y ruta.

    Returns:
        El valor presente, sin convertirlo ni modificarlo.
    """
    valor = conjunto
    for clave in ruta:
        valor = valor.get(clave) if isinstance(valor, dict) else None
    exigir(
        isinstance(valor, tipo) and not isinstance(valor, bool),
        f"datos globales: «{fuente}» no trae {' → '.join(ruta)} ({_tipo_de(tipo)})",
    )
    return cast(T, valor)


def _ordenar_por_catalogo(valores: list[dict[str, Any]], orden: list[str], fuente: str) -> None:
    """Ordena por el catálogo solo después de comprobar que cada indicador tiene posición."""
    posicion = {id_: indice for indice, id_ in enumerate(orden)}
    for valor in valores:
        indicador = _campo(valor, fuente, ("indicador",), str)
        exigir(indicador in posicion, f"datos globales: «{fuente}» indicador fuera del catálogo: {indicador!r}")
    valores.sort(key=lambda valor: posicion[valor["indicador"]])


def _fecha_de_consulta(fuente: str, conjunto: dict[str, Any]) -> date:
    """Lee la fecha de consulta con el calendario habitual y el contexto de su fuente.

    Returns:
        La fecha de consulta, sin imponer otro formato que date.fromisoformat.

    Raises:
        FormatoInesperado: Si la fecha no se puede interpretar o no existe.
    """
    texto = _campo(conjunto, fuente, ("consultado",), str)
    try:
        return date.fromisoformat(texto)
    except ValueError as error:
        raise FormatoInesperado(f"datos globales: «{fuente}» consultado: fecha inválida {texto!r}") from error


def _valor(indicador: str, cifra: dict[str, Any]) -> dict[str, Any]:
    """Un valor del contrato: indicador, cifra, año y nota.

    Returns:
        El valor con sus cuatro campos, en el orden del contrato.
    """
    return {"indicador": indicador, "valor": cifra["valor"], "anio": cifra["anio"], "nota": cifra["nota"]}


def indicadores(clasificaciones: dict[str, Any], idescat: dict[str, Any]) -> list[dict[str, Any]]:
    """El catálogo: Eurostat, por gran grupo el empleo y la parte de mujeres (ILOSTAT) y los de solo Cataluña.

    Returns:
        Los indicadores del catálogo, en el orden en que se muestran.
    """
    catalan = {
        grupo: _campo(
            idescat, "idescat", ("cno11_ca" if grupo in GRUPOS_CON_NOMBRE_DE_LA_CCO else "isco08_ca", grupo), str
        )
        for grupo in GRANDES_GRUPOS
    }
    nombres = {
        grupo: (_campo(clasificaciones, "clasificaciones", ("isco08_es", grupo), str), catalan[grupo])
        for grupo in GRANDES_GRUPOS
    }
    return [
        *INDICADORES_EUROSTAT,
        *(para_el_contrato(indicador) for indicador in INDICADORES_UE),
        *(indicador_de_empleo(grupo, *nombres[grupo]) for grupo in GRANDES_GRUPOS),
        *(indicador_de_mujeres(grupo, *nombres[grupo]) for grupo in GRANDES_GRUPOS),
        *INDICADORES_DE_CATALUNA,
        *INDICADOR_NACIONAL.values(),
    ]


def serie_de_empresas_de_cataluna(empresas: dict[str, Any]) -> list[dict[str, Any]]:
    """Las empresas de Cataluña que usan IA (Eurostat por región), los años que publica, el más reciente primero.

    Una cifra poco fiable va con su nota y no se da como firme; una sin cifra no entra. Una marca de Eurostat sin nota
    en NOTA_DE_LA_MARCA detiene la composición: la cifra no se da como firme sin saber qué marca.

    Returns:
        Un valor por año, del más reciente al más antiguo.
    """
    por_anio = empresas["cataluna_por_seccion"]["actividades"][ACTIVIDADES_DE_LA_ENCUESTA]["por_anio"]
    serie: list[dict[str, Any]] = []
    for anio in sorted(por_anio, key=int, reverse=True):
        cifra = por_anio[anio]
        poco_fiable = cifra["pct"] is None
        valor = cifra.get("pct_poco_fiable") if poco_fiable else cifra["pct"]
        if valor is not None:
            marca = cifra.get("marca") or ""
            exigir(
                all(letra in NOTA_DE_LA_MARCA or letra in MARCAS_SIN_NOTA for letra in marca),
                f"datos globales: la marca «{marca}» de Eurostat en Cataluña, {anio}, no tiene nota",
            )
            # La cifra de la columna de poco fiables lo es siempre, diga lo que diga su marca.
            nota = NOTA_POCO_FIABLE if poco_fiable else nota_de_la_marca(marca)
            serie.append(_valor("empresas-ia", {"valor": valor, "anio": int(anio), "nota": nota}))
    return serie


def cataluna(entradas: dict[str, Any], de_eurostat: list[dict[str, Any]], orden: list[str]) -> dict[str, Any]:
    """Cataluña: las empresas que usan IA (serie), lo que Eurostat da por región y el clima empresarial del Idescat.

    Returns:
        El territorio de Cataluña con sus valores en el orden del catálogo.
    """
    del_idescat = [
        _valor(indicador, cifra)
        for fuente in ("tic-llars", "clima-empresarial")
        for indicador, cifra in entradas[fuente]["cifras"].items()
    ]
    valores = [*serie_de_empresas_de_cataluna(entradas["empresas"]), *de_eurostat, *del_idescat]
    # Orden del catálogo; dentro de un indicador se conserva el de su serie (la cifra más reciente primero).
    _ordenar_por_catalogo(valores, orden, "Cataluña")
    return {"codigo": CATALUNA, "iso3": None, "tipo": REGION, "nombre": NOMBRE_DE_CATALUNA, "valores": valores}


def de_la_ue(de_mundo_eurostat: list[dict[str, Any]], ue: dict[str, Any], orden: list[str]) -> list[dict[str, Any]]:
    """La UE-27: lo de los países europeos y lo que solo se da de la UE (Parte II), en el orden del catálogo.

    Dentro de un indicador se conserva el orden de su serie (la cifra más reciente primero).

    Returns:
        Los valores de la UE-27, en el orden del catálogo.
    """
    valores = [
        *de_mundo_eurostat,
        *(_valor(indicador, cifra) for indicador, serie in ue["cifras"].items() for cifra in serie),
    ]
    _ordenar_por_catalogo(valores, orden, "ue-eurostat")
    return valores


def valores_por_territorio(
    eurostat: dict[str, Any], ilostat: dict[str, Any], nacional: dict[str, Any], iso3: dict[str, str]
) -> dict[str, list[dict[str, Any]]]:
    """Por código del contrato (ISO alfa-3, EU27_2020 o ES51), sus valores en el orden del catálogo.

    Una serie de Eurostat da varios valores del mismo indicador, el más reciente primero.

    Returns:
        Por código de territorio, sus valores en el orden del catálogo.
    """
    valores: dict[str, list[dict[str, Any]]] = {}
    for indicador in (fila["id"] for fila in INDICADORES_EUROSTAT):
        for geo in sorted(_campo(eurostat, "mundo-eurostat", ("cifras", indicador), dict)):
            serie = _campo(eurostat, "mundo-eurostat", ("cifras", indicador, geo), list)
            codigo = (
                geo
                if geo in (UE27, CATALUNA)
                else _campo(iso3, f"mundo-eurostat, territorio {geo}", (iso2_de_eurostat(geo),), str)
            )
            valores.setdefault(codigo, []).extend(_valor(indicador, cifra) for cifra in serie)
    for parte, prefijo in (("empleo", "empleo-isco"), ("mujeres", "mujeres-isco")):
        for codigo in sorted(ilostat["paises"]):
            por_grupo = _campo(ilostat, "ilostat", ("paises", codigo, parte), dict)
            for grupo in GRANDES_GRUPOS:
                if grupo in por_grupo:
                    cifra = {
                        **_campo(ilostat, "ilostat", ("paises", codigo, parte, grupo), dict),
                        "anio": _campo(ilostat, "ilostat", ("paises", codigo, "anio"), int),
                    }
                    valores.setdefault(codigo, []).append(_valor(f"{prefijo}-{grupo}", cifra))
    # Las medidas nacionales fuera de la UE, cada una con su indicador y en su país (no se comparan).
    for codigo, cifra in sorted(nacional["paises"].items()):
        indicador = INDICADOR_NACIONAL[codigo]["id"]
        valores.setdefault(codigo, []).append(_valor(str(indicador), {"nota": None, **cifra}))
    return valores


def recuentos(ue: dict[str, Any]) -> list[dict[str, Any]]:
    """Las cifras que no son un porcentaje (especialistas en TIC, miles de personas), con sus valores de la UE-27.

    Returns:
        Los recuentos con sus valores de la UE-27.
    """
    return [
        {
            **para_el_contrato(RECUENTO_ESPECIALISTAS_TIC, UNIDAD_DEL_RECUENTO),
            "valores": [
                {"territorio": UE27, "valor": cifra["valor"], "anio": cifra["anio"], "nota": cifra["nota"]}
                for cifra in ue["recuentos"][RECUENTO_ESPECIALISTAS_TIC.id]
            ],
        }
    ]


def metas(decada_digital: dict[str, Any]) -> list[dict[str, Any]]:
    """Las metas de la Década Digital que mide un indicador o un recuento del archivo, con su texto literal.

    Returns:
        Las metas con su texto literal, su valor y el indicador que las mide.
    """
    return [
        {
            "id": meta.id,
            "nombre": {"es": meta.nombre[0], "ca": meta.nombre[1]},
            "norma": NORMA_DE_LAS_METAS,
            "articulo": meta.articulo,
            "texto": meta.texto,
            "valor": meta.valor,
            "unidad": meta.unidad,
            "anio": ANIO_DE_LAS_METAS,
            "indicador": meta.indicador,
            "nota": None if meta.nota is None else {"es": meta.nota[0], "ca": meta.nota[1]},
            "url": decada_digital["url"],
        }
        for meta in METAS
    ]


def encuestas(eurobarometro: dict[str, Any]) -> list[dict[str, Any]]:
    """Las preguntas de opinión, cada una con su id, su texto literal y sus porcentajes enteros: nunca una medida.

    Returns:
        Las encuestas de opinión con sus porcentajes por territorio.
    """
    return [
        {
            "id": encuesta.id,
            "nombre": {"es": encuesta.nombre[0], "ca": encuesta.nombre[1]},
            "definicion": {"es": encuesta.definicion[0], "ca": encuesta.definicion[1]},
            "pregunta": eurobarometro["preguntas"][hoja]["pregunta"],
            "respuesta": eurobarometro["preguntas"][hoja]["respuesta"],
            "base": eurobarometro["preguntas"][hoja]["base"],
            "campo": CAMPO_LEGIBLE,
            "unidad": UNIDAD_PORCENTAJE,
            "naturaleza": NATURALEZA_OPINION,
            "fuente": FUENTE_LEGIBLE,
            "tabla": f"Volumen A, {hoja}",
            "licencia": eurobarometro["licencia"],
            "url": eurobarometro["url"],
            "comparable": True,
            "cobertura": COBERTURA_UE,
            "valores": [
                {"territorio": codigo, "valor": cifra, "anio": eurobarometro["anio"], "nota": None}
                for codigo, cifra in eurobarometro["preguntas"][hoja]["cifras"].items()
            ],
        }
        for hoja, encuesta in ENCUESTAS.items()
    ]


def encuesta_del_ceo(ceo: dict[str, Any]) -> dict[str, Any]:
    """La pregunta de opinión de Cataluña (CEO), con su texto literal, su escala, su base y su campo: sin comparar.

    Returns:
        La pregunta de Cataluña con su texto, su escala, su base y su campo.
    """
    id_, nombre, definicion = ENCUESTA_DEL_CEO
    return {
        "id": id_,
        "nombre": {"es": nombre[0], "ca": nombre[1]},
        "definicion": {"es": definicion[0], "ca": definicion[1]},
        **{campo: ceo[campo] for campo in ("pregunta", "respuesta", "base", "campo")},
        "unidad": UNIDAD_PORCENTAJE,
        "naturaleza": NATURALEZA_OPINION,
        **{campo: ceo[campo] for campo in ("fuente", "tabla", "licencia", "url")},
        "comparable": False,
        "cobertura": COBERTURA_CATALUNA,
        "valores": [{"territorio": CATALUNA, "valor": ceo["cifra"], "anio": ceo["anio"], "nota": None}],
    }


def medidas_nacionales(entradas: dict[str, Any]) -> dict[str, Any]:
    """Las cifras de todas las medidas nacionales juntas, `{paises: {iso3: cifra}}`; cada país, de su fuente.

    Returns:
        `{"paises": {iso3: cifra}}` con la cifra de cada país.
    """
    paises: dict[str, Any] = {}
    for fuente, filas in MEDIDAS_NACIONALES.items():
        de_esta = entradas[fuente]["paises"]
        exigir(
            sorted(de_esta) == sorted(filas), f"datos globales: «{fuente}» trae {sorted(de_esta)}, no {sorted(filas)}"
        )
        paises.update(de_esta)
    return {"paises": paises}


def componer(entradas: dict[str, Any]) -> dict[str, Any]:
    """El archivo entero del contrato a partir de los conjuntos validados de sus fuentes.

    Returns:
        El contenido del archivo del contrato, listo para guardar.
    """
    paises = entradas["territorios"]["paises"]
    iso3 = {codigo: pais["iso3"] for codigo, pais in paises.items()}
    por_iso3 = {pais["iso3"]: pais for pais in paises.values()}
    nacionales = medidas_nacionales(entradas)
    valores = valores_por_territorio(entradas["mundo-eurostat"], entradas["ilostat"], nacionales, iso3)
    catalogo = indicadores(entradas["clasificaciones"], entradas["idescat"])
    orden = [indicador["id"] for indicador in catalogo]
    region = cataluna(entradas, valores.get(CATALUNA, []), orden)
    union_europea = {
        "codigo": UE27,
        "iso3": None,
        "tipo": AGREGADO,
        "nombre": {"es": "Unión Europea (27 países)", "ca": "Unió Europea (27 països)"},
        "valores": de_la_ue(valores.get(UE27, []), entradas["ue-eurostat"], orden),
    }
    territorios = [
        {
            "codigo": codigo,
            "iso3": codigo,
            "tipo": PAIS,
            "nombre": {"es": por_iso3[codigo]["es"], "ca": por_iso3[codigo]["ca"]},
            "valores": de_este,
        }
        for codigo, de_este in sorted(valores.items())
        if codigo not in (CATALUNA, UE27)
    ]
    # Las fechas se comparan como fechas: un texto con otro formato falla aquí en lugar de ordenarse como texto.
    generado = max(_fecha_de_consulta(fuente, entradas[fuente]) for fuente in RECONSULTADAS).isoformat()
    return {
        "version": VERSION_DEL_CONTRATO,
        "generado": generado,
        "indicadores": catalogo,
        "territorios": [region, union_europea, *territorios],
        "recuentos": recuentos(entradas["ue-eurostat"]),
        "metas": metas(entradas["decada-digital"]),
        "encuestas": [*encuestas(entradas["eurobarometro"]), encuesta_del_ceo(entradas["ceo-panel"])],
        "calculados": calculados(entradas["encuestas-isco4"], paises),
    }


def exigir_forma(fuente: str, conjunto: object) -> None:
    """Que el conjunto validado de una fuente traiga lo que lee la composición (FORMA_DE_LAS_ENTRADAS)."""
    for ruta, tipo in FORMA_DE_LAS_ENTRADAS[fuente]:
        _campo(conjunto, fuente, ruta, tipo)


def _tipo_de(tipo: type | tuple[type, ...]) -> str:
    """El nombre del tipo esperado, para el mensaje.

    Returns:
        El nombre del tipo, o los nombres unidos por «o» si se admite más de uno.
    """
    return " o ".join(clase.__name__ for clase in (tipo if isinstance(tipo, tuple) else (tipo,)))


def leer_entradas() -> dict[str, Any]:
    """Los conjuntos validados de las fuentes de las que sale el archivo, solo si están admitidas y con su forma.

    Returns:
        Por nombre de fuente, su conjunto validado.
    """
    entradas = {fuente: leer_validado(fuente) for fuente in ENTRADAS}
    for fuente, conjunto in entradas.items():
        exigir_forma(fuente, conjunto)
    return entradas


# ---------------------------------------------------------------------------------------------------------------------
# Etapas
# ---------------------------------------------------------------------------------------------------------------------


def descargar() -> None:
    """No hay originales: el archivo se compone con lo que validaron sus fuentes, que se comprueba aquí."""
    for fuente in ENTRADAS:
        exigir_admitido(fuente)
    print(f"{FUENTE}: no descarga nada; compone lo validado de {', '.join(ENTRADAS)}.")


def preparar() -> None:
    """Compone el archivo con la forma del contrato."""
    datos = componer(leer_entradas())
    guardar_json(COMPUESTO, datos)
    print(f"{len(datos['indicadores'])} indicadores y {len(datos['territorios'])} territorios")


def faltan_imprescindibles(datos: dict[str, Any]) -> dict[str, list[str]]:
    """Por indicador imprescindible, los territorios que no lo traen.

    Returns:
        Por indicador imprescindible, los códigos de los territorios sin él; vacío si no falta ninguno.
    """
    tienen: dict[str, set[str]] = {}
    for territorio in datos["territorios"]:
        for valor in territorio["valores"]:
            tienen.setdefault(valor["indicador"], set()).add(territorio["codigo"])
    faltan = {
        indicador: [codigo for codigo in codigos if codigo not in tienen.get(indicador, set())]
        for indicador, codigos in IMPRESCINDIBLES.items()
    }
    return {indicador: lista for indicador, lista in faltan.items() if lista}


def validar() -> None:
    """Comprueba la forma del contrato, que esté lo imprescindible y que salga igual de sus entradas."""
    datos = leer_json(COMPUESTO)
    controles = Controles()
    problemas = problemas_del_contrato(datos)
    controles.comprobar(
        not problemas, "forma del contrato de los datos globales" + (f": {problemas[:5]}" if problemas else "")
    )
    controles.exigir(FUENTE)
    faltan = faltan_imprescindibles(datos)
    controles.comprobar(
        not faltan, "están los territorios de la comparación" + (f"; faltan {faltan}" if faltan else "")
    )
    controles.comprobar(datos == componer(leer_entradas()), "el archivo es el que dan hoy sus fuentes validadas")
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {
            "indicadores": len(datos["indicadores"]),
            "territorios": len(datos["territorios"]),
            "valores": sum(len(territorio["valores"]) for territorio in datos["territorios"]),
        },
        "limites": "Solo cifras de territorios. Lo europeo (Eurostat) solo se compara entre países europeos; EE. UU. "
        "no hace la misma encuesta. La OIT no publica la exposición a la IA por país: la de Brasil, Chile, Colombia y "
        "Uruguay la calcula Faro con microdatos de sus encuestas («calculados»), sin comparar países. Nadie mide los "
        "trabajos reemplazados por la IA: no están. La IA generativa de Cataluña es la del Idescat, en la base de los "
        "usuarios de internet: se compara solo con los indicadores «-usuarios-internet» de Eurostat.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: datos)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar (comprueba las entradas), preparar, validar o todo.

    Returns:
        El código de salida de la orden: 0 si todo va bien.
    """
    return principal_fuente(__doc__, {"descargar": descargar, "preparar": preparar, "validar": validar}, argv)


if __name__ == "__main__":
    sys.exit(main())
