"""Las huellas de un ensayo con datos grabados y su comparación: la guardia de igualdad de cada cambio posterior.

Un ensayo deja la huella del paquete (su versión pública y la de cada archivo de `datos/`), la de la generación que
el ciclo conservaría (la de cada archivo que traslada), la del catálogo de Cursos del recibo y la del recibo del
candidato. Dicen también cómo se trató cada fuente (`cobertura`): preparada desde sus originales, reutilizando su
validado vigente o solo validada, para que el banco no aparente cubrir lo que no cubre.

El catálogo y el recibo se guardan sin sus campos de hora: un instante dice cuándo se ejecutó el ensayo, no qué
produjo, y con él dos ensayos idénticos nunca serían iguales. Las fechas sin hora (las de un curso, las de una
fuente) sí cuentan, porque son datos.

Las huellas se separan en dos partes. Las de datos tienen que ser iguales byte a byte entre dos ensayos: cada archivo
del paquete y de la generación (los JSON sin sus firmas de código), el catálogo y el recibo. Las de código son las
firmas del código que produjo cada archivo (CAMPOS_DE_CODIGO) y las huellas compuestas que las incluyen (la versión del
paquete, el manifiesto, cada archivo tal cual): un cambio de código las cambia por diseño, así que se informan pero no
se exigen iguales.

Dos ensayos son iguales si sus huellas de datos coinciden campo a campo; la comparación dice qué difiere, qué excluye y
por qué.
"""

import json
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import Json, sha256
from plataforma_datos.comun.huella_json import sha256_json

VERSION = 1
SIN_HORA = "(hora del ensayo)"
# Los campos que guardan la hora real en que el proceso hizo algo: dicen cuándo se ejecutó el ensayo, no qué produjo.
# Los demás instantes (el del panel, los cortes del catálogo) siguen el reloj único del ensayo y sí cuentan.
CAMPOS_DE_HORA = {
    "terminadoEn": "la hora en que terminó el recibo del candidato",
    "ultimoIntento": "la hora en que empezó el intento de cada módulo",
    "proximoReintento": "se cuenta desde la hora real del intento",
    "ultimaComprobacion": "la hora real de la comprobación del ciclo",
    "ultimoIntentoRemotoEn": "la hora real del último intento remoto",
    "inicioEn": "la hora real en que empezó el ciclo de comprobaciones",
    "finEn": "la hora real en que terminó el ciclo de comprobaciones",
    "registradoEn": "la hora real en que se anotó el registro",
}
# Hasta dónde se detalla el recibo: recibo › estado › modulos › cada módulo. Más abajo, una huella por rama.
NIVELES_DEL_RECIBO = 3
SEPARADOR = " › "
# Las firmas del código que produjo un dato: cambian con cualquier cambio de código, aunque el dato sea el mismo.
CAMPOS_DE_CODIGO = {
    "codigo_sha256": "firma del código que validó la fuente o midió la salud de sus lecturas",
    "codigo_admision": "firma del código que admitió la entrada del catálogo",
    "codigo_proyeccion": "firma del código que proyectó el catálogo (linaje)",
    "codigo_productor_sha256": "firma del código que produjo la admisión de HP LIFE (almacen_catalogo)",
    "codigo_admision_sha256": "firma del código de la admisión del catálogo (almacen_catalogo)",
    "codigo_hp": "huellas de los archivos de código de HP LIFE en la firma de la composición",
    "evaluador": "firma del código del evaluador de vigencia (registro_vigencia.firma_evaluador)",
    "evaluadorSha256": "firma del código del evaluador de vigencia, en el catálogo del recibo",
}
# Una firma de código dentro de un objeto con nombre propio: la huella de la regla de retirada incluye su código.
FIRMAS_ANIDADAS = {"regla": ("sha256", "huella del código y los parámetros de la regla de retirada")}
# Los campos con «codigo» en el nombre que son datos (un código HTTP, postal, de una titulación…), no firmas.
CAMPOS_CODIGO_QUE_SON_DATOS = frozenset(
    {
        "codigo_http",
        "codigoHttp",
        "codigoTitulacion",
        "codigo_esco",
        "codigo_especialidad",
        "codigo_en_el_boe",
        "codigo_postal",
        "codigoPostal",
        "codigo_oficial",
        "codigo_inscripcion_publicado",
        "codigo_estudio",
        "codigo_convenio",
    }
)
# Un nombre que parece una firma de código: «codigo_…» o «codigoAlgo».
NOMBRE_DE_CODIGO = re.compile(r"codigo(_[a-z0-9_]+|[A-Z][A-Za-z0-9]*)")
MOTIVO_COMPUESTAS = "huellas compuestas que incluyen las firmas de código: cambian con el código aunque los datos no"
MOTIVO_ENLACES = "un enlace simbólico cuenta por su destino (la ruta a la que apunta), no por su contenido"


