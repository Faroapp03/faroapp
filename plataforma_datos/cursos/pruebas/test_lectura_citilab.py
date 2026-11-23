"""La descarga de Citilab emite en cada ciclo una lectura de sus fichas de formación, sin red ni reloj."""

import hashlib
import io
import json
import tempfile
import unittest
from contextlib import ExitStack, redirect_stdout
from datetime import date
from pathlib import Path
from typing import Any
from unittest import mock

import plataforma_datos.cursos.fuentes.citilab.lector as citilab
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, FormatoInesperado
from plataforma_datos.comun.periodos import MESES_CA
from plataforma_datos.cursos.fuentes.citilab import lectura
from plataforma_datos.cursos.lecturas.almacen_lecturas import carpeta_de_lecturas, listar_lecturas
from plataforma_datos.cursos.pruebas.test_citilab import ficha as ficha_de_base

PUBLICO = [{"id": 541, "slug": "adults"}, {"id": 562, "slug": "8-12-anys"}]
TEMAS = [{"id": 537, "slug": "competencies-digitals"}]
TOTALES_DE_UNA_PAGINA = {"public": {"total": 2, "paginas": 1}, "tipus-formacio": {"total": 1, "paginas": 1}}


def texto_de(dia: str) -> str:
    """Una fecha ISO escrita como la ficha: «15 de novembre de 2026».

    Returns:
        La fecha en catalán.
    """
    anyo, mes, numero = dia.split("-")
    return f"{int(numero)} de {MESES_CA[int(mes) - 1]} de {anyo}"


def curso(numero: int, *, inicio: str | None = None, fin: str | None = None, **campos: object) -> dict[str, Any]:
    """Una ficha de la API con la duración que se pida y su estado «532».

    Returns:
        La ficha, con su sección de duración y horario.
    """
    lineas = ["32 hores (16 sessions)"]
    lineas += [f"Inici (primera sessió): {texto_de(inicio)}"] if inicio else []
    lineas += [f"Final (última sessió): {texto_de(fin)}"] if fin else []
    html = "<p><strong>DURADA I HORARI</strong></p>" + "".join(f"<p>{linea}</p>" for linea in lineas)
    return ficha_de_base(**{"id": numero, "content": {"rendered": html}, "estat": [532], **campos})


def copia(
    original: Path, dia: str, fichas: list[dict[str, Any]], horas: tuple[str, str, str]
) -> tuple[list[dict[str, str]], dict[str, dict[str, int]]]:
    """Deja en `original` la copia de un día, como la dejaría la descarga, con la hora de recibo de cada recurso.

    Returns:
        Las entradas de procedencia y los totales declarados.
    """
    original.mkdir(parents=True, exist_ok=True)
    registros = []
    for (recurso, coleccion), hora in zip(
        (("formacio", fichas), ("public", PUBLICO), ("tipus-formacio", TEMAS)), horas, strict=True
    ):
        datos = json.dumps(coleccion, ensure_ascii=False).encode()
        archivo = f"{recurso}-{dia}.json"
        (original / archivo).write_bytes(datos)
        registros.append({"archivo": archivo, "sha256": hashlib.sha256(datos).hexdigest(), "descargado_utc": hora})
    return registros, {"formacio": {"total": len(fichas), "paginas": 1}, **TOTALES_DE_UNA_PAGINA}


def horas(dia: str, hora: str = "10:00:01.5") -> tuple[str, str, str]:
    """Las horas de recibo de las tres páginas de una copia: cada una unos segundos después de la anterior.

    Returns:
        Tres instantes con zona.
    """
    return (f"{dia}T{hora}+00:00", f"{dia}T10:00:04+00:00", f"{dia}T10:00:07+00:00")


def preparar_cursos(raiz: Path, cursos: list[dict[str, Any]]) -> None:
    """Deja los cursos que se ven hoy, como los deja la preparación."""
    ruta = raiz / DATOS_RELATIVOS / "preparados" / "citilab" / "cursos.json"
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps({"copia": "2026-11-14", "cursos": cursos}), encoding="utf-8")


