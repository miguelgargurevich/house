# App móvil de Torre (iOS y Android)

La app es **la misma web de Torre dentro de una app nativa** (Capacitor 8). No hay una segunda versión del producto: la app abre https://torrecondominios.com en un WebView, así que cada despliegue de la web llega a la app al instante, sin pasar por las tiendas. Lo que sí es nativo es lo que un WebView no hace solo: cámara y galería para el voucher, descargas de PDF y Excel, botón Atrás de Android, pantalla sin conexión, ícono y splash.

Estado (10-nov-2026): fase 1 lista para **probar**, sin publicar. Android compila y se probó en emulador; iOS compila con Xcode 26 y se probó en el simulador de iPhone (sección «iOS»), pero **no en un iPhone real**. Todavía no hay cuentas de desarrollador.

## Cómo funciona

| Pieza | Dónde | Qué hace |
|---|---|---|
| Configuración | `mobile/capacitor.config.ts` | `server.url` = Torre en producción **con la ruta de inicio**, `https://torrecondominios.com/login` (igual que el `start_url` de la PWA; **no** uses `appStartPath`: en iOS, con `server.url`, se busca como archivo local `public//login` y la app se cierra al abrir), `allowNavigation` sólo `torrecondominios.com` y `www.`, `errorPath` = pantalla sin conexión, `appendUserAgent` = `TorreApp/<versión>`. |
| Pantalla sin conexión | `mobile/www-src/offline.html` | Local (no necesita red). Se copia a `mobile/www/` al sincronizar. «Reintentar» recarga Torre; también reintenta sola al volver la red. |
| Dirección a cargar | `mobile/scripts/entorno.cjs` | Producción por defecto. `TORRE_URL=http://10.0.2.2:4000` la cambia sólo para desarrollo. |
| Android nativo | `mobile/android/app/src/main/java/com/torrecondominios/app/` | `MainActivity` (Atrás, descargas, cámara), `Descargas.java`, `CamaraWebChromeClient.java`. |
| iOS nativo | `mobile/ios/App/App/TorreViewController.swift` (lo crea `SceneDelegate.swift`) | Descargas (WKDownload + hoja de compartir), reintento ante cortes de red de HTTP/3, que una descarga no deje «Sin conexión», y franja de desenfoque bajo la barra de estado. |
| Web | `src/app/instalar.ts` | `dentroDeLaApp()` reconoce `TorreApp/` en el user agent y oculta «Instalar Torre». Prueba en `tests/instalar-app.test.ts`. |

Lo que NO cambió: autenticación (cookie httpOnly + CSRF en el mismo origen), CORS, el backend y las variables de entorno del servidor. Como la app carga la web desde el mismo origen, todo eso funciona igual que en el navegador.

Comportamientos que da Capacitor sin código propio:

- Un enlace a otro dominio (WhatsApp `wa.me`, Instagram, el manual en `s3.gargurevich.dev`, `mailto:`, `tel:`) se abre **fuera** de la app, en el navegador o en la app del sistema. Probado en Android con `wa.me`, `target="_blank"` y `mailto:`, y en iOS con el botón de WhatsApp (abre Safari).
- Los permisos de cámara y fotos se piden al usarlos por primera vez.

## Estructura de `mobile/`

```
mobile/
  package.json            dependencias propias (NO usa el node_modules de la raíz) y la versión
  capacitor.config.ts     configuración (ver tabla)
  scripts/                entorno.cjs, preparar.mjs, verificar.mjs, version.mjs, generar-assets.py
  www-src/offline.html    pantalla sin conexión (plantilla)
  www/                    generado por `npm run sync` (no se commitea)
  assets/                 fuentes de ícono y splash (generadas desde la torre de Torre)
  android/                proyecto de Android Studio / Gradle (se commitea, salvo builds)
  ios/                    proyecto de Xcode (se commitea, salvo Pods y DerivedData)
```

Regla de oro: **nunca corras `npm install` en la raíz del repo desde un worktree** (su `node_modules` es un enlace al checkout principal). En `mobile/` sí: es independiente.

## Android: construir y probar

Requisitos: Android SDK (`~/Library/Android/sdk`, con plataforma 36 que descarga Gradle sola), Java 17 o superior (hay 22), `adb`. Exporta `ANDROID_HOME`.

