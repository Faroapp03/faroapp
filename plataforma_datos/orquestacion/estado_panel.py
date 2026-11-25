"""Instantánea observada de datos para el panel, sin ejecutar actualizaciones ni identificar la versión servida.

Uso: python -m plataforma_datos.orquestacion.estado_panel.
La salida estándar contiene únicamente el contrato JSON en la versión que lee el servidor (VERSION_PANEL_EMITIDA);
los errores se comunican de forma genérica por stderr, sin rutas, informes o mensajes de fuentes.
"""

import json
import os
import re
import stat
import sys
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, RAIZ, ErrorFuente
from plataforma_datos.contratos.fuentes import cargar_descriptores
from plataforma_datos.cursos import almacen_catalogo, retencion_composicion
from plataforma_datos.cursos.componer_catalogo import CONJUNTO_SIN_APLICAR, fundae_conservado_sin_aplicar
from plataforma_datos.cursos.fallos_almacen import codigo_en
from plataforma_datos.orquestacion import comprobaciones_remotas
from plataforma_datos.orquestacion.aviso_de_la_retirada import aviso_de_la_retirada, retirada_amplia
from plataforma_datos.orquestacion.contrato_comprobaciones_panel import (
    CLAVE_REVISION_PENDIENTE,
    MOTIVOS_SALIDA_PARCIAL,
    TEMAS_PANEL,
    VERSION_PANEL_EMITIDA,
    VERSION_PANEL_RETENIDOS,
    VERSION_PANEL_REVISION_PENDIENTE,
    validar_catalogo_panel,
    validar_recuento_de_enlaces,
    validar_salida_parcial,
)
from plataforma_datos.orquestacion.cuarentena_panel import CLAVE_RETENIDOS, retenidos_del_panel
from plataforma_datos.orquestacion.ediciones_observadas import campos_del_panel
from plataforma_datos.orquestacion.estado_de_la_actualizacion import (
    AMBAR,
    ARCHIVO,
    ROJO,
    SIN_INTENTO,
    VERDE,
    comprobar_cabecera_estado,
    espera,
)
from plataforma_datos.orquestacion.estado_de_los_datos import plazo, revision_pendiente_de_la_formacion_abierta
from plataforma_datos.orquestacion.modulos import IDS, MODULOS, PRODUCTORES_CANDIDATOS, comprobar_registro
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES, FUENTES, fecha_de_la_fuente
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import ALCANCES_CON_REVISION, CONJUNTOS
from plataforma_datos.orquestacion.seguimiento_de_comprobaciones import (
    COBERTURAS_LIMITADAS,
    consulta_parcial,
    proxima_consulta,
)

MAX_ESTADO_BYTES = 256 * 1024
MAX_ENTERO_SEGURO = (1 << 53) - 1
INSTANTE_UTC = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|\+00:00)")
HUELLA = re.compile(r"[0-9a-f]{64}")
CAMPOS_REGISTRO = frozenset(SIN_INTENTO)
ERROR_GENERICO = "No se pudo consultar el estado de los datos."
PAQUETE = "paquete"


class EstadoPanelInvalido(ValueError):
    """La instantánea no puede obtenerse con integridad suficiente."""


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise EstadoPanelInvalido(ERROR_GENERICO)


def _objeto(valor: object, claves: set[str] | frozenset[str]) -> dict[str, Any]:
    _exigir(isinstance(valor, dict) and set(valor) == claves)
    return valor


