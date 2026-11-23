"""Inventario de metadatos observado, sin actualizar, descargar ni activar datos.

Los registros operativos siguen siendo la autoridad. El manifiesto acredita procedencia
de una entrega, no regeneración ni ejecución autónoma. No se leen contenidos de originales,
modelos, registros de uso ni credenciales. Los consumidores declarados no prueban uso en sesión.
"""

import argparse
import json
import re
from pathlib import Path, PurePosixPath
from typing import Any

import plataforma_datos.derivados.fuentes.datos_globales.lector as datos_globales
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, RAIZ
from plataforma_datos.orquestacion.exportar_paquete import ESCRITOS_POR_HERRAMIENTAS, PREPARADOS_SIN_USO
from plataforma_datos.orquestacion.modulos import ENTRADAS_EXTERNAS, MODULOS, carpetas
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS
from plataforma_datos.orquestacion.reconstruir import FUENTES_EN_ORDEN, SOLO_VALIDAR

# Casa por contenido principal, no por formato ni por consumidor: tareas ocupacionales
# en Ocupaciones; estudios de exposición a la IA en IA y trabajo. Fuentes nuevas sin clasificar hasta revisión.
# Un tema identifica la casa del productor, no limita los temas de sus consumidores.
DOMINIOS = {
    "cursos": {
        "formacion",
        "consorci",
        "agencia",
        "acreditacion",
        "citilab",
        "abierta",
        "certificados2016",
        "actic",
        "barcelonactiva",
        "fundae",
        "memoria",
        "hp_life",
        "cibervoluntarios",
        "claude_academy",
    },
    "ocupaciones": {"esco", "oit", "clasificaciones", "textos"},
    "ia_y_trabajo": {
        "cambra",
        "hechos_informe",
        "tich",
        "mundo_eurostat",
        "tic_llars",
        "clima_empresarial",
        "ue_eurostat",
        "decada_digital",
        "eurobarometro",
        "ceo_panel",
        "ia_nacional",
        "encuestas_isco4",
    },
    "mercado": {
        "cataluna",
        "ocupados",
        "censo",
        "salarios",
        "sectores",
        "empresas",
        "observatori",
        "ilostat",
        "necesidades",
        "perfiles",
    },
    "derechos": {"derechos"},
    "biblioteca": {"lecturas", "enlaces_lecturas"},
    "comun": {"idescat", "catalan", "nombres", "territorios"},
    "derivados": {"datos_globales"},
}

# Contrato versionado leído por el exportador y ligado por SHA a metodos.json.
# No concede entrada al resto de plataforma_datos ni a archivos elegidos por el manifiesto.
CONDICIONES_METODOS = "plataforma_datos/ia_y_trabajo/condiciones-metodos.json"
REGISTRO_HECHOS = "plataforma_datos/ia_y_trabajo/fuentes/hechos_informe/registro.json"


def _dominio(identificador: str) -> str:
    if identificador.startswith("ia_nacional_"):
        return "ia_y_trabajo"
    return next((dominio for dominio, ids in DOMINIOS.items() if identificador in ids), "desconocido")


def _comprobar_dominios() -> None:
    """Impide que una fuente tenga dos casas silenciosamente en el inventario.

    Raises:
        ValueError: Si dos temas declaran la misma fuente o contradicen su familia.
    """
    propietarios: dict[str, str] = {}
    for dominio, identificadores in DOMINIOS.items():
        for identificador in identificadores:
            if identificador in propietarios:
                raise ValueError(f"Fuente con dos temas: {identificador}")
            if identificador.startswith("ia_nacional_") and dominio != "ia_y_trabajo":
                raise ValueError(f"Tema incompatible con la familia de fuentes: {identificador}")
            propietarios[identificador] = dominio


