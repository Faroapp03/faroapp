"""Pruebas de las piezas comunes: texto, archivos, procedencia, validación e interfaz."""

import io
import json
import os
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import entrada_salida, nucleo, red, textos_y_cifras
from plataforma_datos.orquestacion import admision, ordenes


class PruebaTexto(unittest.TestCase):
    """Normalización de textos, códigos y números."""

    def test_texto_agrupa_espacios_y_trata_none_como_vacio(self) -> None:
        """Agrupa espacios (también los no separables) y trata `None` como vacío."""
        self.assertEqual(textos_y_cifras.texto("  a\n\tb\xa0 c "), "a b c")
        self.assertEqual(textos_y_cifras.texto(None), "")
        self.assertEqual(textos_y_cifras.texto(12), "12")

    def test_texto_sin_controles_de_windows(self) -> None:
        """Un control C1 vuelve a ser la puntuación de Windows-1252; los bytes que no define se quitan."""
        reparar = textos_y_cifras.texto_sin_controles_de_windows
        self.assertEqual(reparar("Direcci\u00f3 d\x92activitats"), "Direcci\u00f3 d\u2019activitats")
        self.assertEqual(reparar("\x93cita\x94 \x96 fin\x81"), "\u201ccita\u201d \u2013 fin")
        self.assertEqual(reparar("d\u2019instal\u00b7lacions"), "d\u2019instal\u00b7lacions")
        self.assertEqual(reparar(None), "")

    def test_clave_de_comparacion(self) -> None:
        """Minúsculas del castellano y cifras; signos, apóstrofos y otras letras separan como un espacio."""
        clave = textos_y_cifras.clave_de_comparacion
        self.assertEqual(clave("Prepare  the client’s (tax) return;"), "prepare the client s tax return")
        self.assertEqual(clave("client‚Äôs client's"), "client s client s")
        self.assertEqual(clave("Café, AÑO"), "café año")
        self.assertEqual(clave("tècnic Çaba"), "t cnic aba")

    def test_texto_plano(self) -> None:
        """Cada etiqueta deja un espacio; las entidades se resuelven después y no vuelven a ser etiquetas."""
        plano = textos_y_cifras.texto_plano
        self.assertEqual(plano("a<b>c</b>"), "a c")
        self.assertEqual(plano("<p>Uno&nbsp;y&amp;dos</p>\n<br/>tres"), "Uno y&dos tres")
        self.assertEqual(plano("&lt;b&gt;texto&lt;/b&gt;"), "<b>texto</b>")

    def test_codigo_pierde_el_decimal_y_conserva_los_ceros(self) -> None:
        """Los códigos guardados como número pierden el decimal; los de texto conservan sus ceros."""
        self.assertEqual(textos_y_cifras.codigo(1113.0), "1113")
        for no_entero in (1113.5, float("nan"), float("inf")):
            with self.subTest(valor=no_entero), self.assertRaises(nucleo.FormatoInesperado):
                textos_y_cifras.codigo(no_entero)
        self.assertEqual(textos_y_cifras.codigo("0110"), "0110")
        self.assertEqual(textos_y_cifras.codigo(""), "")

    def test_numero_es_usa_punto_de_miles_y_coma_decimal(self) -> None:
        """Punto de miles, coma decimal y signo menos tipográfico."""
        self.assertEqual(textos_y_cifras.numero_es(697526), "697.526")
        self.assertEqual(textos_y_cifras.numero_es(22.5, 1), "22,5")
        self.assertEqual(textos_y_cifras.numero_es(-2.4, 1), "−2,4")
        self.assertEqual(textos_y_cifras.numero_es(1580944), "1.580.944")


