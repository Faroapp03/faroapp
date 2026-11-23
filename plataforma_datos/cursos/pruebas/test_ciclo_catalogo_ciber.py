"""Unión Ciber con etapas comunes, admisión e instantánea reales, sin red."""

import hashlib
import json
import shutil
import unittest
from copy import deepcopy
from unittest.mock import patch

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.comun.nucleo import Carpetas, FormatoInesperado
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos import contenido_aprendizaje, contenido_ciber, politicas_vigencia, registro_vigencia
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos.fuentes.cibervoluntarios import metodo_interfaz
from plataforma_datos.cursos.hechos_entrega_catalogo import proyectar_hechos
from plataforma_datos.cursos.pruebas import test_ciber_actualizacion as caso
from plataforma_datos.orquestacion import admision


class CicloCatalogoCiberPruebas(unittest.TestCase):
    """El censo sintético no recibe la revisión del método real ni se ofrece."""

    def setUp(self) -> None:
        """Instala la entrada del caso de fuente en las casas operativas comunes."""
        self.caso = caso.ActualizacionCiberPruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.caso.parche_politica.stop()
        self.raiz = self.caso.raiz
        almacen.conservar(self.caso.entrada, destino=self.raiz / almacen.RUTA)
        self.original, _, _ = fuente.rutas_de_la_fuente("cibervoluntarios", self.raiz)
        self.original.mkdir(parents=True)
        documento = json.loads((self.raiz / "procedencia.json").read_bytes())
        for cap in [*documento["capturas"], *documento["auxiliares"].values()]:
            for ref in fuente.referencias_de_captura(cap):
                destino = self.original / ref["archivo"]
                if not destino.exists():
                    shutil.copyfile(self.raiz / ref["archivo"], destino)
        guardar_json(self.original / "procedencia.json", documento)

        def carpetas(id: str) -> Carpetas:
            return Carpetas(*fuente.rutas_de_la_fuente(id, self.raiz))

        for contexto in (
            patch.object(fuente, "RAIZ", self.raiz),
            patch.object(admision, "carpetas", carpetas),
            patch.object(admision, "ruta_del_conjunto", lambda id: carpetas(id).validado / (id + ".json")),
        ):
            contexto.start()
            self.addCleanup(contexto.stop)
        fuente.preparar("cibervoluntarios", raiz=self.raiz)
        fuente.validar("cibervoluntarios", raiz=self.raiz)

    def inventario(self) -> dict:
        """Fija bytes y tiempos de las únicas salidas operativas.

        Returns:
            SHA y mtime por archivo, sin confundir copia con observación remota.
        """
        return {
            str(p.relative_to(self.raiz)): (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns)
            for area in (self.raiz / almacen.RUTA, self.raiz / "web")
            for p in area.rglob("*")
            if p.is_file()
        }

    def test_censo_admitido_compone_y_repite_sin_parche_de_politica(self) -> None:
        """Una consulta posterior fallida no suplanta el índice admitido anterior."""
        politica = politicas_vigencia.leer_politica("cibervoluntarios", "1")
        self.assertEqual(politica["fuente_id"], "cibervoluntarios")
        previo = fuente.leer_validado("cibervoluntarios", self.raiz)
        self.assertIs(previo["censo_completo"], True)
        resultado = componer.componer(raiz=self.raiz, corte_utc="2026-10-23T18:30:00Z")
        publico = json.loads((self.raiz / "web" / resultado["referencia"]["ruta"]).read_bytes())
        self.assertEqual(publico["ofertas"], [])
        fijo = self.inventario()
        guardar_json(self.original / "procedencia.json", {"capturas": [], "fallo": "Intento posterior sintético"})
        self.assertEqual(fuente.leer_validado("cibervoluntarios", self.raiz), previo)
        componer.componer(raiz=self.raiz, corte_utc="2026-10-23T18:30:00Z")
        self.assertEqual(self.inventario(), fijo)

    def test_hechos_actuales_vinculados_y_observacion_alterada_no_presta_prueba(self) -> None:
        """El método de interfaz es sintético; no sustituye al ensayo de cuerpos reales."""
        with patch.object(metodo_interfaz, "confirmado", return_value=True):
            fuente.preparar("cibervoluntarios", raiz=self.raiz)
            fuente.validar("cibervoluntarios", raiz=self.raiz)
            resultado = componer.componer(raiz=self.raiz, corte_utc="2026-10-23T18:30:00Z")
            publico = json.loads((self.raiz / "web" / resultado["referencia"]["ruta"]).read_bytes())
            self.assertEqual(len(publico["ofertas"]), 1)
            oferta = publico["ofertas"][0]
            for campo, valor, alcance in (
                ("coste_formacion_tipo", "gratis_formacion", "declaracion_general"),
                ("requiere_registro_previo", True, "declaracion_general"),
                ("idiomas_declarados", ["Español"], "unidad"),
                ("modalidad", "en-linea", "unidad"),
            ):
                self.assertEqual(oferta["hechos"][campo]["valor"], valor)
                self.assertEqual(oferta["hechos"][campo]["alcance"], alcance)
                self.assertIn("vigencia", oferta["hechos"][campo])
            base = self.raiz / almacen.RUTA
            solicitud = almacen.solicitud(base)
            id = oferta["unidad"]["id"]
            actual = registro_vigencia.consultar_unidad(base / "catalogo.sqlite3", tipo="recurso", id=id)["evaluacion"]
            referencias = contenido_aprendizaje.referencias_de_evidencia_indexadas(solicitud)
            valida = contenido_ciber.actuales(
                solicitud, {id}, referencias, {id: actual}, publico["corte_proyeccion_utc"]
            )
            self.assertIn(id, valida)
            alterada = deepcopy(actual)
            alterada["entradas"]["observaciones"][0]["detalle"]["acceso_abierto"] = True
            self.assertEqual(
                contenido_ciber.actuales(solicitud, {id}, referencias, {id: alterada}, publico["corte_proyeccion_utc"]),
                {},
            )
            self.assertEqual(
                contenido_ciber.actuales(solicitud, {id}, referencias, {}, publico["corte_proyeccion_utc"]), {}
            )

    def test_cuerpo_alterado_no_publica_ni_cambia_snapshot(self) -> None:
        """El lector común detecta la alteración antes de aplicar o publicar."""
        componer.componer(raiz=self.raiz, corte_utc="2026-10-23T18:30:00Z")
        fijo = self.inventario()
        fila = fuente.leer_validado("cibervoluntarios", self.raiz)["recepciones"][0]
        (self.original / fila["cuerpo"]["archivo"]).write_bytes("Alteración de prueba".encode())
        with self.assertRaises(FormatoInesperado):
            componer.componer(raiz=self.raiz, corte_utc="2026-10-23T18:30:00Z")
        self.assertEqual(self.inventario(), fijo)