def _sin_duplicados(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    resultado = {}
    for clave, valor in pares:
        _exigir(clave not in resultado)
        resultado[clave] = valor
    return resultado


def leer_bytes_registro_panel(raiz: Path) -> bytes | None:
    """Lee el registro del panel sin seguir enlaces simbólicos; `None` si todavía no existe.

    Returns:
        Los bytes del registro, o `None` si no existe.
    """
    ruta = raiz
    for componente in (*Path(CARPETA_DE_INFORMES).parts, ARCHIVO):
        ruta = ruta / componente
        _exigir(not ruta.is_symlink())
    try:
        descriptor = os.open(ruta, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    with os.fdopen(descriptor, "rb") as archivo:
        informacion = os.fstat(archivo.fileno())
        _exigir(stat.S_ISREG(informacion.st_mode) and informacion.st_size <= MAX_ESTADO_BYTES)
        contenido = archivo.read(MAX_ESTADO_BYTES + 1)
    _exigir(len(contenido) <= MAX_ESTADO_BYTES)
    return contenido


def documento_registro_panel(contenido: bytes) -> dict[str, Any]:
    """Analiza el registro del panel como objeto JSON, sin claves repetidas ni constantes no válidas.

    Returns:
        El documento como diccionario.
    """
    documento = json.loads(contenido, object_pairs_hook=_sin_duplicados, parse_constant=_constante_invalida)
    _exigir(isinstance(documento, dict))
    return documento


def _leer_registro(raiz: Path) -> dict[str, Any] | None:
    contenido = leer_bytes_registro_panel(raiz)
    return None if contenido is None else documento_registro_panel(contenido)


def _constante_invalida(_valor: str) -> None:
    raise EstadoPanelInvalido(ERROR_GENERICO)


def instante_utc(valor: object) -> datetime:
    """Valida y convierte un instante UTC admitido por el estado del panel.

    Returns:
        El instante con zona UTC.
    """
    _exigir(isinstance(valor, str) and INSTANTE_UTC.fullmatch(valor) is not None)
    return datetime.fromisoformat(valor.replace("Z", "+00:00"))


def _utc(instante: datetime) -> str:
    return instante.isoformat(timespec="seconds").replace("+00:00", "Z")


def _fecha(valor: str | None) -> str | None:
    if valor is not None:
        _exigir(date.fromisoformat(valor).isoformat() == valor)
    return valor


def _buena(valor: object, ultimo: datetime) -> dict[str, str] | None:
    if valor is None:
        return None
    registro = _objeto(valor, {"publicada_utc", "huella"})
    fecha = instante_utc(registro["publicada_utc"])
    _exigir(fecha <= ultimo)
    _exigir(isinstance(registro["huella"], str) and HUELLA.fullmatch(registro["huella"]) is not None)
    return {"fecha": _utc(fecha), "huella": registro["huella"]}


def _resultado(registro: dict[str, Any], ultimo: datetime) -> str | None:
    fallos, veredicto, proximo = (registro[c] for c in ("fallos_seguidos", "veredicto", "proximo_reintento_utc"))
    _exigir(type(fallos) is int and 0 <= fallos <= MAX_ENTERO_SEGURO)
    if veredicto == VERDE:
        _exigir(fallos == 0 and proximo is None)
        return None
    _exigir(veredicto in (AMBAR, ROJO) and fallos > 0)
    fecha = instante_utc(proximo)
    _exigir(fecha == ultimo + espera(fallos))
    return _utc(fecha)


def _modulo(nombre: str, entrada: object, observado: datetime) -> dict[str, Any]:
    fila = _modulo_sin_almacen(nombre, entrada, observado)
    # El paquete dice si falló por su almacén de Cursos: un código cerrado, nunca el motivo libre. Sin ese fallo la fila
    # conserva su forma anterior, que también lee un servidor que aún no conoce el campo.
    codigo = codigo_en(entrada["motivo"]) if nombre == PAQUETE and fila["veredicto"] in (AMBAR, ROJO) else None
    if codigo is not None:
        fila["motivoAlmacen"] = codigo
    return fila


def _modulo_sin_almacen(nombre: str, entrada: object, observado: datetime) -> dict[str, Any]:
    registro = _objeto(entrada, CAMPOS_REGISTRO)
    _exigir(registro["motivo"] is None or isinstance(registro["motivo"], str))
    resultado = {
        "id": nombre,
        "ultimoIntento": None,
        "veredicto": None,
        "ultimaVersionBuena": None,
        "fallos": 0,
        "proximoReintento": None,
    }
    _exigir(type(registro["fallos_seguidos"]) is int)
    if registro["veredicto"] is None:
        _exigir(registro == SIN_INTENTO)
        return resultado
    ultimo = instante_utc(registro["ultimo_intento_utc"])
    _exigir(ultimo <= observado)
    return {
        "id": nombre,
        "ultimoIntento": _utc(ultimo),
        "veredicto": registro["veredicto"],
        "ultimaVersionBuena": _buena(registro["ultima_version_buena"], ultimo),
        "fallos": registro["fallos_seguidos"],
        "proximoReintento": _resultado(registro, ultimo),
    }


def modulos_de_registro_panel(documento: dict[str, Any] | None, observado: datetime) -> list[dict[str, Any]]:
    """Proyecta el estado de cada módulo del panel desde el registro; sin registro, todos quedan sin intento.

    Returns:
        Una fila de estado por módulo, en el orden del panel.
    """
    _exigir((*(modulo.id for modulo in MODULOS), PAQUETE) == IDS)
    if documento is None:
        return [_modulo(nombre, SIN_INTENTO, observado) for nombre in IDS]
    comprobar_cabecera_estado(documento)
    actualizacion = documento["actualizacion"]
    comienzo = instante_utc(actualizacion["comienzo_utc"])
    _exigir(comienzo <= observado)
    _exigir(isinstance(actualizacion["veredicto"], str) and isinstance(actualizacion["informe"], str))
    registros = _objeto(documento["modulos"], set(IDS))
    return [_modulo(nombre, registros[nombre], comienzo) for nombre in IDS]


def _operacion(registro: dict[str, Any] | None) -> dict[str, Any] | None:
    if registro is None:
        return None
    evidencia = registro["evidencia"]
    return {
        "ciclo": registro["ciclo"],
        "inicioEn": registro["inicio_utc"],
        "finEn": registro["fin_utc"],
        "resultado": registro["resultado"],
        "remoto": registro["remoto"],
        "ultimoIntentoRemotoEn": registro["ultimo_intento_remoto_utc"],
        "huellaEvidencia": evidencia["sha256"] if evidencia is not None else None,
    }


def _fuentes(raiz: Path, comprobaciones: dict[str, Any], ahora: datetime) -> list[dict[str, Any]]:
    filas = []
    for nombre, fuente in FUENTES.items():
        fecha = fecha_de_la_fuente(raiz, nombre)
        fila = {
            "id": nombre,
            "politica": fuente.politica,
            "fecha": _fecha(fecha.isoformat()) if fecha else None,
            "plazoDias": plazo(nombre),
            "ultimaOperacion": _operacion(comprobaciones["fuentes"].get(nombre)),
        }
        # Una edición nueva observada es un hecho, no un fallo, y su aviso es de esa fila: viajan solo cuando los hay,
        # y sin ellos la fila conserva la forma que también lee un servidor que aún no conoce los campos.
        filas.append({**fila, **campos_del_panel(raiz, nombre, ahora)})
    return filas


def _comprobaciones(registro: dict[str, Any], ahora: datetime) -> dict[str, Any]:
    reloj = registro["reloj_utc"]
    # El lector ya valida toda la cronología interna. Comparar antes de truncar el reloj de observación.
    _exigir(reloj is None or datetime.fromisoformat(reloj.replace("Z", "+00:00")) <= ahora)
    conjuntos = []
    for conjunto in CONJUNTOS:
        ultima = registro["conjuntos"].get(conjunto.id)
        conjuntos.append(
            {
                "id": conjunto.id,
                "fuente": conjunto.fuente,
                "alcance": conjunto.alcance,
                "operacion": conjunto.operacion,
                "intervaloDias": conjunto.intervalo_dias,
                "revisionNecesaria": conjunto.operacion == "revision"
                or (conjunto.operacion == "descargar" and conjunto.alcance in ALCANCES_CON_REVISION),
                "ultimaComprobacion": {
                    "fecha": ultima["comprobado_utc"],
                    "ciclo": ultima["ciclo"],
                    "huellaEvidencia": ultima["sha256_evidencia"],
                }
                if ultima is not None
                else None,
            }
        )
    return {
        "registradoEn": reloj,
        "reconstruccionPendiente": registro["reconstruccion_pendiente"],
        "conjuntos": conjuntos,
    }


def _consulta_parcial(raiz: Path, fuente: str) -> dict[str, int] | None:
    marca = consulta_parcial(raiz, fuente)
    if marca is None:
        return None
    return {"unidadesFallidas": marca["unidades_fallidas"], "unidadesEsperadas": marca["unidades_esperadas"]}


def _fundae_sin_aplicar(raiz: Path) -> bool:
    """Si el almacén de Cursos conserva sin aplicar un conjunto de FUNDAE: un pendiente o el validado aún sin instalar.

    Returns:
        True si alguno se calculó con otras identidades o no trae altas para un almacén sin las suyas.
    """
    base = raiz / almacen_catalogo.RUTA
    if not (base / "validacion.json").is_file():
        return False
    return fundae_conservado_sin_aplicar(raiz, base) is not None


def salida_parcial(raiz: Path, fuente: str) -> dict[str, object] | None:
    """Lo que la última validación admitida de una fuente dice que su salida no recoge: motivos, descartes, avisos.

    Returns:
        `motivos` (códigos cerrados), `descartadas` y `aRevisar` (recuentos), o None si no hay nada que decir.
    """
    ruta = raiz / DATOS_RELATIVOS / "validados" / fuente / "validacion.json"
    if fuente not in ("fundae", "barcelonactiva", "enlaces", "hp_life", "cibervoluntarios") or not ruta.is_file():
        return None
    informe = json.loads(ruta.read_text(encoding="utf-8"))
    if not str(informe.get("estado", "")).startswith("Admitido"):
        return None
    marca = informe.get("consulta_parcial") or {}
    motivos = [m for m in str(marca.get("motivo", "")).split(", ") if m]
    # Los avisos del Cibernàrium (plazas que no se pudieron leer, cambio de portlet) se dicen una vez por motivo.
    motivos += sorted({str(a.get("motivo")) for a in informe.get("avisos", [])} - set(motivos))
    if fuente == "fundae" and _fundae_sin_aplicar(raiz):
        motivos.append(CONJUNTO_SIN_APLICAR)
    # Un motivo que ya no está en la lista (un informe guardado antes) se filtra; lo demás se conserva. La lista está
    # atada a los motivos que escriben los lectores por una prueba (test_salida_parcial_panel).
    motivos = [m for m in motivos if m in MOTIVOS_SALIDA_PARCIAL]
    salida = {
        "motivos": motivos,
        "descartadas": len(informe.get("descartadas", [])),
        "aRevisar": len(informe.get("a_revisar", [])),
    }
    if not (motivos or salida["descartadas"] or salida["aRevisar"]):
        return None
    validar_salida_parcial(salida)
    return salida


def recuento_de_enlaces(raiz: Path, fuente: str) -> dict[str, int] | None:
    """Los enlaces que la última validación admitida de la comprobación de enlaces dice haber comprobado.

    Returns:
        `comprobados`, `ocultos` y `sinComprobar`, o None si la fuente no es la de enlaces o no hay una validación
        admitida con sus cifras.
    """
    ruta = raiz / DATOS_RELATIVOS / "validados" / fuente / "validacion.json"
    if fuente != "enlaces" or not ruta.is_file():
        return None
    informe = json.loads(ruta.read_text(encoding="utf-8"))
    if not str(informe.get("estado", "")).startswith("Admitido"):
        return None
    cobertura = informe.get("cobertura")
    if not isinstance(cobertura, dict) or not {"comprobados", "ocultos", "sin_comprobar"} <= set(cobertura):
        return None
    recuento = {
        "comprobados": cobertura["comprobados"],
        "ocultos": cobertura["ocultos"],
        "sinComprobar": cobertura["sin_comprobar"],
    }
    validar_recuento_de_enlaces(recuento)
    return recuento


def _seguimiento_remoto(raiz: Path, registro: dict[str, object], ahora: datetime) -> list[dict[str, object]]:
    """Expone hechos remotos separados sin mensajes libres, URLs ni rutas privadas.

    La próxima consulta sigue la regla del planificador (cadencia tras un éxito, espera escalonada tras fallos);
    la consulta parcial son solo recuentos del último conjunto admitido. Ambos son avisos del panel. La cobertura
    limitada es una propiedad de la fuente, separada del resultado de cada consulta. El cambio de modo de su regla
    de retirada de la última semana también es un aviso, y lo es lo que su regla activa retira de golpe por encima del
    umbral (aviso_de_la_retirada).

    Returns:
        Último resultado conservado, pendientes por conjunto, fallos seguidos, próxima consulta, consulta parcial y
        motivo de cobertura limitada.
    """
    filas = []
    retenidas = retencion_composicion.leer(raiz / almacen_catalogo.RUTA)
    for fuente in FUENTES:
        seguimiento = registro["seguimiento_remoto"].get(fuente, {})
        pendientes = seguimiento.get("incidencias_pendientes", {})
        proxima = proxima_consulta(registro, fuente)
        salida = salida_parcial(raiz, fuente)
        filas.append(
            {
                "fuente": fuente,
                "ultimoIntento": _operacion(seguimiento.get("ultimo_intento")),
                "incidenciasPendientes": [
                    {"conjunto": conjunto, "operacion": _operacion(pendientes[conjunto])}
                    for conjunto in sorted(pendientes)
                ],
                "fallosSeguidos": comprobaciones_remotas.fallos_registrados(registro, fuente),
                "proximaConsultaEn": None if proxima is None else proxima.isoformat(),
                "consultaParcial": _consulta_parcial(raiz, fuente),
                "coberturaLimitada": COBERTURAS_LIMITADAS.get(fuente),
                **({"salidaParcial": salida} if salida is not None else {}),
                **({"enlaces": enlaces} if (enlaces := recuento_de_enlaces(raiz, fuente)) is not None else {}),
                **({"retirada": aviso} if (aviso := aviso_de_la_retirada(raiz, fuente, ahora)) is not None else {}),
                **({"retiradaAmplia": amplia} if (amplia := retirada_amplia(raiz, fuente)) is not None else {}),
                **({"retencionComposicion": retenidas[fuente]} if fuente in retenidas else {}),
            }
        )
    return filas


def _catalogo_fuentes() -> list[dict[str, str]]:
    """Proyecta fichas verificadas contra el registro estático; una candidata nunca se activa por aparecer aquí.

    Returns:
        Identidad legible, tema y modalidad, sin rutas ni instrucciones de ejecución.
    """
    _exigir(not comprobar_registro())
    candidatos = {fuente.id for fuente in PRODUCTORES_CANDIDATOS}
    return [
        {
            "id": descriptor.id,
            "nombre": descriptor.nombre,
            "tema": descriptor.tema,
            "modalidad": "candidata" if descriptor.id in candidatos else descriptor.modalidad,
        }
        for tema in TEMAS_PANEL
        for descriptor in cargar_descriptores(tema=tema)
    ]


def estado_panel(raiz: Path, ahora: datetime, version: int = VERSION_PANEL_EMITIDA) -> dict[str, Any]:
    """Obtiene los hechos y metadatos sin escribir, descargar ni acreditar una entrega activa.

    Args:
        raiz: Instalación cuyos datos operativos se observan.
        ahora: Instante UTC con zona horaria; no se consulta un reloj adicional.
        version: La v5 o la v6, que añade los cambios retenidos; por omisión, la que lee el servidor publicado.

    Returns:
        Instantánea saneada con fuentes y módulos en el orden de sus registros.

    Raises:
        EstadoPanelInvalido: Si el reloj o cualquier entrada necesaria no es válido.
    """
    try:
        _exigir(isinstance(ahora, datetime) and ahora.tzinfo is not None and ahora.utcoffset() == UTC.utcoffset(ahora))
        _exigir(version in (VERSION_PANEL_REVISION_PENDIENTE, VERSION_PANEL_RETENIDOS))
        modulos = modulos_de_registro_panel(_leer_registro(raiz), ahora)
        registro = comprobaciones_remotas.leer_registro(raiz)
        comprobaciones = _comprobaciones(registro, ahora)
        snapshot = {
            "version": version,
            "observadoEn": ahora.isoformat().replace("+00:00", "Z"),
            "fuentes": _fuentes(raiz, registro, ahora),
            "modulos": modulos,
            # Fecha desde la que la revisión está pendiente: solo un aviso del panel, nunca una caducidad.
            CLAVE_REVISION_PENDIENTE: _fecha(revision_pendiente_de_la_formacion_abierta(raiz, ahora.date())),
            "comprobaciones": comprobaciones,
        }
        if registro["version"] == comprobaciones_remotas.VERSION_REGISTRO:
            snapshot["seguimientoRemoto"] = _seguimiento_remoto(raiz, registro, ahora)
        snapshot["catalogoFuentes"] = _catalogo_fuentes()
        snapshot.setdefault("seguimientoRemoto", None)
        if version >= VERSION_PANEL_RETENIDOS:
            snapshot[CLAVE_RETENIDOS] = retenidos_del_panel(raiz)
        validar_catalogo_panel(snapshot)
        return snapshot
    except (ErrorFuente, OSError, ValueError, TypeError, OverflowError, RecursionError) as error:
        raise EstadoPanelInvalido(ERROR_GENERICO) from error


def main() -> int:
    """Escribe solo JSON o un error genérico sin rutas.

    Returns:
        Cero si hay instantánea válida; uno si no se puede obtener.
    """
    try:
        resultado = estado_panel(RAIZ, datetime.now(UTC))
    except EstadoPanelInvalido:
        print(ERROR_GENERICO, file=sys.stderr)
        return 1
    print(json.dumps(resultado, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
