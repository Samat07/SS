import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import threading
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
DATA = Path(os.environ.get("HERD_DATA_DIR", ROOT / "data")).resolve()
ACCOUNTS_FILE = DATA / "accounts.json"
RECORDS_DIR = DATA / "records"
UPLOADS_DIR = DATA / "uploads"
MAX_BODY = 100 * 1024 * 1024
LOCK = threading.RLock()


def read_json(path, fallback):
    try:
        with path.open("r", encoding="utf-8") as stream:
            return json.load(stream)
    except FileNotFoundError:
        return fallback


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def token_secret():
    path = DATA / ".session-secret"
    DATA.mkdir(parents=True, exist_ok=True)
    try:
        return path.read_bytes()
    except FileNotFoundError:
        secret = secrets.token_bytes(48)
        try:
            with path.open("xb") as stream:
                stream.write(secret)
        except FileExistsError:
            return path.read_bytes()
        return secret


def make_token(username):
    payload = base64.urlsafe_b64encode(
        json.dumps({"u": username, "e": int(time.time()) + 365 * 24 * 3600},
                   separators=(",", ":")).encode()
    ).decode().rstrip("=")
    signature = hmac.new(token_secret(), payload.encode(), hashlib.sha256).digest()
    return payload + "." + base64.urlsafe_b64encode(signature).decode().rstrip("=")


