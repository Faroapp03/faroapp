"""Pruebas de la traducción al catalán: partes, controles y combinación.

Lector: plataforma_datos/comun/fuentes/catalan/lector.py.

Sin red ni originales: los archivos de origen y de traducción van en una carpeta temporal y el castellano vigente se
da en memoria. Cada control que bloquea tiene un caso que pasa y otro que falla.
"""

import io
import json
import tempfile
import unicodedata
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from typing import Any
from unittest import mock

import plataforma_datos.comun.fuentes.catalan.exportacion as exportacion_catalan
import plataforma_datos.comun.fuentes.catalan.lector as catalan
import plataforma_datos.comun.fuentes.catalan.piezas.comprobaciones_catalan as comprobaciones
import plataforma_datos.comun.fuentes.nombres.lector as nombres
import plataforma_datos.ocupaciones.fuentes.textos.lector as fuente_textos
from plataforma_datos.comun.nucleo import FormatoInesperado, ValidacionFallida
from plataforma_datos.orquestacion.ordenes import motivo_de_rechazo

PROCEDENCIA = {
    "modelo": "anthropic/claude-opus-5-5",
    "fecha": "2026-09-28",
    "estado": catalan.ESTADO,
    "marca": catalan.MARCA,
}
CASTELLANO = {
    "tareas": {
        "4226-1.corto": "Recibir a las personas",
        "4226-1.texto": "Recibir y dar la bienvenida a visitantes, huéspedes o clientes",
        "4226-2.corto": "Concertar citas",
        "4226-2.texto": "Concertar citas para los clientes",
    },
    "grupos": {"4": "Personal de apoyo administrativo", "4226": "Recepcionistas (general)"},
    "ocupaciones": {"4226.1": "recepcionista", "7512.1": "panadero/panadera"},
}
CATALAN = {
    "tareas": {
        "4226-1.corto": "Rebre les persones",
        "4226-1.texto": "Rebre i donar la benvinguda a visitants, hostes o clients",
        "4226-2.corto": "Concertar cites",
        "4226-2.texto": "Concertar cites per als clients",
    },
    "grupos": {"4": "Personal de suport administratiu", "4226": "Recepcionistes (general)"},
    "ocupaciones": {"4226.1": "recepcionista", "7512.1": "forner/fornera"},
}
IGUALES = {"ocupaciones": {"4226.1": "misma forma en catalán"}}
# Tope de claves por parte en las pruebas del reparto: pequeño para que ocho tareas no quepan en una sola parte.
MAX_CLAVES_DE_PRUEBA = 5
AVISO = "This is a translation of a copyrighted work of the ILO."
# Los nombres oficiales del Idescat, como los valida su lector: distintos de la traducción con IA de CATALAN.
IDESCAT = {
    "cita": "Fuente: elaboración propia a partir de datos del Idescat",
    "licencia": "Aviso legal del Idescat",
    "consultado": "2026-10-06",
    "isco08_ca": {"4226": "Recepcionistes (general)", "4": "Personal de suport administratiu oficial"},
    "cno11_ca": {"4": "Empleats comptables, administratius i altres empleats d'oficina"},
}


def escribir(ruta: Path, contenido: dict[str, Any]) -> None:
    """Guarda un JSON de prueba."""
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(contenido, ensure_ascii=False), encoding="utf-8")


def traduccion(textos: dict[str, str], **cambios: object) -> dict[str, Any]:
    """Compone un archivo de traducción completo, con los cambios indicados.

    Args:
        textos: textos traducidos, por clave.
        **cambios: campos del archivo que sustituyen a los de por omisión (procedencia, iguales_al_castellano…).

    Returns:
        Contenido del archivo de traducción, listo para escribirlo.
    """
    return {"procedencia": dict(PROCEDENCIA), "iguales_al_castellano": {}, "textos": textos, **cambios}


