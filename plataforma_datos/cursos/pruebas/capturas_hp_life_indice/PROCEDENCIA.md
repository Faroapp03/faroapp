# Recortes de las páginas públicas de HP LIFE usadas por las pruebas

Cada archivo es un recorte de la respuesta que devolvió su dirección, consultada con identidad de navegador genérica y
pausa entre consultas. Las páginas del sitio no se reproducen: de cada una queda solo el documento HTML mínimo con su
único `<script id="__NEXT_DATA__" type="application/json">`, que es lo que lee el lector, y dentro de él solo los campos
que leen las pruebas. El JSON conserva la escritura compacta del original, la que las pruebas modifican byte a byte.

| Archivo | Dirección | Respuesta | Consulta (UTC) | sha256 del original | sha256 del recorte |
|---|---|---|---|---|---|
| `pagina-1.html` | `https://www.life-global.org/es/allcourses?page=1` | 200 | 14/11/2026, 21:56 | `4a1ef4ab3d33a92dc649f3b9e8cf69a893112a3a360caca2be6faab519e453a0` | `2eae0ac219b8d49109b520ddac63327dd632f2a0139b26db70d46e6036ab3093` |
| `pagina-2.html` | `https://www.life-global.org/es/allcourses?page=2` | 200 | 14/11/2026, 21:56 | `a0c51d1146833ed94bec270468e19b94828741702f631fc5d42b38b894d414a5` | `ef1137987656640bfc415d63cec6573a6c27c2bd14d9df06b56f64e8b3e03e37` |
| `pagina-3.html` | `https://www.life-global.org/es/allcourses?page=3` | 200 | 14/11/2026, 21:56 | `c9802bcc75f79b77eb05d5588a0f61d8dae4c5b1af4a87babf54b90f809099fe` | `1137308628e12b223c4bb9aad021ca5657ad49cbce974da4a83fc9d6abd47c35` |
| `pagina-4.html` | `https://www.life-global.org/es/allcourses?page=4` | 200 | 14/11/2026, 21:56 | `8ef3a49b6dc92f20a99d5c5cab843d7986018b749df3f451fbb0aa82e680eff4` | `a948888180702d96ff8f87cd0f6576c63baea5f8271c03a2e90a81388a310d32` |
| `pagina-5.html` | `https://www.life-global.org/es/allcourses?page=5` | 200 | 14/11/2026, 21:57 | `8184e0dd8d7e700bdf4875871bae1bc68c1d11af87512d9ab153c3821e1accc9` | `af0f85bb9e6ce374c4f3be94f43049b0ec4a3d00b9f798aa1a4831f58ab0a26b` |
| `ficha-inexistente.html` | `https://www.life-global.org/es/course/999999-curso-inexistente` | 500 | 15/11/2026, 05:47 | `9e02bfa950f24b09db75306be4caa455c132835abc4d58186a0123b95d295d5e` | `31cbb177326f73d867b396ccd4741b4751d26d936b17b929444a351fa054bdef` |

En las páginas del listado quedan `props.pageProps.initialCourses` (de cada curso, solo `id` y `language`),
`totalCourses` y `page`, y fuera de `props` la ruta (`page`), la consulta (`query`) y el idioma (`locale`). Se han
quitado los textos, las descripciones, las imágenes, los estilos, los mensajes de la interfaz y el resto del documento.
Las cinco páginas declaran 37 cursos (`totalCourses`): 12 en cada una de las tres primeras, uno en la cuarta y ninguno
en la quinta. La ficha de un curso que no existe responde 500 con la página de error de la aplicación: `page` es
`/_error` y `props.pageProps` es `{"statusCode":500}`, sin `initialCourseData`; el recorte conserva esa forma exacta.
