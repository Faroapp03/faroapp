"""Historias de lecturas de prueba: una cadena de censos calificada lectura a lectura como lo hace la emisión."""

from dataclasses import dataclass, field

from plataforma_datos.cursos.lecturas import contrato_lectura as contrato
from plataforma_datos.cursos.lecturas.cadena import referencia
from plataforma_datos.cursos.lecturas.contrato_lectura import HuellaForma, Salida, huella_de_campos
from plataforma_datos.cursos.lecturas.salud import Observacion, Veredicto, calificar
from plataforma_datos.cursos.tipos_json import ObjetoJson

FUENTE = "formacion"
AMBITO = "soc:curso"
FORMA = HuellaForma(campos_sha256=huella_de_campos(("edicion.id", "edicion.fin")), niveles=("edicion",))


def hora(dia: int, hora_del_dia: int = 6) -> str:
    """La hora de una lectura de noviembre de 2026, el día y la hora dados.

    Returns:
        La hora en UTC al segundo.
    """
    return f"2026-11-{dia:02d}T{hora_del_dia:02d}:00:00Z"


def cursos(desde: int, cuantos: int) -> frozenset[str]:
    """Identificadores de prueba consecutivos.

    Returns:
        Los identificadores `soc:curso:n`.
    """
    return frozenset(f"soc:curso:{n:06d}" for n in range(desde, desde + cuantos))


@dataclass
class Historia:
    """Una cadena de lecturas de un ámbito que se va calificando con la regla real."""

    lecturas: list[ObjetoJson] = field(default_factory=list)
    censo: frozenset[str] = frozenset()
    veredictos: list[Veredicto] = field(default_factory=list)

    def observacion(
        self, instante: str, censo: frozenset[str], *, explicadas: frozenset[str] = frozenset(), completa: bool = True
    ) -> Observacion:
        """Lo observado en una lectura nueva frente a la anterior de la cadena.

        Returns:
            La observación, con sus entradas y sus salidas.
        """
        salen = sorted(self.censo - censo)
        return Observacion(
            fuente=FUENTE,
            ambito=AMBITO,
            anterior=self.lecturas[-1]["lectura_id"] if self.lecturas else None,
            observado_utc=instante,
            completa=completa,
            motivo_incompleta=None if completa else "consulta_fallida",
            recuento_bruto=len(censo),
            recuento_vigente=len(censo),
            ids_sha256=contrato.huella_de_ids(censo),
            entradas=tuple(sorted(censo - self.censo)),
            salidas=tuple(Salida(id=c, explicada_por="fin_publicado" if c in explicadas else None) for c in salen),
            huella_forma=FORMA,
        )

    def calificar(self, observacion: Observacion) -> Veredicto:
        """El veredicto de la regla con la referencia y las lecturas previas, sin guardar nada.

        Returns:
            El veredicto.
        """
        return calificar(observacion, referencia(self.lecturas, set()), previas=self.lecturas)

    def leer(
        self, instante: str, censo: frozenset[str], *, explicadas: frozenset[str] = frozenset(), completa: bool = True
    ) -> ObjetoJson:
        """Califica y añade a la cadena una lectura nueva.

        Returns:
            La lectura guardada, en JSON.
        """
        observacion = self.observacion(instante, censo, explicadas=explicadas, completa=completa)
        veredicto = self.calificar(observacion)
        dato = observacion.lectura(veredicto).a_json()
        self.lecturas.append(dato)
        self.veredictos.append(veredicto)
        self.censo = censo
        return dato


def historia_diaria(dias: int, *, bruto: int = 500, salen_al_dia: int = 5) -> Historia:
    """Una fuente que cada día pierde sin explicar `salen_al_dia` cursos y recibe otros tantos nuevos.

    Returns:
        La historia con una lectura por día, del 1 de noviembre en adelante.
    """
    historia = Historia()
    censo = cursos(0, bruto)
    siguiente = bruto
    historia.leer(hora(1), censo)
    for dia in range(2, dias + 1):
        salen = set(sorted(censo)[:salen_al_dia])
        censo = (censo - salen) | cursos(siguiente, salen_al_dia)
        siguiente += salen_al_dia
        historia.leer(hora(dia), censo)
    return historia
