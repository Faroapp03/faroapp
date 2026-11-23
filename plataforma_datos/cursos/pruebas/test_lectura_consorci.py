"""La descarga del Consorci emite en cada ciclo una lectura de sus ediciones y otra de sus acciones previstas."""

import hashlib
import io
import json
import tempfile
import unittest
from contextlib import ExitStack, redirect_stdout
from datetime import date
from pathlib import Path
from unittest import mock

import plataforma_datos.cursos.fuentes.consorci.lector as consorci
from plataforma_datos.comun import entrada_salida, red, socrata
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, Descarga
from plataforma_datos.cursos.fuentes.consorci import lectura
from plataforma_datos.cursos.fuentes.consorci.constantes import ACCIONES, ACCIONES_PREVISTAS
from plataforma_datos.cursos.fuentes.consorci.filas_publicadas import (
    fechas_de_la_edicion,
    id_de_edicion,
)
from plataforma_datos.cursos.lecturas.almacen_lecturas import carpeta_de_lecturas, listar_lecturas
from plataforma_datos.cursos.pruebas.test_consorci import ACCION, PREVISTA, metadatos

HORA = "2026-11-15T10:39:16.200953+00:00"


def edicion(numero: int, inicio: str = "2026-11-20", fin: str = "2026-12-15", **campos: str) -> dict[str, str]:
    """Una fila de qv5z-dgk3: la acción de la prueba con otro número, otras fechas y los campos que se cambien.

    Returns:
        La fila tal como la publica el Consorci.
    """
    return {
        **ACCION,
        "identificador": str(numero),
        "data_inici": f"{inicio}T00:00:00.000",
        "data_final": f"{fin}T00:00:00.000",
        **campos,
    }


def ident(numero: int, inicio: str = "20261120", fin: str = "20261215", letra: str = "v") -> str:
    """El identificador de la edición de ese número en `edicion` (modalidad «adaptada a Aula virtual»).

    Returns:
        El identificador de la edición.
    """
    return f"{numero}-2-{inicio}-{fin}-{letra}"


def prevista(numero: int, **campos: str) -> dict[str, str]:
    """Una fila de hhvr-cedj: la acción prevista de la prueba con otro número.

    Returns:
        La fila tal como la publica el Consorci.
    """
    return {**PREVISTA, "identificador": str(numero), **campos}


def carpeta_de(raiz: Path) -> Path:
    """La carpeta de originales del Consorci de una instalación bajo `raiz`.

    Returns:
        La ruta, creada.
    """
    carpeta = raiz / DATOS_RELATIVOS / "originales" / "consorci"
    carpeta.mkdir(parents=True, exist_ok=True)
    return carpeta


def conservar(
    carpeta: Path,
    dia: str,
    filas: tuple[list[dict[str, str]], list[dict[str, str]]],
    *,
    hora: str = HORA,
    declaradas: tuple[int, int] | None = None,
) -> None:
    """Deja en `carpeta` la copia de ese día de los dos conjuntos que se leen, con su procedencia y sus metadatos.

    Args:
        carpeta: La carpeta de originales del Consorci.
        dia: El día de la copia.
        filas: Las filas de qv5z-dgk3 y las de hhvr-cedj.
        hora: La hora de la descarga de las filas, la que anota la procedencia.
        declaradas: Las filas que declaran los metadatos de cada conjunto; por omisión, las descargadas.
    """
    declaradas = declaradas or (len(filas[0]), len(filas[1]))
    archivos = []
    for conjunto, del_conjunto, declaradas_del_conjunto in zip(
        (ACCIONES, ACCIONES_PREVISTAS), filas, declaradas, strict=True
    ):
        contenidos = (
            (socrata.nombre_de_datos(conjunto, dia), json.dumps(del_conjunto).encode()),
            (socrata.nombre_de_metadatos(conjunto, dia), metadatos(filas=declaradas_del_conjunto)),
        )
        for nombre, datos in contenidos:
            (carpeta / nombre).write_bytes(datos)
            archivos.append({"archivo": nombre, "sha256": hashlib.sha256(datos).hexdigest(), "descargado_utc": hora})
    entrada_salida.guardar_json(carpeta / "procedencia.json", {"copia": dia, "archivos": archivos})


