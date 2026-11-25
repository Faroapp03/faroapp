"""Valida la evidencia de la instantánea v2 sin consultar originales ni modificar el historial."""

import re
from datetime import date, datetime
from typing import Any

ALCANCES = frozenset(
    {
        "copia-local",
        "edicion-conocida",
        "catalogo-actual",
        "serie-abierta",
        "descubre-edicion",
        "contenido-actual-acotado",
        "recurso-actual-sin-edicion",
        "entradas-admitidas",
        "productor-externo",
    }
)
REVISIONES = frozenset({"edicion-conocida", "contenido-actual-acotado", "recurso-actual-sin-edicion"})
OPERACIONES = frozenset({"revision", "descargar", "integridad", "recomponer"})
RESULTADOS = frozenset({"en-curso", "interrumpido", "comprobada", "completa", "parcial", "fallo", "local"})
ERROR = "Evidencia del panel no verificable."
MAX_CONJUNTOS = 64


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ValueError(ERROR)


def _objeto(valor: object, campos: str) -> dict[str, Any]:
    _exigir(type(valor) is dict and set(valor) == set(campos.split(",")))
    return valor


def _patron(valor: object, patron: str) -> None:
    _exigir(isinstance(valor, str) and re.fullmatch(patron, valor) is not None)


def _huella(valor: object) -> None:
    _patron(valor, r"[0-9a-f]{64}")


