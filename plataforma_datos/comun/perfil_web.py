"""Perfil público de navegador definido por el proyecto, sin datos del equipo."""

import json
import re
from pathlib import Path
from typing import Literal

RUTA_IDENTIDAD = Path(__file__).resolve().parents[2] / "config" / "identidad-web.json"
VERSION_CHROME = "156.0.0.0"
MAX_CONFIGURACION = 16_384
MAX_LONGITUD_AGENTE = 512
ASCII_IMPRIMIBLE = range(32, 127)
PISTAS = frozenset({"sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform"})
IDENTIDAD = PISTAS | {"user-agent", "accept-encoding"}
PAGINA = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
}
CAMPOS_PAGINA = frozenset(k.lower() for k in PAGINA)
type Uso = Literal["datos", "pagina", "idioma-original"]


class PerfilInvalido(ValueError):
    """La configuración no acredita un perfil de navegador coherente."""


def _marcas_chrome(mayor: int) -> str:
    """Genera GREASE y permuta las tres marcas como Chromium, con major como semilla.

    Fuente primaria: GetGreasedUserAgentBrandVersion/GetRandomOrder/ShuffleBrandList.
    https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/embedder_support/user_agent_utils.cc
    Captura SHA256: b3eb390912deec66b1f56117e3164f25365938fc8b8748972b73403ecd5b1365.

    Returns:
        sec-ch-ua de Chrome con tres marcas, sin marcas adicionales ni versión completa de UA-CH.
    """
    signos = (" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_")
    versiones = ("8", "99", "24")
    ordenes = ((0, 1, 2), (0, 2, 1), (1, 0, 2), (1, 2, 0), (2, 0, 1), (2, 1, 0))
    grease = "Not" + signos[mayor % len(signos)] + "A" + signos[(mayor + 1) % len(signos)] + "Brand"
    marcas = ((grease, versiones[mayor % len(versiones)]), ("Chromium", str(mayor)), ("Google Chrome", str(mayor)))
    orden = ordenes[mayor % len(ordenes)]
    barajadas = [""] * len(marcas)
    # Chromium asigna destino[orden[i]] = origen[i]; no usa origen[orden[i]].
    for destino, (marca, version) in zip(orden, marcas, strict=True):
        barajadas[destino] = f'"{marca}";v="{version}"'
    return ", ".join(barajadas)


def perfil_chrome(version: str = VERSION_CHROME) -> dict[str, str]:
    """Genera UA reducido y pistas major desde una versión publicada de cuatro componentes.

    Returns:
        Cabeceras de identidad y compresión, sin negociación de idioma ni navegación.

    Raises:
        PerfilInvalido: Si la versión no tiene cuatro componentes numéricos.
    """
    if re.fullmatch(r"[0-9]+(?:\.[0-9]+){3}", version) is None:
        raise PerfilInvalido("La versión de navegador no es válida.")
    mayor = version.split(".")[0]
    return {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            f"(KHTML, like Gecko) Chrome/{mayor}.0.0.0 Safari/537.36"
        ),
        "sec-ch-ua": _marcas_chrome(int(mayor)),
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "Accept-Encoding": "gzip, deflate",
    }


