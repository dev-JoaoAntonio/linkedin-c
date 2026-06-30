import { NextResponse } from "next/server";
import { publishDuePosts } from "@/lib/scheduler";
import { errMessage } from "@/lib/http";

export const dynamic = "force-dynamic";
// Publicar pode levar alguns segundos por post; deixe a função respirar.
export const maxDuration = 60;

/**
 * Rota de cron: publica os posts SCHEDULED vencidos.
 * Protegida por CRON_SECRET. A Vercel injeta o header
 *   Authorization: Bearer <CRON_SECRET>
 * automaticamente quando a env CRON_SECRET existe. Agendadores externos
 * (ex.: GitHub Actions) devem mandar o mesmo header.
 *
 * Aceita GET (Vercel Cron) e POST (gatilhos externos).
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET não configurado." }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const summary = await publishDuePosts();
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({ error: errMessage(e, "Erro no cron.") }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
