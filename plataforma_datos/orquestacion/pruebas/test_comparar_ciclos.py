"""La comparación de dos ciclos, fuente por fuente, con lo que cada uno conserva: el criterio del estreno.

Cada ciclo sintético pasa por el `Seguimiento` real: abre su ciclo en el registro de comprobaciones, descarga con un
recibo de recepción (o sin él) y cierra cada fuente, así que la huella de lo descargado la anota el propio ciclo.
"""

import hashlib
import io
import json
import shutil
import tempfile
import unittest
import uuid
from collections.abc import Sequence
from contextlib import redirect_stderr, redirect_stdout
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.orquestacion import actualizar, comparar_ciclos, comprobaciones_remotas, huellas_de_lo_descargado
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion.ejecucion_observada import CARPETA_DE_INTENTOS
from plataforma_datos.orquestacion.estado_de_la_actualizacion import AMBAR, VERDE, ResultadoDelModulo
from plataforma_datos.orquestacion.modulos import MODULOS, carpetas
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES
from plataforma_datos.orquestacion.seguimiento_de_comprobaciones import Seguimiento

POR_ID = {modulo.id: modulo for modulo in MODULOS}


def sha(texto: str) -> str:
    """Una huella de prueba.

    Returns:
        El SHA-256 hexadecimal del texto.
    """
    return hashlib.sha256(texto.encode()).hexdigest()


def recibo(fuente: str, cuerpo: str) -> dict:
    """Un recibo de recepción válido con una sola respuesta.

    Returns:
        El recibo, con la hora de ahora.
    """
    ahora = datetime.now(UTC).isoformat()
    peticion = {
        "recurso_sha256": sha(f"https://{fuente}.example/"),
        "url_final_sha256": sha(f"https://{fuente}.example/"),
        "respuesta_sha256": sha(cuerpo),
        "bytes": len(cuerpo),
        "completado_utc": ahora,
    }
    return {
        "version": 1,
        "fuente": fuente,
        "intento": uuid.uuid4().hex,
        "comienzo_utc": ahora,
        "fin_utc": ahora,
        "peticiones": [peticion],
    }


class Descargas:
    """El transporte de un ciclo: por fuente, el cuerpo que recibe, o None si su descarga no deja recibo."""

    def __init__(self, cuerpos: dict[str, str | None]) -> None:
        self.cuerpos = cuerpos

    def __call__(self, orden: Sequence[str], _area: Path) -> actualizar.Resultado:
        """Descarga la fuente de la orden.

        Returns:
            Éxito, con el recibo de la fuente si lo tiene.
        """
        fuente = orden[2].split(".")[-2]
        cuerpo = self.cuerpos[fuente]
        return actualizar.Resultado(0, "", None if cuerpo is None else recibo(fuente, cuerpo))


def ciclo(
    raiz: Path,
    cuerpos: dict[str, str | None],
    validados: dict[str, dict],
    *,
    fallidas: frozenset[str] = frozenset(),
    sin_validados: frozenset[str] = frozenset(),
) -> None:
    """Un ciclo: descarga las fuentes de `cuerpos` con seguimiento y deja validados de todas las fuentes.

    Como una generación real, cada fuente tiene su carpeta de validados: la de `validados` o una fija, salvo las de
    `sin_validados`. Las de `fallidas` descargan pero su módulo no se admite (conserva su versión anterior).
    """
    raiz.mkdir(parents=True, exist_ok=True)
    for modulo in MODULOS:
        for fuente in (fuente for fuente in modulo.fuentes if fuente not in sin_validados):
            carpeta = raiz / carpetas(POR_ID[modulo.id])[2]
            carpeta.mkdir(parents=True, exist_ok=True)
            documento = validados.get(fuente, {"vigente": True})
            (carpeta / "validacion.json").write_text(json.dumps(documento), encoding="utf-8")
    comprobaciones_remotas.migrar_registro(raiz)
    identificador = comprobaciones_remotas.iniciar_ciclo(raiz, datetime.now(UTC), "manual")
    seguimiento = Seguimiento(raiz, identificador, Descargas(cuerpos), lambda: datetime.now(UTC))
    for fuente in cuerpos:
        seguimiento.ejecutar(actualizar.ordenes_de_la_fuente(fuente)[0].orden, raiz)
        admitido = ResultadoDelModulo(AMBAR if fuente in fallidas else VERDE)
        seguimiento.terminar_modulo(POR_ID[fuente], admitido)


