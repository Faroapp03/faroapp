"""La forma exacta de `datos-globales.json` (contrato, versión 1): qué claves lleva cada parte y qué valores admite.

El panel de comparación y el globo de la web leen el archivo sin volver a validarlo: lo que no cumple el contrato no
sale de la cadena. Las claves son exactamente las del contrato, ni una más (así no se cuela ningún dato que no se haya
decidido publicar); los países se nombran por su código ISO 3166-1 alfa-3, que casa con las fronteras de Natural
Earth; Cataluña es la región «ES51» y la Unión Europea, el agregado «EU27_2020». Un indicador puede tener varios
valores en un territorio si son de años distintos (una serie), seguidos y del más reciente al más antiguo; los de
cobertura «cataluna» solo están en Cataluña y no se comparan. Python estándar.
"""

import datetime
import re
from collections.abc import Container
from typing import Any

from plataforma_datos.derivados.fuentes.datos_globales.piezas.constantes_datos_globales import (
    AGREGADO,
    CALCULADO,
    CAMPOS_DEL_INDICADOR,
    CATALUNA,
    COBERTURA_CATALUNA,
    COBERTURA_MUNDO,
    COBERTURA_UE,
    ESTIMADO,
    MEDIDO,
    NATURALEZA_OPINION,
    NOTAS,
    PAIS,
    REGION,
    UE27,
    UNIDAD_DEL_RECUENTO,
    UNIDAD_PORCENTAJE,
    VERSION_DEL_CONTRATO,
)
from plataforma_datos.derivados.fuentes.datos_globales.piezas.contrato_calculado import problemas_del_valor_calculado
from plataforma_datos.derivados.fuentes.datos_globales.piezas.contrato_comun import (
    ISO3,
    es_anio,
    es_numero,
    id_valido,
    texto_doble,
)

CLAVES = ("version", "generado", "indicadores", "territorios", "recuentos", "metas", "encuestas", "calculados")
# Ampliación compatible de la versión 1 (quien lee solo `indicadores` y `territorios` no la ve): cifras que no son un
# porcentaje, con sus valores dentro (`recuentos`), las metas de la ley que las miden (`metas`), las encuestas de
# opinión (`encuestas`, `naturaleza: "opinion"`) y las cifras que calcula Faro con microdatos de encuestas oficiales
# (`calculados`, `naturaleza: "calculado"`, cada una con su intervalo, su método y su cita), que nunca van entre los
# indicadores medidos.
CLAVES_DEL_VALOR_DEL_RECUENTO = ("territorio", "valor", "anio", "nota")
CLAVES_DE_LA_ENCUESTA = (
    "id",
    "nombre",
    "definicion",
    "pregunta",
    "respuesta",
    "base",
    "campo",
    "unidad",
    "naturaleza",
    "fuente",
    "tabla",
    "licencia",
    "url",
    "comparable",
    "cobertura",
    "valores",
)
CLAVES_DE_LA_META = (
    "id",
    "nombre",
    "norma",
    "articulo",
    "texto",
    "valor",
    "unidad",
    "anio",
    "indicador",
    "nota",
    "url",
)
CLAVES_DEL_TERRITORIO = ("codigo", "iso3", "tipo", "nombre", "valores")
CLAVES_DEL_VALOR = ("indicador", "valor", "anio", "nota")
FECHA = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
# El mayor valor de una cifra en porcentaje: la parte de un todo no pasa de su total.
PORCENTAJE_MAXIMO = 100
# Lo que identifica a cada territorio que no es un país.
NO_PAISES = {CATALUNA: REGION, UE27: AGREGADO}


def _clave_de(valor: object, claves: Container[object]) -> bool:
    """Si un valor leído del archivo es uno de los textos de `claves` (un diccionario o un conjunto).

    Un valor que no es texto (una lista, un objeto) no se busca: no se puede usar como clave y no lo es.

    Returns:
        True si es un texto y está entre las claves.
    """
    return isinstance(valor, str) and valor in claves


