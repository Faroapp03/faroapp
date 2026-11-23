"""Mutaciones de Cibervoluntarios sobre la instalación sin red de cinco materiales y la actividad real del 15/11.

La forma de cada actividad es la de `capturas_ciber_bajas/censo-recorte.json` (respuesta real de la API, véase su
`PROCEDENCIA.md`); los materiales y la instalación son los de `test_ciber_paginas_fallidas`.
"""

import io
import json
from collections.abc import Iterator
from contextlib import contextmanager, redirect_stderr
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos.pruebas import test_ciber_paginas_fallidas as paginas
from plataforma_datos.cursos.pruebas.mutaciones import arnes
from plataforma_datos.cursos.pruebas.test_ciber_bajas import existe
from plataforma_datos.orquestacion.ordenes import con_motivo

ACTIVIDAD_REAL = json.loads(
    (Path(paginas.__file__).with_name("capturas_ciber_bajas") / "censo-recorte.json").read_bytes()
)[0]
# Los campos de la actividad que lee el lector de la fuente (lector.ACTIVIDAD), con su valor real.
CAMPOS_REALES = ("status", "area", "format", "level", "type", "totalDuration", "languages")
# Cinco materiales, uno por página: el 60 % del censo son las tres primeras páginas.
CINCO = {**paginas.PAGINAS, 3: (12, 22, "curso-tres"), 4: (13, 23, "curso-cuatro"), 5: (14, 24, "curso-cinco")}
NORMALES = dict.fromkeys(CINCO, "normal")
UNIDADES = ["cibervoluntarios:material:" + str(m) for _a, m, _s in CINCO.values()]
CORTE = "2026-10-23T20:30:00Z"


