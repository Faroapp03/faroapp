"""Registro de los módulos de actualización: la fuente única de qué se publica junto y de qué lee cada módulo.

Un módulo es la unidad que actualizar.py descarga, prepara, valida y publica de una vez: todo o nada. Lo forman una o
varias fuentes de reconstruir.py; las listas complementarias que deben cuadrar entre sí van en el mismo módulo. Los
conjuntos del Consorci (jdcj-za6r, 7vig-4syr, qv5z-dgk3 y hhvr-cedj) forman una sola fuente, consorci, que los valida
juntos, y por eso un solo módulo. Las listas de cada módulo son los originales que declara la procedencia de sus fuentes
(`listas`); sus controles, los de la etapa validar de cada fuente (su validacion.json); y el paquete del motor tiene
los suyos al final de la actualización (exportar, pruebas y alarmas).

`entradas` son los módulos cuyos datos lee al preparar o validar. Un módulo solo lee la última versión buena publicada
de otro, nunca la de un área de ensayo. Además de los módulos, la cadena lee entradas que la actualización no
produce ni cambia: ENTRADAS_EXTERNAS. `comprobar_registro` exige que cada fuente esté en un solo módulo y que cada
entrada vaya antes en el orden de reconstruir.py.
"""

from pathlib import Path
from types import ModuleType
from typing import NamedTuple

from plataforma_datos.comun.entrada_salida import leer_json
from plataforma_datos.comun.fuentes.version_certifi import lector as version_certifi
from plataforma_datos.comun.fuentes.versiones_navegadores import lector as versiones_navegadores
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, RAIZ
from plataforma_datos.comun.nucleo import PAQUETE as PAQUETE_PUBLICO
from plataforma_datos.contratos.fuentes import (
    ConjuntoComprobacion,
    DescriptorFuente,
    ErrorDescriptor,
    ProduccionLocal,
    cargar_descriptores,
    cargar_fuente,
    comprobar_lector,
)
from plataforma_datos.cursos.fuentes.hoja_de_ruta import lector as hoja_de_ruta
from plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4 import lector as encuestas_isco4
from plataforma_datos.ia_y_trabajo.fuentes.ia_nacional import lector as ia_nacional
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.reconstruir import FUENTES_EN_ORDEN, ORDEN
from plataforma_datos.orquestacion.reconstruir import etapas as etapas_de_reconstruccion

FUENTES_CATALOGO = frozenset({"hp_life", "cibervoluntarios", "claude_academy"})
FUENTES_CON_CATALOGO = FUENTES_CATALOGO | {"fundae", "barcelonactiva"}

PAQUETE = "paquete"  # el módulo final: exporta datos/ con lo publicado de todos los demás
CARPETA_DEL_PAQUETE = PAQUETE_PUBLICO.relative_to(RAIZ).as_posix()
CARPETA_DE_DATOS = DATOS_RELATIVOS.as_posix()
# Carpetas operativas que la cadena lee y que ninguna actualización escribe: las revisiones de personas, la captura del
# SEPE de formación, las traducciones al catalán, el uso de la IA por las empresas medido fuera de la UE y la exposición
# calculada con microdatos de encuestas, que se producen aparte.
ENTRADAS_EXTERNAS = (
    f"{CARPETA_DE_DATOS}/revisiones",
    f"{CARPETA_DE_DATOS}/originales/sepe",
    f"{CARPETA_DE_DATOS}/preparados/catalan",
    f"{CARPETA_DE_DATOS}/validados/ia-nacional",
    f"{CARPETA_DE_DATOS}/validados/encuestas-isco4",
)


class Modulo(NamedTuple):
    """Un módulo de actualización: su identificador, las fuentes que lo forman y los módulos que lee."""

    id: str
    fuentes: tuple[str, ...]
    entradas: tuple[str, ...] = ()


class ProductorCandidato(NamedTuple):
    """Productor importado explícitamente cuya ejecución automática aún no está habilitada."""

    id: str
    tema: str
    lector: ModuleType


# La ficha describe; esta lista verifica identidad sin conceder descarga ni publicación.
# La promoción exige retirarlo de candidatos e incorporarlo íntegro al registro activo.
PRODUCTORES_CANDIDATOS = (
    ProductorCandidato("versiones_navegadores", "comun", versiones_navegadores),
    ProductorCandidato("version_certifi", "comun", version_certifi),
)


PRODUCTORES_EXTERNOS = (
    ProductorCandidato("ia_nacional", "ia_y_trabajo", ia_nacional),
    ProductorCandidato("encuestas_isco4", "ia_y_trabajo", encuestas_isco4),
)


class ProductorLocal(NamedTuple):
    """Productor de entregas locales, sin ejecución desde los descriptores ni alta automática."""

    productor: ProductorCandidato
    operacion: ProduccionLocal


