import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { connectFromCallback } from "@/lib/linkedin";
import { errMessage } from "@/lib/http";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "li_oauth_state";

/** Callback do OAuth: valida o state, troca o code por tokens e salva a conta. */
export async function GET(req: NextRequest) {
  const home = (params: Record<string, string>) => {
    const url = new URL("/", req.url);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = NextResponse.redirect(url);
    res.cookies.delete(STATE_COOKIE);
    return res;
  };

  if (!isAuthed()) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  if (oauthError) {
    return home({ li: "error", reason: searchParams.get("error_description") || oauthError });
  }

  const savedState = req.cookies.get(STATE_COOKIE)?.value;
  if (!state || !savedState || state !== savedState) {
    return home({ li: "error", reason: "Falha na verificação de segurança (state). Tente de novo." });
  }
  if (!code) {
    return home({ li: "error", reason: "Código de autorização ausente." });
  }

  try {
    await connectFromCallback(code);
    return home({ li: "connected" });
  } catch (e) {
    return home({ li: "error", reason: errMessage(e, "Não foi possível conectar ao LinkedIn.") });
  }
}