class ConCarpeta(unittest.TestCase):
    """Base de las pruebas: una carpeta temporal con una parte de origen por tipo y su traducción."""

    def setUp(self) -> None:
        """Escribe los orígenes y las traducciones de prueba y apunta la fuente a la carpeta temporal."""
        # Cada recurso se libera con addCleanup en cuanto se toma: si setUp falla a medias, tearDown no se
        # ejecutaría y los parches seguirían puestos para las demás pruebas del proceso.
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        base = Path(temporal.name)
        for constante, ruta in (
            ("PREPARADO", base),
            ("ORIGEN", base / "origen"),
            ("TRADUCCIONES", base / "traducciones"),
        ):
            parche = mock.patch.object(catalan, constante, ruta)
            parche.start()
            self.addCleanup(parche.stop)
        for tipo, textos in CASTELLANO.items():
            self.origen(tipo, "muestra", textos)
            self.traducida(tipo, "muestra", traduccion(CATALAN[tipo], iguales_al_castellano=IGUALES.get(tipo, {})))

    def origen(self, tipo: str, parte: str, textos: dict[str, str]) -> None:
        """Escribe una parte de origen."""
        contenido = {"tipo": tipo, "parte": parte, "claves": len(textos), "textos": textos}
        escribir(catalan.ORIGEN / catalan.nombre_de_parte(tipo, parte), contenido)

    def traducida(self, tipo: str, parte: str, contenido: dict[str, Any]) -> None:
        """Escribe la traducción de una parte."""
        escribir(catalan.TRADUCCIONES / catalan.nombre_de_parte(tipo, parte), contenido)

    def controles(self) -> catalan.Controles:
        """Calcula los controles con una procedencia al día (las huellas de ahora).

        Returns:
            Controles de la fuente sobre la carpeta temporal.
        """
        registrados = [{"archivo": ruta, "sha256": huella} for ruta, huella in catalan.huellas().items()]
        return catalan.controles({"origen": registrados, "traducciones": []})

    def fallidos(self) -> list[str]:
        """Lista los controles que no se cumplen.

        Returns:
            Texto de cada control fallido.
        """
        return self.controles().fallidos


class PruebaPartes(unittest.TestCase):
    """Orden de las claves y reparto en partes."""

    def test_una_clave_retirada_de_la_muestra_no_entra_en_el_plan(self) -> None:
        """Si la muestra escrita tiene una clave que el castellano ya no tiene, el plan la deja fuera."""
        plan = catalan.plan_de_partes("grupos", {"1": "Directores", "2": "Técnicos"}, ["1", "9"])
        self.assertEqual(plan[catalan.PARTE_MUESTRA], ["1"])
        self.assertEqual(plan["01"], ["2"])

    def test_un_elemento_que_no_cabe_en_ninguna_parte_es_un_error(self) -> None:
        """Con un tope menor que los campos de una tarea, el reparto termina con un motivo, no en un bucle sin fin."""
        with mock.patch.object(catalan, "MAX_CLAVES_POR_PARTE", 1), self.assertRaises(catalan.ErrorFuente):
            catalan.repartir("tareas", ["4226-1.corto", "4226-1.texto"])

    def test_la_barra_final_copiada_tambien_vale(self) -> None:
        """La «/» final del original no se exige, pero copiarla tampoco es un error."""
        self.assertTrue(comprobaciones.mismos_marcadores("director/directora/", "director/directora/"))

    def test_orden_natural(self) -> None:
        """Los grupos van por su jerarquía, las ocupaciones y las tareas por sus números y campos."""
        self.assertEqual(catalan.ordenadas("grupos", ["2", "11", "1", "111"]), ["1", "11", "111", "2"])
        self.assertEqual(catalan.ordenadas("ocupaciones", ["0110.10", "0110.9"]), ["0110.9", "0110.10"])
        claves = ["4226-10.corto", "4226-2.lo_tuyo", "4226-2.corto"]
        self.assertEqual(catalan.ordenadas("tareas", claves), ["4226-2.corto", "4226-2.lo_tuyo", "4226-10.corto"])

    def test_reparto_sin_partir_tareas_ni_pasar_del_maximo(self) -> None:
        """Las partes no pasan del máximo y los campos de una tarea van juntos."""
        claves = [f"1111-{i}.{campo}" for i in range(1, 8) for campo in ("corto", "texto")]
        claves += ["1111-8.corto", "1111-8.texto", "1111-8.ia_podria", "1111-8.lo_tuyo"]
        with mock.patch.object(catalan, "MAX_CLAVES_POR_PARTE", MAX_CLAVES_DE_PRUEBA):
            partes = catalan.repartir("tareas", claves)
        self.assertTrue(all(len(parte) <= MAX_CLAVES_DE_PRUEBA for parte in partes))
        self.assertEqual(sorted(clave for parte in partes for clave in parte), sorted(claves))
        for parte in partes:
            for tarea in {clave.rsplit(".", 1)[0] for clave in parte}:
                campos = [clave for clave in claves if clave.startswith(f"{tarea}.")]
                self.assertTrue(set(campos) <= set(parte), f"{tarea} partida entre dos partes")

    def test_plan_con_muestra_y_resto(self) -> None:
        """La muestra no se repite en el resto, y el resto se numera desde 01."""
        grupos = dict.fromkeys(("1", "11", "4", "42", "4226", "9"), "x")
        plan = catalan.plan_de_partes("grupos", grupos)
        self.assertEqual(plan["muestra"], ["4", "42", "4226"])
        self.assertEqual(plan["01"], ["1", "11", "9"])


