import { NextResponse } from "next/server";
import { publishDuePosts } from "@/lib/scheduler";
import { guard, fail, errMessage } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Gatilho só-de-desenvolvimento: roda a MESMA lógica do cron sem precisar do
 * CRON_SECRET (a Vercel só executa cron em produção). Bloqueado em produção.
 * Exige sessão logada.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return fail("Indisponível em produção. Use o cron com CRON_SECRET.", 403);
  }
  const denied = guard();
  if (denied) return denied;

  try {
    const summary = await publishDuePosts();
    return NextResponse.json(summary);
  } catch (e) {
    return fail(errMessage(e, "Erro ao rodar o agendador."), 500);
  }
}
