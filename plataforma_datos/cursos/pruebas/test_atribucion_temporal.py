"""Actualización por proyección: evidencia independiente, anclaje y rollback."""

import hashlib
import json
import sqlite3
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos.atribucion_temporal import CanalesAtribuidos, ContratoCanal, ErrorAtribucion
from plataforma_datos.cursos.tipos_json import ObjetoJson


class AtribucionTemporalPruebas(unittest.TestCase):
    """Todas las capturas y bases son sintéticas y pertenecen al fixture."""

    def setUp(self) -> None:
        """Carga dos canales independientes sin atribuirles campos retroactivamente."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.base = self.raiz / "catálogo de prueba.sqlite3"
        self.contrato = ContratoCanal(
            id="curso-prueba", version=1, entidad="programa", campos=("/titulo", "/datos/cuerpo")
        )
        self.vieja = self.evidencia("curso-viejo", 21, "anterior")
        self.faq = self.evidencia("faq", 21, "general")
        self.ancla = self.evidencia("curso-ancla", 22, "anterior")
        self.nueva = self.evidencia("curso-nuevo", 23, "actual")
        self.lote = {
            "schema_version": 1,
            "observado_utc": self.vieja["capturado_utc"],
            "fuente_lote": "fuente-sintetica",
            "proveedores": [
                {"id": "proveedor", "nombre": "Proveedor sintético", "territorio": None, "naturaleza": None}
            ],
            "programas": [
                {
                    "id": "curso",
                    "proveedor_id": "proveedor",
                    "titulo": "Título anterior",
                    "url": "https://example.org/curso",
                    "tipo_unidad": "curso",
                    "datos": {"cuerpo": "anterior", "faq": "general", "otro": 0},
                    "evidencias": [self.vieja, self.faq],
                    "etiquetas": [],
                }
            ],
            "ediciones": [],
        }
        catalogo.cargar_lote(self.base, self.lote, True, self.raiz, canales_temporales=self.canales())

    def evidencia(self, nombre: str, dia: int, texto: str) -> ObjetoJson:
        """Escribe un original verificable con una fecha explícita.

        Returns:
            Referencia sintética; no simula una adquisición real.
        """
        cuerpo = json.dumps({"texto": texto}).encode()
        (self.raiz / nombre).write_bytes(cuerpo)
        return {
            "url": "https://example.org/" + nombre,
            "capturado_utc": f"2026-10-{dia:02d}T08:00:00Z",
            "sha256": hashlib.sha256(cuerpo).hexdigest(),
            "archivo": nombre,
        }

    def canales(self, actual: ObjetoJson | None = None) -> list[ObjetoJson]:
        """Mantiene los canales históricos y, cuando corresponde, añade la proyección actual.

        Returns:
            Pruebas por rol, sin modificar sus fechas o cuerpos.
        """
        salida = [
            {"entidad": "programa", "id": "curso", "canal": rol, "evidencias": [prueba]}
            for rol, prueba in (("curso-historico", self.vieja), ("faq", self.faq))
        ]
        if actual is not None:
            salida.append({"entidad": "programa", "id": "curso", "canal": self.contrato.clave, "evidencias": [actual]})
        return salida

    def entrada(self, actual: ObjetoJson, *, cambio: bool = False) -> ObjetoJson:
        """Prepara negocio completo conservando la evidencia histórica.

        Returns:
            Lote parcial de una entidad, no censo.
        """
        lote = deepcopy(self.lote)
        lote["observado_utc"] = actual["capturado_utc"]
        lote["programas"][0]["evidencias"].append(actual)
        if cambio:
            lote["programas"][0]["titulo"] = "Título actual"
            lote["programas"][0]["datos"]["cuerpo"] = "actual"
        return lote

    def cargar(self, lote: ObjetoJson, actual: ObjetoJson) -> None:
        """Usa exclusivamente el cargador público existente con su opción aditiva."""
        catalogo.cargar_lote(
            self.base,
            lote,
            True,
            self.raiz,
            canales_temporales=CanalesAtribuidos(
                canales_por_lote=(tuple(self.canales(actual)),), contratos=(self.contrato,)
            ),
        )

    def anclar(self) -> None:
        """Acredita primero la proyección idéntica sobre el negocio anterior completo."""
        self.cargar(self.entrada(self.ancla), self.ancla)

    def test_anclaje_y_repeticion_conservan_negocio_versiones_y_capturas(self) -> None:
        """Un anclaje no es una nueva versión de negocio ni cambia la fecha histórica."""
        previo = catalogo.resumen(self.base)
        self.anclar()
        self.anclar()
        actual = catalogo.resumen(self.base)
        self.assertEqual(actual["versiones"], previo["versiones"])
        with sqlite3.connect(self.base) as conexion:
            self.assertEqual(
                json.loads(conexion.execute("SELECT datos FROM programas").fetchone()[0]),
                self.lote["programas"][0]["datos"],
            )
            self.assertEqual(
                conexion.execute("SELECT capturado_utc FROM evidencias WHERE archivo='curso-viejo'").fetchone()[0],
                self.vieja["capturado_utc"],
            )

    def test_actualizacion_real_de_titulo_y_cuerpo_con_faq_igual(self) -> None:
        """El cambio compatible continúa automáticamente, sin renovar fuentes auxiliares."""
        self.anclar()
        self.cargar(self.entrada(self.nueva, cambio=True), self.nueva)
        with sqlite3.connect(self.base) as conexion:
            fila = conexion.execute("SELECT titulo,datos FROM programas").fetchone()
            self.assertEqual(fila[0], "Título actual")
            self.assertEqual(json.loads(fila[1]), {"cuerpo": "actual", "faq": "general", "otro": 0})
        self.assertEqual(len(catalogo.buscar(self.base, "actual")), 1)

    def test_anclaje_con_negocio_distinto_no_se_admite(self) -> None:
        """Una captura nueva no permite saltarse el anclaje idéntico inicial."""
        antes = self.base.read_bytes()
        with self.assertRaisesRegex(catalogo.ErrorCatalogo, "Anclaje"):
            self.cargar(self.entrada(self.nueva, cambio=True), self.nueva)
        self.assertEqual(self.base.read_bytes(), antes)

    def test_campos_ajenos_y_false_frente_a_cero_no_se_confunden(self) -> None:
        """El mapa no autoriza modificar FAQ, ausencia/null ni 0/False fuera de su ámbito."""
        self.anclar()
        antes = self.base.read_bytes()
        for campo, valor in (("faq", "otro texto"), ("otro", False), ("añadido", None)):
            lote = self.entrada(self.nueva, cambio=True)
            lote["programas"][0]["datos"][campo] = valor
            with self.subTest(campo=campo), self.assertRaisesRegex(catalogo.ErrorCatalogo, "no atribuidos"):
                self.cargar(lote, self.nueva)
            self.assertEqual(self.base.read_bytes(), antes)

    def test_mismas_capturas_no_permiten_cambiar_proyeccion(self) -> None:
        """El contrato de campos no transforma una repetición en adquisición nueva."""
        self.anclar()
        antes = self.base.read_bytes()
        with self.assertRaises(catalogo.ErrorTemporal):
            self.cargar(self.entrada(self.ancla, cambio=True), self.ancla)
        self.assertEqual(self.base.read_bytes(), antes)

    def test_captura_vieja_y_fecha_invalida_no_modifican_base(self) -> None:
        """La atribución conserva el orden por canal y la validación de instantes."""
        self.anclar()
        antes = self.base.read_bytes()
        for evidencia in (self.vieja, self.nueva | {"capturado_utc": "ayer"}):
            with self.subTest(fecha=evidencia["capturado_utc"]), self.assertRaises(catalogo.ErrorCatalogo):
                self.cargar(self.entrada(evidencia, cambio=True), evidencia)
            self.assertEqual(self.base.read_bytes(), antes)

    def test_omitir_contrato_protegido_no_desactiva_guarda(self) -> None:
        """Una llamada previa sin opción no puede saltarse el canal atribuido ya anclado."""
        self.anclar()
        antes = self.base.read_bytes()
        with self.assertRaisesRegex(catalogo.ErrorCatalogo, "contrato exacto"):
            catalogo.cargar_lote(
                self.base, self.entrada(self.nueva), True, self.raiz, canales_temporales=self.canales(self.nueva)
            )
        self.assertEqual(self.base.read_bytes(), antes)

    def test_otro_mapa_o_version_cambia_clave_y_no_sustituye_contrato(self) -> None:
        """Una definición distinta necesita transición explícita, nunca otro hash de conveniencia."""
        self.anclar()
        anterior = self.contrato
        antes = self.base.read_bytes()
        for contrato in (
            ContratoCanal(id=anterior.id, version=2, entidad="programa", campos=anterior.campos),
            ContratoCanal(id=anterior.id, version=1, entidad="programa", campos=("/datos/faq",)),
        ):
            self.assertNotEqual(contrato.clave, anterior.clave)
            self.contrato = contrato
            with self.assertRaises(catalogo.ErrorCatalogo):
                self.cargar(self.entrada(self.nueva), self.nueva)
            self.assertEqual(self.base.read_bytes(), antes)
        self.contrato = anterior

    def test_solapes_comodines_e_identidad_no_son_proyecciones(self) -> None:
        """Un contrato no puede abarcar datos enteros ni cambiar identidad por accidente."""
        for campos in (
            ("/datos",),
            ("/id",),
            ("/datos/*",),
            ("/datos/cuerpo", "/datos/cuerpo"),
            ("/datos/cuerpo", "/datos/cuerpo/parte"),
        ):
            with self.subTest(campos=campos), self.assertRaises(ErrorAtribucion):
                ContratoCanal(id="prueba", version=1, entidad="programa", campos=campos)

    def test_contrato_no_admite_identidad_tipo_o_colecciones_ambiguas(self) -> None:
        """Definiciones inválidas fallan antes de abrir el catálogo."""
        for cambio in ({"version": True}, {"entidad": []}, {"campos": ["/titulo"]}, {"campos": ("/datos/~2",)}):
            datos = {"id": "prueba", "version": 1, "entidad": "programa", "campos": ("/titulo",)}
            datos.update(cambio)
            with self.subTest(cambio=cambio), self.assertRaises(ErrorAtribucion):
                ContratoCanal(**datos)
        with self.assertRaises(ErrorAtribucion):
            CanalesAtribuidos(canales_por_lote=(), contratos=(self.contrato,)).unico()

    def test_contrato_con_otro_ambito_no_usa_el_hash_de_uno_anterior(self) -> None:
        """Ni una clave escrita a mano ni contratos solapados amplían la proyección."""
        self.anclar()
        distinto = ContratoCanal(id=self.contrato.id, version=1, entidad="programa", campos=("/datos/faq",))
        antes = self.base.read_bytes()
        opciones = CanalesAtribuidos(canales_por_lote=(tuple(self.canales(self.nueva)),), contratos=(distinto,))
        with self.assertRaisesRegex(catalogo.ErrorCatalogo, "contrato exacto"):
            catalogo.cargar_lote(self.base, self.entrada(self.nueva), True, self.raiz, canales_temporales=opciones)
        with self.assertRaises(ErrorAtribucion):
            CanalesAtribuidos(canales_por_lote=(), contratos=(self.contrato, self.contrato))
        self.assertEqual(self.base.read_bytes(), antes)

    def test_nativo_alterado_sin_huella_no_sirve_como_base_del_diff(self) -> None:
        """La atribución no puede legitimar una corrupción previa ni siquiera en V5."""
        self.anclar()
        with sqlite3.connect(self.base) as conexion:
            conexion.execute("UPDATE programas SET titulo='alterado sin huella'")
        antes = self.base.read_bytes()
        with self.assertRaisesRegex(catalogo.ErrorCatalogo, "Huella nativa alterada"):
            self.cargar(self.entrada(self.nueva, cambio=True), self.nueva)
        self.assertEqual(self.base.read_bytes(), antes)

    def test_interrupcion_tras_guardar_canales_revierte_todo(self) -> None:
        """Versiones, FTS, pruebas y negocio vuelven exactamente al estado anterior."""
        self.anclar()
        antes = self.base.read_bytes()
        guardar = catalogo._guardar_canales

        def interrumpir(*args: object, **kwargs: object) -> None:
            guardar(*args, **kwargs)
            raise KeyboardInterrupt

        with patch.object(catalogo, "_guardar_canales", side_effect=interrumpir), self.assertRaises(KeyboardInterrupt):
            self.cargar(self.entrada(self.nueva, cambio=True), self.nueva)
        self.assertEqual(self.base.read_bytes(), antes)
        self.assertEqual(catalogo.buscar(self.base, "actual"), [])

    def test_ultimo_lote_invalido_revierte_actualizacion_previa(self) -> None:
        """La opción conserva la única transacción de cargar_lotes."""
        self.anclar()
        antes = self.base.read_bytes()
        invalido = self.entrada(self.nueva, cambio=True)
        invalido["programas"][0]["datos"]["faq"] = "cambio sin atribución"
        with self.assertRaises(catalogo.ErrorCatalogo):
            catalogo.cargar_lotes(
                self.base,
                [self.entrada(self.nueva, cambio=True), invalido],
                True,
                self.raiz,
                canales_temporales=CanalesAtribuidos(
                    canales_por_lote=(tuple(self.canales(self.nueva)), tuple(self.canales(self.nueva))),
                    contratos=(self.contrato,),
                ),
            )
        self.assertEqual(self.base.read_bytes(), antes)


if __name__ == "__main__":
    unittest.main()