PRODUCTORES_LOCALES = (
    ProductorLocal(
        ProductorCandidato("hoja_de_ruta", "cursos", hoja_de_ruta),
        ProduccionLocal(generar=("todo",), comprobar=("todo", "--comprobar")),
    ),
)


def _productores_separados() -> dict[str, tuple[ProductorCandidato, str]]:
    return {
        **{p.id: (p, "productor-externo") for p in PRODUCTORES_EXTERNOS},
        **{p.productor.id: (p.productor, "productor-local") for p in PRODUCTORES_LOCALES},
    }


def _uno(fuente: str, *entradas: str) -> Modulo:
    """Un módulo de una sola fuente, con el nombre de la fuente.

    Returns:
        El módulo, con el nombre y la entrada de la fuente.
    """
    return Modulo(fuente, (fuente,), entradas)


def _declarado(fuente: str, *, tema: str = "cursos") -> Modulo:
    """Compone un módulo con las dependencias de su única ficha operativa.

    Returns:
        Módulo de la fuente; el registro Python conserva su posición y su lector.
    """
    return _uno(fuente, *cargar_fuente(fuente, tema=tema).dependencias)


CLASIFICACIONES, CATALUNA, ESCO, FORMACION = "clasificaciones", "cataluna", "esco", "formacion"
MODULOS: tuple[Modulo, ...] = (
    _declarado(ESCO, tema="ocupaciones"),
    _declarado("oit", tema="ocupaciones"),
    _declarado(CLASIFICACIONES, tema="ocupaciones"),
    _declarado("cambra", tema="ia_y_trabajo"),
    _declarado("hechos_informe", tema="ia_y_trabajo"),
    _declarado("cataluna", tema="mercado"),
    _declarado("ocupados", tema="mercado"),
    _declarado("censo", tema="mercado"),
    _declarado("tich", tema="ia_y_trabajo"),
    _declarado("salarios", tema="mercado"),
    _declarado("formacion"),
    _declarado("consorci"),
    _declarado("agencia"),
    _declarado("acreditacion"),
    _declarado("citilab"),
    _declarado("abierta"),
    _declarado("lecturas", tema="biblioteca"),
    _declarado("enlaces_lecturas", tema="biblioteca"),
    _declarado("derechos", tema="derechos"),
    _declarado("textos", tema="ocupaciones"),
    _declarado("idescat", tema="comun"),
    _declarado("catalan", tema="comun"),
    _declarado("nombres", tema="comun"),
    _declarado("sectores", tema="mercado"),
    _declarado("empresas", tema="mercado"),
    _declarado("observatori", tema="mercado"),
    _declarado("necesidades", tema="mercado"),
    _declarado("perfiles", tema="mercado"),
    _declarado("certificados2016"),
    _declarado("actic"),
    _declarado("barcelonactiva"),
    _declarado("fundae"),
    _declarado("memoria"),
    _declarado("hp_life"),
    _declarado("cibervoluntarios"),
    _declarado("claude_academy"),
    _declarado("territorios", tema="comun"),
    _declarado("mundo_eurostat", tema="ia_y_trabajo"),
    _declarado("ilostat", tema="mercado"),
    _declarado("tic_llars", tema="ia_y_trabajo"),
    _declarado("clima_empresarial", tema="ia_y_trabajo"),
    _declarado("ue_eurostat", tema="ia_y_trabajo"),
    _declarado("decada_digital", tema="ia_y_trabajo"),
    _declarado("eurobarometro", tema="ia_y_trabajo"),
    _declarado("ceo_panel", tema="ia_y_trabajo"),
    _declarado("ia_nacional_isl", tema="ia_y_trabajo"),
    _declarado("ia_nacional_gbr", tema="ia_y_trabajo"),
    _declarado("ia_nacional_bra", tema="ia_y_trabajo"),
    _declarado("ia_nacional_che", tema="ia_y_trabajo"),
    _declarado("ia_nacional_isr", tema="ia_y_trabajo"),
    _declarado("ia_nacional_kor", tema="ia_y_trabajo"),
    _declarado("epa", tema="mercado"),
    _declarado("eaes", tema="mercado"),
    _declarado("ofertas", tema="mercado"),
    _declarado("enlaces"),
    _declarado("datos_globales", tema="derivados"),
)
# Módulos de apoyo: su rojo se anota en el estado y avisa en el panel, pero no impide exportar el paquete. La
# comprobación de enlaces solo oculta o recupera enlaces; con un fallo suyo se sigue publicando el archivo anterior.
MODULOS_DE_APOYO = frozenset({"enlaces"})
# Cada módulo del estado de la actualización: los del registro y, al final, el paquete.
IDS = (*(modulo.id for modulo in MODULOS), PAQUETE)


