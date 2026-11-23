"""La cobertura de la fuente y el resultado de la consulta son datos distintos; una parcial nunca es completa."""

import copy
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import operacion_fuente
from plataforma_datos.orquestacion import actualizar
from plataforma_datos.orquestacion import comprobaciones_remotas as registro
from plataforma_datos.orquestacion import contrato_comprobaciones_panel as contrato
from plataforma_datos.orquestacion import seguimiento_de_comprobaciones as seguimiento
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.estado_panel import estado_panel
from plataforma_datos.orquestacion.modulos import MODULOS

AHORA = datetime(2026, 10, 20, 10, tzinfo=UTC)
CIBER_COMPLETO = {"censo_completo": True}
CIBER_CAIDO = {
    "censo_completo": False,
    "consulta_parcial": {
        "unidades_fallidas": [],
        "unidades_esperadas": 53,
        "paginas_fallidas": [16],
        "paginas_esperadas": 4,
    },
}
FUNDAE_COMPLETO = {"fallos": [], "cobertura": {"catalogos": 2, "digitalizate": 5, "subvencionada": 7}}
FUNDAE_CAIDO = {
    "fallos": [{"canal": "digitalizate"}],
    "cobertura": {"catalogos": 2, "subvencionada": 7},
    "consulta_parcial": {"canales_fallidos": ["digitalizate"], "unidades_fallidas": [], "unidades_esperadas": 9},
}


def _evidencia(fuente: str, instante: datetime) -> dict:
    momento = instante.isoformat()
    return {
        "version": 2,
        "fuente": fuente,
        "intento": "recepcion-" + fuente,
        "comienzo_utc": momento,
        "fin_utc": momento,
        "peticiones": [
            {
                "recurso_sha256": "a" * 64,
                "url_final_sha256": "b" * 64,
                "respuesta_sha256": "c" * 64,
                "bytes": 42,
                "completado_utc": momento,
                "original_sha256": "c" * 64,
                "original_bytes": 42,
            }
        ],
    }


def _ciclo(raiz: Path, instante: datetime, fuente: str, *, falla: bool = False) -> None:
    """Ciclo real del seguimiento y del registro; el ejecutor de órdenes es el único doble."""
    prueba = None if falla else _evidencia(fuente, instante)

    def ejecutar(orden: list[str], _area: Path) -> actualizar.Resultado:
        etapa = etapa_de_fuente(orden)[1]
        return actualizar.Resultado(int(falla and etapa == "descargar"), "", prueba if etapa == "descargar" else None)

    ciclo = registro.iniciar_ciclo(raiz, instante, "programada")
    observador = seguimiento.Seguimiento(raiz, ciclo, ejecutar, lambda: instante)
    for orden in actualizar.ordenes_de_la_fuente(fuente):
        observador.ejecutar(orden.orden, raiz)
    modulo = next(m for m in MODULOS if m.id == fuente)
    observador.terminar_modulo(modulo, actualizar.ResultadoDelModulo("ámbar" if falla else "verde"))
    registro.cerrar_ciclo(raiz, ciclo, instante, resultado="preparado", paquete_preparado=True)


