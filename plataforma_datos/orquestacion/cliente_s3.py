"""El cliente del SDK S3 del almacén privado: credenciales y destino explícitos, sin nada del entorno.

Ninguna variable, perfil o archivo de configuración del SDK entra en el cliente; tampoco sus reintentos: cada
operación de `almacen_s3` decide los suyos.
"""

import os

import boto3.session
import botocore.session
from botocore.client import BaseClient
from botocore.config import Config
from botocore.configprovider import ConfigValueStore

from plataforma_datos.comun.confianza_tls import ruta_ca_runtime_verificada
from plataforma_datos.orquestacion.configuracion_almacen_s3 import AlmacenS3Invalido, ConfiguracionAlmacenS3

CONEXION_S = 5
SOCKET_S = 10


def crear_cliente(configuracion: ConfiguracionAlmacenS3, agente: str) -> BaseClient:
    """Crea el cliente del SDK solo con la configuración explícita, sin reintentos propios.

    Returns:
        El cliente S3 con sus plazos, la identidad dada y la autoridad de certificación verificada.

    Raises:
        AlmacenS3Invalido: Si el entorno pide registrar las claves TLS.
    """
    if os.environ.get("SSLKEYLOGFILE"):
        raise AlmacenS3Invalido("No se admite SSLKEYLOGFILE en el cliente de almacenamiento.")
    sesion = botocore.session.Session()
    valores = ConfigValueStore()
    # Valores por defecto del SDK, sin sus proveedores de entorno, perfiles, punto de acceso o credenciales.
    for nombre, definicion in sesion.SESSION_VARIABLES.items():
        valores.set_config_variable(nombre, definicion[2])
    valores.set_config_variable("config_file", os.devnull)
    valores.set_config_variable("credentials_file", os.devnull)
    sesion.register_component("config_store", valores)
    sesion.set_credentials(configuracion.access_key_id, configuracion.secret_access_key)
    sdk = boto3.session.Session(botocore_session=sesion)
    return sdk.client(
        "s3",
        endpoint_url=configuracion.endpoint,
        region_name=configuracion.region,
        verify=str(ruta_ca_runtime_verificada()),
        config=Config(
            signature_version="s3v4",
            user_agent=agente,
            proxies={},
            connect_timeout=CONEXION_S,
            read_timeout=SOCKET_S,
            retries={"mode": "standard", "total_max_attempts": 1},
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
            ignore_configured_endpoint_urls=True,
            s3={"addressing_style": "path", "use_accelerate_endpoint": False, "payload_signing_enabled": True},
        ),
    )
