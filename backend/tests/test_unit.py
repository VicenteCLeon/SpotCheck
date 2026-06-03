"""Tests unitarios de funciones puras del backend (sin app, sin red, sin cámaras)."""
from datetime import datetime
from types import SimpleNamespace

import pytest

import main
from conftest import FakeResp


# ─────────────────────────────────────────────
# occupancy_status
# ─────────────────────────────────────────────
@pytest.mark.parametrize("count,cap,expected", [
    (0, 10, "ok"),
    (5, 10, "ok"),       # 50% < 60
    (6, 10, "warn"),     # 60% == WARN_PCT
    (8, 10, "warn"),     # 80% < 85
    (9, 10, "danger"),   # 90% >= DANGER_PCT
    (10, 10, "danger"),
    (3, 0, "ok"),        # capacidad 0 → ok (evita división por cero)
])
def test_occupancy_status(count, cap, expected):
    assert main.occupancy_status(count, cap) == expected


# ─────────────────────────────────────────────
# _parse_camera_source
# ─────────────────────────────────────────────
@pytest.mark.parametrize("raw,expected,expected_type", [
    ("0", 0, int),
    ("1", 1, int),
    ("-1", -1, int),
    ("rtsp://cam/stream", "rtsp://cam/stream", str),
    ("http://x/y.mjpg", "http://x/y.mjpg", str),
    (0, 0, int),
    ("  2  ", 2, int),
])
def test_parse_camera_source(raw, expected, expected_type):
    got = main._parse_camera_source(raw)
    assert got == expected
    assert type(got) is expected_type


# ─────────────────────────────────────────────
# in_alert_window
# ─────────────────────────────────────────────
def _freeze_now(monkeypatch, dt):
    monkeypatch.setattr(main, "datetime", SimpleNamespace(now=lambda *a, **k: dt))


def test_in_alert_window_inside(monkeypatch):
    _freeze_now(monkeypatch, datetime(2026, 1, 1, 14, 0, 0))  # ventana 13:30-14:30
    assert main.in_alert_window() is True


def test_in_alert_window_outside(monkeypatch):
    _freeze_now(monkeypatch, datetime(2026, 1, 1, 10, 0, 0))
    assert main.in_alert_window() is False


# ─────────────────────────────────────────────
# fetch_cameras_from_supabase
# ─────────────────────────────────────────────
def test_fetch_cameras_disabled(monkeypatch):
    monkeypatch.setattr(main, "SUPABASE_ENABLED", False)
    assert main.fetch_cameras_from_supabase() is None


def test_fetch_cameras_parses_and_filters(monkeypatch):
    monkeypatch.setattr(main, "SUPABASE_ENABLED", True)
    rows = [
        {"id": "cam1", "name": "Entrada", "source": "0", "capacity": 30, "building": "Bib"},
        {"id": "ip2", "name": "Patio", "source": "rtsp://x/s", "capacity": 100, "building": "C"},
        {"id": "", "name": "rota", "source": "5", "capacity": 10},          # id vacío → ignorada
        {"id": "cam9", "name": None, "source": "2", "capacity": None},      # defaults
    ]
    monkeypatch.setattr(main.requests, "get", lambda *a, **k: FakeResp(200, rows))
    cfg = main.fetch_cameras_from_supabase()
    assert len(cfg) == 3
    assert cfg[0]["source"] == 0 and isinstance(cfg[0]["source"], int)
    assert cfg[1]["source"] == "rtsp://x/s"
    assert cfg[2]["name"] == "cam9"      # name None → usa id
    assert cfg[2]["capacity"] == 50      # capacity None → default 50


def test_fetch_cameras_http_error(monkeypatch):
    monkeypatch.setattr(main, "SUPABASE_ENABLED", True)
    monkeypatch.setattr(main.requests, "get", lambda *a, **k: FakeResp(404, text="not found"))
    assert main.fetch_cameras_from_supabase() is None


def test_fetch_cameras_network_error(monkeypatch):
    monkeypatch.setattr(main, "SUPABASE_ENABLED", True)
    def boom(*a, **k):
        raise main.requests.RequestException("sin red")
    monkeypatch.setattr(main.requests, "get", boom)
    assert main.fetch_cameras_from_supabase() is None


# ─────────────────────────────────────────────
# load_cameras_config (fallback)
# ─────────────────────────────────────────────
def test_load_cameras_config_fallback(monkeypatch):
    monkeypatch.setattr(main, "fetch_cameras_from_supabase", lambda: None)
    cfg = main.load_cameras_config()
    assert cfg is main.CAMERAS_FALLBACK
    assert main.CAMERAS_SOURCE == "fallback"


def test_load_cameras_config_supabase(monkeypatch):
    fake = [{"id": "x", "name": "X", "source": 0, "capacity": 5, "building": ""}]
    monkeypatch.setattr(main, "fetch_cameras_from_supabase", lambda: fake)
    cfg = main.load_cameras_config()
    assert cfg is fake
    assert main.CAMERAS_SOURCE == "supabase"


