"""La descarga de la oferta del SOC emite en cada ciclo una lectura de sus cursos, sin red ni reloj."""

import hashlib
import io
import json
import tempfile
import unittest
from contextlib import ExitStack, redirect_stdout
from pathlib import Path
from unittest import mock
from urllib.request import Request

import plataforma_datos.cursos.fuentes.formacion.lector as formacion
from plataforma_datos.comun import entrada_salida, red
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, FormatoInesperado
from plataforma_datos.cursos.fuentes.formacion import censo_soc, lectura
from plataforma_datos.cursos.lecturas.almacen_lecturas import carpeta_de_lecturas, listar_lecturas
from plataforma_datos.cursos.pruebas.test_formacion import CURSO_DEL_SOC
from plataforma_datos.cursos.pruebas.test_registro_digcomp import grafo_sintetico

URL_SOC = "https://oficinadetreball.gencat.cat/opendata/recursos/ofertaCursos.json"
MUESTRA = Path(__file__).parent / "preparados_formacion" / "soc-cursos.jsonl"


def fila(numero: int, *, inicio: str = "09/30/2026", fin: str = "12/02/2026", **campos: str) -> dict[str, str]:
    """Una fila de la oferta, la del curso real de la muestra con otro número de curso y otras fechas.

    Returns:
        La fila tal como la publica el SOC.
    """
    return {
        **CURSO_DEL_SOC,
        "curs": str(467900 + numero),
        "identificador_curs": f"25/FOAP/781/0195455/{numero:03d}",
        "data_inici": inicio,
        "data_fi": fin,
        **campos,
    }


def ident(numero: int) -> str:
    """El identificador publicado del curso de ese número en `fila`.

    Returns:
        El `identificador_curs`.
    """
    return f"25/FOAP/781/0195455/{numero:03d}"


def oferta(*filas: dict[str, str]) -> bytes:
    """Una oferta con esas filas.

    Returns:
        El JSON en latin-1, como lo publica el SOC.
    """
    return json.dumps(list(filas), ensure_ascii=False).encode("latin-1")


def instalacion(raiz: Path) -> Path:
    """Una instalación vacía bajo `raiz`.

    Returns:
        Su carpeta de originales de la formación.
    """
    original = raiz / DATOS_RELATIVOS / "originales" / "formacion"
    original.mkdir(parents=True)
    return original


def preparar_cursos(raiz: Path, cursos: list[dict]) -> None:
    """Deja los cursos que se ven hoy, como los deja la preparación."""
    ruta = raiz / DATOS_RELATIVOS / "preparados" / "formacion" / "soc-cursos.jsonl"
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text("".join(json.dumps(c, ensure_ascii=False) + "\n" for c in cursos), encoding="utf-8")


