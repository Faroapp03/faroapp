"""Lo que la persona ve de los cursos del SOC, del Consorci y de Citilab: las unidades del paquete de datos.

Esas tres fuentes no pasan por el catálogo de cursos (`catalogo_servido`): publican sus cursos en el paquete exportado
(`datos/formacion.json`, `datos/consorci.json` y `datos/citilab.json`). Cada unidad lleva el mismo identificador que
usa la lectura de su fuente:
- SOC: `cursos[].id` es el `identificador_curs` de la oferta, el que usa `formacion.lectura.cursos_de_la_oferta`.
- Consorci: `ediciones[].id` es `accion-grupo-inicio-fin-letra`, el que construye `consorci.filas_publicadas`.
- Citilab: `cursos[].id` es el `id` de la ficha, que la lectura escribe como texto.

«Publicado» es lo exportado y vigente. El SOC y el Consorci ocultan el curso cuyo fin ya pasó
(`motores/cursos/src/formacion.ts:387-389` y `formacion-consorci.ts:122-124`, con `vigencia-cursos.ts:37`: fin < hoy
es terminado), de modo que un curso exportado con el fin pasado no lo ve nadie. Citilab no oculta ninguno: el informe
solo filtra por coste (`formacion-citilab.ts:142`) y un curso con el fin pasado se ofrece como «para consultar»
(`momentoCitilab`, `formacion-citilab.ts:36-52`), así que allí publicado es todo lo exportado.

Las acciones previstas del Consorci no están: el paquete las agrupa por especialidad y no conserva su identificador
(`conjunto.previstas_por_especialidad`), de modo que no hay unidad que corresponda a un identificador de su lectura.
Solo lee.
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from plataforma_datos.cursos.catalogo_servido import unidades_servidas
from plataforma_datos.cursos.fuentes.citilab import lectura as lectura_citilab
from plataforma_datos.cursos.fuentes.consorci import lectura as lectura_consorci
from plataforma_datos.cursos.fuentes.formacion import lectura as lectura_soc
from plataforma_datos.cursos.tipos_json import ObjetoJson

PAQUETE = "datos"

type Unidades = Mapping[str, str | None]


@dataclass(frozen=True)
class Exportado:
    """Dónde publica el paquete las unidades de un ámbito y si la persona deja de ver las que terminaron."""

    archivo: str
    lista: str
    oculta_las_terminadas: bool


EXPORTADOS: Final[Mapping[str, Exportado]] = {
    lectura_soc.AMBITO: Exportado("formacion.json", "cursos", oculta_las_terminadas=True),
    lectura_consorci.AMBITO_EDICIONES: Exportado("consorci.json", "ediciones", oculta_las_terminadas=True),
    lectura_citilab.AMBITO: Exportado("citilab.json", "cursos", oculta_las_terminadas=False),
}


def unidades_del_paquete(raiz: Path) -> dict[str, Unidades]:
    """Las unidades que exporta el paquete de la instalación, por ámbito, con el fin que publica cada una.

    El fin solo consta donde su paso decide qué ve la persona: en Citilab no oculta nada y se deja a `None`.

    Returns:
        Por ámbito, el identificador de cada unidad y su fin (`AAAA-MM-DD`); vacío si aún no se ha exportado.

    Raises:
        ValueError: Si el paquete no tiene la forma que escribe el exportador.
        OSError: Si el paquete existe y no se puede leer.
    """
    unidades: dict[str, Unidades] = {}
    for ambito, exportado in EXPORTADOS.items():
        ruta = raiz / PAQUETE / exportado.archivo
        if not ruta.is_file():
            unidades[ambito] = {}
            continue
        paquete = _leer(ruta)
        lista = paquete.get(exportado.lista)
        if not isinstance(lista, list) or not all(isinstance(u, dict) and "id" in u for u in lista):
            raise ValueError(f"{ruta.name} no tiene «{exportado.lista}» con identificadores")
        unidades[ambito] = {str(u["id"]): u.get("fin") if exportado.oculta_las_terminadas else None for u in lista}
    return unidades


def _leer(ruta: Path) -> ObjetoJson:
    paquete = json.loads(ruta.read_bytes())
    if not isinstance(paquete, dict):
        raise ValueError(f"{ruta.name} no es un objeto")
    return paquete


@dataclass(frozen=True)
class Publicado:
    """Lo publicado de todas las fuentes en un momento: el catálogo de cursos servido y el paquete de datos."""

    catalogo: frozenset[str]
    paquete: Mapping[str, Unidades]

    def vigentes_del_paquete(self, ambito: str, dia: str) -> frozenset[str]:
        """Las unidades del paquete de un ámbito que la persona ve el día dado.

        Returns:
            Las que no tienen un fin anterior a `dia` (`AAAA-MM-DD`, comparado como texto, que es su orden).
        """
        return frozenset(id for id, fin in self.paquete.get(ambito, {}).items() if fin is None or fin >= dia)


def publicado(raiz: Path) -> Publicado:
    """Lo que la instalación publica ahora: las unidades del catálogo servido y las del paquete.

    Returns:
        Lo publicado; vacío en lo que aún no se ha exportado ni servido.

    Raises:
        ValueError: Si el catálogo o el paquete no tienen la forma o la huella que se espera.
        OSError: Si no se pueden leer.
    """
    return Publicado(catalogo=unidades_servidas(raiz), paquete=unidades_del_paquete(raiz))
