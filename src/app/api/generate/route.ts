import { NextResponse } from "next/server";
import { generatePost, generateAutoPost } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { guard, fail, errMessage } from "@/lib/http";

export const dynamic = "force-dynamic";
// A web search pode levar alguns segundos; damos folga ao serverless.
export const maxDuration = 60;

/** Assuntos recentes (qualquer status) para a IA não repetir tema nem texto. */
async function recentSubjects(): Promise<string[]> {
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { topic: true, content: true },
  });
  return posts.map((p) => {
    const head = p.content.replace(/\s+/g, " ").trim().slice(0, 90);
    return p.topic?.trim() ? `${p.topic.trim()} — ${head}` : head;
  });
}

export async function POST(req: Request) {
  const denied = guard();
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      topic?: string;
      extra?: string;
      recent?: string[];
    };
    const topic = body.topic?.trim();

    // Com tema: geração dirigida. Sem tema: research automático das novidades.
    if (topic) {
      const text = await generatePost(topic, body.extra);
      return NextResponse.json({ text, topic });
    }

    // Evitar repetição: assuntos salvos no banco + os gerados nesta sessão.
    const fromClient = Array.isArray(body.recent) ? body.recent : [];
    const avoid = [...fromClient, ...(await recentSubjects())];

    const auto = await generateAutoPost({ extra: body.extra, avoid });
    return NextResponse.json({ text: auto.text, topic: auto.topic });
  } catch (e) {
    return fail(errMessage(e, "Erro ao gerar o post."), 502);
  }
}
