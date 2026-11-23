"""Descriptores de fuentes y documentación derivada; no ejecuta lectores declarados en JSON."""

import argparse
import json
import re
import sys
from collections.abc import Iterable, Sequence
from dataclasses import MISSING, dataclass, fields
from pathlib import Path
from typing import NamedTuple
from urllib.parse import urlsplit

VERSION_DESCRIPTOR = 1
IDENTIFICADOR = re.compile(r"[a-z0-9][a-z0-9_-]*")
POLITICAS = ("diaria", "mensual", "edición", "fija", "manual", "redactada")
OPERACIONES = ("descargar", "revision", "integridad", "recomponer")
CLASES_CONJUNTO = ("referencia-versionada", "cambiante", "manual", "historica", "editorial", "externa", "derivada")
ALCANCES_CONJUNTO = (
    "copia-local",
    "edicion-conocida",
    "catalogo-actual",
    "serie-abierta",
    "descubre-edicion",
    "contenido-actual-acotado",
    "recurso-actual-sin-edicion",
    "entradas-admitidas",
    "productor-externo",
)
TIPOS_RECURSO = ("url", "archivo", "familia")
TIPOS_CANAL = ("remoto", "local", "editorial")


class ErrorDescriptor(ValueError):
    """El descriptor no identifica una fuente o contiene una declaración incoherente."""


class PoliticaActualizacion(NamedTuple):
    """Los cinco campos de la política existente, sin convertir frecuencia textual en cadencia."""

    politica: str
    red: bool
    frecuencia: str
    renovar_dias: int | None = None
    originales: str | None = None


class ConjuntoComprobacion(NamedTuple):
    """Consulta o revisión programable; su intervalo no expresa la frecuencia de publicación."""

    id: str
    fuente: str | None
    clase: str
    alcance: str
    operacion: str
    intervalo_dias: int | None


class RecursoFuente(NamedTuple):
    """Recurso o familia identificada; la licencia desconocida se conserva como None."""

    id: str
    tipo: str
    ubicacion: str | None
    licencia: str | None
    descripcion: str


class CanalFuente(NamedTuple):
    """Acceso realmente utilizado, con recursos, límites y autenticación declarados."""

    id: str
    tipo: str
    recursos: tuple[str, ...]
    autenticacion: str
    limites: tuple[str, ...]
    observaciones: str


class ProduccionLocal(NamedTuple):
    """Argumentos de CLI local, documentales y contrastados con registro estático; nunca ejecutados desde JSON."""

    generar: tuple[str, ...]
    comprobar: tuple[str, ...]


@dataclass(frozen=True, kw_only=True)
class DescriptorFuente:
    """Identidad y contrato operativo de una fuente; todas sus colecciones son inmutables."""

    schema_version: int
    id: str
    tema: str
    nombre: str
    institucion: str | None
    lector: str
    casa_datos: str | None
    significado: str
    alcance: tuple[str, ...]
    recursos: tuple[RecursoFuente, ...]
    canales: tuple[CanalFuente, ...]
    actualizacion: PoliticaActualizacion | None
    conjuntos: tuple[ConjuntoComprobacion, ...]
    dependencias: tuple[str, ...]
    contratos: tuple[str, ...]
    retirada: str
    conservacion: str
    produccion_local: ProduccionLocal | None = None
    etapas_locales: tuple[str, ...] | None = None

    @property
    def modalidad(self) -> str:
        """Distingue formas mutuamente excluyentes, sin otra configuración de activación.

        Returns:
            operativa, lectura-candidata, productor-externo o productor-local según el contrato validado.
        """
        if self.produccion_local is not None:
            return "productor-local"
        if self.actualizacion is not None:
            return "operativa"
        return "productor-externo" if self.conjuntos else "lectura-candidata"


def _exigir(condicion: object, campo: str) -> None:
    if not condicion:
        raise ErrorDescriptor(f"Declaración no válida: {campo}")


def _texto(valor: object, campo: str) -> str:
    _exigir(isinstance(valor, str), campo)
    _exigir(bool(valor) and valor == valor.strip() and all(ord(c) >= ord(" ") for c in valor), campo)
    return valor


def _opcional(valor: object, campo: str) -> str | None:
    return None if valor is None else _texto(valor, campo)


def _id(valor: object, campo: str) -> str:
    texto = _texto(valor, campo)
    _exigir(IDENTIFICADOR.fullmatch(texto), campo)
    return texto


