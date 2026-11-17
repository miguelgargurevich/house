# Avisos push de Torre (app y navegador)

Estado (17-nov-2026): **construido y probado con envíos simulados; NO probado contra Firebase ni contra un navegador real** (no hay cuenta de Firebase ni llaves VAPID todavía). Hasta que las pongas, todo queda apagado: los avisos push se omiten con un renglón en el log y el servidor arranca igual.

Es la receta del Portal de Dealers (`portal-dealers-vendedores`) adaptada a Torre: FCM HTTP v1 para la app (Android; iPhone preparado) y Web Push (VAPID) para el navegador.

## 1. Qué se avisa y por qué

Torre ya tiene un sistema de avisos: una cola (`Notificacion`) con correo y WhatsApp, con reintentos, sin repetir (clave única por persona, canal, tipo y referencia) y con historial («Mis avisos», «Envíos»). **El push es un canal más de esa misma cola** (`canal = 'push'`), no un sistema aparte: cada aviso que ya existe sale también al dispositivo de quien lo registró, y todo lo demás (preferencias del condominio, anulaciones, reintentos, historial) funciona igual.

| Aviso (`tipo`) | Push | Texto (ejemplo) | Se abre |
|---|---|---|---|
| `recibo_emitido` | sí | «Tu recibo de octubre de 2026 ya está» · «Vence el lunes 2 de noviembre. Revísalo y págalo en Torre.» | Cargos |
| `por_vencer`, `vence_hoy`, `vencido` | sí | «Tu recibo vence mañana» · «Recibo de octubre de 2026. Paga y sube tu voucher a tiempo.» | Cargos |
| `recordatorio_deuda` (morosidad, a mano) | sí | «Tienes pagos pendientes» | Cargos |
| `recibo_anulado` | sí | «Se anuló tu recibo de octubre de 2026» | Cargos |
| `pago_rechazado`, `pago_anulado` | sí | «No pudimos validar tu pago» · «Pago de octubre de 2026. Revisa el motivo y vuelve a enviar tu comprobante.» | Pagos |
| `comunicado` | sí | «Nuevo comunicado» · el título | Comunicados |
| `cierre_pendiente` (tesorero) | sí | «Faltan pagos en el cierre de octubre de 2026» | Cierre del mes / Junta central |
| `ia_caida` (superadmin) | sí | «El asistente de IA se quedó sin proveedores» | Llavero |
| `pago_validado` | **no** | — | ningún canal lo manda hoy: la persona ya lo ve al subir su voucher |
| `ia_restablecida` | **no** | — | no pide ninguna acción |

Lo que el push **nunca** dice: montos, nombres, motivos de rechazo ni documentos. Sale en la pantalla bloqueada. El correo y el WhatsApp llevan el detalle; el push sólo invita a abrir Torre. Hay dos redes: el texto lo arma `services/push/textos.ts` sólo con el periodo, la fecha de vencimiento, el título del comunicado y el block, y antes de enviar `esSeguro()` descarta cualquier texto con 8+ dígitos seguidos, cifras con formato de dinero o marcas de moneda (un comunicado «Cuota extraordinaria S/ 50» sale como «Tu administración publicó un comunicado»).

**Quién lo recibe:** quien tenga al menos un dispositivo registrado. No depende de sus preferencias de correo/WhatsApp (puede tener ambas apagadas) **en los avisos que pasan directo por `encolarAviso`**: recibo emitido, recordatorios automáticos de vencimiento, comunicados, rechazos/anulaciones de pago y cierres. **Excepción:** «Avisar a los vecinos» (recibo) y «Enviar recordatorio» (Morosidad) planifican con `canalesDe` (sólo correo/WhatsApp): quien tiene únicamente push cuenta como «sin canal» y no se le encola nada; quien tiene además correo o WhatsApp sí recibe también el push. Registrar el dispositivo es la elección; quitarlo (cerrar sesión, «Dejar de recibir avisos») es apagarlo. Todavía no hay silenciar por tipo.

## 2. Cómo está hecho

