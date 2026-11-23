"""Pruebas de la formación (formacion.py): la cadena ocupación → especialidades → cursos, sus cruces y controles."""

import io
import re
import tempfile
import unittest
from contextlib import redirect_stderr
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

import plataforma_datos.cursos.fuentes.formacion.controles as controles_formacion
import plataforma_datos.cursos.fuentes.formacion.lector as formacion
from plataforma_datos.comun.nucleo import (
    Controles,
    FormatoInesperado,
)
from plataforma_datos.cursos.fuentes.formacion import calendario_soc
from plataforma_datos.cursos.fuentes.formacion.marco_digcomp import digcomp

RAIZ = Path(__file__).resolve().parents[3]

# Un registro de ofertaCursos.json del SOC, con sus campos tal como los publica (fechas en mes/día/año).
CURSO_DEL_SOC = {
    "curs": "467957",
    "tipus": "Formació ocupacional",
    "identificador_curs": "25/FOAP/781/0195455/017",
    "especialitat_formativa": "ACTIVITATS AUXILIARS EN AGRICULTURA.",
    "municipi_especialitat": "LLEIDA",
    "modalitat": "PRESENCIAL",
    "data_inici": "09/30/2026",
    "data_fi": "12/02/2026",
    "hores": "370",
    "estat_curs": "Curs en període d'informacio",
    "nom_centre": "AUTOESCOLA CAP PONT SL",
    "garantia_juvenil": "NO",
}