class PruebaArchivos(unittest.TestCase):
    """Escritura estable de JSON."""

    def setUp(self) -> None:
        """Carpeta temporal propia de cada prueba, que se borra al terminar aunque la prueba falle."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.carpeta = Path(temporal.name)

    def test_jsonl_ida_y_vuelta(self) -> None:
        """JSON Lines compacto, con caracteres no ASCII legibles."""
        ruta = self.carpeta / "a" / "f.jsonl"
        entrada_salida.guardar_jsonl(ruta, [{"a": "ñ"}, {"b": [1, 2]}])
        self.assertEqual(ruta.read_text(encoding="utf-8"), '{"a":"ñ"}\n{"b":[1,2]}\n')
        self.assertEqual(entrada_salida.leer_jsonl(ruta), [{"a": "ñ"}, {"b": [1, 2]}])

    def test_fecha_estable_si_no_cambia_el_contenido(self) -> None:
        """Repetir una validación con el mismo resultado deja el archivo idéntico byte a byte."""
        ruta = self.carpeta / "validacion.json"
        entrada_salida.guardar_validacion(ruta, {"estado": "Admitido", "comprobado_utc": "2026-01-01T00:00:00+00:00"})
        antes = ruta.read_bytes()
        entrada_salida.guardar_validacion(ruta, {"estado": "Admitido", "comprobado_utc": "2030-01-01T00:00:00+00:00"})
        self.assertEqual(ruta.read_bytes(), antes)

    def test_fecha_nueva_si_cambia_el_contenido(self) -> None:
        """Si el resultado cambia, la fecha se actualiza."""
        ruta = self.carpeta / "validacion.json"
        entrada_salida.guardar_validacion(ruta, {"estado": "Admitido", "comprobado_utc": "2026-01-01T00:00:00+00:00"})
        entrada_salida.guardar_validacion(
            ruta, {"estado": "Con errores", "comprobado_utc": "2030-01-01T00:00:00+00:00"}
        )
        self.assertEqual(entrada_salida.leer_json(ruta)["comprobado_utc"], "2030-01-01T00:00:00+00:00")

    def test_falta_un_archivo(self) -> None:
        """Leer un archivo que no existe lanza `ArchivoFaltante` con su ruta relativa."""
        with self.assertRaisesRegex(nucleo.ArchivoFaltante, "no-existe.json"):
            entrada_salida.leer_json(nucleo.RAIZ / "no-existe.json")


class PruebaProcedencia(unittest.TestCase):
    """Huellas de los originales y admisión de las fuentes validadas."""

    def setUp(self) -> None:
        """Carpeta temporal propia de cada prueba, con una procedencia y las carpetas de la fuente parcheadas.

        Cada recurso se libera con addCleanup en cuanto se toma: si setUp falla a medias, tearDown no se ejecutaría y
        un parche ya arrancado seguiría puesto para las demás pruebas del proceso.
        """
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        base = Path(temporal.name)
        self.originales, self.validados = base / "originales", base / "validados"
        (self.originales / "prueba").mkdir(parents=True)
        (self.validados / "prueba").mkdir(parents=True)
        self.dato = self.originales / "prueba" / "dato.csv"
        entradas = []
        for nombre, contenido in (("dato.csv", b"a,b\n"), ("c-2026-01-02.json", b"[2]"), ("c-2026-01-01.json", b"[1]")):
            (self.originales / "prueba" / nombre).write_bytes(contenido)
            entradas.append({"archivo": nombre, "sha256": entrada_salida.sha256_bytes(contenido)})
        procedencia = {"archivos": entradas}
        (self.originales / "prueba" / "procedencia.json").write_text(json.dumps(procedencia), encoding="utf-8")
        for constante, carpeta in (("ORIGINALES", self.originales), ("VALIDADOS", self.validados)):
            parche = mock.patch.object(entrada_salida, constante, carpeta)
            parche.start()
            self.addCleanup(parche.stop)

    def validacion(self, contenido: dict[str, object]) -> None:
        """Escribe la validación de la fuente de prueba."""
        (self.validados / "prueba" / "validacion.json").write_text(json.dumps(contenido), encoding="utf-8")

    def test_original_con_huella_correcta(self) -> None:
        """Un original registrado y sin cambios se devuelve."""
        self.assertEqual(entrada_salida.original("prueba", "dato.csv"), self.dato)

    def test_original_alterado(self) -> None:
        """Un original que ya no coincide con su huella se rechaza."""
        self.dato.write_bytes(b"a,b,c\n")
        with self.assertRaises(nucleo.HuellaIncorrecta):
            entrada_salida.original("prueba", "dato.csv")

    def test_original_no_registrado(self) -> None:
        """Un archivo que no figura en la procedencia no se usa."""
        with self.assertRaises(nucleo.ArchivoFaltante):
            entrada_salida.original("prueba", "otro.csv")

    def test_ultimo_original(self) -> None:
        """De las copias fechadas, se usa la más reciente según su nombre."""
        self.assertEqual(
            entrada_salida.ultimo_original("prueba", r"c-\d{4}-\d{2}-\d{2}\.json").name, "c-2026-01-02.json"
        )
        with self.assertRaises(nucleo.ArchivoFaltante):
            entrada_salida.ultimo_original("prueba", r"z-.*")

    def test_procedencia_de_un_solo_archivo(self) -> None:
        """Una procedencia plana (un solo archivo) se trata como una lista de uno."""
        self.assertEqual(
            entrada_salida.entradas_procedencia({"archivo": "x", "sha256": "y"}), [{"archivo": "x", "sha256": "y"}]
        )

    def test_admitida(self) -> None:
        """Una fuente con todos sus controles correctos está admitida."""
        self.validacion({"estado": "Admitido", "controles": [{"control": "c", "resultado": "correcto"}]})
        self.assertEqual(admision.exigir_admitido("prueba")["estado"], "Admitido")

    def test_con_errores(self) -> None:
        """Un solo control fallido impide usar la fuente."""
        self.validacion({"estado": "Con errores", "controles": [{"control": "c", "resultado": "ERROR"}]})
        with self.assertRaises(nucleo.ValidacionFallida):
            admision.exigir_admitido("prueba")

    def test_formato_unico(self) -> None:
        """Solo hay un formato de validación: unos controles sin resultado no bastan para admitir una fuente."""
        self.validacion({"estado": "Admitido", "controles": ["cobertura"], "verificacion_integral": "Correcta"})
        with self.assertRaises(nucleo.ValidacionFallida):
            admision.exigir_admitido("prueba")

    def test_estado_no_admitido(self) -> None:
        """Con todos los controles correctos, el estado también tiene que decir «Admitido»."""
        self.validacion({"estado": "Con errores", "controles": [{"control": "c", "resultado": "correcto"}]})
        with self.assertRaises(nucleo.ValidacionFallida):
            admision.exigir_admitido("prueba")

    def test_sin_validacion(self) -> None:
        """Una fuente sin validar no se puede usar."""
        with self.assertRaises(nucleo.ArchivoFaltante):
            admision.exigir_admitido("prueba")

    def test_controles_de_huella(self) -> None:
        """Un control por original registrado; el que ya no conserva su huella falla, con su nombre."""
        procedencia = entrada_salida.procedencia("prueba")
        carpeta = self.originales / "prueba"
        intactos = nucleo.Controles()
        entrada_salida.controles_de_huella(intactos, carpeta, procedencia)
        self.assertEqual(len(intactos.lista), 3)
        self.assertTrue(intactos.admitido)
        self.dato.write_bytes(b"a,b,c\n")
        alterados = nucleo.Controles()
        entrada_salida.controles_de_huella(alterados, carpeta, procedencia)
        self.assertEqual(alterados.fallidos, ["huella de dato.csv"])

    def test_conjunto_validado(self) -> None:
        """El conjunto de una fuente es `<fuente>.json` en su carpeta validada, y solo se lee si está admitida."""
        self.assertEqual(entrada_salida.ruta_del_conjunto("prueba"), self.validados / "prueba" / "prueba.json")
        entrada_salida.guardar_json(entrada_salida.ruta_del_conjunto("prueba"), {"dato": 1})
        with self.assertRaises(nucleo.ArchivoFaltante):
            admision.leer_validado("prueba")
        self.validacion({"estado": "Admitido", "controles": [{"control": "c", "resultado": "correcto"}]})
        self.assertEqual(admision.leer_validado("prueba"), {"dato": 1})

    def test_cerrar_validacion_admitida(self) -> None:
        """Con todos los controles correctos se guardan la validación y el conjunto, en una línea si es compacto."""
        controles = nucleo.Controles()
        controles.comprobar(True, "c")
        informe = {"estado": "Admitido", "controles": controles.lista}
        with redirect_stdout(io.StringIO()) as salida:
            admision.cerrar_validacion("prueba", informe, controles, lambda: {"a": 1}, compacto=True)
        self.assertEqual(entrada_salida.leer_json(self.validados / "prueba" / "validacion.json"), informe)
        self.assertEqual((self.validados / "prueba" / "prueba.json").read_text(encoding="utf-8"), '{"a":1}')
        self.assertIn("✓ c", salida.getvalue())

    def test_cerrar_validacion_con_errores(self) -> None:
        """Con un control fallido se guarda la validación, pero el conjunto ni se calcula ni se escribe, y se para."""
        controles = nucleo.Controles()
        controles.comprobar(False, "c")
        calculado: list[bool] = []

        def conjunto() -> dict[str, int]:
            """Anota que se ha calculado y da un conjunto mínimo.

            Returns:
                Conjunto de prueba.
            """
            calculado.append(True)
            return {"a": 1}

        informe = {"estado": "Con errores", "controles": controles.lista}
        with redirect_stdout(io.StringIO()), self.assertRaisesRegex(nucleo.ValidacionFallida, "controles fallidos"):
            admision.cerrar_validacion("prueba", informe, controles, conjunto)
        self.assertEqual(entrada_salida.leer_json(self.validados / "prueba" / "validacion.json"), informe)
        self.assertFalse((self.validados / "prueba" / "prueba.json").exists())
        self.assertEqual(calculado, [])


class PruebaConservarOSustituir(unittest.TestCase):
    """Una descarga nunca sustituye en silencio un original distinto del conocido."""

    def setUp(self) -> None:
        """Carpeta temporal propia de cada prueba, con el destino de la descarga; se borra aunque la prueba falle."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.destino = Path(temporal.name) / "original.xls"

    @staticmethod
    def descarga(datos: bytes) -> nucleo.Descarga:
        """Compone una descarga simulada, sin red.

        Args:
            datos: contenido descargado.

        Returns:
            Descarga de un original .xls de prueba.
        """
        return nucleo.Descarga(datos, "https://ejemplo.invalid/original.xls", "application/vnd.ms-excel")

    def test_primera_descarga(self) -> None:
        """Sin original ni huella registrada, la descarga se guarda."""
        self.assertEqual(red.conservar_o_sustituir(self.destino, self.descarga(b"v1")), b"v1")
        self.assertEqual(self.destino.read_bytes(), b"v1")

    def test_falta_el_original_y_coincide_su_huella(self) -> None:
        """Si falta el original, una descarga con la huella registrada lo recupera."""
        regla = nucleo.ReglaDeCambio(huella_registrada=entrada_salida.sha256_bytes(b"v1"))
        self.assertEqual(red.conservar_o_sustituir(self.destino, self.descarga(b"v1"), regla), b"v1")

    def test_falta_el_original_y_la_version_ha_cambiado(self) -> None:
        """Si falta el original y la descarga no coincide con su huella, se detiene salvo que se acepte."""
        regla = nucleo.ReglaDeCambio(huella_registrada=entrada_salida.sha256_bytes(b"v1"))
        with self.assertRaises(nucleo.OriginalCambiado):
            red.conservar_o_sustituir(self.destino, self.descarga(b"v2"), regla)
        self.assertFalse(self.destino.exists())
        aceptada = regla._replace(aceptar_cambio=True)
        self.assertEqual(red.conservar_o_sustituir(self.destino, self.descarga(b"v2"), aceptada), b"v2")

    def test_original_distinto(self) -> None:
        """Con el original en disco, una versión distinta se detiene; si es equivalente, se conserva la anterior."""
        self.destino.write_bytes(b"v1")
        with self.assertRaises(nucleo.OriginalCambiado):
            red.conservar_o_sustituir(self.destino, self.descarga(b"v2"))
        equivalente = nucleo.ReglaDeCambio(equivalentes=lambda previo, nuevo: True)
        self.assertEqual(red.conservar_o_sustituir(self.destino, self.descarga(b"v2"), equivalente), b"v1")
        self.assertEqual(self.destino.read_bytes(), b"v1")

    def test_un_corte_al_escribir_deja_el_original_anterior(self) -> None:
        """La sustitución es entera o nada: un fallo al cambiar el archivo deja el anterior intacto y sin restos."""
        self.destino.write_bytes(b"v1")
        aceptada = nucleo.ReglaDeCambio(aceptar_cambio=True)
        with mock.patch.object(Path, "replace", side_effect=OSError("corte")), self.assertRaises(OSError):
            red.conservar_o_sustituir(self.destino, self.descarga(b"v2"), aceptada)
        self.assertEqual(self.destino.read_bytes(), b"v1")
        self.assertEqual(sorted(path.name for path in self.destino.parent.iterdir()), ["original.xls"])
        self.assertEqual(red.conservar_o_sustituir(self.destino, self.descarga(b"v2"), aceptada), b"v2")

    def test_interfaz_con_descarga(self) -> None:
        """Las fuentes que descargan aceptan --aceptar-cambio; por defecto, no se acepta ningún cambio."""
        analizador = ordenes.interfaz_con_descarga("prueba")
        self.assertFalse(analizador.parse_args(["descargar"]).aceptar_cambio)
        self.assertTrue(analizador.parse_args(["descargar", "--aceptar-cambio"]).aceptar_cambio)


