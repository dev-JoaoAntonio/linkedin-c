import { NextResponse } from "next/server";
import { verifyPassword, createSession } from "@/lib/auth";
import { fail, errMessage } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { password?: unknown };
    const password = body.password;
    if (typeof password !== "string" || !verifyPassword(password)) {
      return fail("Senha incorreta.", 401);
    }
    createSession();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(errMessage(e, "Erro ao autenticar."), 500);
  }
}
