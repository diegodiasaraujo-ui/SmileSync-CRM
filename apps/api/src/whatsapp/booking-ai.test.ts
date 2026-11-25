import { describe, expect, it, vi } from "vitest";
import { extractBookingWithAi } from "./booking-ai.js";

const input = {
  text: "agendar avaliação amanhã às 14h",
  localDate: "2026-11-24",
  timeZone: "America/Sao_Paulo",
  services: [{ name: "Avaliação", aliases: ["avaliação"] }],
};
const environment = {
  WHATSAPP_BOOKING_OPENAI_ENABLED: "true",
  WHATSAPP_BOOKING_OPENAI_MODEL: "test-model",
  OPENAI_API_KEY: "test-key",
};
const evidence = {
  intent: true,
  serviceQuote: "avaliação",
  dateQuote: "amanhã",
  timeQuote: "14h",
};

function reply(data: typeof evidence) {
  return Response.json({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(data) }] }],
  });
}

describe("extração opcional de agendamento", () => {
  it("não chama o provedor sem opt-in", async () => {
    const provider = vi.fn<typeof fetch>();
    expect(
      await extractBookingWithAi(input, provider, {
        ...environment,
        WHATSAPP_BOOKING_OPENAI_ENABLED: "false",
      }),
    ).toBe(null);
    expect(provider).not.toHaveBeenCalled();
  });

  it("usa saída estruturada sem armazenamento e exige citações literais", async () => {
    const provider = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(evidence))
      .mockResolvedValueOnce(reply({ ...evidence, timeQuote: "15h" }));
    expect(await extractBookingWithAi(input, provider, environment)).toEqual(evidence);
    expect(await extractBookingWithAi(input, provider, environment)).toBe(null);
    const body = JSON.parse(String(provider.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      store: false,
      model: "test-model",
      text: { format: { strict: true } },
    });
    expect(JSON.parse(body.input)).toEqual(input);
  });

  it("mantém o fluxo local quando a API está indisponível", async () => {
    const provider = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    expect(await extractBookingWithAi(input, provider, environment)).toBe(null);
  });
});