def etapa_que_falla() -> None:
    """Falla siempre, como una etapa cuya validación no pasa.

    Raises:
        ValidacionFallida: siempre, con el motivo «motivo».
    """
    raise nucleo.ValidacionFallida("motivo")


class PruebaControles(unittest.TestCase):
    """Registro de controles e interfaz común."""

    def test_cada_control_queda_con_su_resultado_y_un_fallo_impide_admitir(self) -> None:
        """Cada control queda con su resultado; un fallo impide admitir."""
        controles = nucleo.Controles()
        self.assertTrue(controles.comprobar(True, "uno"))
        self.assertFalse(controles.comprobar(False, "dos"))
        self.assertEqual(
            controles.lista, [{"control": "uno", "resultado": "correcto"}, {"control": "dos", "resultado": "ERROR"}]
        )
        self.assertEqual(controles.fallidos, ["dos"])
        with self.assertRaises(nucleo.ValidacionFallida):
            controles.exigir("prueba")

    def test_exigir_lanza_formato_inesperado_si_no_se_cumple(self) -> None:
        """`exigir` sustituye a `assert` con una excepción que no desaparece con -O."""
        nucleo.exigir(True, "nada")
        with self.assertRaises(nucleo.FormatoInesperado):
            nucleo.exigir(False, "motivo")

    def test_ejecutar_todo_en_orden(self) -> None:
        """«todo» ejecuta descargar, preparar y validar, en ese orden."""
        orden: list[str] = []
        # Cada etapa anota su nombre; se declaran desordenadas para comprobar que el orden lo pone `ejecutar`.
        etapas = {etapa: (lambda etapa=etapa: orden.append(etapa)) for etapa in ("validar", "preparar", "descargar")}
        self.assertEqual(ordenes.ejecutar("todo", etapas), 0)
        self.assertEqual(orden, ["descargar", "preparar", "validar"])

    def test_ejecutar_error(self) -> None:
        """Un error de la cadena se muestra y devuelve 1, sin traza."""
        salida = io.StringIO()
        with redirect_stderr(salida), redirect_stdout(io.StringIO()):
            self.assertEqual(ordenes.ejecutar("validar", {"validar": etapa_que_falla}), 1)
        self.assertIn("motivo", salida.getvalue())

    def test_ejecutar_con_depurar_relanza_el_error(self) -> None:
        """Con --depurar, el error de la cadena llega entero, con su traza, en lugar de una línea."""
        with redirect_stdout(io.StringIO()), self.assertRaises(nucleo.ValidacionFallida):
            ordenes.ejecutar("validar", {"validar": etapa_que_falla}, depurar=True)

    def test_interfaz_acepta_las_acciones_y_la_opcion_depurar(self) -> None:
        """Todas las fuentes aceptan las mismas acciones (nucleo.ACCIONES) y la opción --depurar."""
        analizador = ordenes.interfaz("prueba")
        for accion in nucleo.ACCIONES:
            self.assertEqual(analizador.parse_args([accion]).accion, accion)
        self.assertTrue(analizador.parse_args(["validar", "--depurar"]).depurar)
        self.assertFalse(analizador.parse_args(["validar"]).depurar)
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            analizador.parse_args(["comprobar"])


