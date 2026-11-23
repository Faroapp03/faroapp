"""Pruebas de FUNDAE: los hechos de una edición, sin contactos, y los controles de la validación."""

import copy
import io
import unittest
from contextlib import redirect_stdout

import plataforma_datos.cursos.fuentes.fundae.lector as fundae
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado
from plataforma_datos.cursos.fuentes.fundae import hechos, salida

EDICION = 3177
CODIGO = "IFCT0049"
PROGRAMA = "https://www.fundae.es/docs/default-source/especialidades/IFCT0049.pdf"


def fila(edicion: int = EDICION) -> dict[str, object]:
    """Una difusión como la publica la API, con los contactos que Faro no guarda.

    Returns:
        La fila de la difusión.
    """
    return {
        "cifEntidadFormadora": "B00000000",
        "entidadFormadora": "ESCUELA  DE PRUEBA, SL",
        "telefonoContacto": "910000000",
        "emailContactoEntidad": "persona@ejemplo.es",
        "domicilio": "CL DE PRUEBA 1",
        "idDifusionAccionFormativa": edicion,
        "fechaPreinscripcionInicio": "2026-09-01T00:00:00",
        "fechaPreinscripcionFin": "2026-10-31T00:00:00",
    }


def centro() -> dict[str, object]:
    """La respuesta de la entidad: su difusión y la ficha del curso, con el sector de la entidad.

    Returns:
        La respuesta, como la publica la API.
    """
    return {
        "centrosRFO": [fila()],
        "curso": {
            "codigoTitulacion": CODIGO,
            "idModalidad": hechos.TELEFORMACION,
            "denominacion": "CHATGPT E  INTELIGENCIA ARTIFICAL",
            "descripcionEstructurasSectoriales": "INTERSECTORIAL",
            "descripcionNivelDigitalizacion": "Intermedio",
            "duracion": 60,
            "url": [{"item1": CODIGO, "item2": PROGRAMA}],
        },
    }


COLECTIVOS = [
    {"idColectivo": 1, "descripcionColectivos": "Soy trabajador asalariado"},
    {"idColectivo": 2, "descripcionColectivos": "Soy autónomo"},
]


class PruebaEdicion(unittest.TestCase):
    """Lo que se lee de las tres respuestas de una edición."""

    def test_los_hechos_de_una_edicion_sin_sus_contactos(self) -> None:
        """Nombre y entidad con espacios simples, plazo en días, colectivos con su nombre y ningún contacto."""
        leida = hechos.edicion(CODIGO, EDICION, {"centrosRFO": [fila(1), fila()]}, centro(), COLECTIVOS)
        self.assertEqual(
            leida,
            {
                "id": "3177",
                "especialidad": CODIGO,
                "nombre": "CHATGPT E INTELIGENCIA ARTIFICAL",
                "horas": 60,
                "nivel_digital": "Intermedio",
                "entidad": "ESCUELA DE PRUEBA, SL",
                "preinscripcion": {"inicio": "2026-09-01", "fin": "2026-10-31"},
                "colectivos": ["asalariados", "autonomos"],
                "sector": "INTERSECTORIAL",
                "programa": PROGRAMA,
            },
        )

    def test_lo_que_no_tiene_la_forma_publicada_se_para(self) -> None:
        """Otra modalidad, otra especialidad, una difusión que no está, un colectivo nuevo o una fecha distinta."""
        otra_modalidad = centro()
        otra_modalidad["curso"]["idModalidad"] = 1  # type: ignore[index]
        otra_especialidad = centro()
        otra_especialidad["curso"]["codigoTitulacion"] = "IFCT0050"  # type: ignore[index]
        casos = {
            "otra modalidad": (otra_modalidad, COLECTIVOS, {"centrosRFO": [fila()]}),
            "otra especialidad": (otra_especialidad, COLECTIVOS, {"centrosRFO": [fila()]}),
            "sin la difusión": (centro(), COLECTIVOS, {"centrosRFO": [fila(1)]}),
            "colectivo nuevo": (
                centro(),
                [{"idColectivo": 7, "descripcionColectivos": "Otro"}],
                {"centrosRFO": [fila()]},
            ),
            "texto cambiado": (
                centro(),
                [{"idColectivo": 1, "descripcionColectivos": "Asalariado"}],
                {"centrosRFO": [fila()]},
            ),
        }
        for caso, (de_la_entidad, lista, difusiones) in casos.items():
            with self.subTest(caso), self.assertRaises(FormatoInesperado):
                hechos.edicion(CODIGO, EDICION, difusiones, de_la_entidad, lista)
        with self.assertRaises(FormatoInesperado):
            hechos.fecha_api("31/10/2026")