def carpetas(modulo: Modulo) -> tuple[str, ...]:
    """Las carpetas operativas del módulo, relativas a la raíz: originales, preparados y validados de cada fuente.

    Returns:
        Las rutas relativas a la raíz, ordenadas por fuente.
    """
    modulos_de_fuente = dict(FUENTES_EN_ORDEN)
    rutas = []
    for fuente in modulo.fuentes:
        propia = modulos_de_fuente[fuente].FUENTE
        originales = FUENTES[fuente].originales or propia
        rutas += [
            f"{CARPETA_DE_DATOS}/originales/{originales}",
            f"{CARPETA_DE_DATOS}/preparados/{propia}",
            f"{CARPETA_DE_DATOS}/validados/{propia}",
        ]
    return tuple(rutas)


def listas(raiz: Path, modulo: Modulo) -> list[str]:
    """Los originales del módulo según la procedencia de cada fuente (un módulo sin descarga no tiene ninguno).

    Returns:
        Las rutas de los originales; vacía si el módulo no descarga nada.
    """
    nombres = []
    for carpeta in carpetas(modulo)[::3]:
        procedencia = raiz / carpeta / "procedencia.json"
        if procedencia.exists():
            nombres += [entrada["archivo"] for entrada in leer_json(procedencia).get("archivos", [])]
    return nombres


def _fallos_candidatos(
    candidatos: dict[str, ProductorCandidato], descriptores: list[DescriptorFuente], activos: set[str | None]
) -> list[str]:
    """Comprueba identidad y separación de los productores aún sin ejecución habilitada.

    Returns:
        Incoherencias sin conceder permisos ni modificar el registro activo.
    """
    fallos = []
    if len(candidatos) != len(PRODUCTORES_CANDIDATOS):
        fallos.append("identidades de productores candidatos duplicadas")
    ids_declarados = {descriptor.id for descriptor in descriptores}
    for identidad in candidatos:
        if identidad in activos:
            fallos.append(f"{identidad}: candidato incluido en la ejecución activa")
        if identidad not in ids_declarados:
            fallos.append(f"{identidad}: candidato sin descriptor")
    for descriptor in descriptores:
        candidato = candidatos.get(descriptor.id)
        if candidato is not None and descriptor.tema != candidato.tema:
            fallos.append(f"{descriptor.id}: tema distinto del candidato declarado")
    return fallos


def _fallos_separados(
    descriptores: list[DescriptorFuente], activos: set[str | None], conjuntos: tuple[ConjuntoComprobacion, ...]
) -> list[str]:
    separados = _productores_separados()
    fallos = []
    if len(separados) != len(PRODUCTORES_EXTERNOS) + len(PRODUCTORES_LOCALES):
        fallos.append("identidades locales o externas duplicadas")
    ids = {d.id for d in descriptores}
    candidatos = {p.id for p in PRODUCTORES_CANDIDATOS}
    for identidad in separados:
        if identidad in activos or identidad in candidatos:
            fallos.append(f"{identidad}: productor local o externo incluido en registro activo/candidato")
        if identidad not in ids:
            fallos.append(f"{identidad}: productor local o externo sin descriptor")
    for descriptor in descriptores:
        if descriptor.id not in separados:
            continue
        productor, modalidad = separados[descriptor.id]
        if descriptor.tema != productor.tema or descriptor.modalidad != modalidad:
            fallos.append(f"{descriptor.id}: tema o modalidad distinto del productor estático")
        if any(d not in activos for d in descriptor.dependencias):
            fallos.append(f"{descriptor.id}: dependencia externa no declarada en el registro")
        if modalidad == "productor-externo" and descriptor.conjuntos != tuple(
            c for c in conjuntos if c.id == descriptor.id
        ):
            fallos.append(f"{descriptor.id}: comprobaciones externas distintas del descriptor")
    fallos.extend(_fallos_productores_locales(descriptores))
    return fallos


def _fallos_productores_locales(descriptores: list[DescriptorFuente]) -> list[str]:
    fallos = []
    for local in PRODUCTORES_LOCALES:
        ficha = next((d for d in descriptores if d.id == local.productor.id), None)
        if ficha is not None and ficha.produccion_local != local.operacion:
            fallos.append(f"{local.productor.id}: producción local distinta del registro estático")
    return fallos


