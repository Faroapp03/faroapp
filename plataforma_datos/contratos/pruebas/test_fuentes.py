"""Regresiones de descriptores operativos: identidad, política, seguridad y documentación portable."""

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from copy import deepcopy
from dataclasses import MISSING, FrozenInstanceError, fields, replace
from pathlib import Path
from unittest import mock

from plataforma_datos.contratos import fuentes

PLATAFORMA = Path(fuentes.__file__).resolve().parents[1]
IDS = (
    "formacion",
    "consorci",
    "agencia",
    "acreditacion",
    "citilab",
    "abierta",
    "certificados2016",
    "actic",
    "barcelonactiva",
    "fundae",
    "memoria",
)


def documento() -> dict[str, object]:
    """Lee un descriptor del paquete como entrada no validada para pruebas adversariales.

    Returns:
        Documento JSON nuevo; modificarlo no cambia el archivo del producto.
    """
    return json.loads((PLATAFORMA / "cursos/fuentes/formacion/fuente.json").read_text(encoding="utf-8"))


class PruebaContratoFuente(unittest.TestCase):
    """Las once declaraciones conservan el contrato operativo comprobado."""

    def test_politicas_conjuntos_dependencias_y_casas_exactas(self) -> None:
        """La expectativa congelada no se calcula a partir del registro que se comprueba."""
        esperado = json.loads(Path(__file__).with_name("operacion-cursos-v1.json").read_text(encoding="utf-8"))
        real = {
            d.id: {
                "actualizacion": d.actualizacion._asdict(),
                "conjuntos": [c._asdict() for c in d.conjuntos],
                "dependencias": list(d.dependencias),
                "casa_datos": d.casa_datos,
            }
            for d in fuentes.cargar_descriptores(IDS)
        }
        self.assertEqual(real, esperado)
        self.assertEqual(tuple(real), IDS)
        self.assertEqual(real["memoria"]["casa_datos"], "memoria-fpcat")
        self.assertTrue(real["fundae"]["actualizacion"]["red"])
        self.assertTrue(real["barcelonactiva"]["actualizacion"]["red"])
        self.assertEqual(real["barcelonactiva"]["actualizacion"]["politica"], "diaria")
        self.assertEqual(real["barcelonactiva"]["conjuntos"][0]["intervalo_dias"], 1)

    def test_documento_raiz_de_tipo_incorrecto_no_se_admite(self) -> None:
        """JSON legible no basta si no representa un objeto de descriptor."""
        for valor in (None, [], 1, True, "fuente"):
            with self.subTest(valor=valor), self.assertRaises(fuentes.ErrorDescriptor):
                fuentes.validar_descriptor(valor)

    def test_inmutabilidad_incluye_colecciones_anidadas(self) -> None:
        """La validación no retiene listas mutables del documento entrante."""
        original = documento()
        descriptor = fuentes.validar_descriptor(original)
        with self.assertRaises(FrozenInstanceError):
            descriptor.id = "otro"
        self.assertIsInstance(descriptor.dependencias, tuple)
        self.assertIsInstance(descriptor.recursos, tuple)
        self.assertIsInstance(descriptor.canales[0].recursos, tuple)
        self.assertIsInstance(descriptor.canales[0].limites, tuple)
        original["dependencias"].append("otra")
        original["canales"][0]["recursos"].append("otra")
        self.assertNotIn("otra", descriptor.dependencias)
        self.assertNotIn("otra", descriptor.canales[0].recursos)

    def test_campos_ausentes_extra_y_tipos_no_se_convierten(self) -> None:
        """Campos desconocidos, booleanos por enteros y tipos incorrectos se rechazan."""
        for cambiar in (
            lambda d: d.pop("significado"),
            lambda d: d.update(ejecutar="codigo"),
            lambda d: d.update(schema_version=True),
            lambda d: d.update(schema_version=2),
            lambda d: d.update(alcance="texto"),
            lambda d: d.update(institucion={}),
            lambda d: d["actualizacion"].update(red="false"),
            lambda d: d["actualizacion"].update(renovar_dias=True),
            lambda d: d["actualizacion"].update(politica="automatica"),
            lambda d: d["conjuntos"][0].update(intervalo_dias=True),
        ):
            dato = documento()
            cambiar(dato)
            with self.subTest(dato=dato), self.assertRaises(fuentes.ErrorDescriptor):
                fuentes.validar_descriptor(dato)

    def test_cadencias_y_operaciones_incoherentes_se_rechazan(self) -> None:
        """Una consulta remota requiere red declarada e intervalo entero positivo."""
        for cambiar in (
            lambda d: d["conjuntos"][0].update(intervalo_dias=0),
            lambda d: d["conjuntos"][0].update(intervalo_dias=-1),
            lambda d: d["conjuntos"][0].update(intervalo_dias=None),
            lambda d: d["conjuntos"][0].update(operacion="revision"),
            lambda d: d["conjuntos"][0].update(operacion="ejecutar"),
            lambda d: d["conjuntos"][0].update(clase="inventada"),
            lambda d: d["conjuntos"][0].update(alcance="todo-internet"),
            lambda d: d["actualizacion"].update(red=False),
        ):
            dato = documento()
            cambiar(dato)
            with self.subTest(dato=dato), self.assertRaises(fuentes.ErrorDescriptor):
                fuentes.validar_descriptor(dato)

    def test_ids_duplicados_y_referencias_ajenas_no_pasan(self) -> None:
        """Los duplicados se detectan por identidad, incluso con contenidos diferentes."""
        for cambiar in (
            lambda d: d["recursos"].append({**d["recursos"][0], "descripcion": "distinta"}),
            lambda d: d["canales"].append(deepcopy(d["canales"][0])),
            lambda d: d["conjuntos"].append(deepcopy(d["conjuntos"][0])),
            lambda d: d["conjuntos"][0].update(fuente="otra"),
            lambda d: d["canales"][0].update(recursos=["desconocido"]),
            lambda d: d["dependencias"].append("esco"),
            lambda d: d["dependencias"].append("formacion"),
            lambda d: d.update(lector="os.system"),
        ):
            dato = documento()
            cambiar(dato)
            with self.subTest(dato=dato), self.assertRaises(fuentes.ErrorDescriptor):
                fuentes.validar_descriptor(dato)

    def test_identidades_de_ruta_no_abren_archivos_ajenos(self) -> None:
        """IDs y temas con escapes se rechazan antes de leer un archivo."""
        for valor in ("../agencia", "/etc", "a/b", "a\\b", "", " formacion", "formacion\n"):
            with self.subTest(valor=valor), mock.patch.object(Path, "read_text") as leer:
                with self.assertRaises(fuentes.ErrorDescriptor):
                    fuentes.cargar_fuente(valor)
                with self.assertRaises(fuentes.ErrorDescriptor):
                    fuentes.cargar_fuente("formacion", tema=valor)
                leer.assert_not_called()

    def test_registro_estatico_debe_coincidir_sin_importar_json(self) -> None:
        """El descriptor no elige ni ejecuta un módulo arbitrario."""
        d = fuentes.cargar_fuente("memoria")
        correctos = {"identificador": "memoria", "modulo": d.lector, "casa": "memoria-fpcat"}
        fuentes.comprobar_lector(d, **correctos)
        for campo in correctos:
            with self.subTest(campo=campo), self.assertRaises(fuentes.ErrorDescriptor):
                fuentes.comprobar_lector(d, **{**correctos, campo: "ajeno"})

    def test_no_lee_hogar_y_desconocidos_siguen_visibles(self) -> None:
        """No se inventan licencias ni se consulta la configuración del operador."""
        with mock.patch.object(Path, "home", side_effect=AssertionError("hogar no permitido")):
            d = fuentes.cargar_fuente("fundae")
            texto = fuentes.generar_readme(d)
        self.assertTrue(any(r.licencia is None for r in d.recursos))
        self.assertIn("desconocida; no acreditada", texto)
        self.assertIn("Consulta red: sí", texto)
        self.assertEqual(texto, fuentes.generar_readme(d))

    def test_un_texto_que_ya_acaba_en_punto_no_lo_repite(self) -> None:
        """La licencia y la autenticación declaradas con su punto final no quedan con «..» en el README."""
        d = fuentes.cargar_fuente("fundae")
        recursos = tuple(r._replace(licencia="CC BY 4.0.") for r in d.recursos)
        canales = tuple(
            c._replace(autenticacion="No se configura autenticación de cuenta en el lector.") for c in d.canales
        )
        texto = fuentes.generar_readme(replace(d, recursos=recursos, canales=canales))
        self.assertIn("Licencia: CC BY 4.0.\n", texto)
        self.assertIn("Autenticación: No se configura autenticación de cuenta en el lector.\n", texto)
        self.assertNotIn("..\n", texto)
        self.assertNotIn(".. ", texto)
        sin_punto = fuentes.generar_readme(
            replace(d, recursos=tuple(r._replace(licencia="CC BY 4.0") for r in recursos))
        )
        self.assertIn("Licencia: CC BY 4.0.\n", sin_punto)

    def test_readmes_instalados_son_derivados_exactos(self) -> None:
        """La documentación no mantiene una segunda política editable."""
        for d in fuentes.cargar_descriptores(IDS):
            with self.subTest(fuente=d.id):
                ruta = PLATAFORMA / "cursos/fuentes" / d.id / "README.md"
                self.assertEqual(ruta.read_text(encoding="utf-8"), fuentes.generar_readme(d))
        self.assertEqual(fuentes.main(["--comprobar"]), 0)

    def test_schema_y_estructuras_comparten_campos_y_enumeraciones(self) -> None:
        """El esquema publicado describe los mismos campos cerrados del lector tipado."""
        schema = json.loads(Path(fuentes.__file__).with_name("fuente.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(
            set(schema["required"]), {f.name for f in fields(fuentes.DescriptorFuente) if f.default is MISSING}
        )
        self.assertFalse(schema["additionalProperties"])
        for nombre, tipo in (
            ("politica", fuentes.PoliticaActualizacion),
            ("conjunto", fuentes.ConjuntoComprobacion),
            ("canal", fuentes.CanalFuente),
            ("recurso", fuentes.RecursoFuente),
        ):
            self.assertEqual(tuple(schema["$defs"][nombre]["required"]), tipo._fields)
            self.assertFalse(schema["$defs"][nombre]["additionalProperties"])
        self.assertEqual(schema["$defs"]["politica"]["properties"]["politica"]["enum"], list(fuentes.POLITICAS))
        self.assertEqual(schema["$defs"]["conjunto"]["properties"]["operacion"]["enum"], list(fuentes.OPERACIONES))


class PruebaLecturaAislada(unittest.TestCase):
    """JSON corrupto y documentación distinta fallan con entradas temporales propias."""

    def setUp(self) -> None:
        """Prepara una casa de fuente aislada sin tocar los JSON instalados."""
        temporal = tempfile.TemporaryDirectory(prefix="descriptor ñ ")
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name).resolve()
        self.fuentes = self.raiz / "fuentes"
        self.casa = self.fuentes / "formacion"
        self.casa.mkdir(parents=True)
        self.archivo = self.casa / "fuente.json"
        self.dato = documento()
        self.archivo.write_text(json.dumps(self.dato), encoding="utf-8")
        parche = mock.patch.object(fuentes, "carpeta_de_fuentes", return_value=self.fuentes)
        parche.start()
        self.addCleanup(parche.stop)

    def test_json_duplicado_invalido_o_incompleto_falla(self) -> None:
        """Ningún error de lectura se convierte en una fuente vacía admitida."""
        repetido = json.dumps(self.dato).replace('"id": "formacion"', '"id": "formacion", "id": "otra"', 1)
        for cuerpo in (b"{", repetido.encode(), b"\xff", b"{}"):
            self.archivo.write_bytes(cuerpo)
            with self.subTest(cuerpo=cuerpo[:20]), self.assertRaises(fuentes.ErrorDescriptor):
                fuentes.cargar_fuente("formacion")
        self.archivo.unlink()
        with self.assertRaises(OSError):
            fuentes.cargar_fuente("formacion")

    def test_id_y_tema_distintos_del_archivo_se_rechazan(self) -> None:
        """Una ficha válida no puede ocupar la ubicación de otra fuente o tema."""
        for campo in ("id", "tema"):
            dato = deepcopy(self.dato)
            dato[campo] = "otra"
            dato["lector"] = f"plataforma_datos.{dato['tema']}.fuentes.{dato['id']}.lector"
            for conjunto in dato["conjuntos"]:
                conjunto["fuente"] = dato["id"]
            self.archivo.write_text(json.dumps(dato), encoding="utf-8")
            with self.assertRaises(fuentes.ErrorDescriptor):
                fuentes.cargar_fuente("formacion")

    def test_fuente_enlazada_fuera_del_paquete_no_se_lee(self) -> None:
        """El límite de lectura se comprueba tras resolver enlaces del descriptor."""
        ajeno = self.raiz / "ajeno.json"
        ajeno.write_text(self.archivo.read_text(encoding="utf-8"), encoding="utf-8")
        self.archivo.unlink()
        self.archivo.symlink_to(ajeno)
        with self.assertRaises(fuentes.ErrorDescriptor):
            fuentes.cargar_fuente("formacion")

    def test_duplicados_y_carga_vacia_no_dan_verde(self) -> None:
        """Un control sin fuentes y una lista repetida se rechazan explícitamente."""
        for ids in ((), ("formacion", "formacion"), "formacion"):
            with self.subTest(ids=ids), self.assertRaises(fuentes.ErrorDescriptor):
                fuentes.cargar_descriptores(ids)
        self.archivo.unlink()
        with self.assertRaises(fuentes.ErrorDescriptor):
            fuentes.cargar_descriptores()

    def test_conjuntos_duplicados_entre_dos_fuentes_validas_se_rechazan(self) -> None:
        """La unicidad global no se reduce a comprobar cada archivo por separado."""
        otra = deepcopy(self.dato)
        otra["id"] = "otra"
        otra["lector"] = "plataforma_datos.cursos.fuentes.otra.lector"
        for conjunto in otra["conjuntos"]:
            conjunto["fuente"] = "otra"
        casa = self.fuentes / "otra"
        casa.mkdir()
        (casa / "fuente.json").write_text(json.dumps(otra), encoding="utf-8")
        fuentes.cargar_fuente("otra")
        with self.assertRaisesRegex(fuentes.ErrorDescriptor, "conjunto.id global"):
            fuentes.cargar_descriptores(("formacion", "otra"))

    def test_comprobar_no_reescribe_y_regenerar_recupera(self) -> None:
        """La CLI detecta README ausente o alterado y nunca lo corrige en modo comprobar."""
        readme = self.casa / "README.md"
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(fuentes.main(["--comprobar"]), 1)
        self.assertFalse(readme.exists())
        self.assertEqual(fuentes.main([]), 0)
        valido = readme.read_bytes()
        readme.write_text("alterado", encoding="utf-8")
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(fuentes.main(["--comprobar"]), 1)
        self.assertEqual(readme.read_text(encoding="utf-8"), "alterado")
        self.assertEqual(fuentes.main([]), 0)
        self.assertEqual(readme.read_bytes(), valido)

    def test_readme_enlazado_fuera_del_paquete_no_se_escribe(self) -> None:
        """La generación tampoco puede seguir un README ajeno al paquete."""
        ajeno = self.raiz / "conservar.txt"
        ajeno.write_bytes(b"ajeno")
        (self.casa / "README.md").symlink_to(ajeno)
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(fuentes.main([]), 2)
        self.assertEqual(ajeno.read_bytes(), b"ajeno")

    def test_portabilidad_de_cli_desde_cwd_ajeno_con_espacios_unicode(self) -> None:
        """La copia mínima funciona sin instalación ni lector ejecutable y sin rutas externas de trabajo."""
        raiz = self.raiz / "Mis documentos/Año 2026"
        contrato = raiz / "plataforma_datos/contratos"
        shutil.copytree(Path(fuentes.__file__).parent, contrato, ignore=shutil.ignore_patterns("__pycache__"))
        (raiz / "plataforma_datos/__init__.py").write_text("", encoding="utf-8")
        casa = raiz / "plataforma_datos/cursos/fuentes/formacion"
        casa.mkdir(parents=True)
        shutil.copy2(self.archivo, casa / "fuente.json")
        cwd = self.raiz / "otro lugar ñ"
        cwd.mkdir()
        entorno = {**os.environ, "PYTHONPATH": str(raiz), "PYTHONDONTWRITEBYTECODE": "1"}
        orden = [sys.executable, "-B", "-m", "plataforma_datos.contratos.fuentes", "--fuente", "formacion"]
        for extra in ([], ["--comprobar"]):
            resultado = subprocess.run(orden + extra, cwd=cwd, env=entorno, capture_output=True, text=True, check=False)
            self.assertEqual(resultado.returncode, 0, resultado.stderr)
        self.assertFalse((casa / "lector.py").exists())
        self.assertEqual(
            (casa / "README.md").read_text(encoding="utf-8"),
            fuentes.generar_readme(fuentes.validar_descriptor(self.dato)),
        )


if __name__ == "__main__":
    unittest.main()