class PruebaLecturaSoc(unittest.TestCase):
    """La lectura de una oferta recibida: censo, salidas explicadas y declaraciones."""

    def setUp(self) -> None:
        """Una instalación temporal donde emitir."""
        self.raiz = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.original = instalacion(self.raiz)

    def emitir(self, datos: bytes, observado: str) -> dict:
        """Emite la lectura de una oferta y exige que no haya problemas.

        Returns:
            La lectura emitida.
        """
        resultado = lectura.emitir(self.original, datos, observado)
        self.assertEqual(resultado.problemas, ())
        return resultado.emisiones[0].lectura

    def test_dos_ciclos_dan_dos_lecturas_encadenadas(self) -> None:
        """Cada oferta deja una lectura de sus cursos distintos, a la hora de su consulta y sin total declarado."""
        primera = self.emitir(
            oferta(fila(1), fila(1, especialitat_formativa="OTRA"), fila(2)), "2026-11-15T12:46:01.5+00:00"
        )
        segunda = self.emitir(oferta(fila(1), fila(2), fila(3)), "2026-11-16T09:00:00+00:00")
        self.assertEqual(
            [lec["lectura_id"] for lec in listar_lecturas(self.raiz, "formacion")],
            [primera["lectura_id"], segunda["lectura_id"]],
        )
        self.assertEqual(primera["ambito"], "soc:curso")
        self.assertEqual(primera["observado_utc"], "2026-11-15T12:46:01Z")
        self.assertEqual((primera["recuento_bruto"], primera["total_declarado"], primera["completa"]), (2, None, True))
        self.assertEqual(segunda["anterior"], primera["lectura_id"])
        self.assertEqual(segunda["entradas"], [ident(3)])
        self.assertEqual(primera["huella_forma"]["niveles"], ["edicion"])

    def test_vigente_es_lo_que_no_ha_terminado_el_dia_de_la_lectura(self) -> None:
        """El día de fin aún cuenta; un fin pasado no; unas fechas que se contradicen no dicen que haya terminado."""
        datos = oferta(
            fila(1, fin="11/15/2026"), fila(2, fin="11/14/2026"), fila(3, inicio="12/01/2026", fin="01/02/2026")
        )
        # 23:30 UTC del 14/11 ya es el 15/11 en Cataluña.
        self.assertEqual(self.emitir(datos, "2026-11-14T23:30:00+00:00")["recuento_vigente"], 2)

    def test_una_salida_con_su_fin_pasado_queda_explicada_y_otra_sin_nada_no(self) -> None:
        """Lo último que se supo de un curso que sale está en los cursos preparados, los que se ven."""
        preparar_cursos(self.raiz, [{"id": ident(1), "fin": "2026-11-15"}, {"id": ident(2), "fin": "2026-12-31"}])
        self.emitir(oferta(fila(1), fila(2), fila(3)), "2026-11-15T08:00:00+00:00")
        segunda = self.emitir(oferta(fila(3)), "2026-11-17T08:00:00+00:00")
        self.assertEqual(
            segunda["salidas"],
            [{"id": ident(1), "explicada_por": "fin_publicado"}, {"id": ident(2), "explicada_por": None}],
        )

    def test_un_estado_que_la_fuente_no_valida_no_es_un_valor_nuevo(self) -> None:
        """El SOC no cierra el vocabulario de `estat_curs`: un estado nunca visto se registra en la forma, no aparte."""
        leida = self.emitir(oferta(fila(1, estat_curs="Curs anul·lat")), "2026-11-15T08:00:00+00:00")
        self.assertEqual(leida["huella_forma"]["valores_nuevos"], [])

    def test_las_declaraciones_citan_su_lectura(self) -> None:
        """Cada curso declara su fin, que termina al acabar su día en Cataluña; sin fecha cierta no declara nada."""
        datos = oferta(
            fila(1), fila(2, inicio="06/01/2026", fin="07/15/2026"), fila(3, inicio="12/01/2026", fin="01/02/2026")
        )
        leida = self.emitir(datos, "2026-05-01T08:00:00+00:00")
        declaradas = lectura.declaraciones(leida, datos)
        self.assertEqual(set(declaradas), {ident(1), ident(2)})
        (invierno,), (verano,) = declaradas[ident(1)], declaradas[ident(2)]
        self.assertEqual((invierno.lectura_id, invierno.canal), (leida["lectura_id"], "fin_publicado"))
        self.assertEqual((invierno.cierra_el, verano.cierra_el), ("2026-12-02T23:00:00Z", "2026-07-15T22:00:00Z"))
        with self.assertRaises(lectura.ErrorLecturaSoc):
            lectura.declaraciones(leida, oferta(fila(1)))

    def test_caso_real_el_curso_de_la_muestra_sale_al_terminar(self) -> None:
        """El curso real de la muestra (fin el 02/12/2026) que ya no está el 05/12 sale explicado por su fin."""
        preparar_cursos(self.raiz, [json.loads(linea) for linea in MUESTRA.read_text(encoding="utf-8").splitlines()])
        self.emitir(oferta(CURSO_DEL_SOC, fila(2, fin="12/31/2026")), "2026-11-15T08:00:00+00:00")
        segunda = self.emitir(oferta(fila(2, fin="12/31/2026")), "2026-12-05T08:00:00+00:00")
        self.assertEqual(
            segunda["salidas"], [{"id": CURSO_DEL_SOC["identificador_curs"], "explicada_por": "fin_publicado"}]
        )

    def test_una_carpeta_ajena_no_emite_y_lo_dice(self) -> None:
        """Fuera de una instalación no se escribe nada: el resultado dice por qué."""
        resultado = lectura.emitir(self.raiz / "formacion", oferta(fila(1)), "2026-11-15T08:00:00+00:00")
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("no es la carpeta de originales", resultado.problemas[0])


class Respuesta(io.BytesIO):
    """Respuesta completa en memoria: no abre sockets."""

    def __init__(self, contenido: bytes) -> None:
        super().__init__(contenido)
        self.headers = {"Content-Type": "application/json"}
        self.url = URL_SOC