```bash
cd mobile
npm install
export ANDROID_HOME=$HOME/Library/Android/sdk

# APK de depuración apuntando a PRODUCCION (el que se parece al de tienda)
npm run apk:debug          # = sync + gradlew assembleDebug
# sale en mobile/android/app/build/outputs/apk/debug/app-debug.apk

# instalar y abrir en un emulador o teléfono conectado
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.torrecondominios.app/.MainActivity
```

Emuladores de esta Mac: `Pixel_3a_API_34_extension_level_7_arm64-v8a` y `pixel_5_-_api_33`. Si el emulador arranca y se cae (pasó con `-gpu auto` en macOS 26), usa `emulator -avd <nombre> -no-snapshot -gpu swiftshader_indirect`. Si `adb devices` muestra varios, elige uno con `ANDROID_SERIAL=emulator-5556`.

### Probar con sesión contra un backend local (nunca contra producción)

El emulador ve tu Mac como `10.0.2.2`. La app carga la web desde el mismo origen que la API, así que lo más simple es que el backend local sirva el frontend compilado:

```bash
# en la raíz del repo (o del worktree)
npm run build                                  # genera dist/
DATABASE_URL=postgresql://…/house_xxx PORT=4000 JWT_SECRET=<un-secreto-de-pruebas-de-32+-caracteres> npx tsx src/server.ts

# en mobile/
TORRE_URL=http://10.0.2.2:4000 npm run apk:debug
```

Con `TORRE_URL` de desarrollo el build queda marcado: `cleartext` activado (sólo para `http://`), depurador web encendido (`chrome://inspect` ve el WebView) y el script avisa `ATENCION: build de DESARROLLO`. **Ese APK no se sube a ninguna tienda.** Las cuentas de prueba están en `src/pages/Login.tsx` (DEMO) y en `AGENTS.md` (seed de Los Libertadores).

Antes de cualquier build de tienda, `npm run sync:prod` ignora `TORRE_URL` y `npm run verificar` falla si la configuración que quedó dentro de las apps trae una dirección de desarrollo, `cleartext` o el depurador encendido. `npm run apk:release` ya encadena las dos cosas.

### Qué se probó de verdad en el emulador (Pixel 3a, Android 14, 10-nov-2026)

| Prueba | Resultado |
|---|---|
| Compila `assembleDebug` y `bundleRelease` | Sí. APK de depuración de 4,4 MB; AAB sin firmar de 3,0 MB. |
| Abre en `/login` y el user agent trae `TorreApp/1.0.0` | Sí. |
| Inicio de sesión con cuenta de prueba local y pantalla de inicio de un propietario | Sí (la cookie funciona dentro del WebView). |
| Enlaces externos: `wa.me`, `target="_blank"` (Instagram), `mailto:` | Se abren fuera de la app (otra app, Chrome, Gmail). Atrás vuelve a Torre. |
| Descarga de Excel real de Torre (`mi-historial.xlsx`) con la sesión | Sí: se baja con las cookies y se ofrece la hoja de compartir. |
| Descarga PDF (servidor de prueba con `Content-Disposition: attachment`) | Sí: se abre en el visor de PDF con el nombre del servidor. |
| Descarga de CSV armado en el navegador (`blob:` + `<a download>`) | Sí, con el nombre original (`cobranza-prueba.csv`). |
| Subir voucher desde galería / archivos (el selector con PDF e imágenes) | Sí: el archivo llega al formulario («voucher-prueba.jpg · 18 KB»). No se envió el pago. |
| Botón de cámara (`input` con `capture`) | Pide el permiso y abre la cámara. No se completó una foto de punta a punta contra el formulario de Torre. |
| Sin conexión + Reintentar | Sí: con el backend apagado sale la pantalla; al volver, «Reintentar» recupera la sesión. |
| Botón Atrás | Sí: vuelve en el historial y, en la raíz, manda la app al fondo. |

Sin verificar en Android: Android 15 o superior (borde a borde forzado; sólo hay imágenes de API 33 y 34), tabletas, enlace de descarga PDF desde pantallas reales de Torre (se probó la misma ruta con un PDF de prueba y un Excel real), foto de cámara real de punta a punta, notificaciones (no existen aún).

