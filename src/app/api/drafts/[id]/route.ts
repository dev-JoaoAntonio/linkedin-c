import { NextResponse } from "next/server";
import { Prisma, PostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { guard, fail, errMessage } from "@/lib/http";
import { spWallTimeToUtc } from "@/lib/datetime";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** Obter um post pelo id. */
export async function GET(_req: Request, { params }: Ctx) {
  const denied = guard();
  if (denied) return denied;

  const post = await prisma.post.findUnique({ where: { id: params.id } });
  if (!post) return fail("Post não encontrado.", 404);
  return NextResponse.json({ post });
}

/**
 * Atualiza conteúdo/tema e/ou agenda. Campo `scheduledAt`:
 *   - string "YYYY-MM-DDTHH:mm" (horário de São Paulo) → status SCHEDULED (em UTC);
 *   - null                                              → volta a DRAFT.
 * Não permite editar um post já PUBLISHED.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const denied = guard();
  if (denied) return denied;

  try {
    const existing = await prisma.post.findUnique({ where: { id: params.id } });
    if (!existing) return fail("Post não encontrado.", 404);
    if (existing.status === PostStatus.PUBLISHED) {
      return fail("Um post já publicado não pode ser editado.", 409);
    }

    const body = (await req.json().catch(() => ({}))) as {
      content?: string;
      topic?: string | null;
      scheduledAt?: string | null;
    };

    const data: Prisma.PostUpdateInput = {};

    if (typeof body.content === "string") {
      const content = body.content.trim();
      if (!content) return fail("O conteúdo está vazio.");
      data.content = content;
    }

    if (body.topic !== undefined) {
      data.topic = typeof body.topic === "string" && body.topic.trim() ? body.topic.trim() : null;
    }

    if (body.scheduledAt !== undefined) {
      if (body.scheduledAt === null) {
        data.status = PostStatus.DRAFT;
        data.scheduledAt = null;
        data.error = null;
      } else {
        const when = spWallTimeToUtc(String(body.scheduledAt));
        if (when.getTime() <= Date.now()) {
          return fail("O horário de agendamento precisa ser no futuro.");
        }
        data.status = PostStatus.SCHEDULED;
        data.scheduledAt = when;
        data.error = null;
      }
    }

    if (Object.keys(data).length === 0) {
      return fail("Nada para atualizar.");
    }

    // Editar um post FAILED (sem reagendar) o devolve para rascunho.
    if (existing.status === PostStatus.FAILED && data.status === undefined) {
      data.status = PostStatus.DRAFT;
      data.error = null;
    }

    const post = await prisma.post.update({ where: { id: params.id }, data });
    return NextResponse.json({ post });
  } catch (e) {
    return fail(errMessage(e, "Erro ao atualizar o post."), 400);
  }
}

/** Apaga um post (rascunho, agendado ou histórico). */
export async function DELETE(_req: Request, { params }: Ctx) {
  const denied = guard();
  if (denied) return denied;

  try {
    await prisma.post.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return fail("Post não encontrado.", 404);
  }
}