class PruebaControles(unittest.TestCase):
    """Los controles de la validación sobre las ediciones compuestas."""

    def preparado(self) -> dict[str, object]:
        """Tres ediciones con su evidencia completa, como las deja preparar.

        Returns:
            Lo preparado para validar.
        """
        base = hechos.edicion(CODIGO, EDICION, {"centrosRFO": [fila()]}, centro(), COLECTIVOS)
        prueba = {
            "url": "https://agora.fundae.es/",
            "http": 200,
            "consultado_utc": "2026-10-23T10:00:01Z",
            "cuerpo": {"archivo": "a.body", "sha256": "a"},
            "recibo": {"archivo": "a.json", "sha256": "a"},
        }
        publicadas = [{**copy.deepcopy(base), "id": str(EDICION + n)} for n in range(3)]
        return {
            "conjunto": {"consulta": "2026-10-23", "ediciones": publicadas},
            "evidencias": {e["id"]: dict.fromkeys(salida.FICHAS, prueba) for e in publicadas},
        }

    def controlar(self, preparado: dict[str, object]) -> Controles:
        """Pasa los controles sin comprobar archivos conservados (eso lo cubre test_fundae_ediciones).

        Returns:
            Los controles anotados.
        """
        controles = Controles()
        with redirect_stdout(io.StringIO()):
            fundae.controlar(controles, preparado, conservada=salida.con_evidencia)
        return controles

    def test_las_ediciones_con_evidencia_pasan(self) -> None:
        """Con plazos en orden, evidencia completa y sin contactos, todo se admite."""
        self.assertTrue(self.controlar(self.preparado()).admitido)

    def test_un_correo_o_un_telefono_paran_la_validacion(self) -> None:
        """Si un contacto se cuela en cualquier campo, la validación no se admite."""
        for contacto in ("persona@ejemplo.es", "Llama al 910000000"):
            preparado = self.preparado()
            preparado["conjunto"]["ediciones"][0]["entidad"] = contacto  # type: ignore[index]
            with self.subTest(contacto):
                self.assertFalse(self.controlar(preparado).admitido)

    def test_plazo_al_reves_vencido_o_sin_evidencia_no_se_admiten(self) -> None:
        """Un plazo que acaba antes de empezar, uno vencido el día de la consulta o una edición sin evidencia."""
        al_reves, vencido, sin_evidencia, vacio = (self.preparado() for _ in range(4))
        al_reves["conjunto"]["ediciones"][0]["preinscripcion"] = {"inicio": "2026-11-01", "fin": "2026-10-31"}  # type: ignore[index]
        vencido["conjunto"]["ediciones"][0]["preinscripcion"] = {"inicio": "2026-09-01", "fin": "2026-10-22"}  # type: ignore[index]
        del sin_evidencia["evidencias"][str(EDICION)]["colectivos"]  # type: ignore[index]
        vacio["conjunto"]["ediciones"] = []  # type: ignore[index]
        casos = {"al revés": al_reves, "vencido": vencido, "sin evidencia": sin_evidencia, "vacío": vacio}
        for caso, preparado in casos.items():
            with self.subTest(caso):
                self.assertFalse(self.controlar(preparado).admitido)


if __name__ == "__main__":
    unittest.main()