class PruebaCompararCiclos(unittest.TestCase):
    """Igual, difiere justificado, difiere sin justificar, sin evidencia y pausas."""

    def setUp(self) -> None:
        """Dos raíces, una por ciclo."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.a, self.b = Path(temporal.name) / "serie", Path(temporal.name) / "paralelo"

    def veredictos(self) -> dict[str, str]:
        """Compara los dos ciclos.

        Returns:
            El veredicto de cada fuente.
        """
        return {fila.fuente: fila.veredicto for fila in comparar_ciclos.comparar_fuentes(self.a, self.b)}

    def test_cada_fuente_recibe_su_veredicto_por_lo_validado_y_lo_descargado(self) -> None:
        """Igual, justificado, sin justificar y sin evidencia, en cuatro fuentes con red."""
        ciclo(
            self.a,
            {"citilab": "fichas", "consorci": "cursos", "fundae": "ediciones", "tich": None},
            {
                "citilab": {"n": 1, "comprobado_utc": "2026-11-24T03:00:00+00:00"},
                "consorci": {"n": 1},
                "fundae": {"n": 1},
                "tich": {"n": 1},
            },
        )
        ciclo(
            self.b,
            {"citilab": "fichas", "consorci": "cursos nuevos", "fundae": "ediciones", "tich": None},
            {
                "citilab": {"n": 1, "comprobado_utc": "2026-11-24T04:00:00+00:00"},  # solo cambia la hora del ciclo
                "consorci": {"n": 2},
                "fundae": {"n": 2},
                "tich": {"n": 1},
            },
        )
        veredictos = self.veredictos()
        self.assertEqual(veredictos["citilab"], comparar_ciclos.IGUAL)
        self.assertEqual(veredictos["consorci"], comparar_ciclos.JUSTIFICADO)
        self.assertEqual(veredictos["fundae"], comparar_ciclos.SIN_JUSTIFICAR)
        # tich descargó sin dejar huella de lo recibido: aunque lo validado coincida, no cuenta como igual.
        self.assertEqual(veredictos["tich"], comparar_ciclos.SIN_EVIDENCIA)
        # Las que no descargaron en ninguno de los dos ciclos y no cambian no dicen nada del paralelo.
        self.assertEqual(veredictos["esco"], comparar_ciclos.SIN_DESCARGA)
        with redirect_stdout(io.StringIO()):
            self.assertEqual(comparar_ciclos.main([str(self.a), str(self.b)]), 1)

    def test_sin_descarga_en_los_dos_no_es_igual_y_si_lo_validado_difiere_no_se_justifica(self) -> None:
        """Ninguno descargó: con lo validado igual, «sin-descarga» aparte; si difiere, «difiere-sin-justificar»."""
        ciclo(self.a, {"citilab": "fichas"}, {"citilab": {"n": 1}, "esco": {"n": 1}})
        ciclo(self.b, {"citilab": "fichas"}, {"citilab": {"n": 1}, "esco": {"n": 2}})
        veredictos = self.veredictos()
        self.assertEqual(veredictos["esco"], comparar_ciclos.SIN_JUSTIFICAR)
        self.assertEqual(veredictos["oit"], comparar_ciclos.SIN_DESCARGA)
        salida = io.StringIO()
        with redirect_stdout(salida):
            self.assertEqual(comparar_ciclos.main([str(self.a), str(self.b)]), 1)
        self.assertIn("1 de 2 fuentes juzgadas conformes", salida.getvalue())
        self.assertIn("Sin descarga en los dos ciclos y con lo validado igual: ", salida.getvalue())

    def test_una_descarga_fallida_o_de_un_solo_ciclo_no_da_igual(self) -> None:
        """Citilab falla en B (conserva lo anterior) y consorci solo descarga en A: lo validado igual, sin evidencia."""
        ciclo(self.a, {"citilab": "fichas", "consorci": "cursos"}, {})
        ciclo(self.b, {"citilab": "fichas"}, {}, fallidas=frozenset({"citilab"}))
        veredictos = self.veredictos()
        self.assertEqual(veredictos["citilab"], comparar_ciclos.SIN_EVIDENCIA)
        self.assertEqual(veredictos["consorci"], comparar_ciclos.SIN_EVIDENCIA)

    def test_sin_validados_en_los_dos_no_da_igual(self) -> None:
        """Citilab descargó lo mismo en los dos pero ninguno conserva sus validados: sin evidencia."""
        sin = frozenset({"citilab"})
        ciclo(self.a, {"citilab": "fichas"}, {}, sin_validados=sin)
        ciclo(self.b, {"citilab": "fichas"}, {}, sin_validados=sin)
        self.assertEqual(self.veredictos()["citilab"], comparar_ciclos.SIN_EVIDENCIA)

    def test_la_huella_se_lee_del_diario_archivado_cuando_la_raiz_es_una_generacion(self) -> None:
        """Sin intentos en la raíz (una generación), la huella sale del diario; sin diario, no hay evidencia."""
        ciclo(self.a, {"citilab": "fichas", "consorci": "cursos"}, {"citilab": {"n": 1}, "consorci": {"n": 1}})
        ciclo(self.b, {"citilab": "fichas", "consorci": "otros"}, {"citilab": {"n": 1}, "consorci": {"n": 2}})
        diarios = []
        for raiz in (self.a, self.b):
            ruta = raiz.parent / f"diario-{raiz.name}.jsonl"
            with diario.abrir(ruta, {"run": "1"}, consola=False):
                diario.registrar_intentos(raiz)
            shutil.rmtree(raiz / CARPETA_DE_INFORMES / CARPETA_DE_INTENTOS)  # una generación no los lleva
            diarios.append(ruta)
        con_diario = comparar_ciclos.comparar_fuentes(
            comparar_ciclos.leer_ciclo(self.a, diarios[0]), comparar_ciclos.leer_ciclo(self.b, diarios[1])
        )
        veredictos = {fila.fuente: fila.veredicto for fila in con_diario}
        self.assertEqual(veredictos["citilab"], comparar_ciclos.IGUAL)
        self.assertEqual(veredictos["consorci"], comparar_ciclos.JUSTIFICADO)
        self.assertEqual(self.veredictos()["citilab"], comparar_ciclos.SIN_EVIDENCIA)
        argumentos = [str(self.a), str(self.b), "--eventos-a", str(diarios[0]), "--eventos-b", str(diarios[1])]
        with redirect_stdout(io.StringIO()):
            self.assertEqual(comparar_ciclos.main(argumentos), 0)

    def test_sin_diferencias_sin_justificar_ni_falta_de_evidencia_la_orden_acepta(self) -> None:
        """Lo igual y lo justificado, sin pausas incumplidas, terminan con 0."""
        ciclo(self.a, {"citilab": "fichas", "consorci": "cursos"}, {"citilab": {"n": 1}, "consorci": {"n": 1}})
        ciclo(self.b, {"citilab": "fichas", "consorci": "otros"}, {"citilab": {"n": 1}, "consorci": {"n": 2}})
        salida = io.StringIO()
        with redirect_stdout(salida):
            self.assertEqual(comparar_ciclos.main([str(self.a), str(self.b)]), 0)
        self.assertIn("consorci             difiere-justificado", salida.getvalue())

    def test_una_fuente_en_serie_en_los_dos_ciclos_no_se_juzga(self) -> None:
        """Fundae sin huella y con lo validado distinto: marcada, «en-serie» y salida 0; sin marcar, «sin-evidencia»."""
        ciclo(
            self.a,
            {"citilab": "fichas", "consorci": "cursos", "fundae": None},
            {"citilab": {"n": 1}, "consorci": {"n": 1}, "fundae": {"n": 1}},
        )
        ciclo(
            self.b,
            {"citilab": "fichas", "consorci": "otros", "fundae": None},
            {"citilab": {"n": 1}, "consorci": {"n": 2}, "fundae": {"n": 2}},
        )
        marcada = {
            fila.fuente: fila.veredicto
            for fila in comparar_ciclos.comparar_fuentes(self.a, self.b, frozenset({"fundae"}))
        }
        self.assertEqual(marcada["fundae"], comparar_ciclos.EN_SERIE)
        self.assertEqual(marcada["consorci"], comparar_ciclos.JUSTIFICADO)
        salida = io.StringIO()
        with redirect_stdout(salida):
            self.assertEqual(comparar_ciclos.main([str(self.a), str(self.b), "--en-serie-en-b", "fundae"]), 0)
        self.assertIn("En serie en los dos ciclos, sin juzgar el paralelo: fundae.", salida.getvalue())
        self.assertEqual(self.veredictos()["fundae"], comparar_ciclos.SIN_EVIDENCIA)
        with redirect_stdout(io.StringIO()):
            self.assertEqual(comparar_ciclos.main([str(self.a), str(self.b)]), 1)
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            comparar_ciclos.main([str(self.a), str(self.b), "--en-serie-en-b", "fundae,inventada"])

    def test_la_huella_de_lo_descargado_no_depende_de_la_hora_ni_del_orden(self) -> None:
        """El mismo cuerpo a otra hora y las mismas respuestas en otro orden dan la misma huella."""
        primero, segundo = recibo("fundae", "a"), recibo("fundae", "a")
        self.assertNotEqual(primero["fin_utc"] + primero["intento"], segundo["fin_utc"] + segundo["intento"])
        otro = recibo("fundae", "b")
        juntos = {**primero, "peticiones": [*primero["peticiones"], *otro["peticiones"]]}
        al_reves = {**primero, "peticiones": [*otro["peticiones"], *primero["peticiones"]]}
        huella = huellas_de_lo_descargado.huella_de_la_recepcion
        self.assertEqual(huella(primero), huella(segundo))
        self.assertEqual(huella(juntos), huella(al_reves))
        self.assertNotEqual(huella(primero), huella(otro))

    def test_las_pausas_se_comprueban_por_servidor_declarado_con_los_eventos(self) -> None:
        """Las fuentes epa y eaes comparten servidor del INE: a 1 s se incumple; a 3 s, no. Otro servidor no cuenta."""

        def evento(fuente: str, inicio: str, fin: str) -> str:
            datos = {"fase": "etapa-fuente", "estado": "terminado", "fuente": fuente, "etapa": "descargar"}
            return "candidato\tpaso\t2026-11-24T03:00:00Z " + json.dumps({**datos, "inicio": inicio, "fin": fin})

        cerca = [
            evento("epa", "2026-11-24T03:00:00+00:00", "2026-11-24T03:00:10+00:00"),
            evento("eaes", "2026-11-24T03:00:11+00:00", "2026-11-24T03:00:20+00:00"),
            evento("citilab", "2026-11-24T03:00:00+00:00", "2026-11-24T03:00:30+00:00"),
            "una línea cualquiera del registro",
        ]
        lejos = [cerca[0], evento("eaes", "2026-11-24T03:00:13+00:00", "2026-11-24T03:00:20+00:00")]
        incumplidas = list(comparar_ciclos.pausas_incumplidas(comparar_ciclos.descargas_de_los_eventos(cerca)))
        self.assertEqual(incumplidas, ["servicios.ine.es: epa → eaes a 1.000 s"])
        self.assertEqual(list(comparar_ciclos.pausas_incumplidas(comparar_ciclos.descargas_de_los_eventos(lejos))), [])
        ciclo(self.a, {}, {})
        ciclo(self.b, {}, {})
        registro = self.a.parent / "registro.log"
        registro.write_text("\n".join(cerca) + "\n", encoding="utf-8")
        with redirect_stdout(io.StringIO()):
            self.assertEqual(comparar_ciclos.main([str(self.a), str(self.b), "--eventos-b", str(registro)]), 1)


if __name__ == "__main__":
    unittest.main()
