import { NextResponse } from "next/server";
import { generatePost } from "@/lib/openai";
import { guard, fail, errMessage } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = guard();
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => ({}))) as { topic?: string; extra?: string };
    if (!body.topic?.trim()) return fail("Informe um tema para gerar o post.");
    const text = await generatePost(body.topic, body.extra);
    return NextResponse.json({ text });
  } catch (e) {
    return fail(errMessage(e, "Erro ao gerar o post."), 502);
  }
}