## iOS: construir y probar

Requisitos: Xcode 16 o superior (se probó con 26.6; runtimes de iPhone 18.4, 18.5 y 26.5), `npm install` en `mobile/`. Swift Package Manager, **sin CocoaPods**. Para el simulador no hace falta cuenta ni firma.

```bash
cd mobile
npm install
npm run sync:prod                  # o TORRE_URL=http://localhost:4000 npm run sync para un build de desarrollo

# compilar para un simulador (id con `xcrun simctl list devices`)
env -u GIT_CONFIG_PARAMETERS xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'id=<UDID>' build

# instalar y abrir (la app queda en DerivedData: Build/Products/Debug-iphonesimulator/App.app)
xcrun simctl install <UDID> <ruta>/App.app
xcrun simctl launch --console-pty <UDID> com.torrecondominios.app   # muestra los logs de Capacitor
xcrun simctl io <UDID> screenshot captura.png
```

O abre `npx cap open ios` y pulsa Run. Para un iPhone real o TestFlight: target **App**, Signing & Capabilities, «Automatically manage signing» y tu equipo de Apple Developer.

Gotchas encontrados al probar:

- **`xcodebuild` falla con «Couldn't get the list of tags … safe.bareRepository is 'explicit'»** cuando se corre desde una sesión de Claude Code: hereda `GIT_CONFIG_PARAMETERS` y el git de SwiftPM no puede usar sus repositorios en caché. Corre `xcodebuild` con `env -u GIT_CONFIG_PARAMETERS`.
- **Worktrees**: si `mobile/node_modules` es un enlace al checkout principal, `cap sync` escribe rutas relativas a ese checkout en `ios/App/CapApp-SPM/Package.swift` y `android/capacitor.settings.gradle` (se ve en `git diff`). Usa un `node_modules` propio (`rm mobile/node_modules` si es un enlace, y `npm ci`) y no commitees esos dos archivos con rutas ajenas.
- **`ios/App/App/SceneDelegate.swift` debe crear `TorreViewController`**, no `CAPBridgeViewController`: la plantilla de Capacitor 8 con escenas arma la vista en código e ignora la clase del storyboard, así que el código propio no corría (descargas incluidas).
- **El simulador de iPhone con HTTP/3**: ver el siguiente apartado. En el simulador conviene apagarlo: `xcrun simctl spawn <UDID> defaults write -g CFNetworkHTTP3Override -bool NO` (se revierte con `defaults delete -g CFNetworkHTTP3Override`). Sólo afecta a ese simulador.
- WebKit **bloquea ciertos puertos** (1, 7, 9, 25…): probar «sin conexión» con `http://localhost:1` deja la pantalla en blanco. Usa un puerto libre normal (por ejemplo `TORRE_URL=http://localhost:59999`).
- Las capturas por `xcrun simctl io … screenshot` no necesitan tocar la ventana del Simulador; para tocar la pantalla se usó `cliclick` sobre la ventana (con otra sesión usando el Simulador, mueve la ventana a una zona libre de la pantalla antes).

### Por qué la app se cerraba al abrir, y por qué salía «Sin conexión»

Dos fallos distintos, el primero de configuración y el segundo del entorno de prueba:

1. **Se cerraba al abrir** (`⚡️ ERROR: Unable to load …/App.app/public//login — This file is the root of your web app and must exist`). `CAPBridgeViewController.loadWebView` comprueba que exista el **archivo** `public/<appStartPath>` aunque haya `server.url`. Con `appStartPath: '/login'` busca `public//login`, no existe y llama a `fatalLoadError()`. Solución: poner la ruta en la propia `server.url` (`https://torrecondominios.com/login`) y quitar `appStartPath`. Es igual en Android, y `scripts/verificar.mjs` ahora espera esa URL.
2. **«Sin conexión» tras cargar** (`WebView failed provisional navigation`, errores `NSURLErrorNetworkConnectionLost` -1005 o «no se puede analizar la respuesta» -1017). **No es de la app**: el servidor de Torre anuncia HTTP/3 (`alt-svc: h3=":443"`) y en el simulador de iPhone la conexión QUIC se abre bien y enseguida se corta. Evidencia: con HTTP/3 activo la app falló en 7 de 10 aperturas y **Safari del mismo simulador falló en 5 de 6** («Safari no puede abrir la página porque se interrumpió la conexión de red»); con HTTP/3 apagado en el simulador, **0 de 6** fallos; en la Mac real, un programa con `URLSession` obtuvo `h3` 200 en 11 de 11. Es decir, el servidor está bien y el problema es el QUIC del simulador. En un iPhone real no se ha visto (no se ha probado).

