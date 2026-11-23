"""Acceso a la API del portal de estudiantes con reintentos y errores clasificados.

El login (OpenID Connect + PKCE) se reutiliza de isams_client.py, que ya funciona.
"""
import json
import os
import sys
import threading
import time
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import isams_client as _c  # noqa: E402


class AuthError(RuntimeError):
    """No se pudo iniciar sesion (credenciales, cambio del formulario, MFA...)."""


class ApiError(RuntimeError):
    """La API respondio mal despues de reintentar."""


STUDENT_ID = _c.STUDENT_ID   # se completa en login() si no viene en ISAMS_STUDENT_ID

# La extraccion hace peticiones en paralelo: el token se lee/renueva de uno en uno,
# y un sys.exit() del cliente viejo se convierte en AuthError (para que la corrida quede registrada).
_TOKEN_LOCK = threading.Lock()
_orig_get_access_token = _c.get_access_token


def _locked_get_access_token():
    with _TOKEN_LOCK:
        try:
            return _orig_get_access_token()
        except SystemExit as e:
            raise AuthError(f"Sesion de iSAMS: {e}") from None


_c.get_access_token = _locked_get_access_token
RETRY_STATUS = {429, 500, 502, 503, 504}


def login(attempts=3):
    last = None
    global STUDENT_ID
    for i in range(attempts):
        try:
            _c.login()
            STUDENT_ID = _c.ensure_student_id()
            return
        except SystemExit as e:   # el cliente usa sys.exit para errores de configuracion
            raise AuthError(str(e)) from None
        except RuntimeError as e:
            last = e
            msg = str(e)
            # credenciales rechazadas: reintentar no sirve y puede bloquear la cuenta
            if "Login rechazado" in msg or "formulario" in msg:
                raise AuthError(msg) from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
        time.sleep(5 * (i + 1))
    raise AuthError(f"Login fallo tras {attempts} intentos: {last}")


def get(path, attempts=4):
    """GET JSON con reintentos para errores transitorios. Devuelve (status, data)."""
    last = None
    for i in range(attempts):
        try:
            status, _, body = _c.api_get(path)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = f"red: {e}"
            time.sleep(2 ** i)
            continue
        if status in RETRY_STATUS:
            last = f"HTTP {status}"
            time.sleep(2 ** i)
            continue
        if status == 401:
            raise AuthError(f"Token rechazado en {path}")
        try:
            return status, json.loads(body)
        except ValueError:
            raise ApiError(f"{path}: respuesta no es JSON (HTTP {status}): {body[:120]!r}")
    raise ApiError(f"{path}: {last} tras {attempts} intentos")


def get_ok(path):
    status, data = get(path)
    if status != 200:
        raise ApiError(f"{path}: HTTP {status}")
    return data
