/* CPython 3.12.15. Registrar su propio controlador antes de que Python copie
   la tabla de módulos incorporados. Así funcionan también -I, -S y los venv. */
#define PY_SSIZE_T_CLEAN
#include <Python.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

PyObject *PyInit__faro_sqlite3(void);

int main(int argc, char **argv)
{
    struct _inittab *originales = PyImport_Inittab;
    size_t cantidad = 0;
    while (originales[cantidad].name != NULL) {
        ++cantidad;
    }
    struct _inittab *modulos = calloc(cantidad + 1, sizeof(*modulos));
    if (modulos == NULL) {
        return EXIT_FAILURE;
    }
    memcpy(modulos, originales, cantidad * sizeof(*modulos));
    size_t coincidencias = 0;
    for (size_t i = 0; i < cantidad; ++i) {
        if (strcmp(modulos[i].name, "_sqlite3") == 0) {
            modulos[i].initfunc = PyInit__faro_sqlite3;
            ++coincidencias;
        }
    }
    if (coincidencias != 1) {
        fputs("La base de CPython debe registrar exactamente un módulo _sqlite3.\n", stderr);
        free(modulos);
        return EXIT_FAILURE;
    }
    PyImport_Inittab = modulos;
    int resultado = Py_BytesMain(argc, argv);
    PyImport_Inittab = originales;
    free(modulos);
    return resultado;
}
