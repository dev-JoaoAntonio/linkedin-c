import { NextResponse } from "next/server";
import { PostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { guard, fail, errMessage } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Lista a fila de trabalho: rascunhos (DRAFT) e agendados (SCHEDULED). */
export async function GET() {
  const denied = guard();
  if (denied) return denied;

  const drafts = await prisma.post.findMany({
    where: { status: { in: [PostStatus.DRAFT, PostStatus.SCHEDULED] } },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ drafts });
}

/** Cria um rascunho a partir do texto (gerado ou escrito). */
export async function POST(req: Request) {
  const denied = guard();
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => ({}))) as { content?: string; topic?: string };
    const content = body.content?.trim();
    if (!content) return fail("O rascunho está vazio.");

    const draft = await prisma.post.create({
      data: { content, topic: body.topic?.trim() || null, status: PostStatus.DRAFT },
    });
    return NextResponse.json({ draft }, { status: 201 });
  } catch (e) {
    return fail(errMessage(e, "Erro ao salvar o rascunho."), 500);
  }
}
