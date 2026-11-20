#!/usr/bin/env python3
"""Cliente ligero para el portal de estudiantes iSAMS (cloud).

Solo usa la libreria estandar de Python (nada que instalar).
Flujo reconstruido de tu captura: OpenID Connect, authorization code + PKCE.

Uso:
  python3 isams_client.py login            # pide usuario/contrasena localmente
  python3 isams_client.py dump             # perfil, trimestres, lista de gradebooks
  python3 isams_client.py grades [--all]   # calificaciones por materia
  python3 isams_client.py conduct          # conducta / rewards
  python3 isams_client.py all              # todo lo anterior
  python3 isams_client.py get /ruta/api    # imprime cualquier endpoint de /api/portals

Variables obligatorias: ISAMS_SCHOOL (subdominio del colegio), ISAMS_STUDENT_ID
Variables opcionales: ISAMS_USER, ISAMS_PASS, ISAMS_DOMAIN, ISAMS_TERM
La contrasena NO se guarda; solo se guardan los tokens en ~/.isams_tokens.json
"""
import base64
import getpass
import hashlib
import http.cookiejar
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

SCHOOL = os.environ.get("ISAMS_SCHOOL", "").strip()
DOMAIN = os.environ.get("ISAMS_DOMAIN", "isamshosting.cloud").strip()
if not SCHOOL:
    sys.exit("Falta ISAMS_SCHOOL: es el subdominio de tu portal, por ejemplo 'miescuela' en "
             "https://miescuela.isamshosting.cloud")
HOST = f"https://{SCHOOL}.{DOMAIN}"
AUTH = f"{HOST}/auth"
API = f"{HOST}/api/portals"
CLIENT_ID = "iSAMS.Portal.Cloud.Students"
REDIRECT = f"https://{SCHOOL}.students.{DOMAIN}/callback"
SCOPE = "offline_access openid iSAMS.CloudPortals.Api iSAMS.Auth.ChangeAccountPassword.Invoke"
TOKEN_FILE = os.path.expanduser("~/.isams_tokens.json")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36")
# El ID del estudiante sale de las llamadas de red del portal (ver README).
# Si no lo defines, se busca solo en tu perfil (ver ensure_student_id).
STUDENT_ID = os.environ.get("ISAMS_STUDENT_ID", "").strip()
TERM_ID = os.environ.get("ISAMS_TERM", "")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def make_opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar), NoRedirect())


def fetch(opener, url, data=None, headers=None, method=None):
    h = {"User-Agent": UA}
    h.update(headers or {})
    body = urllib.parse.urlencode(data).encode() if isinstance(data, dict) else data
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with opener.open(req, timeout=30) as r:
            return r.status, r.headers, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read().decode("utf-8", "replace")


def follow(opener, url, hops=12):
    """Sigue redirects a mano hasta llegar a una pagina o al redirect_uri."""
    for _ in range(hops):
        url = url.replace(" ", "%20")  # el servidor manda redirects con espacios sin codificar
        if url.startswith(REDIRECT):
            return None, url, ""
        status, hdrs, body = fetch(opener, url)
        if status in (301, 302, 303, 307, 308):
            url = urllib.parse.urljoin(url, hdrs.get("Location", ""))
            continue
        return status, url, body
    raise RuntimeError("Demasiados redirects")


class FormParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.forms, self.cur = [], None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "form":
            self.cur = {"action": a.get("action", ""), "inputs": []}
            self.forms.append(self.cur)
        elif tag == "input" and self.cur is not None:
            self.cur["inputs"].append(a)
        elif tag == "button" and self.cur is not None and a.get("name"):
            a["type"] = "submit"
            self.cur["inputs"].append(a)

    def handle_endtag(self, tag):
        if tag == "form":
            self.cur = None


def build_login_payload(html, user, password):
    p = FormParser()
    p.feed(html)
    form = next((f for f in p.forms
                 if any((i.get("type") or "").lower() == "password" for i in f["inputs"])), None)
    if not form:
        raise RuntimeError("No encontre el formulario de login (revisa isams_login_debug.html)")
    data, user_set, submit_set = {}, False, False
    for i in form["inputs"]:
        name, typ = i.get("name"), (i.get("type") or "text").lower()
        if not name:
            continue
        if typ == "password":
            data[name] = password
        elif typ in ("text", "email") and not user_set:
            data[name] = user
            user_set = True
        elif typ == "hidden":
            data[name] = i.get("value", "")
        elif typ == "submit" and not submit_set:
            data[name] = i.get("value", "")
            submit_set = True
        # checkboxes ("recordarme", etc.) se omiten a proposito
    if not user_set:
        raise RuntimeError("No encontre el campo de usuario en el formulario")
    return form["action"], data


