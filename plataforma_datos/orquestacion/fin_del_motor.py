"""Cómo terminó el proceso del motor, mirado antes de leer su recibo.

El motor deja su recibo entero o ninguno (`candidato._crear_recibo`). Si el proceso lo mató una señal, o terminó sin
dejar recibo, el supervisor lo dice con su causa propia antes de intentar leerlo: así un motor que muere no queda
anotado como un fallo de lectura («entrada-salida»), que solo es la causa cuando de verdad falla leer o escribir. El
plazo agotado no llega aquí: lo nombra el `TimeoutExpired` encadenado (`diario_mantenimiento`).
"""

# Lo mató una señal (la del sistema por falta de memoria, por ejemplo): el código de salida es negativo.
CAUSA_SENAL = "motor-terminado-por-senal"
# Terminó por su cuenta sin dejar recibo.
CAUSA_SIN_RECIBO = "motor-sin-recibo"
CAUSAS = (CAUSA_SENAL, CAUSA_SIN_RECIBO)


class MotorSinRecibo(ValueError):
    """El motor terminó sin un recibo que leer; lleva la causa cerrada con que lo anota el diario."""

    def __init__(self, mensaje: str, causa: str) -> None:
        """Guarda el mensaje genérico del supervisor y la causa cerrada."""
        super().__init__(mensaje)
        self.causa = causa


def exigir_recibo(codigo: int, hay_recibo: bool, mensaje: str) -> None:
    """Comprueba cómo terminó el motor antes de leer su recibo.

    Raises:
        MotorSinRecibo: Si lo mató una señal o si terminó sin dejar recibo.
    """
    if codigo < 0:
        raise MotorSinRecibo(mensaje, CAUSA_SENAL)
    if not hay_recibo:
        raise MotorSinRecibo(mensaje, CAUSA_SIN_RECIBO)