def _problemas_del_indicador(indicador: object) -> list[str]:
    """Lo que no cumple el contrato en un indicador.

    Returns:
        Un texto por regla incumplida; vacía si el indicador cumple.
    """
    if not isinstance(indicador, dict) or tuple(indicador) != CAMPOS_DEL_INDICADOR:
        return [f"indicador con otras claves: {indicador!r:.80}"]
    id_ = indicador["id"]
    reglas = {
        "id con forma válida": id_valido(id_),
        "nombre y definición en castellano y en catalán": all(
            texto_doble(indicador[campo]) for campo in ("nombre", "definicion")
        ),
        "unidad «porcentaje»": indicador["unidad"] == UNIDAD_PORCENTAJE,
        "«medido» o «estimado»": indicador["naturaleza"] in (MEDIDO, ESTIMADO),
        "«comparable» verdadero o falso": isinstance(indicador["comparable"], bool),
        "cobertura «ue», «mundo» o «cataluna»": indicador["cobertura"]
        in (COBERTURA_UE, COBERTURA_MUNDO, COBERTURA_CATALUNA),
        "lo de solo Cataluña no se compara": indicador["cobertura"] != COBERTURA_CATALUNA
        or not indicador["comparable"],
        "fuente, tabla, licencia y dirección": all(
            isinstance(indicador[campo], str) and indicador[campo] for campo in ("fuente", "tabla", "licencia", "url")
        ),
        "dirección https": str(indicador["url"]).startswith("https://"),
    }
    return [f"{id_}: {regla}" for regla, cumple in reglas.items() if not cumple]


def _problemas_del_valor(codigo: str, valor: object, unidades: dict[str, object]) -> list[str]:
    """Lo que no cumple el contrato en un valor de un territorio.

    Returns:
        Un texto por regla incumplida; vacía si el valor cumple.
    """
    if not isinstance(valor, dict) or tuple(valor) != CLAVES_DEL_VALOR:
        return [f"{codigo}: valor con otras claves: {valor!r:.80}"]
    cifra, anio = valor["valor"], valor["anio"]
    numerica = es_numero(cifra)
    reglas = {
        "indicador del catálogo": _clave_de(valor["indicador"], unidades),
        "cifra numérica": numerica,
        "porcentaje entre 0 y 100": not numerica
        or not _clave_de(valor["indicador"], unidades)
        or unidades[valor["indicador"]] != UNIDAD_PORCENTAJE
        or 0 <= cifra <= PORCENTAJE_MAXIMO,
        "año entero": es_anio(anio),
        "nota del vocabulario o null": valor["nota"] is None or _clave_de(valor["nota"], NOTAS),
    }
    return [f"{codigo} · {valor['indicador']}: {regla}" for regla, cumple in reglas.items() if not cumple]


def _series_en_orden(valores: list[Any]) -> bool:
    """Si cada indicador aparece una vez por año, con sus valores seguidos y del año más reciente al más antiguo.

    Returns:
        True si los valores cumplen las tres condiciones.
    """
    ultimo: object = None
    anterior: dict[str, int] = {}
    for valor in valores:
        if not isinstance(valor, dict) or not isinstance(valor.get("anio"), int):
            continue
        indicador = valor.get("indicador")
        if not isinstance(indicador, str):
            continue
        if indicador in anterior and (ultimo != indicador or valor["anio"] >= anterior[indicador]):
            return False
        ultimo = indicador
        anterior[indicador] = valor["anio"]
    return True


