# La demo de Torre para clientes

Una instancia **separada** de la misma app, con datos de mentira, para enviar a los clientes: entran con un enlace, eligen un rol y prueban Torre sin registrarse. Acceso público con enlace, en `demo.torrecondominios.com`, con reinicio cada noche.

Qué la forma (las 4 piezas del pedido de Miguel):

1. **El entorno** de demostración: la misma app con otra base (`house_demo`) y el *modo demo* encendido en esa base. El **candado** hace que nada salga de la instancia.
2. **Los datos**: `prisma/seed-demo.ts` (`npm run seed:demo`), 6 meses de historia facturada por la API real, relativa a HOY.
3. **Entrar por rol**, sin contraseña: la portada `/demo` de la instancia y `POST /api/demo/entrar`.
4. **La guía** dentro de la app: franja fija arriba y panel «Qué probar» por rol.

Y el **video** «Conoce Torre en la demo» (guion en `docs/marketing/guiones-videos.md`, §11): se graba DESPUÉS, sobre la demo ya armada.

## 1. Levantar la demo en local

Requisitos: el contenedor `house-pg` (Postgres, puerto 5433) y una base cuyo nombre **termine en `_demo`**.

```bash
# una sola vez
docker exec house-pg psql -U postgres -c "CREATE DATABASE house_demo"
export DATABASE_URL=postgresql://postgres:house@localhost:5433/house_demo
npx prisma db push                 # el esquema (incluye la tabla ConfiguracionDemo)

# sembrar (≈ 25 s; borra y recrea todo en esa base y enciende el modo demo)
npm run seed:demo                  # con --superadmin=tu@correo crea además al superadmin de la instancia

# levantar
PORT=4000 npm run backend          # el backend, con la MISMA DATABASE_URL
npm run dev                        # Vite en :5173 (proxy /api → 4000)
```

Abre `http://localhost:5173/demo` (en la instancia de demo, la raíz `/` también muestra esa portada). Elige un rol: se abre la sesión sin contraseña.

- **Nunca** corras el seed contra otra base: aborta si el nombre no termina en `_demo`. Tampoco hace `db push` por ti.
- No hace falta ninguna clave: sin `RESEND_API_KEY`, `EVOLUTION_*` ni `GEMINI_API_KEY`. Aunque estuvieran, con el modo demo encendido no se usarían.
- Las contraseñas de las cuentas de demo son aleatorias y nadie las conoce: a la demo se entra **sólo por rol**. El superadmin de la instancia (`--superadmin=`) guarda su contraseña en `CREDENCIALES_JSON` (por defecto `house-demo-credenciales.json` en el directorio temporal; permisos 0600; nunca se imprime).
- Las pruebas usan su propia base: `TEST_DATABASE_URL=postgresql://postgres:house@localhost:5433/house_test_demo npm test`.

## 2. Reiniciar la demo

- **Cada noche a las 3:00 (hora de Lima)**, solo: el servidor revisa cada minuto si ya pasaron las 3:00 y la última siembra fue anterior; entonces vuelve a sembrar. Si el servidor estuvo caído, se pone al día al volver. Mientras siembra (≈ 30–60 s) `/api/demo/entrar` responde 503 «La demo se está preparando». Todas las sesiones se cierran.
- **A mano**: `npm run seed:demo` (con la `DATABASE_URL` de la instancia) o, con sesión de **superadmin de la instancia**, `POST /api/demo/reiniciar` (responde 202 y sigue en segundo plano; `GET /api/demo/estado` dice `reiniciando`). Los superadmins que ya existen en la base se conservan en cada reinicio.
- El seed es **determinista**: dos corridas el mismo día dan las mismas cuentas, los mismos montos y la misma mezcla de pagos. Es relativo a HOY: el recibo «del mes» es el del mes en curso (vence en 5 días), y hay meses anteriores vencidos.

## 3. Cómo se despliega (lo hace Opus, con el OK de Miguel)

No se despliega desde esta rama sin ese OK.

1. **Base**: crear `house_demo` en el Postgres de Coolify (el nombre debe terminar en `_demo`).
2. **App nueva en Coolify** (otra app, MISMO repositorio y Dockerfile). Variables:
   - `DATABASE_URL` → la base `house_demo` (la ÚNICA que cambia por instancia; no se agrega ninguna variable nueva al código).
   - `JWT_SECRET` propio (≥ 32 caracteres; obligatorio con `NODE_ENV=production`, que ya fija el Dockerfile).
   - **Sin** `RESEND_API_KEY`, `MAIL_FROM`, `EVOLUTION_URL`, `EVOLUTION_APIKEY`, `GEMINI_API_KEY`, `LLAVERO_ENC_KEY` de producción. (El candado no depende de esto: es defensa en profundidad.)