def _objeto(valor: object, requeridos: Iterable[str], campo: str) -> dict[str, object]:
    _exigir(isinstance(valor, dict) and set(valor) == set(requeridos), campo)
    return dict(valor)


def _lista(valor: object, campo: str) -> list[object]:
    _exigir(isinstance(valor, list), campo)
    return list(valor)


def _textos(valor: object, campo: str) -> tuple[str, ...]:
    resultado = tuple(_texto(x, campo) for x in _lista(valor, campo))
    _exigir(len(resultado) == len(set(resultado)), campo + " duplicado")
    return resultado


def _dias(valor: object, campo: str) -> int | None:
    _exigir(valor is None or (type(valor) is int and valor > 0), campo)
    return valor


def _politica(valor: object) -> PoliticaActualizacion:
    dato = _objeto(valor, PoliticaActualizacion._fields, "actualizacion")
    _exigir(dato["politica"] in POLITICAS, "actualizacion.politica")
    _exigir(type(dato["red"]) is bool, "actualizacion.red")
    originales = _opcional(dato["originales"], "actualizacion.originales")
    if originales is not None:
        _id(originales, "actualizacion.originales")
    return PoliticaActualizacion(
        politica=dato["politica"],
        red=dato["red"],
        frecuencia=_texto(dato["frecuencia"], "actualizacion.frecuencia"),
        renovar_dias=_dias(dato["renovar_dias"], "actualizacion.renovar_dias"),
        originales=originales,
    )


def _conjunto(valor: object, fuente: str | None) -> ConjuntoComprobacion:
    dato = _objeto(valor, ConjuntoComprobacion._fields, "conjunto")
    _exigir(dato["fuente"] == fuente, "conjunto.fuente")
    _exigir(dato["operacion"] in OPERACIONES, "conjunto.operacion")
    _exigir(dato["clase"] in CLASES_CONJUNTO, "conjunto.clase")
    _exigir(dato["alcance"] in ALCANCES_CONJUNTO, "conjunto.alcance")
    intervalo = _dias(dato["intervalo_dias"], "conjunto.intervalo_dias")
    _exigir((dato["operacion"] == "descargar") == (intervalo is not None), "conjunto.cadencia")
    return ConjuntoComprobacion(
        id=_id(dato["id"], "conjunto.id"),
        fuente=fuente,
        clase=_id(dato["clase"], "conjunto.clase"),
        alcance=_id(dato["alcance"], "conjunto.alcance"),
        operacion=dato["operacion"],
        intervalo_dias=intervalo,
    )


def _recurso(valor: object) -> RecursoFuente:
    dato = _objeto(valor, RecursoFuente._fields, "recurso")
    _exigir(dato["tipo"] in TIPOS_RECURSO, "recurso.tipo")
    ubicacion = _opcional(dato["ubicacion"], "recurso.ubicacion")
    if dato["tipo"] == "url":
        _exigir(ubicacion is not None, "recurso.url ausente")
        try:
            url = urlsplit(ubicacion)
            _exigir(
                url.scheme in ("http", "https") and url.hostname and not url.username and not url.password,
                "recurso.url",
            )
        except ValueError as error:
            raise ErrorDescriptor("Declaración no válida: recurso.url") from error
    return RecursoFuente(
        id=_id(dato["id"], "recurso.id"),
        tipo=dato["tipo"],
        ubicacion=ubicacion,
        licencia=_opcional(dato["licencia"], "recurso.licencia"),
        descripcion=_texto(dato["descripcion"], "recurso.descripcion"),
    )


def _canal(valor: object) -> CanalFuente:
    dato = _objeto(valor, CanalFuente._fields, "canal")
    _exigir(dato["tipo"] in TIPOS_CANAL, "canal.tipo")
    recursos = _textos(dato["recursos"], "canal.recursos")
    _exigir(bool(recursos), "canal.recursos vacío")
    return CanalFuente(
        id=_id(dato["id"], "canal.id"),
        tipo=dato["tipo"],
        recursos=recursos,
        autenticacion=_texto(dato["autenticacion"], "canal.autenticacion"),
        limites=_textos(dato["limites"], "canal.limites"),
        observaciones=_texto(dato["observaciones"], "canal.observaciones"),
    )


