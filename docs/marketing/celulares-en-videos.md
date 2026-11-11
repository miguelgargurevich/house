# Celulares y nombres que se ven en los videos finales

Inventario hecho el **7-nov-2026** sobre los mp4 finales de `.claude/videos/` del checkout principal y del worktree `manual-videos` (sin `montaje/` ni `escenas/`, y sin los 4 de v7 que se regraban, que se revisaron aparte). OCR con `tesseract -l spa` a **1 cuadro por segundo** (`ffmpeg -vf fps=1`). Lo que se marca: celulares con forma de celular peruano (`9` + 8 dígitos) que no empiezan por `9000` ni `900 0`, y los nombres o correos de la búsqueda (`gargurevich`, `gestión urbana`, `melina`, `loayza`, `gmail`).

**Los números aparecen enmascarados** (3 primeros y 2 últimos dígitos) porque este archivo va al repo. La lista completa, con cada número, está en la scratchpad de la sesión (`hallazgos-inventario.tsv`). Son celulares que aparecen en pantalla en videos **viejos**; no se regraban aquí: decide Opus.

> El OCR confunde algunos dígitos (p. ej. un `0` del fijo de la empresa se leyó como `9`): antes de regrabar, confirma cada número a ojo.

**Resumen**: 24 videos con al menos un celular visible; 37 números distintos (enmascarados). Los nombres aparecen sobre todo en los videos viejos de `house-*`, `v1` y `v2`.

## Celulares por video