3. **Dominio**: `demo.torrecondominios.com` → DNS al mismo servidor que producción; certificado desde Coolify.
4. **Primer arranque**: el contenedor hace `prisma db push` solo (crea las tablas, incluida `ConfiguracionDemo`). Después, UNA vez, dentro del contenedor (o desde la Mac con la `DATABASE_URL` remota): `npm run seed:demo -- --superadmin=<correo>`. Eso enciende el modo demo en esa base y la deja sembrada. Desde entonces el reinicio nocturno corre solo.
5. **Producción NO cambia**: la tabla `ConfiguracionDemo` queda vacía (= «apagado») y el candado no hace nada. Si por algún motivo la tabla no existe, el servidor lee «apagado».
6. **SEO**: la demo no debe indexarse; si Coolify no lo hace, añadir `X-Robots-Tag: noindex` en el proxy de esa app.
7. **Qué revisar después de desplegar**: ver §6.

## 4. Qué está simulado (y qué no)

Con el modo demo encendido (`ConfiguracionDemo.activo = true`, sólo en la base de la instancia de demo):

| Cosa | Qué pasa en la demo |
|---|---|
| **Correos** (avisos, invitaciones, recordatorios) | No sale ninguno. La notificación queda `omitida` con el motivo «Simulado en la demo: no se envía nada real». |
| **WhatsApp** (avisos, respuestas del bot) | No sale ninguno (mismo motivo, sin pausa anti-baneo). |
| **Pantalla de WhatsApp** | Muestra un número de ejemplo (51 900 000 001) ya «conectado» y los grupos de ejemplo que sembró el seed. «Traer mis grupos» devuelve esos mismos; los mensajes a grupos «salen» sin llamar a ninguna red. No se puede desvincular. |
| **Lectura de vouchers (IA / OCR)** | No se llama a ninguna IA de pago ni al OCR. Cada voucher recibe una lectura de ejemplo, armada con los datos del propio pago; **1 de cada 6** trae un monto distinto, para que se vea también la alerta «no coincide». Pasa por el mismo contraste que una lectura real. |
| **Chat de IA (asistente)** | Cerrado (responde «No está disponible en la demo»). Telegram: sin bot. |
| **Cuentas de demo** | No se pueden cambiar contraseñas, correos ni celulares (propios ni ajenos). |
| **Tokens de API (MCP), llavero, empresas nuevas, registro público, contacto, libro de reclamaciones, «Entrar como»** | Cerrados con 403 `{code: 'DEMO'}`. |
| **Subidas de archivos** | Los vouchers se aceptan hasta 2 MB (el tope normal) y se borran en el reinicio. |
| **Tipo de cambio** | Sigue leyendo la fuente pública (no envía datos de nadie). |

Lo que SÍ es real: la app, la API, las reglas de cobranza, la mora, la validación, los cierres, los permisos y el aislamiento entre roles. Lo que el visitante hace (emitir recibos, validar pagos, crear comunicados…) queda guardado hasta el reinicio de las 3:00.

## 5. Las cuentas y los datos

Una administradora, **Administradora Demo SAC**, con 2 condominios y marca propia (nombre comercial «Administradora Demo» y un color propio; la marca es por empresa, así que se ve en los dos):

| Condominio | Estructura | Juntas | Departamentos |
|---|---|---|---|
| Residencial Las Palmeras | 6 blocks de 20 | una por block y la Junta central | 120 |
| Edificio Mirador del Parque | 1 torre de 40 | junta única | 40 |

6 meses de recibos por block (el último, el mes en curso). Mezcla de pagos: al día, morosos de 1 a 4 meses, **por validar** con voucher de ejemplo (cada block tiene al menos uno), **rechazados** con su motivo, y algunos pagados tarde. Además: comunicados, reservas del salón, 5 proveedores, tareas de mantenimiento, lecturas de agua del edificio y 9 grupos de WhatsApp de ejemplo. Todo inventado: nombres generados, correos `.example`, celulares `900 xxx xxx`.

Las 8 cuentas de entrada (`POST /api/demo/entrar { rol }`):

| Rol | Cuenta | Qué ve |
|---|---|---|
| `administradora` | Lucía Paredes Rojas | Los 2 condominios: morosidad, pagos por validar con su voucher, recibos por block, cierres. |
| `tesorero_block` | Marco Vásquez Salazar (Block 1) | Su junta: vouchers de sus vecinos por confirmar, el cierre del block. |
| `presidente_central` | Carmen Cárdenas Ibáñez | La Junta central de Las Palmeras: aportes de los blocks y su cierre. |
| `propietario_al_dia` | Raúl Quispe Torres (B01-102) | Al día; el recibo del mes por pagar (aún no vence). |
| `propietario_moroso` | Gladys Huamán Flores (B01-101) | 3 meses vencidos más el del mes, con su recargo. |
| `inquilino` | Diego Ramos Pacheco (B01-103) | Paga el recibo del mes del departamento. |
| `seguridad` | Pedro Ccori Mamani | Las unidades del condominio. |
| `mantenimiento` | María Valdivia Tello | Sus tareas. |