class PruebaLecturaCitilab(unittest.TestCase):
    """La lectura de una copia recibida: censo, forma, salidas explicadas y declaraciones."""

    def setUp(self) -> None:
        """Una instalación temporal donde emitir."""
        self.raiz = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.original = self.raiz / DATOS_RELATIVOS / "originales" / "citilab"

    def emitir(self, dia: str, fichas: list[dict[str, Any]], hora: str = "10:00:01.5") -> dict[str, Any]:
        """Deja la copia del día, emite su lectura y exige que no haya problemas.

        Returns:
            La lectura emitida.
        """
        registros, totales = copia(self.original, dia, fichas, horas(dia, hora))
        resultado = lectura.emitir(self.original, registros, totales, citilab.calendario_de_la_ficha)
        self.assertEqual(resultado.problemas, ())
        return resultado.emisiones[0].lectura

    def test_dos_ciclos_dan_dos_lecturas_encadenadas(self) -> None:
        """Cada copia deja una lectura de sus fichas, a la hora del último recibo y con el total que declara la API."""
        primera = self.emitir("2026-11-15", [curso(1), curso(2)])
        segunda = self.emitir("2026-11-16", [curso(1), curso(2), curso(3)])
        self.assertEqual(
            [lec["lectura_id"] for lec in listar_lecturas(self.raiz, "citilab")],
            [primera["lectura_id"], segunda["lectura_id"]],
        )
        self.assertEqual(primera["ambito"], "citilab:formacio")
        self.assertEqual(primera["observado_utc"], "2026-11-15T10:00:07Z")
        self.assertEqual((primera["recuento_bruto"], primera["total_declarado"], primera["completa"]), (2, 2, True))
        self.assertEqual(segunda["anterior"], primera["lectura_id"])
        self.assertEqual(segunda["entradas"], ["3"])
        self.assertEqual(primera["huella_forma"]["niveles"], ["edicion"])
        self.assertEqual(primera["estado"], "sana")

    def test_vigente_es_lo_que_no_ha_terminado_el_dia_de_la_lectura(self) -> None:
        """El día de fin aún cuenta; un fin pasado no; unas fechas que se contradicen no dicen que haya terminado."""
        fichas = [
            curso(1, inicio="2026-10-01", fin="2026-11-15"),
            curso(2, inicio="2026-10-01", fin="2026-11-14"),
            curso(3, inicio="2026-12-01", fin="2026-11-01"),
            curso(4),
        ]
        # Con la hora de la copia a las 23:30 UTC del 14/11, en Cataluña ya es el 15/11.
        lectura_del_dia = self.emitir("2026-11-14", fichas, hora="23:30:00")
        self.assertEqual((lectura_del_dia["recuento_bruto"], lectura_del_dia["recuento_vigente"]), (4, 3))

    def test_una_salida_con_su_fin_pasado_queda_explicada_y_otra_sin_nada_no(self) -> None:
        """Lo último que se supo de una ficha que sale está en los cursos preparados, los que se ven."""
        preparar_cursos(
            self.raiz,
            [
                {"id": 1, "inicio": "2026-10-01", "fin": "2026-11-15"},
                {"id": 2, "inicio": "2026-10-01", "fin": "2026-12-31"},
                {"id": 3, "inicio": None, "fin": None},
            ],
        )
        self.emitir("2026-11-15", [curso(1), curso(2), curso(3), curso(4)])
        segunda = self.emitir("2026-11-17", [curso(4)])
        self.assertEqual(
            segunda["salidas"],
            [
                {"id": "1", "explicada_por": "fin_publicado"},
                {"id": "2", "explicada_por": None},
                {"id": "3", "explicada_por": None},
            ],
        )

    def test_un_valor_fuera_de_vocabulario_queda_anotado(self) -> None:
        """Un estado, un público o un tema que la copia no reconoce es un valor nuevo; los conocidos no."""
        sana = self.emitir("2026-11-15", [curso(1), curso(2, estat=[533])])
        self.assertEqual(sana["huella_forma"]["valores_nuevos"], [])
        rara = self.emitir("2026-11-16", [curso(1, estat=[534], public=[541, 999], **{"tipus-formacio": [7]})])
        self.assertEqual(
            rara["huella_forma"]["valores_nuevos"],
            [
                {"campo": "edicion.estat", "valor": "534"},
                {"campo": "edicion.public", "valor": "999"},
                {"campo": "edicion.tipus-formacio", "valor": "7"},
            ],
        )
        self.assertEqual((rara["estado"], rara["motivos"]), ("anomala", ["valor_desconocido"]))

    def test_la_forma_son_los_campos_de_las_fichas(self) -> None:
        """Una ficha sin uno de los campos que pide la consulta cambia la forma de la copia."""
        completa = self.emitir("2026-11-15", [curso(1)])
        sin_estado = {clave: valor for clave, valor in curso(1).items() if clave != "estat"}
        recortada = self.emitir("2026-11-16", [sin_estado])
        self.assertNotEqual(recortada["huella_forma"]["campos_sha256"], completa["huella_forma"]["campos_sha256"])
        self.assertEqual((recortada["estado"], recortada["motivos"]), ("anomala", ["forma_cambiada"]))

    def test_las_declaraciones_citan_su_lectura(self) -> None:
        """Cada ficha con fin cierto declara su fin, que termina al acabar su día en Cataluña; las demás, nada."""
        fichas = [
            curso(1, inicio="2026-10-01", fin="2026-12-02"),
            curso(2, inicio="2026-06-01", fin="2026-07-15"),
            curso(3, inicio="2026-12-01", fin="2026-11-01"),
            curso(4),
        ]
        leida = self.emitir("2026-05-01", fichas)
        declaradas = lectura.declaraciones(leida, fichas, citilab.calendario_de_la_ficha)
        self.assertEqual(set(declaradas), {"1", "2"})
        (invierno,), (verano,) = declaradas["1"], declaradas["2"]
        self.assertEqual((invierno.lectura_id, invierno.canal), (leida["lectura_id"], "fin_publicado"))
        self.assertEqual((invierno.cierra_el, verano.cierra_el), ("2026-12-02T23:00:00Z", "2026-07-15T22:00:00Z"))
        self.assertNotEqual(invierno.sha256, verano.sha256)
        with self.assertRaises(lectura.ErrorLecturaCitilab):
            lectura.declaraciones(leida, fichas[:2], citilab.calendario_de_la_ficha)

    def test_caso_real_una_ficha_terminada_sigue_en_la_lista(self) -> None:
        """La ficha 71191 de la copia del 15/11 acabó el 15/06 y Citilab sigue listándola: cuenta, no es vigente."""
        terminada = curso(71191, inicio="2026-02-09", fin="2026-06-15")
        primera = self.emitir("2026-10-06", [terminada, curso(71224, inicio="2026-10-01", fin="2026-11-24")])
        segunda = self.emitir("2026-11-15", [terminada, curso(71224, inicio="2026-10-01", fin="2026-11-24")])
        self.assertEqual((primera["recuento_bruto"], primera["recuento_vigente"]), (2, 1))
        self.assertEqual((segunda["recuento_bruto"], segunda["recuento_vigente"], segunda["salidas"]), (2, 1, []))

    def test_una_ficha_sin_forma_no_emite_y_lo_dice(self) -> None:
        """Una ficha sin id entero positivo no se puede identificar: el resultado lo dice y no se escribe lectura."""
        registros, totales = copia(
            self.original, "2026-11-15", [{"id": "uno", "content": {"rendered": ""}}], horas("2026-11-15")
        )
        resultado = lectura.emitir(self.original, registros, totales, citilab.calendario_de_la_ficha)
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("no tiene id ni texto", resultado.problemas[0])
        self.assertFalse(carpeta_de_lecturas(self.raiz, "citilab").exists())

    def test_una_carpeta_ajena_no_emite_y_lo_dice(self) -> None:
        """Fuera de una instalación no se escribe nada: el resultado dice por qué."""
        ajena = self.raiz / "citilab"
        registros, totales = copia(ajena, "2026-11-15", [curso(1)], horas("2026-11-15"))
        resultado = lectura.emitir(ajena, registros, totales, citilab.calendario_de_la_ficha)
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("no es la carpeta de originales", resultado.problemas[0])

    def test_un_original_que_ya_no_tiene_su_huella_no_emite_y_lo_dice(self) -> None:
        """La lectura sale de lo que dice la procedencia: un original alterado no deja lectura."""
        registros, totales = copia(self.original, "2026-11-15", [curso(1)], horas("2026-11-15"))
        (self.original / "formacio-2026-11-15.json").write_bytes(b"[]")
        resultado = lectura.emitir(self.original, registros, totales, citilab.calendario_de_la_ficha)
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("no coincide con su procedencia", resultado.problemas[0])