Por si en un iPhone real o en una red con UDP filtrado pasara algo parecido, `TorreViewController` reintenta hasta 2 veces la carga de la página (sólo GET, sólo para -1005 y -1017) antes de dejar que Capacitor muestre «Sin conexión». En el simulador con HTTP/3 activo eso rescató 3 de 8 aperturas: es una mitigación parcial, no la causa.

### Qué se probó en el simulador (iPhone 16, iOS 18.4, 10-nov-2026)

| Prueba | Resultado |
|---|---|
| Compila (`BUILD SUCCEEDED`, Xcode 26.6) | Sí. Se corrigió además `TorreViewController` y `SceneDelegate` (nunca se habían compilado). |
| Abre en `https://torrecondominios.com/login` (producción), sin cerrarse | Sí, con HTTP/3 apagado en el simulador: 6 de 6 y las pruebas finales. Con HTTP/3 activo, intermitente (ver arriba). |
| Sesión con cuenta de prueba contra el backend LOCAL (`TORRE_URL=http://localhost:4000`) | Sí: login de un propietario, inicio con su deuda; al cerrar y abrir la app la cookie sigue y entra directo al panel. No se inició sesión en producción. |
| Zona segura: contenido bajo la hora y la isla dinámica al hacer scroll | Corregido con una franja de desenfoque bajo la barra de estado (antes el texto pasaba por debajo de la hora). |
| Enlace externo: botón de WhatsApp de la portada pública (producción) | Sale de la app y abre Safari (`api.whatsapp.com`). El aviso de «dirección no válida» es el esquema `whatsapp://`: el simulador no tiene WhatsApp. |
| Sin conexión (`TORRE_URL` a un puerto sin servidor) | Sale la pantalla «Sin conexión». «Reintentar» con el servidor aún apagado vuelve a ella; al levantar un servidor de prueba, carga la página. |
| Descarga con sesión: `/api/me/historial.xlsx` (`Content-Disposition: attachment`) | Sale la hoja de compartir con «mi-historial · Hoja de cálculo · 26 KB» y «Guardar en Archivos». Antes la página se reemplazaba por «Sin conexión» detrás de la hoja (WebKit 102): corregido. |
| Voucher desde galería: «Seleccionar archivo» → Fototeca → una foto | Sí: el selector nativo ofrece Fototeca, Hacer foto y Seleccionar archivo; la foto llegó al formulario (y la propia web la rechazó por pesar 3,9 MB: máximo 2 MB). No se envió el pago. |

Sin verificar en iOS: **un iPhone real** (HTTP/3 real, firma, TestFlight), **cámara** (el simulador no tiene: sólo se vio que el menú ofrece «Hacer foto»; el permiso y su texto no se vieron), descarga de un **PDF** y por `<a download>` con `blob:` (sólo se ejerció la ruta `attachment` con un Excel; los otros caminos están en `TorreViewController` pero no se probaron), guardar de verdad el archivo en Archivos, **iPad**, modo oscuro, modo avión real, rotación (la app es vertical), VoiceOver. Observación para la web (no se tocó `src/`): una foto de la galería o de la cámara de un iPhone suele pesar más de 2 MB y el formulario del voucher la rechaza sin comprimirla; conviene comprimir en el navegador antes de decidir publicar. También, la portada pública dentro de la app sigue ofreciendo «Descarga la app para Android».

Textos de permisos (ya en `Info.plist`, en español):

- Cámara: «Torre usa la cámara para que tomes una foto del voucher o comprobante de tu pago.»
- Fotos: «Torre accede a tus fotos para que elijas el voucher o comprobante de tu pago.» (el selector de fotos de iOS es privado: no pide permiso; ofrece sólo lo que la persona elige)

## Íconos y splash