| Pieza | Dónde |
|---|---|
| Tabla de dispositivos | `DispositivoPush` (`prisma/schema.prisma`; producción la crea sola en el arranque con `prisma db push`). Por persona (`usuario_id`); tipo `fcm` (token) o `web` (endpoint + llaves); `token` único: un dispositivo es de la última sesión que entró. Tope de 10 por persona. |
| «Tabla de enviados» | No hay una aparte: la fila `Notificacion` (`canal = 'push'`) **es** el registro y su clave única `[usuario, canal, tipo, ref_entidad, ref_id]` evita repetir. |
| Qué se encola | `encolarAviso` (`services/avisos/cola.ts`) agrega la fila `push` si el tipo vale un push y la persona tiene dispositivos. |
| Envío | `procesarCola` → `services/push/enviar.ts`: a TODOS los dispositivos de la persona (siempre filtrando por `usuario_id`); `ok` si salió a uno; `omitida` si no hay variables, no hay dispositivos, la cuenta se eliminó o es la demo; `fallo` (se reintenta 2 y 10 min, máx. 3) si todos fallaron. |
| FCM | `services/push/fcm.ts`: cuenta de servicio → JWT RS256 → token de acceso (se guarda hasta 1 min antes de vencer; un 401 lo renueva una vez) → `POST /v1/projects/{id}/messages:send`. Sin librerías nuevas. |
| Web Push | `services/push/webpush.ts`: la librería `web-push` arma la petición cifrada (aes128gcm + VAPID); el POST sale por el `fetch` inyectado. |
| Rutas | `GET /api/me/push/config`, `POST /api/me/push/dispositivos`, `POST /api/me/push/dispositivos/baja` (ver `docs/API-CONTRATO.md`). |
| Web | `public/sw.js` (service worker sólo de push, sin caché), `src/app/push.ts`, tarjeta «Avisos en este navegador» en Mi perfil. |
| App | `src/app/pushApp.ts` (puente al plugin por `window.Capacitor`, como en el Portal), `@capacitor/push-notifications` en `mobile/`. |
| Arranque | `server.ts` loguea una línea por canal: «FCM … activo/apagado: falta X». Sólo nombres de variables. |

**Borrado de dispositivos:** sólo cuando el proveedor dice con todas las letras que ya no existen. FCM: `UNREGISTERED` en el detalle del error, o un 400 que se queja del *registration token*. **Un 404 a secas NO borra** (se aparta del «404/410» genérico a propósito): FCM también da 404 cuando el proyecto está mal escrito, y borraría los teléfonos de todos. Web Push: 404 y 410 sí (ahí significan «suscripción revocada»).

**Seguridad:** el `endpoint` de Web Push lo manda el cliente y el servidor le hace un POST: sólo se aceptan servicios de push de navegadores (`services/push/endpoints.ts`: https, sin usuario ni puerto raro; `fcm.googleapis.com`, `*.push.services.mozilla.com`, `web.push.apple.com`/`*.push.apple.com`, `*.notify.windows.com`); cualquier otro → 422 y, si hubiera una fila vieja, tampoco sale. Con sesión prestada («Entrar como») no se registra nada. Ni el token ni el endpoint van a la auditoría ni al log. La cuenta de servicio y las llaves salen sólo de variables de entorno.

## 3. Pasos para Miguel

### A. Web Push (navegador) — lo más rápido, no necesita app nueva

1. En tu terminal: `npx web-push generate-vapid-keys` (te da una llave pública y una privada).
2. En Coolify, app **torre** → variables de entorno:
   - `VAPID_PUBLIC_KEY` = la pública
   - `VAPID_PRIVATE_KEY` = la privada
   - `VAPID_SUBJECT` = `mailto:` + un correo tuyo de contacto (p. ej. `mailto:soporte@torrecondominios.com`)
3. Redespliega. En el log debe salir `[push] Web Push (navegador): activo`.
4. Entra a Mi perfil › **Avisos en este navegador** › «Recibir avisos en este navegador».

Notas: en **iPhone/Safari** sólo funciona con Torre agregada a la pantalla de inicio (Compartir › «Agregar a inicio») y abierta desde ese ícono; la tarjeta lo explica. Si la persona bloquea las notificaciones del sitio, tiene que permitirlas en la configuración del navegador.

### B. App de Android (FCM)