def _ciclo(valor: object) -> None:
    _patron(valor, r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")


def instante_panel(valor: object) -> datetime:
    """Lee segundos o microsegundos UTC exactos; nunca redondea la evidencia.

    Returns:
        Instante consciente para comparar su cronología sin pérdida de precisión.
    """
    _patron(valor, r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{6})?Z")
    return datetime.fromisoformat(valor.replace("Z", "+00:00"))


def _operacion(valor: object, reloj: datetime | None) -> dict[str, Any] | None:
    if valor is None:
        return None
    fila = _objeto(valor, "ciclo,inicioEn,finEn,resultado,remoto,ultimoIntentoRemotoEn,huellaEvidencia")
    _ciclo(fila["ciclo"])
    inicio = instante_panel(fila["inicioEn"])
    _exigir(reloj is not None and inicio <= reloj)
    _exigir(isinstance(fila["resultado"], str) and fila["resultado"] in RESULTADOS)
    _exigir(type(fila["remoto"]) is bool)
    ultimo = fila["ultimoIntentoRemotoEn"]
    _exigir(ultimo is None or instante_panel(ultimo) <= inicio)
    _exigir(not fila["remoto"] or (ultimo is not None and instante_panel(ultimo) == inicio))
    if fila["huellaEvidencia"] is not None:
        _huella(fila["huellaEvidencia"])
    if fila["resultado"] == "en-curso":
        _exigir(fila["finEn"] is None and fila["huellaEvidencia"] is None)
    else:
        _exigir(inicio <= instante_panel(fila["finEn"]) <= reloj)
    if fila["resultado"] in ("comprobada", "completa"):
        _exigir(fila["remoto"] and fila["huellaEvidencia"] is not None)
    return fila


def _ultima_comprobacion(fila: dict[str, Any], operacion: dict[str, Any] | None, reloj: datetime | None) -> None:
    ultima = fila["ultimaComprobacion"]
    if ultima is None:
        return
    _objeto(ultima, "fecha,ciclo,huellaEvidencia")
    _ciclo(ultima["ciclo"])
    _huella(ultima["huellaEvidencia"])
    fecha = instante_panel(ultima["fecha"])
    _exigir(reloj is not None and fecha <= reloj and operacion is not None)
    _exigir(fila["operacion"] == "descargar")
    if ultima["ciclo"] == operacion["ciclo"]:
        _exigir(operacion["remoto"] and operacion["resultado"] in ("comprobada", "parcial"))
        _exigir(ultima["huellaEvidencia"] == operacion["huellaEvidencia"])
        _exigir(fecha == instante_panel(operacion["finEn"]))
    else:
        _exigir(fecha <= instante_panel(operacion["inicioEn"]))


def _conjunto(valor: object, operaciones: dict[str, Any], reloj: datetime | None) -> dict[str, Any]:
    fila = _objeto(valor, "id,fuente,alcance,operacion,intervaloDias,revisionNecesaria,ultimaComprobacion")
    _patron(fila["id"], r"[a-z][a-z0-9_-]{0,63}")
    _exigir(isinstance(fila["alcance"], str) and fila["alcance"] in ALCANCES)
    _exigir(isinstance(fila["operacion"], str) and fila["operacion"] in OPERACIONES)
    intervalo = fila["intervaloDias"]
    if fila["operacion"] == "descargar":
        _exigir(type(intervalo) is int and 0 < intervalo <= (1 << 53) - 1)
    else:
        _exigir(intervalo is None)
    revision = fila["operacion"] == "revision" or (fila["operacion"] == "descargar" and fila["alcance"] in REVISIONES)
    _exigir(type(fila["revisionNecesaria"]) is bool and fila["revisionNecesaria"] == revision)
    fuente = fila["fuente"]
    if fuente is None:
        _exigir(fila["operacion"] == "revision" and fila["alcance"] == "productor-externo")
        _exigir(fila["ultimaComprobacion"] is None)
    else:
        _exigir(isinstance(fuente, str) and fuente in operaciones and fila["alcance"] != "productor-externo")
        _ultima_comprobacion(fila, operaciones[fuente], reloj)
    return fila


def validar_comprobaciones_panel(snapshot: dict[str, Any]) -> None:
    """Valida relaciones y cobertura declarada tras validar los campos comunes de la instantánea.

    No acredita una versión servida ni convierte comprobaciones históricas en una consulta nueva.
    """
    documento = _objeto(snapshot["comprobaciones"], "registradoEn,reconstruccionPendiente,conjuntos")
    reloj = None if documento["registradoEn"] is None else instante_panel(documento["registradoEn"])
    _exigir(reloj is None or reloj <= instante_panel(snapshot["observadoEn"]))
    _exigir(type(documento["reconstruccionPendiente"]) is bool)
    _exigir(reloj is not None or not documento["reconstruccionPendiente"])
    operaciones = {f["id"]: _operacion(f["ultimaOperacion"], reloj) for f in snapshot["fuentes"]}
    entradas = documento["conjuntos"]
    _exigir(type(entradas) is list and 0 < len(entradas) <= MAX_CONJUNTOS)
    conjuntos = [_conjunto(fila, operaciones, reloj) for fila in entradas]
    _exigir(len({fila["id"] for fila in conjuntos}) == len(conjuntos))
    _exigir({fila["fuente"] for fila in conjuntos if fila["fuente"] is not None} == set(operaciones))
    for fuente, operacion in operaciones.items():
        if operacion is not None and operacion["resultado"] == "comprobada":
            _exigir(
                any(
                    fila["fuente"] == fuente
                    and fila["ultimaComprobacion"] is not None
                    and fila["ultimaComprobacion"]["ciclo"] == operacion["ciclo"]
                    for fila in conjuntos
                )
            )


CAMPOS_SEGUIMIENTO_ANTERIOR = "fuente,ultimoIntento,incidenciasPendientes"
CAMPOS_SEGUIMIENTO_AVISOS = CAMPOS_SEGUIMIENTO_ANTERIOR + ",fallosSeguidos,proximaConsultaEn,consultaParcial"
CAMPOS_SEGUIMIENTO = CAMPOS_SEGUIMIENTO_AVISOS + ",coberturaLimitada"
MOTIVOS_COBERTURA_LIMITADA = frozenset({"censo-con-copias-fijadas", "indices-sin-censo"})
# Por qué la salida publicada de una fuente no recoge toda su consulta: códigos cerrados, nunca un motivo libre.
MOTIVOS_SALIDA_PARCIAL = frozenset(
    {
        "indice-caido",
        "fichas-fallidas",
        "tope-de-consultas",
        "plazo-de-la-descarga",
        "censo-digitalizate-sin-lista",
        "censo-digitalizate-fichas-fallidas",
        "censo-digitalizate-recuento-descuadrado",
        "censo-digitalizate-forma-inesperada",
        "censo-digitalizate-tope-de-proveedores",
        "censo-digitalizate-contradice-al-indice",
        "censo-digitalizate-sin-lista-de-baja",
        "fundae-conjunto-sin-aplicar",
        "censo-ia-parcial",
        "censo-del-canal-sin-admitir-completo",
        "pagina-de-ambitos-caida",
        "portlet-no-encontrado",
        "ambito-ia-sin-nombre",
        "ambito-ia-cambiado",
        "portlet-cambiado",
        "codigo-de-inscripcion-desconocido",
        "texto-de-plazas-desconocido",
        "dominio-con-limite",
        "indice-de-hp-life-sin-completar",
        "ficha-integra-fuera-del-listado",
        "ausente-del-listado-sin-confirmar",
        "gratuidad-de-hp-life-sin-comprobar",
        "curso-fuera-del-catalogo-con-su-pagina",
        "curso-fuera-del-catalogo-sin-confirmar",
        "estado-desconocido-en-el-catalogo",
    }
)
FECHA_PANEL = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
MAX_ENTERO_PANEL = (1 << 53) - 1


def _validar_cobertura(fila: dict[str, object], resultado: object) -> None:
    """La cobertura limitada es un motivo cerrado: solo una fuente así queda «completa» y nunca «comprobada»."""
    motivo = fila["coberturaLimitada"]
    _exigir(motivo is None or (isinstance(motivo, str) and motivo in MOTIVOS_COBERTURA_LIMITADA))
    _exigir(resultado != "completa" or motivo is not None)
    _exigir(resultado != "comprobada" or motivo is None)


def _validar_avisos_de_consulta(fila: dict[str, object], ultimo: dict[str, object] | None) -> None:
    """Fallos, próxima consulta y consulta parcial cuadran con el último intento; una parcial nunca es completa."""
    fallos, proxima, parcial = fila["fallosSeguidos"], fila["proximaConsultaEn"], fila["consultaParcial"]
    _exigir(type(fallos) is int and 0 <= fallos <= MAX_ENTERO_PANEL)
    resultado = None if ultimo is None else ultimo["resultado"]
    if "coberturaLimitada" in fila:
        _validar_cobertura(fila, resultado)
    else:
        _exigir(resultado != "completa")
    if resultado in (None, "comprobada", "completa", "parcial"):
        _exigir(fallos == 0)
    if resultado in ("fallo", "interrumpido"):
        _exigir(fallos >= 1)
    if ultimo is None:
        _exigir(proxima is None)
    if proxima is not None:
        _exigir(isinstance(proxima, str) and FECHA_PANEL.fullmatch(proxima) is not None)
        _exigir(date.fromisoformat(proxima).isoformat() == proxima)
        _exigir(proxima > ultimo["inicioEn"][:10])
    if parcial is not None:
        recuento = _objeto(parcial, "unidadesFallidas,unidadesEsperadas")
        fallidas, esperadas = recuento["unidadesFallidas"], recuento["unidadesEsperadas"]
        _exigir(type(fallidas) is int and type(esperadas) is int and 0 < fallidas <= esperadas <= MAX_ENTERO_PANEL)
        _exigir(resultado not in ("comprobada", "completa"))


def validar_salida_parcial(valor: object) -> None:
    """La salida parcial solo viaja con valor: motivos de la lista, filas descartadas y excluidas por revisar."""
    salida = _objeto(valor, "motivos,descartadas,aRevisar")
    motivos = salida["motivos"]
    _exigir(type(motivos) is list and len(set(motivos)) == len(motivos))
    _exigir(all(isinstance(m, str) and m in MOTIVOS_SALIDA_PARCIAL for m in motivos))
    for campo in ("descartadas", "aRevisar"):
        _exigir(type(salida[campo]) is int and 0 <= salida[campo] <= MAX_ENTERO_PANEL)
    _exigir(bool(motivos) or salida["descartadas"] > 0 or salida["aRevisar"] > 0)


def validar_recuento_de_enlaces(valor: object) -> None:
    """El recuento de enlaces solo viaja con valor: enteros no negativos y ocultos que caben entre los enlaces."""
    recuento = _objeto(valor, "comprobados,ocultos,sinComprobar")
    _exigir(all(type(recuento[campo]) is int and 0 <= recuento[campo] <= MAX_ENTERO_PANEL for campo in recuento))
    _exigir(recuento["ocultos"] <= recuento["comprobados"] + recuento["sinComprobar"])


# Los cambios de modo de la regla de retirada de una fuente que avisa el panel (activacion_de_la_retirada).
CAMBIOS_DE_LA_RETIRADA = frozenset({"activada", "vuelta-a-sombra"})


def validar_aviso_de_la_retirada(valor: object) -> None:
    """El aviso del cambio de modo de la regla de retirada solo viaja con valor: el cambio, sus decisiones y cuándo."""
    aviso = _objeto(valor, "cambio,decisiones,en")
    _exigir(aviso["cambio"] in CAMBIOS_DE_LA_RETIRADA)
    _exigir(type(aviso["decisiones"]) is int and 0 <= aviso["decisiones"] <= MAX_ENTERO_PANEL)
    instante_panel(aviso["en"])


def validar_retirada_amplia(valor: object) -> None:
    """El aviso de lo que la regla activa retira de golpe: cuántos cursos retira, de cuántos leídos, y cuándo."""
    aviso = _objeto(valor, "retiradas,cursos,en")
    _exigir(
        all(type(aviso[cifra]) is int and 0 < aviso[cifra] <= MAX_ENTERO_PANEL for cifra in ("retiradas", "cursos"))
    )
    _exigir(aviso["retiradas"] <= aviso["cursos"])
    instante_panel(aviso["en"])


def validar_retencion_composicion(entrada: object) -> None:
    """Comprueba la cronología y el motivo cerrado de la retención de una fuente."""
    aviso = _objeto(entrada, "motivo,desde,versionEn")
    _exigir(aviso["motivo"] == "documento-excesivo")
    _exigir(instante_panel(aviso["versionEn"]) <= instante_panel(aviso["desde"]))


# Las claves del seguimiento de una fuente que solo viajan con valor, y cómo se valida cada una.
OPCIONALES_SEGUIMIENTO = (
    ("salidaParcial", validar_salida_parcial),
    ("enlaces", validar_recuento_de_enlaces),
    ("retirada", validar_aviso_de_la_retirada),
    ("retiradaAmplia", validar_retirada_amplia),
    ("retencionComposicion", validar_retencion_composicion),
)


def validar_seguimiento_panel(snapshot: dict[str, object]) -> None:
    """Comprueba el seguimiento remoto del panel sin confundir pendientes con cierres o disponibilidad."""
    entradas = snapshot["seguimientoRemoto"]
    fuentes = {f["id"]: f["ultimaOperacion"] for f in snapshot["fuentes"]}
    conjuntos = {c["id"]: c for c in snapshot["comprobaciones"]["conjuntos"]}
    reloj = snapshot["comprobaciones"]["registradoEn"]
    reloj = None if reloj is None else instante_panel(reloj)
    _exigir(type(entradas) is list and len(entradas) == len(fuentes))
    vistas = set()
    for entrada in entradas:
        # Las observaciones guardadas antes de los avisos o de la cobertura conservan su forma cerrada anterior.
        _exigir(type(entrada) is dict)
        campos = CAMPOS_SEGUIMIENTO_AVISOS if "fallosSeguidos" in entrada else CAMPOS_SEGUIMIENTO_ANTERIOR
        campos = CAMPOS_SEGUIMIENTO if "coberturaLimitada" in entrada else campos
        # Como `motivoAlmacen`: el campo solo viaja cuando tiene valor, y sin él la fila conserva su forma.
        presentes = [(campo, validar) for campo, validar in OPCIONALES_SEGUIMIENTO if campo in entrada]
        fila = _objeto(entrada, ",".join([campos, *(campo for campo, _ in presentes)]))
        for campo, validar in presentes:
            validar(fila[campo])
        fuente = fila["fuente"]
        _exigir(isinstance(fuente, str) and fuente in fuentes and fuente not in vistas)
        vistas.add(fuente)
        ultimo = _operacion(fila["ultimoIntento"], reloj)
        if "fallosSeguidos" in fila:
            _validar_avisos_de_consulta(fila, ultimo)
        else:
            _exigir(ultimo is None or ultimo["resultado"] != "completa")
        actual = fuentes[fuente]
        _exigir(ultimo is None or ultimo["remoto"])
        if actual is not None and actual["remoto"]:
            _exigir(ultimo == actual)
        if ultimo is not None:
            _exigir(actual is not None and ultimo["inicioEn"] == actual["ultimoIntentoRemotoEn"])
            if not actual["remoto"]:
                _exigir(
                    ultimo["finEn"] is not None
                    and instante_panel(ultimo["finEn"]) <= instante_panel(actual["inicioEn"])
                )
        # Una consulta completa ya resolvió las incidencias anteriores de su fuente.
        _exigir(ultimo is None or ultimo["resultado"] != "completa" or not fila["incidenciasPendientes"])
        _validar_pendientes_panel(fila["incidenciasPendientes"], fuente, ultimo, conjuntos, reloj)


def _validar_pendientes_panel(
    entradas: object,
    fuente: str,
    ultimo: dict[str, object] | None,
    conjuntos: dict[str, object],
    reloj: datetime | None,
) -> None:
    """Vincula cada pendiente con su fuente, tiempo y última comprobación positiva."""
    _exigir(type(entradas) is list and len(entradas) <= MAX_CONJUNTOS)
    vistos = set()
    for entrada in entradas:
        fila = _objeto(entrada, "conjunto,operacion")
        conjunto = fila["conjunto"]
        _exigir(isinstance(conjunto, str) and conjunto in conjuntos and conjunto not in vistos)
        vistos.add(conjunto)
        declarado = conjuntos[conjunto]
        _exigir(declarado["fuente"] == fuente and declarado["operacion"] == "descargar")
        operacion = _operacion(fila["operacion"], reloj)
        _exigir(operacion is not None and operacion["remoto"] and ultimo is not None)
        _exigir(operacion["resultado"] in ("fallo", "parcial", "interrumpido"))
        _exigir(instante_panel(operacion["finEn"]) <= instante_panel(ultimo["finEn"] or ultimo["inicioEn"]))
        positiva = declarado["ultimaComprobacion"]
        _exigir(
            positiva is None
            or (
                positiva["ciclo"] != operacion["ciclo"]
                and instante_panel(positiva["fecha"]) <= instante_panel(operacion["finEn"])
            )
        )


TEMAS_PANEL = ("cursos", "ocupaciones", "ia_y_trabajo", "mercado", "derechos", "biblioteca", "comun", "derivados")
MAX_NOMBRE_FUENTE = 240
PRIMER_CARACTER_VISIBLE = 32
BORRADO_ASCII = 127
MODALIDADES_PANEL = frozenset({"operativa", "candidata", "lectura-candidata", "productor-externo", "productor-local"})


def validar_catalogo_panel(snapshot: dict[str, object]) -> None:
    """Contrasta metadatos cerrados y pertenencia operativa; nunca ejecuta un lector declarado en JSON."""
    filas = snapshot["catalogoFuentes"]
    _exigir(type(filas) is list and 0 < len(filas) <= MAX_CONJUNTOS)
    vistos = set()
    activos = set()
    for entrada in filas:
        fila = _objeto(entrada, "id,nombre,tema,modalidad")
        identidad = fila["id"]
        _patron(identidad, r"[a-z][a-z0-9_]{0,63}")
        _exigir(identidad not in vistos)
        vistos.add(identidad)
        nombre = fila["nombre"]
        _exigir(isinstance(nombre, str) and 0 < len(nombre) <= MAX_NOMBRE_FUENTE and nombre == nombre.strip())
        _exigir(all(ord(c) >= PRIMER_CARACTER_VISIBLE and ord(c) != BORRADO_ASCII for c in nombre))
        _exigir(isinstance(fila["tema"], str) and fila["tema"] in TEMAS_PANEL)
        _exigir(isinstance(fila["modalidad"], str) and fila["modalidad"] in MODALIDADES_PANEL)
        if fila["modalidad"] == "operativa":
            activos.add(identidad)
    _exigir(activos == {fila["id"] for fila in snapshot["fuentes"]})


# Versiones de la instantánea del panel. La v5 solo renombra la fecha desde la que está pendiente la revisión de
# Formación abierta: es un aviso del panel, nunca una caducidad, y hasta la v4 viajaba como `formacionAbiertaCaduca`.
# Los recibos guardados con versiones anteriores siguen siendo válidos con su nombre de entonces.
VERSION_PANEL_REVISION_PENDIENTE = 5
# La v6 añade el bloque `retenidos` (cuarentena_panel): los cambios que esperan la decisión de una persona.
VERSION_PANEL_RETENIDOS = 6
VERSIONES_PANEL = (1, 2, 3, 4, VERSION_PANEL_REVISION_PENDIENTE, VERSION_PANEL_RETENIDOS)
# La versión que emite el estado del panel es la que ya lee el servidor: su lector rechaza una versión que no conoce y
# cualquier campo de más, así que la v6 se emite cuando el servidor publicado sepa leerla.
VERSION_PANEL_EMITIDA = VERSION_PANEL_REVISION_PENDIENTE
CLAVE_REVISION_PENDIENTE = "formacionAbiertaRevisionPendiente"
CLAVE_REVISION_HASTA_V4 = "formacionAbiertaCaduca"


def clave_revision_pendiente(version: int) -> str:
    """Nombre con el que cada versión de la instantánea publica la revisión pendiente de Formación abierta.

    Returns:
        `formacionAbiertaRevisionPendiente` desde la v5; `formacionAbiertaCaduca` hasta la v4.
    """
    return CLAVE_REVISION_PENDIENTE if version >= VERSION_PANEL_REVISION_PENDIENTE else CLAVE_REVISION_HASTA_V4