class PruebaLecturaConsorci(unittest.TestCase):
    """La lectura de la copia conservada: censos, salidas explicadas y declaraciones."""

    def setUp(self) -> None:
        """Una instalación temporal donde emitir."""
        self.raiz = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.carpeta = carpeta_de(self.raiz)

    def emitir(self, dia: str, ediciones: list[dict], previstas: list[dict], **opciones: object) -> dict[str, dict]:
        """Conserva la copia, emite sus lecturas y exige que no haya problemas.

        Returns:
            Las lecturas emitidas, por ámbito.
        """
        conservar(self.carpeta, dia, (ediciones, previstas), **opciones)
        resultado = lectura.emitir(self.carpeta)
        self.assertEqual(resultado.problemas, ())
        return {emision.lectura["ambito"]: emision.lectura for emision in resultado.emisiones}

    def test_dos_ciclos_dan_dos_lecturas_encadenadas_por_ambito(self) -> None:
        """Cada copia deja una lectura de las ediciones y otra de las previstas, a la hora de su descarga."""
        primera = self.emitir("2026-11-15", [edicion(1), edicion(2)], [prevista(1), prevista(2)])
        segunda = self.emitir(
            "2026-11-16",
            [edicion(1), edicion(2), edicion(3)],
            [prevista(1), prevista(2)],
            hora="2026-11-16T10:00:00+00:00",
        )
        self.assertEqual(set(primera), {"consorci:edicion", "consorci:prevista"})
        for ambito, anterior, siguiente in ((a, primera[a], segunda[a]) for a in primera):
            with self.subTest(ambito=ambito):
                self.assertEqual(siguiente["anterior"], anterior["lectura_id"])
        edicion_1 = primera["consorci:edicion"]
        self.assertEqual(edicion_1["observado_utc"], "2026-11-15T10:39:16Z")
        self.assertEqual(
            (edicion_1["recuento_bruto"], edicion_1["total_declarado"], edicion_1["completa"]), (2, 2, True)
        )
        self.assertEqual(segunda["consorci:edicion"]["entradas"], [ident(3)])
        self.assertEqual(segunda["consorci:prevista"]["entradas"], [])
        self.assertEqual(edicion_1["huella_forma"]["niveles"], ["edicion"])
        self.assertEqual(primera["consorci:prevista"]["huella_forma"]["niveles"], ["programa"])
        self.assertEqual(len(listar_lecturas(self.raiz, "consorci")), 4)

    def test_vigente_es_lo_que_no_ha_terminado_el_dia_de_la_lectura(self) -> None:
        """El día de fin aún cuenta; un fin pasado no; unas fechas que se contradicen no dicen que haya terminado."""
        ediciones = [
            edicion(1, inicio="2026-11-01", fin="2026-11-15"),
            edicion(2, inicio="2026-11-01", fin="2026-11-14"),
            edicion(3, inicio="2026-12-01", fin="2026-11-02"),
        ]
        # 23:30 UTC del 14/11 ya es el 15/11 en Cataluña.
        leida = self.emitir("2026-11-14", ediciones, [prevista(1)], hora="2026-11-14T23:30:00+00:00")
        self.assertEqual(leida["consorci:edicion"]["recuento_vigente"], 2)
        self.assertEqual(leida["consorci:prevista"]["recuento_vigente"], 1)

    def test_una_salida_con_su_fin_pasado_queda_explicada_y_otra_sin_nada_no(self) -> None:
        """El fin que lleva el identificador explica la salida; una edición que sale antes de su fin, no."""
        ediciones = [edicion(1, "2026-11-01", "2026-11-15"), edicion(2, fin="2026-12-31"), edicion(3, fin="2026-12-31")]
        self.emitir("2026-11-15", ediciones, [prevista(1), prevista(2)])
        segunda = self.emitir(
            "2026-11-17", [edicion(3, fin="2026-12-31")], [prevista(2)], hora="2026-11-17T08:00:00+00:00"
        )
        self.assertEqual(
            segunda["consorci:edicion"]["salidas"],
            [
                {"id": ident(1, "20261101", "20261115"), "explicada_por": "fin_publicado"},
                {"id": ident(2, fin="20261231"), "explicada_por": None},
            ],
        )
        self.assertEqual(segunda["consorci:prevista"]["salidas"], [{"id": "1", "explicada_por": None}])

    def test_un_censo_incompleto_da_una_lectura_incompleta(self) -> None:
        """Una descarga que llega al límite de filas por petición puede haberse cortado: no vale como censo entero."""
        with mock.patch.object(lectura, "LIMITE_FILAS", 2):
            leidas = self.emitir("2026-11-15", [edicion(1), edicion(2)], [prevista(1)])
        self.assertEqual(
            (leidas["consorci:edicion"]["estado"], leidas["consorci:edicion"]["motivo_incompleta"]),
            ("incompleta", "limite_alcanzado"),
        )
        self.assertEqual(leidas["consorci:prevista"]["estado"], "sana")

    def test_un_valor_fuera_de_vocabulario_queda_anotado(self) -> None:
        """La modalidad que la validación no conoce se anota en la forma; la minúscula de «adaptada» sí se conoce."""
        leidas = self.emitir(
            "2026-11-15",
            [edicion(1), edicion(2, modalitat="Híbrida")],
            [prevista(1, modalitat="Presencial"), prevista(2, modalitat="Mixta")],
        )
        self.assertEqual(
            leidas["consorci:edicion"]["huella_forma"]["valores_nuevos"],
            [{"campo": "edicion.modalitat", "valor": "Híbrida"}],
        )
        self.assertEqual(leidas["consorci:edicion"]["estado"], "anomala")
        self.assertEqual(leidas["consorci:prevista"]["huella_forma"]["valores_nuevos"], [])
        otra = self.emitir(
            "2026-11-16",
            [edicion(1)],
            [prevista(1, modalitat="Híbrida")],
            hora="2026-11-16T08:00:00+00:00",
        )
        self.assertEqual(
            otra["consorci:prevista"]["huella_forma"]["valores_nuevos"],
            [{"campo": "programa.modalitat", "valor": "Híbrida"}],
        )

    def test_el_total_que_declaran_los_metadatos_se_compara_con_las_filas(self) -> None:
        """Si los metadatos dicen otro número de filas que las descargadas, la lectura queda anómala."""
        leidas = self.emitir("2026-11-15", [edicion(1)], [prevista(1)], declaradas=(2, 1))
        self.assertEqual(leidas["consorci:edicion"]["total_declarado"], 2)
        self.assertEqual(
            (leidas["consorci:edicion"]["estado"], leidas["consorci:edicion"]["motivos"]),
            ("anomala", ["total_declarado_distinto"]),
        )
        self.assertEqual(leidas["consorci:prevista"]["estado"], "sana")

    def test_las_filas_repetidas_cuentan_en_el_bruto_y_no_en_los_identificadores(self) -> None:
        """Una fila repetida trae su registro, no otra edición: el bruto es el de las filas que declara la fuente."""
        leidas = self.emitir("2026-11-15", [edicion(1), edicion(1)], [prevista(1)])
        self.assertEqual(
            (leidas["consorci:edicion"]["recuento_bruto"], leidas["consorci:edicion"]["total_declarado"]), (2, 2)
        )
        self.assertEqual(leidas["consorci:edicion"]["entradas"], [ident(1)])

    def test_las_declaraciones_citan_su_lectura(self) -> None:
        """Cada edición declara su fin, que termina al acabar su día en Cataluña; sin fecha cierta no declara nada."""
        ediciones = [
            edicion(1),
            edicion(2, inicio="2026-06-01", fin="2026-07-15"),
            edicion(3, inicio="2026-12-01", fin="2026-11-02"),
        ]
        leida = self.emitir("2026-05-01", ediciones, [prevista(1)], hora="2026-05-01T08:00:00+00:00")[
            "consorci:edicion"
        ]
        declaradas = lectura.declaraciones(leida, ediciones)
        self.assertEqual(set(declaradas), {ident(1), ident(2, "20260601", "20260715")})
        (invierno,) = declaradas[ident(1)]
        (verano,) = declaradas[ident(2, "20260601", "20260715")]
        self.assertEqual((invierno.lectura_id, invierno.canal), (leida["lectura_id"], "fin_publicado"))
        self.assertEqual((invierno.cierra_el, verano.cierra_el), ("2026-12-15T23:00:00Z", "2026-07-15T22:00:00Z"))
        self.assertNotEqual(invierno.sha256, verano.sha256)
        with self.assertRaises(lectura.ErrorLecturaConsorci):
            lectura.declaraciones(leida, ediciones[:1])

    def test_las_previstas_no_declaran_nada(self) -> None:
        """Una acción prevista no publica fecha ni estado: no hay declaraciones de su lectura."""
        leidas = self.emitir("2026-11-15", [edicion(1)], [prevista(1)])
        with self.assertRaises(lectura.ErrorLecturaConsorci):
            lectura.declaraciones(leidas["consorci:prevista"], [prevista(1)])

    def test_el_identificador_lleva_sus_fechas(self) -> None:
        """Las fechas que lleva el identificador son las de la fila; una fecha que no se publica deja su hueco."""
        fila = edicion(7, inicio="2026-11-12", fin="2026-11-26", modalitat="Presencial")
        self.assertEqual(id_de_edicion(fila), "7-2-20261112-20261126-p")
        self.assertEqual(fechas_de_la_edicion("7-2-20261112-20261126-p"), ("2026-11-12", "2026-11-26"))
        sin_fin = {**fila, "data_final": "31/02/2026"}
        self.assertEqual(fechas_de_la_edicion(id_de_edicion(sin_fin)), ("2026-11-12", None))
        sin_fechas = {**fila, "data_inici": "", "data_final": ""}
        self.assertEqual(fechas_de_la_edicion(id_de_edicion(sin_fechas)), (None, None))
        self.assertEqual(fechas_de_la_edicion("no-es-una-edicion"), (None, None))

    def test_caso_real_una_edicion_de_la_copia_del_15_de_noviembre_sale_al_terminar(self) -> None:
        """La edición real del curso de IA generativa (fin el 26/11/2026) que ya no está el 27/11 sale explicada."""
        self.emitir("2026-11-15", [ACCION, edicion(2)], [PREVISTA])
        segunda = self.emitir("2026-11-27", [edicion(2)], [PREVISTA], hora="2026-11-27T09:00:00+00:00")
        self.assertEqual(
            segunda["consorci:edicion"]["salidas"],
            [{"id": "294021-2-20261006-20261126-v", "explicada_por": "fin_publicado"}],
        )

    def test_una_fila_sin_su_identificador_no_emite_y_lo_dice(self) -> None:
        """Una fila sin un campo con que se identifica no deja lectura de su ámbito; la otra sigue."""
        sin_modalidad = {clave: valor for clave, valor in edicion(1).items() if clave != "modalitat"}
        conservar(self.carpeta, "2026-11-15", ([sin_modalidad], [prevista(1)]))
        resultado = lectura.emitir(self.carpeta)
        self.assertEqual([e.lectura["ambito"] for e in resultado.emisiones], ["consorci:prevista"])
        self.assertIn("la fila 1 no publica «modalitat»", resultado.problemas[0])

    def test_una_carpeta_ajena_no_emite_y_lo_dice(self) -> None:
        """Fuera de una instalación no se escribe nada: el resultado dice por qué."""
        resultado = lectura.emitir(self.raiz / "consorci")
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("no es la carpeta de originales", resultado.problemas[0])


