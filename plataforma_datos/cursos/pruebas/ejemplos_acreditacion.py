"""Ejemplos inventados compartidos por las pruebas de acreditación."""

import csv
import hashlib
from pathlib import Path

from plataforma_datos.cursos.fuentes.acreditacion.piezas.constantes import (
    CABECERA_DE_LA_REVISION,
    JUICIOS_DE_LA_REVISION,
)

REGLA_DE_EJEMPLO = hashlib.sha256(b"regla inventada para las pruebas").hexdigest()


def linea(codigo: str, texto: str, clase: str, grupos: list[str]) -> dict[str, object]:
    """Una línea de «Ocupaciones o puestos de trabajo relacionados» ya clasificada.

    Returns:
        Línea clasificada, con su código, texto, clase y grupos.
    """
    return {"codigo": codigo, "texto": texto, "clase": clase, "grupos": grupos}


def certificado(**cambios: object) -> dict[str, object]:
    """Un certificado preparado con su anexo leído, con los cambios indicados.

    Returns:
        Certificado preparado con los cambios.
    """
    unidad = {
        "codigo": "UC0981_2",
        "nombre_es": "Realizar registros contables",
        "nombre_ca": "Registres",
        "modulo": "MF0981_2",
        "horas": 120,
    }
    base = {
        "codigo": "ADGD0308",
        "nivel": 2,
        "familia": "ADG",
        "unidades": [unidad],
        "anexo": {"nivel": 2, "real_decreto": "645/2011", "ocupaciones": [{"clase": "cno11"}]},
        "ocupaciones": ["41111011"],
        "grupos": [],
        "equivalencias": {},
    }
    return {**base, **cambios}


def fila_admitida(esco: str, certificado: str, juicios: str = "CCCC", **cambios: str) -> dict[str, str]:
    """Una fila inventada de admitidas.tsv: por defecto, los cuatro juicios C (`juicios`, v2_A a v3_B) y una cita.

    Returns:
        Fila de admitidas.tsv por nombre de columna.
    """
    base = {
        "esco": esco,
        "certificado": certificado,
        "estratos": "VIGENTE-ocupacion",
        "en_la_cadena": "sí",
        "decision": "C",
        **dict(zip(JUICIOS_DE_LA_REVISION, juicios, strict=True)),
        "cita": "UC0981_2 Realizar registros contables",
        "fecha": "2026-10-20",
        "regla_sha256": REGLA_DE_EJEMPLO[:12],
        "id": "R-0a1b2c3",
    }
    return {**base, **cambios}


def lista_de_ejemplo(carpeta: Path, filas: list[dict[str, str]], cabecera: tuple[str, ...] | None = None) -> Path:
    """Escribe una admitidas.tsv inventada, con la cabecera que lee la cadena salvo que se pida otra.

    Returns:
        Ruta de la lista escrita.
    """
    columnas = list(cabecera or CABECERA_DE_LA_REVISION)
    ruta = carpeta / "admitidas.tsv"
    with ruta.open("w", newline="", encoding="utf-8") as archivo:
        escritor = csv.writer(archivo, delimiter="\t", lineterminator="\n")
        escritor.writerow(columnas)
        for fila in filas:
            escritor.writerow([fila.get(columna, "") for columna in columnas])
    return ruta
