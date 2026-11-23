"""Aplica la guardia de red en los intérpretes hijos de la batería Python que heredan `FARO_PRUEBAS_SIN_RED=1`."""

import os

if os.environ.get("FARO_PRUEBAS_SIN_RED") == "1":
    import guardia_red

    guardia_red.aplicar()
