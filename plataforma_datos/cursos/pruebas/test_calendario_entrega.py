"""Calendarios de edición con precisión, soporte y fecha de comprobación propios; sin inferencias."""

import unittest
from copy import deepcopy

from plataforma_datos.cursos import calendario_entrega as calendario


def apoyo(
    tipo: str = "periodo-formativo", inicio: str = "2026-10-25T10:00:00+01:00", fin: str = "2026-10-25T12:00:00+01:00"
) -> dict:
    """Prepara un apoyo de edición inequívoca.

    Returns:
        Hecho interno con reloj y localizador sintéticos declarados.
    """
    e = {
        "url": "https://example.org/ediciones",
        "sha256": "a" * 64,
        "capturado_utc": "2026-10-23T21:00:00Z",
        "localizador": {"tipo": "campo", "valor": "/ediciones/456/calendario"},
    }
    return {
        "campo": calendario.CAMPOS_ORIGEN[tipo],
        "valor": {"tipo": tipo, "inicio": inicio, "fin": fin},
        "alcance": "edicion",
        "evidencia": e,
        "vigencia": {"comprobado_el": e["capturado_utc"]},
        "vinculo_edicion": {
            "tipo": "id",
            "valor": "456",
            "edicion": {"id": "edicion:456", "url": None},
            "evidencia": e,
        },
    }


