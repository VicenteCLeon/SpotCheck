import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCamerasConfig,
  createCamera,
  updateCamera,
  deleteCamera,
  UnauthorizedError,
} from "../api";
import type { CameraConfigRow, CameraInput } from "../api";

interface AdminPanelProps {
  token: string;
  onClose: () => void;
  onSessionExpired: () => void;
}

const EMPTY_FORM: CameraInput = {
  id: "",
  name: "",
  source: "",
  capacity: 30,
  building: "",
  enabled: true,
  sort_order: 0,
};

export default function AdminPanel({ token, onClose, onSessionExpired }: AdminPanelProps) {
  const [rows, setRows] = useState<CameraConfigRow[]>([]);
  const [supabaseOff, setSupabaseOff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [form, setForm] = useState<CameraInput>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null); // null = creando
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Ref a la callback para que `refresh` no se recree cuando el padre re-renderiza
  // (el reloj del dashboard re-renderiza App cada segundo).
  const onSessionExpiredRef = useRef(onSessionExpired);
  useEffect(() => { onSessionExpiredRef.current = onSessionExpired; });

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const data = await fetchCamerasConfig(token);
      setRows(data.cameras);
      setSupabaseOff(!data.supabase);
    } catch (err) {
      if (err instanceof UnauthorizedError) return onSessionExpiredRef.current();
      setListError("No se pudo cargar la configuración de cámaras.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  // Cerrar con tecla Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function startCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, sort_order: rows.length + 1 });
    setFormError(null);
  }

  function startEdit(row: CameraConfigRow) {
    setEditingId(row.id);
    setForm({
      id: row.id,
      name: row.name,
      source: row.source,
      capacity: row.capacity,
      building: row.building ?? "",
      enabled: row.enabled,
      sort_order: row.sort_order,
    });
    setFormError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (editingId === null) {
        await createCamera(token, form);
      } else {
        const { id: _id, ...fields } = form;
        await updateCamera(token, editingId, fields);
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      await refresh();
    } catch (err) {
      if (err instanceof UnauthorizedError) return onSessionExpired();
      setFormError(err instanceof Error ? err.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: CameraConfigRow) {
    if (!window.confirm(`¿Eliminar la cámara "${row.name}" (${row.id})? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteCamera(token, row.id);
      if (editingId === row.id) { setEditingId(null); setForm(EMPTY_FORM); }
      await refresh();
    } catch (err) {
      if (err instanceof UnauthorizedError) return onSessionExpired();
      setListError(err instanceof Error ? err.message : "Error al eliminar.");
    }
  }

  const field = "w-full px-2.5 py-1.5 rounded-lg border border-line bg-surface-2 text-ink text-[13px] focus:outline-none focus:border-line-strong";
  const label = "block text-[11px] text-ink-3 uppercase tracking-wide mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm px-3 py-6 overflow-y-auto">
      <div className="w-full max-w-[760px] rounded-[16px] border border-line bg-surface shadow-[0_20px_80px_rgba(20,20,20,0.25)]">
        {/* Cabecera */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <div>
            <h2 className="m-0 text-[15px] font-semibold">Gestión de cámaras</h2>
            <p className="m-0 text-[11.5px] text-ink-3 mt-0.5">Agregar, editar o eliminar cámaras del sistema</p>
          </div>
          <button
            type="button" onClick={onClose} aria-label="Cerrar"
            className="w-8 h-8 rounded-lg border border-line bg-surface flex items-center justify-center text-ink-2 hover:border-line-strong hover:text-ink"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {supabaseOff && (
            <div className="px-3 py-2 rounded-lg border border-warn bg-warn-bg text-warn text-[12px]">
              Supabase no está configurado: la gestión de cámaras está deshabilitada (modo solo lectura).
            </div>
          )}
          {listError && (
            <div className="px-3 py-2 rounded-lg border border-danger bg-danger-bg text-danger text-[12px]">{listError}</div>
          )}

          {/* Lista de cámaras */}
          {loading ? (
            <div className="text-ink-3 text-[12px] py-6 text-center">Cargando…</div>
          ) : rows.length === 0 ? (
            <div className="text-ink-3 text-[12px] py-6 text-center">No hay cámaras configuradas.</div>
          ) : (
            <div className="border border-line rounded-xl overflow-hidden">
              <table className="w-full text-[12.5px]">
                <thead className="bg-surface-2 text-ink-3 text-[11px] uppercase tracking-wide">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Cámara</th>
                    <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Fuente</th>
                    <th className="text-left font-medium px-3 py-2">Aforo</th>
                    <th className="text-left font-medium px-3 py-2">Estado</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="px-3 py-2">
                        <div className="font-medium text-ink">{r.name}</div>
                        <div className="text-ink-4 text-[11px] font-mono">{r.id}{r.building ? ` · ${r.building}` : ""}</div>
                      </td>
                      <td className="px-3 py-2 hidden sm:table-cell font-mono text-ink-3 text-[11.5px] max-w-[160px] truncate">{r.source}</td>
                      <td className="px-3 py-2 text-ink-2">{r.capacity}</td>
                      <td className="px-3 py-2">
                        {!r.enabled ? (
                          <span className="text-ink-4">desactivada</span>
                        ) : r.online ? (
                          <span className="inline-flex items-center gap-1.5 text-ok"><span className="w-1.5 h-1.5 rounded-full bg-ok" />en línea</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-danger"><span className="w-1.5 h-1.5 rounded-full bg-danger" />offline</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <button type="button" onClick={() => startEdit(r)} disabled={supabaseOff}
                            className="px-2 py-1 rounded-md border border-line text-ink-2 text-[11.5px] hover:border-line-strong hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed">Editar</button>
                          <button type="button" onClick={() => handleDelete(r)} disabled={supabaseOff}
                            className="px-2 py-1 rounded-md border border-danger/40 text-danger text-[11.5px] hover:bg-danger-bg disabled:opacity-40 disabled:cursor-not-allowed">Eliminar</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Formulario crear / editar */}
          {!supabaseOff && (
            <form onSubmit={handleSubmit} className="border border-line rounded-xl p-4 space-y-3 bg-surface-2/40">
              <div className="flex items-center justify-between">
                <h3 className="m-0 text-[13px] font-semibold">{editingId === null ? "Nueva cámara" : `Editando: ${editingId}`}</h3>
                {editingId !== null && (
                  <button type="button" onClick={startCreate} className="text-[11.5px] text-ink-3 hover:text-ink underline">+ crear otra</button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={label}>ID {editingId !== null && <span className="text-ink-4 normal-case">(no editable)</span>}</label>
                  <input className={field} value={form.id} disabled={editingId !== null}
                    onChange={(e) => setForm({ ...form, id: e.target.value })}
                    placeholder="cam3" />
                </div>
                <div>
                  <label className={label}>Nombre</label>
                  <input className={field} value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Biblioteca Piso 2" />
                </div>
                <div className="sm:col-span-2">
                  <label className={label}>Fuente (índice webcam o URL RTSP)</label>
                  <input className={field} value={form.source}
                    onChange={(e) => setForm({ ...form, source: e.target.value })}
                    placeholder="0   ·   rtsp://192.168.1.100/stream" />
                </div>
                <div>
                  <label className={label}>Aforo máximo</label>
                  <input type="number" min={1} className={field} value={form.capacity}
                    onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
                </div>
                <div>
                  <label className={label}>Edificio / ubicación</label>
                  <input className={field} value={form.building}
                    onChange={(e) => setForm({ ...form, building: e.target.value })}
                    placeholder="Biblioteca" />
                </div>
                <div>
                  <label className={label}>Orden</label>
                  <input type="number" className={field} value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
                </div>
                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 text-[12.5px] text-ink-2 cursor-pointer">
                    <input type="checkbox" checked={form.enabled}
                      onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                    Activa (capturando)
                  </label>
                </div>
              </div>

              {formError && (
                <div className="px-3 py-2 rounded-lg border border-danger bg-danger-bg text-danger text-[12px]">{formError}</div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button type="submit" disabled={saving}
                  className="px-3.5 py-1.5 rounded-lg bg-ink text-surface text-[12.5px] font-medium hover:opacity-90 disabled:opacity-50">
                  {saving ? "Guardando…" : editingId === null ? "Crear cámara" : "Guardar cambios"}
                </button>
                {editingId !== null && (
                  <button type="button" onClick={startCreate}
                    className="px-3.5 py-1.5 rounded-lg border border-line text-ink-2 text-[12.5px] hover:border-line-strong hover:text-ink">
                    Cancelar
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
