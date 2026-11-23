"""El paquete exige ambas fuentes admitidas y la procedencia de cada relación."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import Carpetas, Controles, ValidacionFallida
from plataforma_datos.cursos.fuentes.acreditacion.exportacion import paquete_acreditacion
from plataforma_datos.cursos.fuentes.acreditacion.piezas.constantes import HUELLA_DE_LA_REGLA
from plataforma_datos.orquestacion import admision


class PruebaPaqueteAcreditacion(unittest.TestCase):
    """Dos archivos admitidos se combinan sin omitir la trazabilidad de sus decisiones."""

    def setUp(self) -> None:
        """Crea las dos fuentes admitidas en una carpeta temporal propia."""
        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)
        self.raiz = Path(self.temporal.name)
        self.acreditacion = {
            "comprobado": "2026-10-06",
            "revision": {
                "regla_sha256": HUELLA_DE_LA_REGLA,
                "fecha": "2026-10-07",
                "lista": "otra carpeta/revisiones/admitidas.tsv",
                "ids": {"ocupacion": {"certificado": "R-0123456"}},
            },
            "relaciones": {"ocupaciones": {"ocupacion": [["certificado", "ocupacion"]]}},
        }
        self.memoria = {"periodo": "2022-2025", "puntos_de_orientacion": 344}
        for fuente, datos in (("acreditacion", self.acreditacion), ("memoria-fpcat", self.memoria)):
            carpeta = self.carpetas(fuente).validado
            carpeta.mkdir(parents=True)
            (carpeta / f"{fuente}.json").write_text(json.dumps(datos), encoding="utf-8")
            controles = Controles()
            controles.comprobar(
                json.loads((carpeta / f"{fuente}.json").read_bytes()) == datos,
                "JSON de la fixture de acreditación conservado",
            )
            self.carpetas(fuente).validacion.write_text(
                json.dumps({"estado": controles.estado, "controles": controles.lista}), encoding="utf-8"
            )
        for modulo in (entrada_salida, admision):
            parche = mock.patch.object(modulo, "carpetas", side_effect=self.carpetas)
            parche.start()
            self.addCleanup(parche.stop)

    def carpetas(self, fuente: str) -> Carpetas:
        """Rutas aisladas de la fuente, también usadas por los lectores reales.

        Returns:
            Originales, preparados y validados de la fuente dentro del temporal.
        """
        return Carpetas(
            self.raiz / "original" / fuente, self.raiz / "preparado" / fuente, self.raiz / "validado" / fuente
        )

    def test_combina_las_fuentes_y_conserva_sus_origenes(self) -> None:
        """La ruta de revisión es trasladable; cada fuente conserva su contenido y posición."""
        paquete = paquete_acreditacion()
        self.assertEqual(paquete.datos, {**self.acreditacion, "memoria_fpcat": self.memoria})
        self.assertEqual(list(paquete.datos), [*self.acreditacion, "memoria_fpcat"])
        self.assertEqual(
            paquete.origenes,
            [self.carpetas(fuente).validado / f"{fuente}.json" for fuente in ("acreditacion", "memoria-fpcat")],
        )

    def test_ambas_fuentes_necesitan_admision(self) -> None:
        """Un JSON existente no basta cuando su validación rechaza la fuente."""
        for fuente in ("acreditacion", "memoria-fpcat"):
            with self.subTest(fuente=fuente):
                ruta = self.carpetas(fuente).validacion
                anterior = ruta.read_bytes()
                ruta.write_text('{"estado":"Con errores","controles":[]}', encoding="utf-8")
                try:
                    with self.assertRaises(ValidacionFallida):
                        paquete_acreditacion()
                finally:
                    ruta.write_bytes(anterior)

    def test_relacion_sin_procedencia_no_se_exporta(self) -> None:
        """Incluso una fuente admitida debe identificar la revisión de cada relación."""
        self.acreditacion["revision"]["ids"] = {}
        ruta = self.carpetas("acreditacion").validado / "acreditacion.json"
        ruta.write_text(json.dumps(self.acreditacion), encoding="utf-8")
        with self.assertRaisesRegex(ValidacionFallida, "relaciones sin id"):
            paquete_acreditacion()

    def test_fecha_de_comprobacion_ilegible_no_se_exporta(self) -> None:
        """Los requisitos se enseñan con su fecha: si no se puede leer, falla la construcción, no la persona."""
        ruta = self.carpetas("acreditacion").validado / "acreditacion.json"
        for fecha in ("no es fecha", "2026-02-30", "2026-1-1", "", None):
            with self.subTest(fecha=fecha):
                ruta.write_text(json.dumps({**self.acreditacion, "comprobado": fecha}), encoding="utf-8")
                with self.assertRaisesRegex(ValidacionFallida, "fecha de comprobación"):
                    paquete_acreditacion()
        sin_fecha = {k: v for k, v in self.acreditacion.items() if k != "comprobado"}
        ruta.write_text(json.dumps(sin_fecha), encoding="utf-8")
        with self.assertRaisesRegex(ValidacionFallida, "fecha de comprobación"):
            paquete_acreditacion()


if __name__ == "__main__":
    unittest.main()