def _unicos(identificadores: Iterable[str], campo: str) -> None:
    valores = tuple(identificadores)
    _exigir(len(valores) == len(set(valores)), campo + " duplicado")


def _coherencia(descriptor: DescriptorFuente) -> None:
    _exigir(descriptor.lector == f"plataforma_datos.{descriptor.tema}.fuentes.{descriptor.id}.lector", "lector")
    _unicos((x.id for x in descriptor.recursos), "recurso.id")
    _unicos((x.id for x in descriptor.canales), "canal.id")
    _unicos((x.id for x in descriptor.conjuntos), "conjunto.id")
    recursos = {x.id for x in descriptor.recursos}
    _exigir(bool(recursos) and bool(descriptor.canales), "colecciones vacías")
    _exigir(all(set(x.recursos) <= recursos for x in descriptor.canales), "canal.recurso desconocido")
    _exigir(descriptor.id not in descriptor.dependencias, "dependencia propia")
    _coherencia_operacion(descriptor)


def _coherencia_operacion(descriptor: DescriptorFuente) -> None:
    _exigir(descriptor.etapas_locales is None or descriptor.actualizacion is not None, "etapas locales sin operación")
    if descriptor.produccion_local is not None:
        _exigir(
            descriptor.actualizacion is None
            and descriptor.casa_datos is None
            and not descriptor.conjuntos
            and not descriptor.dependencias,
            "productor local con operación automática, casa var o dependencias",
        )
        return
    politica = descriptor.actualizacion
    if politica is None:
        if not descriptor.conjuntos:
            _exigir(descriptor.casa_datos is None and not descriptor.dependencias, "lectura candidata con operación")
            return
        _exigir(descriptor.casa_datos is not None, "productor externo sin casa")
        _exigir(
            all(
                c.fuente is None
                and c.clase == "externa"
                and c.alcance == "productor-externo"
                and c.operacion == "revision"
                and c.intervalo_dias is None
                for c in descriptor.conjuntos
            ),
            "comprobación externa no pasiva",
        )
        return
    _exigir(descriptor.casa_datos is not None and bool(descriptor.conjuntos), "operación incompleta")
    _exigir(politica.originales in (None, descriptor.casa_datos), "originales fuera de la casa de la fuente")
    _exigir(
        politica.red or all(x.operacion != "descargar" for x in descriptor.conjuntos),
        "descarga sin red declarada",
    )


def _produccion_local(valor: object) -> ProduccionLocal | None:
    if valor is None:
        return None
    dato = _objeto(valor, ProduccionLocal._fields, "produccion_local")
    generar = _textos(dato["generar"], "produccion_local.generar")
    comprobar = _textos(dato["comprobar"], "produccion_local.comprobar")
    _exigir(bool(generar) and bool(comprobar), "produccion_local sin comandos")
    return ProduccionLocal(generar, comprobar)


def _etapas_locales(valor: object) -> tuple[str, ...] | None:
    if valor is None:
        return None
    etapas = _textos(valor, "etapas_locales")
    _exigir(bool(etapas) and set(etapas) <= {"descargar", "preparar", "validar"}, "etapas locales desconocidas")
    _exigir(len(etapas) == len(set(etapas)), "etapas locales duplicadas")
    return etapas


def _documento_descriptor(valor: object) -> dict[str, object]:
    campos = fields(DescriptorFuente)
    obligatorios = {f.name for f in campos if f.default is MISSING}
    _exigir(isinstance(valor, dict), "fuente")
    _exigir(obligatorios <= set(valor) <= {f.name for f in campos}, "fuente")
    return dict(valor)


