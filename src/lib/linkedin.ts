import type { LinkedInAccount } from "@prisma/client";
import { prisma } from "./prisma";

// ── Endpoints ──────────────────────────────────────────────────────────────
const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const POSTS_URL = "https://api.linkedin.com/rest/posts";

// w_member_social = publicar; openid+profile = obter o id do membro (sub) e o nome.
export const LINKEDIN_SCOPES = "openid profile w_member_social";

// Limite de caracteres do "commentary" no LinkedIn.
const COMMENTARY_MAX = 3000;
// Renova o token se faltar menos que isso para expirar.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ${name} não configurada.`);
  return v;
}

// ── OAuth ────────────────────────────────────────────────────────────────────

/** Monta a URL de autorização do LinkedIn (com state anti-CSRF). */
export function buildAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: requireEnv("LINKEDIN_CLIENT_ID"),
    redirect_uri: requireEnv("LINKEDIN_REDIRECT_URI"),
    state,
    scope: LINKEDIN_SCOPES,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok) {
    // Nunca logamos client_secret nem tokens.
    throw new Error(
      `Erro no token do LinkedIn (HTTP ${res.status}): ${
        data.error_description || data.error || "falha desconhecida"
      }`,
    );
  }
  return data as unknown as TokenResponse;
}

async function fetchUserinfo(accessToken: string): Promise<{ sub: string; name?: string }> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Não foi possível obter o perfil do LinkedIn (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as { sub: string; name?: string };
  if (!data.sub) throw new Error("Resposta do LinkedIn sem identificador do membro (sub).");
  return data;
}

/** Troca o `code` do callback por tokens, busca o perfil e salva a conta única. */
export async function connectFromCallback(code: string): Promise<void> {
  const token = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: requireEnv("LINKEDIN_REDIRECT_URI"),
    client_id: requireEnv("LINKEDIN_CLIENT_ID"),
    client_secret: requireEnv("LINKEDIN_CLIENT_SECRET"),
  });

  const profile = await fetchUserinfo(token.access_token);

  const now = Date.now();
  const expiresAt = new Date(now + token.expires_in * 1000);
  const refreshExpiresAt = token.refresh_token_expires_in
    ? new Date(now + token.refresh_token_expires_in * 1000)
    : null;

  const data = {
    memberId: profile.sub,
    name: profile.name ?? null,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt,
    refreshExpiresAt,
    scope: token.scope ?? LINKEDIN_SCOPES,
  };

  await prisma.linkedInAccount.upsert({
    where: { id: "primary" },
    update: data,
    create: { id: "primary", ...data },
  });
}

export function getAccount() {
  return prisma.linkedInAccount.findUnique({ where: { id: "primary" } });
}

/**
 * Garante um access token válido. Renova via refresh_token quando perto de
 * expirar. Toda a lógica de renovação mora aqui — não duplique em outro lugar.
 */
async function ensureFreshToken(account: LinkedInAccount): Promise<string> {
  const now = Date.now();
  if (account.expiresAt.getTime() - REFRESH_BUFFER_MS > now) {
    return account.accessToken;
  }

  const canRefresh =
    account.refreshToken &&
    (!account.refreshExpiresAt || account.refreshExpiresAt.getTime() > now);

  if (!canRefresh || !account.refreshToken) {
    throw new Error(
      "O acesso ao LinkedIn expirou e não há refresh token válido. Reconecte sua conta.",
    );
  }

  const token = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: account.refreshToken,
    client_id: requireEnv("LINKEDIN_CLIENT_ID"),
    client_secret: requireEnv("LINKEDIN_CLIENT_SECRET"),
  });

  const updated = await prisma.linkedInAccount.update({
    where: { id: account.id },
    data: {
      accessToken: token.access_token,
      expiresAt: new Date(now + token.expires_in * 1000),
      // O LinkedIn pode (ou não) rotacionar o refresh token.
      refreshToken: token.refresh_token ?? account.refreshToken,
      refreshExpiresAt: token.refresh_token_expires_in
        ? new Date(now + token.refresh_token_expires_in * 1000)
        : account.refreshExpiresAt,
      scope: token.scope ?? account.scope,
    },
  });

  return updated.accessToken;
}

// ── Publicação ───────────────────────────────────────────────────────────────

/**
 * Escapa os caracteres reservados do "commentary" (Little Text Format do
 * LinkedIn). Cada reservado é prefixado com "\". A barra invertida é tratada
 * na mesma passada, então não há risco de escapar duas vezes.
 */
export function escapeCommentary(text: string): string {
  return text.replace(/[\\|{}@\[\]()<>#*_~]/g, (c) => `\\${c}`);
}

/** Monta a URL pública de um post a partir do URN salvo em linkedinId. */
export function publicUrlFromUrn(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}/`;
}

/**
 * Publica `text` no LinkedIn via Posts API. Cuida de token (validação/refresh)
 * e do escape do commentary. TODO caminho de publicação deve passar por aqui.
 * Retorna o URN do post (header x-restli-id).
 */
export async function publishPost(text: string): Promise<{ id: string }> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("O texto do post está vazio.");
  if (trimmed.length > COMMENTARY_MAX) {
    throw new Error(`O texto excede o limite de ${COMMENTARY_MAX} caracteres do LinkedIn.`);
  }

  const account = await getAccount();
  if (!account) throw new Error("Conecte sua conta do LinkedIn antes de publicar.");

  const accessToken = await ensureFreshToken(account);

  const body = {
    author: `urn:li:person:${account.memberId}`,
    commentary: escapeCommentary(trimmed),
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  const res = await fetch(POSTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": requireEnv("LINKEDIN_API_VERSION"),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    let detail = "";
    try {
      const errBody = await res.json();
      detail = errBody?.message || JSON.stringify(errBody);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`Falha ao publicar no LinkedIn (HTTP ${res.status}): ${detail || "sem detalhes"}`);
  }

  const id = res.headers.get("x-restli-id") ?? "";
  return { id };
}