def decode_token(token):
    try:
        payload, signature = token.split(".", 1)
        supplied = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
        expected = hmac.new(token_secret(), payload.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(supplied, expected):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if data["e"] < time.time() or not isinstance(data["u"], str):
            return None
        return data["u"]
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None


def record_path(username):
    key = hashlib.sha256(username.encode("utf-8")).hexdigest()
    return RECORDS_DIR / (key + ".json")


def clean_media_data(value):
    if isinstance(value, dict):
        return {key: clean_media_data(item) for key, item in value.items() if key != "data"}
    if isinstance(value, list):
        return [clean_media_data(item) for item in value]
    return value


def merge_items(old_items, new_items):
    merged = {item["id"]: item for item in old_items if isinstance(item, dict) and item.get("id")}
    for item in new_items:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        previous = merged.get(item["id"])
        if previous is None or str(item.get("updatedAt", "")) >= str(previous.get("updatedAt", "")):
            merged[item["id"]] = item
    return list(merged.values())


def merge_state(current, incoming):
    current_settings_at = str(current.get("settingsUpdatedAt", ""))
    incoming_settings_at = str(incoming.get("settingsUpdatedAt", ""))
    settings_source = incoming if incoming_settings_at >= current_settings_at else current
    return {
        "people": merge_items(current.get("people", []), incoming.get("people", [])),
        "events": merge_items(current.get("events", []), incoming.get("events", [])),
        "movements": merge_items(current.get("movements", []), incoming.get("movements", [])),
        "rateHistory": merge_items(current.get("rateHistory", []), incoming.get("rateHistory", [])),
        "settings": settings_source.get("settings", {}),
        "settingsUpdatedAt": max(current_settings_at, incoming_settings_at),
        "costTrackingVersion": max(int(current.get("costTrackingVersion", 0)),
                                  int(incoming.get("costTrackingVersion", 0))),
        "costTrackingStarted": min(
            (value for value in (str(current.get("costTrackingStarted", "")),
                                 str(incoming.get("costTrackingStarted", ""))) if value),
            default="",
        ),
        "updatedAt": max(str(current.get("updatedAt", "")),
                         str(incoming.get("updatedAt", ""))),
    }


class Handler(SimpleHTTPRequestHandler):
    server_version = "Malesep/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def send_json(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0 or length > MAX_BODY:
            raise ValueError("Файл өтө чоң (чеги 100 МБ).")
        return self.rfile.read(length)

    def read_json_body(self):
        try:
            return json.loads(self.read_body().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("Сурамдын форматы туура эмес.")

    def authenticated_user(self):
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return None
        return decode_token(header[7:])

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            if path in ("/api/register", "/api/login"):
                self.handle_auth(path)
                return
            if path == "/api/media":
                username = self.authenticated_user()
                if not username:
                    self.send_json(401, {"error": "Кайра кириңиз."})
                    return
                self.handle_upload(username)
                return
            self.send_json(404, {"error": "Бул дарек табылган жок."})
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except Exception as error:
            print("Request error:", error)
            self.send_json(500, {"error": "Серверде ката кетти."})

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/data":
            username = self.authenticated_user()
            if not username:
                self.send_json(401, {"error": "Кайра кириңиз."})
                return
            with LOCK:
                state = read_json(record_path(username), {"people": [], "events": []})
            self.send_json(200, state)
            return
        if path.startswith("/api/media/"):
            username = self.authenticated_user()
            media_id = path.rsplit("/", 1)[-1]
            if not username:
                self.send_json(401, {"error": "Кайра кириңиз."})
                return
            if not re.fullmatch(r"[0-9a-f]{32}\.[a-z0-9]{1,8}", media_id):
                self.send_json(404, {"error": "Файл табылган жок."})
                return
            user_key = hashlib.sha256(username.encode("utf-8")).hexdigest()
            file_path = UPLOADS_DIR / user_key / media_id
            if not file_path.is_file():
                self.send_json(404, {"error": "Файл табылган жок."})
                return
            body = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(file_path.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "private, max-age=86400")
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/health":
            self.send_json(200, {"ok": True})
            return
        super().do_GET()

    def do_PUT(self):
        if urlparse(self.path).path != "/api/data":
            self.send_json(404, {"error": "Бул дарек табылган жок."})
            return
        username = self.authenticated_user()
        if not username:
            self.send_json(401, {"error": "Кайра кириңиз."})
            return
        try:
            incoming = self.read_json_body()
            if not isinstance(incoming, dict):
                raise ValueError("Маалыматтын форматы туура эмес.")
            incoming = clean_media_data(incoming)
            with LOCK:
                path = record_path(username)
                current = read_json(path, {"people": [], "events": []})
                merged = merge_state(current, incoming)
                write_json(path, merged)
            self.send_json(200, merged)
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except Exception as error:
            print("Sync error:", error)
            self.send_json(500, {"error": "Маалыматты сактоодо сервер ката кетирди."})

    def handle_auth(self, path):
        body = self.read_json_body()
        if not isinstance(body, dict):
            raise ValueError("Логин жана сырсөз талап кылынат.")
        username = str(body.get("username", "")).strip()
        password = body.get("password", "")
        if not re.fullmatch(r"[\w.@+-]{3,32}", username, re.UNICODE):
            raise ValueError("Логин 3–32 белгиден туруп, тамга же сандан түзүлсүн.")
        if not isinstance(password, str) or len(password) < 8 or len(password) > 128:
            raise ValueError("Сырсөз кеминде 8 белгиден болушу керек.")
        key = username.casefold()
        with LOCK:
            accounts = read_json(ACCOUNTS_FILE, {})
            record = accounts.get(key)
            if path == "/api/register":
                if record:
                    self.send_json(409, {"error": "Бул логин мурда катталган."})
                    return
                salt = secrets.token_bytes(16)
                digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
                accounts[key] = {
                    "username": username,
                    "salt": base64.b64encode(salt).decode(),
                    "password_hash": base64.b64encode(digest).decode(),
                    "created_at": int(time.time()),
                }
                write_json(ACCOUNTS_FILE, accounts)
            else:
                if not record:
                    self.send_json(401, {"error": "Логин же сырсөз туура эмес."})
                    return
                salt = base64.b64decode(record["salt"])
                digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
                if not hmac.compare_digest(digest, base64.b64decode(record["password_hash"])):
                    self.send_json(401, {"error": "Логин же сырсөз туура эмес."})
                    return
                username = record["username"]
        self.send_json(200, {"token": make_token(username), "username": username})

    def handle_upload(self, username):
        content_type = self.headers.get("Content-Type", "application/octet-stream").split(";", 1)[0].lower()
        if not (content_type.startswith("image/") or content_type.startswith("video/")):
            raise ValueError("Сүрөт же видео гана жүктөңүз.")
        body = self.read_body()
        if not body:
            raise ValueError("Файл бош экен.")
        extension = mimetypes.guess_extension(content_type) or ".bin"
        extension = extension.lstrip(".").lower()
        if not re.fullmatch(r"[a-z0-9]{1,8}", extension):
            extension = "bin"
        media_id = uuid.uuid4().hex + "." + extension
        user_key = hashlib.sha256(username.encode("utf-8")).hexdigest()
        folder = UPLOADS_DIR / user_key
        folder.mkdir(parents=True, exist_ok=True)
        (folder / media_id).write_bytes(body)
        self.send_json(201, {"id": media_id})

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        super().end_headers()


if __name__ == "__main__":
    if not WEB.is_dir():
        raise SystemExit("web/ папкасы табылган жок.")
    RECORDS_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    print("Малэсеп иштеп жатат: http://%s:%s" % (host, port))
    print("Сервердеги маалыматтар:", DATA)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
