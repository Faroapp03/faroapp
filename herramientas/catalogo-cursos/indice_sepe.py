"""Actualiza el índice de niveles desde la exportación oficial conservada del SEPE."""

import argparse
import hashlib
import json
import re
import unicodedata
from datetime import date
from pathlib import Path

from plataforma_datos.comun.hojas import leer_xlsx
from plataforma_datos.comun.textos_y_cifras import texto
from plataforma_datos.cursos.fuentes.formacion.constantes import HOJA_SEPE


def _normalizar(titulo: str) -> str:
    plano = re.sub(r"[\u0300-\u036f]", "", unicodedata.normalize("NFD", titulo.lower()))
    return re.sub(r"[^a-z0-9]+", " ", plano).strip()


def _construir(procedencia: Path) -> dict:
    origen = json.loads(procedencia.read_bytes())
    if origen["fuente_id"] != "sepe-especialidades":
        raise ValueError("La procedencia debe corresponder al catálogo de especialidades del SEPE")
    libro = procedencia.with_name(origen["archivo"])
    if hashlib.sha256(libro.read_bytes()).hexdigest() != origen["sha256"]:
        raise ValueError("La exportación no coincide con su huella")
    captura = date.fromisoformat(origen["descargado"])
    por_codigo = {}
    for fila in leer_xlsx(libro, hoja=HOJA_SEPE):
        celdas = {texto(k): texto(v) for k, v in fila.items()}
        codigo, version = celdas["CÓDIGO"], celdas["VERSIÓN"]
        titulo, nivel = _normalizar(celdas["DENOMINACIÓN"]), celdas["NIVEL DE CUALIFICACIÓN"]
        if not re.fullmatch(r"[A-Z0-9]+", codigo) or not version.isdecimal() or not titulo:
            continue
        versiones = por_codigo.setdefault(codigo, {})
        versiones.setdefault(int(version), set()).add((titulo, nivel))
    especialidades = {}
    for codigo, versiones in sorted(por_codigo.items()):
        version = max(versiones)
        if len(versiones[version]) != 1:
            continue
        titulo, nivel = next(iter(versiones[version]))
        if nivel in ("1", "2", "3"):
            especialidades[codigo] = [titulo, int(nivel), str(version)]
    return {
        "fechaLegible": captura.strftime("%d/%m/%Y"),
        "evidencia": {
            "url": origen["url"],
            "sha256": origen["sha256"],
            "capturadoEl": captura.isoformat(),
        },
        "especialidades": especialidades,
    }


def main() -> None:
    """Regenera el índice sin reescribirlo cuando es idéntico."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("procedencia", type=Path)
    parser.add_argument("salida", type=Path)
    args = parser.parse_args()
    datos = _construir(args.procedencia)
    cuerpo = json.dumps(datos, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"
    if not args.salida.exists() or args.salida.read_text(encoding="utf-8") != cuerpo:
        args.salida.write_text(cuerpo, encoding="utf-8")
    print(len(datos["especialidades"]), "especialidades de nivel 1, 2 o 3")


if __name__ == "__main__":
    main()