def _ruta(texto: str) -> str:
    """Acepta rutas relativas canónicas, sin permitir lecturas ajenas al inventario.

    Returns:
        La ruta relativa sin resolver enlaces operativos.

    Raises:
        ValueError: Si la ruta escapa o no pertenece a los espacios públicos/operativos admitidos.
    """
    ruta = PurePosixPath(texto)
    if (
        not texto
        or ruta.is_absolute()
        or ".." in ruta.parts
        or "\\" in texto
        or ruta.as_posix() != texto
        or (ruta.parts[0] not in {"datos", "var", "motores"} and texto not in {CONDICIONES_METODOS, REGISTRO_HECHOS})
        or (ruta.parts[0] == "var" and ruta.parts[:2] != DATOS_RELATIVOS.parts)
    ):
        raise ValueError("Ruta ajena al inventario de datos")
    return texto


def _leer(raiz: Path, ruta: str) -> dict[str, Any]:
    return json.loads((raiz / ruta).read_text(encoding="utf-8"))


def _cobertura(ruta: str) -> str:
    versionados = {
        CONDICIONES_METODOS: "contrato-versionado-consumido-por-exportacion/metodos.py",
        REGISTRO_HECHOS: "registro-editorial-versionado-con-consumidor",
    }
    if ruta in versionados:
        return versionados[ruta]
    if any(ruta == externa or ruta.startswith(externa + "/") for externa in ENTRADAS_EXTERNAS):
        return "entrada-externa-declarada"
    if ruta.startswith(f"{DATOS_RELATIVOS.as_posix()}/originales/metodos/"):
        return "productor-fuera-del-producto-documentado-en-exportacion/metodos.py"
    if ruta.startswith("motores/ocupaciones/modelos/") or ruta.startswith("datos/fuentes/recursos-fijados/"):
        return "recurso-admitido-regeneracion-no-acreditada"
    return "productor-no-acreditado-por-este-inventario"


class _Inventario:
    """Acumulador interno; no configura la cadena ni conserva estado entre consultas."""

    def __init__(self, raiz: Path) -> None:
        self.raiz = raiz
        self.nodos: dict[str, dict[str, Any]] = {}
        self.relaciones: list[dict[str, str]] = []

    def agregar(self, identificador: str, tipo: str, **metadatos: object) -> str:
        if identificador in self.nodos:
            raise ValueError(f"Identificador duplicado en el inventario: {identificador}")
        self.nodos[identificador] = {"id": identificador, "tipo": tipo, "dominio": "desconocido", **metadatos}
        return identificador

    def conectar(self, entrada: str, salida: str, evidencia: str, certeza: str = "declarada") -> None:
        relacion = {"entrada": entrada, "salida": salida, "evidencia": evidencia, "certeza": certeza}
        if relacion not in self.relaciones:
            self.relaciones.append(relacion)

    def recurso(self, ruta: str, **metadatos: object) -> str:
        ruta = _ruta(ruta)
        identificador = f"archivo:{ruta}"
        if identificador not in self.nodos:
            self.agregar(
                identificador,
                "recurso",
                ruta=ruta,
                productor=None,
                presente=(self.raiz / ruta).exists(),
                cobertura_productor=_cobertura(ruta),
                **metadatos,
            )
        if ruta == CONDICIONES_METODOS:
            self.nodos[identificador].update(
                dominio="ia_y_trabajo",
                evidencia="plataforma_datos/orquestacion/exportacion/metodos.py:_condiciones_de_datos",
                consumidores=[
                    {
                        "ruta": "plataforma_datos/orquestacion/exportacion/metodos.py",
                        "evidencia": "_condiciones_de_datos",
                    }
                ],
            )
        if ruta == REGISTRO_HECHOS:
            self.nodos[identificador].update(
                dominio="ia_y_trabajo",
                productor="fuente:hechos_informe",
                editorial=True,
                evidencia="src/dominio/hechos-del-informe-breve.ts:import-json",
                consumidores=[
                    {"ruta": "src/dominio/hechos-del-informe-breve.ts", "evidencia": "import-json"},
                    {"ruta": "herramientas/web/comprobar-hechos-informe.ts", "evidencia": "contrato-y-plazo"},
                ],
            )
        return identificador


