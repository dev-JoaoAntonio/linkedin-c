import { NextResponse } from "next/server";
import { PostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publicUrlFromUrn } from "@/lib/linkedin";
import { guard } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Histórico: posts PUBLISHED (com link público) e FAILED (com a mensagem de erro). */
export async function GET() {
  const denied = guard();
  if (denied) return denied;

  const posts = await prisma.post.findMany({
    where: { status: { in: [PostStatus.PUBLISHED, PostStatus.FAILED] } },
    orderBy: { updatedAt: "desc" },
  });

  const withUrl = posts.map((p) => ({
    ...p,
    url: p.linkedinId ? publicUrlFromUrn(p.linkedinId) : null,
  }));

  return NextResponse.json({ posts: withUrl });
}
