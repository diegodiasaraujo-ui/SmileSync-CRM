import { describe, expect, it } from "vitest";
import { localBookingDate, minimizeBookingText, parseBookingMessage } from "./booking-parser.js";

const services = [
  { id: "evaluation", name: "Avaliação odontológica", aliases: ["avaliação", "consulta"] },
  { id: "cleaning", name: "Limpeza", aliases: ["profilaxia"] },
];

describe("interpretação de agendamento pelo WhatsApp", () => {
  it("interpreta data relativa, procedimento e horário com o fuso da clínica", () => {
    const date = localBookingDate(new Date("2026-10-23T01:30:00Z"), "America/Sao_Paulo");
    expect(date).toBe("2026-10-22");
    const parsed = parseBookingMessage(
      "Oi, gostaria de agendar uma avaliação odontológica na sexta-feira às 14 horas.",
      date,
      services,
    );
    expect(parsed).toMatchObject({
      asksToBook: true,
      date: { value: "2026-10-23" },
      time: { value: "14:00" },
      service: { value: "evaluation" },
      confirmation: null,
    });
  });

  it("mantém ambiguidades como campos pendentes e rejeita datas inválidas", () => {
    const parsed = parseBookingMessage(
      "Agendar avaliação ou limpeza, amanhã ou sexta, 15h30 ou 16h.",
      "2026-10-21",
      services,
    );
    expect(parsed.date).toEqual({ value: null, attempted: true });
    expect(parsed.time).toEqual({ value: null, attempted: true });
    expect(parsed.service).toEqual({ value: null, attempted: true });
    expect(parseBookingMessage("31/11/2026", "2026-10-21", services).date.value).toBeNull();
    expect(parseBookingMessage("seg às 26h", "2026-10-21", services).time.value).toBeNull();
    expect(parseBookingMessage("às 2 da tarde", "2026-10-21", services).time.value).toBe("14:00");
  });

  it("exige o comando literal de confirmação e reconhece negativas e terceiros", () => {
    expect(parseBookingMessage("sim", "2026-10-21", services).confirmation).toBeNull();
    expect(
      parseBookingMessage("não confirmar ABCD1234", "2026-10-21", services).confirmation,
    ).toBeNull();
    expect(parseBookingMessage("CONFIRMAR ABCD1234", "2026-10-21", services).confirmation).toBe(
      "abcd1234",
    );
    expect(parseBookingMessage("quero cancelar", "2026-10-21", services).stop).toBe(true);
    expect(parseBookingMessage("consulta para minha filha", "2026-10-21", services).handoff).toBe(
      true,
    );
  });

  it("minimiza o texto antes de enviá-lo ao extrator opcional", () => {
    const text = minimizeBookingText(
      "Me chamo Alice Pereira. Quero agendar limpeza amanhã às 14:30. Ligue em 5534999993322; CPF 123.456.789-01; sangramento intenso.",
      services,
    );
    expect(text).toContain("agendar limpeza amanha as 14:30");
    expect(text).not.toMatch(/alice|pereira|5534|456|sangramento/);
  });
});