def _problemas_del_territorio(territorio: object, unidades: dict[str, object]) -> list[str]:
    """Lo que no cumple el contrato en un territorio y en sus valores.

    Returns:
        Un texto por regla incumplida; vacía si el territorio cumple.
    """
    if not isinstance(territorio, dict) or tuple(territorio) != CLAVES_DEL_TERRITORIO:
        return [f"territorio con otras claves: {territorio!r:.80}"]
    codigo = str(territorio["codigo"])
    if codigo in NO_PAISES:
        identidad = territorio["tipo"] == NO_PAISES[codigo] and territorio["iso3"] is None
    else:
        identidad = territorio["tipo"] == PAIS and bool(ISO3.fullmatch(codigo)) and territorio["iso3"] == codigo
    problemas = [] if identidad else [f"{codigo}: código, tipo e iso3 no casan"]
    if not texto_doble(territorio["nombre"]):
        problemas.append(f"{codigo}: nombre en castellano y en catalán")
    valores = territorio["valores"] if isinstance(territorio["valores"], list) else []
    if not valores:
        problemas.append(f"{codigo}: sin valores")
    if not _series_en_orden(valores):
        problemas.append(
            f"{codigo}: un indicador repetido el mismo año o una serie que no va del año más reciente al más antiguo"
        )
    for valor in valores:
        problemas.extend(_problemas_del_valor(codigo, valor, unidades))
    return problemas


def _valor_con_territorio(valor: object) -> bool:
    """Si un valor de un recuento o de una encuesta tiene territorio del contrato, cifra, año y nota válidos.

    Returns:
        True si el valor tiene los cuatro campos válidos.
    """
    return (
        isinstance(valor, dict)
        and tuple(valor) == CLAVES_DEL_VALOR_DEL_RECUENTO
        and (_clave_de(valor["territorio"], NO_PAISES) or bool(ISO3.fullmatch(str(valor["territorio"]))))
        and es_numero(valor["valor"])
        and es_anio(valor["anio"])
        and (valor["nota"] is None or _clave_de(valor["nota"], NOTAS))
    )


def _problemas_del_recuento(recuento: object) -> list[str]:
    """Lo que no cumple el contrato en un recuento: los campos de un indicador, otra unidad y sus valores dentro.

    Returns:
        Un texto por regla incumplida; vacía si el recuento cumple.
    """
    if not isinstance(recuento, dict) or tuple(recuento) != (*CAMPOS_DEL_INDICADOR, "valores"):
        return [f"recuento con otras claves: {recuento!r:.80}"]
    como_indicador = {**{campo: recuento[campo] for campo in CAMPOS_DEL_INDICADOR}, "unidad": UNIDAD_PORCENTAJE}
    problemas = [f"recuento {problema}" for problema in _problemas_del_indicador(como_indicador)]
    if recuento["unidad"] != UNIDAD_DEL_RECUENTO:
        problemas.append(f"{recuento['id']}: unidad «{UNIDAD_DEL_RECUENTO}»")
    valores = recuento["valores"] if isinstance(recuento["valores"], list) else []
    if not valores:
        problemas.append(f"{recuento['id']}: sin valores")
    for valor in valores:
        if not _valor_con_territorio(valor) or valor["valor"] < 0:
            problemas.append(f"{recuento['id']}: valor sin territorio, cifra, año o nota válidos: {valor!r:.80}")
    return problemas


