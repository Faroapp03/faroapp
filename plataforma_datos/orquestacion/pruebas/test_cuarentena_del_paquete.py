"""Cuarentena de archivos del paquete: qué va junto, qué se conserva y qué se acepta (piezas_de_la_actualizacion)."""

import hashlib
import json
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.orquestacion import cuarentena_del_paquete as cuarentena
from plataforma_datos.orquestacion import piezas_de_la_actualizacion as piezas

ORIGEN_FORMACION = "var/actualizacion/preparados/formacion/formacion.json"


def escribir(carpeta: Path, archivos: dict[str, object], origenes: dict[str, str]) -> None:
    """Escribe un paquete con su manifiesto: huella real y la carpeta de origen indicada para cada archivo."""
    carpeta.mkdir(parents=True, exist_ok=True)
    manifiesto = {}
    for nombre, datos in archivos.items():
        contenido = json.dumps(datos).encode()
        (carpeta / nombre).write_bytes(contenido)
        manifiesto[nombre] = {"origenes": {origenes[nombre]: "0" * 64}, "sha256": hashlib.sha256(contenido).hexdigest()}
    (carpeta / "manifiesto.json").write_text(json.dumps(manifiesto), encoding="utf-8")


class PruebaCuarentena(unittest.TestCase):
    """Un archivo que supera el umbral conserva su versión publicada junto con los que salen de sus mismas entradas."""

    ORIGENES = {
        "formacion.json": ORIGEN_FORMACION,
        "correspondencia-eures.json": "var/actualizacion/preparados/formacion/eures.json",
        "mercado.json": "var/actualizacion/originales/observatori/tabla.csv",
        "observatori.json": "var/actualizacion/validados/observatori/observatori.json",
        "esco.json": "var/actualizacion/validados/esco/biblioteca.sqlite",
    }

    def setUp(self) -> None:
        """Un paquete publicado y uno exportado en el área, con orígenes como los reales."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.vigente, self.nuevo = (Path(temporal.name) / nombre / "datos" for nombre in ("raiz", "area"))
        antes = {nombre: list(range(10)) for nombre in self.ORIGENES}
        escribir(self.vigente, antes, self.ORIGENES)
        escribir(self.nuevo, {**antes, "formacion.json": [1, 2], "esco.json": list(range(11))}, self.ORIGENES)

    def comparacion(self, previa: dict[str, dict] | None = None) -> piezas.Comparacion:
        """Compara ambos paquetes y elige su cuarentena.

        Returns:
            La comparación con la cuarentena elegida.
        """
        raiz, area = self.vigente.parent, self.nuevo.parent
        comparacion = piezas.comparar(raiz, area)
        return cuarentena.elegir_cuarentena(comparacion, self.vigente, self.nuevo, previa or {})

    def test_los_archivos_de_unas_mismas_entradas_van_juntos(self) -> None:
        """formacion.json y correspondencia-eures.json comparten entradas; esco.json, no."""
        grupos = cuarentena.grupos_de_cuarentena((json.loads((self.vigente / "manifiesto.json").read_text()),))
        self.assertEqual(grupos["formacion.json"], {"formacion.json", "correspondencia-eures.json"})
        self.assertEqual(grupos["mercado.json"], {"mercado.json", "observatori.json"})
        self.assertEqual(grupos["esco.json"], {"esco.json"})

    def test_conserva_el_grupo_y_publica_el_resto(self) -> None:
        """La versión publicada vuelve al paquete nuevo con su entrada del manifiesto; esco.json sigue nuevo."""
        comparacion = self.comparacion()
        self.assertEqual(comparacion.retenidos, {"formacion.json", "correspondencia-eures.json"})
        cuarentena.conservar_en_cuarentena(self.vigente, self.nuevo, comparacion.retenidos)
        for nombre in comparacion.retenidos:
            self.assertEqual((self.nuevo / nombre).read_bytes(), (self.vigente / nombre).read_bytes())
        manifiestos = [json.loads((c / "manifiesto.json").read_text()) for c in (self.vigente, self.nuevo)]
        self.assertEqual(manifiestos[1]["formacion.json"], manifiestos[0]["formacion.json"])
        self.assertEqual(json.loads((self.nuevo / "esco.json").read_text()), list(range(11)))
        self.assertNotEqual(manifiestos[1]["esco.json"], manifiestos[0]["esco.json"])

    def test_una_version_publicada_alterada_no_se_conserva(self) -> None:
        """Si lo publicado no coincide con su manifiesto, la cuarentena no inventa una versión buena."""
        (self.vigente / "formacion.json").write_text("[]", encoding="utf-8")
        with self.assertRaises(cuarentena.CuarentenaImposible):
            cuarentena.conservar_en_cuarentena(self.vigente, self.nuevo, frozenset({"formacion.json"}))

    def test_la_aceptacion_vale_para_la_version_que_se_conservaba(self) -> None:
        """Vale con la misma versión publicada y sin bajar de las cifras aceptadas, aunque cambien los bytes."""
        huella = json.loads((self.vigente / "manifiesto.json").read_text())["formacion.json"]["sha256"]
        nueva = json.loads((self.nuevo / "manifiesto.json").read_text())["formacion.json"]["sha256"]
        registro = {
            "grupo": ["correspondencia-eures.json", "formacion.json"],
            "perdidas": [{"archivo": "formacion.json", "medida": "entradas", "antes": 10, "despues": 2}],
            "desde_utc": "2026-11-13T06:00:00+00:00",
            "ultima_utc": "2026-11-13T06:00:00+00:00",
            "vigente_sha256": huella,
            "exportado_sha256": nueva,
            "aceptada_utc": "2026-11-13T09:00:00+00:00",
        }
        aceptada = self.comparacion({"formacion.json": registro})
        self.assertEqual((aceptada.retenidos, aceptada.aceptados), (frozenset(), ("formacion.json",)))
        otra = self.comparacion({"formacion.json": {**registro, "vigente_sha256": "f" * 64}})
        self.assertEqual((otra.retenidos, otra.aceptados), ({"formacion.json", "correspondencia-eures.json"}, ()))
        otros_bytes = self.comparacion({"formacion.json": {**registro, "exportado_sha256": "e" * 64}})
        self.assertEqual(otros_bytes.aceptados, ("formacion.json",))
        suelo = [{"archivo": "formacion.json", "medida": "entradas", "antes": 10, "despues": 3}]
        por_debajo = self.comparacion({"formacion.json": {**registro, "perdidas": suelo}})
        self.assertEqual(por_debajo.aceptados, ())
        self.assertEqual(por_debajo.cuarentena[0]["exportado_sha256"], nueva)

    def test_una_perdida_que_no_se_vio_no_esta_aceptada(self) -> None:
        """Se aceptó «entradas 12 → 6»; si llega además «cursos SOC 12 → 2», sigue en cuarentena y se avisa."""
        huella = json.loads((self.vigente / "manifiesto.json").read_text())["formacion.json"]["sha256"]
        aceptada = [{"archivo": "formacion.json", "medida": "entradas", "antes": 12, "despues": 6}]
        registro = {
            "grupo": ["correspondencia-eures.json", "formacion.json"],
            "perdidas": aceptada,
            "desde_utc": "2026-11-13T06:00:00+00:00",
            "ultima_utc": "2026-11-13T06:00:00+00:00",
            "vigente_sha256": huella,
            "exportado_sha256": "e" * 64,
            "aceptada_utc": "2026-11-13T09:00:00+00:00",
        }
        entradas = {"archivo": "formacion.json", "medida": "entradas", "antes": 12, "despues": 7}
        cursos = {"archivo": "formacion.json", "medida": "cursos SOC", "antes": 12, "despues": 2}
        self.assertTrue(cuarentena.dentro_de_lo_aceptado(registro, [entradas]))
        self.assertFalse(cuarentena.dentro_de_lo_aceptado(registro, [entradas, cursos]))
        raiz = self.vigente.parent
        carpeta = raiz / piezas.CARPETA_DE_INFORMES
        carpeta.mkdir(parents=True)
        estado = {"version": cuarentena.VERSION_CUARENTENA, "archivos": {"formacion.json": registro}}
        (carpeta / cuarentena.ARCHIVO_DE_CUARENTENA).write_text(json.dumps(estado), encoding="utf-8")
        base = piezas.Comparacion([], [], [], perdidas=(entradas, cursos))
        elegida = cuarentena.elegir_cuarentena(base, self.vigente, self.nuevo, cuarentena.leer_cuarentena(raiz))
        self.assertEqual((elegida.aceptados, elegida.retenidos), ((), {"formacion.json", "correspondencia-eures.json"}))
        avisos: list[str] = []
        cuarentena.registrar_cuarentena(
            raiz, elegida, datetime(2026, 11, 14, 6, tzinfo=UTC), lambda _raiz, texto: avisos.append(texto)
        )
        nuevo = cuarentena.leer_cuarentena(raiz)["formacion.json"]
        self.assertIsNone(nuevo["aceptada_utc"])
        self.assertEqual(nuevo["perdidas"], [entradas, cursos])
        (aviso,) = avisos
        self.assertIn("se aceptó «formacion.json pierde más del 20 % de sus entradas (12 → 6)»", aviso)
        self.assertIn("cursos SOC (12 → 2)", aviso)

    def test_sin_paquete_publicado_ni_cuarentena_no_registra_nada(self) -> None:
        """Una instalación sin paquete publicado no tiene nada que conservar: registrar no escribe ni falla."""
        raiz = self.vigente.parent.parent / "sin-paquete"
        (raiz / piezas.CARPETA_DE_INFORMES).mkdir(parents=True)
        avisos: list[str] = []
        cuarentena.registrar_cuarentena(
            raiz, piezas.Comparacion([], [], []), datetime(2026, 11, 14, 6, tzinfo=UTC), lambda _r, t: avisos.append(t)
        )
        self.assertFalse((raiz / piezas.CARPETA_DE_INFORMES / cuarentena.ARCHIVO_DE_CUARENTENA).exists())
        self.assertEqual(avisos, [])

    def test_un_estado_roto_se_diagnostica(self) -> None:
        """Un estado de cuarentena con otra forma no se lee como vacío."""
        carpeta = self.vigente.parent / piezas.CARPETA_DE_INFORMES
        carpeta.mkdir(parents=True)
        (carpeta / cuarentena.ARCHIVO_DE_CUARENTENA).write_text('{"version": 1, "archivos": {"a.json": {}}}')
        with self.assertRaises(FormatoInesperado):
            cuarentena.leer_cuarentena(self.vigente.parent)
        (carpeta / cuarentena.ARCHIVO_DE_CUARENTENA).write_text("{no es json")
        with self.assertRaises(FormatoInesperado):
            cuarentena.leer_cuarentena(self.vigente.parent)
        self.assertEqual(cuarentena.leer_cuarentena(self.nuevo.parent), {})


if __name__ == "__main__":
    unittest.main()
