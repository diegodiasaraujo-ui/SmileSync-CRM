export type BookingServiceTerms = {
  id: string;
  name: string;
  aliases: readonly string[];
};

type ParsedField = { value: string | null; attempted: boolean };
const weekdays = [
  "domingo",
  "segunda(?:[- ]feira)?",
  "terca(?:[- ]feira)?",
  "quarta(?:[- ]feira)?",
  "quinta(?:[- ]feira)?",
  "sexta(?:[- ]feira)?",
  "sabado",
];

export function foldBookingText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

export function localBookingDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"]
    .map((key) => parts.find((part) => part.type === key)?.value)
    .join("-");
}

function calendarDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200) return null;
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() + 1 !== month ||
    value.getUTCDate() !== day
  )
    return null;
  return value.toISOString().slice(0, 10);
}

function calendarDay(localDate: string, offset = 0): Date {
  const day = new Date(localDate + "T00:00:00Z");
  day.setUTCDate(day.getUTCDate() + offset);
  return day;
}

function singleField(candidates: Array<string | null>, attempted = false): ParsedField {
  const unique = new Set(candidates);
  return {
    value: unique.size === 1 ? (candidates[0] ?? null) : null,
    attempted: attempted || candidates.length > 0,
  };
}

export function parseBookingDate(text: string, localDate: string): ParsedField {
  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
  const brazilian = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  const candidates: Array<string | null> = [];
  for (const match of text.matchAll(iso))
    candidates.push(calendarDate(Number(match[1]), Number(match[2]), Number(match[3])));
  for (const match of text.matchAll(brazilian)) {
    // A date without a year refers to this local calendar year. Ask for an
    // explicit year if it would be in the past; never silently roll forward.
    candidates.push(
      calendarDate(Number(match[3] ?? localDate.slice(0, 4)), Number(match[2]), Number(match[1])),
    );
  }

  for (const match of text.matchAll(/\b(depois de amanha|amanha|hoje)\b/g)) {
    const offset = match[1] === "depois de amanha" ? 2 : match[1] === "amanha" ? 1 : 0;
    candidates.push(calendarDay(localDate, offset).toISOString().slice(0, 10));
  }
  const reference = calendarDay(localDate);
  for (let index = 0; index < weekdays.length; index++) {
    const expression = new RegExp(
      "\\b(?:(proxim[oa]) )?(?:" + weekdays[index] + ")(?: (que vem))?\\b",
      "g",
    );
    for (const match of text.matchAll(expression)) {
      // Accept a matching weekday alongside one explicit date.
      if (candidates.length === 1 && candidates[0] && !match[1] && !match[2]) {
        candidates.push(calendarDay(candidates[0]).getUTCDay() === index ? candidates[0] : null);
      } else {
        const offset = (index + 7 - reference.getUTCDay()) % 7;
        candidates.push(
          calendarDay(localDate, offset || (match[1] || match[2] ? 7 : 0))
            .toISOString()
            .slice(0, 10),
        );
      }
    }
  }
  return singleField(candidates, /\b(?:dia \d{1,2}|semana que vem|mes que vem)\b/.test(text));
}

export function parseBookingTime(text: string): ParsedField {
  const candidates: Array<string | null> = [];
  const spans =
    /\b(as\s+)?(\d{1,2})(?:(?::|h)(\d{1,2})|(\s*h(?:oras?)?))?(\s+(?:da (?:manha|tarde|noite)|am|pm))?\b/g;
  for (const match of text.matchAll(spans)) {
    const [, prefix, hours, minutes, suffix, period] = match;
    if (!prefix && minutes === undefined && !suffix && !period) continue;
    if (!hours) continue;
    let hour = Number(hours);
    const minute = Number(minutes ?? "0");
    const part = period?.trim();
    if (part) {
      if (hour < 1 || hour > 12 || (part.startsWith("da ") && hour === 12)) {
        candidates.push(null);
        continue;
      }
      if (hour === 12) hour = 0;
      if (["da tarde", "da noite", "pm"].includes(part)) hour += 12;
    }
    candidates.push(
      hour <= 23 && minute <= 59
        ? String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0")
        : null,
    );
  }
  return singleField(candidates, /\b(?:manha|tarde|noite|meio[- ]dia|a partir das)\b/.test(text));
}

