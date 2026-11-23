"""Comprobaciones compartidas de los descriptores frente a sus referencias congeladas y al registro activo."""

import hashlib
import json
from collections.abc import Iterable, Mapping
from pathlib import Path
from unittest import TestCase

from plataforma_datos.contratos import fuentes
from plataforma_datos.contratos.fuentes import DescriptorFuente, PoliticaActualizacion
from plataforma_datos.orquestacion import modulos
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS

REFERENCIAS = Path(fuentes.__file__).parent / "pruebas"
# Cada referencia es independiente de las fichas que vigila y se fija por su huella: regenerarla desde los
# descriptores la convertiría en una copia de lo que se prueba, y la huella lo hace visible.
HUELLAS_DE_REFERENCIA = {
    "operacion-cursos-v1.json": "34a47eeca4c60c9c6e09672bc37857640a6dd5a5e907457801aaf35f19dec5a8",
    "operacion-derechos-comun-derivados-v1.json": "057e35f7cfd06d59af94e1025f3ace570b702e226f4b437a08225a95d33c943a",
    "operacion-ia-trabajo-v1.json": "207500a5fa02ea1de184e28b73d540d5710ba0b11472387a3577104aea488208",
    "operacion-mercado-v1.json": "1b543ad89baf4d24cfb91442fcdf6113075b7bd2d890410bf2ca8d69ade6bd75",
    "operacion-ocupaciones-v1.json": "610ca8d20e60391a66bf9e9456bcfe94a86af25851a4979e7e560c24a9c6b508",
}


def referencia_congelada(caso: TestCase, nombre: str) -> dict:
    """Lee una referencia congelada tras exigir que sus bytes sean los fijados.

    Returns:
        La referencia por identificador de fuente.
    """
    contenido = (REFERENCIAS / nombre).read_bytes()
    caso.assertEqual(hashlib.sha256(contenido).hexdigest(), HUELLAS_DE_REFERENCIA[nombre], f"{nombre} ha cambiado")
    return json.loads(contenido)


def comprobar_tema(caso: TestCase, tema: str, esperado: dict, *, solo_operativas: bool = False) -> None:
    """Coteja identidades, políticas, conjuntos y dependencias del tema con su referencia congelada.

    Cada valor se compara dos veces, en la ficha y en el consumidor que la lee (registro, conjuntos y módulos),
    para que ninguno de los dos pueda apartarse de la referencia sin que la prueba falle.
    """
    activos = {modulo.id: modulo for modulo in modulos.MODULOS}
    todos = fuentes.cargar_descriptores(tema=tema)
    descriptores = tuple(d for d in todos if d.modalidad == "operativa") if solo_operativas else todos
    caso.assertEqual({d.id for d in descriptores}, set(esperado))
    for descriptor in descriptores:
        with caso.subTest(fuente=descriptor.id):
            dato = esperado[descriptor.id]
            caso.assertEqual(descriptor.actualizacion._asdict(), dato["actualizacion"])
            caso.assertEqual(FUENTES[descriptor.id]._asdict(), dato["actualizacion"])
            caso.assertEqual([c._asdict() for c in descriptor.conjuntos], dato["conjuntos"])
            caso.assertEqual([c._asdict() for c in CONJUNTOS if c.fuente == descriptor.id], dato["conjuntos"])
            caso.assertEqual(list(descriptor.dependencias), dato["dependencias"])
            caso.assertEqual(list(activos[descriptor.id].entradas), dato["dependencias"])
            caso.assertEqual(descriptor.casa_datos, dato["casa_datos"])
            caso.assertEqual(activos[descriptor.id].fuentes, (descriptor.id,))
    caso.assertEqual(modulos.comprobar_registro(), [])


def descriptores_operativos() -> dict[str, DescriptorFuente]:
    """Descubre en disco todos los temas con fichas y reúne sus fuentes operativas, sin pasar por el registro.

    Returns:
        Los descriptores operativos por identificador.
    """
    plataforma = Path(fuentes.__file__).resolve().parents[1]
    temas = sorted({ficha.parents[2].name for ficha in plataforma.glob("*/fuentes/*/fuente.json")})
    return {
        descriptor.id: descriptor
        for tema in temas
        for descriptor in fuentes.cargar_descriptores(tema=tema)
        if descriptor.modalidad == "operativa"
    }


def discrepancias_del_registro(
    registro: Mapping[str, PoliticaActualizacion], operativos: Mapping[str, DescriptorFuente], candidatos: Iterable[str]
) -> list[str]:
    """Contrasta el registro de la actualización con las fichas operativas, salvo los productores candidatos.

    Returns:
        Un motivo por fuente sin registro, registro sin fuente o política distinta; vacía si coinciden.
    """
    esperados = {i: d for i, d in operativos.items() if i not in set(candidatos)}
    faltan = sorted(set(esperados) - set(registro))
    sobran = sorted(set(registro) - set(esperados))
    distintas = sorted(i for i in set(esperados) & set(registro) if registro[i] != esperados[i].actualizacion)
    return [
        *(f"{i}: fuente operativa sin registro" for i in faltan),
        *(f"{i}: registro sin fuente operativa" for i in sobran),
        *(f"{i}: política registrada distinta de la ficha" for i in distintas),
    ]
