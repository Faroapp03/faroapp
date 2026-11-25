"""Lo que heredan del entorno de quien actualiza las órdenes del área (`actualizar.ejecutar_orden`).

Solo las variables de ENTORNO_HEREDADO, más la política de red de npm y, en Linux, la biblioteca de Python. Las claves
y los perfiles no llegan a las descargas ni a las pruebas. Lo usan también el ejecutor de producción
(`ejecutor_operativo`) y el ensayo con datos grabados (`entorno_del_ensayo`), a través de `actualizar`.
Python estándar.
"""

from collections.abc import Mapping

from plataforma_datos.comun.red import agente_de_usuario
from plataforma_datos.orquestacion.procesos import bibliotecas_de_python

# Lo que heredan las órdenes del área del entorno de quien ejecuta: encontrar programas, su carpeta personal y su
# caché, el idioma, la zona horaria, la carpeta temporal y, si los hay, el proxy y los certificados para salir a la
# red. FARO_HOY permite reproducir la fecha de validación y FARO_INSTANTE, el instante único del ciclo
# (comun/instante_del_ciclo.py). No se heredan perfiles, claves ni programas de aviso.
ENTORNO_HEREDADO = (
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TERM",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "TMPDIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "PLAYWRIGHT_BROWSERS_PATH",
    "FARO_HUMO_CHROMIUM",
    "FARO_HOY",
    "FARO_INSTANTE",
    "FARO_TURNOS_ENTRE_PROCESOS",  # la carpeta de turnos por servidor de las descargas en paralelo
)


def entorno_de_las_ordenes(entorno: Mapping[str, str]) -> dict[str, str]:
    """Filtra el entorno que heredan las órdenes del área.

    Args:
        entorno: El entorno del proceso que actualiza.

    Returns:
        Variables admitidas, política de npm y biblioteca del runtime; nunca una ruta ambiental.
    """
    filtrado = {nombre: valor for nombre, valor in entorno.items() if nombre in ENTORNO_HEREDADO}
    return {
        **filtrado,
        **bibliotecas_de_python(),
        "npm_config_user_agent": agente_de_usuario(),
        "npm_config_update_notifier": "false",
    }
