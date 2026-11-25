import { useEffect, useRef, useState, type FormEvent } from "react";
import { FlaskConical, MessageCircle, Send } from "lucide-react";
import { Button, Panel, inputClass } from "./ui";

type SimulationMessage = {
  id: number;
  text: string;
  direction: "inbound" | "outbound";
  delivered?: boolean;
};

const scenarios = [
  {
    name: "Marina Costa · personagem fictícia",
    description: "Pedido de avaliação",
    question: "Olá! Gostaria de marcar uma avaliação. Quais horários vocês têm?",
    reply: "Pode ser no período da manhã. Obrigada!",
  },
  {
    name: "Rafael Mendes · personagem fictício",
    description: "Confirmação de consulta",
    question: "Bom dia! Quero confirmar minha consulta da próxima semana.",
    reply: "Entendi. Obrigado pela confirmação!",
  },
];

export function WhatsAppSimulation() {
  const [current, setCurrent] = useState(0);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
        <FlaskConical aria-hidden="true" size={18} />
        Modo de apresentação. As mensagens abaixo são simuladas.
      </div>
      <Panel className="grid lg:grid-cols-[minmax(245px,31%)_minmax(0,1fr)]">
        <aside
          className="border-b border-border lg:border-r lg:border-b-0"
          aria-label="Conversas fictícias"
        >
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
            Conversas fictícias
          </h2>
          <ul className="divide-y divide-border">
            {scenarios.map((scenario, index) => (
              <li key={scenario.name}>
                <button
                  type="button"
                  aria-pressed={current === index}
                  className={`flex w-full gap-3 border-l-2 px-4 py-3 text-left hover:bg-secondary ${current === index ? "border-primary bg-secondary" : "border-transparent"}`}
                  onClick={() => setCurrent(index)}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-primary">
                    <MessageCircle aria-hidden="true" size={17} />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{scenario.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {scenario.description}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <SimulationThread key={current} scenario={scenarios[current]!} />
      </Panel>
    </div>
  );
}

function SimulationThread({ scenario }: { scenario: (typeof scenarios)[number] }) {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<SimulationMessage[]>([
    { id: 0, text: scenario.question, direction: "inbound" },
  ]);
  const nextId = useRef(1);
  const history = useRef<HTMLOListElement>(null);
  const pendingDelivery = messages.some(
    (message) => message.direction === "outbound" && !message.delivered,
  );

  useEffect(() => {
    if (history.current) history.current.scrollTop = history.current.scrollHeight;
  }, [messages.length]);

  function addMessage(content: string, direction: SimulationMessage["direction"]) {
    const id = nextId.current++;
    setMessages((previous) => [...previous, { id, text: content, direction }]);
  }

  function sendSimulation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    addMessage(text.trim(), "outbound");
    setText("");
  }

  return (
    <section aria-label="Conversa simulada" className="flex min-w-0 flex-col bg-background/55">
      <header className="border-b border-border bg-card px-4 py-3">
        <h2 className="text-sm font-semibold">{scenario.name}</h2>
        <p className="mt-1 text-xs font-medium text-amber-800">Conversa de simulação</p>
      </header>
      <ol
        ref={history}
        aria-live="polite"
        tabIndex={0}
        aria-label="Mensagens simuladas"
        className="min-h-44 max-h-[44dvh] flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6"
      >
        {messages.map((message) => (
          <li
            key={message.id}
            className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[min(85%,32rem)] rounded-xl border px-3.5 py-2.5 shadow-panel ${message.direction === "outbound" ? "border-primary/20 bg-secondary" : "border-border bg-card"}`}
            >
              <p className="break-words whitespace-pre-wrap text-sm">{message.text}</p>
              <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">
                {message.direction === "inbound"
                  ? "Recebimento simulado"
                  : message.delivered
                    ? "Entrega simulada"
                    : "Envio simulado"}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <form onSubmit={sendSimulation} className="space-y-3 border-t border-border bg-card p-4">
        <label className="grid gap-1.5 text-[13px] font-medium">
          Mensagem fictícia
          <textarea
            className={`${inputClass} min-h-20 resize-y`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={4096}
            placeholder="Escreva uma mensagem para simular o envio"
          />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            disabled={!pendingDelivery}
            onClick={() =>
              setMessages((previous) =>
                previous.map((message) =>
                  message.direction === "outbound" ? { ...message, delivered: true } : message,
                ),
              )
            }
          >
            Simular entrega
          </Button>
          <Button variant="secondary" onClick={() => addMessage(scenario.reply, "inbound")}>
            Simular recebimento
          </Button>
          <Button type="submit" disabled={!text.trim()}>
            <Send size={16} /> Simular envio
          </Button>
        </div>
      </form>
    </section>
  );
}