class CoberturaLimitada(unittest.TestCase):
    """Seguimiento, registro, panel y contrato separan la cobertura de la fuente del resultado de la consulta."""

    def setUp(self) -> None:
        """Instalación temporal; solo el conjunto admitido, que produce otro módulo, es un doble."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.admitidos: dict[str, dict] = {}
        lectura = mock.patch.object(operacion_fuente, "leer_validado", lambda f, _r: self.admitidos.get(f))
        lectura.start()
        self.addCleanup(lectura.stop)

    def resultado(self, fuente: str, admitido: dict) -> str:
        """Registra un ciclo con el conjunto admitido dado.

        Returns:
            El resultado registrado de la fuente.
        """
        self.admitidos[fuente] = admitido
        _ciclo(self.raiz, AHORA, fuente)
        documento = registro.leer_registro(self.raiz)
        self.assertEqual(documento["conjuntos"], {}, "una cobertura limitada nunca acredita su conjunto")
        return documento["fuentes"][fuente]["resultado"]

    def test_consulta_completa_de_cobertura_limitada(self) -> None:
        """Completa sin caídas queda «completa»; con una página o un índice caídos, «parcial»."""
        casos = (
            ("barcelonactiva", CIBER_COMPLETO, "completa"),
            ("barcelonactiva", CIBER_CAIDO, "parcial"),
            ("barcelonactiva", {"censo_completo": False}, "parcial"),
            ("fundae", FUNDAE_COMPLETO, "completa"),
            ("fundae", FUNDAE_CAIDO, "parcial"),
        )
        for fuente, admitido, esperado in casos:
            with self.subTest(fuente=fuente, esperado=esperado):
                self.setUp()
                self.assertEqual(self.resultado(fuente, copy.deepcopy(admitido)), esperado)

    def test_completa_resuelve_el_fallo_anterior_y_vuelve_a_la_cadencia(self) -> None:
        """El fallo previo se reintenta pronto; la completa limpia pendientes, fallos y reintento."""
        self.admitidos["barcelonactiva"] = CIBER_COMPLETO
        _ciclo(self.raiz, AHORA - timedelta(days=1), "barcelonactiva", falla=True)
        documento = registro.leer_registro(self.raiz)
        self.assertEqual(registro.fallos_remotos_seguidos(documento, "barcelonactiva"), 1)
        self.assertIn("barcelonactiva", seguimiento.reintentos_remotos_vencidos(self.raiz, AHORA))
        _ciclo(self.raiz, AHORA, "barcelonactiva")
        documento = registro.leer_registro(self.raiz)
        remoto = documento["seguimiento_remoto"]["barcelonactiva"]
        self.assertEqual((remoto["incidencias_pendientes"], remoto["fallos_seguidos"]), ({}, 0))
        self.assertEqual(seguimiento.reintentos_remotos_vencidos(self.raiz, AHORA + timedelta(days=1)), ())
        self.assertEqual(seguimiento.proxima_consulta(documento, "barcelonactiva"), (AHORA + timedelta(days=1)).date())

    def test_registro_cierra_la_forma_de_completa(self) -> None:
        """Una completa exige evidencia remota y nunca lleva conjuntos comprobados."""
        for evidencia, comprobados in ((None, ()), (_evidencia("fundae", AHORA), ("fundae",))):
            with self.subTest(comprobados=comprobados):
                self.setUp()
                ciclo = registro.iniciar_ciclo(self.raiz, AHORA, "programada")
                registro.iniciar_fuente(self.raiz, ciclo, "fundae", ("fundae",), AHORA, remoto=True)
                with self.assertRaises(registro.RegistroComprobacionesInvalido):
                    registro.terminar_fuente(
                        self.raiz,
                        ciclo,
                        "fundae",
                        AHORA,
                        resultado="completa",
                        evidencia=evidencia,
                        comprobados=comprobados,
                    )

    def test_recuento_parcial_por_unidad_de_consulta(self) -> None:
        """Cibernàrium cuenta páginas y FUNDAE índices; una marca ajena a su fuente no se interpreta."""
        self.admitidos.update(barcelonactiva=CIBER_CAIDO, fundae=FUNDAE_CAIDO, hp_life={})
        parcial = seguimiento.consulta_parcial
        self.assertEqual(parcial(self.raiz, "barcelonactiva"), {"unidades_fallidas": 1, "unidades_esperadas": 4})
        self.assertEqual(parcial(self.raiz, "fundae"), {"unidades_fallidas": 1, "unidades_esperadas": 3})
        self.assertIsNone(parcial(self.raiz, "hp_life"))
        self.admitidos["barcelonactiva"] = {"consulta_parcial": {"unidades_fallidas": ["x"], "unidades_esperadas": 2}}
        with self.assertRaises(FormatoInesperado):
            parcial(self.raiz, "barcelonactiva")

    def test_panel_y_contrato(self) -> None:
        """El panel expone el motivo aparte; el contrato rechaza mezclarlo con el resultado y admite la forma previa."""
        self.admitidos["barcelonactiva"] = CIBER_COMPLETO
        _ciclo(self.raiz, AHORA, "barcelonactiva")
        abierta = self.raiz / "var/actualizacion/preparados/abierta"
        abierta.mkdir(parents=True)
        (abierta / "fichas.json").write_text('{"fichas":[]}', encoding="utf-8")
        instantanea = estado_panel(self.raiz, AHORA + timedelta(hours=1))
        contrato.validar_seguimiento_panel(instantanea)
        filas = {f["fuente"]: f for f in instantanea["seguimientoRemoto"]}
        self.assertEqual(filas["barcelonactiva"]["coberturaLimitada"], "censo-con-copias-fijadas")
        self.assertEqual(filas["fundae"]["coberturaLimitada"], "indices-sin-censo")
        self.assertIsNone(filas["hp_life"]["coberturaLimitada"])

        def rechaza(cambiar: object) -> None:
            copia = copy.deepcopy(instantanea)
            cambiar(next(f for f in copia["seguimientoRemoto"] if f["fuente"] == "barcelonactiva"))
            with self.assertRaises(ValueError):
                contrato.validar_seguimiento_panel(copia)

        rechaza(lambda f: f.update(coberturaLimitada=None))
        rechaza(lambda f: f.update(coberturaLimitada="otro"))
        rechaza(lambda f: f.update(consultaParcial={"unidadesFallidas": 1, "unidadesEsperadas": 4}))
        rechaza(lambda f: f.pop("coberturaLimitada"))
        rechaza(lambda f: f["ultimoIntento"].update(resultado="comprobada"))
        anterior = copy.deepcopy(instantanea)
        for fila in anterior["seguimientoRemoto"]:
            fila.pop("coberturaLimitada")
        anterior["seguimientoRemoto"] = [f for f in anterior["seguimientoRemoto"] if f["fuente"] != "barcelonactiva"]
        anterior["seguimientoRemoto"].append(
            {"fuente": "barcelonactiva", "ultimoIntento": None, "incidenciasPendientes": []}
        )
        anterior["fuentes"] = [
            {**f, "ultimaOperacion": None} if f["id"] == "barcelonactiva" else f for f in anterior["fuentes"]
        ]
        contrato.validar_seguimiento_panel(anterior)

    def test_declaraciones_coherentes(self) -> None:
        """Una fuente es de cobertura completa o limitada, nunca ambas, y su motivo es un código del panel."""
        limitadas = seguimiento.COBERTURAS_LIMITADAS
        self.assertFalse(set(limitadas) & set(seguimiento.COBERTURAS_COMPLETAS))
        self.assertEqual(set(limitadas), set(seguimiento.CONSULTA_SIN_CAIDAS))
        self.assertEqual(set(limitadas.values()), contrato.MOTIVOS_COBERTURA_LIMITADA)


if __name__ == "__main__":
    unittest.main()
