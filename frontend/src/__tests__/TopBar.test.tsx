import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TopBar from "../components/TopBar";

const baseProps = {
  now: new Date("2026-06-02T12:00:00"),
  overallStatus: "ok" as const,
  onLogout: () => {},
};

describe("TopBar", () => {
  it("muestra el badge Admin y el botón de gestión para admins", async () => {
    const onManage = vi.fn();
    render(<TopBar {...baseProps} userRole="admin" onManageCameras={onManage} />);

    expect(screen.getByText("Admin")).toBeInTheDocument();
    const btn = screen.getByLabelText("Gestionar camaras");
    expect(btn).toBeInTheDocument();

    await userEvent.click(btn);
    expect(onManage).toHaveBeenCalledOnce();
  });

  it("oculta el badge y el botón de gestión para viewers", () => {
    render(<TopBar {...baseProps} userRole="viewer" onManageCameras={() => {}} />);
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Gestionar camaras")).not.toBeInTheDocument();
  });

  it("siempre muestra el botón de logout", () => {
    render(<TopBar {...baseProps} userRole="viewer" onManageCameras={() => {}} />);
    expect(screen.getByLabelText("Cerrar sesion")).toBeInTheDocument();
  });
});