class PruebaCastellano(unittest.TestCase):
    """Los textos que se comparan con la traducción proceden de los bytes admitidos."""

    def test_el_castellano_conserva_los_textos_comprobados_ante_un_cambio(self) -> None:
        """Una escritura tras la guarda no sustituye los campos españoles usados como origen."""
        tarea = {"corto": "Recibir", "texto_es": "Recibir personas", "ia_podria": "Orientar", "lo_tuyo": "Atender"}
        piloto = {"tareas": {"4226-1": tarea}}
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            escribir(carpeta / fuente_textos.PILOTO, piloto)
            for nombre in (fuente_textos.GENERADAS, fuente_textos.TRADUCIDAS):
                (carpeta / nombre).write_bytes(b"")
            validacion = {"sha256": {nombre: catalan.sha256(carpeta / nombre) for nombre in fuente_textos.ARCHIVOS}}

            def comprobar_y_cambiar() -> dict[str, bytes]:
                """Captura lo admitido y simula una escritura antes de que el consumidor lo combine.

                Returns:
                    Los bytes comprobados antes del cambio simulado.
                """
                archivos = fuente_textos.archivos_validados()
                escribir(carpeta / fuente_textos.PILOTO, {"tareas": {"4226-1": {**tarea, "corto": "Alterado"}}})
                return archivos

            with (
                mock.patch.object(fuente_textos, "PREPARADO", carpeta),
                mock.patch.object(fuente_textos, "exigir_admitido", return_value=validacion),
                mock.patch.object(fuente_textos, "aviso_traduccion", return_value=AVISO),
                mock.patch.object(catalan, "textos_validados", side_effect=comprobar_y_cambiar),
            ):
                vigente = catalan._tareas_en_castellano()
        esperado = {"4226-1.corto": "Recibir", "4226-1.texto": "Recibir personas"}
        esperado.update({f"4226-1.{campo}": tarea[campo] for campo in fuente_textos.CAMPOS_REDACCION})
        self.assertEqual(vigente, esperado)