class PruebaFormacion(unittest.TestCase):
    """Cadena ocupación → especialidades → cursos."""

    def test_clave_nombre(self) -> None:
        """Los nombres se comparan sin tildes, mayúsculas ni signos."""
        self.assertEqual(formacion.clave_nombre("  Atenció   al CLIENT, (bàsic) "), "atencio al client basic")
        self.assertEqual(formacion.clave_nombre(None), "")

    def test_fecha_iso(self) -> None:
        """Las fechas del SOC (mes/día/año) pasan a ISO."""
        self.assertEqual(calendario_soc.fecha_iso_desde_mdy("09/27/2026"), "2026-09-27")
        self.assertIsNone(calendario_soc.fecha_iso_desde_mdy(""))

    def test_destinatarios_segun_el_tipo_que_publica_el_soc(self) -> None:
        """La formación ocupacional se dirige sobre todo a quien busca empleo; de un tipo sin ficha no se dice nada."""
        curso = formacion._curso(CURSO_DEL_SOC, {})
        self.assertEqual(curso["tipo"], "Formació ocupacional")
        self.assertEqual(curso["destinatarios"], "en-busqueda-de-empleo")
        self.assertIsNone(formacion._curso({**CURSO_DEL_SOC, "tipus": "Un tipus nou"}, {})["destinatarios"])

    def test_cursos_con_campos_posibles(self) -> None:
        """Un curso que termina antes de empezar o con un campo imposible hace fallar la validación."""
        bueno = formacion._curso(CURSO_DEL_SOC, {})
        sin_datos = {**bueno, "id": "otro", "inicio": None, "fin": None, "horas": "", "destinatarios": None}
        el_mismo_dia = {**bueno, "id": "de-un-dia", "fin": bueno["inicio"]}
        correctos = Controles()
        controles_formacion._controles_cursos(correctos, [bueno, sin_datos, el_mismo_dia])
        self.assertTrue(correctos.admitido, correctos.fallidos)
        for cambio in [
            {"fin": "2026-09-29"},
            {"inicio": "2026-02-30"},
            {"fin": "12/01/2026"},
            {"horas": "0"},
            {"horas": "cuarenta"},
            {"destinatarios": "todo el mundo"},
            {"id": sin_datos["id"]},
        ]:
            with self.subTest(cambio=cambio):
                controles = Controles()
                controles_formacion._controles_cursos(controles, [{**bueno, **cambio}, sin_datos])
                self.assertFalse(controles.admitido)

    def test_aviso_de_copia_antigua_sin_fallar(self) -> None:
        """Una copia de más de MAX_DIAS_COPIA_CURSOS días avisa por la salida de errores, sin fallar; hasta ahí, no."""
        copia = date(2026, 9, 27)
        limite = copia + timedelta(days=formacion.MAX_DIAS_COPIA_CURSOS)
        self.assertIsNone(formacion._aviso_copia_antigua(copia, limite))
        aviso = formacion._aviso_copia_antigua(copia, limite + timedelta(days=1))
        self.assertIn(f"{formacion.MAX_DIAS_COPIA_CURSOS + 1} días", aviso or "")
        salida = io.StringIO()
        with mock.patch.object(formacion, "_fecha_de_la_copia", return_value=copia), redirect_stderr(salida):
            formacion._avisar_de_copia_antigua(limite + timedelta(days=1))
            formacion._avisar_de_copia_antigua(limite)
        self.assertEqual(salida.getvalue().count("27/09/2026"), 1)

    def test_fecha_de_la_copia_mas_reciente(self) -> None:
        """La fecha de la copia es la del archivo de cursos más reciente que registra la procedencia."""
        archivos = ["soc-cursos-2026-09-27.json", "soc-cursos-2026-10-04.json", "digcomp-3.0.jsonld"]
        registrada = {"archivos": [{"archivo": archivo} for archivo in archivos]}
        with mock.patch.object(formacion, "procedencia", return_value=registrada):
            self.assertEqual(formacion._fecha_de_la_copia(), date(2026, 10, 4))

    def test_digcomp(self) -> None:
        """Del JSON-LD se toman competencias y resultados con su etiqueta de IA, sin importar el prefijo."""
        grafo = {
            "@graph": [
                {"@type": "Competence", "dc:identifier": "1.1", "skos:prefLabel": [{"@value": "Buscar"}]},
                {"@type": "CompetenceArea", "dc:identifier": "1"},
                {"@type": "Learning Outcome", "dc:identifier": "LO1", "text": "Usa IA", "aiLabel": "explicit"},
            ]
        }
        marco = digcomp(grafo)
        self.assertEqual(marco["competencias"], [{"id": "1.1", "titulo": "Buscar", "descripcion": None}])
        self.assertEqual(marco["resultados"][0]["ia"], "explicit")

    def test_digcomp_con_relaciones_del_suplemento_oficial(self) -> None:
        """Los campos del suplemento JRC conservan competencia y tipo, distinto del @type del nodo."""
        grafo = {
            "@graph": [
                {
                    "@type": "LearningOutcome",
                    "@id": "LearningOutcome/LO1.1.01",
                    "description": "Buscar información",
                    "type": "Attitude",
                    "ai_label": "AI-Implicit",
                    "competence_id": "Competence/1.1",
                }
            ]
        }
        resultado = digcomp(grafo)["resultados"][0]
        self.assertEqual(resultado["competencia"], "Competence/1.1")
        self.assertEqual(resultado["tipo"], "Attitude")

    def test_digcomp_rechaza_relaciones_perdidas_o_desconocidas(self) -> None:
        """Contar registros no basta: todos los resultados deben conservar su vínculo y su tipo."""
        competencias = [
            {"id": f"Competence/{indice}"} for indice in range(controles_formacion.MIN_COMPETENCIAS_DIGCOMP)
        ]
        resultado = {"competencia": "Competence/0", "tipo": "Knowledge"}
        marco = {"competencias": competencias, "resultados": [resultado] * controles_formacion.MIN_RESULTADOS_DIGCOMP}
        correctos = Controles()
        controles_formacion._controles_digcomp(correctos, marco)
        self.assertTrue(correctos.admitido)
        for campo, valor in [
            ("competencia", None),
            ("competencia", "desconocida"),
            ("tipo", None),
            ("tipo", "LearningOutcome"),
        ]:
            with self.subTest(campo=campo, valor=valor):
                incompleto = {**marco, "resultados": [{**resultado, campo: valor}, *marco["resultados"][1:]]}
                controles = Controles()
                controles_formacion._controles_digcomp(controles, incompleto)
                self.assertFalse(controles.admitido)

    def test_cobertura_por_grupo_salvo_relacion_estrecha(self) -> None:
        """Una ocupación llega a una especialidad por código exacto o por grupo, salvo desde una relación estrecha."""
        especialidades = [{"codigo": "E1", "ocupaciones": ["12345678"]}]
        eures = [
            {"esco": "a", "cosispe": "12345678", "relacion": "exacta"},
            {"esco": "b", "cosispe": "12349999", "relacion": "amplia"},
            {"esco": "c", "cosispe": "12349999", "relacion": "estrecha"},
        ]
        cobertura = controles_formacion.cobertura({"a": "", "b": "", "c": ""}, eures, especialidades, [])
        self.assertEqual(cobertura["ocupaciones_con_especialidad_sepe"], 2)