class PruebaDescargaEmiteSuLectura(unittest.TestCase):
    """El enganche en la descarga: emite siempre que la oferta sea válida y nunca cambia lo que se conserva."""

    def setUp(self) -> None:
        """Una instalación con sus catálogos conservados y una copia anterior de cinco cursos; la red es simulada."""
        self.contexto = ExitStack()
        self.addCleanup(self.contexto.close)
        self.contexto.enter_context(
            mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _s: None))
        )
        self.contexto.enter_context(redirect_stdout(io.StringIO()))
        self.pedir = self.contexto.enter_context(mock.patch.object(red, "abrir_peticion", side_effect=self._respuesta))
        self.contenido = oferta(*(fila(n) for n in range(1, 6)))

    def _respuesta(self, peticion: Request, timeout: float) -> Respuesta:
        self.assertEqual(peticion.full_url, URL_SOC)
        return Respuesta(self.contenido)

    def montar(self) -> Path:
        """Una instalación nueva, con las rutas de la descarga apuntando a ella.

        Returns:
            Su raíz.
        """
        raiz = Path(self.contexto.enter_context(tempfile.TemporaryDirectory()))
        origen = instalacion(raiz)
        sepe = origen.parent / "sepe"
        sepe.mkdir()
        archivos = []
        for nombre, datos in (
            ("eures-esco-cosispe-es.csv", b"catalogo eures"),
            ("soc-especialidades.json", b"[]"),
            ("digcomp-3.0.jsonld", json.dumps(grafo_sintetico()).encode()),
            ("soc-cursos-2026-11-14.json", self.contenido),
        ):
            (origen / nombre).write_bytes(datos)
            archivos.append({"archivo": nombre, "sha256": hashlib.sha256(datos).hexdigest(), "condiciones": "Abierta"})
        entrada_salida.guardar_json(origen / "procedencia.json", {"archivos": archivos})
        (sepe / "catalogo.xlsx").write_bytes(b"catalogo sepe")
        huella = hashlib.sha256(b"catalogo sepe").hexdigest()
        entrada_salida.guardar_json(sepe / "procedencia.json", {"archivo": "catalogo.xlsx", "sha256": huella})
        self.contexto.enter_context(mock.patch.object(entrada_salida, "ORIGINALES", origen.parent))
        return raiz

    def descargar(self, instante: str = "2026-11-15T08:00:00+00:00") -> lectura.Resultado:
        """Descarga la oferta con la hora de consulta dada.

        Returns:
            Lo que dijo la emisión de su lectura.
        """
        with (
            mock.patch.object(formacion, "ahora_utc", return_value=instante),
            mock.patch.object(red, "ahora_utc", return_value=instante),
        ):
            return formacion.descargar(aceptar_cambio=True)

    def test_la_descarga_emite_la_lectura_de_la_oferta_admitida(self) -> None:
        """La oferta admitida deja una lectura de sus cinco cursos."""
        raiz = self.montar()
        resultado = self.descargar()
        self.assertEqual(resultado.problemas, ())
        self.assertEqual([lec["recuento_bruto"] for lec in listar_lecturas(raiz, "formacion")], [5])

    def test_una_emision_que_falla_no_cambia_la_procedencia(self) -> None:
        """Con la emisión rota, la copia y la procedencia quedan byte a byte como sin ella."""
        sana = self.montar()
        self.descargar()
        with mock.patch.object(lectura, "emitir_lectura", side_effect=OSError("disco lleno")):
            rota = self.montar()
            resultado = self.descargar()
        self.assertIn("disco lleno", resultado.problemas[0])
        self.assertFalse(carpeta_de_lecturas(rota, "formacion").exists())
        procedencia = DATOS_RELATIVOS / "originales" / "formacion" / "procedencia.json"
        self.assertEqual((rota / procedencia).read_bytes(), (sana / procedencia).read_bytes())

    def test_una_oferta_rechazada_no_deja_lectura(self) -> None:
        """El SOC no da un censo parcial: una oferta que no se puede leer entera no deja censo ni lectura."""
        raiz = self.montar()
        self.contenido = b"[]"
        with self.assertRaises(FormatoInesperado):
            self.descargar()
        self.assertFalse(carpeta_de_lecturas(raiz, "formacion").exists())

    def test_la_oferta_que_queda_pendiente_tambien_deja_su_lectura(self) -> None:
        """La caída grande se registra: sus salidas sin explicar en bloque la dejan anómala, y la copia no cambia."""
        raiz = self.montar()
        self.descargar("2026-11-14T08:00:00+00:00")
        self.contenido = oferta(fila(1))
        with self.assertRaises(censo_soc.CensoPendienteDeConfirmacion):
            self.descargar()
        ultima = listar_lecturas(raiz, "formacion")[-1]
        self.assertEqual(len(ultima["salidas"]), 4)
        self.assertEqual((ultima["estado"], ultima["motivos"]), ("anomala", ["salidas_no_explicadas_en_bloque"]))
        self.assertFalse((raiz / DATOS_RELATIVOS / "originales" / "formacion" / "soc-cursos-2026-11-15.json").exists())


if __name__ == "__main__":
    unittest.main()
