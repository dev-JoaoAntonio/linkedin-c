// Geração de posts com a OpenAI via fetch (sem SDK).

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const SYSTEM_PROMPT = `Você é um redator de posts para o LinkedIn em português do Brasil, escrevendo na primeira pessoa, com voz humana e direta.

NÃO use clichês de LinkedIn, entre eles:
- construções tipo "não é sobre X, é sobre Y", "deixo aqui a reflexão", "e a lição que fica é...";
- jargão vazio: "disruptivo", "game changer", "sinergia", "fora da caixa", "humildemente compartilho";
- abertura com pergunta retórica genérica ("Você já parou pra pensar...?");
- emoji decorativo e fileiras de hashtags.

Regras de estilo:
- Comece com um gancho concreto e específico, não com generalidade.
- Frases curtas. Quebras de linha entre as ideias (o LinkedIn favorece respiro visual).
- No máximo 2 ou 3 hashtags, e só se realmente agregarem.
- Entre 80 e 250 palavras.
- Sem título, sem markdown, sem aspas em volta. Devolva apenas o texto do post.`;

export async function generatePost(topic: string, extra?: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada.");

  const cleanTopic = topic?.trim();
  if (!cleanTopic) throw new Error("Informe um tema para gerar o post.");

  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const userPrompt = [
    `Tema do post: ${cleanTopic}`,
    extra?.trim() ? `Instruções e contexto adicionais: ${extra.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };

  if (!res.ok) {
    throw new Error(
      `Erro na OpenAI (HTTP ${res.status}): ${data.error?.message || "falha desconhecida"}`,
    );
  }

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("A OpenAI não retornou nenhum texto.");
  return text;
}