`npm run assets` (en `mobile/`) dibuja las fuentes en `mobile/assets/` con las mismas medidas que `src/ui/IconoTorre.tsx` (reutiliza `scripts/marketing/iconos-torre.py` a 1024 px) y luego `capacitor-assets` genera todos los tamaños de Android e iOS. Verde de marca `#0f766e`, torre blanca. Si cambia el logo de Torre: corre el generador de la web y después `npm run assets`.

## Cambiar la versión

Una sola fuente: `mobile/package.json`.

```bash
cd mobile
npm run version -- 1.1.0          # sube el build en 1 (o: npm run version -- 1.1.0 7)
npm run sync:prod
```

- `version` es lo que ve la gente (`versionName` de Android, `MARKETING_VERSION` de iOS, y el `TorreApp/<versión>` del user agent).
- `torre.build` es el número de compilación (`versionCode` de Android, `CURRENT_PROJECT_VERSION` de iOS). **Cada subida a una tienda necesita un build mayor al anterior**, aunque la versión sea la misma.
- Una versión nueva de la **web** no necesita versión nueva de la app: la app carga la web en vivo. Sólo se sube versión cuando cambia algo nativo (permisos, íconos, plugins, código de `mobile/`).

## Distribución directa (APK) mientras no hay tienda

Mientras no esté en Google Play, la gente instala el APK desde la web: la página **`/app`** («Torre en tu celular») tiene el botón «Descargar para Android» y los pasos para instalarlo; el pie de todas las páginas públicas enlaza a `/app` y la portada tiene una línea «Descarga la app para Android». iPhone no tiene APK: `/app` le explica cómo instalar Torre desde Safari («Agregar a inicio»).

- **Dónde vive el APK**: en el bucket de Torre, en una dirección **estable** (`…/documentos/b601f104-…/app/torre-android.apk`). Esa dirección es `ConfiguracionComercial.url_app_android` (valor por defecto en `prisma/schema.prisma`); no está escrita en `src/`, una prueba lo vigila (`tests/app-descarga.test.ts`).
- **Cómo se publica un APK nuevo**: se firma el build de producción (`mobile/`, `npm run sync:prod` y el APK firmado con el keystore de `~/.torre/`, fuera del repo), y se **sube encima** del mismo archivo `torre-android.apk`. La dirección no cambia, así que no hay nada que tocar en la web.
- **Cómo se avisa de la versión**: en Superadmin › Precios, en «Versión de la app de Android», se pone el número nuevo (p. ej. `1.1.0`; es lo que muestra `/app` junto al botón). **Sin ese paso la gente no sabe que hay una versión nueva.** La versión sale de `mobile/package.json` (`npm run version -- 1.1.0`).
- **Actualizar sobre la versión instalada**: el APK tiene que estar firmado con la **misma** clave que la versión que ya tiene la persona. Con la misma clave, Android instala la nueva encima y conserva los datos; con otra, sólo se puede desinstalar y volver a instalar. No cambies el keystore.
- **Aviso de Android al instalar**: el teléfono pregunta si permites «Instalar apps de esta fuente» para el navegador que bajó el archivo (sólo una vez, lo explica el paso 3 de `/app`). Google Play Protect puede mostrar «app no verificada» porque no está en la tienda; es la firma propia de Torre, no un virus, pero conviene decirlo a quien la instala.
- **Versión mínima**: Android 7.0 (`minSdkVersion` 24, en `mobile/android/variables.gradle`).
- **Cuando salga en Google Play**: el botón de `/app` debe llevar a la ficha de la tienda, así que se cambia `url_app_android` por el enlace de Google Play (y se ajusta el texto «Pronto en Google Play» de `src/pages/publico/appMovil/textos.ts`), o se vacía para ocultarlo. Decide Miguel; hoy `/app` sigue con el APK.
- **Qué no hace `/app`**: no sabe si el teléfono es Android. Muestra los dos bloques (Android, iPhone) y el de Android sale sólo si la configuración trae el APK. Dentro de la app de Torre no ofrece ninguno de los dos (`dentroDeLaApp()`, con el user agent `TorreApp/`).

## Publicar: paso a paso

Antes de empezar, lee «Riesgos de rechazo» más abajo: hay tres temas (eliminar cuenta, precios, reseñas de Apple) que conviene resolver **antes** de pagar nada.

