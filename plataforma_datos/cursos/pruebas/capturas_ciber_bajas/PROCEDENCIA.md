# Capturas públicas de Cibervoluntarios usadas por las pruebas de bajas

Capturadas el 15/11/2026 entre las 07:26 y las 07:33 (hora de Barcelona), con identidad de navegador genérica y cuatro
segundos entre consultas. Sin cuentas ni inicio de sesión. Se ha quitado de las cabeceras la línea `set-cookie`, que
lleva el identificador de una sesión anónima.

| Archivo | Dirección | Respuesta | sha256 del archivo | Qué es |
|---|---|---|---|---|
| `destino-inexistente.html` | `https://e-learning.cibervoluntarios.org/course/view.php?id=99999999` | 404 | `857c0bc14f6b5897826fdac58561f27de0fd12361b12ccb23c2938ebecef498b` (archivo original completo) | Recorte de la página «Error \| Cibervoluntarios»: solo su título y la caja de error con el mensaje «No se puede encontrar el registro de datos en la base de datos.» y el enlace a su código de error, que es lo que reconoce el lector. El recorte tiene sha256 `12c584fe464351a07b4d666e41ebac083f24464a04e831eb5b2f5352465bb0ad`. |
| `destino-inexistente.cabeceras.txt` | la misma | 404 | `d3568f90437e13fcfb532bdc6b0a4391d66564529cc3d2fab926e98b6fb72f48` | Cabeceras de esa respuesta. |
| `destino-existente.html` | `https://e-learning.cibervoluntarios.org/course/view.php?id=485` | 303 | `01f72eeccd2e945e57b21855dac2efce0cf1492b1ffb5e95ebd1a22d25e6ba50` (archivo original completo) | Recorte del cuerpo de la redirección: el título «Redireccionar» y el enlace de continuar al inicio de sesión, sin estilos ni textos de la interfaz. El recorte tiene sha256 `41b51e5945f56d17b1fce11b9ca4be0e67071bb4fba990d941359d47a2985563`. |
| `destino-existente.cabeceras.txt` | la misma | 303, `location: https://e-learning.cibervoluntarios.org/login/index.php` | `4987176d0b9d4a9e731a493b185784167d1e5b8b053536744f2e95a561e4e55c` | Cabeceras de esa respuesta, con su `location`. |
| `censo-recorte.json` | `https://www.cibervoluntarios.org/api/public/activity_catalogs?lang=es&itemsPerPage=100&page=1` | 200 | `3bc882b972925ccc4a63a0d24361242b5e43e421ac9a8498a897383a6d54e3d7` | Primera actividad de la página 1 con su primer material, tal como la sirvió la API. |

`censo-recorte.json` viene de `censo-p1.json` (23.440.037 bytes, sha256
`15f6fbb99ea66410e321d581813254b23b9722f6a4deb34befa617c8400afd5d`, 100 actividades). Se han recortado las otras 99
actividades, los otros dos materiales de la primera y los campos que Faro no lee (imágenes, etiquetas, proyecto,
programas, comentarios y similares). Quedan íntegros los campos que lee el lector de la fuente, entre ellos `status`
y `erased` de la actividad y del material y el `moodleLink` del material.

La página pública del curso (`/es/formacion-gratuita/aprende-a-tu-ritmo/cursos/<slug>`) responde 200 con los mismos
bytes exista o no el curso, por lo que no se usa como evidencia.