## 6. Verificación después de desplegar

1. `GET https://demo.torrecondominios.com/api/demo/estado` → `{"demo":true,…}`. En producción (`torrecondominios.com`) la misma ruta debe dar **404**.
2. Abrir `/demo`, entrar con cada rol y ver su pantalla de inicio. La franja de arriba dice «Estás en la demo de Torre…».
3. Como administradora: abrir un pago por validar → la lectura de IA aparece; validarlo. «Avisar a los vecinos» no envía nada (queda «Simulado»).
4. Intentar cambiar la contraseña desde Mi perfil: debe decir que no está disponible en la demo.
5. Esperar (o forzar con `POST /api/demo/reiniciar` como superadmin) un reinicio y comprobar que los datos vuelven al inicio.

## 7. Mensaje para enviar a los clientes

Reemplaza `[Nombre]` y `[ENLACE DEL VIDEO]`. El enlace de la demo no necesita registro. La versión para el cliente (documento con el estándar de My Workspace) la genera Opus a partir de este texto.

### WhatsApp

> Hola [Nombre], te comparto la demo de Torre: cómo se cobra y se administra un condominio sin Excel ni vouchers perdidos en WhatsApp.
>
> Video (2 minutos y medio): [ENLACE DEL VIDEO]
>
> Pruébala tú, sin registrarte: https://demo.torrecondominios.com
> Eliges un rol y entras. Son datos de ejemplo: nada de lo que hagas afecta a nadie, no se envía ningún mensaje real y todo se reinicia cada noche.
>
> Si eres administradora, prueba tres cosas: 1) mira la morosidad, 2) valida un pago con su voucher, 3) emite el recibo de un block.
> Si eres de una junta: 1) entra como Tesorero de un block, 2) da la conformidad a un pago, 3) mira el cierre del mes.
>
> Cuando quieras usarla con tu condominio, empiezas gratis por 3 meses. Cualquier duda, escríbeme por aquí.

### Correo

**Asunto:** La demo de Torre, para que la pruebes tú

> Hola [Nombre]:
>
> Te envío la demo de Torre, el sistema para administrar condominios: recibos por block, pagos con voucher validados con inteligencia artificial, morosidad, cierres con la junta y avisos a los vecinos por grupos de WhatsApp.
>
> 1. **Mira el video** (2 minutos y medio): [ENLACE DEL VIDEO]
> 2. **Pruébala tú**, sin registrarte y sin contraseña: https://demo.torrecondominios.com. Eliges un rol (administradora, tesorero de un block, presidente de la junta central, vecino al día o moroso, inquilino, seguridad o mantenimiento) y entras. Dentro hay un panel «Qué probar» con pasos cortos para cada rol.
>
> Para empezar, si administras condominios:
> - Mira la **morosidad**: quién debe, cuánto y desde cuándo.
> - **Valida un pago** con su voucher: Torre ya leyó el comprobante y te dice si calza con el recibo.
> - **Emite el recibo** de un block y avisa a los vecinos.
>
> Y si formas parte de una junta, entra como **Tesorero de un block**: confirma que el dinero llegó a la cuenta y revisa el cierre del mes.
>
> Los datos son de ejemplo y se reinician cada noche. No se envía ningún correo ni mensaje real, así que puedes probar con libertad. Cuando quieras usar Torre con tu condominio, empiezas **gratis por 3 meses**.
>
> Quedo atento a tus comentarios.
>
> [Tu nombre]

## 8. Gotchas

- **Esquema**: `ConfiguracionDemo` es una tabla propia (no una columna de `ConfiguracionComercial`) a propósito: producción, que no la usa, sigue funcionando aunque aún no tenga la tabla. El contenedor la crea solo con `prisma db push` al arrancar.
- **Zona horaria**: «hoy» y las 3:00 son de Lima (UTC−5, sin horario de verano). Las 3:00 de Lima son las 8:00 UTC.
- **IP**: `POST /api/demo/entrar` se limita a 60 entradas por IP cada 15 minutos (un equipo comercial detrás de una misma red no se estorba). La app confía en el primer proxy (`trust proxy 1`), como en producción.
- **Concurrencia**: dos reinicios a la vez no se pisan (candado en `ConfiguracionDemo.reiniciando_desde`; uno de más de 15 minutos se da por caído).
- **Un reinicio mientras alguien trabaja** le cierra la sesión (la tabla de sesiones se vacía): vuelve a `/demo`.
- **Datos reales**: la auditoría de coherencia del seed comprueba que no haya correos que no sean `.example`, ni celulares que no empiecen por `900`, ni lecturas de IA que no sean de ejemplo. Si un día falla, el seed termina con código 1.
