import subprocess
import http.client
import threading
import unittest
from unittest.mock import patch

import server


class OcrTests(unittest.TestCase):
    @patch("server.run")
    def test_page_limit_before_text_or_render(self, run):
        run.return_value = "Pages: 11\n"
        with self.assertRaises(server.OcrError) as error:
            server.ocr(b"%PDF", "application/pdf")
        self.assertEqual(error.exception.code, "tooManyPages")
        self.assertEqual(run.call_count, 1)

    @patch("server.run")
    def test_embedded_text_at_limit(self, run):
        run.side_effect = ["Pages: 10\n", "A sufficiently long embedded invoice text " * 3]
        self.assertIn("invoice", server.ocr(b"%PDF", "application/pdf"))
        self.assertEqual(run.call_count, 2)

    @patch("server.run")
    def test_encrypted_pdf(self, run):
        run.return_value = "Pages: 1\nEncrypted: yes (print:yes)\n"
        with self.assertRaises(server.OcrError) as error:
            server.ocr(b"%PDF", "application/pdf")
        self.assertEqual(error.exception.code, "invalidPdf")

    @patch("server.run", return_value="text")
    def test_request_language_and_default(self, run):
        server.ocr(b"image", "image/png", "eng")
        self.assertEqual(run.call_args.args[0][4], "eng")
        server.ocr(b"image", "image/png")
        self.assertEqual(run.call_args.args[0][4], server.LANG)

    @patch("server.subprocess.run")
    def test_subprocess_failure_is_not_empty_success(self, run):
        run.return_value = subprocess.CompletedProcess([], 1, "", "private stderr")
        with self.assertRaises(server.OcrError) as error:
            server.run(["tesseract"], server.time.monotonic() + 1)
        self.assertEqual(error.exception.code, "providerFailure")
        self.assertNotIn("private", str(error.exception))

    @patch("server.subprocess.run", side_effect=subprocess.TimeoutExpired("ocr", 1))
    def test_timeout(self, run):
        with self.assertRaises(server.OcrError) as error:
            server.run(["tesseract"], server.time.monotonic() + 1)
        self.assertEqual(error.exception.code, "timeout")

    def test_input_limits(self):
        for data, mime, code in [(b"", "image/png", "unreadable"), (b"x", "image/svg+xml", "unsupported")]:
            with self.assertRaises(server.OcrError) as error:
                server.ocr(data, mime)
            self.assertEqual(error.exception.code, code)


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.H)
        cls.thread = threading.Thread(target=cls.http.serve_forever)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.thread.join()
        cls.http.server_close()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection(*self.http.server_address, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, server.json.loads(response.read())
        finally:
            connection.close()

    @patch.object(server.H, "log_message")
    @patch.object(server, "API_KEY", "test-key")
    def test_capabilities_and_authentication(self, log):
        self.assertEqual(self.request("GET", "/health"), (200, {"ok": True}))
        self.assertEqual(self.request("GET", "/capabilities")[0], 401)
        status, data = self.request("GET", "/capabilities", headers={"X-Api-Key": "test-key"})
        self.assertEqual(status, 200)
        self.assertEqual(data, {"protocol": 1, "languages": ["de", "en", "de+en"]})
        self.assertEqual(self.request("POST", "/ocr", b"image")[0], 401)

    @patch.object(server.H, "log_message")
    @patch.object(server, "API_KEY", "")
    @patch.object(server, "ocr", return_value="recognized")
    def test_raw_body_language_and_optional_auth(self, ocr, log):
        status, data = self.request("POST", "/ocr", b"image", {
            "Content-Type": "image/png", "X-OCR-Language": "en",
        })
        self.assertEqual((status, data), (200, {"text": "recognized"}))
        ocr.assert_called_once_with(b"image", "image/png", "eng")
        self.assertEqual(self.request("POST", "/ocr", b"x", {"X-OCR-Language": "invalid"})[0], 400)
        self.assertEqual(self.request("POST", "/ocr", headers={"Content-Length": str(server.MAX + 1)})[0], 413)
        self.assertEqual(self.request("POST", "/ocr", headers={"Content-Length": "invalid"})[0], 400)

    @patch.object(server.H, "log_message")
    @patch.object(server, "API_KEY", "")
    @patch.object(server, "ocr", side_effect=server.OcrError("tooManyPages", 413))
    def test_processing_errors_are_structured(self, ocr, log):
        self.assertEqual(self.request("POST", "/ocr", b"%PDF", {"Content-Type": "application/pdf"}), (413, {"error": "tooManyPages"}))


if __name__ == "__main__":
    unittest.main()