def _registros(inventario: _Inventario) -> dict[str, str]:
    propietarios = {}
    for modulo in MODULOS:
        for carpeta in carpetas(modulo):
            propietarios[carpeta] = f"fuente:{modulo.id}"
    for nombre, adaptador in FUENTES_EN_ORDEN:
        politica = FUENTES[nombre]
        inventario.agregar(
            f"fuente:{nombre}",
            "fuente",
            dominio=_dominio(nombre),
            productor=adaptador.__name__.replace(".", "/") + ".py",
            evidencia="plataforma_datos/orquestacion/reconstruir.py:FUENTES_EN_ORDEN",
            automatizacion={
                "red_declarada": politica.red,
                "politica": politica.politica,
                "solo_validar": nombre in SOLO_VALIDAR,
                "ejecucion_instalada": "no-acreditada",
            },
        )
    editorial = inventario.recurso(REGISTRO_HECHOS)
    inventario.conectar("fuente:hechos_informe", editorial, "registro editorial versionado consumido por el informe")
    for modulo in MODULOS:
        for entrada in modulo.entradas:
            inventario.conectar(
                f"fuente:{entrada}", f"fuente:{modulo.id}", "plataforma_datos/orquestacion/modulos.py:MODULOS"
            )
    for conjunto in CONJUNTOS:
        inventario.agregar(
            f"conjunto:{conjunto.id}",
            "conjunto",
            dominio=_dominio(conjunto.fuente or conjunto.id),
            clase=conjunto.clase,
            productor=f"fuente:{conjunto.fuente}" if conjunto.fuente else None,
            automatizacion={
                "operacion": conjunto.operacion,
                "alcance": conjunto.alcance,
                "intervalo_dias": conjunto.intervalo_dias,
                "ejecucion_instalada": "no-acreditada",
            },
            evidencia="plataforma_datos/orquestacion/planificacion_de_comprobaciones.py:CONJUNTOS",
        )
        if conjunto.fuente:
            inventario.conectar(
                f"fuente:{conjunto.fuente}",
                f"conjunto:{conjunto.id}",
                "plataforma_datos/orquestacion/planificacion_de_comprobaciones.py:CONJUNTOS",
            )
    for carpeta in ENTRADAS_EXTERNAS:
        inventario.recurso(
            carpeta, evidencia="plataforma_datos/orquestacion/modulos.py:ENTRADAS_EXTERNAS", externa=True
        )
    return propietarios


def _manifiesto(inventario: _Inventario, propietarios: dict[str, str]) -> None:
    for nombre, entrada in _leer(inventario.raiz, "datos/manifiesto.json").items():
        salida = inventario.recurso(f"datos/{nombre}")
        inventario.nodos[salida].update(
            tipo="derivado",
            productor="plataforma_datos/orquestacion/exportar_paquete.py",
            cobertura_productor="exportador-declarado-sin-ejecucion-acreditada",
            regeneracion="copia-recurso-admitido" if nombre in ESCRITOS_POR_HERRAMIENTAS else "composicion-local",
            evidencia="datos/manifiesto.json",
            sha256=entrada["sha256"],
        )
        for ruta, huella in entrada["origenes"].items():
            origen = inventario.recurso(ruta)
            propietario = next(
                (fuente for carpeta, fuente in propietarios.items() if ruta.startswith(carpeta + "/")), None
            )
            inventario.nodos[origen].update(productor=propietario, sha256=huella)
            if propietario:
                inventario.nodos[origen]["cobertura_productor"] = "propiedad-de-carpeta-declarada"
                inventario.nodos[origen]["dominio"] = inventario.nodos[propietario]["dominio"]
                inventario.conectar(propietario, origen, "plataforma_datos/orquestacion/modulos.py:carpetas")
            inventario.conectar(origen, salida, "datos/manifiesto.json:origenes", "observada")