def validar_descriptor(valor: object) -> DescriptorFuente:
    """Valida un documento cerrado sin convertir valores ni importar el lector declarado.

    Returns:
        Descriptor con colecciones anidadas inmutables e identidades coherentes.

    Raises:
        ErrorDescriptor: Ante campos, tipos, identidades, cadencias o referencias incoherentes.
    """
    dato = _documento_descriptor(valor)
    _exigir(type(dato["schema_version"]) is int and dato["schema_version"] == VERSION_DESCRIPTOR, "schema_version")
    identidad = _id(dato["id"], "id")
    descriptor = DescriptorFuente(
        schema_version=VERSION_DESCRIPTOR,
        id=identidad,
        tema=_id(dato["tema"], "tema"),
        nombre=_texto(dato["nombre"], "nombre"),
        institucion=_opcional(dato["institucion"], "institucion"),
        lector=_texto(dato["lector"], "lector"),
        casa_datos=None if dato["casa_datos"] is None else _id(dato["casa_datos"], "casa_datos"),
        significado=_texto(dato["significado"], "significado"),
        alcance=_textos(dato["alcance"], "alcance"),
        recursos=tuple(_recurso(x) for x in _lista(dato["recursos"], "recursos")),
        canales=tuple(_canal(x) for x in _lista(dato["canales"], "canales")),
        actualizacion=None if dato["actualizacion"] is None else _politica(dato["actualizacion"]),
        conjuntos=tuple(
            _conjunto(x, None if dato["actualizacion"] is None else identidad)
            for x in _lista(dato["conjuntos"], "conjuntos")
        ),
        dependencias=tuple(_id(x, "dependencia") for x in _textos(dato["dependencias"], "dependencias")),
        contratos=_textos(dato["contratos"], "contratos"),
        retirada=_texto(dato["retirada"], "retirada"),
        conservacion=_texto(dato["conservacion"], "conservacion"),
        produccion_local=_produccion_local(dato.get("produccion_local")),
        etapas_locales=_etapas_locales(dato.get("etapas_locales")),
    )
    _coherencia(descriptor)
    return descriptor


def _pares_unicos(pares: list[tuple[str, object]]) -> dict[str, object]:
    resultado = {}
    for clave, valor in pares:
        _exigir(clave not in resultado, "clave JSON repetida")
        resultado[clave] = valor
    return resultado


def carpeta_de_fuentes(tema: str) -> Path:
    """Carpeta de las fichas de un tema; es la única ruta de la que se descubren descriptores.

    Returns:
        La carpeta `<tema>/fuentes` dentro del paquete, resuelta.
    """
    _id(tema, "tema")
    plataforma = Path(__file__).resolve().parents[1]
    carpeta = (plataforma / tema / "fuentes").resolve()
    _exigir(carpeta.is_relative_to(plataforma), "tema fuera del paquete")
    return carpeta


def cargar_fuente(identificador: str, *, tema: str = "cursos") -> DescriptorFuente:
    """Lee únicamente fuente.json del identificador y tema dentro del paquete.

    Returns:
        Descriptor validado cuya identidad coincide con su ubicación.

    Raises:
        ErrorDescriptor: Ante escapes, JSON inválido, duplicados o identidad distinta.
        OSError: Si el recurso no puede leerse; nunca se sustituye por una declaración vacía.
    """
    _id(identificador, "identificador")
    carpeta = carpeta_de_fuentes(tema)
    ruta = (carpeta / identificador / "fuente.json").resolve()
    _exigir(ruta.is_relative_to(carpeta) and ruta.parent.name == identificador, "fuente fuera del paquete")
    try:
        documento = json.loads(ruta.read_text(encoding="utf-8"), object_pairs_hook=_pares_unicos)
    except (json.JSONDecodeError, UnicodeError, RecursionError) as error:
        raise ErrorDescriptor(f"JSON no válido de {identificador}") from error
    descriptor = validar_descriptor(documento)
    _exigir(descriptor.id == identificador and descriptor.tema == tema, "identidad distinta a la ruta")
    return descriptor


def _comprobar_cobertura_lectores(tema: str) -> None:
    """La existencia de un lector canónico exige contrato; no lee ni ejecuta su Python."""
    carpeta = carpeta_de_fuentes(tema)
    for lector in sorted(carpeta.glob("*/lector.py")):
        _exigir(lector.resolve().is_relative_to(carpeta), "lector fuera del paquete")
        descriptor = lector.parent / "fuente.json"
        _exigir(descriptor.is_file(), f"lector sin descriptor: {lector.parent.name}")
        _exigir(descriptor.resolve().is_relative_to(carpeta), "fuente fuera del paquete")