class PruebaAgente(unittest.TestCase):
    """Cómo se presentan las descargas: un único agente de usuario neutro."""

    def setUp(self) -> None:
        """Inyecta el turno virtual para que la frontera HTTP simulada nunca duerma realmente."""
        pausa_red = mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _segundos: None))
        pausa_red.start()
        self.addCleanup(pausa_red.stop)

    def test_por_defecto(self) -> None:
        """Sin curlrc hay un navegador genérico portable, sin datos personales ni del proyecto."""
        with (
            tempfile.TemporaryDirectory() as temporal,
            mock.patch.object(Path, "home", return_value=Path(temporal)),
            mock.patch.dict(os.environ, {}, clear=True),
        ):
            agente = red.agente_de_usuario()
        self.assertEqual(agente, nucleo.AGENTE_POR_DEFECTO)
        self.assertNotIn("faro", agente.lower())
        self.assertNotIn("@", agente)

    def test_el_entorno_no_lo_cambia(self) -> None:
        """`FARO_AGENTE` no cambia el agente único de las consultas."""
        esperado = red.agente_de_usuario()
        for valor in (" EjemploBot/2.0 ", "  "):
            with self.subTest(valor=valor), mock.patch.dict(os.environ, {"FARO_AGENTE": valor}):
                self.assertEqual(red.agente_de_usuario(), esperado)

    def test_la_descarga_lo_envia(self) -> None:
        """Cada descarga lleva en `User-Agent` el agente común."""
        respuesta = PruebaDescarga.respuesta(b"contenido")
        with mock.patch.object(red, "abrir_peticion", return_value=respuesta) as abrir:
            self.assertEqual(red.descargar_url("https://ejemplo.org/a").datos, b"contenido")
        self.assertEqual(abrir.call_args.args[0].get_header("User-agent"), red.agente_de_usuario())


