"""Regresiones del inventario: evidencia, huecos reales y raíces portátiles."""

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.nucleo import RAIZ
from plataforma_datos.orquestacion.catalogo_de_datos import (
    CONDICIONES_METODOS,
    DOMINIOS,
    _ruta,
    comprobar_catalogo,
    construir_catalogo,
)
from plataforma_datos.orquestacion.exportacion.metodos import CONDICIONES
from plataforma_datos.orquestacion.modulos import MODULOS
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS
from plataforma_datos.orquestacion.reconstruir import FUENTES_EN_ORDEN


class CatalogoDeDatos(unittest.TestCase):
    """Comprueba el contrato contra registros reales y defectos independientes."""

    def test_conserva_cobertura_y_no_confunde_descarga_con_servicio_instalado(self) -> None:
        """Los nuevos IDs del registro aparecen sin mantener otra lista de cantidades."""
        catalogo = construir_catalogo()
        nodos = {nodo["id"]: nodo for nodo in catalogo["nodos"]}
        self.assertEqual(
            {id_ for id_, nodo in nodos.items() if nodo["tipo"] == "conjunto"},
            {f"conjunto:{conjunto.id}" for conjunto in CONJUNTOS},
        )
        self.assertEqual(
            {id_ for id_, nodo in nodos.items() if nodo["tipo"] == "fuente"},
            {f"fuente:{nombre}" for nombre, _ in FUENTES_EN_ORDEN},
        )
        self.assertEqual(nodos["conjunto:formacion-catalogos"]["automatizacion"]["operacion"], "revision")
        self.assertEqual(nodos["fuente:datos_globales"]["automatizacion"]["red_declarada"], False)
        self.assertTrue(
            all(
                nodo["automatizacion"]["ejecucion_instalada"] == "no-acreditada"
                for nodo in nodos.values()
                if "automatizacion" in nodo
            )
        )

    def test_productor_es_el_archivo_real_del_modulo_registrado(self) -> None:
        """El traslado conserva un productor existente y no inventa un lector.py en la carpeta anterior."""
        nodos = {nodo["id"]: nodo for nodo in construir_catalogo()["nodos"]}
        for nombre, adaptador in FUENTES_EN_ORDEN:
            with self.subTest(fuente=nombre):
                ruta = nodos[f"fuente:{nombre}"]["productor"]
                self.assertTrue((RAIZ / ruta).is_file())
                self.assertEqual((RAIZ / ruta).resolve(), Path(adaptador.__file__).resolve())

    def test_fuente_queda_conectada_a_sus_conjuntos_y_salidas(self) -> None:
        """El inventario permite seguir una fuente hasta el paquete que usa el motor."""
        catalogo = construir_catalogo()
        alcanzados = {"fuente:oit"}
        pendientes = ["fuente:oit"]
        while pendientes:
            actual = pendientes.pop()
            for relacion in catalogo["relaciones"]:
                siguiente = relacion["salida"]
                if relacion["entrada"] == actual and siguiente not in alcanzados:
                    alcanzados.add(siguiente)
                    pendientes.append(siguiente)
        self.assertIn("conjunto:oit", alcanzados)
        self.assertIn("archivo:datos/oit.json", alcanzados)

    def test_conserva_clase_dominio_y_evidencia_de_productor(self) -> None:
        """La clasificación no pierde la historia ni contradice la propiedad declarada."""
        catalogo = construir_catalogo()
        nodos = {nodo["id"]: nodo for nodo in catalogo["nodos"]}
        self.assertEqual(nodos["conjunto:censo"]["clase"], "historica")
        self.assertEqual(nodos["conjunto:formacion-catalogos"]["clase"], "manual")
        salida = nodos["archivo:datos/oit.json"]
        self.assertIn("ocupaciones", salida["dominios"])
        self.assertTrue(salida["clasificacion_dominio"]["evidencias"])
        for nodo in nodos.values():
            if nodo.get("productor") and "cobertura_productor" in nodo:
                self.assertNotEqual(
                    nodo["cobertura_productor"], "productor-no-acreditado-por-este-inventario", nodo["id"]
                )

    def test_propiedad_por_temas_y_recursos_compartidos(self) -> None:
        """Cada fuente conserva una sola casa; un consumidor no la duplica."""
        catalogo = construir_catalogo()
        self.assertEqual(catalogo["version"], 2)
        nodos = {nodo["id"]: nodo for nodo in catalogo["nodos"]}
        for fuente, tema in (
            ("barcelonactiva", "cursos"),
            ("hp_life", "cursos"),
            ("cibervoluntarios", "cursos"),
            ("claude_academy", "cursos"),
            ("oit", "ocupaciones"),
            ("empresas", "mercado"),
            ("derechos", "derechos"),
            ("textos", "ocupaciones"),
            ("cambra", "ia_y_trabajo"),
            ("territorios", "comun"),
            ("nombres", "comun"),
            ("datos_globales", "derivados"),
            ("ia_nacional_che", "ia_y_trabajo"),
        ):
            self.assertEqual(nodos[f"fuente:{fuente}"]["dominio"], tema)
        self.assertEqual(nodos["conjunto:formacion-catalogos"]["dominio"], "cursos")

    def test_contrato_versionado_de_metodos_conecta_con_su_salida_sin_abrir_rutas(self) -> None:
        """La excepción es el archivo real leído por el exportador, no su carpeta ni código arbitrario."""
        self.assertEqual(CONDICIONES.relative_to(RAIZ).as_posix(), CONDICIONES_METODOS)
        catalogo = construir_catalogo()
        nodos = {nodo["id"]: nodo for nodo in catalogo["nodos"]}
        id_origen = f"archivo:{CONDICIONES_METODOS}"
        origen = nodos[id_origen]
        self.assertEqual(origen["dominio"], "ia_y_trabajo")
        self.assertTrue(origen["presente"])
        self.assertIsNone(origen["productor"])
        self.assertIn("contrato-versionado", origen["cobertura_productor"])
        self.assertIn(
            {
                "entrada": id_origen,
                "salida": "archivo:datos/metodos.json",
                "evidencia": "datos/manifiesto.json:origenes",
                "certeza": "observada",
            },
            catalogo["relaciones"],
        )
        for ruta in (
            "plataforma_datos/ia_y_trabajo/otro.json",
            "plataforma_datos/comun/nucleo.py",
            "plataforma_datos/ia_y_trabajo/../condiciones-metodos.json",
            "/" + CONDICIONES_METODOS,
            "config/conexiones/perfiles/perfil.json",
            "var/otro/estado.json",
        ):
            with self.subTest(ruta=ruta), self.assertRaises(ValueError):
                _ruta(ruta)

    def test_observaciones_biblioteca_conectan_generacion_y_consumidor_publico(self) -> None:
        """Declarar el recorrido real no acredita una consulta ni una ejecución instalada."""
        nodos = {nodo["id"]: nodo for nodo in construir_catalogo()["nodos"]}
        recurso = nodos["archivo:datos/observaciones-lecturas.json"]
        self.assertEqual(recurso["productor"], "fuente:enlaces_lecturas")
        consumidores = {c["ruta"]: c["evidencia"] for c in recurso["consumidores"]}
        self.assertIn("cargarProyeccionLecturas", consumidores["herramientas/web/lecturas.ts"])
        self.assertEqual(consumidores["herramientas/web/lecturas/observaciones.ts"], "cargarProyeccionLecturas")
        self.assertIn("iniciarEnlacesBiblioteca", consumidores["web/scripts/enlaces-biblioteca.js"])
        self.assertEqual(recurso["cobertura_productor"], "adaptador-declarado-sin-ejecucion-acreditada")

    def test_duplicar_la_casa_de_una_fuente_falla(self) -> None:
        """No escoge el primer tema cuando una configuración contradice otra."""
        duplicados = {tema: set(ids) for tema, ids in DOMINIOS.items()}
        duplicados["cursos"].add("oit")
        with (
            patch("plataforma_datos.orquestacion.catalogo_de_datos.DOMINIOS", duplicados),
            self.assertRaisesRegex(ValueError, "dos temas"),
        ):
            construir_catalogo()
        duplicados["cursos"].remove("oit")
        duplicados["cursos"].add("ia_nacional_che")
        with (
            patch("plataforma_datos.orquestacion.catalogo_de_datos.DOMINIOS", duplicados),
            self.assertRaisesRegex(ValueError, "familia de fuentes"),
        ):
            construir_catalogo()

    def test_no_exportar_un_archivo_no_significa_dato_sin_uso(self) -> None:
        """EAES no sale como archivo propio, pero su entrada declarada alimenta Mercado."""
        catalogo = construir_catalogo()
        ausentes = {fila["archivo"]: fila for fila in catalogo["sin_exportacion_individual"]}
        self.assertIn("datos/eaes.json", ausentes)
        self.assertIn("puede alimentar", ausentes["datos/eaes.json"]["alcance"])
        manifiesto = json.loads((RAIZ / "datos/manifiesto.json").read_bytes())
        origenes = manifiesto["mercado.json"]["origenes"]
        entradas_eaes = {
            ruta
            for ruta in origenes
            if ruta.startswith(("var/actualizacion/originales/eaes/", "var/actualizacion/validados/eaes/"))
        }
        self.assertTrue(entradas_eaes, "el manifiesto identifica la entrada de EAES")
        for ruta in entradas_eaes:
            self.assertIn(
                {
                    "entrada": f"archivo:{ruta}",
                    "salida": "archivo:datos/mercado.json",
                    "evidencia": "datos/manifiesto.json:origenes",
                    "certeza": "observada",
                },
                catalogo["relaciones"],
            )

    def test_empresas_y_sectores_exportados_conservan_sus_relaciones(self) -> None:
        """La entrega directa conserva la procedencia y el uso de Empresas en Datos globales."""
        catalogo = construir_catalogo()
        ausentes = {fila["archivo"] for fila in catalogo["sin_exportacion_individual"]}
        for fuente in ("empresas", "sectores"):
            self.assertNotIn(f"datos/{fuente}.json", ausentes)
            self.assertIn(
                {
                    "entrada": f"archivo:var/actualizacion/validados/{fuente}/{fuente}.json",
                    "salida": f"archivo:datos/{fuente}.json",
                    "evidencia": "datos/manifiesto.json:origenes",
                    "certeza": "observada",
                },
                catalogo["relaciones"],
            )
        self.assertTrue(
            any(
                relacion["entrada"] == "archivo:var/actualizacion/validados/empresas/empresas.json"
                and relacion["salida"] == "archivo:datos/globales/datos-globales.json"
                for relacion in catalogo["relaciones"]
            )
        )

    def test_hechos_editoriales_tienen_productor_consumidor_y_ruta_exacta(self) -> None:
        """El registro usado por el informe no se presenta como paquete ni actualización remota."""
        catalogo = construir_catalogo()
        nodos = {n["id"]: n for n in catalogo["nodos"]}
        registro = "archivo:plataforma_datos/ia_y_trabajo/fuentes/hechos_informe/registro.json"
        self.assertEqual(nodos[registro]["productor"], "fuente:hechos_informe")
        self.assertEqual(nodos[registro]["dominio"], "ia_y_trabajo")
        self.assertTrue(nodos[registro]["editorial"])
        self.assertTrue(
            any(c["ruta"] == "src/dominio/hechos-del-informe-breve.ts" for c in nodos[registro]["consumidores"])
        )
        self.assertFalse(nodos["fuente:hechos_informe"]["automatizacion"]["red_declarada"])
        self.assertTrue(nodos["fuente:hechos_informe"]["automatizacion"]["solo_validar"])
        self.assertTrue(
            any(r["entrada"] == "fuente:hechos_informe" and r["salida"] == registro for r in catalogo["relaciones"])
        )

    def test_biblioteca_conserva_metadatos_y_relacion_editorial(self) -> None:
        """Inventariar no borra la fuente, la licencia o la fecha ya declaradas."""
        catalogo = construir_catalogo()
        nodos = {nodo["id"]: nodo for nodo in catalogo["nodos"]}
        lecturas = json.loads((RAIZ / "datos/lecturas.json").read_text())["lecturas"]
        for lectura in lecturas:
            id_ = f"lectura:{lectura['id']}"
            for campo in ("fuente", "enlace", "enlace_ca", "consultado", "licencia", "fecha", "idiomas", "formato"):
                self.assertEqual(nodos[id_]["metadatos_publicados"].get(campo), lectura.get(campo))
            self.assertTrue(
                any(
                    r["entrada"] == id_ and r["salida"] == "archivo:datos/lecturas.json" for r in catalogo["relaciones"]
                )
            )

    def test_id_repetido_en_registro_no_sobrescribe_silenciosamente(self) -> None:
        """Dos declaraciones de un mismo conjunto no se convierten en una sola por accidente."""
        with (
            patch("plataforma_datos.orquestacion.catalogo_de_datos.CONJUNTOS", (*CONJUNTOS, CONJUNTOS[0])),
            self.assertRaisesRegex(ValueError, "duplicado"),
        ):
            construir_catalogo()

    def test_entradas_omitidas_aparecen_como_huerfanas(self) -> None:
        """La procedencia admitida no disimula los productores ausentes del registro."""
        catalogo = construir_catalogo()
        huerfanos = {
            incidencia["id"] for incidencia in comprobar_catalogo(catalogo) if incidencia["clase"] == "sin-productor"
        }
        self.assertTrue(any(id_.startswith("archivo:var/actualizacion/originales/metodos/") for id_ in huerfanos))
        # La EPA, la EAES y las ofertas tienen productor en el registro: sus originales ya no son huérfanos.
        for carpeta in ("epa", "eaes", "ofertas"):
            self.assertFalse(
                any(id_.startswith(f"archivo:var/actualizacion/originales/{carpeta}/") for id_ in huerfanos), carpeta
            )
        self.assertIn("archivo:var/actualizacion/validados/ia-nacional/ia-nacional.json", huerfanos)
        self.assertIn("archivo:var/actualizacion/validados/encuestas-isco4/encuestas-isco4.json", huerfanos)
        recursos = {nodo["id"]: nodo for nodo in catalogo["nodos"]}
        self.assertEqual(recursos["archivo:datos/enlaces-comprobados.json"]["regeneracion"], "composicion-local")
        self.assertEqual(recursos["archivo:datos/vectores-oit.json"]["regeneracion"], "copia-recurso-admitido")

    def test_detecta_referencias_rotas_ciclos_y_no_senala_un_diamante(self) -> None:
        """Una dependencia válida compartida no es un ciclo; un productor desconocido sí es un fallo."""
        nodos = [{"id": id_, "tipo": "fuente"} for id_ in ("a", "b", "c", "d")]
        relaciones = [{"entrada": a, "salida": b} for a, b in (("a", "b"), ("a", "c"), ("b", "d"), ("c", "d"))]
        catalogo = {"nodos": nodos, "relaciones": relaciones}
        self.assertEqual(comprobar_catalogo(catalogo), [])
        relaciones.append({"entrada": "d", "salida": "a"})
        relaciones.append({"entrada": "ausente", "salida": "d"})
        nodos.append({"id": "recurso", "tipo": "recurso", "productor": "fuente:ausente"})
        clases = [incidencia["clase"] for incidencia in comprobar_catalogo(catalogo)]
        self.assertEqual(clases.count("referencia-rota"), 2)
        self.assertIn("ciclo-o-dependencia-bloqueada", clases)

    def test_raiz_alternativa_rutas_unicode_y_ausencia_de_escrituras(self) -> None:
        """Solo copia metadatos pequeños: ninguna dependencia del cwd ni de los originales operativos."""
        with tempfile.TemporaryDirectory(prefix="Mis documentos Año 2026 ") as temporal:
            raiz = Path(temporal)
            for relativa in (
                "datos/manifiesto.json",
                "datos/lecturas.json",
                "src/plataforma/archivos-del-paquete.ts",
                "src/comun/nombres-propios.ts",
                "motores/ocupaciones/src/recorrido/pantalla/previa-fusion.ts",
            ):
                destino = raiz / relativa
                destino.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(RAIZ / relativa, destino)
            antes = {ruta.relative_to(raiz).as_posix(): ruta.read_bytes() for ruta in raiz.rglob("*") if ruta.is_file()}
            catalogo = construir_catalogo(raiz)
            despues = {
                ruta.relative_to(raiz).as_posix(): ruta.read_bytes() for ruta in raiz.rglob("*") if ruta.is_file()
            }
            self.assertEqual(antes, despues)
            self.assertNotIn(str(raiz), json.dumps(catalogo))
            self.assertIn(
                {"clase": "archivo-ausente", "id": "archivo:datos/mercado.json"}, comprobar_catalogo(catalogo)
            )
            manifiesto = raiz / "datos/manifiesto.json"
            manifiesto.write_text(
                json.dumps({"mercado.json": {"sha256": "x", "origenes": {"../privado": "x"}}}), encoding="utf-8"
            )
            with self.assertRaisesRegex(ValueError, "Ruta ajena"):
                construir_catalogo(raiz)

    def test_registro_con_dependencia_desconocida_no_parece_valido(self) -> None:
        """Una referencia rota introducida en el registro operativo llega al diagnóstico."""
        roto = (MODULOS[0]._replace(entradas=("fuente-inexistente",)), *MODULOS[1:])
        with patch("plataforma_datos.orquestacion.catalogo_de_datos.MODULOS", roto):
            incidencias = comprobar_catalogo(construir_catalogo())
        self.assertIn({"clase": "referencia-rota", "id": "fuente:fuente-inexistente → fuente:esco"}, incidencias)


if __name__ == "__main__":
    unittest.main()