class CampoDeCodigoSinClasificar(ValueError):
    """Un campo con nombre de firma de código que no está clasificado: la comparación no sabría si exigirlo."""


def sin_horas(valor: Json) -> Json:
    """Sustituye por una marca fija los campos de CAMPOS_DE_HORA, en cualquier nivel del valor.

    Returns:
        El mismo valor JSON con esos campos cambiados por SIN_HORA.
    """
    if isinstance(valor, dict):
        return {clave: SIN_HORA if clave in CAMPOS_DE_HORA else sin_horas(dentro) for clave, dentro in valor.items()}
    if isinstance(valor, list):
        return [sin_horas(dentro) for dentro in valor]
    return valor


def _es_de_codigo(clave: str) -> bool:
    if clave in CAMPOS_DE_CODIGO:
        return True
    if NOMBRE_DE_CODIGO.fullmatch(clave) and clave not in CAMPOS_CODIGO_QUE_SON_DATOS:
        raise CampoDeCodigoSinClasificar(f"«{clave}» parece una firma de código: clasifícalo en huellas_del_ensayo")
    return False


def separar_codigo(valor: Json) -> tuple[Json, dict[str, Json]]:
    """Separa de un valor JSON sus firmas de código, en cualquier nivel.

    Returns:
        El valor sin sus firmas de código (CAMPOS_DE_CODIGO y FIRMAS_ANIDADAS) y esas firmas, por su camino.

    Raises:
        CampoDeCodigoSinClasificar: Si aparece un campo con nombre de firma que no está en ninguna lista.
    """
    firmas: dict[str, Json] = {}

    def quitar(dentro: Json, camino: tuple[str, ...]) -> Json:
        if isinstance(dentro, dict):
            limpio = {}
            for clave, hijo in dentro.items():
                anidada = FIRMAS_ANIDADAS.get(clave, ("",))[0]
                if _es_de_codigo(clave):
                    firmas[SEPARADOR.join((*camino, clave))] = hijo
                elif isinstance(hijo, dict) and anidada in hijo:
                    firmas[SEPARADOR.join((*camino, clave, anidada))] = hijo[anidada]
                    limpio[clave] = quitar({k: v for k, v in hijo.items() if k != anidada}, (*camino, clave))
                else:
                    limpio[clave] = quitar(hijo, (*camino, clave))
            return limpio
        if isinstance(dentro, list):
            return [quitar(hijo, (*camino, str(indice))) for indice, hijo in enumerate(dentro)]
        return dentro

    return quitar(valor, ()), firmas


def _huella_de_archivo(ruta: Path) -> tuple[str, str | None]:
    """La huella de datos de un archivo y la de sus firmas de código, si es un JSON que las lleva.

    Returns:
        La huella SHA-256 de sus datos (un JSON, sin sus firmas) y la de sus firmas, o None si no tiene.
    """
    if ruta.is_symlink():
        return "enlace a " + str(ruta.readlink()), None
    if ruta.suffix == ".json":
        try:
            datos, firmas = separar_codigo(json.loads(ruta.read_bytes()))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return sha256(ruta), None
        if firmas:
            return sha256_json(datos), sha256_json(firmas)
    return sha256(ruta), None


