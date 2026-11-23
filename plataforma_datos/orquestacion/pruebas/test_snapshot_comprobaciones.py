"""Evidencia del panel: mismo contrato Python/JS y conservación exacta del recibo privado."""

import copy
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.comun.nucleo import RAIZ
from plataforma_datos.orquestacion import almacen_trabajos as trabajos
from plataforma_datos.orquestacion.pruebas.test_almacen_trabajos import CODIGO, SOLICITUD, Memoria, recibo, serializar


def _recibo_v2() -> dict:
    documento = json.loads(recibo(version=1))
    documento["version"] = 2
    documento["estado"] = json.loads((RAIZ / "pruebas/fixtures/estado-datos-v2.json").read_text())
    return documento


class SnapshotComprobacionesTest(unittest.TestCase):
    """Los lectores no inventan ni rejuvenecen una comprobación al conservarla."""

    def test_bytes_v2_conservados_sin_convertir_historia(self) -> None:
        """El almacenamiento real preserva incluso los espacios y microsegundos del recibo."""
        almacen = Memoria()
        base = almacen.generacion("base")
        nueva = almacen.generacion("nueva")
        artefacto = almacen.artefacto()
        referencia = trabajos.inicializar_referencia(base, almacen)
        contenido = serializar(_recibo_v2())
        descriptor = trabajos.conservar_trabajo(
            contenido, "123", CODIGO, referencia, nueva, artefacto=artefacto, almacen=almacen
        )
        self.assertEqual(trabajos.recuperar_trabajo(SOLICITUD, 1, "123", almacen), (descriptor, contenido))
        anterior = dict(almacen.objetos)
        self.assertEqual(
            trabajos.conservar_trabajo(
                contenido,
                "123",
                CODIGO,
                trabajos.leer_referencia(almacen),
                nueva,
                artefacto=artefacto,
                almacen=almacen,
            ),
            descriptor,
        )
        self.assertEqual(almacen.objetos, anterior)
        distinto = _recibo_v2()
        distinto["estado"]["observadoEn"] = "2026-10-16T12:00:00.999998Z"
        with self.assertRaises(ValueError):
            trabajos.conservar_trabajo(
                serializar(distinto), "123", CODIGO, referencia, nueva, artefacto=artefacto, almacen=almacen
            )
        self.assertEqual(almacen.objetos, anterior)

    def test_mismos_limites_y_vinculos_en_python_y_javascript(self) -> None:
        """Mutaciones del mismo banco cruzan las fronteras reales, sin red ni datos personales."""
        original = _recibo_v2()
        banco = [original, json.loads(recibo())]
        esperados = [True, True]
        operaciones = [
            (lambda d: d.update(observadoEn="2026-10-16T12:00:01.000001Z")),
            (lambda d: d.update(observadoEn="2026-02-30T12:00:00.000001Z")),
            (lambda d: d.update(observadoEn="0000-01-01T00:00:00.000001Z")),
            (lambda d: d.update(observadoEn="2026-10-16T12:00:00.9999999Z")),
            (lambda d: d["comprobaciones"].update(registradoEn="2026-10-16T12:00:01Z")),
            (lambda d: d["comprobaciones"].update(registradoEn=None)),
            (lambda d: d["comprobaciones"].update(reconstruccionPendiente=1)),
            (lambda d: d["comprobaciones"].update(conjuntos=[])),
            (lambda d: d["comprobaciones"]["conjuntos"].append(d["comprobaciones"]["conjuntos"][0])),
        ]
        for mutar in operaciones:
            variante = copy.deepcopy(original)
            mutar(variante["estado"])
            banco.append(variante)
            esperados.append(False)
        variantes = (
            ("ciclo", "no-es-uuid"),
            ("inicioEn", "2026-10-16T11:59:59.123457Z"),
            ("finEn", None),
            ("finEn", "2026-10-16T11:59:59.123455Z"),
            ("resultado", "local"),
            ("resultado", "interrumpido"),
            ("resultado", "en-curso"),
            ("remoto", False),
            ("remoto", 1),
            ("ultimoIntentoRemotoEn", None),
            ("huellaEvidencia", "a" * 64),
            ("extra", "ruta privada"),
        )
        for campo, valor in variantes:
            variante = copy.deepcopy(original)
            variante["estado"]["fuentes"][0]["ultimaOperacion"][campo] = valor
            banco.append(variante)
            esperados.append(False)
        for campo, valor in (
            ("id", "../otro"),
            ("fuente", "inexistente"),
            ("fuente", None),
            ("alcance", "inventado"),
            ("operacion", "integridad"),
            ("intervaloDias", 0),
            ("intervaloDias", True),
            ("revisionNecesaria", False),
            ("revisionNecesaria", 1),
            ("ultimaComprobacion", None),
            ("extra", "privado"),
        ):
            variante = copy.deepcopy(original)
            variante["estado"]["comprobaciones"]["conjuntos"][0][campo] = valor
            banco.append(variante)
            esperados.append(False)
        for campo, valor in (
            ("fecha", "2026-10-16T11:59:59.123457Z"),
            ("fecha", "2026-10-16T11:59:59.123455Z"),
            ("ciclo", "22222222-2222-4222-8222-222222222222"),
            ("huellaEvidencia", "a" * 64),
            ("extra", "privado"),
        ):
            variante = copy.deepcopy(original)
            variante["estado"]["comprobaciones"]["conjuntos"][0]["ultimaComprobacion"][campo] = valor
            banco.append(variante)
            esperados.append(False)
        self._comparar(banco, esperados)

    def _comparar(self, banco: list[dict], esperados: list[bool]) -> None:
        python = []
        for caso in banco:
            try:
                trabajos._recibo(serializar(caso))
            except ValueError:
                python.append(False)
            else:
                python.append(True)
        nodo = shutil.which("node")
        self.assertIsNotNone(nodo)
        programa = """
import {readFileSync} from 'node:fs';
import {leerResultado} from './src/administracion/resultado-actualizacion.ts';
const casos=JSON.parse(readFileSync(process.argv[1],'utf8'));
console.log(JSON.stringify(casos.map(caso=>{try{leerResultado(caso);return true;}catch{return false;}})));
"""
        with tempfile.TemporaryDirectory(prefix="contrato evidencia ") as nombre:
            ruta = Path(nombre) / "casos.json"
            ruta.write_text(json.dumps(banco))
            salida = subprocess.run(
                [nodo, "--input-type=module", "--eval", programa, str(ruta)],
                cwd=RAIZ,
                env={"PATH": os.environ.get("PATH", os.defpath)},
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            )
        self.assertEqual(python, esperados)
        self.assertEqual(json.loads(salida.stdout), esperados)