def identidad_publica(perfil: dict[str, str]) -> dict[str, str]:
    """Selecciona exclusivamente UA y tres pistas de un perfil ya validado.

    Returns:
        Identidad genérica sin compresión, idioma, opciones de curl ni datos del entorno.
    """
    return {nombre: perfil[nombre] for nombre in ("User-Agent", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform")}


def cabeceras_identidad() -> dict[str, str]:
    """Resuelve las cuatro cabeceras centrales para transportes con negociación propia.

    Returns:
        Copia de la identidad del perfil configurado, sin una excepción para servicios privados.
    """
    return identidad_publica(leer_perfil())


AGENTE_POR_DEFECTO = perfil_chrome()["User-Agent"]


def validar_agente(agente: object) -> str:
    """Valida un navegador genérico y una plataforma fija.

    Returns:
        La cadena original comprobada.

    Raises:
        PerfilInvalido: Si incorpora otra identidad o añadidos.
    """
    version = r"[0-9]+(?:\.[0-9]+)*"
    chromium = (
        r"Mozilla/5\.0 \(Windows NT 10\.0; Win64; x64\) "
        rf"AppleWebKit/{version} \(KHTML, like Gecko\) Chrome/{version} Safari/{version}(?: Edg/{version})?"
    )
    firefox = rf"Mozilla/5\.0 \(Windows NT 10\.0; Win64; x64; rv:{version}\) Gecko/[0-9]+ Firefox/{version}"
    safari = (
        r"Mozilla/5\.0 \(Macintosh; Intel Mac OS X 10_15_7\) "
        rf"AppleWebKit/{version} \(KHTML, like Gecko\) Version/{version} Safari/{version}"
    )
    if (
        not isinstance(agente, str)
        or len(agente) > MAX_LONGITUD_AGENTE
        or re.fullmatch(rf"(?:{chromium}|{firefox}|{safari})", agente) is None
    ):
        raise PerfilInvalido("La identidad web debe ser un navegador genérico, sin añadidos.")
    return agente


def perfil_del_agente(agente: object) -> dict[str, str]:
    """Comprueba el UA reducido de Chrome y completa sus tres pistas canónicas.

    Returns:
        Perfil coherente, sin seleccionar un navegador alternativo como repuesto.

    Raises:
        PerfilInvalido: Si la cadena no corresponde al perfil central de Chrome.
    """
    agente = validar_agente(agente)
    chrome = re.search(r"Chrome/([0-9]+(?:\.[0-9]+){3}) ", agente)
    if chrome is None:
        raise PerfilInvalido("El perfil central requiere una versión completa de Chrome.")
    perfil = perfil_chrome(chrome.group(1))
    if agente != perfil["User-Agent"]:
        raise PerfilInvalido("El agente no describe el navegador Chrome central.")
    return perfil


def _objeto_sin_duplicados(pares: list[tuple[str, object]]) -> dict[str, object]:
    """Rechaza claves repetidas para evitar interpretaciones distintas entre transportes.

    Returns:
        Objeto JSON con claves únicas.

    Raises:
        PerfilInvalido: Si una clave aparece más de una vez.
    """
    resultado: dict[str, object] = {}
    for clave, valor in pares:
        if clave in resultado:
            raise PerfilInvalido("La configuración de identidad contiene claves duplicadas.")
        resultado[clave] = valor
    return resultado


def leer_perfil(ruta: Path | None = None) -> dict[str, str]:
    """Lee el mismo JSON versionado que consumen TypeScript, Worker e instaladores.

    No consulta HOME ni sustituye una configuración ausente o dañada por valores implícitos.
    La compresión pertenece al transporte Python; el archivo contiene solo las cuatro cabeceras de identidad.

    Returns:
        Perfil completo de Chrome con versión y pistas contrastadas con el generador canónico.

    Raises:
        PerfilInvalido: Si el archivo es ilegible o incumple el contrato de identidad.
    """
    try:
        with (ruta if ruta is not None else RUTA_IDENTIDAD).open("rb") as archivo:
            contenido = archivo.read(MAX_CONFIGURACION + 1)
        if len(contenido) > MAX_CONFIGURACION:
            raise PerfilInvalido("La configuración de identidad supera su límite.")
        configuracion = json.loads(contenido.decode("utf-8"), object_pairs_hook=_objeto_sin_duplicados)
    except (OSError, UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise PerfilInvalido("No se puede leer la configuración de identidad del proyecto.") from error
    if (
        not isinstance(configuracion, dict)
        or set(configuracion) != {"version", "identidad"}
        or type(configuracion["version"]) is not int
        or configuracion["version"] != 1
        or not isinstance(configuracion["identidad"], dict)
    ):
        raise PerfilInvalido("El contrato de identidad del proyecto no es válido.")
    identidad = configuracion["identidad"]
    if set(identidad) != {"User-Agent", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform"} or any(
        not isinstance(valor, str)
        or len(valor) > MAX_LONGITUD_AGENTE
        or any(ord(caracter) not in ASCII_IMPRIMIBLE for caracter in valor)
        for valor in identidad.values()
    ):
        raise PerfilInvalido("La identidad debe contener exclusivamente UA y tres pistas públicas.")
    perfil = perfil_del_agente(identidad["User-Agent"])
    if identidad != identidad_publica(perfil):
        raise PerfilInvalido("El agente y las pistas no describen el mismo navegador Chrome central.")
    return perfil


def cabeceras_peticion(
    adicionales: dict[str, str] | None, uso: Uso = "datos", *, cuerpo: bytes | None = None
) -> dict[str, str]:
    """Compone una petición: HTML requiere elección expresa y una fuente sin idioma sensible.

    Returns:
        Cabeceras nuevas; conserva las negociaciones propias de API y fuentes por idioma.

    Raises:
        PerfilInvalido: Si el uso no existe o combina navegación con una API o POST.
    """
    if uso not in {"datos", "pagina", "idioma-original"}:
        raise PerfilInvalido("Perfil de lectura desconocido.")
    cabeceras = {k: v for k, v in (adicionales or {}).items() if k.lower() not in IDENTIDAD}
    if uso == "pagina":
        if cuerpo is not None or any(k.lower() == "accept" and v != PAGINA["Accept"] for k, v in cabeceras.items()):
            raise PerfilInvalido("Una API o POST no utiliza el perfil de navegación HTML.")
        if any(k.lower() == "accept-language" for k in cabeceras):
            raise PerfilInvalido("La fuente que negocia idioma debe usar idioma-original.")
        cabeceras = {k: v for k, v in cabeceras.items() if k.lower() not in CAMPOS_PAGINA}
        cabeceras.update(PAGINA)
    return {**cabeceras, **leer_perfil()}