def cargar_descriptores(
    identificadores: Sequence[str] | None = None, *, tema: str = "cursos"
) -> tuple[DescriptorFuente, ...]:
    """Carga IDs explícitos en su orden o descubre solo los fuente.json del tema.

    Returns:
        Tupla validada, sin fuentes ni conjuntos de comprobación duplicados.

    Raises:
        ErrorDescriptor: Ante identificadores o conjuntos duplicados.
    """
    _exigir(identificadores is None or not isinstance(identificadores, (str, bytes)), "lista de identificadores")
    _comprobar_cobertura_lectores(tema)
    ids = (
        tuple(identificadores)
        if identificadores is not None
        else tuple(ruta.parent.name for ruta in sorted(carpeta_de_fuentes(tema).glob("*/fuente.json")))
    )
    _exigir(bool(ids), "no hay fuentes declaradas")
    _unicos(ids, "fuente.id")
    resultado = tuple(cargar_fuente(identificador, tema=tema) for identificador in ids)
    _unicos((x.id for fuente in resultado for x in fuente.conjuntos), "conjunto.id global")
    _unicos((d.casa_datos for d in resultado if d.casa_datos is not None), "casa_datos global")
    return resultado


def comprobar_lector(descriptor: DescriptorFuente, *, identificador: str, modulo: str, casa: str | None) -> None:
    """Contrasta con la identidad del lector ya importado estáticamente por el ejecutor.

    Raises:
        ErrorDescriptor: Si el registro, el módulo o su casa real no coinciden con el descriptor.
    """
    _exigir(
        descriptor.id == identificador and descriptor.lector == modulo and descriptor.casa_datos == casa,
        "identidad del lector estático",
    )


def generar_readme(descriptor: DescriptorFuente) -> str:
    """Produce documentación determinista únicamente desde el contrato y textos comunes.

    Returns:
        Markdown con salto final; no incluye reloj, estado de ejecución ni hogar del operador.
    """
    d = descriptor
    lineas = [
        f"# {d.nombre}",
        "",
        "Generado de `fuente.json`; editar el descriptor y regenerar.",
        "",
        d.significado,
        "",
        f"ID: `{d.id}` · tema: `{d.tema}` · institución: {d.institucion or 'no declarada'}.",
        f"Lector estático: `{d.lector}`. Casa de datos: `{d.casa_datos}`."
        if d.casa_datos is not None
        else f"Lector estático: `{d.lector}`. Sin casa de datos operativa.",
        "",
        "## Alcance",
        "",
    ]
    lineas.extend(f"- {texto}" for texto in d.alcance)
    lineas.extend(["", "## Recursos y condiciones de uso", ""])
    for recurso in d.recursos:
        lineas.extend(
            [
                f"- `{recurso.id}` ({recurso.tipo}): {recurso.descripcion}",
                f"  Ubicación: {recurso.ubicacion or 'desconocida'}. Licencia: "
                f"{(recurso.licencia or 'desconocida; no acreditada por este descriptor').removesuffix('.')}.",
            ]
        )
    lineas.extend(
        [
            "",
            "La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.",
            "",
            "## Canales utilizados",
            "",
        ]
    )
    for canal in d.canales:
        lineas.extend(
            [
                f"- `{canal.id}` ({canal.tipo}): {canal.observaciones}",
                f"  Recursos: {', '.join(canal.recursos)}. Autenticación: {canal.autenticacion.removesuffix('.')}.",
            ]
        )
        lineas.extend(f"  - {limite}" for limite in canal.limites)
    lineas.extend(_documentar_operacion(d))
    return "\n".join(lineas) + "\n"


def _documentar_operacion(d: DescriptorFuente) -> list[str]:
    politica = d.actualizacion
    if d.produccion_local is not None:
        return _documentar_local(d)
    if politica is None:
        return _documentar_no_registrado(d)
    dias = "no definido" if politica.renovar_dias is None else str(politica.renovar_dias)
    lineas = [
        "",
        "## Operación actual",
        "",
        f"Política: `{politica.politica}`. Consulta red: {'sí' if politica.red else 'no'}.",
        f"Frecuencia declarada: {politica.frecuencia.removesuffix('.')}. Aviso de renovación: {dias} días.",
        f"Originales: `{politica.originales}`." if politica.originales else "Sin carpeta de originales declarada.",
        "",
        "| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |",
        "| --- | --- | --- | --- | --- |",
    ]
    for c in d.conjuntos:
        lineas.append(
            f"| {c.id} | {c.clase} | {c.alcance} | {c.operacion} | "
            f"{c.intervalo_dias if c.intervalo_dias is not None else 'no automático'} |"
        )
    lineas.extend(
        [
            "",
            "El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.",
            f"Dependencias: {', '.join(d.dependencias) or 'ninguna declarada'}.",
            f"Contratos y controles: {', '.join(d.contratos) or 'no declarados'}.",
            "",
            f"Retirada: {d.retirada}",
            "",
            f"Conservación: {d.conservacion}",
            "",
            "## Reproducción",
            "",
            "```sh",
            *(f"python -m {d.lector} {etapa}" for etapa in (d.etapas_locales or ("preparar", "validar"))),
            f"python -m plataforma_datos.contratos.fuentes --fuente {d.id} --tema {d.tema} --comprobar",
            "```",
        ]
    )
    return lineas


