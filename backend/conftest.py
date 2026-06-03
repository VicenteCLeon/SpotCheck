"""Fixtures compartidas para los tests del backend.

Importante: importar `main` carga torch/ultralytics (lento) pero NO arranca
cámaras — los workers solo se inician dentro del `lifespan`, y el TestClient se
construye SIN context manager para no dispararlo.
"""
import os
import sys

import pytest

# Permitir `import main` desde tests/ (este conftest vive en backend/)
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


class FakeResp:
    """Respuesta mínima compatible con lo que el código espera de requests/_supabase_rest."""
    def __init__(self, status_code=200, json_data=None, text=None):
        self.status_code = status_code
        self._json = json_data
        if text is not None:
            self.text = text
        elif json_data is not None:
            import json as _json
            self.text = _json.dumps(json_data)
        else:
            self.text = ""

    def json(self):
        if self._json is None:
            raise ValueError("sin cuerpo JSON")
        return self._json


@pytest.fixture
def client():
    # Sin `with`: no se ejecuta el lifespan (no se arrancan cámaras reales).
    return TestClient(main.app)


@pytest.fixture
def admin_token():
    return main.create_session_token("admin@mail.pucv.cl", "Admin", None, role="admin")


@pytest.fixture
def viewer_token():
    return main.create_session_token("user@mail.pucv.cl", "User", None, role="viewer")


@pytest.fixture
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def viewer_headers(viewer_token):
    return {"Authorization": f"Bearer {viewer_token}"}
