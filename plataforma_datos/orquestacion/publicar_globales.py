"""Traslada el agregado global admitido al candidato público, conservando sus bytes.

Comprueba su contrato y que coincide con la composición de sus agregados admitidos. No reconstruye las fuentes
ni publica en la web: escribe únicamente datos/globales/datos-globales.json bajo la raíz explícita recibida.
"""

import argparse
import json
import sys
from pathlib import Path

import plataforma_datos.derivados.fuentes.datos_globales.lector as datos_globales
from plataforma_datos.comun.entrada_salida import leer_json, requerir, temporal_hermano
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, RAIZ, FormatoInesperado, ValidacionFallida, exigir
from plataforma_datos.derivados.fuentes.datos_globales.piezas.contrato_datos_globales import problemas_del_contrato
from plataforma_datos.orquestacion.admision import exigir_admitido
from plataforma_datos.orquestacion.ordenes import con_motivo

CARPETA_VALIDADA = DATOS_RELATIVOS / "validados"
DESTINO = Path("datos/globales/datos-globales.json")


def publicar_globales(raiz: Path) -> Path:
    """Comprueba y copia el agregado global en esta raíz; cualquier error conserva el destino anterior.

    Args:
        raiz: Raíz del candidato aislado, con sus agregados e informes operativos.

    Returns:
        Ruta del agregado público, con los mismos bytes que el validado.

    Raises:
        FormatoInesperado: Si el JSON o una entrada no tienen la forma esperada.
    """
    validados = raiz / CARPETA_VALIDADA
    carpeta = validados / datos_globales.FUENTE
    informe = exigir_admitido(datos_globales.FUENTE, ruta=carpeta / "validacion.json")
    exigir(bool(informe["controles"]), "datos-globales: validación sin controles ejecutados", ValidacionFallida)
    origen = carpeta / "datos-globales.json"
    contenido = requerir(origen).read_bytes()
    try:
        datos = json.loads(contenido.decode("utf-8"))
    except ValueError as error:
        raise FormatoInesperado(f"{origen} no es JSON válido en UTF-8: {error}") from error
    problemas = problemas_del_contrato(datos)
    exigir(not problemas, f"datos-globales: forma del contrato: {problemas[:5]}", ValidacionFallida)
    faltan = datos_globales.faltan_imprescindibles(datos)
    exigir(not faltan, f"datos-globales: faltan territorios de la comparación: {faltan}", ValidacionFallida)
    entradas = {}
    for fuente in datos_globales.ENTRADAS:
        carpeta_entrada = validados / fuente
        exigir_admitido(fuente, ruta=carpeta_entrada / "validacion.json")
        conjunto = leer_json(carpeta_entrada / f"{fuente}.json")
        datos_globales.exigir_forma(fuente, conjunto)
        entradas[fuente] = conjunto
    exigir(
        datos == datos_globales.componer(entradas),
        "datos-globales: el agregado no coincide con sus fuentes validadas",
        ValidacionFallida,
    )
    destino = raiz / DESTINO
    destino.parent.mkdir(parents=True, exist_ok=True)
    temporal = None
    try:
        with temporal_hermano(destino.parent, prefijo=f".{destino.name}.", sufijo=".parcial") as archivo:
            temporal = Path(archivo.name)
            archivo.write(contenido)
        temporal.replace(destino)
    finally:
        if temporal is not None:
            temporal.unlink(missing_ok=True)
    return destino


def main(argv: list[str] | None = None) -> int:
    """Publica el agregado del candidato donde está instalado este módulo.

    Returns:
        0 si se publicó; 1 con motivo si falta una entrada o no está admitida.
    """
    argparse.ArgumentParser(description=__doc__).parse_args(argv)
    return con_motivo(lambda: publicar_globales(RAIZ), linea_de_fallo=True)


if __name__ == "__main__":
    sys.exit(main())