def _resumir(valor: Json, niveles: int) -> Json:
    """Conserva los valores sencillos y los primeros niveles; lo que queda más abajo se resume en su huella.

    Una lista de objetos con «id» se detalla por su id, para que la comparación nombre el módulo que difiere.

    Returns:
        El valor resumido, que sigue siendo JSON.
    """
    if isinstance(valor, list) and valor and all(isinstance(x, dict) and isinstance(x.get("id"), str) for x in valor):
        valor = {x["id"]: x for x in valor}
    if not isinstance(valor, (dict, list)):
        return valor
    if niveles == 0:
        return sha256_json(valor)
    if isinstance(valor, list):
        return [_resumir(dentro, niveles - 1) for dentro in valor]
    return {clave: _resumir(dentro, niveles - 1) for clave, dentro in valor.items()}


def archivos_de(carpeta: Path) -> tuple[dict[str, str], dict[str, str]]:
    """Las huellas de cada archivo bajo una carpeta, por su ruta relativa y en orden.

    Returns:
        La huella de datos de cada archivo (de un enlace, su destino) y, si lleva firmas de código, la de ellas.
    """
    datos: dict[str, str] = {}
    codigo: dict[str, str] = {}
    for ruta in sorted(ruta for ruta in carpeta.rglob("*") if ruta.is_symlink() or ruta.is_file()):
        nombre = ruta.relative_to(carpeta).as_posix()
        datos[nombre], firmas = _huella_de_archivo(ruta)
        if firmas is not None:
            codigo[nombre] = firmas
    return datos, codigo


def calcular(candidato: Path, recibo: dict[str, Any], generacion: Path | None, reloj: dict[str, str]) -> dict[str, Any]:
    """Calcula las huellas de un ensayo terminado.

    Args:
        candidato: La instalación candidata, ya con el paquete del ensayo publicado en ella.
        recibo: El recibo del candidato.
        generacion: La generación exportada del candidato, o None si el recibo no la validó.
        reloj: El día y el instante únicos con que corrió el ciclo: dos ensayos solo se comparan con el mismo.

    Returns:
        Las cuatro huellas, sin campos de hora.
    """
    paquete, codigo_del_paquete = archivos_de(candidato / "datos")
    contenido, codigo_de_la_generacion, compuestas = None, None, {"versionDelPaquete": recibo.get("huellaPaquete")}
    if generacion is not None:
        documento = json.loads((generacion / "manifiesto.json").read_bytes())
        contenido, codigo_de_la_generacion = archivos_de(generacion / "contenido")
        compuestas |= {
            "manifiestoPaqueteSha256": documento["manifiestoPaqueteSha256"],
            "estadoSha256": documento["estadoSha256"],
            "archivosTalCual": {registro["ruta"]: registro["sha256"] for registro in documento["archivos"]},
        }
    catalogo, codigo_del_catalogo = separar_codigo(sin_horas(recibo.get("catalogo")))
    # La versión del paquete es una huella compuesta: ya está en «compuestas».
    aparte = ("catalogo", "coberturaDelEnsayo", "huellaPaquete", "generacionDelEnsayo")
    generacion_del_ensayo = recibo.get("generacionDelEnsayo") or {}
    compuestas["sha256Manifiesto"] = generacion_del_ensayo.get("sha256Manifiesto")
    resto, codigo_del_recibo = separar_codigo(sin_horas({c: v for c, v in recibo.items() if c not in aparte}))
    return {
        "version": VERSION,
        "reloj": reloj,
        "datos": {
            "cobertura": recibo.get("coberturaDelEnsayo"),
            # Si la generación se conservaría y, si no, en qué comprobación y por qué; su huella va con las compuestas.
            "estadoDeLaGeneracion": {c: v for c, v in generacion_del_ensayo.items() if c != "sha256Manifiesto"} or None,
            "paquete": paquete,
            "generacion": contenido,
            "catalogo": catalogo,
            "recibo": _resumir(resto, NIVELES_DEL_RECIBO),
        },
        "codigo": {
            "paquete": codigo_del_paquete,
            "generacion": codigo_de_la_generacion,
            "catalogo": codigo_del_catalogo,
            "recibo": codigo_del_recibo,
            "compuestas": compuestas,
        },
    }


