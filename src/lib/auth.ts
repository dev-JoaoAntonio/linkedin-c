import { cookies } from "next/headers";
import crypto from "crypto";

// Sessão de usuário único, assinada com HMAC-SHA256 e guardada num cookie httpOnly.
// Não há banco de sessões: o cookie carrega só a expiração + assinatura.

const SESSION_COOKIE = "mesa_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET não configurado.");
  }
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", sessionSecret()).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Confere a senha de acesso (APP_PASSWORD) em tempo constante. */
export function verifyPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    throw new Error("APP_PASSWORD não configurado.");
  }
  return safeEqual(input, expected);
}

/** Cria a sessão e grava o cookie. Use dentro de route handler / server action. */
export function createSession(): void {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = String(expiresAt);
  const token = `${payload}.${sign(payload)}`;

  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/** Remove a sessão. */
export function destroySession(): void {
  cookies().delete(SESSION_COOKIE);
}

/** True se o cookie de sessão é válido e não expirou. */
export function isAuthed(): boolean {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  if (!raw) return false;

  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return false;

  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);

  if (!safeEqual(sig, sign(payload))) return false;

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  return true;
}
