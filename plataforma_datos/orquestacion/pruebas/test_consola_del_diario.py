"""La consola del job, que es pública, solo enseña del diario la fase, el estado, la causa y los minutos."""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.orquestacion import diario_mantenimiento as diario

# La identidad con la que el supervisor abre el diario en el job: solicitud, reserva y revisión son privadas.
IDENTIDAD: dict[str, str | int] = {
    "operacion": "ejecutar",
    "run": "45093060752",
    "intento": "1",
    "revisionCodigo": "a" * 40,
    "reserva": "14",
}


class ConsolaDelDiarioPruebas(unittest.TestCase):
    """Cada línea de la consola lleva solo campos de la lista; el diario privado lo guarda todo."""

    def setUp(self) -> None:
        """Abre un diario privado en una carpeta temporal."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.ruta = Path(tmp.name) / "diario.jsonl"

    def _anotar_un_ciclo(self) -> list[dict[str, object]]:
        consola = io.StringIO()
        with diario.abrir(self.ruta, IDENTIDAD), contextlib.redirect_stderr(consola):
            diario.anotar("base", "seleccionada", revisionBase="b" * 40, sha256Manifiesto="c" * 64)
            diario.anotar(
                "etapa-fuente",
                "terminado",
                fuente="formacion",
                etapa="descargar",
                intentoFuente="0123456789abcdef",
                inicio="2026-11-23T02:21:00.000000+00:00",
                fin="2026-11-23T02:42:48.000000+00:00",
                codigo=0,
                causa=None,
            )
            diario.anotar("curso-candidato", "alta", curso="edicion/12345678", campos=["titulo"])
            diario.anotar("motor", "error", causa="plazo-agotado", pasoDeOrigen="motor", mensaje="Texto libre")
            diario.anotar("permiso-inicio", "error", causa="Solicitud 12345678 rechazada")
        return [json.loads(linea) for linea in consola.getvalue().splitlines()]

    def test_ninguna_linea_de_consola_lleva_campos_fuera_de_la_lista(self) -> None:
        """Ni la identidad de la ejecución, ni huellas, ni cursos, ni textos libres salen por la consola."""
        lineas = self._anotar_un_ciclo()
        self.assertEqual(len(lineas), 5)
        permitidos = {*diario.CAMPOS_DE_CONSOLA, "minutos"}
        for linea in lineas:
            self.assertLessEqual(linea.keys(), permitidos)
        texto = json.dumps(lineas)
        for privado in ("45093060752", "a" * 40, "b" * 40, "c" * 64, "12345678", "Texto libre", "0123456789abcdef"):
            self.assertNotIn(privado, texto)

    def test_la_consola_dice_donde_como_por_que_y_cuanto(self) -> None:
        """La etapa de fuente sale con sus minutos y el corte con su causa y su paso de origen."""
        lineas = self._anotar_un_ciclo()
        self.assertEqual(
            lineas[1],
            {
                "fase": "etapa-fuente",
                "estado": "terminado",
                "fuente": "formacion",
                "etapa": "descargar",
                "minutos": 21.8,
            },
        )
        self.assertEqual(
            lineas[3], {"fase": "motor", "estado": "error", "causa": "plazo-agotado", "pasoDeOrigen": "motor"}
        )
        # Una causa que no es un nombre del código no sale: podría llevar un identificador.
        self.assertEqual(lineas[4], {"fase": "permiso-inicio", "estado": "error"})

    def test_el_diario_privado_conserva_cada_linea_entera(self) -> None:
        """Lo que la consola calla sigue en el diario que se archiva en el almacén privado."""
        self._anotar_un_ciclo()
        eventos = [json.loads(linea) for linea in self.ruta.read_text().splitlines()]
        self.assertEqual([evento["reserva"] for evento in eventos], ["14"] * 5)
        self.assertEqual(eventos[0]["sha256Manifiesto"], "c" * 64)
        self.assertEqual(eventos[2]["curso"], "edicion/12345678")


if __name__ == "__main__":
    unittest.main()
