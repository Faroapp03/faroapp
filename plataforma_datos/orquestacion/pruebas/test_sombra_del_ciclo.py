"""El ciclo aplica en sombra la regla de retirada a las lecturas de las fuentes y guarda sus decisiones, sin red."""

import contextlib
import hashlib
import io
import itertools
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from plataforma_datos.cursos.altas_en_sombra import ALTAS
from plataforma_datos.cursos.catalogo_servido import unidades_servidas
from plataforma_datos.cursos.decisiones_en_sombra import Alta, comparar_con_produccion, ruta_de_la_comparacion
from plataforma_datos.cursos.decisiones_retirada import cargar_registro
from plataforma_datos.cursos.lectura_error_de_retirada import medir_error_guardado
from plataforma_datos.cursos.lecturas.almacen_lecturas import listar_lecturas
from plataforma_datos.cursos.lecturas.emision import Censo, emitir_lectura
from plataforma_datos.cursos.pruebas.test_lectura_cibernarium import Instalacion, actividad
from plataforma_datos.cursos.publicar_catalogo import RUTA_REFERENCIA
from plataforma_datos.cursos.retirada_por_evidencia import Decision, regla_de_retirada
from plataforma_datos.orquestacion import diario_mantenimiento, notas_de_la_sombra, sombra_del_ciclo
from plataforma_datos.orquestacion.activacion_en_el_ciclo import Transporte
from plataforma_datos.orquestacion.sombra_del_ciclo import TOPE_DE_LA_DECISION_S, decidir_en_sombra, en_sombra, foto

EDICIONES = "cibernarium:edicion"
PASADO = "Sat Nov 14 12:00:00 CET 2026"
HOY = "2026-11-15T05:00:10Z"
MANANA = "2026-11-16T05:00:10Z"
SOLO_EDICIONES = (ALTAS[0],)


def servir(raiz: Path, unidades: list[str]) -> None:
    """Sirve un catálogo de cursos con esas unidades, con su referencia como la escribe `publicar_catalogo`."""
    cuerpo = json.dumps({"ofertas": [{"unidad": {"id": unidad}} for unidad in unidades]}).encode()
    huella = hashlib.sha256(cuerpo).hexdigest()
    ruta = f"datos/catalogo-cursos/{huella}.json"
    (raiz / "web" / ruta).parent.mkdir(parents=True, exist_ok=True)
    (raiz / "web" / ruta).write_bytes(cuerpo)
    (raiz / "web" / RUTA_REFERENCIA).parent.mkdir(parents=True, exist_ok=True)
    referencia = f"export const REFERENCIA = Object.freeze({{\n  ruta: '{ruta}',\n  sha256: '{huella}',\n}});\n"
    (raiz / "web" / RUTA_REFERENCIA).write_text(referencia)


def ediciones(*ids: int) -> list[str]:
    """Las unidades servidas de esas ediciones de Cibernàrium.

    Returns:
        Sus identificadores.
    """
    return [f"cibernarium-edicion:{i}" for i in ids]


def ciclo(
    sitio: Instalacion,
    actividades: list[dict],
    hora: str,
    altas: tuple[Alta, ...] = ALTAS,
    *,
    despues: list[str] | None = None,
) -> list[notas_de_la_sombra.Nota]:
    """Un ciclo: foto, adquisición de Cibernàrium, lo que producción sirve después y la decisión en sombra.

    Returns:
        Las notas de la sombra.
    """
    antes = foto(sitio.raiz, altas)
    sitio.ciclo(actividades, hora)
    if despues is not None:
        servir(sitio.raiz, despues)
    with contextlib.redirect_stdout(io.StringIO()):
        return decidir_en_sombra(sitio.raiz, antes, altas)


def arbol(raiz: Path) -> dict[str, str]:
    """La huella de cada archivo de la instalación.

    Returns:
        Ruta relativa y huella.
    """
    return {
        ruta.relative_to(raiz).as_posix(): hashlib.sha256(ruta.read_bytes()).hexdigest()
        for ruta in sorted(raiz.rglob("*"))
        if ruta.is_file()
    }


def registro(sitio: Instalacion, ambito: str = EDICIONES, fuente: str = "barcelonactiva") -> dict:
    """El registro de decisiones de la última lectura del ámbito.

    Returns:
        El registro guardado.
    """
    ultima = next(x for x in reversed(listar_lecturas(sitio.raiz, fuente)) if x["ambito"] == ambito)
    return cargar_registro(sitio.raiz, fuente, ultima["lectura_id"])


