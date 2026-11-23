"""La parte pública de la Cambra: solo el nivel agregado y su cita, iguales a los de la tabla en cada ocupación."""

import json
import unittest
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.cambra.exportacion as exportacion
from plataforma_datos.comun.entrada_salida import ruta_del_conjunto, sha256
from plataforma_datos.comun.nucleo import PAQUETE, RAIZ, FormatoInesperado
from plataforma_datos.ia_y_trabajo.fuentes.cambra import tabla_privada

# Datos sintéticos con la forma del conjunto validado: ninguna cifra es del estudio.
COMPLETA = {
    "fuente": "Cita sintética (2026)",
    "estado": "Transcripción sintética",
    "escala": {"cortes": [0.2, 0.4], "nivel_alta": 3, "nota": "sintética"},
    "ocupaciones_cno3": {
        "111": {"puntuacion": 0.1, "nivel": 1, "mujeres": 10, "hombres": 20},
        "222": {"puntuacion": 0.5, "nivel": 3, "mujeres": 30, "hombres": 40},
    },
    "ocupados_cno3": {"111": {"ocupados": 30, "pct_mujeres": 33.3}},
    "contratacion_cno4": {"1111": {"contratos_2023": 5}},
    "variacion_contratacion_total": 1.5,
    "genero": {
        "mujeres_exposicion_media_o_alta": 12.0,
        "hombres_exposicion_media_o_alta": 8.0,
        "mujeres_no_expuestas": 50.0,
        "pagina_impresa": 7,
        "pagina_pdf": 9,
    },
}
PUBLICA = {
    "fuente": "Cita sintética (2026)",
    "escala": {"cortes": [0.2, 0.4]},
    "ocupaciones_cno3": {"111": {"nivel": 1}, "222": {"nivel": 3}},
    "genero": {"mujeres_exposicion_media_o_alta": 12.0, "hombres_exposicion_media_o_alta": 8.0, "pagina_impresa": 7},
}


class PruebaDerivacion(unittest.TestCase):
    """La derivación deja solo el contrato cerrado, sin cambiar ningún valor."""

    def test_deja_solo_el_nivel_la_escala_el_reparto_publicado_y_la_cita(self) -> None:
        """Puntuaciones, personas ocupadas, contratación y desgloses no pasan a la parte pública."""
        self.assertEqual(exportacion.nivel_agregado(COMPLETA), PUBLICA)

    def test_un_campo_del_contrato_que_falta_detiene_la_exportacion(self) -> None:
        """Sin el nivel de una ocupación no hay parte pública que exportar."""
        incompleta = {**COMPLETA, "ocupaciones_cno3": {"111": {"puntuacion": 0.1}}}
        with self.assertRaisesRegex(FormatoInesperado, "la ocupación 111"):
            exportacion.nivel_agregado(incompleta)

    def test_los_campos_fuera_del_contrato_se_nombran_en_cada_nivel(self) -> None:
        """Un campo de más arriba, en una ocupación o en el reparto por sexo, sale con su ruta."""
        self.assertEqual(exportacion.campos_fuera_del_contrato(PUBLICA), [])
        self.assertEqual(
            exportacion.campos_fuera_del_contrato(COMPLETA),
            [
                "estado",
                "ocupados_cno3",
                "contratacion_cno4",
                "variacion_contratacion_total",
                "escala.nivel_alta",
                "escala.nota",
                "ocupaciones_cno3.111.puntuacion",
                "ocupaciones_cno3.111.mujeres",
                "ocupaciones_cno3.111.hombres",
                "ocupaciones_cno3.222.puntuacion",
                "ocupaciones_cno3.222.mujeres",
                "ocupaciones_cno3.222.hombres",
                "genero.mujeres_no_expuestas",
                "genero.pagina_pdf",
            ],
        )

    def test_el_paquete_sale_del_conjunto_validado_y_lo_registra_como_origen(self) -> None:
        """El manifiesto guarda como origen el conjunto completo: así fija la tabla privada."""
        with mock.patch.object(exportacion, "leer_validado", return_value=COMPLETA) as leer:
            paquete = exportacion.paquete_cambra()
        leer.assert_called_once_with("cambra")
        self.assertEqual(paquete.datos, PUBLICA)
        self.assertEqual(paquete.origenes, [ruta_del_conjunto("cambra")])


class PruebaPaquetePublicado(unittest.TestCase):
    """Guardia del paquete que se publica: la tabla completa no está en él."""

    @classmethod
    def setUpClass(cls) -> None:
        """Lee el manifiesto y la parte pública del paquete."""
        cls.manifiesto = json.loads((PAQUETE / "manifiesto.json").read_text(encoding="utf-8"))
        cls.ruta = PAQUETE / exportacion.ARCHIVO_PUBLICO
        cls.publica = json.loads(cls.ruta.read_text(encoding="utf-8"))

    def test_la_parte_publica_solo_lleva_campos_del_contrato(self) -> None:
        """Ningún campo de la tabla fuera de la lista cerrada llega al archivo que se empaqueta."""
        self.assertEqual(exportacion.campos_fuera_del_contrato(self.publica), [])

    def test_el_manifiesto_publica_la_parte_publica_y_no_la_tabla(self) -> None:
        """Se publica lo que nombra el manifiesto: la parte pública, con su huella, y nunca cambra.json."""
        self.assertNotIn(tabla_privada.ARCHIVO, self.manifiesto)
        self.assertEqual(self.manifiesto[exportacion.ARCHIVO_PUBLICO]["sha256"], sha256(self.ruta))


class PruebaIgualdadConLaTablaCompleta(unittest.TestCase):
    """Para todas las ocupaciones, la parte pública da lo mismo que la tabla completa fijada por el manifiesto."""

    @classmethod
    def setUpClass(cls) -> None:
        """La tabla no está en el repositorio: sin ella, o con otra huella, el fallo dice qué falta y cómo obtenerla."""
        cls.completa = tabla_privada.leer(RAIZ)
        cls.publica = json.loads((PAQUETE / exportacion.ARCHIVO_PUBLICO).read_text(encoding="utf-8"))

    def test_cada_ocupacion_conserva_su_nivel(self) -> None:
        """Las mismas ocupaciones y, en cada una, el mismo nivel."""
        completas = self.completa["ocupaciones_cno3"]
        publicas = self.publica["ocupaciones_cno3"]
        self.assertEqual(list(publicas), list(completas))
        self.assertEqual(
            {codigo: fila["nivel"] for codigo, fila in publicas.items()},
            {codigo: fila["nivel"] for codigo, fila in completas.items()},
        )

    def test_la_cita_la_escala_y_el_reparto_por_sexo_son_los_mismos(self) -> None:
        """Lo demás que lee el producto llega con los mismos valores."""
        self.assertEqual(self.publica["fuente"], self.completa["fuente"])
        self.assertEqual(self.publica["escala"]["cortes"], self.completa["escala"]["cortes"])
        for campo in exportacion.CAMPOS_DEL_GENERO:
            self.assertEqual(self.publica["genero"][campo], self.completa["genero"][campo], campo)

    def test_el_archivo_publicado_es_la_derivacion_de_la_tabla_fijada(self) -> None:
        """La exportación de la tabla fijada da exactamente el archivo que se publica."""
        self.assertEqual(exportacion.nivel_agregado(self.completa), self.publica)


if __name__ == "__main__":
    unittest.main()
