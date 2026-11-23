"""Detecta cambios entre la corrida anterior y la actual (historial)."""


def diff(prev, cur, run_id, when):
    out = []
    if not prev:
        return out

    def add(tipo, materia, clave, detalle, antes, despues, negativo):
        out.append({"run_id": run_id, "fecha": when, "tipo": tipo, "materia": materia, "clave": clave,
                    "detalle": detalle, "antes": "" if antes is None else antes,
                    "despues": "" if despues is None else despues, "negativo": negativo})

    pe = {e["key"]: e for e in prev.get("evaluaciones", [])}
    for e in cur["evaluaciones"]:
        o = pe.get(e["key"])
        if o is None:
            add("nueva evaluación", e["materia"], e["key"], e["nombre"], None, e["valor"],
                e["valor"] is not None and e["valor"] < 60)
        elif o["valor"] != e["valor"]:
            neg = e["valor"] is not None and o["valor"] is not None and e["valor"] < o["valor"]
            add("calificación cambió", e["materia"], e["key"], e["nombre"], o["valor"], e["valor"], neg)
    cur_keys = {e["key"] for e in cur["evaluaciones"]}
    for k, o in pe.items():
        if k not in cur_keys:
            add("evaluación desapareció", o["materia"], k, o["nombre"], o["valor"], None, False)
    pm = {m["id"]: m for m in prev.get("materias", [])}
    for m in cur["materias"]:
        o = pm.get(m["id"])
        if o is None:
            add("materia nueva", m["materia"], str(m["id"]), m["nombre_isams"], None, m["total"], False)
        elif o["total"] != m["total"]:
            neg = m["total"] is not None and o["total"] is not None and m["total"] < o["total"]
            add("total cambió", m["materia"], str(m["id"]), m["nombre_isams"], o["total"], m["total"], neg)
    pc = {c["id"] for c in prev.get("conducta", [])}
    for c in cur["conducta"]:
        if c["id"] not in pc:
            add("conducta nueva", "", str(c["id"]), f"{c['tipo']}: {c['descripcion']}", None, c["fecha"],
                c["tipo"] != "Positive Report")
    pb = {b["id"] for b in prev.get("boletas", [])}
    for b in cur["boletas"]:
        if b["id"] not in pb:
            add("boleta publicada", "", str(b["id"]), b["nombre"], None, b["publicada"], False)
    return out