def _hojas(valor: Json, camino: tuple[str, ...] = ()) -> Iterator[tuple[str, Json]]:
    """Recorre un valor JSON y da cada hoja con su camino, para comparar campo a campo.

    Yields:
        El camino de cada hoja, con sus claves unidas por SEPARADOR, y su valor.
    """
    if isinstance(valor, dict) and valor:
        for clave in sorted(valor):
            yield from _hojas(valor[clave], (*camino, clave))
    elif isinstance(valor, list) and valor:
        for indice, dentro in enumerate(valor):
            yield from _hojas(dentro, (*camino, str(indice)))
    else:
        yield SEPARADOR.join(camino), valor


def _diferencias(a: Json, b: Json, prefijo: str = "") -> list[str]:
    hojas_a, hojas_b = dict(_hojas(a)), dict(_hojas(b))
    diferencias = []
    for camino in sorted(hojas_a.keys() | hojas_b.keys()):
        if camino not in hojas_b:
            diferencias.append(f"{prefijo}solo en A: {camino}")
        elif camino not in hojas_a:
            diferencias.append(f"{prefijo}solo en B: {camino}")
        elif hojas_a[camino] != hojas_b[camino]:
            diferencias.append(f"{prefijo}distinto: {camino}: {hojas_a[camino]!r} → {hojas_b[camino]!r}")
    return diferencias


def comparar(a: dict[str, Any], b: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Compara dos huellas: exige iguales las de datos y el reloj, e informa de las de código.

    Returns:
        Las diferencias que hacen distintos los dos ensayos (vacía si son iguales) y las de código, que no cuentan.
    """
    exigidas = {"version": a.get("version"), "reloj": a.get("reloj"), "datos": a.get("datos")}
    otras = {"version": b.get("version"), "reloj": b.get("reloj"), "datos": b.get("datos")}
    return _diferencias(exigidas, otras), _diferencias(a.get("codigo"), b.get("codigo"), "no se exige (código) ")


class ReferenciaNoAceptable(ValueError):
    """Unas huellas de un ensayo por partes con código distinto: sirven para trabajar, no como referencia."""


def exigir_referencia(huellas: dict[str, Any]) -> None:
    """Exige que unas huellas valgan como referencia de una comparación.

    Raises:
        ReferenciaNoAceptable: Si vienen de un ensayo por partes marcado como que no vale para aceptar.
    """
    por_partes = huellas.get("porPartes")
    if por_partes is not None and not por_partes.get("valeParaAceptar"):
        raise ReferenciaNoAceptable(
            "Estas huellas son de un ensayo por partes que no vale para aceptar (el código cambió): no sirven de "
            "referencia. Usa las de un ensayo completo."
        )


def exclusiones() -> list[str]:
    """Lo que la comparación no exige igual, y por qué.

    Returns:
        Una línea por campo o grupo de huellas excluido, con su motivo.
    """
    lineas = [f"Se excluye {campo}: {motivo}." for campo, motivo in CAMPOS_DE_CODIGO.items()]
    lineas += [f"Se excluye {campo} › {sub}: {motivo}." for campo, (sub, motivo) in FIRMAS_ANIDADAS.items()]
    lineas.append(f"Se excluyen la versión del paquete, el manifiesto y cada archivo tal cual: {MOTIVO_COMPUESTAS}.")
    lineas += [f"{campo} vale «{SIN_HORA}»: {motivo}." for campo, motivo in CAMPOS_DE_HORA.items()]
    lineas.append(f"Enlaces simbólicos: {MOTIVO_ENLACES}.")
    return lineas