function serviceField(text: string, services: readonly BookingServiceTerms[]): ParsedField {
  const subject = " " + text.replace(/[^a-z0-9]+/g, " ").trim() + " ";
  return singleField(
    services
      .filter((service) =>
        [service.name, ...service.aliases].some((alias) => {
          const key = foldBookingText(alias)
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
          return key.length >= 2 && subject.includes(" " + key + " ");
        }),
      )
      .map((service) => service.id),
  );
}

export function parseBookingMessage(
  message: string,
  localDate: string,
  services: readonly BookingServiceTerms[],
) {
  const text = foldBookingText(message);
  const named = text.match(
    /\b(?:meu nome e|me chamo|sou o|sou a)\s+([a-z]+(?:\s+[a-z]+){0,7}?)(?=[,.;!?]|$|\s+(?:e (?:quero|gostaria|preciso)|quero|gostaria|preciso|para|e sou|amanha|hoje|as)\b)/,
  );
  return {
    text,
    name: named?.[1] ?? null,
    handoff:
      /\b(?:para (?:meu|minha|outra|outro)|em nome de|urgencia|emergencia|humano|atendente)\b/.test(
        text,
      ),
    stop: /\b(?:desmarcar|cancelar|reagendar|remarcar|nao (?:quero|posso|confirmo|consigo|vou))\b|^nao[.!]?$/.test(
      text,
    ),
    confirmation: /^confirmar\s+([a-f0-9]{8})$/.exec(text)?.[1] ?? null,
    asksToBook:
      /\b(?:agend[a-z]*|marcar|marcacao|reservar|encaix[a-z]*|(?:quero|gostaria|preciso) (?:de )?(?:uma )?consulta)\b/.test(
        text,
      ),
    date: parseBookingDate(text, localDate),
    time: parseBookingTime(text),
    service: serviceField(text, services),
  };
}

const schedulingWords = new Set(
  "quero gostaria preciso posso poderia tem teria e de da do por pra para um uma com meu minha consulta horario vaga disponibilidade dia amanha hoje depois proximo proxima que vem manha tarde noite segunda terca quarta quinta sexta sabado domingo feira agendar marcar reservar visita fazer encaixe semana mes as nao sim".split(
    " ",
  ),
);

/** Only booking vocabulary and constrained date/time formats reach the model. */
export function minimizeBookingText(
  message: string,
  services: readonly BookingServiceTerms[],
): string {
  const text = foldBookingText(message).replace(
    /\b(?:meu nome e|me chamo|sou o|sou a)\s+[^,.;!?]*/,
    " ",
  );
  const allowed = new Set(schedulingWords);
  for (const service of services)
    for (const term of [service.name, ...service.aliases])
      for (const word of foldBookingText(term).match(/[a-z]+/g) ?? []) allowed.add(word);
  const dateTime =
    /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{4})?|\d{1,2}(?::[0-5]\d|h(?:[0-5]\d)?)|\d{1,2}\s+horas?)\b/g;
  const safeText = text
    .replace(dateTime, (match) => " \x00" + match.replace(/\s+/g, "_") + "\x00 ")
    .match(/\x00[^\x00]+\x00|[a-z]+/g);
  return (safeText ?? [])
    .map((word) => {
      if (word.startsWith("\x00")) return word.slice(1, -1).replaceAll("_", " ");
      return allowed.has(word) ? word : " ";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 350);
}

export function verifiedServiceQuote(
  quote: string | null,
  original: string,
  services: readonly BookingServiceTerms[],
) {
  if (!quote || !original.includes(foldBookingText(quote))) return null;
  return serviceField(foldBookingText(quote), services).value;
}