class ConflictosHechosCiberPruebas(unittest.TestCase):
    """Una declaración general nueva no oculta condiciones propias contrarias."""

    def test_precios_registro_modalidad_e_idioma_contrarios_siguen_desconocidos(self) -> None:
        """No elige por marca, fecha o alcance entre valores conocidos distintos."""
        datos = {
            "coste_formacion_tipo": "de_pago",
            "requisitos_publicados": {"registro_previo_para_inscribirse": False},
            "modalidad": "presencial",
            "idioma_literal": "Inglés",
        }
        actual = {
            "formacion": {"valor": "gratis_formacion", "alcance": "declaracion_general"},
            "inscripcion": {"registro_previo_para_inscribirse": True, "alcance": "declaracion_general"},
            "modalidad": {"valor": "en-linea", "alcance": "unidad"},
            "idioma": {"valor": ["Español"], "alcance": "unidad"},
        }
        antes = deepcopy(datos)
        hechos = proyectar_hechos(datos, alcance="unidad", proveedor_id="cibervoluntarios", condiciones_actuales=actual)
        for campo in ("coste_formacion_tipo", "requiere_registro_previo", "modalidad", "idiomas_declarados"):
            self.assertIsNone(hechos[campo]["valor"])
            self.assertEqual(hechos[campo]["motivo"], "declaraciones_contradictorias")
        self.assertEqual(datos, antes)


if __name__ == "__main__":
    unittest.main()
