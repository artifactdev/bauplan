FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng poppler-utils \
    && rm -rf /var/lib/apt/lists/*
COPY server.py /app/server.py
EXPOSE 8000
CMD ["python3", "/app/server.py"]