def _problemas_de_la_encuesta(encuesta: object) -> list[str]:
    """Lo que no cumple el contrato en una encuesta de opinión: su pregunta literal, «opinion» y sus porcentajes.

    Returns:
        Un texto por regla incumplida; vacía si la encuesta cumple.
    """
    if not isinstance(encuesta, dict) or tuple(encuesta) != CLAVES_DE_LA_ENCUESTA:
        return [f"encuesta con otras claves: {encuesta!r:.80}"]
    reglas = {
        "id con forma válida": id_valido(encuesta["id"]),
        "nombre y definición en castellano y en catalán": all(
            texto_doble(encuesta[campo]) for campo in ("nombre", "definicion")
        ),
        "pregunta, respuesta, base y campo literales": all(
            isinstance(encuesta[campo], str) and encuesta[campo] for campo in ("pregunta", "respuesta", "base", "campo")
        ),
        "naturaleza «opinion» y unidad «porcentaje»": encuesta["naturaleza"] == NATURALEZA_OPINION
        and encuesta["unidad"] == UNIDAD_PORCENTAJE,
        "fuente, tabla, licencia y dirección https": all(
            isinstance(encuesta[campo], str) and encuesta[campo] for campo in ("fuente", "tabla", "licencia")
        )
        and str(encuesta["url"]).startswith("https://"),
        "comparable y cobertura": isinstance(encuesta["comparable"], bool)
        and encuesta["cobertura"] in (COBERTURA_UE, COBERTURA_MUNDO, COBERTURA_CATALUNA),
        "lo de solo Cataluña no se compara": encuesta["cobertura"] != COBERTURA_CATALUNA or not encuesta["comparable"],
    }
    problemas = [f"{encuesta['id']}: {regla}" for regla, cumple in reglas.items() if not cumple]
    valores = encuesta["valores"] if isinstance(encuesta["valores"], list) else []
    if not valores:
        problemas.append(f"{encuesta['id']}: sin valores")
    for valor in valores:
        if not _valor_con_territorio(valor) or not 0 <= valor["valor"] <= PORCENTAJE_MAXIMO:
            problemas.append(f"{encuesta['id']}: valor sin territorio, porcentaje, año o nota válidos: {valor!r:.80}")
    return problemas


def _problemas_del_calculado(calculado: object, nombres: dict[str, Any]) -> list[str]:
    """Lo que no cumple el contrato en un indicador calculado: su cabecera, «calculado» y sus cifras por país.

    Returns:
        Un texto por regla incumplida; vacía si el indicador calculado cumple.
    """
    if not isinstance(calculado, dict) or tuple(calculado) != (*CAMPOS_DEL_INDICADOR, "valores"):
        return [f"calculado con otras claves: {calculado!r:.80}"]
    nombre = calculado["id"]
    como_indicador = {**{campo: calculado[campo] for campo in CAMPOS_DEL_INDICADOR}, "naturaleza": MEDIDO}
    problemas = [f"calculado {problema}" for problema in _problemas_del_indicador(como_indicador)]
    if calculado["naturaleza"] != CALCULADO:
        problemas.append(f"{nombre}: naturaleza «{CALCULADO}»")
    valores = calculado["valores"] if isinstance(calculado["valores"], list) else []
    if not valores:
        problemas.append(f"{nombre}: sin valores")
    paises = [
        valor["territorio"] for valor in valores if isinstance(valor, dict) and isinstance(valor.get("territorio"), str)
    ]
    if len(set(paises)) != len(paises):
        problemas.append(f"{nombre}: un país con dos cifras")
    for valor in valores:
        problemas.extend(problemas_del_valor_calculado(nombre, valor))
    otro_nombre = sorted(
        str(valor.get("territorio"))
        for valor in valores
        if isinstance(valor, dict)
        and _clave_de(valor.get("territorio"), nombres)
        and valor.get("nombre") != nombres[valor["territorio"]]
    )
    if otro_nombre:
        problemas.append(f"{nombre}: el nombre de {otro_nombre} no es el de «territorios»")
    return problemas


def _problemas_de_la_meta(meta: object, unidades: dict[str, object]) -> list[str]:
    """Lo que no cumple el contrato en una meta: su texto literal, su valor y el indicador que la mide.

    Returns:
        Un texto por regla incumplida; vacía si la meta cumple.
    """
    if not isinstance(meta, dict) or tuple(meta) != CLAVES_DE_LA_META:
        return [f"meta con otras claves: {meta!r:.80}"]
    reglas = {
        "id con forma válida": id_valido(meta["id"]),
        "nombre en castellano y en catalán": texto_doble(meta["nombre"]),
        "norma, artículo y texto literal": all(
            isinstance(meta[campo], str) and meta[campo] for campo in ("norma", "articulo", "texto")
        ),
        "valor numérico positivo": es_numero(meta["valor"]) and meta["valor"] > 0,
        "año entero": es_anio(meta["anio"]),
        "lo mide un indicador o un recuento del archivo, en su unidad": _clave_de(meta["indicador"], unidades)
        and unidades[meta["indicador"]] == meta["unidad"],
        "nota en castellano y en catalán o null": meta["nota"] is None or texto_doble(meta["nota"]),
        "dirección https": str(meta["url"]).startswith("https://"),
    }
    return [f"{meta['id']}: {regla}" for regla, cumple in reglas.items() if not cumple]


