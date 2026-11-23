"""Valores de intercambio JSON; las estructuras se comprueban en sus contratos."""

type ValorJson = None | bool | int | float | str | list[ValorJson] | dict[str, ValorJson]
type ObjetoJson = dict[str, ValorJson]
