import { NextResponse } from "next/server";
import { isAuthed } from "./auth";

/** Retorna 401 se não autenticado, ou null para seguir. Use no topo das rotas. */
export function guard(): NextResponse | null {
  if (!isAuthed()) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  return null;
}

/** Resposta de erro padronizada: { error } + status. */
export function fail(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Extrai a mensagem de um erro desconhecido. */
export function errMessage(e: unknown, fallback = "Erro inesperado."): string {
  return e instanceof Error ? e.message : fallback;
}