def _consumidores(inventario: _Inventario) -> None:
    lector = "src/plataforma/archivos-del-paquete.ts"
    texto = (inventario.raiz / lector).read_text(encoding="utf-8")
    for tabla in ("ARCHIVO_DE_CADA_PARTE", "ARCHIVOS_EXTRA_DEL_PAQUETE"):
        bloque = re.search(rf"export const {tabla} = \{{(.*?)\n\}} as const", texto, re.S)
        if bloque is None:
            raise ValueError(f"No se reconoce la tabla {tabla}")
        for nombre in re.findall(r"^\s*\w+: '([a-z0-9-]+\.json)',", bloque[1], re.M):
            nodo = inventario.recurso(f"datos/{nombre}")
            inventario.nodos[nodo].setdefault("consumidores", []).append({"ruta": lector, "evidencia": tabla})
    for nombre, lector in (("nombres", "src/comun/nombres-propios.ts"),):
        texto_lector = (inventario.raiz / lector).read_text(encoding="utf-8")
        if texto_lector.find(f"/datos/{nombre}.json' with") == -1:
            raise ValueError(f"Importación de datos no reconocida: {lector}")
        nodo = inventario.recurso(f"datos/{nombre}.json")
        inventario.nodos[nodo].setdefault("consumidores", []).append({"ruta": lector, "evidencia": "import-json"})


def _otros_dominios(inventario: _Inventario) -> None:
    globales = inventario.recurso("datos/globales/datos-globales.json")
    inventario.nodos[globales].update(
        tipo="derivado",
        dominio="derivados",
        productor="plataforma_datos/orquestacion/publicar_globales.py",
        cobertura_productor="exportador-declarado-sin-ejecucion-acreditada",
        consumidores=[{"ruta": "herramientas/web/datos-globales.ts", "evidencia": "PUBLICACIONES_GLOBALES"}],
    )
    for fuente in datos_globales.ENTRADAS:
        ruta = f"{DATOS_RELATIVOS.as_posix()}/validados/{fuente}/{fuente}.json"
        origen = inventario.recurso(ruta)
        productor = next((nombre for nombre, modulo in FUENTES_EN_ORDEN if fuente == modulo.FUENTE), None)
        inventario.nodos[origen]["productor"] = f"fuente:{productor}" if productor else None
        if productor:
            inventario.nodos[origen]["cobertura_productor"] = "adaptador-declarado-sin-ejecucion-acreditada"
            inventario.nodos[origen]["dominio"] = inventario.nodos[f"fuente:{productor}"]["dominio"]
            inventario.conectar(
                f"fuente:{productor}", origen, "plataforma_datos/orquestacion/reconstruir.py:FUENTES_EN_ORDEN"
            )
        inventario.conectar(origen, globales, "plataforma_datos/derivados/fuentes/datos_globales/lector.py:ENTRADAS")
    inventario.conectar("fuente:datos_globales", globales, "plataforma_datos/orquestacion/publicar_globales.py")
    biblioteca = inventario.recurso("datos/lecturas.json", dominio="biblioteca", editorial=True)
    inventario.nodos[biblioteca].update(
        productor="fuente:lecturas",
        cobertura_productor="adaptador-declarado-sin-ejecucion-acreditada",
    )
    inventario.conectar(
        "fuente:lecturas", biblioteca, "plataforma_datos/biblioteca/fuentes/lecturas/lector.py:exportar"
    )
    inventario.nodos[biblioteca]["consumidores"] = [
        {"ruta": "herramientas/web/lecturas/registro.ts", "evidencia": "REGISTRO"}
    ]
    observaciones = inventario.recurso("datos/observaciones-lecturas.json", dominio="biblioteca", editorial=False)
    inventario.nodos[observaciones].update(
        productor="fuente:enlaces_lecturas",
        cobertura_productor="adaptador-declarado-sin-ejecucion-acreditada",
        consumidores=[
            {
                "ruta": "herramientas/web/lecturas.ts",
                "evidencia": "cargarProyeccionLecturas:datos/observaciones-lecturas.json",
            },
            {"ruta": "herramientas/web/lecturas/observaciones.ts", "evidencia": "cargarProyeccionLecturas"},
            {
                "ruta": "web/scripts/enlaces-biblioteca.js",
                "evidencia": "iniciarEnlacesBiblioteca:atributos de la proyección generada",
            },
        ],
    )
    inventario.conectar(
        "fuente:enlaces_lecturas",
        observaciones,
        "plataforma_datos/biblioteca/fuentes/enlaces_lecturas/lector.py:exportar",
    )
    inventario.conectar(
        biblioteca, observaciones, "plataforma_datos/biblioteca/fuentes/enlaces_lecturas/lector.py:CATALOGO"
    )
    for lectura in _leer(inventario.raiz, "datos/lecturas.json")["lecturas"]:
        inventario.agregar(
            f"lectura:{lectura['id']}",
            "recurso",
            dominio="biblioteca",
            productor="fuente:lecturas",
            editorial=True,
            clase=lectura["tipo"],
            evidencia="datos/lecturas.json:lecturas",
            metadatos_publicados={
                campo: lectura.get(campo)
                for campo in ("fuente", "enlace", "enlace_ca", "consultado", "licencia", "fecha", "idiomas", "formato")
            },
            titulos={idioma: lectura[idioma].get("titulo") for idioma in ("es", "ca") if idioma in lectura},
        )
        inventario.conectar(f"lectura:{lectura['id']}", biblioteca, "datos/lecturas.json:indice-editorial")
    _modelos(inventario)


