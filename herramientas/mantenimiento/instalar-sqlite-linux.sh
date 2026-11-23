#!/usr/bin/env bash
# Enlaza las fuentes verificadas y el punto de entrada público de CPython en el prefijo privado del job.
set -euo pipefail
prefijo=${1:?Falta el prefijo privado de Python}
fuentes=${2:?Faltan las fuentes verificadas de SQLite}
[[ -d "$prefijo/lib" && ! -L "$prefijo/lib" && -d "$prefijo/bin" && ! -L "$prefijo/bin" ]]
[[ -x "$prefijo/bin/python3.12" && -f "$prefijo/include/python3.12/Python.h" ]]

cc -O2 -fPIC -shared -Wl,-soname,libsqlite3.so.0 -Wl,-z,relro,-z,now \
  -DSQLITE_ENABLE_FTS5 -DSQLITE_ENABLE_FTS3 -DSQLITE_ENABLE_FTS3_PARENTHESIS \
  -DSQLITE_ENABLE_RTREE -DSQLITE_ENABLE_COLUMN_METADATA -DSQLITE_ENABLE_DBSTAT_VTAB \
  -DSQLITE_ENABLE_MATH_FUNCTIONS -DSQLITE_ENABLE_PREUPDATE_HOOK -DSQLITE_ENABLE_SESSION \
  -DSQLITE_ENABLE_UNLOCK_NOTIFY -DSQLITE_SECURE_DELETE -DSQLITE_USE_URI=1 \
  "$fuentes/sqlite3.c" -o "$fuentes/libsqlite3.so.0" -pthread -ldl -lm
mv -fT "$fuentes/libsqlite3.so.0" "$prefijo/lib/libsqlite3.so.0"

# El binario oficial y su extensión llevan el RUNPATH de la caché compartida. Py_BytesMain es el
# mismo punto de entrada de CPython. Fijar ambas dependencias aquí cubre venv y los hijos con env -i.
cc -O2 -I "$prefijo/include/python3.12" -x c - -x none -L "$prefijo/lib" \
  -Wl,--no-as-needed -lpython3.12 -l:libsqlite3.so.0 -Wl,--as-needed \
  -Xlinker -rpath -Xlinker "$prefijo/lib" -o "$fuentes/python3.12" <<'C'
#include <Python.h>
int main(int argc, char **argv) { return Py_BytesMain(argc, argv); }
C
mv -fT "$fuentes/python3.12" "$prefijo/bin/python3.12"
ln -sfnT python3.12 "$prefijo/bin/python"
