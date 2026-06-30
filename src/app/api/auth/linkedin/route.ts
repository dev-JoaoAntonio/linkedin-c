import { NextResponse } from "next/server";
import crypto from "crypto";
import { isAuthed } from "@/lib/auth";
import { buildAuthorizationUrl } from "@/lib/linkedin";
import { errMessage } from "@/lib/http";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "li_oauth_state";

/** Inicia o OAuth do LinkedIn: gera state anti-CSRF e redireciona. */
export async function GET() {
  if (!isAuthed()) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  try {
    const state = crypto.randomBytes(16).toString("hex");
    const url = buildAuthorizationUrl(state);

    const res = NextResponse.redirect(url);
    res.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600, // 10 min
    });
    return res;
  } catch (e) {
    // Falta de env (client id/redirect) cai aqui.
    return NextResponse.json({ error: errMessage(e, "Erro ao iniciar o OAuth.") }, { status: 500 });
  }
}
