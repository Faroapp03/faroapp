"""La composición de TIC-H requiere sus dos fuentes admitidas y conserva su procedencia."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.tic_llars.lector as tic_llars
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import Carpetas, Controles, FormatoInesperado, ValidacionFallida
from plataforma_datos.ia_y_trabajo.fuentes.tich import edicion as estado
from plataforma_datos.ia_y_trabajo.fuentes.tich.exportacion import paquete_tich
from plataforma_datos.orquestacion import admision


class PruebaPaqueteTich(unittest.TestCase):
    """Lecturas reales de dos conjuntos mínimos, fuera de las rutas operativas del producto."""

    def setUp(self) -> None:
        """Crea las fuentes y aísla las rutas utilizadas por los lectores reales."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.tich = {"anio": "2025", "cita": "INE, encuesta sintética", "por_isco2": {"41": {"clase": "no_manual"}}}
        self.llars = {
            "cita": "Idescat, encuesta sintética",
            "cifras": {
                indicador: {"valor": valor, "anio": 2025}
                for indicador, valor in zip(tic_llars.NO_SABE_POR_CLASE.values(), (45.8, 33.5), strict=True)
            },
            "tablas": {
                tic_llars.TABLA_NO_SABE: {
                    "url": "https://datos.example/tabla",
                    "sha256": "a" * 64,
                    "descargado_utc": "2026-10-11T23:30:00-04:00",
                }
            },
        }
        for fuente, datos in (("tich", self.tich), (tic_llars.FUENTE, self.llars)):
            carpeta = self.carpetas(fuente)
            carpeta.validado.mkdir(parents=True)
            (carpeta.validado / f"{fuente}.json").write_text(json.dumps(datos), encoding="utf-8")
            controles = Controles()
            controles.comprobar(
                json.loads((carpeta.validado / f"{fuente}.json").read_bytes()) == datos,
                "JSON de la fixture TIC-H conservado",
            )
            carpeta.validacion.write_text(
                json.dumps({"estado": controles.estado, "controles": controles.lista}), encoding="utf-8"
            )
        for modulo in (entrada_salida, admision):
            parche = mock.patch.object(modulo, "carpetas", side_effect=self.carpetas)
            parche.start()
            self.addCleanup(parche.stop)

    def carpetas(self, fuente: str) -> Carpetas:
        """Resuelve exclusivamente carpetas propias del temporal.

        Returns:
            Las tres etapas de la fuente dentro del temporal.
        """
        return Carpetas(
            self.raiz / "original" / fuente, self.raiz / "preparado" / fuente, self.raiz / "validado" / fuente
        )

    def test_conserva_datos_orden_y_dos_origenes(self) -> None:
        """El motivo conserva su base y procedencia sin sustituir los datos del INE."""
        paquete = paquete_tich()
        self.assertEqual({clave: paquete.datos[clave] for clave in self.tich}, self.tich)
        self.assertEqual(list(paquete.datos), [*self.tich, "motivos_no_uso"])
        motivos = paquete.datos["motivos_no_uso"]
        self.assertEqual(motivos["no_sabia_como_utilizarlas"], {"manual": 45.8, "no_manual": 33.5})
        self.assertEqual((motivos["anio"], motivos["consultado"]), ("2025", "2026-10-11"))
        self.assertEqual(motivos["fuente"], self.llars["cita"])
        self.assertEqual(motivos["sha256"], "a" * 64)
        self.assertEqual(
            paquete.origenes,
            [self.carpetas(fuente).validado / f"{fuente}.json" for fuente in ("tich", tic_llars.FUENTE)],
        )

    def test_cada_encuesta_declara_su_anio_y_los_motivos_pueden_ser_del_anterior(self) -> None:
        """Con la TIC-H de 2026 y el Idescat de 2025 se exporta, y cada cifra conserva su año."""
        self.tich["anio"] = "2026"
        (self.carpetas("tich").validado / "tich.json").write_text(json.dumps(self.tich), encoding="utf-8")
        dos = {**estado.primera(), "anio": "2026", "anios_medidos": ["2025", "2026"]}
        estado.guardar(estado.valida(dos), self.carpetas("tich").validado / "edicion.json")
        paquete = paquete_tich()
        self.assertEqual((paquete.datos["anio"], paquete.datos["motivos_no_uso"]["anio"]), ("2026", "2025"))

    def test_el_anio_del_paquete_tiene_que_ser_el_de_la_edicion_admitida(self) -> None:
        """Con el estado en 2026 y el conjunto validado de 2025, la exportación se detiene y lo dice."""
        dos = {**estado.primera(), "anio": "2026", "anios_medidos": ["2025", "2026"]}
        estado.guardar(estado.valida(dos), self.carpetas("tich").validado / "edicion.json")
        with self.assertRaisesRegex(FormatoInesperado, "es de 2025 y la edición admitida es la de 2026"):
            paquete_tich()

    def test_con_el_conjunto_de_2026_y_el_estado_en_2025_la_exportacion_se_detiene(self) -> None:
        """Un corte entre guardar la validación y el estado deja los años cruzados: no se exporta."""
        self.tich["anio"] = "2026"
        (self.carpetas("tich").validado / "tich.json").write_text(json.dumps(self.tich), encoding="utf-8")
        with self.assertRaisesRegex(
            FormatoInesperado, "es de 2026 y la edición admitida es la de 2025; repetir validar"
        ):
            paquete_tich()

    def test_no_exporta_motivos_posteriores_al_uso_ni_anios_invalidos(self) -> None:
        """Unos motivos de un año posterior al uso, o un año mal escrito, detienen sin convertir nada."""
        for anio in ("2024", "25", 2025, True, None):
            with self.subTest(anio=anio):
                self.tich["anio"] = anio
                ruta = self.carpetas("tich").validado / "tich.json"
                ruta.write_text(json.dumps(self.tich), encoding="utf-8")
                with self.assertRaisesRegex(FormatoInesperado, "TIC-H.*Idescat.*año"):
                    paquete_tich()

    def test_ninguna_fuente_rechazada_se_exporta(self) -> None:
        """La existencia de un JSON no sustituye la admisión de las dos fuentes."""
        for fuente in ("tich", tic_llars.FUENTE):
            with self.subTest(fuente=fuente):
                ruta = self.carpetas(fuente).validacion
                anterior = ruta.read_bytes()
                ruta.write_text('{"estado":"Con errores","controles":[]}', encoding="utf-8")
                try:
                    with self.assertRaises(ValidacionFallida):
                        paquete_tich()
                finally:
                    ruta.write_bytes(anterior)


if __name__ == "__main__":
    unittest.main()