class MutacionesCiberPruebas(paginas.InstalacionCiber):
    """Un ciclo sano el 23/10 a las 19:00 y, a las 20:00, el mismo censo con una sola mutación."""

    def setUp(self) -> None:
        """Instala cinco materiales admitidos con la actividad real y los compone en un primer ciclo sano."""
        parche = patch.dict(paginas.PAGINAS, CINCO)
        parche.start()
        self.addCleanup(parche.stop)
        super().setUp()
        with self.cuerpos():
            self.assertTrue(self.consultar_fuente("19:00", NORMALES, total=len(CINCO)))
        self.ofertas = self.componer("2026-10-23T19:30:00Z")
        self.assertEqual(len(self.ofertas), len(CINCO))
        self.antes = self.decisiones("2026-10-23T19:30:00Z")
        self.assertEqual(set(self.antes.values()), {"disponible-publicamente"})

    @contextmanager
    def cuerpos(
        self, actividad: dict[int, dict] | None = None, sin_actividades: frozenset[int] = frozenset()
    ) -> Iterator[None]:
        """Sirve cada página con la actividad real y, si se pide, con su mutación.

        Yields:
            Nada: el parche dura lo que dura el bloque.
        """
        original = paginas._cuerpo_pagina

        def cuerpo(pagina: int, *args: object, **opciones: object) -> bytes:
            documento = json.loads(original(pagina, *args, **opciones))
            miembro = documento["hydra:member"][0]
            miembro.update({campo: ACTIVIDAD_REAL[campo] for campo in CAMPOS_REALES})
            miembro.update((actividad or {}).get(pagina, {}))
            if pagina in sin_actividades:
                documento["hydra:member"] = []
            return json.dumps(documento).encode()

        with patch.object(paginas, "_cuerpo_pagina", cuerpo):
            yield

    def decisiones(self, corte: str) -> dict[str, str]:
        """La decisión de vigencia de cada material en el panel privado.

        Returns:
            Decisión por unidad.
        """
        return {u: f["decision"] for u, f in self.panel(corte).items()}

    def ciclo(self, mutadas: set[str], **mutacion: object) -> arnes.Observado:
        """Consulta la fuente mutada, compone el catálogo y anota lo observado.

        Returns:
            Lo que hizo la cadena real con la mutación.
        """
        total = mutacion.pop("total", len(CINCO))
        servidas = mutacion.pop("servidas", NORMALES)
        recibida: list[bool] = []
        self.errores = io.StringIO()
        # Las etapas de la fuente pasan por la misma salida con motivo que su orden en el ciclo: 0 o 1.
        with self.cuerpos(**mutacion), redirect_stderr(self.errores):
            codigo = con_motivo(
                lambda: recibida.append(self.consultar_fuente("20:00", servidas, total=total, destinos=existe))
            )
        self.componer(CORTE)
        en_verde = codigo == 0 and recibida == [True]
        return arnes.Observado(en_verde, True, self.antes, self.decisiones(CORTE), frozenset(mutadas))

    def test_m2_nivel_desconocido_en_una_actividad_no_toca_ni_a_ella_ni_al_resto(self) -> None:
        """M2: `level: "Experto"` en la primera actividad; el nivel no se emite y nada cambia de estado."""
        mutacion = arnes.Mutacion("M2", "cibervoluntarios", 'level "Básico" → "Experto" en una actividad')
        self.assertEqual(self.ofertas[self.url(UNIDADES[0])]["nivel_actividad"]["valor"], "inicial")
        observado = self.ciclo({UNIDADES[0]}, actividad={1: {"level": "Experto"}})
        self.assertTrue(observado.fuente_en_verde)
        self.assertEqual(arnes.cambiadas(observado), {})
        self.assertEqual(arnes.alcance(observado), arnes.NINGUNO)
        self.assertEqual(arnes.veredicto_del_ciclo(mutacion, observado), "verde")
        # La oferta mutada sigue publicada, sin el nivel que ya no se reconoce; las demás conservan el suyo.
        niveles = {u: (o.get("nivel_actividad") or {}).get("valor") for u, o in self.componer(CORTE).items()}
        self.assertEqual(niveles, {self.url(u): None if u == UNIDADES[0] else "inicial" for u in UNIDADES})

    def test_m5_censo_truncado_al_60_por_ciento_no_retira_los_que_siguen_existiendo(self) -> None:
        """M5: el censo declara y trae tres de cinco; los dos ausentes, con su destino vivo, siguen publicados."""
        mutacion = arnes.Mutacion("M5", "cibervoluntarios", "censo truncado al 60 % (3 de 5), coherente con su total")
        servidas = dict.fromkeys((1, 2, 3), "normal")
        observado = self.ciclo(set(UNIDADES[3:]), total=3, servidas=servidas)
        self.assertTrue(observado.fuente_en_verde)
        # El censo completo no trae dos materiales conocidos: se pide su destino y responde que existe.
        self.assertEqual(len(self.destinos_pedidos), 2)
        self.assertEqual(arnes.cambiadas(observado), {})
        self.assertEqual(arnes.alcance(observado), arnes.NINGUNO)
        self.assertEqual(arnes.veredicto_del_ciclo(mutacion, observado), "verde")
        self.assertEqual(len(self.componer(CORTE)), len(CINCO))

    def test_m6_total_declarado_distinto_del_recuento(self) -> None:
        """M6: el censo declara cinco actividades y la última página llega vacía (recuento, cuatro)."""
        mutacion = arnes.Mutacion("M6", "cibervoluntarios", "hydra:totalItems 5 con 4 actividades servidas")
        validado = fuente.leer_validado("cibervoluntarios", self.raiz)
        observado = self.ciclo({UNIDADES[4]}, sin_actividades=frozenset({5}))
        # La preparación rechaza el censo entero: la fuente conserva su conjunto admitido y nada cambia de estado.
        self.assertFalse(observado.fuente_en_verde)
        self.assertIn("Censo Ciber truncado o con identidades repetidas", self.errores.getvalue())
        self.assertEqual(fuente.leer_validado("cibervoluntarios", self.raiz), validado)
        self.assertEqual(arnes.cambiadas(observado), {})
        self.assertEqual(arnes.alcance(observado), arnes.FUENTE)
        self.assertEqual(arnes.veredicto_del_ciclo(mutacion, observado), "ámbar")
        self.assertEqual(len(self.componer(CORTE)), len(CINCO))