class PruebaDescarga(unittest.TestCase):
    """Una descarga tiene tope de tamaño y puede llevar un cuerpo (POST)."""

    def setUp(self) -> None:
        """Inyecta el turno virtual para que la frontera HTTP simulada nunca duerma realmente."""
        pausa_red = mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _segundos: None))
        pausa_red.start()
        self.addCleanup(pausa_red.stop)

    @staticmethod
    def respuesta(datos: bytes) -> mock.MagicMock:
        """Compone una respuesta simulada de `red.abrir_peticion` que da `datos` como un flujo leído con `read1`.

        Args:
            datos: cuerpo de la respuesta.

        Returns:
            Respuesta simulada, usable como gestor de contexto.
        """
        respuesta = mock.MagicMock(url="https://ejemplo.org/a", headers={"Content-Type": "text/plain"})
        respuesta.__enter__.return_value = respuesta
        respuesta.read1.side_effect = io.BytesIO(datos).read1
        return respuesta

    def test_una_respuesta_mayor_que_el_tope_se_rechaza(self) -> None:
        """Se lee como mucho un byte más que el tope: si llega, la descarga falla sin leer el resto."""
        # Justo por encima del tope (tope + 1) y muy por encima: ambos se rechazan.
        for datos in (b"12345", b"12345678"):
            respuesta = self.respuesta(datos)
            with (
                self.subTest(bytes=len(datos)),
                mock.patch.object(red, "MAX_DESCARGA_BYTES", 4),
                mock.patch.object(red, "abrir_peticion", return_value=respuesta),
                self.assertRaises(nucleo.FormatoInesperado),
            ):
                red.descargar_url("https://ejemplo.org/a")
            # La cota de memoria: nunca se pide más que tope + 1 bytes en total, nunca la respuesta entera.
            respuesta.read1.assert_called_once_with(4 + 1)

    def test_una_respuesta_dentro_del_tope_llega_entera(self) -> None:
        """Una respuesta de justo el tope se devuelve entera, aunque llegue en varios trozos."""
        with (
            mock.patch.object(red, "MAX_DESCARGA_BYTES", 4),
            mock.patch.object(red, "TROZO_DE_LECTURA", 3),
            mock.patch.object(red, "abrir_peticion", return_value=self.respuesta(b"1234")),
        ):
            self.assertEqual(red.descargar_url("https://ejemplo.org/a").datos, b"1234")

    def test_una_descarga_que_no_acaba_en_el_plazo_se_corta(self) -> None:
        """El plazo es de la descarga entera: un servidor que manda poco a poco no la alarga sin fin."""
        reloj = iter((0.0, 1.0, red.PLAZO_DESCARGA_S + 1.0))
        with (
            mock.patch.object(red, "TROZO_DE_LECTURA", 2),
            mock.patch.object(red.time, "monotonic", side_effect=lambda: next(reloj)),
            mock.patch.object(red, "abrir_peticion", return_value=self.respuesta(b"123456")),
            self.assertRaisesRegex(nucleo.FormatoInesperado, "no acaba"),
        ):
            red.descargar_url("https://ejemplo.org/a")

    def test_solo_http_y_https_tambien_tras_una_redireccion(self) -> None:
        """file:, ftp: o data: se rechazan sin abrir nada, y una redirección a ellos no se sigue."""
        with mock.patch.object(red, "abrir_peticion") as abrir:
            for url in ("file:///etc/passwd", "ftp://ejemplo.org/a", "data:,hola"):
                with self.subTest(url=url), self.assertRaises(nucleo.FormatoInesperado):
                    red.descargar_url(url)
        abrir.assert_not_called()
        peticion = red.Request("https://ejemplo.org/a")
        redireccion = red._RedireccionSoloWeb()
        with self.assertRaises(nucleo.FormatoInesperado):
            redireccion.redirect_request(peticion, io.BytesIO(), 302, "Found", {}, "ftp://ejemplo.org/b")
        seguida = redireccion.redirect_request(peticion, io.BytesIO(), 302, "Found", {}, "https://ejemplo.org/b")
        self.assertEqual(seguida.full_url, "https://ejemplo.org/b")

    def test_con_cuerpo_la_peticion_es_post(self) -> None:
        """Sin cuerpo, GET; con cuerpo, POST con esos bytes."""
        with mock.patch.object(red, "abrir_peticion", side_effect=lambda *a, **k: self.respuesta(b"{}")) as abrir:
            red.descargar_url("https://ejemplo.org/a")
            red.descargar_url("https://ejemplo.org/a", cuerpo=b'{"q":1}')
        sin_cuerpo, con_cuerpo = (llamada.args[0] for llamada in abrir.call_args_list)
        self.assertEqual((sin_cuerpo.get_method(), sin_cuerpo.data), ("GET", None))
        self.assertEqual((con_cuerpo.get_method(), con_cuerpo.data), ("POST", b'{"q":1}'))