class DecideEnSombra(unittest.TestCase):
    """Dos ciclos seguidos dejan sus lecturas y un registro de decisiones por lectura."""

    def test_dos_ciclos_dejan_un_registro_por_lectura_y_el_fin_pasado_retira(self) -> None:
        """El fin publicado ya pasado retira por la fuente; la edición ausente sin más queda pendiente."""
        sitio = Instalacion(self)
        servir(sitio.raiz, ediciones(1, 2, 3))
        primero = ciclo(sitio, [actividad(1), actividad(2), actividad(3, fin=PASADO)], HOY)
        self.assertEqual((primero[0].estado, primero[0].ambito), ("decidida", EDICIONES))
        self.assertEqual((primero[1].estado, primero[1].motivo), ("saltada", "no-publica"))
        primer = registro(sitio)
        self.assertEqual([(d["curso"], d["decision"]) for d in primer["decisiones"]], [(ediciones(3)[0], "retirar")])
        self.assertEqual(primer["decisiones"][0]["evidencias"][0]["canal"], "fin_publicado")
        ciclo(sitio, [actividad(2), actividad(3, fin=PASADO)], MANANA)
        decisiones = {d["curso"]: d for d in registro(sitio)["decisiones"]}
        self.assertEqual(decisiones[ediciones(1)[0]]["decision"], "pendiente")
        self.assertEqual([e["canal"] for e in decisiones[ediciones(1)[0]]["evidencias"]], ["ausencia"])
        self.assertEqual(decisiones[ediciones(3)[0]]["decision"], "retirar")
        self.assertEqual(registro(sitio)["mantenidas"], 1)

    def test_una_fuente_que_no_afirma_nada_se_decide_con_el_censo(self) -> None:
        """Sin lector de declaraciones no se salta: la ausencia queda pendiente y el fin, sin declarar, no retira."""
        sin_declaraciones = (Alta(fuente="barcelonactiva", ambito=EDICIONES, prefijo="cibernarium-edicion:"),)
        sitio = Instalacion(self)
        servir(sitio.raiz, ediciones(1, 2))
        ciclo(sitio, [actividad(1), actividad(2, fin=PASADO)], HOY, sin_declaraciones)
        nota, comprobada = ciclo(sitio, [actividad(2, fin=PASADO)], MANANA, sin_declaraciones)
        self.assertEqual(nota.estado, "decidida")
        self.assertEqual((comprobada.estado, comprobada.fuente), ("comprobada", "barcelonactiva"))
        self.assertEqual(
            [(d["curso"], d["decision"]) for d in registro(sitio)["decisiones"]], [(ediciones(1)[0], "pendiente")]
        )

    def test_solo_escribe_sus_registros_y_lo_publicado_no_cambia(self) -> None:
        """Con el paso y sin él, el resto de la instalación, catálogo servido incluido, queda idéntico byte a byte."""
        con, sin = Instalacion(self), Instalacion(self)
        for sitio in (con, sin):
            servir(sitio.raiz, ediciones(1))
        ciclo(con, [actividad(1)], HOY)
        sin.ciclo([actividad(1)], HOY)
        carpetas = ("decisiones", "sombra", "retirada")
        propias = tuple(f"var/actualizacion/validados/barcelonactiva/{c}/" for c in carpetas)
        arbol_con = {r: h for r, h in arbol(con.raiz).items() if not r.startswith(propias)}
        self.assertEqual(len(arbol(con.raiz)) - len(arbol_con), 3)
        self.assertEqual(arbol_con, {r: h for r, h in arbol(sin.raiz).items() if r in arbol_con})
        self.assertEqual(arbol_con.keys(), arbol(sin.raiz).keys())

    def test_una_fuente_que_falla_no_detiene_las_demas_y_sin_lectura_se_salta(self) -> None:
        """Un lector que falla se anota con su tipo y el siguiente ámbito se decide; HP LIFE, sin lectura, se salta."""

        def falla(_raiz: Path, _lectura: dict) -> dict:
            raise ValueError("captura ilegible")

        rota = Alta(fuente="barcelonactiva", ambito="cibernarium:programa", prefijo="cibernarium:", declaraciones=falla)
        sitio = Instalacion(self)
        notas = ciclo(sitio, [actividad(1)], HOY, (rota, ALTAS[0], ALTAS[-2]))
        self.assertEqual([(n.estado, n.motivo, n.tipo) for n in notas[:1]], [("problema", "fallo", "ValueError")])
        self.assertEqual(notas[1].estado, "decidida")
        self.assertEqual((notas[2].ambito, notas[2].motivo), ("hp_life:curso", "sin-lectura-nueva"))

    def test_la_decision_que_no_cabe_en_su_tope_salta_lo_que_falta(self) -> None:
        """Pasado el tope, cada ámbito que falta se anota «saltada» con «sin-tiempo» y la decisión termina."""
        sitio = Instalacion(self)
        antes = foto(sitio.raiz, ALTAS)
        sitio.ciclo([actividad(1)], HOY)
        # El reloj marca el inicio (0) y luego cada consulta antes de un ámbito: el primero cabe, el resto no.
        horas = itertools.chain([0.0, 0.0], itertools.repeat(float(TOPE_DE_LA_DECISION_S)))
        sin_red = Transporte(
            pedir=Mock(side_effect=AssertionError("la prueba no pide páginas")),
            reloj=lambda: next(horas),
            instante=lambda: "2026-11-23T05:00:00Z",
        )
        with contextlib.redirect_stdout(io.StringIO()):
            notas = decidir_en_sombra(sitio.raiz, antes, ALTAS, sin_red)
        de_ambito = [n for n in notas if n.ambito is not None]
        self.assertEqual(de_ambito[0].estado, "decidida")
        self.assertEqual({(n.estado, n.motivo) for n in de_ambito[1:]}, {("saltada", "sin-tiempo")})
        self.assertEqual([n.ambito for n in de_ambito], [alta.ambito for alta in ALTAS])

    def test_una_fuente_sin_version_admitida_no_escribe_en_su_carpeta(self) -> None:
        """La generación solo admite lecturas en la carpeta validada de una fuente sin versión: se salta diciéndolo."""
        sitio = Instalacion(self)
        hp = next(alta for alta in ALTAS if alta.fuente == "hp_life")
        antes = foto(sitio.raiz, (hp,))
        censo = Censo(
            fuente="hp_life",
            ambito="hp_life:curso",
            observado_utc=HOY,
            completa=True,
            ids=frozenset({"hp-life:1:es"}),
            recuento_bruto=1,
            recuento_vigente=1,
            rutas_de_campos=("programa.id",),
            explicar_salida=lambda _id: None,
        )
        emitir_lectura(sitio.raiz, censo)
        with contextlib.redirect_stdout(io.StringIO()):
            (nota,) = decidir_en_sombra(sitio.raiz, antes, (hp,))
        self.assertEqual((nota.estado, nota.motivo), ("saltada", "sin-version-admitida"))
        self.assertEqual(
            sorted(p.name for p in (sitio.raiz / "var/actualizacion/validados/hp_life").iterdir()), ["lecturas"]
        )

    def test_la_medida_del_error_lee_lo_guardado_sin_contar_dos_veces(self) -> None:
        """Un fin pasado que la fuente sigue listando sale «retirar» dos días: es una sola retirada, comprobable."""
        sitio = Instalacion(self)
        servir(sitio.raiz, ediciones(1, 2))
        ciclo(sitio, [actividad(1), actividad(2, fin=PASADO)], HOY)
        ciclo(sitio, [actividad(1), actividad(2, fin=PASADO)], MANANA)
        fila = {f["fuente"]: f for f in medir_error_guardado(sitio.raiz)}["barcelonactiva"]
        self.assertEqual(
            (fila["retiradas"], fila["con_lectura_posterior"], fila["naturaleza"]), (1, 1, "limite_inferior")
        )