class PruebaDescargaEmiteSuLectura(unittest.TestCase):
    """El enganche en la descarga: emite al recibir la copia y nunca cambia lo que se conserva."""

    def setUp(self) -> None:
        """Una descarga sin red: la paginación se sustituye por una que deja la copia de prueba."""
        self.contexto = ExitStack()
        self.addCleanup(self.contexto.close)
        self.contexto.enter_context(redirect_stdout(io.StringIO()))
        self.fichas = [curso(1, inicio="2026-10-01", fin="2026-11-24"), curso(2)]
        self.caida: Exception | None = None

    def _recurso(
        self, carpeta: Path, consulta: tuple[str, str, str], dia: str, aceptar_cambio: bool
    ) -> tuple[list[dict[str, str]], dict[str, int]]:
        if self.caida is not None:
            raise self.caida
        recurso = consulta[0]
        coleccion = {"formacio": self.fichas, "public": PUBLICO, "tipus-formacio": TEMAS}[recurso]
        indice = ("formacio", "public", "tipus-formacio").index(recurso)
        registros, totales = copia(carpeta, dia, self.fichas, horas(dia))
        return [registros[indice]], totales[recurso] | {"total": len(coleccion)}

    def montar(self) -> Path:
        """Una instalación nueva, con la descarga de Citilab apuntando a ella.

        Returns:
            Su raíz.
        """
        raiz = Path(self.contexto.enter_context(tempfile.TemporaryDirectory()))
        original = raiz / DATOS_RELATIVOS / "originales" / "citilab"
        original.mkdir(parents=True)
        for nombre, valor in (
            ("ORIGINAL", original),
            ("PROCEDENCIA", original / "procedencia.json"),
        ):
            self.contexto.enter_context(mock.patch.object(citilab, nombre, valor))
        self.contexto.enter_context(mock.patch.object(citilab, "descargar_recurso", side_effect=self._recurso))
        return raiz

    def descargar(self) -> lectura.Resultado:
        """Descarga la copia del 15/11.

        Returns:
            Lo que dijo la emisión de su lectura.
        """
        return citilab.descargar(hoy=date(2026, 11, 15))

    def test_la_descarga_emite_la_lectura_de_la_copia(self) -> None:
        """La copia recibida deja una lectura de sus dos fichas, con el total que declara la API."""
        raiz = self.montar()
        resultado = self.descargar()
        self.assertEqual(resultado.problemas, ())
        (leida,) = listar_lecturas(raiz, "citilab")
        self.assertEqual((leida["recuento_bruto"], leida["total_declarado"], leida["recuento_vigente"]), (2, 2, 2))

    def test_una_emision_que_falla_no_cambia_la_procedencia(self) -> None:
        """Con la emisión rota, la copia y la procedencia quedan byte a byte como sin ella."""
        sana = self.montar()
        self.descargar()
        with mock.patch.object(lectura, "emitir_lectura", side_effect=OSError("disco lleno")):
            rota = self.montar()
            resultado = self.descargar()
        self.assertIn("disco lleno", resultado.problemas[0])
        self.assertFalse(carpeta_de_lecturas(rota, "citilab").exists())
        procedencia = DATOS_RELATIVOS / "originales" / "citilab" / "procedencia.json"
        self.assertEqual((rota / procedencia).read_bytes(), (sana / procedencia).read_bytes())

    def test_una_pagina_caida_detiene_la_descarga_y_no_deja_lectura(self) -> None:
        """Citilab no da un censo parcial: sin la copia entera no hay procedencia ni lectura."""
        raiz = self.montar()
        self.caida = FormatoInesperado("citilab: cuerpo y totales de paginación no concuerdan")
        with self.assertRaises(FormatoInesperado):
            self.descargar()
        self.assertFalse(carpeta_de_lecturas(raiz, "citilab").exists())
        self.assertFalse((raiz / DATOS_RELATIVOS / "originales" / "citilab" / "procedencia.json").exists())


if __name__ == "__main__":
    unittest.main()