class PruebaEscrituraYLecturaSeguras(unittest.TestCase):
    """Los archivos de datos se escriben enteros o nada, sin NaN, y un JSON roto se nombra."""

    def setUp(self) -> None:
        """Una carpeta temporal por prueba."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.carpeta = Path(temporal.name)

    def test_jsonl_que_falla_a_mitad_deja_el_anterior(self) -> None:
        """Si las filas fallan a mitad, el archivo previo sigue intacto y no queda temporal."""
        ruta = self.carpeta / "datos.jsonl"
        entrada_salida.guardar_jsonl(ruta, [{"a": 1}])

        def filas() -> Iterator[dict[str, int]]:
            """Una fila y después un error.

            Yields:
                La única fila que llega a darse.

            Raises:
                RuntimeError: Siempre, después de la primera fila.
            """
            yield {"a": 2}
            raise RuntimeError("corte")

        with self.assertRaises(RuntimeError):
            entrada_salida.guardar_jsonl(ruta, filas())
        self.assertEqual(ruta.read_text(encoding="utf-8"), '{"a":1}\n')
        self.assertEqual(sorted(archivo.name for archivo in self.carpeta.iterdir()), ["datos.jsonl"])

    def test_sin_nan_ni_infinitos(self) -> None:
        """Un NaN no se escribe como «NaN», que no es JSON: falla al guardar y no toca el archivo previo."""
        ruta = self.carpeta / "datos.json"
        entrada_salida.guardar_json(ruta, {"a": 1})
        for guardar in (entrada_salida.guardar_json, entrada_salida.guardar_json_compacto):
            with self.subTest(guardar=guardar.__name__), self.assertRaises(ValueError):
                guardar(ruta, {"a": float("nan")})
        self.assertEqual(json.loads(ruta.read_text(encoding="utf-8")), {"a": 1})

    def test_json_roto_con_su_ruta(self) -> None:
        """Un JSON o una línea de JSON Lines rotos dan FormatoInesperado con el archivo (y la línea)."""
        roto = self.carpeta / "roto.json"
        roto.write_text("{", encoding="utf-8")
        with self.assertRaisesRegex(nucleo.FormatoInesperado, "roto.json no es JSON válido"):
            entrada_salida.leer_json(roto)
        lineas = self.carpeta / "roto.jsonl"
        lineas.write_text('{"a": 1}\n\n{\n', encoding="utf-8")
        with self.assertRaisesRegex(nucleo.FormatoInesperado, "roto.jsonl, línea 3"):
            entrada_salida.leer_jsonl(lineas)

    def test_original_que_falta_es_un_control_fallido(self) -> None:
        """Sin el archivo, la huella no se conserva: False, no FileNotFoundError."""
        self.assertFalse(entrada_salida.conserva_su_huella(self.carpeta, {"archivo": "no.csv", "sha256": "0" * 64}))

    def test_la_procedencia_se_lee_una_vez(self) -> None:
        """Comprobar n originales lee su procedencia una sola vez."""
        entradas = []
        for nombre in ("a.csv", "b.csv", "c.csv"):
            (self.carpeta / nombre).write_bytes(nombre.encode())
            entradas.append({"archivo": nombre, "sha256": entrada_salida.sha256_bytes(nombre.encode())})
        carpetas = nucleo.Carpetas(self.carpeta, self.carpeta, self.carpeta)
        with (
            mock.patch.object(entrada_salida, "carpetas", return_value=carpetas),
            mock.patch.object(entrada_salida, "procedencia", return_value={"archivos": entradas}) as leida,
        ):
            rutas = entrada_salida.comprobar_originales("f")
        self.assertEqual([ruta.name for ruta in rutas], ["a.csv", "b.csv", "c.csv"])
        self.assertEqual(leida.call_count, 1)

    def test_validacion_con_controles_mal_formados(self) -> None:
        """Un control sin «resultado» o una validación que no es objeto dan ValidacionFallida, no KeyError."""
        ruta = self.carpeta / "validacion.json"
        for validacion in ({"estado": "Admitido", "controles": [{"control": "x"}]}, ["no", "objeto"]):
            ruta.write_text(json.dumps(validacion), encoding="utf-8")
            with self.subTest(validacion=validacion), self.assertRaises(nucleo.ValidacionFallida):
                admision.exigir_admitido("f", ruta=ruta)

    def test_conjunto_que_falla_no_deja_informe_nuevo(self) -> None:
        """Si componer el conjunto falla, no se escribe un informe que admita el conjunto anterior."""
        carpetas = nucleo.Carpetas(self.carpeta, self.carpeta, self.carpeta)
        controles = nucleo.Controles()
        controles.comprobar(True, "c")

        def conjunto() -> object:
            """Falla al componerse.

            Raises:
                RuntimeError: Siempre.
            """
            raise RuntimeError("conjunto")

        with (
            mock.patch.object(admision, "carpetas", return_value=carpetas),
            mock.patch.object(admision, "ruta_del_conjunto", return_value=self.carpeta / "f.json"),
            self.assertRaisesRegex(RuntimeError, "^conjunto$"),
        ):
            admision.cerrar_validacion("f", {"estado": "Admitido", "controles": controles.lista}, controles, conjunto)
        self.assertFalse(carpetas.validacion.exists())


if __name__ == "__main__":
    unittest.main()