def _modelos(inventario: _Inventario) -> None:
    lector = "motores/ocupaciones/src/recorrido/pantalla/previa-fusion.ts"
    texto = (inventario.raiz / lector).read_text(encoding="utf-8")
    modelos = re.findall(r"from '../../../modelos/([a-z0-9-]+\.json)' with", texto)
    if not modelos:
        raise ValueError("No se reconocen las importaciones de modelos")
    for nombre in modelos:
        nodo = inventario.recurso(f"motores/ocupaciones/modelos/{nombre}", dominio="ocupaciones")
        inventario.nodos[nodo]["dominio"] = "ocupaciones"
        inventario.nodos[nodo]["regeneracion"] = "no-acreditada"
        inventario.nodos[nodo]["consumidores"] = [{"ruta": lector, "evidencia": "import-json"}]


def _clasificar_derivados(inventario: _Inventario) -> None:
    """Conserva dominios de entradas acreditadas y los huecos de clasificación."""
    for id_, nodo in inventario.nodos.items():
        if nodo["tipo"] != "derivado":
            continue
        evidencias = []
        sin_dominio = []
        for relacion in inventario.relaciones:
            if relacion["salida"] != id_:
                continue
            entrada = inventario.nodos.get(relacion["entrada"], {})
            dominio = entrada.get("dominio", "desconocido")
            if dominio == "desconocido":
                sin_dominio.append(relacion["entrada"])
            else:
                evidencias.append(
                    {"entrada": relacion["entrada"], "dominio": dominio, "evidencia": relacion["evidencia"]}
                )
        dominios = {evidencia["dominio"] for evidencia in evidencias}
        if nodo["dominio"] != "desconocido":
            dominios.add(nodo["dominio"])
        nodo["dominios"] = sorted(dominios)
        nodo["dominio"] = next(iter(dominios)) if len(dominios) == 1 else "multiple" if dominios else "desconocido"
        nodo["clasificacion_dominio"] = {
            "metodo": "dominios declarados de productores y orígenes; no inferencia del contenido",
            "evidencias": evidencias,
            "origenes_sin_dominio": sorted(set(sin_dominio)),
            "cobertura": "parcial" if sin_dominio or not dominios else "completa-segun-registro",
        }


def construir_catalogo(raiz: Path = RAIZ) -> dict[str, Any]:
    """Deriva metadatos de registros y manifiesto, sin ejecutar productores ni comprobar vigencia.

    Returns:
        Nodos, relaciones y límites explícitos; todas las rutas son relativas a la raíz recibida.
    """
    _comprobar_dominios()
    inventario = _Inventario(raiz)
    propietarios = _registros(inventario)
    _manifiesto(inventario, propietarios)
    _consumidores(inventario)
    _otros_dominios(inventario)
    _clasificar_derivados(inventario)
    return {
        "version": 2,
        "nodos": list(inventario.nodos.values()),
        "relaciones": inventario.relaciones,
        "sin_exportacion_individual": [
            {
                "archivo": f"datos/{nombre}.json",
                "descripcion": descripcion,
                "evidencia": "plataforma_datos/orquestacion/exportar_paquete.py:PREPARADOS_SIN_USO",
                "alcance": "No se exporta con este nombre; puede alimentar otros conjuntos.",
            }
            for nombre, descripcion in sorted(PREPARADOS_SIN_USO.items())
        ],
        "limites": [
            "No acredita ejecución instalada, vigencia, huellas actuales ni uso en una sesión.",
            "Propiedad por carpeta declarada; no demuestra regeneración de cada archivo.",
            "Consumidores acotados a tablas e importaciones indicadas; desconocidos permanecen visibles.",
            "Dominios editoriales de productores y orígenes; no clasificación semántica de contenidos.",
            "Los registros Python son los del código ejecutado; --raiz cambia solo los archivos observados.",
            "Sin productor registrado no implica defecto ni obsolescencia: consultar cobertura_productor.",
        ],
    }


