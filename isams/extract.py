"""Descarga TODO lo que el portal expone al estudiante, sin transformar."""
from concurrent.futures import ThreadPoolExecutor

from . import api

WORKERS = 8   # peticiones simultaneas a iSAMS (los ~250 detalles de columna); mantiene la corrida bajo 1 minuto

def fetch_all(log=print):
    S = api.STUDENT_ID   # ya resuelto por api.login()
    if not S:
        raise api.AuthError("Sin ID de estudiante (define ISAMS_STUDENT_ID)")
    raw = {}
    raw["profile"] = api.get_ok("/account/profile")
    raw["student"] = api.get_ok("/students/portal/students/1,2,3,4,5,6,7,8,9")
    raw["terms"] = api.get_ok("/schools/terms")
    books = api.get_ok(f"/markbooks/students/{S}")
    if not isinstance(books, list):
        raise api.ApiError(f"markbooks: se esperaba una lista y llego {type(books).__name__}")
    raw["markbooks"] = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        cols_by_book = list(pool.map(
            lambda b: api.get_ok(f"/markbooks/{b['id']}/students/{S}/columns"), books))
        for b, cols in zip(books, cols_by_book):
            if not isinstance(cols, list):
                raise api.ApiError(f"columnas de {b.get('name')}: no es lista")
        jobs = [(b, col) for b, cols in zip(books, cols_by_book) for col in cols]
        dets = list(pool.map(
            lambda bc: api.get_ok(f"/markbooks/{bc[0]['id']}/students/{S}/columns/{bc[1]['id']}/details"), jobs))
    by_book = {}
    for (b, col), det in zip(jobs, dets):
        by_book.setdefault(b["id"], {})[str(col["id"])] = det
    for b, cols in zip(books, cols_by_book):
        raw["markbooks"].append({"book": b, "columns": cols, "details": by_book.get(b["id"], {})})
        log(f"  {b.get('name')}: {len(cols)} columnas")
    types = api.get_ok("/rewardsandconduct/rewardtypes")
    raw["reward_types"] = types
    raw["conduct"] = {}
    for t in _list(types):
        raw["conduct"][str(t["id"])] = api.get_ok(
            f"/students/{S}/rewardsandconduct/rewardtypes/{t['id']}")
    raw["reports"] = api.get_ok(f"/students/{S}/schoolreports/reports?$orderby=PublishedOn%20desc")
    return raw


def _list(obj):
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict):
        for v in obj.values():
            if isinstance(v, list):
                return v
    return []
