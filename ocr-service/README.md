# ocr-service

Microservicio de OCR (Flask + Tesseract `spa+eng`) que House usa como **última red** al evaluar un comprobante de pago cuando la IA de visión no responde
(`src/server/services/ocrVoucher.ts`). Copia del OCR del portal de dealers de GlobalGo (mismo Dockerfile y contrato); House sólo le agregó **imágenes**.
Es una instancia propia de House: no se llama al servicio de otro proyecto.

- `POST /api/extract` — `multipart/form-data` con el campo `file` (**PDF, JPG, PNG o WebP**; el PDF se reconoce por su firma, no por el nombre). Cabecera `X-API-Key` si `OCR_API_KEY` está definida. Responde `{ text, pages, blocks }`.
- `GET /health` — estado (sin clave).
- Variables: `OCR_API_KEY` (compartida con House), `OCR_LANGUAGES` (`spa+eng`), `OCR_DPI`, `OCR_MAX_PAGES`, `WEB_CONCURRENCY` (2).
- House: `OCR_BASE_URL=https://<este-servicio>` y la misma `OCR_API_KEY`. Sin `OCR_BASE_URL`, House no usa OCR.
- Despliegue (Coolify): imagen de este `Dockerfile`, puerto 5050. Lo hace la sesión principal con el OK de Miguel.

Prueba local sin Docker (fuera del repo): `python3 -m venv /tmp/venv && /tmp/venv/bin/pip install -r requirements.txt && OCR_LANGUAGES=eng /tmp/venv/bin/python -c "import app"` (necesita `tesseract` y `pdftoppm` instalados).