class ComparacionConProduccion(unittest.TestCase):
    """La comparación cuenta las retiradas de producción y las que solo haría la regla."""

    def test_cuenta_bien_en_un_caso_construido(self) -> None:
        """Producción retira a, b y c; la regla retira a, deja b pendiente, mantiene c y retiraría d, aún publicado."""
        regla = regla_de_retirada()
        decisiones = [
            Decision(curso=c, decision=d, evidencias=(), regla=regla)
            for c, d in (("a", "retirar"), ("b", "pendiente"), ("c", "mantener"), ("d", "retirar"), ("e", "mantener"))
        ]
        self.assertEqual(
            comparar_con_produccion(decisiones, frozenset("abcde"), frozenset("de")),
            {
                "produccion_retira": 3,
                "la_regla_en_esas": {"retirar": 1, "pendiente": 1, "mantener": 1},
                "retiradas_por_produccion": ["a", "b", "c"],
                "la_regla_retira_y_produccion_mantiene": 1,
                "solo_la_regla_retira": ["d"],
            },
        )

    def test_el_ciclo_compara_con_lo_que_dejo_de_servirse(self) -> None:
        """Producción deja de servir la edición 1, que la regla deja pendiente, y sirve la 3, que la regla retira."""
        sitio = Instalacion(self)
        servir(sitio.raiz, ediciones(1, 2, 3))
        ciclo(sitio, [actividad(1), actividad(2), actividad(3, fin=PASADO)], HOY, SOLO_EDICIONES)
        nota, comprobada = ciclo(
            sitio, [actividad(2), actividad(3, fin=PASADO)], MANANA, SOLO_EDICIONES, despues=ediciones(2, 3)
        )
        self.assertEqual((nota.produccion_retira, nota.solo_la_regla_retira), (1, 1))
        # La edición 3 se retiraría, pero su oferta no publica página: no se pide nada y queda sin comprobar.
        self.assertEqual((comprobada.estado, comprobada.sin_comprobar, comprobada.confirman), ("comprobada", 1, 0))
        lectura_id = registro(sitio)["lectura_id"]
        guardada = json.loads(ruta_de_la_comparacion(sitio.raiz, "barcelonactiva", lectura_id).read_bytes())
        self.assertEqual(guardada["retiradas_por_produccion"], ediciones(1))
        self.assertEqual(guardada["la_regla_en_esas"], {"retirar": 0, "pendiente": 1, "mantener": 0})
        self.assertEqual(guardada["solo_la_regla_retira"], ediciones(3))
        self.assertTrue(guardada["con_declaraciones"])

    def test_el_catalogo_servido_exige_la_huella_de_su_referencia(self) -> None:
        """Un catálogo que no es el que fija su referencia no se lee como servido."""
        sitio = Instalacion(self)
        servir(sitio.raiz, ediciones(1))
        self.assertEqual(unidades_servidas(sitio.raiz), frozenset(ediciones(1)))
        (catalogo,) = (sitio.raiz / "web/datos/catalogo-cursos").iterdir()
        catalogo.write_bytes(b'{"ofertas": []}')
        with self.assertRaises(ValueError):
            unidades_servidas(sitio.raiz)


