"""Registro diario de Socrata compartido: cabecera propia, fecha, cambio y fallo sin sobrescritura."""

import tempfile
import unittest
from contextlib import ExitStack
from datetime import date
from pathlib import Path
from unittest.mock import patch

import plataforma_datos.cursos.fuentes.consorci.lector as consorci
from plataforma_datos.comun import socrata
from plataforma_datos.comun.entrada_salida import leer_json
from plataforma_datos.comun.nucleo import OriginalCambiado

# Consorci conserva todos sus casos del registro diario de Socrata.
FUENTES_SOCRATA = (consorci,)
# Los conjuntos que cada fuente debe pedir, declarados aparte para que la prueba no repita la lógica del código.
CONJUNTOS_ESPERADOS = {consorci: consorci.CONJUNTOS}
# Los días de la prueba: el previo que ya estaba escrito, la fecha expresa y el que da el reloj.
DIA_PREVIO = date(2026, 10, 4)
DIA_EXPRESO = date(2026, 10, 5)
DIA_DEL_RELOJ = date(2026, 10, 6)


class PruebaRegistroDeLaCopia(unittest.TestCase):
    """Las fuentes conservan sus citas y rutas al compartir el registro diario."""

    def test_cabecera_fecha_y_politica_propias(self) -> None:
        """Consorci conserva la cita, orden JSON y aceptación, con fecha expresa o el día UTC.

        El reloj da otro día que la fecha expresa: la copia lleva la expresa si se da y el día UTC si no.
        """
        expresa = DIA_EXPRESO
        reloj = DIA_DEL_RELOJ
        registros = [{"archivo": "copia.json", "sha256": "huella", "titulo": "Datos publicados"}]
        for fuente in FUENTES_SOCRATA:
            for hoy in (expresa, None):
                for aceptar in (False, True):
                    with (
                        self.subTest(fuente=fuente.FUENTE, hoy=hoy, aceptar=aceptar),
                        tempfile.TemporaryDirectory() as temporal,
                        ExitStack() as parches,
                    ):
                        carpeta = Path(temporal)
                        destino = carpeta / "procedencia.json"
                        parches.enter_context(patch.object(fuente, "ORIGINAL", carpeta))
                        parches.enter_context(patch.object(fuente, "PROCEDENCIA", destino))
                        parches.enter_context(patch.object(socrata, "hoy_utc", return_value=reloj))
                        descarga = parches.enter_context(
                            patch.object(socrata, "descargar_copia", return_value=registros)
                        )
                        fuente.descargar(aceptar, hoy)
                        dia = reloj if hoy is None else expresa
                        descarga.assert_called_once()
                        conjuntos, fecha, candidata, politica = descarga.call_args.args
                        self.assertEqual(
                            (conjuntos, fecha, politica), (CONJUNTOS_ESPERADOS[fuente], dia.isoformat(), aceptar)
                        )
                        self.assertNotEqual(candidata, carpeta)
                        self.assertEqual(candidata.name, carpeta.name)
                        registrada = leer_json(destino)
                        self.assertEqual(list(registrada), ["fuente", "licencia", "cita", "copia", "archivos"])
                        self.assertEqual(
                            registrada,
                            {
                                "fuente": fuente.NOMBRE_FUENTE,
                                "licencia": fuente.LICENCIA,
                                "cita": fuente.ORGANISMO,
                                "copia": dia.isoformat(),
                                "archivos": registros,
                            },
                        )

    def test_un_fallo_conserva_la_procedencia_y_el_motivo(self) -> None:
        """Un cambio rechazado conserva los bytes previos y propaga el mismo error de Consorci."""
        previo = b'{"copia":"%s","archivos":[]}\n' % DIA_PREVIO.isoformat().encode()
        for fuente in FUENTES_SOCRATA:
            with (
                self.subTest(fuente=fuente.FUENTE),
                tempfile.TemporaryDirectory() as temporal,
                ExitStack() as parches,
            ):
                carpeta = Path(temporal)
                destino = carpeta / "procedencia.json"
                destino.write_bytes(previo)
                error = OriginalCambiado("copia del día distinta: revisar antes de aceptar")
                parches.enter_context(patch.object(fuente, "ORIGINAL", carpeta))
                parches.enter_context(patch.object(fuente, "PROCEDENCIA", destino))
                parches.enter_context(patch.object(socrata, "descargar_copia", side_effect=error))
                with self.assertRaises(OriginalCambiado) as observado:
                    fuente.descargar(False, DIA_EXPRESO)
                self.assertIs(observado.exception, error)
                self.assertEqual(destino.read_bytes(), previo)


if __name__ == "__main__":
    unittest.main()
