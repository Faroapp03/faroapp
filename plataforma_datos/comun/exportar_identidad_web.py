"""Comprueba o actualiza la configuración central de identidad del producto."""

import argparse

from plataforma_datos.comun import perfil_web
from plataforma_datos.comun.entrada_salida import guardar_json


def documento(version: str | None = None) -> dict[str, object]:
    """Construye el perfil desde una versión explícita o comprueba el JSON vigente.

    Returns:
        Configuración portable sin HOME, red ni navegador instalado.
    """
    perfil = perfil_web.perfil_chrome(version) if version is not None else perfil_web.leer_perfil()
    return {"version": 1, "identidad": perfil_web.identidad_publica(perfil)}


def main(argv: list[str] | None = None) -> int:
    """La escritura requiere versión explícita; la comprobación nunca modifica archivos.

    Returns:
        Cero si el contrato y las cabeceras son coherentes.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comprobar", action="store_true")
    parser.add_argument("--version", help="Versión de Chrome previamente contrastada con la fuente oficial.")
    opciones = parser.parse_args(argv)
    if not opciones.comprobar and opciones.version is None:
        parser.error("Para actualizar la identidad, indica --version; para revisarla usa --comprobar.")
    try:
        esperado = documento(opciones.version)
        if opciones.comprobar:
            if documento() != esperado:
                parser.error("La identidad central no coincide con la versión indicada.")
        elif documento() != esperado:
            guardar_json(perfil_web.RUTA_IDENTIDAD, esperado)
    except (OSError, perfil_web.PerfilInvalido) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
