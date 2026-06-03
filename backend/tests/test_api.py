"""Tests de los endpoints HTTP (roles, validación, CRUD) con Supabase mockeado."""
import pytest

import main
from conftest import FakeResp


# ─────────────────────────────────────────────
# Público
# ─────────────────────────────────────────────
def test_health_public(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "online"
    assert "cameras" in body and "supabase" in body


# ─────────────────────────────────────────────
# Autenticación / roles
# ─────────────────────────────────────────────
def test_cameras_config_requires_auth(client):
    # Sin cabecera Authorization → 401 (falta autenticación)
    assert client.get("/api/cameras/config").status_code == 401


def test_cameras_config_viewer_forbidden(client, viewer_headers):
    assert client.get("/api/cameras/config", headers=viewer_headers).status_code == 403


def test_cameras_config_invalid_token(client):
    res = client.get("/api/cameras/config", headers={"Authorization": "Bearer no-es-un-jwt"})
    assert res.status_code == 401


def test_cameras_config_admin_ok(client, admin_headers, monkeypatch):
    monkeypatch.setattr(main, "SUPABASE_ENABLED", True)
    rows = [{"id": "cam1", "name": "Cam 1", "source": "0", "capacity": 10,
             "building": "", "enabled": True, "sort_order": 1}]
    monkeypatch.setattr(main, "_supabase_rest", lambda *a, **k: FakeResp(200, rows))
    res = client.get("/api/cameras/config", headers=admin_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["supabase"] is True
    assert body["cameras"][0]["id"] == "cam1"
    assert "online" in body["cameras"][0]   # anotado en vivo


def test_create_viewer_forbidden(client, viewer_headers):
    res = client.post("/api/cameras", headers=viewer_headers,
                      json={"id": "x", "name": "x", "source": "0"})
    assert res.status_code == 403


# ─────────────────────────────────────────────
# Validación de creación
# ─────────────────────────────────────────────
@pytest.fixture
def supabase_on(monkeypatch):
    monkeypatch.setattr(main, "SUPABASE_ENABLED", True)
    # reconcile_worker no debe arrancar YOLO durante los tests
    monkeypatch.setattr(main, "reconcile_worker", lambda cfg: None)
    return monkeypatch


def test_create_invalid_id(client, admin_headers, supabase_on):
    res = client.post("/api/cameras", headers=admin_headers,
                      json={"id": "id con espacios!", "name": "X", "source": "0"})
    assert res.status_code == 422


def test_create_invalid_capacity(client, admin_headers, supabase_on):
    res = client.post("/api/cameras", headers=admin_headers,
                      json={"id": "cam1", "name": "X", "source": "0", "capacity": 0})
    assert res.status_code == 422


def test_create_duplicate(client, admin_headers, supabase_on):
    supabase_on.setattr(main, "_supabase_rest",
                        lambda *a, **k: FakeResp(409, text="duplicate key value violates unique"))
    res = client.post("/api/cameras", headers=admin_headers,
                      json={"id": "cam1", "name": "X", "source": "0"})
    assert res.status_code == 409


def test_create_happy(client, admin_headers, supabase_on):
    row = {"id": "cam3", "name": "Nueva", "source": "0", "capacity": 30,
           "building": "B", "enabled": True, "sort_order": 3}
    supabase_on.setattr(main, "_supabase_rest", lambda *a, **k: FakeResp(201, [row]))
    res = client.post("/api/cameras", headers=admin_headers,
                      json={"id": "cam3", "name": "Nueva", "source": "0",
                            "capacity": 30, "building": "B", "enabled": True, "sort_order": 3})
    assert res.status_code == 201
    assert res.json() == {"ok": True, "id": "cam3"}


# ─────────────────────────────────────────────
# Actualización
# ─────────────────────────────────────────────
def test_patch_not_found(client, admin_headers, supabase_on):
    supabase_on.setattr(main, "_supabase_rest", lambda *a, **k: FakeResp(200, []))
    res = client.patch("/api/cameras/nope", headers=admin_headers, json={"capacity": 20})
    assert res.status_code == 404


def test_patch_invalid_capacity(client, admin_headers, supabase_on):
    res = client.patch("/api/cameras/cam1", headers=admin_headers, json={"capacity": 0})
    assert res.status_code == 422


def test_patch_happy(client, admin_headers, supabase_on):
    row = {"id": "cam1", "name": "Editada", "source": "0", "capacity": 40,
           "building": "", "enabled": True, "sort_order": 1}
    supabase_on.setattr(main, "_supabase_rest", lambda *a, **k: FakeResp(200, [row]))
    res = client.patch("/api/cameras/cam1", headers=admin_headers,
                       json={"capacity": 40, "name": "Editada"})
    assert res.status_code == 200
    assert res.json() == {"ok": True, "id": "cam1"}


# ─────────────────────────────────────────────
# Borrado
# ─────────────────────────────────────────────
def test_delete_not_found(client, admin_headers, supabase_on):
    supabase_on.setattr(main, "_supabase_rest", lambda *a, **k: FakeResp(200, []))
    res = client.delete("/api/cameras/nope", headers=admin_headers)
    assert res.status_code == 404


def test_delete_happy(client, admin_headers, supabase_on):
    row = {"id": "cam1", "name": "Cam", "source": "0", "capacity": 10}
    supabase_on.setattr(main, "_supabase_rest", lambda *a, **k: FakeResp(200, [row]))
    res = client.delete("/api/cameras/cam1", headers=admin_headers)
    assert res.status_code == 200
    assert res.json() == {"ok": True, "id": "cam1"}


def test_delete_viewer_forbidden(client, viewer_headers):
    assert client.delete("/api/cameras/cam1", headers=viewer_headers).status_code == 403


# ─────────────────────────────────────────────
# /api/cameras (dashboard) — shape de respuesta
# ─────────────────────────────────────────────
class _FakeWorker:
    def __init__(self):
        self.id = "cam1"; self.name = "Cam 1"; self.building = "Edif A"
        self.count = 6; self.capacity = 10; self.online = True; self.error = None


def test_list_cameras_shape(client, viewer_headers):
    main.CAMERAS.clear()
    main.CAMERAS["cam1"] = _FakeWorker()
    try:
        res = client.get("/api/cameras", headers=viewer_headers)
        assert res.status_code == 200
        cam = res.json()[0]
        assert cam["id"] == "cam1"
        assert cam["building"] == "Edif A"
        assert cam["status"] == "warn"   # 6/10 = 60%
        assert cam["online"] is True
    finally:
        main.CAMERAS.clear()
