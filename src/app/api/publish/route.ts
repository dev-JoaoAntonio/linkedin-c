import { NextResponse } from "next/server";
import { PostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishPost } from "@/lib/linkedin";
import { guard, fail, errMessage } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Publica AGORA (ação aprovada pelo humano). Aceita:
 *  - { text }         → publica e cria um Post PUBLISHED novo (composer).
 *  - { id, text }     → publica e marca um rascunho existente como PUBLISHED.
 * Em falha, se houver id, marca o post como FAILED + error e retorna 502.
 */
export async function POST(req: Request) {
  const denied = guard();
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    text?: string;
    id?: string;
    topic?: string;
  };
  const text = body.text?.trim();
  const id = body.id;
  if (!text) return fail("O texto do post está vazio.");

  try {
    const { id: urn } = await publishPost(text);

    const data = {
      content: text,
      status: PostStatus.PUBLISHED,
      linkedinId: urn,
      publishedAt: new Date(),
      error: null,
    };

    const post = id
      ? await prisma.post.update({ where: { id }, data })
      : await prisma.post.create({ data: { ...data, topic: body.topic ?? null } });

    return NextResponse.json({ post });
  } catch (e) {
    const msg = errMessage(e, "Erro ao publicar.");
    if (id) {
      await prisma.post
        .update({ where: { id }, data: { status: PostStatus.FAILED, error: msg } })
        .catch(() => {});
    }
    return fail(msg, 502);
  }
}