1. Firebase (https://console.firebase.google.com) › **Agregar proyecto** (p. ej. «Torre»).
2. En el proyecto › **Agregar app › Android**: nombre del paquete **`com.torrecondominios.app`** (es el `applicationId` real de `mobile/android/app/build.gradle`). Descarga **`google-services.json`** y ponlo en `mobile/android/app/google-services.json` (está en el `.gitignore`: no se sube).
3. Firebase › ⚙ Configuración del proyecto › **Cuentas de servicio** › «Generar nueva clave privada» → baja un JSON. Conviértelo a base64 en una línea: `base64 -i cuenta.json | tr -d '\n'`.
4. **ORDEN (importante):** primero el APK, después las variables.
   1. Con `google-services.json` en su lugar: `cd mobile && npm run sync:prod && npm run verificar` (ya no debe salir la ADVERTENCIA de `google-services.json`) y compila/publica el APK o AAB (`npm run apk:release`, o `npm run apk:debug` para probar).
   2. Instálalo en el teléfono.
   3. **Recién entonces** en Coolify › app **torre**: `FCM_PROJECT_ID` = el id del proyecto (Firebase › Configuración › General) y `FCM_SERVICE_ACCOUNT_BASE64` = el base64 del paso 3. Redespliega; el log debe decir `[push] FCM (Android/iPhone): activo`.
   **Por qué:** el plugin llama a Firebase al registrarse y, sin `google-services.json` dentro del APK, lanza una excepción que (según el código de Capacitor, `Bridge.java`: «Serious error executing plugin» → `RuntimeException`) tumbaría la app; no lo probé en un teléfono, pero no vale la pena arriesgarlo. La web sólo registra el teléfono cuando el servidor dice que FCM está listo (`GET /api/me/push/config` → `fcm: true`); por eso las variables van **después** del APK que trae el archivo. Un APK nuevo sin el archivo + variables puestas = la app puede cerrarse al iniciar sesión. Un APK viejo (sin el plugin) no hace nada.
5. Prueba: abre la app, inicia sesión (te pide el permiso de notificaciones en Android 13+), y emite un recibo o publica un comunicado para ese usuario.

### C. iPhone (preparado, apagado)

Falta, y no lo toqué (firma de iOS): 

1. Cuenta de **Apple Developer de pago**. 
2. En Apple Developer › Keys: crea una **clave APNs** (.p8) y súbela a Firebase › Configuración › **Cloud Messaging › Configuración de la app de Apple** (Key ID y Team ID). 
3. En Firebase agrega la **app iOS** con el bundle id **`com.torrecondominios.app`**.
4. En Xcode (target App › Signing & Capabilities): **Push Notifications** y **Background Modes › Remote notifications**.
5. **Token de FCM en iOS (falta código nativo):** `@capacitor/push-notifications` entrega en iOS el token de **APNs**, no el de FCM, y FCM HTTP v1 lo rechaza (el servidor lo borraría como inválido). Hay que agregar el SDK de Firebase Messaging a `mobile/ios` (SwiftPM), `FirebaseApp.configure()` en `AppDelegate`, pasarle el token de APNs a Firebase y devolver al plugin el token de FCM. Es lo mismo que le falta al Portal. No lo hice: no tengo Xcode con tu cuenta para verificarlo.
6. Cuando todo eso funcione, cambia `IOS_LISTO` a `true` en `src/app/pushApp.ts`. Mientras sea `false`, la app de iOS no registra nada.

## 4. Cómo verificar (cuando haya llaves)

1. `GET /api/me/push/config` (con sesión) → `{fcm:true,web:true,vapid_public:"…"}`.
2. Registra un dispositivo (activa el navegador o inicia sesión en la app) → debe existir una fila en `DispositivoPush`.
3. Genera un aviso: emite un recibo o publica un comunicado (si usas «Enviar recordatorio» de Morosidad, la persona de prueba debe tener también correo o WhatsApp activo). El planificador procesa la cola cada 15 min (o al emitir, a los ~1 s).
4. Revisa Envíos (filtro por tipo) o «Mis avisos»: la fila **Push** debe quedar **enviada**. «Omitida · Canal no configurado» = faltan variables; «Omitida · Sin dispositivos» = no hay ninguno válido.

## 5. Lo que NO está verificado

- Ningún envío real a FCM, a un servicio de Web Push, a un teléfono ni a un navegador (todo se probó con `fetch` inyectado: los formatos son los que documentan Google y el estándar; lo primero con cuenta debe ser un envío real a un teléfono propio).
- Que la app de Android se compile y registre con `google-services.json` real (se hizo `cap sync android`, no un APK).
- iPhone (ver C) y Safari en iPhone instalado.
- La pantalla «Avisos en este navegador» en un navegador de verdad (sólo se probó su lógica y su cableado).