class PruebaComprobaciones(unittest.TestCase):
    """Cada comprobación de un texto, con un caso que pasa y otro que falla."""

    def test_numeros(self) -> None:
        """Las mismas secuencias de cifras."""
        self.assertTrue(comprobaciones.mismos_numeros("Turnos de 12 horas en 2026", "Torns de 12 hores el 2026"))
        self.assertFalse(comprobaciones.mismos_numeros("Turnos de 12 horas", "Torns de 13 hores"))

    def test_siglas(self) -> None:
        """Las mismas siglas de 2 o más mayúsculas."""
        self.assertTrue(comprobaciones.mismas_siglas("Sistemas TIC y ERP", "Sistemes TIC i ERP"))
        self.assertFalse(comprobaciones.mismas_siglas("Sistemas TIC y ERP", "Sistemes tic i ERP"))

    def test_marcadores(self) -> None:
        """La misma cantidad de «/», paréntesis, comillas angulares y %."""
        self.assertTrue(comprobaciones.mismos_marcadores("panadero/panadera (general)", "forner/fornera (general)"))
        self.assertFalse(comprobaciones.mismos_marcadores("panadero/panadera", "forner o fornera"))
        self.assertFalse(comprobaciones.mismos_marcadores("un 5 % más", "un 5 per cent més"))

    def test_barra_suelta_al_final_del_original(self) -> None:
        """Una «/» suelta al final del original es una errata de la fuente: la traducción no tiene que copiarla."""
        self.assertTrue(comprobaciones.mismos_marcadores("director/directora/", "director/directora"))
        self.assertFalse(comprobaciones.mismos_marcadores("director/directora/", "director o directora"))

    def test_no_se_admite_una_barra_final_que_no_tiene_el_original(self) -> None:
        """La excepción de la errata final solo se aplica si está en el original."""
        self.assertFalse(comprobaciones.mismos_marcadores("panadero/panadera", "forner/fornera/"))
        self.assertTrue(comprobaciones.mismos_marcadores("panadero/panadera/", "forner/fornera/"))

    def test_solo_siglas_distingue_minusculas_unicode_y_signos(self) -> None:
        """Una minúscula Unicode impide la excepción; la división no es una minúscula."""
        self.assertFalse(comprobaciones.solo_siglas_y_numeros("TIC ω"))
        self.assertTrue(comprobaciones.solo_siglas_y_numeros("TIC 12 ÷ 3"))

    def test_longitud(self) -> None:
        """Un texto corto tiene holgura; uno largo cortado o inflado, no."""
        self.assertTrue(comprobaciones.longitud_razonable("Bomberos", "Bombers"))
        largo = "Controlar y extinguir incendios utilizando equipos manuales y motorizados"
        self.assertTrue(
            comprobaciones.longitud_razonable(largo, "Controlar i extingir incendis amb equips manuals i motoritzats")
        )
        self.assertFalse(comprobaciones.longitud_razonable(largo, "Controlar incendis"))
        self.assertFalse(comprobaciones.longitud_razonable("Bomberos", "Bombers " * 5))

    def test_caracteres(self) -> None:
        """Ele geminada con punto volado y apóstrofos ' o ’; nada de «l.l», ŀ, ñ, á, ì, ù, ¿ ni ¡."""
        bien = ("Professionals intel·lectuals", "L’atenció", "L'atenció", "Anàlisi ràpida de l’àrea: sí, més, què")
        for texto in bien:
            with self.subTest(texto=texto):
                self.assertTrue(comprobaciones.caracteres_catalanes("", texto))
        malas = (
            "intel.lectuals",
            "intelŀlectuals",
            "a·b",
            "L´atenció",
            "Disseny i diseño",
            "Está bé",
            "¿Què?",
            "Així ì",
        )
        for texto in malas:
            with self.subTest(texto=texto):
                self.assertFalse(comprobaciones.caracteres_catalanes("", texto))

    def test_caracteres_equivalentes_unicode_no_eluden_la_comprobacion(self) -> None:
        """Las letras descompuestas tienen el mismo resultado sin reescribir el texto traducido."""
        for texto in ("Está bé", "Disseny i diseño", "Així ì"):
            for forma in ("NFC", "NFD"):
                with self.subTest(texto=texto, forma=forma):
                    self.assertFalse(comprobaciones.caracteres_catalanes("", unicodedata.normalize(forma, texto)))
        catalan_valido = "Anàlisi ràpida de l’àrea: sí, més, què"
        for forma in ("NFC", "NFD"):
            with self.subTest(forma=forma):
                self.assertTrue(comprobaciones.caracteres_catalanes("", unicodedata.normalize(forma, catalan_valido)))

    def test_texto_vacio(self) -> None:
        """Un texto de solo espacios no es una traducción."""
        self.assertTrue(comprobaciones.no_vacio("", "Bombers"))
        self.assertFalse(comprobaciones.no_vacio("", "  "))