def _documentar_local(d: DescriptorFuente) -> list[str]:
    operacion = d.produccion_local
    assert operacion is not None
    return [
        "",
        "## Operación actual",
        "",
        "Modalidad: `productor-local`.",
        "Producción local explícita desde entradas fijadas. No consulta red ni forma parte de los módulos automáticos.",
        "Sin casa operativa var, cadencia remota ni conjuntos de comprobación añadidos.",
        "La comprobación solo lee; la generación escribe las entregas declaradas y su manifiesto.",
        f"Contratos y controles: {', '.join(d.contratos)}.",
        "",
        f"Retirada: {d.retirada}",
        "",
        f"Conservación: {d.conservacion}",
        "",
        "## Reproducción",
        "",
        "```sh",
        f"python -m {d.lector} {' '.join(operacion.comprobar)}",
        f"python -m {d.lector} {' '.join(operacion.generar)}",
        f"python -m plataforma_datos.contratos.fuentes --fuente {d.id} --tema {d.tema} --comprobar",
        "```",
        "Los argumentos documentan el CLI real; el descriptor no se usa para ejecutar órdenes.",
    ]


def _documentar_no_registrado(d: DescriptorFuente) -> list[str]:
    lineas = [
        "",
        "## Operación actual",
        "",
        f"Modalidad: `{d.modalidad}`.",
        "Sin política de actualización en el registro principal ni consulta automática habilitada.",
    ]
    if d.conjuntos:
        lineas.extend(
            [
                "",
                "| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |",
                "| --- | --- | --- | --- | --- |",
            ]
        )
        for c in d.conjuntos:
            lineas.append(f"| {c.id} | {c.clase} | {c.alcance} | {c.operacion} | no automático |")
    else:
        lineas.append("Sin conjuntos programados, originales o CLI preparar/validar; solo lectura pura de entradas.")
    lineas.extend(
        [
            "",
            f"Dependencias: {', '.join(d.dependencias) or 'ninguna declarada'}.",
            f"Contratos y controles: {', '.join(d.contratos) or 'no declarados'}.",
            "",
            f"Retirada: {d.retirada}",
            "",
            f"Conservación: {d.conservacion}",
            "",
            "## Reproducción",
            "",
            "```sh",
        ]
    )
    if d.conjuntos:
        lineas.extend([f"python -m {d.lector} preparar", f"python -m {d.lector} validar"])
    lineas.extend(
        [
            f"python -m plataforma_datos.contratos.fuentes --fuente {d.id} --tema {d.tema} --comprobar",
            "```",
        ]
    )
    return lineas


def main(argv: list[str] | None = None) -> int:
    """Genera o comprueba los README sin ejecutar lectores ni alterar descriptores.

    Returns:
        Cero si coinciden o se generan; uno si hay diferencias; dos ante entrada inválida.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tema", default="cursos")
    parser.add_argument("--fuente", action="append")
    parser.add_argument("--comprobar", action="store_true")
    args = parser.parse_args(argv)
    try:
        descriptores = cargar_descriptores(args.fuente, tema=args.tema)
        distintos = []
        for descriptor in descriptores:
            carpeta = carpeta_de_fuentes(args.tema)
            ruta = (carpeta / descriptor.id / "README.md").resolve()
            _exigir(ruta.is_relative_to(carpeta), "README fuera del paquete")
            esperado = generar_readme(descriptor)
            if args.comprobar:
                if not ruta.is_file() or ruta.read_text(encoding="utf-8") != esperado:
                    distintos.append(descriptor.id)
            else:
                ruta.write_text(esperado, encoding="utf-8")
        if distintos:
            print("README distinto: " + ", ".join(distintos), file=sys.stderr)
            return 1
    except (ErrorDescriptor, OSError) as error:
        print(str(error), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
