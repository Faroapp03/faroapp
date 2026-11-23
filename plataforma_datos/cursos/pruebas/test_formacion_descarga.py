"""Descarga diaria SOC con HTTP doble: integridad, procedencia y catálogos conservados."""

import hashlib
import io
import json
import os
import tempfile
import unittest
from contextlib import ExitStack, redirect_stdout
from pathlib import Path
from unittest import mock
from urllib.request import Request

import plataforma_datos.cursos.fuentes.formacion.lector as formacion
from plataforma_datos.comun import entrada_salida, red
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado, HuellaIncorrecta, OriginalCambiado
from plataforma_datos.cursos.fuentes.formacion import censo_soc, confirmar_censo
from plataforma_datos.cursos.fuentes.formacion.marco_digcomp import digcomp
from plataforma_datos.cursos.pruebas.test_formacion import CURSO_DEL_SOC
from plataforma_datos.cursos.pruebas.test_registro_digcomp import grafo_sintetico

URL_SOC = "https://oficinadetreball.gencat.cat/opendata/recursos/ofertaCursos.json"
INSTANTE = "2026-10-17T08:49:16+00:00"


class Respuesta(io.BytesIO):
    """Respuesta completa en memoria: no abre sockets ni consulta servicios."""

    def __init__(self, contenido: bytes, tipo: str, url: str) -> None:
        super().__init__(contenido)
        self.headers = {"Content-Type": tipo}
        self.url = url