def _ciclos(sucesores: dict[str, set[str]]) -> list[dict[str, str]]:
    pendientes = dict.fromkeys(sucesores, 0)
    for destinos in sucesores.values():
        for destino in destinos:
            pendientes[destino] += 1
    libres = [id_ for id_, cantidad in pendientes.items() if cantidad == 0]
    while libres:
        for destino in sucesores[libres.pop()]:
            pendientes[destino] -= 1
            if pendientes[destino] == 0:
                libres.append(destino)
    if any(pendientes.values()):
        return [
            {
                "clase": "ciclo-o-dependencia-bloqueada",
                "id": ", ".join(sorted(id_ for id_, n in pendientes.items() if n)),
            }
        ]
    return []


def comprobar_catalogo(catalogo: dict[str, Any]) -> list[dict[str, str]]:
    """Detecta conexiones rotas, ciclos y recursos consumidos sin productor acreditado.

    Returns:
        Incidencias estructuradas; las entradas editoriales o externas siguen figurando como tales.
    """
    nodos = {nodo["id"]: nodo for nodo in catalogo["nodos"]}
    incidencias = []
    if len(nodos) != len(catalogo["nodos"]):
        incidencias.append({"clase": "id-duplicado", "id": "catalogo"})
    sucesores: dict[str, set[str]] = {id_: set() for id_ in nodos}
    consumidos = {id_ for id_, nodo in nodos.items() if nodo.get("consumidores")}
    for relacion in catalogo["relaciones"]:
        entrada, salida = relacion["entrada"], relacion["salida"]
        if entrada not in nodos or salida not in nodos:
            incidencias.append({"clase": "referencia-rota", "id": f"{entrada} → {salida}"})
        else:
            sucesores[entrada].add(salida)
            consumidos.add(entrada)
    incidencias.extend(_referencias_de_nodos(nodos, consumidos))
    return incidencias + _ciclos(sucesores)


def _referencias_de_nodos(nodos: dict[str, Any], consumidos: set[str]) -> list[dict[str, str]]:
    incidencias = []
    for id_, nodo in nodos.items():
        productor = nodo.get("productor")
        if isinstance(productor, str) and productor.startswith("fuente:") and productor not in nodos:
            incidencias.append({"clase": "referencia-rota", "id": id_})
        if id_ in consumidos and nodo["tipo"] != "fuente" and not productor:
            incidencias.append(
                {
                    "clase": "sin-productor",
                    "id": id_,
                    "cobertura": "editorial"
                    if nodo.get("editorial")
                    else nodo.get("cobertura_productor", "no-acreditada"),
                }
            )
        if nodo.get("presente") is False:
            incidencias.append({"clase": "archivo-ausente", "id": id_})
    return incidencias


def main(argv: list[str] | None = None) -> int:
    """Emite el inventario y sus incidencias en stdout; no escribe archivos.

    Returns:
        Cero cuando se ha podido construir y auditar el inventario, aunque revele huecos.
    """
    opciones = argparse.ArgumentParser(description=__doc__)
    opciones.add_argument("--raiz", type=Path, default=RAIZ)
    catalogo = construir_catalogo(opciones.parse_args(argv).raiz)
    print(json.dumps({**catalogo, "incidencias": comprobar_catalogo(catalogo)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
