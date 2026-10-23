# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Los cinco roles pesan igual y deben sentirse como un solo producto: superadmin (plataforma), admin (administradora de condominios), propietario, inquilino y personal (mantenimiento, seguridad). Administradores trabajan en escritorio emitiendo recibos, cobrando y gestionando unidades; propietarios e inquilinos consultan recibos y pagan, a menudo desde el celular.

## Product Purpose
House es un SaaS multi-tenant para administrar condominios y edificios: empresas, complejos, pisos, unidades, usuarios, recibos por conceptos, pagos, mantenimientos y reportes, con un asistente de IA (Gemini). Es un producto real que se ofrecerá a administradoras en Perú. Éxito: cobrar y conciliar sin errores, y que el residente entienda qué debe y pague sin llamar a nadie.

## Positioning
Gestión integral de condominios en un solo lugar, en español peruano, con soles (S/) y datos de empresa por RUC, y asistente de IA integrado.

## Operating Context
Datos de Perú: moneda S/, RUC, direcciones de Lima. Despliegue en VPS propio con Coolify (un contenedor: API Express + SPA React/Vite/Tailwind, Prisma + PostgreSQL). Datos de prueba sembrados con `prisma db seed`.

## Capabilities and Constraints
Roles: superadmin, admin, propietario, inquilino, mantenimiento, seguridad. Modelos: Empresa, Complejo, Piso, Unidad, Usuario, Concepto, Recibo, ReciboConcepto(Unidad), Pago, TareaMantenimiento. Debe mantenerse español peruano, S/ y modo oscuro/claro funcional. Nombre, logo y paleta no están fijados.

## Brand Commitments
Ninguna binding sobre nombre, color o estilo. Obligatorios: español de Perú, montos en S/, modo claro y oscuro.

## Evidence on Hand
No hay testimonios ni clientes reales documentados; no inventar. Hay datos de prueba en prisma/seed.ts.

## Product Principles
- Un solo producto para los cinco roles: mismos componentes y patrones.
- El dinero es lo central: montos, estados de pago y vencimientos se leen de un vistazo.
- Móvil primero para residentes, densidad cómoda en escritorio para administradores.
- Nada decorativo que no ayude a una tarea.
