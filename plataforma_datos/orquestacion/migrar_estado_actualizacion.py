"""Migración explícita y única de estado.json a v5, sin ejecutar ni fechar otra actualización.

Uso: python -m plataforma_datos.orquestacion.migrar_estado_actualizacion --raiz <copia> --sha256-estado <huella>
Conserva el original íntegro en estado-pre-v5-<SHA>.json antes de reemplazar el único archivo mutable.
El reemplazo es atómico bajo el cerrojo común; una interrupción anterior deja el legado, una posterior deja v5.
La copia anterior permite volver atrás junto con su código anterior. No borra informes/avisos ni recupera datos.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

from plataforma_datos.comun.entrada_salida import retirar_temporales
from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.orquestacion import estado_de_la_actualizacion as estado
from plataforma_datos.orquestacion import estado_panel as panel
from plataforma_datos.orquestacion.modulos import IDS
from plataforma_datos.orquestacion.ordenes import con_motivo
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES
from plataforma_datos.orquestacion.sustitucion import cerrojo, escribir_atomico

VERSION_EDITORIAL = 2

IDS_REGISTRO_ANTERIOR = frozenset(
    (
        "esco",
        "oit",
        "clasificaciones",
        "cambra",
        "cataluna",
        "ocupados",
        "censo",
        "tich",
        "salarios",
        "formacion",
        "consorci",
        "agencia",
        "acreditacion",
        "citilab",
        "abierta",
        "derechos",
        "textos",
        "idescat",
        "catalan",
        "nombres",
        "sectores",
        "empresas",
        "observatori",
        "necesidades",
        "perfiles",
        "certificados2016",
        "actic",
        "barcelonactiva",
        "fundae",
        "memoria",
        "territorios",
        "mundo_eurostat",
        "ilostat",
        "tic_llars",
        "clima_empresarial",
        "ue_eurostat",
        "decada_digital",
        "eurobarometro",
        "ceo_panel",
        "ia_nacional_isl",
        "ia_nacional_gbr",
        "ia_nacional_bra",
        "ia_nacional_che",
        "ia_nacional_isr",
        "ia_nacional_kor",
        "datos_globales",
        "paquete",
    )
)

# Inventario v2 histórico, exclusivamente para esta migración explícita.
IDS_REGISTRO_V2 = IDS_REGISTRO_ANTERIOR | {"lecturas"}
IDS_REGISTRO_V3_V4 = IDS_REGISTRO_V2 | {"enlaces_lecturas"}


def _convertir(documento: dict, huella: str) -> dict:
    version = documento.get("version")
    exigir(
        version is None and "version" not in documento or type(version) is int and version in (2, 3, 4),
        "versión histórica no admitida",
    )
    claves = {"actualizacion", "modulos"} | ({"version"} if version is not None else set())
    exigir(set(documento) == claves, "campos históricos desconocidos")
    esperados = (
        IDS_REGISTRO_ANTERIOR
        if version is None
        else IDS_REGISTRO_V2
        if version == VERSION_EDITORIAL
        else IDS_REGISTRO_V3_V4
    )
    modulos = documento["modulos"]
    exigir(isinstance(modulos, dict) and set(modulos) == esperados, "inventario histórico incompleto o desconocido")
    actualizacion = documento["actualizacion"]
    campos = {"comienzo_utc", "veredicto", "informe"} | (
        {"huella_resultados"} if version == estado.VERSION_CON_HUELLA else set()
    )
    exigir(isinstance(actualizacion, dict) and set(actualizacion) == campos, "actualización histórica no válida")
    resultado = {
        "version": estado.VERSION_REGISTRO,
        "origen_migracion": {"version": version, "sha256_estado": huella},
        "actualizacion": {
            **actualizacion,
            "huella_resultados": actualizacion.get("huella_resultados"),
            "integridad_resultados": estado.HUELLA_CONSERVADA
            if version == estado.VERSION_CON_HUELLA
            else estado.SIN_HUELLA_HISTORICA,
        },
        "modulos": {nombre: modulos[nombre] if nombre in modulos else dict(estado.SIN_INTENTO) for nombre in IDS},
    }
    # Valida exactamente cronología, contadores, campos e inventario que consume el panel; no lee fuentes ni reloj.
    comienzo = panel.instante_utc(actualizacion["comienzo_utc"])
    panel.modulos_de_registro_panel(resultado, comienzo)
    return resultado


IDS_CURSOS = frozenset({"hp_life", "cibervoluntarios", "claude_academy"})
IDS_EDITORIALES = frozenset({"hechos_informe"})
# Los productores del mercado laboral que antes leía a mano la exportación de mercado.
IDS_PRODUCTORES_MERCADO = frozenset({"epa", "eaes", "ofertas"})
# La comprobación periódica de los enlaces de la formación.
IDS_ENLACES = frozenset({"enlaces"})
IDS_ALTAS_V5 = IDS_CURSOS | IDS_EDITORIALES | IDS_PRODUCTORES_MERCADO | IDS_ENLACES
IDS_V5_CON_CURSOS = IDS_REGISTRO_V3_V4 | IDS_CURSOS
IDS_V5_CON_EDITORIALES = IDS_V5_CON_CURSOS | IDS_EDITORIALES
IDS_V5_CON_MERCADO = IDS_V5_CON_EDITORIALES | IDS_PRODUCTORES_MERCADO
# Los inventarios v5 revisados que una ampliación completa sin inventar intentos: solo le faltan altas.
INVENTARIOS_V5_ANTERIORES = (IDS_REGISTRO_V3_V4, IDS_V5_CON_CURSOS, IDS_V5_CON_EDITORIALES, IDS_V5_CON_MERCADO)


def ampliar_inventario_v5(documento: dict) -> dict:
    """Amplía solo los inventarios v5 revisados de 49, 52, 53 o 56 registros, sin inventar intentos.

    Returns:
        Mismos hechos, fechas, huellas, errores y origen; solo amplía el inventario.
    """
    estado.comprobar_cabecera_estado(documento)
    exigir(set(IDS) == IDS_V5_CON_MERCADO | IDS_ENLACES, "inventario de destino distinto del alta revisada")
    exigir(
        isinstance(documento["modulos"], dict) and frozenset(documento["modulos"]) in INVENTARIOS_V5_ANTERIORES,
        "inventario v5 anterior incompleto o desconocido",
    )
    resultado = {
        **documento,
        "modulos": {
            nombre: documento["modulos"][nombre] if nombre in documento["modulos"] else dict(estado.SIN_INTENTO)
            for nombre in IDS
        },
    }
    panel.modulos_de_registro_panel(resultado, panel.instante_utc(documento["actualizacion"]["comienzo_utc"]))
    return resultado


def _respaldo(raiz: Path, huella: str) -> Path:
    return raiz / CARPETA_DE_INFORMES / estado.nombre_respaldo_migracion(huella)


def _guardar(ruta: Path, contenido: str) -> None:
    exigir(not ruta.is_symlink(), "salida de migración enlazada")
    escribir_atomico(ruta, contenido)


def migrar(raiz: Path, *, sha256_estado: str) -> Path:
    """Migra la copia elegida bajo el cerrojo común; repetir conserva bytes y fechas.

    Returns:
        Ruta del estado vigente, con el respaldo original conservado por SHA.
    """
    exigir(
        isinstance(sha256_estado, str) and panel.HUELLA.fullmatch(sha256_estado) is not None,
        "SHA256 del estado esperado no válido",
    )
    with cerrojo(raiz):
        contenido = panel.leer_bytes_registro_panel(raiz)
        exigir(contenido is not None, "no existe estado que migrar")
        documento = panel.documento_registro_panel(contenido)
        ruta = raiz / CARPETA_DE_INFORMES / estado.ARCHIVO
        retirar_temporales(ruta, ".tmp")  # Restos de un corte anterior: el cerrojo excluye otra escritura.
        huella = hashlib.sha256(contenido).hexdigest()
        if documento.get("version") == estado.VERSION_REGISTRO:
            if set(documento.get("modulos", {})) != set(IDS):
                exigir(huella == sha256_estado, "estado distinto del esperado")
                nuevo = ampliar_inventario_v5(documento)
            else:
                panel.modulos_de_registro_panel(
                    documento, panel.instante_utc(documento["actualizacion"]["comienzo_utc"])
                )
                origen = documento["origen_migracion"]
                repetida_alta = False
                respaldo_alta = _respaldo(raiz, sha256_estado)
                if huella != sha256_estado and respaldo_alta.exists():
                    exigir(
                        not respaldo_alta.is_symlink()
                        and hashlib.sha256(respaldo_alta.read_bytes()).hexdigest() == sha256_estado,
                        "respaldo de alta ausente o alterado",
                    )
                    anterior = panel.documento_registro_panel(respaldo_alta.read_bytes())
                    if anterior.get("version") == estado.VERSION_REGISTRO:
                        repetida_alta = ampliar_inventario_v5(anterior) == documento
                exigir(
                    huella == sha256_estado
                    or repetida_alta
                    or origen is not None
                    and origen["sha256_estado"] == sha256_estado,
                    "estado distinto del esperado",
                )
                if origen is not None:
                    respaldo = _respaldo(raiz, origen["sha256_estado"])
                    exigir(
                        not respaldo.is_symlink()
                        and hashlib.sha256(respaldo.read_bytes()).hexdigest() == origen["sha256_estado"],
                        "respaldo de migración ausente o alterado",
                    )
                return ruta
        else:
            exigir(huella == sha256_estado, "estado distinto del esperado")
            nuevo = _convertir(documento, huella)
        return _sustituir_con_respaldo(raiz, contenido, nuevo)


def _sustituir_con_respaldo(raiz: Path, contenido: bytes, nuevo: dict) -> Path:
    """Guarda el estado anterior en su respaldo por SHA y escribe el nuevo; se llama con el cerrojo común tomado.

    Returns:
        Ruta del estado vigente.
    """
    ruta = raiz / CARPETA_DE_INFORMES / estado.ARCHIVO
    huella = hashlib.sha256(contenido).hexdigest()
    respaldo = _respaldo(raiz, huella)
    if respaldo.exists():
        exigir(not respaldo.is_symlink() and respaldo.read_bytes() == contenido, "respaldo anterior alterado")
    else:
        _guardar(respaldo, contenido.decode("utf-8"))
    exigir(ruta.read_bytes() == contenido, "el estado cambió durante la migración")
    _guardar(ruta, json.dumps(nuevo, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    return ruta


def ampliar_al_arrancar(raiz: Path) -> bool:
    """Aplica sola, con el cerrojo de la actualización ya tomado, una ampliación v5 que solo añade módulos.

    Solo si el estado es v5 y su inventario es exactamente uno de INVENTARIOS_V5_ANTERIORES: los módulos nuevos
    empiezan sin intento y el estado anterior queda en su respaldo. Cualquier otro inventario se deja como está, y la
    lectura del estado detiene la actualización nombrando la orden de migración.

    Returns:
        True si ha ampliado el estado.
    """
    contenido = panel.leer_bytes_registro_panel(raiz)
    if contenido is None or not _solo_faltan_altas(contenido):
        return False
    retirar_temporales(raiz / CARPETA_DE_INFORMES / estado.ARCHIVO, ".tmp")
    _sustituir_con_respaldo(raiz, contenido, ampliar_inventario_v5(panel.documento_registro_panel(contenido)))
    return True


def por_ampliar(raiz: Path) -> bool:
    """Si el estado es un v5 al que solo le faltan altas: el que una actualización real ampliaría al arrancar.

    No escribe nada; lo usa el ensayo, que no modifica el estado.

    Returns:
        True si la actualización real lo ampliaría.
    """
    contenido = panel.leer_bytes_registro_panel(raiz)
    return contenido is not None and _solo_faltan_altas(contenido)


def aviso_del_estado(raiz: Path, *, ensayo: bool) -> str | None:
    """Lo que impide actualizar o ensayar con el estado actual, en una línea con la orden que lo resuelve.

    La actualización real ya ha ampliado sola un estado al que solo le faltaban altas. Un ensayo no escribe el estado:
    con uno así, avisa de que la real lo ampliará. Con otro inventario, la lectura del estado dice qué orden lo
    convierte.

    Returns:
        El aviso, o None si el estado se puede leer tal como está.
    """
    if ensayo and por_ampliar(raiz):
        return (
            "No se ensaya: el estado no tiene aún los módulos nuevos del registro; la actualización real lo ampliará "
            "sola al arrancar."
        )
    try:
        estado.leer_estado(raiz)
    except FormatoInesperado as error:
        return f"No se {'ensaya' if ensayo else 'actualiza'}: {error}."
    return None


def _solo_faltan_altas(contenido: bytes) -> bool:
    documento = panel.documento_registro_panel(contenido)
    modulos = documento.get("modulos")
    return (
        documento.get("version") == estado.VERSION_REGISTRO
        and isinstance(modulos, dict)
        and frozenset(modulos) in INVENTARIOS_V5_ANTERIORES
    )


def main(argv: list[str] | None = None) -> int:
    """Ejecuta solo la migración solicitada sobre una raíz y huella explícitas.

    Returns:
        Cero si se conserva/migra la copia; uno con motivo si no se admite.
    """
    analizador = argparse.ArgumentParser(description=__doc__)
    analizador.add_argument("--raiz", required=True, type=Path)
    analizador.add_argument("--sha256-estado", required=True)
    argumentos = analizador.parse_args(argv)

    def convertir() -> None:
        migrar(argumentos.raiz, sha256_estado=argumentos.sha256_estado)

    return con_motivo(convertir)


if __name__ == "__main__":
    sys.exit(main())