class CalendarioEntrega(unittest.TestCase):
    """El proyector no elige el calendario favorable de otra edición o captura."""

    def proyectar(self, datos: list[dict], id: str = "edicion:456", alcance: str = "edicion") -> dict:
        """Ejecuta el helper público de hechos sobre apoyos explícitos.

        Returns:
            Los tres hechos, también cuando son desconocidos.
        """
        return calendario.proyectar({"edicion_id": id, "calendarios_propios": datos}, alcance=alcance)

    def test_periodo_propio_no_inventa_matricula(self) -> None:
        """Una fecha de clase no se convierte en un plazo para inscribirse."""
        original = apoyo()
        antes = deepcopy(original)
        hechos = self.proyectar([original])
        self.assertEqual(hechos["calendario_formacion"]["valor"], original["valor"])
        self.assertIsNone(hechos["calendario_matricula"]["valor"])
        self.assertIsNone(hechos["calendario_aula"]["valor"])
        self.assertEqual(original, antes)
        hechos["calendario_formacion"]["valor"]["inicio"] = "otro"
        self.assertEqual(original, antes)

    def test_no_toma_calendario_de_otro_ambito_o_edicion(self) -> None:
        """Una coincidencia de curso o documento no sustituye el vínculo de edición."""
        self.assertIsNone(self.proyectar([apoyo()], id="otra")["calendario_formacion"]["valor"])
        self.assertIsNone(self.proyectar([apoyo()], alcance="unidad")["calendario_formacion"]["valor"])
        dato = apoyo()
        dato["vinculo_edicion"]["evidencia"] = {**dato["evidencia"], "sha256": "b" * 64}
        self.assertIsNone(self.proyectar([dato])["calendario_formacion"]["valor"])

    def test_contradictorio_o_invertido_no_elige_un_extremo_favorable(self) -> None:
        """Los desconocidos tienen motivo concreto, sin intervalos fabricados."""
        otro = apoyo(inicio="2026-10-26T10:00:00+01:00", fin="2026-10-26T12:00:00+01:00")
        self.assertEqual(
            self.proyectar([apoyo(), otro])["calendario_formacion"]["motivo"], "declaraciones_contradictorias"
        )
        mal = apoyo(inicio="2026-10-26T10:00:00+01:00", fin="2026-10-25T12:00:00+01:00")
        self.assertEqual(self.proyectar([mal])["calendario_formacion"]["motivo"], "no_interpretable")

    def test_calendario_antiguo_conserva_valor_y_fecha_sin_caducar(self) -> None:
        """Una captura de hace días sigue acreditando el calendario con su fecha real."""
        hecho = self.proyectar([apoyo()])["calendario_formacion"]
        self.assertEqual(hecho["motivo"], "conocido")
        self.assertEqual(hecho["vigencia"], {"comprobado_el": "2026-10-23T21:00:00Z"})
        for plazo in (
            {"comprobado_el": "2026-10-23T21:00:00Z", "vence_el": "2026-10-24T21:00:00Z"},
            {"comprobado_el": "2026-10-24T21:00:00Z"},
            None,
        ):
            dato = apoyo()
            dato["vigencia"] = plazo
            with self.subTest(plazo=plazo):
                self.assertEqual(self.proyectar([dato])["calendario_formacion"]["motivo"], "no_interpretable")
        reciente = apoyo()
        reciente["evidencia"] = {**reciente["evidencia"], "capturado_utc": "2026-10-24T09:00:00Z"}
        reciente["vinculo_edicion"]["evidencia"] = reciente["evidencia"]
        reciente["vigencia"] = {"comprobado_el": "2026-10-24T09:00:00Z"}
        elegido = self.proyectar([reciente, apoyo()])["calendario_formacion"]
        self.assertEqual(elegido["vigencia"], {"comprobado_el": "2026-10-23T21:00:00Z"})

    def test_fecha_civil_y_hora_sin_zona_se_conservan_sin_normalizar(self) -> None:
        """El dato no recibe una hora o zona de la máquina."""
        for inicio, fin in (("2026-10-25", "2026-10-26"), ("2026-10-25T10:00", "2026-10-25T12:00")):
            dato = apoyo(inicio=inicio, fin=fin)
            self.assertEqual(self.proyectar([dato])["calendario_formacion"]["valor"], dato["valor"])

    def test_sesiones_son_lista_exacta_no_un_span_convertido(self) -> None:
        """El objeto de sesiones conserva cada pareja publicada y no crea otras fechas."""
        dato = apoyo()
        dato["valor"] = {
            "tipo": "sesiones",
            "sesiones": [{"inicio": "2026-10-25T10:00:00+01:00", "fin": "2026-10-25T12:00:00+01:00"}],
        }
        self.assertEqual(self.proyectar([dato])["calendario_formacion"]["valor"], dato["valor"])
        with self.assertRaises(calendario.ErrorCalendarioEntrega):
            calendario.validar_valor(
                {"tipo": "sesiones", "inicio": "2026-10-25", "fin": "2026-10-26"}, "calendario_formacion"
            )

    def test_valor_cerrado_rechaza_campos_fechas_imposibles_y_tipo_ajeno(self) -> None:
        """URLs, claves añadidas o días normalizables no pasan al DTO."""
        for valor in (
            {"tipo": "periodo-formativo", "inicio": "2026-02-30", "fin": None},
            {"tipo": "periodo-formativo", "inicio": "2026-10-25", "fin": None, "url": "https://example.org"},
            {"tipo": "ventana-acceso", "inicio": "2026-10-25", "fin": "2026-10-26"},
        ):
            with self.subTest(valor=valor), self.assertRaises(calendario.ErrorCalendarioEntrega):
                calendario.validar_valor(valor, "calendario_formacion")

    def test_horas_civiles_invertidas_y_plazos_sin_zona_no_acreditan(self) -> None:
        """Comparar horas de pared no les atribuye la zona horaria del equipo."""
        for inicio, fin in (
            ("2026-10-25T12:00", "2026-10-25T10:00"),
            ("2026-10-25T12:00-00:00", "2026-10-25T10:00-00:00"),
        ):
            self.assertEqual(
                self.proyectar([apoyo(inicio=inicio, fin=fin)])["calendario_formacion"]["motivo"], "no_interpretable"
            )
        dato = apoyo()
        dato["evidencia"]["capturado_utc"] = dato["vigencia"]["comprobado_el"] = "2026-10-23T21:00:00-00:00"
        self.assertEqual(self.proyectar([dato])["calendario_formacion"]["motivo"], "no_interpretable")