class PruebaArchivos(ConCarpeta):
    """Controles de los archivos: cada uno bloquea la exportación si falla."""

    def test_todo_correcto(self) -> None:
        """Con los orígenes, las traducciones y su procedencia al día, se admite."""
        self.assertEqual(self.fallidos(), [])

    def test_huella_cambiada(self) -> None:
        """Un archivo cambiado después de registrar su procedencia ya no se admite."""
        registrados = [{"archivo": ruta, "sha256": huella} for ruta, huella in catalan.huellas().items()]
        self.traducida("grupos", "muestra", traduccion({**CATALAN["grupos"], "4": "Personal de suport"}))
        self.assertFalse(catalan.controles({"origen": registrados, "traducciones": []}).admitido)

    def test_lo_exportado_sale_de_los_bytes_comprobados(self) -> None:
        """Si una traducción cambia tras comprobar su huella, la combinación sigue saliendo de lo comprobado."""
        leidos = catalan.leer_archivos()
        with mock.patch.object(catalan, "exigir_admitido", return_value={"sha256": catalan.huellas(leidos)}):
            validados = catalan.archivos_validados()
        self.traducida("grupos", "muestra", traduccion({**CATALAN["grupos"], "4": "Personal alterat"}))
        self.assertEqual(catalan.traducciones(validados), catalan.traducciones(leidos))
        self.assertNotEqual(catalan.traducciones(validados), catalan.traducciones())
        self.assertNotEqual(catalan.huellas(validados), catalan.huellas())

    def test_cambio_rechazado_por_los_dos_consumidores(self) -> None:
        """Nombres y exportación detienen la lectura si cambia un archivo después de validar."""
        validacion = {"sha256": catalan.huellas()}
        self.traducida("grupos", "muestra", traduccion({"4": "Personal alterat"}))
        modulo = exportacion_catalan

        with (
            mock.patch.object(catalan, "exigir_admitido", return_value=validacion),
            mock.patch.object(modulo, "TRADUCCIONES_CATALAN", catalan.TRADUCCIONES),
            mock.patch.object(nombres, "traducciones_catalan") as leer,
            mock.patch.object(modulo, "combinar_catalan") as combinar,
        ):
            for consumir in (nombres._traduccion_al_catalan, modulo.paquete_catalan):
                with self.subTest(consumidor=consumir.__name__), self.assertRaises(ValidacionFallida) as fallo:
                    consumir()
                self.assertEqual(
                    str(fallo.exception),
                    "catalan: los archivos no son los validados; ejecutar"
                    " python -m plataforma_datos.comun.fuentes.catalan.lector todo",
                )
            leer.assert_not_called()
            combinar.assert_not_called()

    def test_no_admitido_conserva_error_y_no_lee_archivos(self) -> None:
        """La falta de admisión se propaga con el mismo objeto de error antes de tocar archivos."""
        error = ValidacionFallida("catalan: no admitido")
        with (
            mock.patch.object(catalan, "exigir_admitido", side_effect=error),
            mock.patch.object(catalan, "leer_archivos") as leer,
        ):
            with self.assertRaises(ValidacionFallida) as fallo:
                catalan.archivos_validados()
            self.assertIs(fallo.exception, error)
            leer.assert_not_called()

    def test_los_mensajes_citan_una_orden_que_existe(self) -> None:
        """Cada mensaje que manda ejecutar algo nombra el módulo real y una etapa que su interfaz admite."""
        catalan.ORIGEN.rename(catalan.ORIGEN.with_name("apartado"))
        with self.assertRaises(ValidacionFallida) as falta:
            catalan.preparar()
        with (
            mock.patch.object(catalan, "exigir_admitido", return_value={"sha256": {}}),
            self.assertRaises(ValidacionFallida) as cambiado,
        ):
            catalan.archivos_validados()
        for mensaje in (str(falta.exception), str(cambiado.exception)):
            with self.subTest(mensaje=mensaje):
                orden = mensaje.split("; ejecutar ", 1)[1].split()
                self.assertEqual(orden[:3], ["python", "-m", catalan.__name__])
                self.assertIsNone(motivo_de_rechazo(catalan.main, orden[3:]))

    def test_traduccion_sin_origen(self) -> None:
        """Una traducción sin su archivo de origen no se admite."""
        self.traducida("grupos", "02", traduccion({"4": "x"}))
        self.assertTrue(any("su archivo de origen" in control for control in self.fallidos()))

    def test_claves_que_faltan_o_sobran(self) -> None:
        """Ninguna clave puede faltar ni sobrar frente a su origen."""
        origen = {"textos": CASTELLANO["grupos"]}
        self.assertEqual(catalan.problemas_de_claves(traduccion(CATALAN["grupos"]), origen), [])
        self.assertEqual(catalan.problemas_de_claves(traduccion({"4": "x"}), origen), ["falta 4226"])
        sobra = traduccion({**CATALAN["grupos"], "5": "x"})
        self.assertEqual(catalan.problemas_de_claves(sobra, origen), ["sobra 5"])

    def test_una_procedencia_con_valores_que_no_son_texto_no_pasa(self) -> None:
        """Un modelo nulo, un número o una lista no cuentan como presentes."""
        for valor in (None, 3, ["x"]):
            with self.subTest(valor=valor):
                procedencia = dict(PROCEDENCIA, modelo=valor)
                self.assertIn("falta modelo", catalan.problemas_de_procedencia(traduccion({}, procedencia=procedencia)))

    def test_una_traduccion_sin_su_forma_es_un_control_fallido(self) -> None:
        """«textos» o «iguales_al_castellano» que no son objetos de textos fallan el control de claves, sin traza."""
        for contenido in (
            {**traduccion(CATALAN["grupos"]), "textos": ["4226"]},
            {**traduccion(CATALAN["grupos"]), "iguales_al_castellano": "todas"},
        ):
            with self.subTest(contenido=contenido):
                self.traducida("grupos", "muestra", contenido)
                self.assertTrue(any(control.startswith("traducciones: ninguna clave") for control in self.fallidos()))
                catalan.cobertura({tipo: dict(textos) for tipo, textos in CASTELLANO.items()})

    def test_procedencia(self) -> None:
        """La procedencia dice modelo, fecha AAAA-MM-DD, estado y marca exactos."""
        self.assertEqual(catalan.problemas_de_procedencia(traduccion({})), [])
        for campo, valor in (("modelo", ""), ("fecha", "28/09/2026"), ("estado", "revisada"), ("marca", "oficial")):
            with self.subTest(campo=campo):
                procedencia = dict(PROCEDENCIA, **{campo: valor})
                self.assertTrue(catalan.problemas_de_procedencia(traduccion({}, procedencia=procedencia)))
        self.assertEqual(catalan.problemas_de_procedencia({"textos": {}}), ["sin procedencia"])

    def test_la_fecha_de_procedencia_existe_en_el_calendario(self) -> None:
        """El formato ISO exige cifras ASCII y una fecha real, incluyendo los años bisiestos."""
        for fecha in ("2026-02-29", "2026-13-01", "2026-00-10", "0000-01-01", "２０２６-09-28"):
            with self.subTest(fecha=fecha):
                contenido = traduccion({}, procedencia={**PROCEDENCIA, "fecha": fecha})
                self.assertTrue(catalan.problemas_de_procedencia(contenido))
        contenido = traduccion({}, procedencia={**PROCEDENCIA, "fecha": "2024-02-29"})
        self.assertEqual(catalan.problemas_de_procedencia(contenido), [])

    def test_un_origen_sin_objeto_de_textos_se_rechaza_con_motivo(self) -> None:
        """Un origen dañado produce un error de fuente, antes de leer campos o comparar textos."""
        ruta = catalan.ORIGEN / "grupos-muestra.json"
        for contenido in ([], None, {"textos": []}, {"textos": {"4": 3}}):
            with self.subTest(contenido=contenido):
                ruta.write_text(json.dumps(contenido), encoding="utf-8")
                with self.assertRaisesRegex(FormatoInesperado, "grupos-muestra.json"):
                    self.controles()
        self.origen("grupos", "muestra", CASTELLANO["grupos"])
        self.assertEqual(self.fallidos(), [])

    def test_preparar_rechaza_traduccion_sin_forma_con_motivo(self) -> None:
        """La captura de traducción dañada no causa AttributeError al registrar su procedencia."""
        ruta = catalan.TRADUCCIONES / "grupos-muestra.json"
        ruta.write_text("[]", encoding="utf-8")
        with (
            mock.patch.object(catalan, "aviso_traduccion", return_value=AVISO),
            mock.patch.object(catalan, "guardar_json") as guardar,
            self.assertRaisesRegex(FormatoInesperado, "grupos-muestra.json"),
        ):
            catalan.preparar()
        guardar.assert_not_called()

    def test_una_declaracion_de_igual_debe_corresponder_a_una_clave(self) -> None:
        """Una declaración para una clave ausente no puede pasar por comparar dos valores nulos."""
        origen = {"textos": {"a": "recepcionista"}}
        contenido = traduccion({"a": "recepcionista"}, iguales_al_castellano={"a": "misma forma", "z": "igual"})
        self.assertTrue(catalan.problemas_de_iguales(contenido, origen))
        contenido["iguales_al_castellano"].pop("z")
        self.assertEqual(catalan.problemas_de_iguales(contenido, origen), [])

    def test_iguales_al_castellano(self) -> None:
        """Igual al castellano solo con motivo declarado, y la declaración tiene que ser cierta."""
        origen = {"textos": {"a": "recepcionista", "b": "TIC", "c": "bombero"}}
        textos = {"a": "recepcionista", "b": "TIC", "c": "bomber"}
        con_motivo = traduccion(textos, iguales_al_castellano={"a": "misma forma"})
        self.assertEqual(catalan.problemas_de_iguales(con_motivo, origen), [])
        self.assertTrue(catalan.problemas_de_iguales(traduccion(textos), origen))
        sin_motivo = traduccion(textos, iguales_al_castellano={"a": " "})
        self.assertTrue(catalan.problemas_de_iguales(sin_motivo, origen))
        falsa = traduccion(textos, iguales_al_castellano={"a": "misma forma", "c": "misma forma"})
        self.assertTrue(catalan.problemas_de_iguales(falsa, origen))

    def test_un_texto_mal_bloquea(self) -> None:
        """Un texto con una comprobación fallida hace fallar la validación entera."""
        self.traducida("grupos", "muestra", traduccion({**CATALAN["grupos"], "4226": "Recepcionistes general"}))
        self.assertTrue(any("marcadores" in control for control in self.fallidos()))

    def test_origenes_que_se_solapan(self) -> None:
        """Una clave no puede estar en dos partes del mismo tipo."""
        self.origen("grupos", "01", {"4": "Personal de apoyo administrativo"})
        self.assertTrue(any("dos partes" in control for control in self.fallidos()))


