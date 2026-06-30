# mesa

Console pessoal (usuário único) para **gerar posts com IA, revisar, agendar e publicar no LinkedIn**.

Fluxo: entro com senha → conecto o LinkedIn via OAuth → escrevo um tema → gero o texto → reviso/edito com pré-visualização da "dobra do feed" → **salvo como rascunho**, **posto agora** ou **agendo**. Posts agendados são publicados por um cron.

> **Humano no comando:** nada é publicado sem aprovação. Um post agendado é um rascunho que *eu* marquei para agendar — nunca texto cru da IA publicado sozinho.

---

## Stack

- **Next.js 14** (App Router) + **TypeScript strict**
- **Prisma** + **PostgreSQL**
- OpenAI e LinkedIn acessados via `fetch` (sem SDKs)
- Deploy em **Vercel** (agendamento via **Vercel Cron**)

---

## Setup

```bash
npm install                 # instala deps; roda `prisma generate` no postinstall
cp .env.example .env        # preencha os valores (veja abaixo)
npm run db:push             # cria as tabelas no banco (caminho rápido)
# ou: npm run db:migrate    # aplica as migrations versionadas (prisma/migrations)
npm run dev                 # http://localhost:3000
npm run build               # build de produção
```

### Variáveis de ambiente (`.env`)

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | Conexão PostgreSQL |
| `APP_PASSWORD` | Senha única de acesso ao console |
| `SESSION_SECRET` | Chave HMAC que assina o cookie de sessão |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | App do LinkedIn |
| `LINKEDIN_REDIRECT_URI` | Tem que bater com a "Authorized redirect URL" do app |
| `LINKEDIN_API_VERSION` | Versão da Posts API (formato `AAAAMM`). **Nunca** é hardcoded — vem daqui |
| `OPENAI_API_KEY` | Chave da OpenAI |
| `OPENAI_MODEL` | Modelo de geração (padrão `gpt-4o`) |
| `CRON_SECRET` | Protege a rota de cron (`/api/cron/publish`) |

Gere segredos aleatórios:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### App do LinkedIn

- Produtos: **Sign In with OpenID Connect** + **Share on LinkedIn** (escopo `w_member_social`).
- Escopos usados: `openid profile w_member_social`.
- Em **Auth → Authorized redirect URLs**, adicione exatamente o valor de `LINKEDIN_REDIRECT_URI`.
- O **token de acesso dura ~60 dias** e é renovado automaticamente dentro de `publishPost` (via refresh token, quando o app tem essa permissão). Se não houver refresh token válido, é só clicar em **Reconectar** no topo do console.

---

## Funcionalidades

### Compor
- **Gerar** com a OpenAI a partir de um tema (+ instruções extras), com system prompt anti-clichê.
- **Revisar/editar** com contador de caracteres (limite 3000) e **pré-visualização da dobra do feed** (o LinkedIn corta ~3 linhas e mostra "…ver mais").
- **Salvar rascunho**, **Postar agora** ou **Agendar**.

### Fila (rascunhos + agendados) — *Task 1 e 2*
- Lista de **rascunhos** e de **agendados**.
- Reabrir/editar/excluir; **desagendar** (volta a rascunho).
- Toda publicação passa por `publishPost` (validação/refresh do token + escape do `commentary`).

### Histórico — *Task 3*
- **Publicados**: data, trecho e link público (`https://www.linkedin.com/feed/update/<URN>/`, montado a partir do `linkedinId` salvo).
- **Falhas**: mensagem de erro visível (a Vercel não dá retry no cron — falha fica registrada). Dá para editar e tentar de novo.

---

## Agendamento e Cron

`scheduledAt` é guardado **em UTC**. A UI mostra e recebe horários em **America/Sao_Paulo** (Brasília) e a conversão acontece só na borda (`src/lib/datetime.ts`).

A publicação dos agendados é feita pela rota **`/api/cron/publish`**, que busca posts `SCHEDULED` com `scheduledAt <= agora` e publica cada um via `publishPost`, marcando `PUBLISHED` ou `FAILED` + `error`.

