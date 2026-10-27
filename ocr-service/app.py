"""
OCR microservice — Flask + Tesseract (pytesseract)
Accepts a PDF or an image (JPG/PNG/WebP) via multipart/form-data (field name: "file").
A PDF is converted page by page to images with pdf2image; an image goes straight to Tesseract.
Returns the concatenated text + positional word blocks as JSON.
(Copiado del OCR del portal de dealers; House sólo le agrega imágenes: capturas de vouchers.)

GET /
  Página web de estado del servicio (HTML).

POST /api/extract
  Request  : multipart/form-data { file: <PDF or image bytes> }
  Response : { "text": "...", "pages": 1, "blocks": [ {page,text,confidence,bbox,centerX,centerY} ] }  HTTP 200
           | { "error": "..." }                                                                       HTTP 4xx/5xx

GET /health
  Response : { "status": "ok", "ready": true, "engine": "tesseract", "languages": [...], "version": "..." }

Contrato de `blocks` idéntico al servicio EasyOCR anterior, para que el backend .NET
(ReceiptExtractionService → FlaskOcrResponse/FlaskOcrBlock) siga extrayendo el monto
con la lógica posicional por tokens sin cambios.
"""

import hmac
import io
import logging
import os
import sys

import pytesseract
from PIL import Image, ImageOps
from flask import Flask, Response, jsonify, request
from pdf2image import convert_from_bytes
from pdf2image.exceptions import PDFInfoNotInstalledError, PDFPageCountError

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
DPI = int(os.environ.get("OCR_DPI", "300"))
MAX_PAGES = int(os.environ.get("OCR_MAX_PAGES", "10"))
# Tesseract usa el formato "spa+eng"; aceptamos también "es,en" (compat EasyOCR).
_RAW_LANGS = os.environ.get("OCR_LANGUAGES", "spa+eng")
_LANG_ALIASES = {"es": "spa", "en": "eng", "spa": "spa", "eng": "eng"}
OCR_LANGUAGES = "+".join(
    _LANG_ALIASES.get(part.strip().lower(), part.strip())
    for part in _RAW_LANGS.replace("+", ",").split(",")
    if part.strip()
) or "spa+eng"
# --oem 1 (LSTM), --psm 3 (auto page segmentation) por defecto.
TESS_CONFIG = os.environ.get("TESS_CONFIG", "--oem 1 --psm 3")
MAX_IMAGE_SIDE = int(os.environ.get("OCR_MAX_IMAGE_SIDE", "3000"))
MIN_CONF = float(os.environ.get("OCR_MIN_CONF", "0"))
# API key compartida. Si está definida, TODO endpoint (salvo /health) exige el header
# X-API-Key con este valor. Vacía = servicio abierto (solo recomendable en dev local).
API_KEY = os.environ.get("OCR_API_KEY", "").strip()

logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("ocr-service")

try:
    TESS_VERSION = str(pytesseract.get_tesseract_version())
except Exception as exc:  # noqa: BLE001
    TESS_VERSION = "unknown"
    logger.warning("Could not read tesseract version: %s", exc)

logger.info("Tesseract OCR ready (languages: %s, version: %s)", OCR_LANGUAGES, TESS_VERSION)
if API_KEY:
    logger.info("API key auth ENABLED: /api/* requiere header X-API-Key.")
else:
    logger.warning("API key auth DESHABILITADA (OCR_API_KEY vacío): el servicio queda abierto.")

app = Flask(__name__)


