# Guiones de los videos de House

Versión del 29-oct-2026. Cuatro videos, cada uno en **escritorio (16:9, 1920×1080)** y **celular (9:16, 1080×1920)**.
Pantallas reales de House en local con el seed de Los Libertadores (datos de prueba, ningún dato real). Narración con la voz
femenina «Dora» de My Workspace (Kokoro `ef_dora`, elegida por Miguel el 30-oct; antes OpenVoice). Cada escena: lo que se ve → lo que dice la voz. Duración objetivo ≈ 60 s
(≈ 140 palabras); la del rol administradora ≈ 90 s.

Reglas: tuteo, frases cortas, sin cifras inventadas (sólo las que se ven en pantalla), sin nombres de clientes reales,
cada escena cuenta UNA cosa. El cierre de todos: «House. Tu condominio, en orden.» + la dirección del sitio.

---

## 1. House en un minuto (promo general)

| # | En pantalla | Voz |
|---|---|---|
| 1 | Login nuevo: la escena del recibo, el recordatorio y el cobro | ¿Administras un condominio y cobrar cada mes es una pelea? |
| 2 | Administradora · Recibos: emitir el mantenimiento del mes | Con House emites los recibos del mes en minutos, desglosados por concepto y por departamento. |
| 3 | Celular del vecino · Mis recibos → detalle del mantenimiento | Cada vecino ve exactamente qué debe, por qué, y hasta cuándo. |
| 4 | Vecino · Pagar mantenimiento → subir comprobante | Paga y sube su comprobante desde el celular, sin llamar a nadie. |
| 5 | Administradora/Junta · Pagos por validar | La administración o la junta lo valida con un clic. |
| 6 | Comunicados › Envíos: recordatorios por WhatsApp y correo | Los recordatorios salen solos por WhatsApp y correo. |
| 7 | Morosidad / Resumen con el avance del cobro | Y tú ves, en una sola pantalla, quién está al día y quién no. |
| 8 | Logo + cierre | House. Tu condominio, en orden. |

## 2. Para la administradora (≈ 70 s)

| # | En pantalla | Voz |
|---|---|---|
| 1 | Resumen de la administradora | Este es tu día a día en House: todo el condominio en una sola pantalla. |
| 2 | Recibos por periodo, con el avance del cobro | Emite el mantenimiento del mes y míralo por block, con cuánto ya se cobró. |
| 3 | Pagos → revisar un pago con su voucher | Cada pago llega con su voucher: la inteligencia artificial lo revisa y el tesorero confirma que llegó a la cuenta. |
| 4 | Medios de pago → tarjeta del block con su junta y su cuenta | Cada block tiene su junta y la cuenta donde pagan sus vecinos, siempre al día. |
| 5 | Morosidad → detalle de los recibos vencidos de un departamento | La morosidad, ordenada: quién debe, cuánto, desde cuándo, y el detalle de cada recibo. |
| 6 | Comunicados → nuevo comunicado (se escribe el título) | ¿Un corte de agua? Escribe un comunicado y llega a todos tus vecinos. |
| 7 | Comunicados › Envíos | Y aquí ves qué salió por WhatsApp y por correo, y qué hay que reintentar. |
| 8 | Juntas directivas → Nueva gestión | Cuando cambia la junta, registras la nueva gestión y los permisos pasan solos. |
| 9 | Cierres del mes → Block 1, octubre | Al cerrar el mes, cada tesorero registra lo que paga, y tú ves el estado de todos los blocks. |
| 10 | Periodo → Consolidado del block | Y el consolidado del block sale listo para imprimir junto con el recibo de cada vecino, sin armar el Excel a mano. |
| 11 | Cierre | House. Tu condominio, en orden. |

## 3. Para la junta directiva (≈ 45 s; tesorera del Block 1)

| # | En pantalla | Voz |
|---|---|---|
| 1 | Mi junta | Si eres de la junta de tu block, House te da tu propio espacio. |
| 2 | Pagos → un pago con su voucher | Ves cada pago de tus vecinos con su voucher, y como tesorero confirmas que el dinero llegó a la cuenta. |
| 3 | Medios de pago de la junta | Mantienes al día la cuenta donde pagan tus vecinos. |
| 4 | Lecturas de agua | Cargas las lecturas de agua del block. |
| 5 | Cierre del mes (octubre) | Al cerrar el mes, registras lo que va a la administración, a la Junta central y a los servicios. |
| 6 | Comunicados → nuevo comunicado | Y avisas a tus vecinos con un comunicado. |
| 7 | Cierre | House. Tu condominio, en orden. |

## 4. Para el vecino (≈ 40 s, primero celular)

| # | En pantalla | Voz |
|---|---|---|
| 1 | Inicio del propietario | Tu condominio, en tu celular. |
| 2 | Mis recibos → detalle por concepto | Mira tu mantenimiento del mes, concepto por concepto. |
| 3 | Pagar mantenimiento → voucher | Paga y sube tu voucher en un minuto. |
| 4 | Mi historial → Por concepto | Mira cómo evolucionan tus pagos mes a mes. |
| 5 | Mi junta | Conoce a la junta de tu block y a la Junta central. |
| 6 | Proveedores | Encuentra a los proveedores de confianza de tu condominio. |
| 7 | Comunicados | Y entérate de todo lo que pasa en tu edificio. |
| 8 | Cierre | House. Tu condominio, en orden. |

---

## Cómo se arma (para regrabar)

1. Datos: `npm run seed:libertadores` (sólo base local), backend con remitentes apagados, Vite en 5173.
   Para los cierres, el seed local necesita un recibo POR BLOCK y conceptos con destino: en la base local se separó el recibo de
   octubre del Block 1 (recibo propio con sus cargos) y se asignó destino a los conceptos 22–29 (respaldo previo con `pg_dump`).
2. Grabación: `node scripts/marketing/grabar-video.mjs <video> <escritorio|celular>` (Playwright; ventana 1600×900 o 540×960,
   el montaje la agranda a 1920×1080 o 1080×1920); cursor visible, la duración de cada escena la manda su voz.
3. Voz: un audio por escena con `audio_generar` (My Workspace, `voice: "ef_dora"`); la duración de cada escena la manda su audio.
4. Montaje: `scripts/marketing/montar-video.sh <video> <formato>` (ffmpeg, H.264 + AAC); sin música por ahora.
