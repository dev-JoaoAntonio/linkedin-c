// Conversões de fuso. Regra do projeto: guardamos tudo em UTC no banco e só
// convertemos para America/Sao_Paulo na borda (UI). Brasil não tem mais horário
// de verão, mas usamos Intl para ser robusto a mudanças de regra de fuso.

export const TIMEZONE = "America/Sao_Paulo";

/** Minutos que o fuso está adiantado em relação ao UTC, naquele instante. */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const m: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") m[p.type] = Number(p.value);
  }
  const asUTC = Date.UTC(m.year, m.month - 1, m.day, m.hour, m.minute, m.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

/**
 * Recebe uma string "YYYY-MM-DDTHH:mm" representando horário de PAREDE em
 * São Paulo (o que o usuário digitou) e devolve o instante correto em UTC.
 */
export function spWallTimeToUtc(local: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!match) {
    throw new Error("Data/hora inválida. Use o seletor de data e hora.");
  }
  const [, y, mo, d, h, mi] = match.map(Number);
  // 'guess' trata os componentes como se fossem UTC.
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = tzOffsetMinutes(new Date(guess), TIMEZONE);
  // parede = utc + offset  =>  utc = parede - offset ; e 'guess' é parede-como-UTC.
  return new Date(guess - offset * 60000);
}

/** Date (UTC) -> "YYYY-MM-DDTHH:mm" em horário de São Paulo, p/ <input datetime-local>. */
export function utcToSpInputValue(date: Date): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") m[p.type] = p.value;
  }
  return `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}`;
}

/** Date (UTC) -> texto pt-BR legível em São Paulo (ex.: "30/06/2026 14:30"). */
export function formatSpDateTime(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