def problemas_del_contrato(datos: object) -> list[str]:
    """Todo lo que no cumple el contrato en el archivo entero; una lista vacía si lo cumple.

    Returns:
        Un texto por regla incumplida, en el orden de las partes del archivo.
    """
    if not isinstance(datos, dict) or tuple(datos) != CLAVES:
        return [f"el archivo no tiene exactamente las claves {CLAVES}"]
    problemas = []
    if datos["version"] != VERSION_DEL_CONTRATO:
        problemas.append(f"versión {datos['version']!r}; se espera {VERSION_DEL_CONTRATO!r}")
    generado = _fecha(datos["generado"])
    if generado is None:
        problemas.append("«generado» no es una fecha AAAA-MM-DD")
    elif futuros := _anios_posteriores(datos, generado.year):
        problemas.append(f"cifras de un año posterior al de «generado»: {futuros[:5]}")
    indicadores = datos["indicadores"] if isinstance(datos["indicadores"], list) else []
    for indicador in indicadores:
        problemas.extend(_problemas_del_indicador(indicador))
    unidades = {
        indicador["id"]: indicador.get("unidad")
        for indicador in indicadores
        if isinstance(indicador, dict) and id_valido(indicador.get("id"))
    }
    if len(unidades) != len(indicadores) or not indicadores:
        problemas.append("los indicadores no tienen un identificador único cada uno")
    territorios = datos["territorios"] if isinstance(datos["territorios"], list) else []
    codigos = [territorio.get("codigo") for territorio in territorios if isinstance(territorio, dict)]
    if not all(isinstance(codigo, str) for codigo in codigos) or len(set(codigos)) != len(codigos) or not territorios:
        problemas.append("los territorios no tienen un código único cada uno")
    for territorio in territorios:
        problemas.extend(_problemas_del_territorio(territorio, unidades))
    de_cataluna = {
        indicador.get("id")
        for indicador in indicadores
        if isinstance(indicador, dict)
        and id_valido(indicador.get("id"))
        and indicador.get("cobertura") == COBERTURA_CATALUNA
    }
    fuera = sorted(
        {
            f"{territorio.get('codigo')} · {valor.get('indicador')}"
            for territorio in territorios
            if isinstance(territorio, dict) and territorio.get("codigo") != CATALUNA
            for valor in (territorio["valores"] if isinstance(territorio.get("valores"), list) else [])
            if isinstance(valor, dict) and _clave_de(valor.get("indicador"), de_cataluna)
        }
    )
    if fuera:
        problemas.append(f"indicadores de solo Cataluña en otros territorios: {fuera[:5]}")
    return problemas + _problemas_de_la_ampliacion(datos, unidades)


def _fecha(valor: object) -> datetime.date | None:
    """La fecha AAAA-MM-DD, si lo es y existe en el calendario; si no, None.

    Returns:
        La fecha, o None si el valor no es una fecha AAAA-MM-DD válida.
    """
    if not (isinstance(valor, str) and FECHA.fullmatch(valor)):
        return None
    try:
        return datetime.date.fromisoformat(valor)
    except ValueError:
        return None


def _valores_de(datos: dict[str, Any], parte: str) -> list[dict[str, Any]]:
    """Los valores con forma de objeto de cada elemento de una parte: territorios, recuentos o encuestas.

    Returns:
        Los valores de tipo objeto de todos los elementos de la parte, en su orden.
    """
    elementos = datos[parte] if isinstance(datos[parte], list) else []
    return [
        valor
        for elemento in elementos
        if isinstance(elemento, dict) and isinstance(elemento.get("valores"), list)
        for valor in elemento["valores"]
        if isinstance(valor, dict)
    ]