class LaFronteraNoDejaPasarNada(unittest.TestCase):
    """Un error inesperado en la foto o en la decisión no cambia el ciclo: queda anotado y devuelve lo mismo."""

    def _envolver(self, raiz: Path) -> str:
        with contextlib.redirect_stdout(io.StringIO()), en_sombra(raiz, ensayo=False):
            return "resultado del ciclo"

    def test_un_error_inesperado_en_la_foto(self) -> None:
        """Un `KeyError` en la foto: el ciclo empieza, termina y devuelve lo mismo; la nota dice el tipo."""
        with (
            tempfile.TemporaryDirectory() as carpeta,
            patch.object(sombra_del_ciclo, "foto", side_effect=KeyError("x")),
        ):
            self.assertEqual(self._envolver(Path(carpeta)), "resultado del ciclo")
            notas = notas_de_la_sombra.leer(Path(carpeta))
        self.assertEqual([(n.estado, n.tipo) for n in notas], [("problema", "KeyError")])

    def test_un_error_inesperado_en_la_decision(self) -> None:
        """Un `TypeError` al decidir, con el paquete ya publicado: el ciclo devuelve lo mismo y queda anotado."""
        with (
            tempfile.TemporaryDirectory() as carpeta,
            patch.object(sombra_del_ciclo, "decidir_en_sombra", side_effect=TypeError("forma")),
        ):
            self.assertEqual(self._envolver(Path(carpeta)), "resultado del ciclo")
            notas = notas_de_la_sombra.leer(Path(carpeta))
        self.assertEqual([(n.estado, n.tipo) for n in notas], [("problema", "TypeError")])

    def test_un_error_con_un_nombre_fuera_de_la_forma_de_la_nota(self) -> None:
        """Una clase con tilde no hace fallar la nota dentro de la frontera: se anota con su base y el ciclo sigue."""
        error = type("ErrorDeCatálogo", (KeyError,), {})("x")
        for paso in ("foto", "decidir_en_sombra"):
            with (
                self.subTest(paso=paso),
                tempfile.TemporaryDirectory() as carpeta,
                patch.object(sombra_del_ciclo, "foto", return_value=sombra_del_ciclo.Foto(lecturas={}, servidas=None)),
                patch.object(sombra_del_ciclo, paso, side_effect=error),
            ):
                self.assertEqual(self._envolver(Path(carpeta)), "resultado del ciclo")
                notas = notas_de_la_sombra.leer(Path(carpeta))
            self.assertEqual([(n.estado, n.motivo, n.tipo) for n in notas], [("problema", "fallo", "KeyError")])

    def test_un_ciclo_que_se_corta_lo_dice_y_su_error_sigue_su_camino(self) -> None:
        """La excepción del ciclo no es de la sombra: sale igual, y la nota ya no se queda en «en-curso»."""
        with tempfile.TemporaryDirectory() as carpeta:
            with (
                self.assertRaises(RuntimeError),
                contextlib.redirect_stdout(io.StringIO()),
                en_sombra(Path(carpeta), ensayo=False),
            ):
                Mock(side_effect=RuntimeError("del ciclo"))()
            notas = notas_de_la_sombra.leer(Path(carpeta))
        self.assertEqual([(n.estado, n.motivo) for n in notas], [("saltada", "ciclo-cortado")])

    def test_un_ensayo_no_escribe_nada(self) -> None:
        """Un ensayo no toma foto, no decide y no deja notas."""
        with tempfile.TemporaryDirectory() as carpeta:
            with en_sombra(Path(carpeta), ensayo=True):
                pass
            self.assertEqual(list(Path(carpeta).iterdir()), [])


