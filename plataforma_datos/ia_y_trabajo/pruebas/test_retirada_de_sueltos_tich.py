"""Los originales sueltos de 2025 se retiran solo en una consulta, tras validar sus copias y con su huella de ahora."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.tich.lector as tich
from plataforma_datos.comun.entrada_salida import guardar_json, sha256_bytes
from plataforma_datos.ia_y_trabajo.fuentes.tich import edicion as estado
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import ARCHIVOS

AHORA = "2026-11-15T05:00:00+00:00"
LEIDOS = [f"2025/{archivo['archivo']}" for archivo in ARCHIVOS]


class PruebaRetiradaDeLosSueltos(unittest.TestCase):
    """Tres condiciones: copias validadas, solo los registrados con su huella de ahora y nunca en una reconstrucción."""

    def setUp(self) -> None:
        """Aísla los originales y las rutas de preparación y validación."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        raiz = Path(temporal.name)
        original = raiz / "originales"
        original.mkdir()
        preparado = raiz / "preparados"
        validado = raiz / "validados"
        for nombre, ruta in (
            ("ORIGINAL", original),
            ("PROCEDENCIA", original / "procedencia.json"),
            ("VALIDADO", validado),
            ("ESTADO_EDICION", validado / "edicion.json"),
            ("ESTIMACIONES", preparado / "estimaciones.json"),
            ("PUBLICADAS", preparado / "publicadas.json"),
            ("PREPARADA", preparado / "candidata.json"),
        ):
            self.enterContext(mock.patch.object(tich, nombre, ruta))

    def migrados(self, carpeta: Path, cambiado: str = "") -> None:
        """Deja los sueltos de 2025 migrados a su carpeta; con `cambiado`, ese suelto ya no tiene su huella."""
        registros = []
        for archivo in ARCHIVOS:
            datos = f"original {archivo['archivo']}".encode()
            (carpeta / archivo["archivo"]).write_bytes(datos)
            registros.append({"archivo": archivo["archivo"], "sha256": sha256_bytes(datos)})
        guardar_json(carpeta / "procedencia.json", {"fuente": "TIC-H", "archivos": registros})
        self.assertTrue(estado.migrar_originales_planos(carpeta))
        if cambiado:
            (carpeta / cambiado).write_bytes(b"otro")
        (carpeta / "ine-tich-resultados.html").write_bytes(b"catalogo")

    def test_con_las_copias_validadas_retira_los_registrados_y_lo_registra(self) -> None:
        """Retira los cuatro, conserva las copias, el catálogo y las procedencias, y deja el registro."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            self.migrados(carpeta)
            retirados = estado.retirar_sueltos_migrados(carpeta, validados=LEIDOS, ahora=AHORA)
            self.assertEqual([r["archivo"] for r in retirados], [a["archivo"] for a in ARCHIVOS])
            self.assertTrue(all(not (carpeta / a["archivo"]).exists() for a in ARCHIVOS))
            self.assertTrue(all((carpeta / "2025" / a["archivo"]).is_file() for a in ARCHIVOS))
            self.assertTrue((carpeta / "ine-tich-resultados.html").is_file())
            self.assertTrue((carpeta / "procedencia.json").is_file())
            registro = json.loads((carpeta / "2025" / "sueltos-retirados.json").read_text(encoding="utf-8"))
            self.assertEqual(registro, retirados)
            self.assertEqual({r["retirado_utc"] for r in registro}, {AHORA})
            self.assertEqual(estado.retirar_sueltos_migrados(carpeta, validados=LEIDOS, ahora=AHORA), [])

    def test_sin_validar_las_copias_o_sin_su_huella_no_retira_nada(self) -> None:
        """Sin estado de la edición no se toca nada; un suelto que no tiene su huella se queda donde está."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            self.migrados(carpeta, cambiado=ARCHIVOS[1]["archivo"])
            self.assertEqual(estado.retirar_sueltos_migrados(carpeta, validados=[], ahora=AHORA), [])
            self.assertTrue(all((carpeta / a["archivo"]).exists() for a in ARCHIVOS))
            retirados = estado.retirar_sueltos_migrados(carpeta, validados=LEIDOS, ahora=AHORA)
            self.assertNotIn(ARCHIVOS[1]["archivo"], [r["archivo"] for r in retirados])
            self.assertTrue((carpeta / ARCHIVOS[1]["archivo"]).exists())
            (carpeta / "2025" / ARCHIVOS[2]["archivo"]).write_bytes(b"copia rota")
            self.assertEqual(estado.retirar_sueltos_migrados(carpeta, validados=LEIDOS, ahora=AHORA), [])

    def test_solo_la_consulta_la_pide_y_no_la_preparacion_ni_la_validacion(self) -> None:
        """Una reconstrucción prepara y valida: ninguna de las dos etapas retira originales."""
        with mock.patch.object(estado, "retirar_sueltos_migrados") as retirar:
            for etapa in (tich.preparar, tich.validar):
                with (
                    mock.patch.object(tich, "leer_validado", side_effect=RuntimeError("parada")),
                    mock.patch.object(tich, "comprobar_originales", side_effect=RuntimeError("parada")),
                    self.assertRaises(RuntimeError),
                ):
                    etapa()
            retirar.assert_not_called()

    def test_la_migracion_y_la_retirada_nunca_son_de_la_misma_consulta(self) -> None:
        """Con un informe admitido que leyó los sueltos, la consulta que migra no retira; la siguiente, sí."""
        informe = {"estado": "Admitido", "originales_validados": [a["archivo"] for a in ARCHIVOS]}
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            for archivo in ARCHIVOS:
                (carpeta / archivo["archivo"]).write_bytes(f"original {archivo['archivo']}".encode())
            registros = [
                {"archivo": a["archivo"], "sha256": sha256_bytes(f"original {a['archivo']}".encode())} for a in ARCHIVOS
            ]
            guardar_json(carpeta / "procedencia.json", {"fuente": "TIC-H", "archivos": registros})
            validacion = carpeta / "validacion.json"
            guardar_json(validacion, informe)
            with (
                mock.patch.object(tich, "ORIGINAL", carpeta),
                mock.patch.object(tich, "VALIDADO", carpeta),
                mock.patch.object(tich, "ESTADO_EDICION", carpeta / "edicion.json"),
                mock.patch.object(tich, "descubrir_edicion", side_effect=RuntimeError("parada")),
            ):
                for vuelta in range(2):
                    with self.assertRaises(RuntimeError):
                        tich.descargar()
                    sueltos = [(carpeta / a["archivo"]).exists() for a in ARCHIVOS]
                    if vuelta == 0:
                        self.assertEqual(sueltos, [True] * len(ARCHIVOS))
                        guardar_json(validacion, {**informe, "originales_validados": LEIDOS})
                    else:
                        self.assertEqual(sueltos, [False] * len(ARCHIVOS))

    def test_sin_que_la_ultima_validacion_leyera_las_copias_no_retira(self) -> None:
        """Una validación que leyó los sueltos (sin ruta de año) o no admitida no basta."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            self.migrados(carpeta)
            for leidos in ([a["archivo"] for a in ARCHIVOS], LEIDOS[:-1]):
                self.assertEqual(estado.retirar_sueltos_migrados(carpeta, validados=leidos, ahora=AHORA), [])
            self.assertTrue(all((carpeta / a["archivo"]).exists() for a in ARCHIVOS))


if __name__ == "__main__":
    unittest.main()