class PruebaCobertura(ConCarpeta):
    """Lo que no bloquea: partes sin traducir y traducciones desactualizadas."""

    def test_cobertura_parcial_no_bloquea(self) -> None:
        """Una parte sin traducir se cuenta, pero no impide exportar lo traducido."""
        self.origen("grupos", "01", {"5": "Trabajadores de los servicios"})
        castellano = {**CASTELLANO, "grupos": {**CASTELLANO["grupos"], "5": "Trabajadores de los servicios"}}
        self.assertEqual(self.fallidos(), [])
        resumen = catalan.cobertura(castellano)["grupos"]
        self.assertEqual((resumen["claves"], resumen["traducidas"]), (3, 2))
        self.assertEqual(resumen["partes_sin_traducir"], ["grupos-01.json"])

    def test_desactualizadas_no_se_exportan(self) -> None:
        """Si el castellano vigente ya no es el del origen, la traducción no se exporta y se cuenta."""
        castellano = {**CASTELLANO, "grupos": {**CASTELLANO["grupos"], "4": "Personal administrativo"}}
        self.assertEqual(self.fallidos(), [])
        self.assertEqual(catalan.cobertura(castellano)["grupos"]["desactualizadas"], ["4"])
        self.assertEqual(catalan.combinar(castellano, AVISO, IDESCAT)["grupos"]["4"], IDESCAT["isco08_ca"]["4"])
        # Los grupos salen siempre del Idescat; la regla se prueba con un tipo que sí exporta su traducción.
        castellano = {**CASTELLANO, "ocupaciones": {**CASTELLANO["ocupaciones"], "7512.1": "panadero"}}
        self.assertEqual(catalan.cobertura(castellano)["ocupaciones"]["desactualizadas"], ["7512.1"])
        ocupaciones = catalan.combinar(castellano, AVISO, IDESCAT)["ocupaciones"]
        self.assertEqual(ocupaciones["4226.1"], CATALAN["ocupaciones"]["4226.1"])
        self.assertNotIn("7512.1", ocupaciones)

    def test_forma_de_combinar(self) -> None:
        """Lo que se exporta tiene la forma de DatosCatalan: tareas por campo y títulos por código."""
        combinado = catalan.combinar(CASTELLANO, AVISO, IDESCAT)
        claves = ["idioma", "marca", "estado", "aviso_traduccion", "tareas", "grupos", "ocupaciones"]
        claves += ["grupos_cno11", "fuente_grupos"]
        self.assertEqual(list(combinado), claves)
        self.assertEqual((combinado["idioma"], combinado["marca"]), ("ca", "traducido con IA"))
        self.assertEqual((combinado["estado"], combinado["aviso_traduccion"]), ("traducido con IA", AVISO))
        self.assertEqual(
            combinado["tareas"]["4226-1"], {"corto": "Rebre les persones", "texto": CATALAN["tareas"]["4226-1.texto"]}
        )
        # Los grupos son los oficiales del Idescat, literales y en su orden; nunca la traducción con IA.
        self.assertEqual(list(combinado["grupos"]), ["4", "4226"])
        self.assertEqual(combinado["grupos"], IDESCAT["isco08_ca"])
        self.assertEqual(combinado["grupos_cno11"], IDESCAT["cno11_ca"])
        fuente = {clave: IDESCAT[clave] for clave in ("cita", "licencia", "consultado")}
        self.assertEqual(combinado["fuente_grupos"], fuente)
        self.assertEqual(combinado["ocupaciones"]["7512.1"], "forner/fornera")


class PruebaExportadorCatalan(unittest.TestCase):
    """El paquete catalan.json es opcional: sin traducciones no se exporta ni entra en el manifiesto."""

    def test_sin_traducciones_no_hay_paquete(self) -> None:
        """Sin var/actualizacion/preparados/catalan/traducciones, el exportador avisa y sigue sin el paquete."""
        modulo = exportacion_catalan

        errores = io.StringIO()
        with tempfile.TemporaryDirectory() as temporal:
            falta = Path(temporal) / "traducciones"
            with mock.patch.object(modulo, "TRADUCCIONES_CATALAN", falta), redirect_stderr(errores):
                self.assertIsNone(modulo.paquete_catalan())
        self.assertIn("sin traducciones al catalán", errores.getvalue())


if __name__ == "__main__":
    unittest.main()