class PruebaLecturaDeLosOriginales(unittest.TestCase):
    """Un original distinto del esperado se para con un motivo legible, no con un error de Python."""

    def _eures(self, crudo: str) -> list[dict[str, str]]:
        """Lee un CSV de EURES escrito en una carpeta temporal, con una ocupación ESCO conocida.

        Args:
            crudo: Contenido del CSV.

        Returns:
            Las relaciones que lee `_eures`.
        """
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = Path(carpeta) / "eures.csv"
            ruta.write_text(crudo, encoding="utf-8")
            with mock.patch.object(formacion, "original", return_value=ruta):
                return formacion._eures({"http://esco/1": "1111.1"})

    def test_eures_valido(self) -> None:
        """La tabla se lee desde su cabecera, después de las líneas de presentación."""
        cabecera = "Classification 1 URI,Classification 2 ID,Classification 2 PrefLabel,Mapping relation"
        crudo = f"Presentación\n{cabecera}\nhttp://esco/1, 12345678 ,Oficio,skos:exactMatch\n"
        self.assertEqual(
            self._eures(crudo), [{"esco": "1111.1", "cosispe": "12345678", "relacion": "exacta", "etiqueta": "Oficio"}]
        )

    def test_eures_sin_cabecera_columna_o_relacion_conocida(self) -> None:
        """Sin la cabecera, sin una columna o con una relación desconocida, FormatoInesperado con su motivo."""
        completa = "Classification 1 URI,Classification 2 ID,Classification 2 PrefLabel,Mapping relation"
        for crudo, motivo in [
            ("Otra tabla\na,b\n", "cabecera"),
            ("Classification 1 URI,Classification 2 ID,Mapping relation\nhttp://esco/1,1,x\n", "columnas"),
            (f"{completa}\nhttp://esco/1,12345678,Oficio,skos:relatedMatch\n", "relatedMatch"),
        ]:
            with self.subTest(motivo=motivo), self.assertRaisesRegex(FormatoInesperado, motivo):
                self._eures(crudo)

    def test_sepe_sin_una_columna(self) -> None:
        """Una hoja del SEPE sin una de sus columnas se para con el nombre de la que falta."""
        fila = {columna: "x" for columna in formacion.COLUMNAS_SEPE if columna != "VERSIÓN"}
        with (
            mock.patch.object(formacion, "procedencia", return_value={"archivo": "sepe.xlsx"}),
            mock.patch.object(formacion, "original", return_value=Path("sepe.xlsx")),
            mock.patch.object(formacion, "leer_xlsx", return_value=[fila]),
            self.assertRaisesRegex(FormatoInesperado, "VERSIÓN"),
        ):
            formacion._sepe()

    def test_municipio_con_su_forma_oficial(self) -> None:
        """El municipio de un curso conserva las partículas en minúscula y las elisiones de su nombre oficial."""
        for publicado, legible in [
            ("L'HOSPITALET DE LLOBREGAT", "L'Hospitalet de Llobregat"),
            ("VILANOVA I LA GELTRÚ", "Vilanova i la Geltrú"),
        ]:
            with self.subTest(publicado=publicado):
                curso = formacion._curso({**CURSO_DEL_SOC, "municipi_especialitat": publicado}, {})
                self.assertEqual(curso["municipio"], legible)

    def test_digcomp_en_lista_o_rechazado(self) -> None:
        """Un JSON-LD que es directamente la lista de nodos se lee; otro valor se rechaza con su motivo."""
        marco = digcomp([{"@type": "Competence", "dc:identifier": "1.1"}])
        self.assertEqual([competencia["id"] for competencia in marco["competencias"]], ["1.1"])
        for grafo in ["texto", {"@graph": ["no es un nodo"]}]:
            with self.subTest(grafo=grafo), self.assertRaises(FormatoInesperado):
                digcomp(grafo)


class PruebaUmbralCompartidoConElMotor(unittest.TestCase):
    """La cadena y el informe avisan de una copia de cursos antigua con el mismo umbral."""

    def test_max_dias_copia_cursos_igual_que_en_el_motor(self) -> None:
        """MAX_DIAS_COPIA_CURSOS de la cadena es el mismo número que el del motor (en compartido/, que él reexporta)."""
        fuente = (RAIZ / "compartido/contratos/formacion-del-informe.ts").read_text(encoding="utf-8")
        declarado = re.search(r"export const MAX_DIAS_COPIA_CURSOS = (\d+);", fuente)
        self.assertIsNotNone(declarado)
        self.assertEqual(int(declarado.group(1) if declarado else ""), formacion.MAX_DIAS_COPIA_CURSOS)


if __name__ == "__main__":
    unittest.main()