class PruebaDescargaEmiteSuLectura(unittest.TestCase):
    """El enganche en la descarga: emite tras conservar la copia y nunca cambia lo que se conserva."""

    def setUp(self) -> None:
        """Las filas que devuelve la API simulada: dos ediciones y dos acciones previstas."""
        self.ediciones = [edicion(1), edicion(2)]
        self.previstas = [prevista(1), prevista(2)]

    def _respuesta(self, url: str, *_: object) -> Descarga:
        """Responde como la API: las filas de cada conjunto y sus metadatos, con el recuento de esas filas.

        Returns:
            La descarga simulada de esa dirección.
        """
        filas = {
            ACCIONES.identificador: self.ediciones,
            ACCIONES_PREVISTAS.identificador: self.previstas,
        }.get(url.split("/")[-1].split(".json")[0], [])
        if "/api/views/" in url:
            return Descarga(metadatos(filas=len(filas)), url, "application/json")
        return Descarga(json.dumps(filas).encode(), url, "application/json")

    def descargar(self, raiz: Path, hora: str = HORA) -> lectura.Resultado:
        """Descarga la copia del 15/11 en la instalación de `raiz`, con la red simulada y la hora dada.

        Returns:
            Lo que dijo la emisión de sus lecturas.
        """
        carpeta = carpeta_de(raiz)
        with ExitStack() as parches:
            parches.enter_context(mock.patch.object(consorci, "ORIGINAL", carpeta))
            parches.enter_context(mock.patch.object(consorci, "PROCEDENCIA", carpeta / "procedencia.json"))
            parches.enter_context(mock.patch.object(red, "descargar_url", self._respuesta))
            parches.enter_context(mock.patch.object(red, "ahora_utc", return_value=hora))
            parches.enter_context(mock.patch.object(socrata.time, "sleep"))
            parches.enter_context(redirect_stdout(io.StringIO()))
            return consorci.descargar(False, hoy=date(2026, 11, 15))

    def test_la_descarga_emite_las_lecturas_de_la_copia_conservada(self) -> None:
        """La copia conservada deja una lectura de sus dos ediciones y otra de sus dos acciones previstas."""
        raiz = Path(self.enterContext(tempfile.TemporaryDirectory()))
        resultado = self.descargar(raiz)
        self.assertEqual(resultado.problemas, ())
        self.assertEqual(
            {(lec["ambito"], lec["recuento_bruto"]) for lec in listar_lecturas(raiz, "consorci")},
            {("consorci:edicion", 2), ("consorci:prevista", 2)},
        )

    def test_una_emision_que_falla_no_cambia_la_procedencia(self) -> None:
        """Con la emisión rota, la copia y la procedencia quedan byte a byte como sin ella."""
        sana = Path(self.enterContext(tempfile.TemporaryDirectory()))
        rota = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.descargar(sana)
        with mock.patch.object(lectura, "emitir_lectura", side_effect=OSError("disco lleno")):
            resultado = self.descargar(rota)
        self.assertEqual(len(resultado.problemas), 2)
        self.assertTrue(all("disco lleno" in problema for problema in resultado.problemas))
        self.assertFalse(carpeta_de_lecturas(rota, "consorci").exists())
        procedencia = DATOS_RELATIVOS / "originales" / "consorci" / "procedencia.json"
        self.assertEqual((rota / procedencia).read_bytes(), (sana / procedencia).read_bytes())

    def test_dos_descargas_del_mismo_dia_dan_la_misma_lectura(self) -> None:
        """Volver a descargar la misma copia no añade lecturas: la hora y los censos son los mismos."""
        raiz = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.descargar(raiz)
        self.descargar(raiz, hora="2026-11-15T12:00:00+00:00")
        self.assertEqual(len(listar_lecturas(raiz, "consorci")), 2)


if __name__ == "__main__":
    unittest.main()