### Google Play (Android)

1. **Cuenta**: https://play.google.com/console, pago único de US$ 25. Google pide verificar identidad (documento y a veces dirección). Una cuenta personal nueva exige una **prueba cerrada** (hoy 12 probadores durante 14 días seguidos) antes de pasar a producción (confirma el requisito vigente en la consola); una cuenta de **organización** (con D-U-N-S) no. Para una empresa, abre la cuenta como organización.
2. **Crear la app** en la consola: nombre «Torre», idioma español (Perú), tipo App, gratuita, aceptar las declaraciones.
3. **Firma**. Usa **Play App Signing** (Google guarda la llave de firma definitiva) y tú sólo guardas una **llave de subida**:

   ```bash
   mkdir -p ~/.torre && chmod 700 ~/.torre
   keytool -genkeypair -v -keystore ~/.torre/torre-subida.jks -alias torre-subida \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

   Guarda el `.jks` y las contraseñas **fuera del repo**: `~/.torre/` más una copia en un gestor de contraseñas y otra en un respaldo cifrado. Si pierdes la llave de subida se puede restablecer con Google (con Play App Signing activo); si fuera una llave de firma propia sin Play App Signing, perderla es perder la app. El `.gitignore` ya excluye `*.jks` y `*.keystore`.

   Crea `~/.torre/android-keystore.properties` (también fuera del repo):

   ```
   storeFile=/Users/<tu-usuario>/.torre/torre-subida.jks
   storePassword=...
   keyAlias=torre-subida
   keyPassword=...
   ```

   `app/build.gradle` lo lee solo (otra ruta con `TORRE_KEYSTORE_PROPERTIES=/ruta`). *Nota: esta lectura de la firma se comprobó hasta el punto en que Gradle busca el keystore; no se firmó ningún paquete real.*
4. **Generar el paquete**: `cd mobile && npm run apk:release` (ejecuta `sync:prod`, `verificar` y `bundleRelease`). Sale en `mobile/android/app/build/outputs/bundle/release/app-release.aab`. Google Play pide el **AAB**, no el APK.
5. **Subir** el AAB a una pista (Prueba interna primero: instalas desde Play en tu teléfono y ves si todo va). Completar: ficha de la tienda (abajo), **Seguridad de los datos**, clasificación de contenido, público objetivo, **política de privacidad** y declaración de **eliminación de cuenta** (URL).
6. Enviar a revisión. La primera revisión suele tardar varios días.

### App Store (iOS)

1. **Cuenta**: https://developer.apple.com/programs, US$ 99 al año. Como individuo es inmediato; como organización pide un número D-U-N-S y tarda más (días a semanas). Con la cuenta de organización la ficha dice el nombre de la empresa, no el tuyo.
2. **Identificador**: en el portal de desarrollador crea el App ID `com.torrecondominios.app` (Xcode lo puede hacer solo con la firma automática).
3. **Ficha en App Store Connect**: «+» > Nueva app, plataforma iOS, nombre «Torre», idioma principal español (México; no hay Perú), bundle ID `com.torrecondominios.app`, SKU libre (por ejemplo `torre-ios`).
4. **Archivar**: en Xcode, destino «Any iOS Device (arm64)», Product > Archive, Distribute App > App Store Connect > Upload. Firma automática; Xcode crea los certificados.
5. **TestFlight**: en App Store Connect la compilación aparece en unos minutos. Agrega probadores internos (tú y tu equipo) y prueba en un iPhone real **antes** de enviar a revisión.
6. **Enviar a revisión** con: capturas, texto, URL de privacidad, **cuenta de prueba** y «Notas para el revisor» (abajo). Apple tarda de horas a pocos días.

### Fichas de tienda: textos sugeridos

**Nombre**: Torre. **Subtítulo (iOS, 30 caracteres)**: «Administra tu condominio».

**Descripción corta (Google Play, 80 caracteres)**: «Recibos, pagos y avisos de tu edificio o condominio, en tu celular.»

**Descripción larga** (ajusta lo que Miguel quiera destacar):

> Torre es la forma más simple de administrar un edificio o condominio en el Perú, y de vivir en uno.
>
> Si eres propietario o inquilino: mira cuánto debes y cuándo vence, paga y sube tu voucher con la cámara, descarga tu estado de cuenta y tus recibos, reserva áreas comunes y entérate de los comunicados de tu administración.
>
> Si administras: emite recibos, cobra y concilia pagos, controla la morosidad, manda avisos por WhatsApp y correo, y rinde cuentas a tu junta con reportes listos para descargar.
>
> Tus datos están protegidos: cada condominio ve sólo lo suyo.
>
> Necesitas una cuenta de Torre. Si todavía no tienes, créala gratis desde la app.

**Palabras clave (iOS, 100 caracteres)**: `condominio,edificio,administración,recibos,mantenimiento,pagos,junta,propietarios,vecinos,Perú`

**Categoría**: Negocios (principal) y Finanzas o Productividad (secundaria). **Clasificación por edades**: 4+ / Para todos. **Política de privacidad**: https://torrecondominios.com/privacidad. **Soporte**: https://torrecondominios.com/contacto (o el correo de soporte que defina Miguel).

**Capturas necesarias** (de la app real, con datos de prueba, sin datos de personas reales):

- Google Play: mínimo 2 (recomendado 5 o 6) de teléfono, 16:9 o 9:16, lado de 320 a 3840 px. Un ícono de 512 x 512 (ya está: `public/icon-512.png`) y un gráfico de funciones de 1024 x 500 (por hacer).
- App Store: iPhone de 6,9 pulgadas (1320 x 2868 px) obligatorias, de 3 a 10; si ofreces iPad, también de 13 pulgadas (2064 x 2752). Se sacan desde el simulador de Xcode (Cmd+S).
- Sugerencia de pantallas: inicio del propietario con la deuda, pagar y subir voucher, estado de cuenta, comunicados, panel del administrador, morosidad.

**Declaración de privacidad (Seguridad de los datos / App Privacy)** — Torre recoge: nombre, correo, teléfono, datos de la unidad y los pagos, fotos o PDF del voucher que la persona sube, identificadores de sesión. Sirven para operar la cuenta, no para publicidad y no se venden. Datos cifrados en tránsito (HTTPS). Confirma con la política de privacidad vigente antes de declararlos.

**Notas para el revisor (Apple) y credenciales de prueba**: hace falta una **cuenta de demostración en producción** (un propietario y un administrador de un condominio de demostración) cuyas credenciales se entregan en App Store Connect y en Google Play Console. No la crees con datos reales. Este paso lo hace Miguel.

## Riesgos de rechazo y cómo reducirlos

### Apple 4.2 (Funcionalidad mínima): «una web envuelta»

Apple rechaza apps que son sólo un sitio web empaquetado. Torre es un producto real con cuentas y trámites, pero el riesgo existe. Lo que ya ayuda y cómo presentarlo en las notas para el revisor:

- **Cámara y galería** para subir el voucher de un pago, con permisos propios y sus textos.
- **Descargas y compartir nativos** de recibos, estados de cuenta y Excel.
- **Pantalla sin conexión** con reintento (la app no se queda en blanco).
- Navegación y avisos propios del producto, no una portada de marketing: la app abre directo en el inicio de sesión.

Lo que más pesa y **todavía no existe**: las **notificaciones push** (avisos de recibo nuevo, pago validado, comunicado). Son lo que más convence a Apple de que la app aporta algo sobre el navegador. Por eso la fase 2 es recomendable antes del primer envío a Apple (ver abajo). Mientras tanto, describe en las notas la integración con cámara, archivos y el uso diario por vecinos y administradores.

### Eliminar cuenta (Apple 5.1.1(v) y Google Play)

Si la app permite **crear una cuenta** (Torre sí: «Crea tu cuenta gratis»), Apple exige que se pueda **eliminar la cuenta dentro de la app**, y Google Play exige una URL y una vía dentro de la app. **Hoy Torre no tiene esa función** (no se encontró en `src/`). Es el riesgo de rechazo más concreto. Opciones: construir «Eliminar mi cuenta» en la web (afecta backend y datos, hay que decidir qué pasa con los pagos y recibos históricos del condominio), o limitar el registro dentro de la app. Decídelo antes de enviar.

### Precios y pagos (Apple 3.1.1 / 3.1.3)

Si la app muestra planes con precio y lleva a pagar una suscripción, Apple puede pedir compra dentro de la app (30 % o 15 %). Hoy el pago de planes es **manual y fuera de la app** (transferencia o Yape, registrado por el superadmin), lo cual ayuda. Aun así, la pantalla «Ver precios» del inicio de sesión y «Mi plan» pueden llamar la atención. Opciones: ocultar los precios y el registro de empresas dentro de la app (usando `dentroDeLaApp()`), o defender el servicio como B2B bajo la regla 3.1.3(c) (servicios para empresas). Decisión de Miguel.

### Otros puntos que revisan las tiendas

- El revisor necesita entrar: cuenta de demostración (arriba). Sin ella, rechazo seguro.
- **Enlace a WhatsApp**: abre `wa.me` fuera de la app; está permitido.
- **Estabilidad**: si la web de producción está caída durante la revisión, la app muestra «Sin conexión» y pueden rechazar por «no funciona». Revisa que producción esté arriba esos días.
- **Google Play, política de usuarios**: la ficha y la privacidad deben coincidir con lo que hace la app.

## Fase 2: notificaciones push (no construida)

Qué hace falta, para decidir cuándo:

**Cuentas y credenciales**
- Android: un proyecto de **Firebase** (gratis) con la app `com.torrecondominios.app` y su `google-services.json` en `mobile/android/app/` (el `.gitignore` ya lo excluye). Cloud Messaging V1 usa una cuenta de servicio para enviar desde el servidor.
- iOS: la cuenta de Apple Developer (US$ 99) y una **llave APNs** (.p8) creada en el portal; se sube a Firebase para que FCM reparta a iOS. En Xcode se activan las capacidades Push Notifications y Background Modes (Remote notifications).

**En la app** (`mobile/`)
- Plugin `@capacitor/push-notifications` (y `npx cap sync`). Pedir permiso, registrar el dispositivo y obtener el token.
- Como la app carga la web remota, el código que pide permiso y manda el token vive en la **web** (`src/app/`), detrás de `dentroDeLaApp()` y de `window.Capacitor`. Hay que comprobar en la fase 2 cómo llega el plugin a una web remota: con `server.url`, Capacitor inyecta `window.Capacitor`, pero lo más seguro es empaquetar `@capacitor/core` y el plugin en el bundle de la web y llamarlos sólo cuando `dentroDeLaApp()` sea verdadero.

**En el servidor** (esto sí toca el backend, por eso se avisa)
- Tabla de **dispositivos** (usuario, plataforma, token, fecha) y endpoints para registrar y borrar el token al cerrar sesión (con su `scopeX` y la auditoría de siempre).
- Un servicio que envía por **FCM** cuando ocurren los eventos que hoy salen por WhatsApp o correo (recibo emitido, pago validado o rechazado, comunicado, recordatorio de vencimiento), reutilizando el planificador de avisos existente y respetando las preferencias de la persona.
- Credenciales de Firebase (cuenta de servicio) como variable de entorno del servidor nueva; no existe hoy.
- Actualizar la política de privacidad (token de dispositivo) y la declaración de datos de las tiendas.

Orden sugerido: Firebase y llave APNs, tabla y endpoints, envío de un evento (pago validado), web que registra el token, luego los demás eventos.

## Referencia rápida

```bash
cd mobile
npm run sync                      # copia la configuración y la pantalla offline a las apps (honra TORRE_URL)
npm run sync:prod                 # igual, pero ignora TORRE_URL: lo que va a tiendas
npm run verificar                 # falla si las apps traen una dirección de desarrollo
npm run apk:debug                 # APK de depuración
npm run apk:release               # AAB de tienda (sync:prod + verificar + bundleRelease)
npm run assets                    # íconos y splash
npm run version -- 1.1.0          # versión y build
npx cap open android              # Android Studio
npx cap open ios                  # Xcode
```

Depuración: con un build de desarrollo, Chrome en tu Mac > `chrome://inspect` muestra el WebView de la app. Logs nativos: `adb logcat -s Capacitor Capacitor/Console`.

Pantallas de la prueba en emulador (Android, 10-nov-2026): se guardaron en `.claude/app-movil/capturas/` del worktree de la rama `feat/app-movil` (no se commitean).
