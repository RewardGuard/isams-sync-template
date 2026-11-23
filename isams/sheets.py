"""Envia los datos validados a la hoja (Apps Script) con firma HMAC y verifica lo escrito."""
import datetime
import hashlib
import hmac
import re
import json
import os
import time
import urllib.error
import urllib.request

COLUMNS = {
    "materias": ["id", "materia", "nombre_isams", "ciclo", "trimestre", "archivada", "total",
                 "total_oficial", "total_calculado", "total_es_calculado", "suma_pesos", "evaluaciones",
                 "calificadas", "ceros", "cuenta_gpa", "puntos_gpa", "gpa_ponderado", "avisos"],
    "categorias": ["materia_id", "materia", "trimestre", "categoria", "promedio_isams", "peso", "aporte",
                   "trabajos", "calificados", "promedio_recalculado", "coincide"],
    "evaluaciones": ["key", "materia_id", "materia", "trimestre", "archivada", "categoria", "nombre", "valor",
                     "valor_texto", "sobre", "entregado", "ausente", "fecha_en_nombre", "si_vale_100",
                     "escenario_exacto"],
    "conducta": ["id", "tipo", "categoria", "maestro", "fecha", "descripcion", "ciclo_actual"],
    "boletas": ["id", "nombre", "trimestre", "ciclo", "publicada"],
    "cambios": ["run_id", "fecha", "tipo", "materia", "clave", "detalle", "antes", "despues", "negativo"],
    "corridas": ["run_id", "inicio", "fin", "estado", "origen", "materias", "evaluaciones", "conducta",
                 "cambios", "datos_cambiaron", "avisos", "errores", "commit"],
}


class SheetsError(RuntimeError):
    pass


def key_fingerprint(secret):
    """Huella corta de la clave para comparar con Apps Script sin revelarla."""
    return hashlib.sha256(("huella:" + secret).encode("utf-8")).hexdigest()[:8]


def post(tables, changes, run, attempts=3):
    url = (os.environ.get("SHEETS_WEBAPP_URL") or "").strip()
    raw_secret = os.environ.get("SHEETS_HMAC_SECRET") or ""
    secret = raw_secret.strip()   # al copiar y pegar se suele colar un espacio o salto de linea
    if not url or not secret:
        raise SheetsError("Faltan los secretos SHEETS_WEBAPP_URL / SHEETS_HMAC_SECRET")
    # Si se pego la linea completa del registro de Apps Script, la clave son los 64 caracteres hex.
    found = re.findall(r"(?<![0-9a-fA-F])[0-9a-f]{64}(?![0-9a-fA-F])", secret)
    shape = {"largo": len(secret), "es_url": secret.startswith("http"), "igual_a_url": secret == url,
             "claves_hex_dentro": len(found)}
    if len(secret) != 64 and len(found) == 1:
        secret = found[0]
    print(f"   clave: huella {key_fingerprint(secret)}, {len(secret)} caracteres; forma original {shape}")
    payload = json.dumps({"sent_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                          "columns": COLUMNS, "tables": tables, "changes": changes, "run": run},
                         ensure_ascii=False, separators=(",", ":"))
    sig = hmac.new(secret.encode(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    body = json.dumps({"payload": payload, "sig": sig}).encode()
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as r:   # sigue el 302 de Apps Script
                resp = json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
            last = e
            time.sleep(5 * (i + 1))
            continue
        if not resp.get("ok"):
            raise SheetsError(f"La hoja rechazo los datos: {resp.get('error')}")
        return resp
    raise SheetsError(f"No se pudo contactar la hoja: {last}")


def verify(resp, tables):
    """La hoja debe tener exactamente las filas que mandamos."""
    problems = []
    for name, n in resp.get("verified", {}).items():
        expected = len(tables[name]) if isinstance(tables.get(name), list) else len(tables.get(name) or {})
        if n != expected:
            problems.append(f"{name}: se mandaron {expected} filas y quedaron {n}")
    return problems