# ---------------------------------------------------------------------------
# Auth (API key por header)
# ---------------------------------------------------------------------------
@app.before_request
def require_api_key():
    """Exige X-API-Key en todo endpoint salvo /health (para healthchecks).
    Si OCR_API_KEY no está configurada, no exige nada (compat dev local)."""
    if not API_KEY:
        return None
    if request.path == "/health":
        return None
    provided = request.headers.get("X-API-Key", "")
    # Comparación en tiempo constante para no filtrar la key por timing.
    if not provided or not hmac.compare_digest(provided, API_KEY):
        return jsonify({"error": "Unauthorized"}), 401
    return None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def index():
    """Página web simple de estado del servicio."""
    html = f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>House · OCR Service</title>
  <style>
    :root {{ color-scheme: light dark; }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: #0f172a; color: #e2e8f0; padding: 24px;
    }}
    .card {{
      width: 100%; max-width: 540px; background: #1e293b;
      border: 1px solid #334155; border-radius: 16px; padding: 32px;
      box-shadow: 0 10px 40px rgba(0,0,0,.35);
    }}
    h1 {{ margin: 0 0 4px; font-size: 1.4rem; }}
    .sub {{ color: #94a3b8; font-size: .9rem; margin-bottom: 20px; }}
    .status {{
      display: inline-flex; align-items: center; gap: 8px; font-weight: 600;
      padding: 6px 14px; border-radius: 999px; background: #052e16; color: #4ade80;
      border: 1px solid #166534; margin-bottom: 24px;
    }}
    .dot {{ width: 9px; height: 9px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 4px rgba(34,197,94,.25); }}
    dl {{ display: grid; grid-template-columns: auto 1fr; gap: 10px 16px; margin: 0 0 24px; font-size: .92rem; }}
    dt {{ color: #94a3b8; }}
    dd {{ margin: 0; font-family: ui-monospace, "SF Mono", Menlo, monospace; }}
    .ep {{ border-top: 1px solid #334155; padding-top: 16px; font-size: .88rem; }}
    .ep code {{ background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 2px 8px; }}
    .m {{ color: #38bdf8; font-weight: 600; }}
    a {{ color: #38bdf8; }}
    footer {{ margin-top: 20px; color: #64748b; font-size: .8rem; }}
  </style>
</head>
<body>
  <main class="card">
    <h1>OCR Service</h1>
    <div class="sub">House · Administración de condominios</div>
    <div class="status"><span class="dot"></span> Operativo</div>
    <dl>
      <dt>Motor</dt><dd>Tesseract + pdf2image (PDF e imágenes)</dd>
      <dt>Versión</dt><dd>{TESS_VERSION}</dd>
      <dt>Idiomas</dt><dd>{OCR_LANGUAGES}</dd>
      <dt>DPI</dt><dd>{DPI}</dd>
      <dt>Máx. páginas</dt><dd>{MAX_PAGES}</dd>
    </dl>
    <div class="ep">
      <p><span class="m">GET</span> <code>/health</code> — estado en JSON</p>
      <p><span class="m">POST</span> <code>/api/extract</code> — <code>multipart/form-data {{ file: PDF o imagen }}</code> → texto + bloques</p>
    </div>
    <footer>Servicio interno de lectura de texto de comprobantes de pago.</footer>
  </main>
</body>
</html>"""
    return Response(html, mimetype="text/html")


@app.get("/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "ready": True,
            "engine": "tesseract",
            "version": TESS_VERSION,
            "languages": OCR_LANGUAGES.split("+"),
            "authRequired": bool(API_KEY),
        }
    )


@app.post("/api/extract")
def extract():
    if "file" not in request.files:
        return jsonify({"error": "No 'file' field in multipart/form-data."}), 400

    pdf_bytes = request.files["file"].read()
    if not pdf_bytes:
        return jsonify({"error": "Uploaded file is empty."}), 400
    # PDF por su firma (no por el nombre ni el Content-Type que declare quien sube); lo demás se trata como imagen.
    is_pdf = pdf_bytes.lstrip()[:5] == b"%PDF-"

    # Rango de páginas opcional (1-indexed). Permite OCR-ear páginas específicas de
    # documentos largos (p. ej. el ANEXO ÚNICO de una garantía) sin procesar todo el PDF.
    # Sin rango: comportamiento previo (primeras MAX_PAGES).
    def _to_int(val):
        try:
            return int(val)
        except (TypeError, ValueError):
            return None

    first_page = _to_int(request.form.get("first_page"))
    last_page = _to_int(request.form.get("last_page"))

    # ---- PDF → images (o la imagen tal cual) ----
    if not is_pdf:
        try:
            images = [load_image(pdf_bytes)]
            page_offset = 0
        except Exception as exc:  # noqa: BLE001
            logger.warning("Image decode failed: %s", exc)
            return jsonify({"error": "Unsupported or corrupt image (use PDF, JPG, PNG or WebP)."}), 422
    else:
        try:
            if first_page:
                fp = max(1, first_page)
                # La ventana nunca excede MAX_PAGES para acotar el costo por request.
                lp = last_page if last_page and last_page >= fp else fp
                lp = min(lp, fp + MAX_PAGES - 1)
                images = convert_from_bytes(pdf_bytes, dpi=DPI, fmt="png", first_page=fp, last_page=lp)
                page_offset = fp - 1
            else:
                images = convert_from_bytes(pdf_bytes, dpi=DPI, fmt="png")
                page_offset = 0
        except (PDFInfoNotInstalledError, PDFPageCountError) as exc:
            logger.error("pdf2image error: %s", exc)
            return jsonify({"error": f"PDF conversion failed: {exc}"}), 422
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected pdf2image error")
            return jsonify({"error": f"PDF conversion failed: {exc}"}), 422

    if not images:
        return jsonify({"error": "PDF produced no images."}), 422

    pages_to_process = images[:MAX_PAGES]
    all_text: list[str] = []
    all_blocks: list[dict] = []

    # ---- Tesseract per page ----
    for idx, image in enumerate(pages_to_process):
        try:
            prepared = prepare_image_for_ocr(image)
            data = pytesseract.image_to_data(
                prepared,
                lang=OCR_LANGUAGES,
                config=TESS_CONFIG,
                output_type=pytesseract.Output.DICT,
            )

            page_blocks = build_word_blocks(data, page=page_offset + idx + 1)
            # Texto reconstruido por líneas (usa _line) antes de descartar el metadato interno.
            page_text = blocks_to_text(page_blocks)
            for b in page_blocks:
                b.pop("_line", None)
            # Orden de lectura: arriba→abajo, izquierda→derecha (igual que EasyOCR).
            page_blocks.sort(key=lambda b: (b["bbox"]["top"], b["bbox"]["left"]))
            all_blocks.extend(page_blocks)
            all_text.append(page_text)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Tesseract failed on page %d: %s", idx + 1, exc)

    text = "\n".join(t for t in all_text if t).strip()
    logger.info("Extracted %d chars from %d page(s)", len(text), len(pages_to_process))
    return jsonify({"text": text, "pages": len(pages_to_process), "blocks": all_blocks})


def load_image(data: bytes) -> Image.Image:
    """Abre una imagen (JPG/PNG/WebP), respeta la orientación EXIF del celular y la pasa a RGB."""
    img = Image.open(io.BytesIO(data))
    img.load()
    return ImageOps.exif_transpose(img).convert("RGB")


def build_word_blocks(data: dict, page: int) -> list[dict]:
    """Convierte la salida DICT de image_to_data en bloques palabra-por-palabra
    con el mismo esquema que producía EasyOCR (page/text/confidence/bbox/centerX/centerY)."""
    blocks: list[dict] = []
    n = len(data.get("text", []))
    for i in range(n):
        raw_text = (data["text"][i] or "").strip()
        if not raw_text:
            continue
        try:
            conf = float(data["conf"][i])
        except (TypeError, ValueError):
            conf = -1.0
        if conf < MIN_CONF:
            continue

        left = float(data["left"][i])
        top = float(data["top"][i])
        width = float(data["width"][i])
        height = float(data["height"][i])

        blocks.append(
            {
                "page": page,
                "text": raw_text,
                # EasyOCR daba confianza 0–1; Tesseract da 0–100 → normalizamos.
                "confidence": round(conf / 100.0, 4),
                "bbox": {
                    "left": round(left, 2),
                    "top": round(top, 2),
                    "width": round(width, 2),
                    "height": round(height, 2),
                },
                "centerX": round(left + width / 2, 2),
                "centerY": round(top + height / 2, 2),
                # Metadatos de agrupación de líneas (no usados por el backend, útiles para depurar).
                "_line": (
                    int(data.get("block_num", [0] * n)[i]),
                    int(data.get("par_num", [0] * n)[i]),
                    int(data.get("line_num", [0] * n)[i]),
                ),
            }
        )
    return blocks


def blocks_to_text(blocks: list[dict]) -> str:
    """Reconstruye el texto agrupando palabras por línea (block/par/line) y ordenando
    las líneas por su posición vertical, las palabras por su posición horizontal."""
    lines: dict[tuple, list[dict]] = {}
    for b in blocks:
        lines.setdefault(b.get("_line", (0, 0, 0)), []).append(b)

    rendered = []
    for key in lines:
        words = sorted(lines[key], key=lambda w: w["bbox"]["left"])
        top = min(w["bbox"]["top"] for w in words)
        rendered.append((top, " ".join(w["text"] for w in words)))

    rendered.sort(key=lambda item: item[0])
    return "\n".join(line for _, line in rendered)


def prepare_image_for_ocr(image: Image.Image) -> Image.Image:
    """Escala de grises y tope de lado máximo para acotar memoria/tiempo."""
    grayscale = image.convert("L")
    width, height = grayscale.size
    if max(width, height) > MAX_IMAGE_SIDE:
        scale = MAX_IMAGE_SIDE / max(width, height)
        grayscale = grayscale.resize(
            (max(1, int(width * scale)), max(1, int(height * scale))),
            Image.Resampling.LANCZOS,
        )
    return grayscale


# ---------------------------------------------------------------------------
# Entry point (dev server — production uses gunicorn via CMD in Dockerfile)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050, debug=False)
