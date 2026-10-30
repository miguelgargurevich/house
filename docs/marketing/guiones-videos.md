# Guiones de los videos de House

Versión del 29-oct-2026. Cuatro videos, cada uno en **escritorio (16:9, 1920×1080)** y **celular (9:16, 1080×1920)**.
Pantallas reales de House en local con el seed de Los Libertadores (datos de prueba, ningún dato real). Narración con la voz
OpenVoice de My Workspace (aprobada por Miguel el 29-oct). Cada escena: lo que se ve → lo que dice la voz. Duración objetivo ≈ 60 s
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

## 2. Para la administradora (≈ 90 s)

| # | En pantalla | Voz |
|---|---|---|
| 1 | Resumen de la administradora | Este es tu día a día en House: todo el condominio en una pantalla. |
| 2 | Recibos → periodo agrupado por block, avance de cobro | Emite el mantenimiento del mes y míralo por block, con cuánto ya se cobró. |
| 3 | Pagos → un pago con su comprobante | Cada pago llega con su comprobante; lo revisas y lo validas. |
| 4 | Medios de pago → tarjeta del block con su junta y su cuenta | Cada block tiene su junta y la cuenta donde pagan sus vecinos, siempre al día. |
| 5 | Morosidad | La morosidad, ordenada: quién debe, cuánto y desde cuándo. |
| 6 | Comunicados → nuevo comunicado | ¿Un corte de agua? Escribe un comunicado y llega a todos. |
| 7 | Comunicados › Envíos | Y aquí ves qué salió por WhatsApp y correo, y qué hay que reintentar. |
| 8 | Juntas directivas → nueva gestión | Cuando cambia la junta, registras la nueva gestión y los permisos pasan solos. |
| 9 | Asistente abierto respondiendo | Y si tienes una duda, el asistente te responde con los datos de tu condominio. |
| 10 | Cierre | House. Tu condominio, en orden. |

## 3. Para la junta directiva (≈ 60 s)

| # | En pantalla | Voz |
|---|---|---|
| 1 | Mi junta (presidente) | Si eres de la junta de tu block, House te da tu propio espacio. |
| 2 | Pagos por validar | Validas los pagos de tus vecinos con su comprobante a la vista. |
| 3 | Medios de pago de la junta | Mantienes al día la cuenta donde pagan. |
| 4 | Lecturas de agua | Cargas las lecturas de agua del block. |
| 5 | Comunicados de la junta | Y avisas a tus vecinos con un comunicado. |
| 6 | Cierre | House. Tu condominio, en orden. |

## 4. Para el vecino (≈ 60 s, primero celular)

| # | En pantalla | Voz |
|---|---|---|
| 1 | Inicio del propietario en el celular | Tu condominio, en tu celular. |
| 2 | Mis recibos → detalle por concepto | Mira tu mantenimiento del mes, concepto por concepto. |
| 3 | Pagar mantenimiento → comprobante | Paga y sube tu comprobante en un minuto. |
| 4 | Mi historial → Por concepto / Acumulado | Mira cómo evolucionan tus pagos mes a mes. |
| 5 | Mi junta | Conoce a la junta de tu block y escríbele cuando lo necesites. |
| 6 | Comunicados | Y entérate de todo lo que pasa en tu edificio. |
| 7 | Cierre | House. Tu condominio, en orden. |

---

## Cómo se arma (para regrabar)

1. Datos: `npm run seed:libertadores` (sólo base local), backend con remitentes apagados, Vite en 5173.
2. Grabación: Playwright (Chromium) con `recordVideo`, 1920×1080 y 390×844 (×2,77 → 1080×1920), una corrida por video y formato;
   cursor visible, pausas al ritmo de la voz.
3. Voz: un audio por escena con `audio_generar` (My Workspace); la duración de cada escena la manda su audio.
4. Montaje: ffmpeg une escenas y audios; sin música por ahora.