def _anios_posteriores(datos: dict[str, Any], ultimo: int) -> list[str]:
    """Las cifras (no las metas, que son años futuros de la ley) de un año posterior a `ultimo`.

    Returns:
        Los códigos de los indicadores con alguna cifra posterior a `ultimo`.
    """
    return sorted(
        {
            f"{valor.get('indicador') or valor.get('territorio')} · {valor['anio']}"
            for parte in ("territorios", "recuentos", "encuestas", "calculados")
            for valor in _valores_de(datos, parte)
            if isinstance(valor.get("anio"), int) and valor["anio"] > ultimo
        }
    )


def _problemas_de_la_ampliacion(datos: dict[str, Any], unidades: dict[str, object]) -> list[str]:
    """Lo que no cumple el contrato en `recuentos`, `metas`, `encuestas` y `calculados`, con los indicadores.

    Returns:
        Un texto por regla incumplida en esas cuatro partes.
    """
    if not all(isinstance(datos[parte], list) for parte in ("recuentos", "metas", "encuestas", "calculados")):
        return ["«recuentos», «metas», «encuestas» y «calculados» son listas"]
    problemas = [problema for recuento in datos["recuentos"] for problema in _problemas_del_recuento(recuento)]
    de_los_recuentos = {
        recuento["id"]: recuento.get("unidad")
        for recuento in datos["recuentos"]
        if isinstance(recuento, dict) and id_valido(recuento.get("id"))
    }
    if len(de_los_recuentos) != len(datos["recuentos"]):
        problemas.append("los recuentos no tienen un id válido y único cada uno")
    if set(de_los_recuentos) & set(unidades):
        problemas.append("un recuento repite el id de un indicador")
    territorios = datos["territorios"] if isinstance(datos["territorios"], list) else []
    codigos = {
        territorio["codigo"]
        for territorio in territorios
        if isinstance(territorio, dict) and isinstance(territorio.get("codigo"), str)
    }
    sin_territorio = sorted(
        {
            str(valor.get("territorio"))
            for parte in ("recuentos", "encuestas")
            for valor in _valores_de(datos, parte)
            if not _clave_de(valor.get("territorio"), codigos)
        }
    )
    if sin_territorio:
        problemas.append(f"recuentos o encuestas con un territorio que no está en «territorios»: {sin_territorio[:5]}")
    medidas = {**unidades, **de_los_recuentos}
    problemas.extend(problema for meta in datos["metas"] for problema in _problemas_de_la_meta(meta, medidas))
    problemas.extend(problema for encuesta in datos["encuestas"] for problema in _problemas_de_la_encuesta(encuesta))
    de_las_encuestas = [
        encuesta["id"]
        for encuesta in datos["encuestas"]
        if isinstance(encuesta, dict) and id_valido(encuesta.get("id"))
    ]
    if len(de_las_encuestas) != len(datos["encuestas"]):
        problemas.append("cada encuesta tiene un id válido")
    if len(set(de_las_encuestas)) != len(de_las_encuestas) or set(de_las_encuestas) & set(medidas):
        problemas.append("cada encuesta tiene su id, distinto del de cualquier indicador o recuento")
    nombres = {
        territorio["codigo"]: territorio.get("nombre")
        for territorio in territorios
        if isinstance(territorio, dict) and isinstance(territorio.get("codigo"), str)
    }
    problemas.extend(
        problema for calculado in datos["calculados"] for problema in _problemas_del_calculado(calculado, nombres)
    )
    de_los_calculados = [
        calculado["id"]
        for calculado in datos["calculados"]
        if isinstance(calculado, dict) and id_valido(calculado.get("id"))
    ]
    if len(de_los_calculados) != len(datos["calculados"]) or len(set(de_los_calculados)) != len(de_los_calculados):
        problemas.append("cada calculado tiene un id válido y único")
    if set(de_los_calculados) & (set(medidas) | set(de_las_encuestas)):
        problemas.append("un calculado repite el id de un indicador, un recuento o una encuesta")
    return problemas