class PruebaDescargaFormacion(unittest.TestCase):
    """La descarga renueva solo oferta; reconstruir no inventa una comprobación remota."""

    def setUp(self) -> None:
        """Prepara copias privadas y reemplaza solo la frontera HTTP."""
        pausa_red = mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _segundos: None))
        pausa_red.start()
        self.addCleanup(pausa_red.stop)
        self.contexto = ExitStack()
        self.addCleanup(self.contexto.close)
        self.raiz = Path(self.contexto.enter_context(tempfile.TemporaryDirectory()))
        self.origen = self.raiz / "formacion"
        self.origen.mkdir()
        self.sepe = self.raiz / "sepe"
        self.sepe.mkdir()
        self.antiguo = "soc-cursos-2026-09-27.json"
        self.contenido = json.dumps([CURSO_DEL_SOC], ensure_ascii=False).encode("latin-1")
        self.tipo = "application/json"
        self.url = URL_SOC
        self.documento = {"cita": "Cita conservada", "archivos": []}
        for nombre, datos in (
            ("eures-esco-cosispe-es.csv", b"catalogo eures"),
            ("soc-especialidades.json", b"[]"),
            ("digcomp-3.0.jsonld", json.dumps(grafo_sintetico()).encode()),
            (self.antiguo, self.contenido),
        ):
            (self.origen / nombre).write_bytes(datos)
            registro = self._registro(nombre, datos)
            if nombre == "digcomp-3.0.jsonld":
                registro["url"] = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/DIGCOMP/DIGCOMP3.0/"
            if nombre == self.antiguo:
                registro["condiciones"] = "Licencia abierta de la oferta SOC"
            self.documento["archivos"].append(registro)
        entrada_salida.guardar_json(self.origen / "procedencia.json", self.documento)
        datos_sepe = b"catalogo sepe"
        (self.sepe / "catalogo.xlsx").write_bytes(datos_sepe)
        entrada_salida.guardar_json(self.sepe / "procedencia.json", self._registro("catalogo.xlsx", datos_sepe))
        self.contexto.enter_context(mock.patch.object(entrada_salida, "ORIGINALES", self.raiz))
        self.contexto.enter_context(mock.patch.object(formacion, "ahora_utc", return_value=INSTANTE))
        self.contexto.enter_context(mock.patch.object(red, "ahora_utc", return_value=INSTANTE))
        self.contexto.enter_context(redirect_stdout(io.StringIO()))
        self.pedir = self.contexto.enter_context(mock.patch.object(red, "abrir_peticion", side_effect=self._respuesta))

    def _respuesta(self, peticion: Request, timeout: float) -> Respuesta:
        """Exige destino y agente oficiales en la propia frontera HTTP.

        Returns:
            Respuesta que consumen los helpers reales de descarga.
        """
        self.assertEqual(peticion.full_url, URL_SOC)
        self.assertEqual(peticion.get_header("User-agent"), red.agente_de_usuario())
        self.assertGreater(timeout, 0)
        return Respuesta(self.contenido, self.tipo, self.url)

    @staticmethod
    def _registro(nombre: str, datos: bytes) -> dict:
        """Compone una entrada mínima admitida por los lectores reales de procedencia.

        Returns:
            Nombre y huella del original del caso.
        """
        return {"archivo": nombre, "sha256": hashlib.sha256(datos).hexdigest()}

    def _archivos(self) -> dict[str, bytes]:
        """Captura todas las entradas operativas del caso, incluidas las procedencias.

        Returns:
            Bytes por ruta relativa para contrastar conservación íntegra.
        """
        return {p.relative_to(self.raiz).as_posix(): p.read_bytes() for p in self.raiz.rglob("*") if p.is_file()}

    def test_descarga_real_fechada_conserva_catalogos_y_copias(self) -> None:
        """La fecha real de consulta prevalece sobre FARO_HOY; los catálogos no se descargan."""
        anteriores = self._archivos()
        with mock.patch.dict(os.environ, {"FARO_HOY": "2000-01-01"}):
            formacion.descargar()
        self.pedir.assert_called_once()
        registrada = entrada_salida.procedencia("formacion")
        self.assertEqual(registrada["cita"], self.documento["cita"])
        self.assertEqual(registrada["archivos"][:-1], self.documento["archivos"])
        nueva = registrada["archivos"][-1]
        self.assertEqual(nueva["archivo"], "soc-cursos-2026-10-17.json")
        self.assertEqual(nueva["comprobado_remoto_utc"], INSTANTE)
        self.assertEqual(nueva["sha256"], hashlib.sha256(self.contenido).hexdigest())
        self.assertEqual(nueva["bytes"], len(self.contenido))
        for nombre, datos in anteriores.items():
            if nombre != "formacion/procedencia.json":
                self.assertEqual((self.raiz / nombre).read_bytes(), datos)
        entrada_salida.comprobar_originales("formacion")
        entrada_salida.comprobar_originales("sepe")

    def test_igual_contenido_renueva_consulta_no_duplica_entrada(self) -> None:
        """Un HTTP idéntico sigue siendo comprobación nueva; no se confunde con fecha del contenido."""
        formacion.descargar()
        posterior = "2026-10-17T20:00:00+00:00"
        with mock.patch.object(formacion, "ahora_utc", return_value=posterior):
            formacion.descargar()
        entradas = entrada_salida.procedencia("formacion")["archivos"]
        self.assertEqual(len(entradas), len(self.documento["archivos"]) + 1)
        self.assertEqual(entradas[-1]["descargado_utc"], INSTANTE)
        self.assertEqual(entradas[-1]["comprobado_remoto_utc"], posterior)
        self.assertEqual(self.pedir.call_count, 2)

    def test_cambio_del_mismo_dia_requiere_aceptacion_solo_soc(self) -> None:
        """Sin permiso conserva bytes; aceptarlo actualiza únicamente la copia SOC del día."""
        formacion.descargar()
        anteriores = self._archivos()
        self.contenido = json.dumps([{**CURSO_DEL_SOC, "nom_centre": "Otro centro"}]).encode("latin-1")
        with self.assertRaises(OriginalCambiado):
            formacion.descargar()
        self.assertEqual(self._archivos(), anteriores)
        self.assertEqual(formacion.main(["descargar", "--aceptar-cambio"]), 0)
        self.assertEqual((self.origen / "soc-cursos-2026-10-17.json").read_bytes(), self.contenido)
        for nombre, datos in anteriores.items():
            if nombre not in ("formacion/procedencia.json", "formacion/soc-cursos-2026-10-17.json"):
                self.assertEqual((self.raiz / nombre).read_bytes(), datos)

    def test_cambio_del_dia_siguiente_no_elude_aceptacion(self) -> None:
        """Un nombre fechado nuevo también debe cotejar el contenido con la última copia admitida."""
        formacion.descargar()
        anteriores = self._archivos()
        self.contenido = json.dumps([{**CURSO_DEL_SOC, "nom_centre": "Otro centro"}]).encode()
        siguiente = "2026-10-18T08:00:00+00:00"
        with mock.patch.object(formacion, "ahora_utc", return_value=siguiente):
            with self.assertRaises(OriginalCambiado):
                formacion.descargar()
            self.assertEqual(self._archivos(), anteriores)
            formacion.descargar(aceptar_cambio=True)
        self.assertEqual((self.origen / "soc-cursos-2026-10-18.json").read_bytes(), self.contenido)
        for nombre, datos in anteriores.items():
            if nombre != "formacion/procedencia.json":
                self.assertEqual((self.raiz / nombre).read_bytes(), datos)

    def test_copia_legada_del_mismo_dia_admite_metadata_nueva(self) -> None:
        """Una procedencia antigua sin hora de descarga mantiene sus catálogos y recibe la hora real de consulta."""
        instante = "2026-09-27T18:00:00+00:00"
        with (
            mock.patch.object(formacion, "ahora_utc", return_value=instante),
            mock.patch.object(red, "ahora_utc", return_value=instante),
        ):
            formacion.descargar()
        entradas = entrada_salida.procedencia("formacion")["archivos"]
        self.assertEqual(entradas[:-1], self.documento["archivos"][:-1])
        self.assertEqual(entradas[-1]["archivo"], self.antiguo)
        self.assertEqual(entradas[-1]["comprobado_remoto_utc"], instante)

    def test_entrada_defectuosa_no_admite_archivo_ni_procedencia(self) -> None:
        """Truncado, HTML, tipos, fechas y enlaces inválidos fallan antes de conservar una copia."""
        originales = self._archivos()
        for valor in (
            b"[",
            b"[]",
            b'[{"curs":"incompleto"}]',
            b'[{"curs":"a","curs":"b"}]',
            b'[{"curs":NaN}]',
            json.dumps([{**CURSO_DEL_SOC, "data_fi": "09/29/2026"}]).encode(),
            json.dumps([{**CURSO_DEL_SOC, "nom_centre": None}]).encode(),
            json.dumps([{**CURSO_DEL_SOC, "identificador_curs": "id?fuera"}]).encode(),
        ):
            with self.subTest(valor=valor):
                self.contenido = valor
                with self.assertRaises(FormatoInesperado):
                    formacion.descargar(aceptar_cambio=True)
                self.assertEqual(self._archivos(), originales)

    def test_una_fecha_invertida_conserva_la_ficha_y_su_correccion_restablece_las_fechas(self) -> None:
        """El mismo censo retiene las dos identidades en cada lectura y conserva los bytes publicados."""
        otra = {**CURSO_DEL_SOC, "curs": "2", "identificador_curs": "otro", "data_fi": "09/29/2026"}
        self.contenido = json.dumps([CURSO_DEL_SOC, otra]).encode()
        formacion.descargar(aceptar_cambio=True)
        recibida = self.origen / "soc-cursos-2026-10-17.json"
        self.assertEqual(recibida.read_bytes(), self.contenido)
        cursos = formacion._soc_cursos({})
        self.assertEqual(cursos[CURSO_DEL_SOC["curs"]], formacion._curso(CURSO_DEL_SOC, {}))
        self.assertEqual((cursos["2"]["inicio"], cursos["2"]["fin"]), (None, None))
        self.assertEqual(cursos["2"]["incidencia_calendario"], "fin-anterior-al-inicio")
        self.assertEqual(cursos, formacion._soc_cursos({}))
        otra["data_fi"] = "10/04/2026"
        self.contenido = json.dumps([CURSO_DEL_SOC, otra]).encode()
        formacion.descargar(aceptar_cambio=True)
        actual = formacion._soc_cursos({})
        self.assertEqual(set(actual), set(cursos))
        self.assertEqual((actual["2"]["inicio"], actual["2"]["fin"]), ("2026-09-30", "2026-10-04"))
        self.assertNotIn("incidencia_calendario", actual["2"])

    def test_tipo_destino_y_limite_se_comprueban_antes_de_conservar(self) -> None:
        """Una respuesta ajena al JSON oficial o desmedida no renueva la procedencia."""
        originales = self._archivos()
        for atributo, valor in (("tipo", "text/html"), ("url", "https://otro.example/oferta.json")):
            with self.subTest(atributo=atributo):
                previo = getattr(self, atributo)
                setattr(self, atributo, valor)
                with self.assertRaises(FormatoInesperado):
                    formacion.descargar()
                setattr(self, atributo, previo)
        with (
            mock.patch.object(formacion, "MAX_OFERTA_SOC_BYTES", len(self.contenido) - 1),
            self.assertRaises(FormatoInesperado),
        ):
            formacion.descargar()
        self.assertEqual(self._archivos(), originales)

    def test_catalogo_alterado_no_se_acepta_ni_consulta_red(self) -> None:
        """Aceptar oferta nueva no autoriza sustituir los catálogos ni ignorar sus huellas."""
        (self.sepe / "catalogo.xlsx").write_bytes(b"distinto")
        anteriores = self._archivos()
        with self.assertRaises(HuellaIncorrecta):
            formacion.descargar(aceptar_cambio=True)
        self.pedir.assert_not_called()
        self.assertEqual(self._archivos(), anteriores)

    def test_fallo_red_no_cambia_originales(self) -> None:
        """Una respuesta no obtenida deja el estado anterior exacto."""
        anteriores = self._archivos()
        self.pedir.side_effect = OSError("interrumpida")
        with self.assertRaises(OSError):
            formacion.descargar()
        self.assertEqual(self._archivos(), anteriores)

    def test_fallo_guardando_procedencia_conserva_copia_previa(self) -> None:
        """Sin procedencia confirmada no queda una copia nueva aceptada ni se pierde la del mismo día."""
        for previa in (False, True):
            with self.subTest(previa=previa):
                if previa:
                    formacion.descargar()
                    cambio = {**CURSO_DEL_SOC, "nom_centre": "Otro centro"}
                    self.contenido = json.dumps([cambio]).encode()
                anteriores = self._archivos()
                with (
                    mock.patch.object(formacion, "guardar_json", side_effect=OSError("sin espacio")),
                    self.assertRaises(OSError),
                ):
                    formacion.descargar(aceptar_cambio=True)
                self.assertEqual(self._archivos(), anteriores)

    def test_fallo_promoviendo_procedencia_restaura_la_copia(self) -> None:
        """El fallo posterior a conservar SOC retira la copia nueva o restaura la anterior del día."""
        reemplazar = Path.replace

        def fallo_procedencia(origen: Path, destino: Path) -> Path:
            if origen.name == "procedencia.json" and destino == self.origen / "procedencia.json":
                raise OSError("promoción no disponible")
            return reemplazar(origen, destino)

        for previa in (False, True):
            with self.subTest(previa=previa):
                if previa:
                    formacion.descargar()
                    self.contenido = json.dumps([{**CURSO_DEL_SOC, "nom_centre": "Otro centro"}]).encode()
                anteriores = self._archivos()
                with (
                    mock.patch.object(Path, "replace", autospec=True, side_effect=fallo_procedencia),
                    self.assertRaises(OSError),
                ):
                    formacion.descargar(aceptar_cambio=True)
                self.assertEqual(self._archivos(), anteriores)

    def test_reconstruccion_local_no_renueva_comprobacion_remota(self) -> None:
        """Preparar y validar una copia no consultan HTTP ni actualizan su fecha de comprobación externa."""
        formacion.descargar()
        originales = self._archivos()
        self.pedir.reset_mock()
        rutas = {k: self.raiz / "preparados" / p.name for k, p in formacion.PREPARADOS.items()}
        controles = Controles()
        referencia = next(e for e in self.documento["archivos"] if e["archivo"] == "digcomp-3.0.jsonld")
        registro = formacion.registro_desde_marco(digcomp(grafo_sintetico()), referencia)

        def comprobar_curso_local(_esco: dict[str, str], preparados: formacion.Preparados) -> Controles:
            """Ejecuta las guardas reales sobre el curso del caso; los catálogos ajenos siguen siendo dobles.

            Returns:
                Controles efectivamente ejecutados, sin acreditar una consulta remota.
            """
            self.assertEqual(len(preparados.cursos), 1)
            formacion._controles_cursos(controles, preparados.cursos)
            return controles

        with (
            mock.patch.object(formacion, "cargar_registro", return_value=(registro, "a" * 64)),
            mock.patch.object(formacion, "PREPARADOS", rutas),
            mock.patch.object(formacion, "VALIDADO", self.raiz / "validados"),
            mock.patch.object(formacion, "ocupaciones_esco", return_value={}),
            mock.patch.object(formacion, "_eures", return_value=[]),
            mock.patch.object(formacion, "_sepe", return_value=[]),
            mock.patch.object(formacion, "_soc_especialidades", return_value={}),
            mock.patch.object(formacion, "controles_de_la_cadena", side_effect=comprobar_curso_local),
            mock.patch.object(formacion, "cobertura_de_la_cadena", return_value={}),
        ):
            formacion.preparar()
            formacion.validar()
        informe = entrada_salida.leer_json(self.raiz / "validados" / "validacion.json")
        self.assertTrue(controles.admitido, controles.fallidos)
        self.assertEqual(informe["estado"], controles.estado)
        self.assertEqual(informe["controles"], controles.lista)
        self.pedir.assert_not_called()
        for nombre, datos in originales.items():
            self.assertEqual((self.raiz / nombre).read_bytes(), datos)

    @staticmethod
    def _oferta(cursos: int) -> bytes:
        """Una oferta sintética con tantos cursos distintos como se pide.

        Returns:
            El JSON en latin-1, como lo publica el SOC.
        """
        filas = [
            {**CURSO_DEL_SOC, "curs": str(467957 + numero), "identificador_curs": f"25/FOAP/781/0195455/{numero:03d}"}
            for numero in range(cursos)
        ]
        return json.dumps(filas, ensure_ascii=False).encode("latin-1")

    def _copia_de_cinco_cursos(self) -> None:
        """Admite antes una copia de cinco cursos, la que la caída siguiente compara."""
        self.contenido = self._oferta(5)
        formacion.descargar(aceptar_cambio=True)

    def test_caida_grande_queda_pendiente_y_conserva_la_copia_anterior(self) -> None:
        """Una lista válida pero truncada no sustituye la copia, ni siquiera con la aceptación automática."""
        self._copia_de_cinco_cursos()
        anteriores = self._archivos()
        self.contenido = self._oferta(1)
        siguiente = "2026-10-18T08:00:00+00:00"
        with (
            mock.patch.object(formacion, "ahora_utc", return_value=siguiente),
            self.assertRaises(censo_soc.CensoPendienteDeConfirmacion) as error,
        ):
            formacion.descargar(aceptar_cambio=True)
        self.assertIn("1 cursos", str(error.exception))
        self.assertIn("tenía 5", str(error.exception))
        pendientes = {censo_soc.OFERTA_PENDIENTE, censo_soc.CIFRAS_PENDIENTE}
        for nombre, datos in anteriores.items():
            self.assertEqual((self.raiz / nombre).read_bytes(), datos)
        self.assertEqual(set(self._archivos()) - set(anteriores), {"formacion/" + n for n in pendientes})
        cifras = entrada_salida.leer_json(self.origen / censo_soc.CIFRAS_PENDIENTE)
        self.assertEqual(cifras["cursos"], 1)
        self.assertEqual(cifras["cursos_copia_anterior"], 5)
        self.assertEqual(cifras["copia_anterior"], "soc-cursos-2026-10-17.json")
        self.assertEqual(cifras["comprobado_remoto_utc"], siguiente)
        self.assertEqual(cifras["sha256"], hashlib.sha256(self.contenido).hexdigest())
        self.assertFalse((self.origen / "soc-cursos-2026-10-18.json").exists())

    def test_caida_dentro_del_criterio_se_admite(self) -> None:
        """Perder hasta PERDIDA_MAXIMA de los cursos es una oferta normal: se admite como copia."""
        self._copia_de_cinco_cursos()
        self.contenido = self._oferta(4)
        with mock.patch.object(formacion, "ahora_utc", return_value="2026-10-18T08:00:00+00:00"):
            formacion.descargar(aceptar_cambio=True)
        self.assertEqual((self.origen / "soc-cursos-2026-10-18.json").read_bytes(), self.contenido)
        self.assertFalse((self.origen / censo_soc.CIFRAS_PENDIENTE).exists())

    def test_confirmar_admite_la_pendiente_con_la_fecha_de_su_consulta(self) -> None:
        """La confirmación de una persona admite los mismos bytes y no rejuvenece la comprobación remota."""
        self._copia_de_cinco_cursos()
        self.contenido = self._oferta(1)
        siguiente = "2026-10-18T08:00:00+00:00"
        with (
            mock.patch.object(formacion, "ahora_utc", return_value=siguiente),
            self.assertRaises(censo_soc.CensoPendienteDeConfirmacion),
        ):
            formacion.descargar(aceptar_cambio=True)
        self.pedir.reset_mock()
        with mock.patch.object(formacion, "ahora_utc", return_value="2026-10-19T09:00:00+00:00"):
            confirmar_censo.confirmar_censo_pendiente(hashlib.sha256(self.contenido).hexdigest())
        self.pedir.assert_not_called()
        self.assertEqual((self.origen / "soc-cursos-2026-10-18.json").read_bytes(), self.contenido)
        nueva = entrada_salida.procedencia("formacion")["archivos"][-1]
        self.assertEqual(nueva["archivo"], "soc-cursos-2026-10-18.json")
        self.assertEqual(nueva["comprobado_remoto_utc"], siguiente)
        self.assertFalse((self.origen / censo_soc.OFERTA_PENDIENTE).exists())
        self.assertFalse((self.origen / censo_soc.CIFRAS_PENDIENTE).exists())
        entrada_salida.comprobar_originales("formacion")

    def test_confirmar_sin_pendiente_o_con_bytes_cambiados_no_admite(self) -> None:
        """Sin oferta pendiente, o con otros bytes que los registrados, no se admite nada."""
        anteriores = self._archivos()
        with self.assertRaises(FormatoInesperado):
            confirmar_censo.confirmar_censo_pendiente("0" * 64)
        self.assertEqual(self._archivos(), anteriores)
        self._copia_de_cinco_cursos()
        self.contenido = self._oferta(1)
        with (
            mock.patch.object(formacion, "ahora_utc", return_value="2026-10-18T08:00:00+00:00"),
            self.assertRaises(censo_soc.CensoPendienteDeConfirmacion),
        ):
            formacion.descargar(aceptar_cambio=True)
        revisada = hashlib.sha256(self.contenido).hexdigest()
        (self.origen / censo_soc.OFERTA_PENDIENTE).write_bytes(self._oferta(2))
        procedencia = (self.origen / "procedencia.json").read_bytes()
        with self.assertRaises(FormatoInesperado):
            confirmar_censo.confirmar_censo_pendiente(revisada)
        self.assertEqual((self.origen / "procedencia.json").read_bytes(), procedencia)

    def test_confirmar_no_admite_una_pendiente_distinta_de_la_revisada(self) -> None:
        """Si la actualización sustituye la pendiente mientras se revisa, la huella revisada ya no la confirma."""
        self._copia_de_cinco_cursos()
        self.contenido = self._oferta(1)
        with (
            mock.patch.object(formacion, "ahora_utc", return_value="2026-10-18T08:00:00+00:00"),
            self.assertRaises(censo_soc.CensoPendienteDeConfirmacion),
        ):
            formacion.descargar(aceptar_cambio=True)
        revisada = hashlib.sha256(self.contenido).hexdigest()
        self.contenido = self._oferta(2)
        with (
            mock.patch.object(formacion, "ahora_utc", return_value="2026-10-18T09:00:00+00:00"),
            self.assertRaises(censo_soc.CensoPendienteDeConfirmacion),
        ):
            formacion.descargar(aceptar_cambio=True)
        anteriores = self._archivos()
        with self.assertRaisesRegex(FormatoInesperado, "no es la revisada"):
            confirmar_censo.confirmar_censo_pendiente(revisada)
        self.assertEqual(self._archivos(), anteriores)
        self.assertEqual(confirmar_censo.main([revisada]), 1)
        self.assertEqual(self._archivos(), anteriores)

    def test_descarga_completa_posterior_retira_la_pendiente(self) -> None:
        """Una oferta admitida después sustituye a la pendiente, que ya no describe la fuente."""
        self._copia_de_cinco_cursos()
        self.contenido = self._oferta(1)
        with (
            mock.patch.object(formacion, "ahora_utc", return_value="2026-10-18T08:00:00+00:00"),
            self.assertRaises(censo_soc.CensoPendienteDeConfirmacion),
        ):
            formacion.descargar(aceptar_cambio=True)
        self.contenido = self._oferta(5)
        with mock.patch.object(formacion, "ahora_utc", return_value="2026-10-18T09:00:00+00:00"):
            formacion.descargar(aceptar_cambio=True)
        self.assertFalse((self.origen / censo_soc.OFERTA_PENDIENTE).exists())
        self.assertFalse((self.origen / censo_soc.CIFRAS_PENDIENTE).exists())


if __name__ == "__main__":
    unittest.main()
