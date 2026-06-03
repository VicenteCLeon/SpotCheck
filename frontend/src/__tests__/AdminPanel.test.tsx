import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminPanel from "../components/AdminPanel";
import type { CameraConfigResponse } from "../api";
import { fetchCamerasConfig, createCamera, deleteCamera } from "../api";

// Mock del módulo api (incluye UnauthorizedError porque el componente la usa con instanceof)
vi.mock("../api", () => {
  class UnauthorizedError extends Error {}
  return {
    fetchCamerasConfig: vi.fn(),
    createCamera: vi.fn(),
    updateCamera: vi.fn(),
    deleteCamera: vi.fn(),
    UnauthorizedError,
  };
});

const sampleConfig: CameraConfigResponse = {
  source: "supabase",
  supabase: true,
  cameras: [
    { id: "cam1", name: "Entrada Principal", source: "0", capacity: 30, building: "Bib", enabled: true, sort_order: 1, online: true },
  ],
};

const props = { token: "tok", onClose: vi.fn(), onSessionExpired: vi.fn() };

describe("AdminPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchCamerasConfig).mockResolvedValue(sampleConfig);
  });

  it("renderiza la lista de cámaras del backend", async () => {
    render(<AdminPanel {...props} />);
    expect(await screen.findByText("Entrada Principal")).toBeInTheDocument();
    expect(screen.getByText(/cam1/)).toBeInTheDocument();
  });

  it("crea una cámara al enviar el formulario", async () => {
    vi.mocked(createCamera).mockResolvedValue(undefined);
    render(<AdminPanel {...props} />);
    await screen.findByText("Entrada Principal");

    await userEvent.type(screen.getByPlaceholderText("cam3"), "cam5");
    await userEvent.type(screen.getByPlaceholderText("Biblioteca Piso 2"), "Sala Nueva");
    await userEvent.type(screen.getByPlaceholderText(/rtsp:\/\//), "0");
    await userEvent.click(screen.getByRole("button", { name: "Crear cámara" }));

    await waitFor(() => expect(createCamera).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createCamera).mock.calls[0][0]).toBe("tok");
    expect(vi.mocked(createCamera).mock.calls[0][1]).toMatchObject({
      id: "cam5", name: "Sala Nueva", source: "0",
    });
  });

  it("elimina una cámara tras confirmar", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(deleteCamera).mockResolvedValue(undefined);
    render(<AdminPanel {...props} />);
    await screen.findByText("Entrada Principal");

    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(deleteCamera).toHaveBeenCalledWith("tok", "cam1"));
  });

  it("no elimina si el usuario cancela la confirmación", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AdminPanel {...props} />);
    await screen.findByText("Entrada Principal");

    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(deleteCamera).not.toHaveBeenCalled();
  });

  it("muestra el error del backend si la creación falla", async () => {
    vi.mocked(createCamera).mockRejectedValue(new Error("Ya existe una cámara con id 'cam5'."));
    render(<AdminPanel {...props} />);
    await screen.findByText("Entrada Principal");

    await userEvent.type(screen.getByPlaceholderText("cam3"), "cam5");
    await userEvent.type(screen.getByPlaceholderText("Biblioteca Piso 2"), "X");
    await userEvent.type(screen.getByPlaceholderText(/rtsp:\/\//), "0");
    await userEvent.click(screen.getByRole("button", { name: "Crear cámara" }));

    expect(await screen.findByText(/Ya existe una cámara/)).toBeInTheDocument();
  });

  it("muestra modo solo lectura cuando Supabase está apagado", async () => {
    vi.mocked(fetchCamerasConfig).mockResolvedValue({ ...sampleConfig, supabase: false });
    render(<AdminPanel {...props} />);
    expect(await screen.findByText(/modo solo lectura/i)).toBeInTheDocument();
    // Sin Supabase no se muestra el formulario de creación
    expect(screen.queryByRole("button", { name: "Crear cámara" })).not.toBeInTheDocument();
  });
});