def save_tokens(tok):
    tok["expires_at"] = time.time() + int(tok.get("expires_in", 3600))
    with open(TOKEN_FILE, "w") as f:
        json.dump(tok, f)
    os.chmod(TOKEN_FILE, 0o600)


def token_request(data):
    status, _, body = fetch(make_opener(), f"{AUTH}/connect/token", data=data,
                            headers={"Content-Type": "application/x-www-form-urlencoded"})
    if status != 200:
        raise RuntimeError(f"Token endpoint respondio {status}: {body[:300]}")
    return json.loads(body)


def login():
    user = os.environ.get("ISAMS_USER") or input("Usuario iSAMS: ")
    password = os.environ.get("ISAMS_PASS") or getpass.getpass("Contrasena (no se muestra): ")
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_hex(16)
    params = {"client_id": CLIENT_ID, "redirect_uri": REDIRECT, "response_type": "code",
              "scope": SCOPE, "state": state, "code_challenge": challenge,
              "code_challenge_method": "S256"}
    opener = make_opener()
    status, page_url, html = follow(opener, f"{AUTH}/connect/authorize?" + urllib.parse.urlencode(params))
    if status != 200:
        raise RuntimeError(f"No llegue a la pagina de login (status {status})")
    # la pagina de login pide un token anti-CSRF extra por XHR; lo pedimos para tener las cookies
    fetch(opener, f"{AUTH}/Account/RenewXsrfToken", headers={"X-Requested-With": "XMLHttpRequest"})
    action, data = build_login_payload(html, user, password)
    post_url = urllib.parse.urljoin(page_url, action) if action else page_url
    status, hdrs, body = fetch(opener, post_url, data=data, headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": HOST, "Referer": page_url})
    if status not in (301, 302, 303):
        with open("isams_login_debug.html", "w") as f:
            f.write(body)
        raise RuntimeError(f"Login rechazado (status {status}). Revisa usuario/contrasena; "
                           "detalle en isams_login_debug.html")
    status, final_url, _ = follow(opener, urllib.parse.urljoin(post_url, hdrs["Location"]))
    if not final_url.startswith(REDIRECT):
        raise RuntimeError(f"No llegue al callback: {final_url[:200]}")
    q = urllib.parse.parse_qs(urllib.parse.urlparse(final_url).query)
    if q.get("state", [""])[0] != state:
        raise RuntimeError("El state no coincide")
    tok = token_request({"grant_type": "authorization_code", "redirect_uri": REDIRECT,
                         "code": q["code"][0], "code_verifier": verifier, "client_id": CLIENT_ID})
    save_tokens(tok)
    print("Login OK. Tokens guardados en", TOKEN_FILE)


def get_access_token():
    try:
        with open(TOKEN_FILE) as f:
            tok = json.load(f)
    except FileNotFoundError:
        sys.exit("Primero ejecuta: python3 isams_client.py login")
    if time.time() > tok["expires_at"] - 60:
        if not tok.get("refresh_token"):
            sys.exit("Sesion expirada: ejecuta login otra vez")
        new = token_request({"grant_type": "refresh_token", "client_id": CLIENT_ID,
                             "refresh_token": tok["refresh_token"]})
        new.setdefault("refresh_token", tok["refresh_token"])
        save_tokens(new)
        tok = new
    return tok["access_token"]


def api_get(path):
    url = path if path.startswith("http") else API + path
    return fetch(make_opener(), url, headers={
        "Authorization": "Bearer " + get_access_token(),
        "Content-Type": "application/json", "Accept": "application/json"})


def dump():
    ensure_student_id()
    targets = {
        "profile": "/account/profile",
        "terms": "/schools/terms",
        "gradebooks_feature": "/features/student/gradebooks",
        "markbooks": f"/markbooks/students/{STUDENT_ID}",
        "attendance_summary": f"/students/{STUDENT_ID}/terms/{TERM_ID}/attendancerecords/summary",
    }
    os.makedirs("isams_dump", exist_ok=True)
    for name, path in targets.items():
        status, _, body = api_get(path)
        try:
            body = json.dumps(json.loads(body), ensure_ascii=False, indent=2)
        except ValueError:
            pass
        with open(f"isams_dump/{name}.json", "w", encoding="utf-8") as f:
            f.write(body)
        print(f"{name}: HTTP {status}, {len(body)} caracteres")


def api_json(path):
    status, _, body = api_get(path)
    try:
        return status, json.loads(body)
    except ValueError:
        return status, body


def _numbers(obj, out=None):
    """Todos los valores numericos largos del perfil, con las claves 'id' primero."""
    out = [] if out is None else out
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, (dict, list)):
                _numbers(v, out)
            elif isinstance(v, (int, str)) and str(v).isdigit() and len(str(v)) >= 4:
                out.append((0 if "id" in k.lower() else 1, str(v)))
    elif isinstance(obj, list):
        for v in obj:
            _numbers(v, out)
    return out