# ─────────────────────────────────────────────
# fetch_user_role
# ─────────────────────────────────────────────
def test_fetch_user_role_disabled(monkeypatch):
    monkeypatch.setattr(main, "SUPABASE_ENABLED", False)
    assert main.fetch_user_role("a@mail.pucv.cl") == "viewer"


def test_fetch_user_role_admin(monkeypatch):
    monkeypatch.setattr(main, "SUPABASE_ENABLED", True)
    monkeypatch.setattr(main.requests, "get", lambda *a, **k: FakeResp(200, [{"role": "admin"}]))
    assert main.fetch_user_role("a@mail.pucv.cl") == "admin"


def test_fetch_user_role_not_found(monkeypatch):
    monkeypatch.setattr(main, "SUPABASE_ENABLED", True)
    monkeypatch.setattr(main.requests, "get", lambda *a, **k: FakeResp(200, []))
    assert main.fetch_user_role("a@mail.pucv.cl") == "viewer"


def test_fetch_user_role_network_error(monkeypatch):
    monkeypatch.setattr(main, "SUPABASE_ENABLED", True)
    def boom(*a, **k):
        raise Exception("caído")
    monkeypatch.setattr(main.requests, "get", boom)
    assert main.fetch_user_role("a@mail.pucv.cl") == "viewer"  # nunca bloquea el login


# ─────────────────────────────────────────────
# JWT: create / decode
# ─────────────────────────────────────────────
def test_jwt_roundtrip_includes_role():
    token = main.create_session_token("a@mail.pucv.cl", "A", None, role="admin")
    payload = main.decode_session_token(token)
    assert payload["sub"] == "a@mail.pucv.cl"
    assert payload["role"] == "admin"


def test_jwt_default_role_viewer():
    token = main.create_session_token("a@mail.pucv.cl", "A", None)
    assert main.decode_session_token(token)["role"] == "viewer"


def test_jwt_tampered_raises():
    token = main.create_session_token("a@mail.pucv.cl", "A", None, role="viewer")
    tampered = token[:-3] + ("aaa" if token[-3:] != "aaa" else "bbb")
    with pytest.raises(main.HTTPException) as exc:
        main.decode_session_token(tampered)
    assert exc.value.status_code == 401


def test_jwt_expired_raises(monkeypatch):
    monkeypatch.setattr(main, "JWT_EXPIRE_HOURS", -1)  # ya expirado
    token = main.create_session_token("a@mail.pucv.cl", "A", None, role="viewer")
    with pytest.raises(main.HTTPException) as exc:
        main.decode_session_token(token)
    assert exc.value.status_code == 401


# ─────────────────────────────────────────────
# reconcile_worker (con CameraWorker falso, sin YOLO)
# ─────────────────────────────────────────────
class FakeWorker:
    def __init__(self, cam_id, name, source, capacity=50, building=""):
        self.id = cam_id
        self.name = name
        self.source = source
        self.capacity = capacity
        self.building = building
        self.started = False
        self.stopped = False

    def start(self):
        self.started = True

    def stop(self):
        self.stopped = True


@pytest.fixture
def fake_workers(monkeypatch):
    monkeypatch.setattr(main, "CameraWorker", FakeWorker)
    main.CAMERAS.clear()
    yield main.CAMERAS
    main.CAMERAS.clear()


def _cfg(**over):
    base = {"id": "cam1", "name": "Cam 1", "source": 0, "capacity": 10,
            "building": "", "enabled": True}
    base.update(over)
    return base


def test_reconcile_starts_new_worker(fake_workers):
    main.reconcile_worker(_cfg())
    assert "cam1" in fake_workers
    assert fake_workers["cam1"].started is True


def test_reconcile_disabled_stops_worker(fake_workers):
    main.reconcile_worker(_cfg())                 # arranca
    main.reconcile_worker(_cfg(enabled=False))    # desactiva
    assert "cam1" not in fake_workers


def test_reconcile_metadata_in_place(fake_workers):
    main.reconcile_worker(_cfg())
    worker = fake_workers["cam1"]
    main.reconcile_worker(_cfg(name="Nuevo nombre", capacity=99))
    assert fake_workers["cam1"] is worker          # mismo objeto (no se reinició)
    assert worker.name == "Nuevo nombre"
    assert worker.capacity == 99


def test_reconcile_source_change_restarts(fake_workers):
    main.reconcile_worker(_cfg(source=0))
    old = fake_workers["cam1"]
    main.reconcile_worker(_cfg(source="rtsp://nueva/fuente"))
    assert old.stopped is True
    assert fake_workers["cam1"] is not old          # worker reiniciado
    assert fake_workers["cam1"].source == "rtsp://nueva/fuente"
