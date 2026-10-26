"""Private OCR: raw PDF/image POST /ocr, optional X-OCR-Language and X-Api-Key."""
import glob
import hmac
import json
import os
import re
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX = 25 * 1024 * 1024
LANG = os.environ.get("OCR_LANG", "deu+eng")
API_KEY = os.environ.get("OCR_API_KEY", "")
LANGUAGES = {"de": "deu", "en": "eng", "de+en": "deu+eng"}
MIMES = {"application/pdf", "image/png", "image/jpeg", "image/tiff", "image/bmp"}
SLOTS = threading.BoundedSemaphore(2)


class OcrError(Exception):
    def __init__(self, code, status=422):
        super().__init__(code)
        self.code = code
        self.status = status


def run(cmd, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise OcrError("timeout", 504)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=remaining)
    except subprocess.TimeoutExpired:
        raise OcrError("timeout", 504) from None
    if result.returncode:
        raise OcrError("providerFailure", 422)
    return result.stdout


def tesseract(path, language, deadline):
    return run(["tesseract", path, "-", "-l", language, "--psm", "4"], deadline)


def ocr(data, mime, language=None):
    if mime not in MIMES:
        raise OcrError("unsupported", 415)
    if not data:
        raise OcrError("unreadable")
    if len(data) > MAX:
        raise OcrError("tooLarge", 413)
    deadline = time.monotonic() + 170
    with tempfile.TemporaryDirectory() as directory:
        if mime == "application/pdf":
            src = os.path.join(directory, "in.pdf")
            with open(src, "wb") as handle:
                handle.write(data)
            info = run(["pdfinfo", src], deadline)
            pages = re.search(r"^Pages:\s+(\d+)\s*$", info, re.MULTILINE)
            if not pages or int(pages.group(1)) < 1:
                raise OcrError("invalidPdf")
            if int(pages.group(1)) > 10:
                raise OcrError("tooManyPages", 413)
            if re.search(r"^Encrypted:\s+yes", info, re.MULTILINE):
                raise OcrError("invalidPdf")
            text = run(["pdftotext", "-layout", src, "-"], deadline)
            if len(text.strip()) > 40:
                return text
            run(["pdftoppm", "-r", "300", "-gray", "-png", src, os.path.join(directory, "p")], deadline)
            paths = sorted(glob.glob(os.path.join(directory, "p*.png")))
            if len(paths) != int(pages.group(1)):
                raise OcrError("partial")
            return "\n".join(tesseract(path, language or LANG, deadline) for path in paths)
        src = os.path.join(directory, "in.img")
        with open(src, "wb") as handle:
            handle.write(data)
        return tesseract(src, language or LANG, deadline)


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        if API_KEY and not hmac.compare_digest(
            self.headers.get("X-Api-Key", "").encode(), API_KEY.encode()
        ):
            self._send(401, {"error": "authentication"})
            return False
        return True

    def do_GET(self):
        if self.path in ("/", "/health"):
            return self._send(200, {"ok": True})
        if self.path == "/capabilities" and self._authorized():
            return self._send(200, {"protocol": 1, "languages": list(LANGUAGES)})
        if self.path != "/capabilities":
            self._send(404, {"error": "notFound"})

    def do_POST(self):
        if self.path != "/ocr":
            return self._send(404, {"error": "notFound"})
        if not self._authorized():
            return
        try:
            size = int(self.headers.get("content-length", "0"))
        except ValueError:
            return self._send(400, {"error": "unreadable"})
        if size <= 0 or size > MAX:
            return self._send(413, {"error": "tooLarge"})
        requested = self.headers.get("X-OCR-Language")
        if requested is not None and requested not in LANGUAGES:
            return self._send(400, {"error": "languageUnsupported"})
        if not SLOTS.acquire(blocking=False):
            return self._send(429, {"error": "busy"})
        try:
            self.connection.settimeout(15)
            data = self.rfile.read(size)
            if len(data) != size:
                raise OcrError("unreadable", 400)
            self.connection.settimeout(180)
            text = ocr(data, self.headers.get("content-type", "").split(";")[0], LANGUAGES.get(requested))
            self._send(200, {"text": text})
        except OcrError as error:
            self.log_error("OCR failed: %s", error.code)
            self._send(error.status, {"error": error.code})
        except TimeoutError:
            self.log_error("OCR failed: timeout")
            self._send(504, {"error": "timeout"})
        except (OSError, ValueError):
            self.log_error("OCR failed: providerFailure")
            self._send(500, {"error": "providerFailure"})
        finally:
            SLOTS.release()


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", 8000))), H).serve_forever()