def candidate_ids(profile):
    seen, result = set(), []
    for _, v in sorted(_numbers(profile), key=lambda t: t[0]):
        if v not in seen:
            seen.add(v)
            result.append(v)
    return result


def ensure_student_id():
    """Si no hay ISAMS_STUDENT_ID, prueba los numeros de tu perfil hasta que
    /markbooks/students/<numero> responda 200 (solo lecturas de tu propia cuenta)."""
    global STUDENT_ID
    if STUDENT_ID:
        return STUDENT_ID
    status, profile = api_json("/account/profile")
    if status != 200:
        sys.exit(f"No pude leer tu perfil (HTTP {status}). Define ISAMS_STUDENT_ID a mano (ver README).")
    for cand in candidate_ids(profile):
        st, _, _ = api_get(f"/markbooks/students/{cand}")
        if st == 200:
            STUDENT_ID = cand
            print("ID de estudiante encontrado automaticamente.")
            return STUDENT_ID
    sys.exit("No encontre tu ID de estudiante en el perfil. Define ISAMS_STUDENT_ID a mano (ver README).")


def find_list(obj):
    """Devuelve la lista de dicts de una respuesta (lista directa o dentro de un dict)."""
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict):
        for v in obj.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
    return []


def write_json(name, data):
    os.makedirs("isams_dump", exist_ok=True)
    with open(f"isams_dump/{name}.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"{name}.json guardado")


def grades(include_archived=False):
    """Calificaciones: columnas de cada gradebook (por defecto sin los archivados)."""
    ensure_student_id()
    status, books = api_json(f"/markbooks/students/{STUDENT_ID}")
    result = []
    for b in find_list(books):
        name = b.get("name", "")
        if not include_archived and name.startswith("z(Archive)"):
            continue
        st, cols = api_json(f"/markbooks/{b['id']}/students/{STUDENT_ID}/columns")
        print(f"{name}: HTTP {st}")
        result.append({"id": b["id"], "name": name, "http": st, "columns": cols})
    write_json("grades", result)


def conduct():
    """Conducta: tipos de reward/conducta y los registros del estudiante en cada tipo."""
    ensure_student_id()
    _, types = api_json("/rewardsandconduct/rewardtypes")
    items = find_list(types)
    ids = [t["id"] for t in items if isinstance(t, dict) and "id" in t] or [2, 3, 4, 5, 6, 9]
    result = {"types": types, "records": {}}
    for tid in ids:
        st, rec = api_json(f"/students/{STUDENT_ID}/rewardsandconduct/rewardtypes/{tid}")
        print(f"tipo {tid}: HTTP {st}")
        result["records"][str(tid)] = rec
    write_json("conduct", result)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "login":
        login()
    elif cmd == "grades":
        grades(include_archived="--all" in sys.argv)
    elif cmd == "conduct":
        conduct()
    elif cmd == "all":
        dump()
        grades()
        conduct()
    elif cmd == "dump":
        dump()
    elif cmd == "get" and len(sys.argv) > 2:
        st, _, b = api_get(sys.argv[2])
        print(st)
        print(b)
    else:
        print(__doc__)