def _fallos_descriptores() -> list[str]:
    """Contrasta los descriptores trasladados con los productores estáticos activos.

    Returns:
        Incoherencias concretas; no activa productores descubiertos en los JSON.
    """
    # Consulta diferida: la planificación importa el registro estático de módulos.
    from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS

    fallos = []
    if len({c.id for c in CONJUNTOS}) != len(CONJUNTOS):
        fallos.append("identidades de comprobación duplicadas en el planificador")
    descriptores = []
    # Temas incorporados de forma explícita; una carpeta nueva no activa un productor.
    for tema, nombre in (
        ("cursos", "Cursos"),
        ("ocupaciones", "Ocupaciones"),
        ("mercado", "Mercado"),
        ("ia_y_trabajo", "IA y trabajo"),
        ("derechos", "Derechos"),
        ("biblioteca", "Biblioteca"),
        ("comun", "Común"),
        ("derivados", "Derivados"),
    ):
        try:
            descriptores.extend(cargar_descriptores(tema=tema))
        except (ErrorDescriptor, OSError) as error:
            fallos.append(f"descriptores de {nombre} no válidos: {error}")
    lectores = dict(FUENTES_EN_ORDEN)
    modulos = {modulo.id: modulo for modulo in MODULOS}
    candidatos = {candidato.id: candidato for candidato in PRODUCTORES_CANDIDATOS}
    activos = set(lectores) | set(modulos) | set(FUENTES) | {c.fuente for c in CONJUNTOS}
    fallos.extend(_fallos_candidatos(candidatos, descriptores, activos))
    separados = _productores_separados()
    fallos.extend(_fallos_separados(descriptores, activos, CONJUNTOS))
    lectores.update((c.id, c.lector) for c in PRODUCTORES_CANDIDATOS)
    lectores.update((identidad, productor.lector) for identidad, (productor, _) in separados.items())
    for descriptor in descriptores:
        lector = lectores.get(descriptor.id)
        if lector is None:
            fallos.append(f"{descriptor.id}: descriptor sin productor estático")
            continue
        try:
            comprobar_lector(
                descriptor,
                identificador=descriptor.id,
                modulo=getattr(lector, "__name__", ""),
                casa=getattr(lector, "FUENTE", None),
            )
        except ErrorDescriptor as error:
            fallos.append(f"{descriptor.id}: {error}")
        if descriptor.id not in separados:
            fallos.extend(_fallos_operacion(descriptor, modulos, CONJUNTOS, candidatos))
    return fallos


def _fallos_operacion(
    descriptor: DescriptorFuente,
    modulos: dict[str, Modulo],
    conjuntos: tuple[ConjuntoComprobacion, ...],
    candidatos: dict[str, ProductorCandidato],
) -> list[str]:
    fallos = []
    if descriptor.modalidad != "operativa":
        fallos.append(f"{descriptor.id}: modalidad no operativa en registro operativo")
    if descriptor.id in candidatos:
        return fallos
    reales = tuple(c for c in conjuntos if c.fuente == descriptor.id)
    esperado = _uno(descriptor.id, *descriptor.dependencias)
    comparaciones = (
        (reales == descriptor.conjuntos, "conjuntos distintos del descriptor"),
        (FUENTES.get(descriptor.id) == descriptor.actualizacion, "política distinta del descriptor"),
        (modulos.get(descriptor.id) == esperado, "dependencias distintas del descriptor"),
        (
            descriptor.etapas_locales is None
            or descriptor.etapas_locales == etapas_de_reconstruccion(True, descriptor.id),
            "etapas locales distintas del registro",
        ),
    )
    return [*fallos, *(f"{descriptor.id}: {motivo}" for coincide, motivo in comparaciones if not coincide)]


def comprobar_registro() -> list[str]:
    """Los fallos del registro: cada fuente en un solo módulo, entradas conocidas y anteriores; [] si está bien.

    Returns:
        Un texto por fallo del registro; vacía si está bien.
    """
    fallos = _fallos_descriptores()
    fuentes = [fuente for modulo in MODULOS for fuente in modulo.fuentes]
    if sorted(fuentes) != sorted(ORDEN):
        fallos.append("cada fuente de reconstruir.py debe estar en un solo módulo")
    productores: dict[str, str] = {}
    productores_declarados = (
        *FUENTES_EN_ORDEN,
        *((c.id, c.lector) for c in PRODUCTORES_CANDIDATOS),
        *((p.id, p.lector) for p in (*PRODUCTORES_EXTERNOS, *(p.productor for p in PRODUCTORES_LOCALES))),
    )
    for nombre, adaptador in productores_declarados:
        casa = getattr(adaptador, "FUENTE", None)
        if casa is None:
            continue
        if casa in productores:
            fallos.append(f"dos productores comparten la casa {casa}: {productores[casa]} y {nombre}")
        else:
            productores[casa] = nombre
    posicion = {modulo.id: indice for indice, modulo in enumerate(MODULOS)}
    for modulo in MODULOS:
        for entrada in modulo.entradas:
            if posicion.get(entrada, len(MODULOS)) >= posicion[modulo.id]:
                fallos.append(f"{modulo.id} lee {entrada}, que no es un módulo anterior")
    return fallos