class LasNotasLleganAlDiario(unittest.TestCase):
    """El supervisor copia al diario las notas del ciclo, en su forma cerrada."""

    def test_registrar_intentos_anota_la_sombra(self) -> None:
        """Tras el motor, cada nota es una línea del diario con su fase, su estado y su ámbito."""
        sitio = Instalacion(self)
        servir(sitio.raiz, ediciones(1))
        with contextlib.redirect_stdout(io.StringIO()), en_sombra(sitio.raiz, ensayo=False):
            sitio.ciclo([actividad(1)], HOY)
        ruta = sitio.raiz / "diario.jsonl"
        with diario_mantenimiento.abrir(ruta, {"run": "1"}, consola=False):
            diario_mantenimiento.registrar_intentos(sitio.raiz)
        lineas = [json.loads(linea) for linea in ruta.read_text().splitlines()]
        sombra = [(x["estado"], x.get("ambito"), x.get("motivo")) for x in lineas if x["fase"] == "retirada-en-sombra"]
        self.assertEqual(sombra[0], ("decidida", EDICIONES, None))
        self.assertIn(("saltada", "cibernarium:programa", "no-publica"), sombra)

    def test_el_cambio_de_modo_de_una_fuente_llega_al_diario(self) -> None:
        """La activación y la vuelta a sombra son líneas del diario con su fuente y, la activación, con su cifra."""
        notas = [
            notas_de_la_sombra.Nota(estado="activada", fuente="barcelonactiva", confirman=30),
            notas_de_la_sombra.Nota(estado="vuelta-a-sombra", fuente="hp_life"),
        ]
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            notas_de_la_sombra.guardar(raiz, notas)
            with diario_mantenimiento.abrir(raiz / "diario.jsonl", {"run": "1"}, consola=False):
                diario_mantenimiento.registrar_intentos(raiz)
            lineas = [json.loads(x) for x in (raiz / "diario.jsonl").read_text().splitlines()]
        cambios = [(x["estado"], x["fuente"], x.get("confirman")) for x in lineas if x["fase"] == "retirada-en-sombra"]
        self.assertEqual(cambios, [("activada", "barcelonactiva", 30), ("vuelta-a-sombra", "hp_life", None)])

    def test_unas_notas_ilegibles_no_detienen_al_supervisor(self) -> None:
        """Si el archivo de notas no tiene su forma, se anota como problema y el registro sigue."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            (raiz / notas_de_la_sombra.ARCHIVO).parent.mkdir(parents=True)
            (raiz / notas_de_la_sombra.ARCHIVO).write_text('[{"estado": "otro"}]')
            with diario_mantenimiento.abrir(raiz / "diario.jsonl", {"run": "1"}, consola=False):
                diario_mantenimiento.registrar_intentos(raiz)
            (linea,) = [json.loads(x) for x in (raiz / "diario.jsonl").read_text().splitlines()]
        self.assertEqual(
            (linea["fase"], linea["estado"], linea["motivo"]), ("retirada-en-sombra", "problema", "notas-ilegibles")
        )

    def test_una_nota_que_sigue_en_curso_se_copia_como_ciclo_cortado(self) -> None:
        """El ciclo del 23/11: lo mató el plazo con la nota «en-curso»; el diario dice que el ciclo se cortó."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            notas_de_la_sombra.guardar(raiz, [notas_de_la_sombra.Nota(estado="en-curso")])
            with diario_mantenimiento.abrir(raiz / "diario.jsonl", {"run": "1"}, consola=False):
                diario_mantenimiento.registrar_intentos(raiz)
            (linea,) = [json.loads(x) for x in (raiz / "diario.jsonl").read_text().splitlines()]
        self.assertEqual(
            (linea["fase"], linea["estado"], linea["motivo"]), ("retirada-en-sombra", "saltada", "ciclo-cortado")
        )


if __name__ == "__main__":
    unittest.main()
