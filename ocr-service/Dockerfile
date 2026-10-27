# syntax=docker/dockerfile:1
FROM python:3.11-slim

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Tesseract + idiomas (spa/eng) + poppler-utils (pdf2image: pdfinfo / pdftoppm)
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr \
      tesseract-ocr-spa \
      tesseract-ocr-eng \
      poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencias primero (capa cacheable mientras no cambie requirements.txt).
COPY requirements.txt .
RUN pip install --upgrade pip setuptools wheel \
    && pip install --retries 10 --timeout 120 -r requirements.txt

# Código de la app.
COPY app.py .

# Usuario sin privilegios (no hay volúmenes persistentes; escribe temporales en /tmp).
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 5050
# Nº de workers vía WEB_CONCURRENCY (gunicorn lo respeta si no se pasa --workers). Default 2:
# el host de prod es de 6 CPUs y comparte RAM con muchos servicios (poca RAM libre / swap). Más
# workers residentes consumían RAM de más y con OCR paralelo entraba en swap. 2 alcanza para la
# concurrencia del front (2). Overridable por env en Coolify. timeout=300 alineado con el ceiling
# del HttpClient del backend (ReceiptExtraction:FlaskOcr:TimeoutSeconds, default 300s).
ENV WEB_CONCURRENCY=2
CMD ["gunicorn", "--bind", "0.0.0.0:5050", "--timeout", "300", "--graceful-timeout", "30", "app:app"]
