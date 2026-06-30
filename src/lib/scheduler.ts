import { PostStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { publishPost } from "./linkedin";
import { errMessage } from "./http";

export interface PublishRunResult {
  processed: number;
  published: number;
  failed: number;
  results: Array<{ id: string; status: "PUBLISHED" | "FAILED"; urn?: string; error?: string }>;
}

/**
 * Publica todos os posts SCHEDULED cujo scheduledAt já passou. Publica via
 * publishPost (caminho único) e grava PUBLISHED ou FAILED+error em cada um.
 * Como a Vercel não dá retry no cron, as falhas ficam registradas e visíveis.
 * Usado tanto pela rota de cron quanto pelo gatilho de dev.
 */
export async function publishDuePosts(now: Date = new Date()): Promise<PublishRunResult> {
  const due = await prisma.post.findMany({
    where: { status: PostStatus.SCHEDULED, scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
  });

  const results: PublishRunResult["results"] = [];

  for (const post of due) {
    try {
      const { id: urn } = await publishPost(post.content);
      await prisma.post.update({
        where: { id: post.id },
        data: {
          status: PostStatus.PUBLISHED,
          linkedinId: urn,
          publishedAt: new Date(),
          error: null,
        },
      });
      results.push({ id: post.id, status: "PUBLISHED", urn });
    } catch (e) {
      const error = errMessage(e, "Erro ao publicar.");
      await prisma.post.update({
        where: { id: post.id },
        data: { status: PostStatus.FAILED, error },
      });
      results.push({ id: post.id, status: "FAILED", error });
    }
  }

  return {
    processed: due.length,
    published: results.filter((r) => r.status === "PUBLISHED").length,
    failed: results.filter((r) => r.status === "FAILED").length,
    results,
  };
}
