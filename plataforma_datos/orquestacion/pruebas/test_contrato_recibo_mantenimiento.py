"""El almacén Python y el receptor TypeScript admiten el mismo banco de recibos."""

import copy
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.comun.nucleo import RAIZ
from plataforma_datos.orquestacion import almacen_trabajos
from plataforma_datos.orquestacion.pruebas.test_almacen_trabajos import recibo


def leer_en_typescript(casos: list[dict]) -> list[bool]:
    """Pasa cada recibo por el receptor TypeScript real.

    Returns:
        Si cada recibo es válido para leerResultado.

    Raises:
        AssertionError: Si no hay Node para comprobar el contrato compartido.
    """
    nodo = shutil.which("node")
    if nodo is None:
        raise AssertionError("Node es necesario para comprobar el contrato compartido")
    programa = """
import { readFileSync } from 'node:fs';
import { leerResultado } from './src/administracion/resultado-actualizacion.ts';
const casos = JSON.parse(readFileSync(process.argv[1], 'utf8'));
console.log(JSON.stringify(casos.map(caso => {
  try { leerResultado(caso); return true; } catch { return false; }
})));
"""
    with tempfile.TemporaryDirectory(prefix="contrato recibo ") as nombre:
        ruta = Path(nombre) / "casos.json"
        ruta.write_text(json.dumps(casos), encoding="utf-8")
        resultado = subprocess.run(
            [nodo, "--input-type=module", "--eval", programa, str(ruta)],
            cwd=RAIZ,
            env={"PATH": os.environ.get("PATH", os.defpath)},
            capture_output=True,
            check=True,
            text=True,
            timeout=10,
        )
    return json.loads(resultado.stdout)


class ContratoReciboMantenimientoTest(unittest.TestCase):
    """Contraste entre lenguajes sobre valores y relaciones del contrato público."""

    def test_mismo_contrato_para_conservacion_y_receptor(self) -> None:
        """Ejecuta ambos lectores reales sobre recibos válidos y mutaciones inválidas."""
        # Las variantes de versión parten de la forma sin catálogo; la v3 que emite el candidato va aparte.
        valido = json.loads(recibo(version=1))
        banco = [valido, json.loads(recibo(resultado="rechazado", version=1))]
        sin_pendientes = copy.deepcopy(valido)
        sin_pendientes.update(
            accion="reintentar-pendientes", resultado="sin-pendientes", huellaPaquete=None, veredicto=None
        )
        banco.append(sin_pendientes)
        esperados = [True, True, True]
        banco += [json.loads(recibo()), json.loads(recibo(resultado="rechazado"))]
        esperados += [True, True]
        for version in (1, 2, 3, True):
            for accion in ("actualizar-datos", "reintentar-pendientes", "comprobar-programada", "desplegar"):
                for resultado in ("validado", "rechazado", "sin-pendientes", "sin-trabajo"):
                    variante = copy.deepcopy(
                        sin_pendientes
                        if resultado == "sin-pendientes"
                        else json.loads(recibo(resultado=resultado, version=1))
                    )
                    variante.update(version=version, accion=accion, resultado=resultado)
                    banco.append(variante)
                    esperados.append(
                        type(version) is int
                        and version in (1, 2)
                        and accion in (almacen_trabajos.ACCIONES_V1 if version == 1 else almacen_trabajos.ACCIONES)
                        and resultado in ("validado", "rechazado", "sin-pendientes")
                        and (resultado != "sin-pendientes" or accion != "actualizar-datos")
                    )
        for campo, valor in (
            ("version", True),
            ("solicitudId", "otro"),
            ("revisionReserva", True),
            ("revisionReserva", 9007199254740992),
            ("resultado", "activo"),
            ("veredicto", "rojo"),
            ("terminadoEn", "2026-02-30T12:00:00Z"),
            ("terminadoEn", "0000-01-01T00:00:00Z"),
            ("terminadoEn", "2026-10-16T12:00:00.000Z"),
            ("error", "interno"),
            ("huellaPaquete", "f" * 15),
            ("estado", None),
            ("extra", "ruta privada"),
        ):
            variante = copy.deepcopy(valido)
            variante[campo] = valor
            banco.append(variante)
        for campo, valor in (
            ("fallos", True),
            ("fallos", 1),
            ("proximoReintento", "2026-11-01T00:00:00Z"),
            ("veredicto", "ámbar"),
            ("ultimoIntento", "2026-12-01T00:00:00Z"),
            ("ultimaVersionBuena", {"fecha": "2026-10-16T12:00:00Z", "huella": "c" * 64}),
        ):
            variante = copy.deepcopy(valido)
            variante["estado"]["modulos"][0][campo] = valor
            banco.append(variante)
        python = []
        for contenido in banco:
            try:
                almacen_trabajos._recibo(json.dumps(contenido).encode())
            except ValueError:
                python.append(False)
            else:
                python.append(True)
        javascript = leer_en_typescript(banco)
        self.assertEqual(python[: len(esperados)], esperados)
        self.assertEqual(python, javascript)


if __name__ == "__main__":
    unittest.main()