| Video | Número (enmascarado) | Segundos en que se ve | Cuadros |
|---|---|---|---|
| `m-admin-juntas/torre-m-admin-juntas-escritorio` | 987•••98 | 0–7 s | 8 |
| `m-admin-juntas/torre-m-admin-juntas-escritorio` | 944•••86 | 0–7 s | 15 |
| `m-admin-juntas/torre-m-admin-juntas-escritorio` | 910•••59 | 1–7 s | 7 |
| `m-admin-juntas/torre-m-admin-juntas-escritorio` | 940•••34 | 2 s | 1 |
| `m-admin-juntas/torre-m-admin-juntas-escritorio` | 945•••86 | 2 s | 1 |
| `m-admin-juntas/torre-m-admin-juntas-escritorio` | 993•••62 | 2–5 s | 4 |
| `m-admin-juntas/torre-m-admin-juntas-escritorio` | 988•••94 | 2 s | 1 |
| `m-admin-juntas/torre-m-admin-juntas-escritorio` | 976•••27 | 2–5 s | 4 |
| `m-admin-juntas/torre-m-admin-juntas-escritorio` | 940•••24 | 3–5 s | 3 |
| `m-admin-juntas/torre-m-admin-juntas-escritorio` | 980•••94 | 5 s | 1 |
| `m-admin-medios-pago/torre-m-admin-medios-pago-escritorio` | 944•••86 | 0–16 s | 17 |
| `m-admin-medios-pago/torre-m-admin-medios-pago-escritorio` | 993•••62 | 2–8 s | 7 |
| `m-admin-mi-empresa/torre-m-admin-mi-empresa-escritorio` | 987•••24 | 10–15 s | 6 |
| `m-admin-mi-empresa/torre-m-admin-mi-empresa-escritorio` | 987•••28 | 10–15 s | 6 |
| `m-admin-mi-empresa/torre-m-admin-mi-empresa-escritorio` | 987•••27 | 10–15 s | 6 |
| `m-admin-mi-empresa/torre-m-admin-mi-empresa-escritorio` | 987•••26 | 10–15 s | 6 |
| `m-admin-mi-empresa/torre-m-admin-mi-empresa-escritorio` | 987•••99 | 10–15 s | 6 |
| `m-admin-mi-empresa/torre-m-admin-mi-empresa-escritorio` | 987•••25 | 10–15 s | 6 |
| `m-admin-proveedores/torre-m-admin-proveedores-escritorio` | 999•••12 | 0 s | 1 |
| `m-admin-proveedores/torre-m-admin-proveedores-escritorio` | 997•••99 | 0–12 s | 10 |
| `m-admin-proveedores/torre-m-admin-proveedores-escritorio` | 994•••66 | 0–9 s | 10 |
| `m-admin-proveedores/torre-m-admin-proveedores-escritorio` | 906•••88 | 0–15 s | 2 |
| `m-admin-proveedores/torre-m-admin-proveedores-escritorio` | 995•••77 | 0–16 s | 17 |
| `m-admin-proveedores/torre-m-admin-proveedores-escritorio` | 991•••33 | 2–8 s | 7 |
| `m-admin-proveedores/torre-m-admin-proveedores-escritorio` | 993•••55 | 2–5 s | 3 |
| `m-admin-proveedores/torre-m-admin-proveedores-escritorio` | 999•••11 | 3–14 s | 5 |
| `m-admin-proveedores/torre-m-admin-proveedores-escritorio` | 996•••88 | 3–8 s | 6 |
| `m-admin-proveedores/torre-m-admin-proveedores-escritorio` | 990•••22 | 3–10 s | 7 |
| `m-admin-proveedores/torre-m-admin-proveedores-escritorio` | 998•••00 | 3 s | 1 |
| `m-admin-proveedores/torre-m-admin-proveedores-escritorio` | 992•••44 | 3–8 s | 6 |
| `m-admin-proveedores/torre-m-admin-proveedores-escritorio` | 909•••11 | 4 s | 1 |
| `m-admin-proveedores/torre-m-admin-proveedores-escritorio` | 992•••55 | 4–8 s | 4 |
| `m-admin-proveedores/torre-m-admin-proveedores-escritorio` | 999•••21 | 13–16 s | 3 |
| `m-admin-unidades/torre-m-admin-unidades-escritorio` | 943•••95 | 9–10 s | 2 |
| `m-junta-medios-pago/torre-m-junta-medios-pago-escritorio` | 944•••86 | 0–15 s | 13 |
| `m-junta-mi-junta/torre-m-junta-mi-junta-escritorio` | 987•••98 | 0–16 s | 17 |
| `m-junta-mi-junta/torre-m-junta-mi-junta-escritorio` | 944•••86 | 0–16 s | 33 |
| `m-junta-proveedores/torre-m-junta-proveedores-escritorio` | 999•••11 | 0–15 s | 13 |
| `m-junta-proveedores/torre-m-junta-proveedores-escritorio` | 997•••99 | 0–15 s | 16 |
| `m-junta-proveedores/torre-m-junta-proveedores-escritorio` | 995•••77 | 0–10 s | 11 |
| `m-junta-proveedores/torre-m-junta-proveedores-escritorio` | 991•••33 | 1–13 s | 8 |
| `m-junta-proveedores/torre-m-junta-proveedores-escritorio` | 994•••66 | 1–8 s | 7 |
| `m-junta-proveedores/torre-m-junta-proveedores-escritorio` | 996•••88 | 1–8 s | 7 |
| `m-junta-proveedores/torre-m-junta-proveedores-escritorio` | 990•••22 | 1–10 s | 8 |
| `m-junta-proveedores/torre-m-junta-proveedores-escritorio` | 939•••11 | 3 s | 1 |
| `m-junta-proveedores/torre-m-junta-proveedores-escritorio` | 980•••22 | 3 s | 1 |
| `m-junta-proveedores/torre-m-junta-proveedores-escritorio` | 993•••55 | 3–8 s | 6 |
| `m-junta-proveedores/torre-m-junta-proveedores-escritorio` | 998•••00 | 4–8 s | 5 |
| `m-junta-proveedores/torre-m-junta-proveedores-escritorio` | 992•••44 | 4–8 s | 5 |
| `m-perfil/torre-m-perfil-escritorio` | 936•••69 | 0–14 s | 13 |
| `m-propietario-junta/torre-m-propietario-junta-escritorio` | 993•••62 | 0–15 s | 16 |
| `m-propietario-proveedores/torre-m-propietario-proveedores-escritorio` | 991•••33 | 0–15 s | 9 |
| `m-propietario-proveedores/torre-m-propietario-proveedores-escritorio` | 992•••44 | 0–15 s | 16 |
| `m-propietario-proveedores/torre-m-propietario-proveedores-escritorio` | 994•••66 | 0–15 s | 16 |
| `m-propietario-proveedores/torre-m-propietario-proveedores-escritorio` | 996•••88 | 2–9 s | 8 |
| `v2/house-v2-celular` | 944•••86 | 18–37 s | 6 |
| `v2/house-v2-celular` | 988•••68 | 37 s | 1 |
| `v2/house-v2-escritorio` | 944•••86 | 17–37 s | 6 |
| `v2/house-v2-escritorio` | 993•••62 | 19–21 s | 3 |
| `v2/house-v2-escritorio` | 988•••68 | 37 s | 1 |
| `v2/house-v2-escritorio` | 910•••59 | 37 s | 1 |
| `v2/torre-v2-celular` | 944•••86 | 27–30 s | 8 |
| `v2/torre-v2-celular` | 910•••59 | 46 s | 2 |
| `v2/torre-v2-escritorio` | 944•••86 | 25–46 s | 16 |
| `v2/torre-v2-escritorio` | 993•••62 | 28–30 s | 6 |
| `v2/torre-v2-escritorio` | 987•••98 | 46 s | 2 |
| `v3/house-v3-celular` | 988•••68 | 0–3 s | 4 |
| `v3/house-v3-celular` | 944•••86 | 0–14 s | 8 |
| `v3/house-v3-escritorio` | 988•••68 | 0 s | 1 |
| `v3/house-v3-escritorio` | 944•••86 | 0–14 s | 10 |
| `v3/torre-v3-celular` | 988•••68 | 0–3 s | 4 |
| `v3/torre-v3-celular` | 944•••86 | 0–14 s | 12 |
| `v3/torre-v3-escritorio` | 988•••68 | 0–3 s | 4 |
| `v3/torre-v3-escritorio` | 944•••86 | 0–14 s | 8 |
| `v4/house-v4-celular` | 993•••62 | 13–16 s | 4 |
| `v4/house-v4-celular` | 991•••33 | 17–20 s | 4 |
| `v4/house-v4-celular` | 992•••44 | 17–20 s | 4 |
| `v4/house-v4-celular` | 994•••66 | 17–20 s | 4 |
| `v4/house-v4-celular` | 996•••88 | 19–20 s | 2 |
| `v4/house-v4-escritorio` | 993•••62 | 13–16 s | 4 |
| `v4/house-v4-escritorio` | 991•••33 | 17–19 s | 3 |
| `v4/house-v4-escritorio` | 992•••44 | 17–20 s | 4 |
| `v4/house-v4-escritorio` | 994•••66 | 17–20 s | 4 |
| `v4/torre-v4-celular` | 993•••62 | 13–16 s | 4 |
| `v4/torre-v4-celular` | 991•••33 | 17–20 s | 4 |
| `v4/torre-v4-celular` | 992•••44 | 17–20 s | 4 |
| `v4/torre-v4-celular` | 994•••66 | 17–20 s | 4 |
| `v4/torre-v4-celular` | 996•••88 | 19–20 s | 2 |
| `v4/torre-v4-escritorio` | 993•••62 | 13–16 s | 4 |
| `v4/torre-v4-escritorio` | 991•••33 | 17–19 s | 3 |
| `v4/torre-v4-escritorio` | 992•••44 | 17–20 s | 4 |
| `v4/torre-v4-escritorio` | 994•••66 | 17–20 s | 4 |
| `v6/torre-v6-escritorio` | 987•••24 | 2–14 s | 16 |
| `v6/torre-v6-escritorio` | 987•••28 | 2–14 s | 16 |
| `v6/torre-v6-escritorio` | 987•••27 | 2–14 s | 16 |
| `v6/torre-v6-escritorio` | 987•••26 | 2–14 s | 16 |
| `v6/torre-v6-escritorio` | 987•••99 | 2–9 s | 14 |
| `v6/torre-v6-escritorio` | 987•••25 | 2–9 s | 14 |
| `v6/torre-v6-escritorio` | 987•••90 | 14 s | 2 |

## Nombres o correos vistos

| Video | Términos encontrados |
|---|---|
| `v1/house-v1-celular` | gargurevich |
| `v1/house-v1-escritorio` | gargurevich |
| `v1/previo-3nov__torre-v1-celular` | gargurevich |
| `v1/previo-3nov__torre-v1-escritorio` | gargurevich |
| `v2/house-v2-celular` | gargurevich, gestión urbana |
| `v2/house-v2-escritorio` | gargurevich, gestión urbana |
| `v3/house-v3-celular` | gargurevich |
| `v3/house-v3-escritorio` | gargurevich |
| `v4/house-v4-celular` | gargurevich |
| `v4/house-v4-escritorio` | gargurevich |

## Notas

- Los `9000…` (datos ficticios nuevos) no se listan: son lo esperado.
- `987654xxx` son los celulares del seed **anterior** a esta corrección; siguen sin ser de la forma `9000`, así que aparecen en la lista.
- El celular de la vecina de prueba que citó Miguel aparece en un video viejo (`house-v2`); figura enmascarado en la tabla.
