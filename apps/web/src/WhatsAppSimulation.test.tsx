import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { WhatsAppSimulation } from "./WhatsAppSimulation";

describe("WhatsApp no navegador", () => {
  it("identifica o cenário fictício sem chamar a API", () => {
    const request = vi.spyOn(globalThis, "fetch");
    try {
      const page = renderToStaticMarkup(<WhatsAppSimulation />);
      expect(page).toContain("As mensagens abaixo são simuladas.");
      expect(page).toContain("Recebimento simulado");
      expect(page).toContain("Simular envio");
      expect(page).not.toContain("Enviar pelo WhatsApp");
      expect(request).not.toHaveBeenCalled();
    } finally {
      request.mockRestore();
    }
  });

  it("abre a conversa real pelo identificador do paciente e pela sessão do CRM", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ conversation: { id: "identificador-da-conversa" } }));
    try {
      await expect(api.startWhatsAppConversation("identificador-do-paciente")).resolves.toEqual({
        conversation: { id: "identificador-da-conversa" },
      });
      expect(request).toHaveBeenCalledWith(
        "/api/whatsapp/conversations",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({ patientId: "identificador-do-paciente" }),
        }),
      );
    } finally {
      request.mockRestore();
    }
  });
});