### Vercel Cron

`vercel.json`:

```json
{
  "crons": [{ "path": "/api/cron/publish", "schedule": "0 12 * * *" }]
}
```

- `0 12 * * *` = todo dia às **12:00 UTC** (= **09:00 em Brasília**). Para trocar o horário, edite o campo `schedule`.
- A Vercel injeta automaticamente o header `Authorization: Bearer <CRON_SECRET>` nos crons **quando a env `CRON_SECRET` existe** no projeto. Configure `CRON_SECRET` nas Environment Variables da Vercel.

> ⚠️ **Limite do plano grátis (Hobby):** o cron roda **1x por dia**, sempre em **UTC**, e **sem retry**. Ou seja, no Hobby um post agendado para hoje só será publicado na próxima execução diária do cron (não no minuto exato). Projete o agendamento pensando nisso.

### Cadência mais fina (agendador externo)

Para publicar de hora em hora (ou mais), use um agendador externo batendo na mesma rota. Exemplo com **GitHub Actions** (`.github/workflows/cron.yml`):

```yaml
name: publish-scheduled
on:
  schedule:
    - cron: "*/30 * * * *"   # a cada 30 min (UTC)
  workflow_dispatch:
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST "https://SEU-DOMINIO/api/cron/publish" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

(Defina `CRON_SECRET` em *Settings → Secrets* do repositório, igual ao da Vercel.)

### Testar o cron localmente

A Vercel só executa cron em produção. Localmente há duas formas:

1. **Botão de dev:** na aba **Fila** aparece **"▶ Rodar agendador (dev)"** (só fora de produção). Ele chama `/api/dev/run-cron`, que roda a mesma lógica.
2. **curl** direto na rota protegida:

```bash
curl -X POST http://localhost:3000/api/cron/publish \
  -H "Authorization: Bearer SEU_CRON_SECRET"
```

---

## Modelo de dados (Prisma)

- **`LinkedInAccount`** — linha única (`id = "primary"`): tokens, expirações, `memberId`.
- **`Post`** — `content`, `status` (`DRAFT | SCHEDULED | PUBLISHED | FAILED`), `topic?`, `scheduledAt?` (UTC), `publishedAt?`, `linkedinId?` (URN), `error?`, timestamps.

Migrations versionadas em `prisma/migrations/`. Como o projeto nasceu já com esses campos, há uma única migration inicial (`0001_init`). Mudanças futuras de schema devem gerar nova migration (`npm run db:migrate:dev`).

---

## Segurança

- Toda rota de API sensível chama `isAuthed()` no topo (401 se falhar).
- Sessão = cookie httpOnly assinado com HMAC (`src/lib/auth.ts`); sem banco de sessões.
- OAuth do LinkedIn com `state` anti-CSRF.
- Segredos só em variáveis de ambiente. Tokens e chaves **nunca** são logados. `.env` não é commitado.

---

## Estrutura

```
prisma/
  schema.prisma
  migrations/0001_init/migration.sql
src/
  lib/
    auth.ts          # sessão HMAC: isAuthed, createSession, verifyPassword
    prisma.ts        # singleton do PrismaClient
    linkedin.ts      # OAuth, refresh de token, publishPost, escape do commentary
    openai.ts        # generatePost (anti-clichê)
    datetime.ts      # conversões UTC <-> America/Sao_Paulo
    scheduler.ts     # publishDuePosts (usado pelo cron e pelo gatilho de dev)
    http.ts          # guard() / fail() / errMessage()
  app/
    layout.tsx, globals.css, page.tsx, login.tsx, console.tsx
    api/
      auth/{login,logout,linkedin,linkedin/callback}/route.ts
      generate/route.ts
      publish/route.ts
      drafts/route.ts            # listar (fila) + criar
      drafts/[id]/route.ts       # obter / atualizar / agendar / excluir
      posts/route.ts             # histórico (publicados + falhas)
      cron/publish/route.ts      # cron protegido por CRON_SECRET
      dev/run-cron/route.ts      # gatilho só-de-dev
vercel.json
```
