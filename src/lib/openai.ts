// Geração de posts com a OpenAI via fetch (sem SDK).
//
// Dois caminhos:
//  - generatePost(topic): tema informado por você. Usa chat/completions.
//  - generateAutoPost(): sem tema. Faz web research das novidades de tech/dev
//    via Responses API + ferramenta web_search e escreve o post sozinho.

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const RESPONSES_URL = "https://api.openai.com/v1/responses";

// A ferramenta web_search NÃO funciona com gpt-4o — exige GPT-5 / gpt-4.1.
// Modelo da pesquisa é separado do de geração simples (OPENAI_MODEL).
const DEFAULT_SEARCH_MODEL = "gpt-4.1";

const SYSTEM_PROMPT = `Você escreve posts de LinkedIn em português do Brasil, na primeira pessoa. O objetivo é soar como uma pessoa real de tecnologia escrevendo rápido entre uma tarefa e outra — não como um texto de marketing nem como IA.

COMO SOAR HUMANO (o mais importante):
- Varie o ritmo das frases. Misture frases curtas com uma ou outra mais longa. Texto todo picotado em frases curtinhas soa robótico.
- Vá direto ao ponto concreto. Comece por um fato, um número, um nome de ferramenta ou uma cena específica — nunca por uma generalidade ou definição.
- Pode usar linguagem coloquial do dia a dia ("dá pra", "tá", "acho que", "sei lá"), com moderação. Uma pequena imperfeição soa mais real que a perfeição.
- Escreva sobre uma coisa só. Não tente cobrir tudo.

O QUE DENUNCIA IA / LinkedIn (NÃO faça):
- Fórmula "não é sobre X, é sobre Y"; e variações de contraste espelhado.
- Frase-moral de fechamento resumindo a lição ("no fim das contas…", "fica a dica", "a real é que…", "e a lição que fica…").
- Listas de três itens paralelos e simétricos só pela estética.
- Pergunta retórica genérica na abertura ou um convite ao debate genérico no fim ("e você, o que acha?").
- Jargão vazio: "disruptivo", "game changer", "sinergia", "fora da caixa", "revolucionário", "divisor de águas".
- Travessão (—) em excesso, emoji decorativo e fileiras de hashtags.

REGRAS DE FORMATO:
- Entre 80 e 220 palavras.
- Quebras de linha entre blocos de ideia (o LinkedIn favorece respiro visual).
- No máximo 2 hashtags, e só se agregarem de verdade.
- Sem título, sem markdown, sem aspas em volta. Devolva apenas o texto do post.`;

// Áreas sorteadas a cada clique para o post automático variar de assunto.
const FOCUS_AREAS = [
  "inteligência artificial generativa, LLMs e agentes de IA",
  "ferramentas de desenvolvimento, DX e produtividade de devs",
  "linguagens de programação, frameworks web e novos releases",
  "computação em nuvem, plataformas serverless e infraestrutura",
  "código aberto e projetos relevantes lançados recentemente",
  "segurança da informação, vulnerabilidades e boas práticas",
  "engenharia de dados, bancos de dados e analytics",
  "dispositivos, chips e hardware voltado a tecnologia",
  "startups de tecnologia, produtos e movimentos do setor",
  "automação, DevOps e engenharia de plataforma",
];

// Formato do post. "ensinar" aparece com peso maior porque você pediu que
// alguns posts realmente ensinem algo. `weight` é a frequência relativa.
const POST_TYPES: { key: string; weight: number; instr: string }[] = [
  {
    key: "ensinar",
    weight: 4,
    instr:
      "ENSINE algo concreto e útil ligado à novidade: como aquilo funciona por baixo, um passo a passo curto, um comando/config, um truque ou um erro comum a evitar. Traga um exemplo prático de verdade. Quem ler tem que terminar sabendo fazer ou entender algo novo — não só 'ficar sabendo que existe'.",
  },
  {
    key: "opiniao",
    weight: 3,
    instr:
      "Dê uma opinião pessoal, específica e um pouco contra a corrente sobre a novidade. Assuma um ponto de vista; não fique em cima do muro.",
  },
  {
    key: "experiencia",
    weight: 2,
    instr:
      "Escreva a partir de uma experiência ou observação prática de quem trabalha com tecnologia, conectando a novidade ao dia a dia real de um time.",
  },
  {
    key: "analise",
    weight: 2,
    instr:
      "Explique, sem hype, por que essa novidade muda algo na prática: o que dava trabalho antes e o que fica diferente agora. Um exemplo concreto ajuda.",
  },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeighted<T extends { weight: number }>(arr: T[]): T {
  const total = arr.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const item of arr) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return arr[arr.length - 1];
}

function requireKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada.");
  return apiKey;
}

interface AutoPost {
  text: string;
  topic: string;
}

interface AutoOptions {
  extra?: string;
  /** Assuntos já usados recentemente, para a IA não repetir tema nem abordagem. */
  avoid?: string[];
}

/**
 * Gera um post SEM tema: pesquisa novidades recentes de tecnologia/dev na web
 * e escreve um post no estilo do mesa. Cada chamada sorteia área, formato e
 * ângulo e recebe os assuntos recentes a evitar, então clicar de novo tende a
 * produzir um post diferente.
 */
export async function generateAutoPost(opts: AutoOptions = {}): Promise<AutoPost> {
  const apiKey = requireKey();
  const model = process.env.OPENAI_SEARCH_MODEL || DEFAULT_SEARCH_MODEL;

  const focus = pick(FOCUS_AREAS);
  const type = pickWeighted(POST_TYPES);
  // Nonce só para desencorajar respostas idênticas em chamadas seguidas.
  const nonce = Math.random().toString(36).slice(2, 8);
  const today = new Date().toISOString().slice(0, 10);

  const avoidList = (opts.avoid ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 25);

  const input = [
    `Hoje é ${today}. Pesquise na web notícias e lançamentos RECENTES (últimas 2 a 3 semanas) sobre: ${focus}.`,
    `Escolha UM acontecimento concreto e específico (um lançamento, número, mudança ou release real e verificável), não algo genérico.`,
    `Formato deste post: ${type.instr}`,
    avoidList.length
      ? `NÃO escreva sobre nenhum destes assuntos já usados recentemente (escolha algo claramente diferente):\n- ${avoidList.join("\n- ")}`
      : null,
    opts.extra?.trim() ? `Instruções adicionais do autor: ${opts.extra.trim()}` : null,
    `Não invente fatos: baseie-se no que encontrou na pesquisa. Não cite URLs no texto do post.`,
    `Responda APENAS com um objeto JSON válido, sem markdown, no formato: {"tema": "<manchete curta em português, até 8 palavras>", "post": "<texto final do post>"}.`,
    `(id da requisição: ${nonce})`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: SYSTEM_PROMPT,
      input,
      temperature: 0.9,
      tools: [{ type: "web_search" }],
    }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    output_text?: string;
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  };

  if (!res.ok) {
    throw new Error(
      `Erro na OpenAI (HTTP ${res.status}): ${data.error?.message || "falha desconhecida"}`,
    );
  }

  const raw = extractResponsesText(data);
  if (!raw) throw new Error("A OpenAI não retornou nenhum texto.");

  const parsed = parseTemaPost(raw);
  if (!parsed.text) throw new Error("A OpenAI não retornou o texto do post.");
  return parsed;
}

/** Extrai o texto final de uma resposta da Responses API (com ou sem output_text). */
function extractResponsesText(data: {
  output_text?: string;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
}): string {
  if (data.output_text && data.output_text.trim()) return data.output_text.trim();
  const parts: string[] = [];
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "output_text" && c.text) parts.push(c.text);
    }
  }
  return parts.join("").trim();
}

/** Lê o JSON {tema, post}; se vier texto solto, usa tudo como post. */
function parseTemaPost(raw: string): AutoPost {
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const obj = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
        tema?: string;
        post?: string;
      };
      if (obj.post?.trim()) {
        return { text: sanitizePost(obj.post), topic: (obj.tema || "").trim() };
      }
    } catch {
      // cai no fallback abaixo
    }
  }
  return { text: sanitizePost(raw), topic: "" };
}

/**
 * Limpa o texto do post: remove citações/URLs que o web_search costuma injetar
 * (ex.: "([site.com](https://...))") e alguns clichês de fechamento/abertura que
 * o modelo às vezes insiste, mesmo instruído a não usar.
 */
export function sanitizePost(input: string): string {
  let t = input.trim();

  // Citação entre parênteses: ([label](url)) ou (texto https://...)
  t = t.replace(/\s*\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "");
  t = t.replace(/\s*\((?:[^()]*?https?:\/\/[^()]*)\)/g, "");
  // Link markdown solto [texto](url) -> mantém só o texto
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // URLs cruas restantes
  t = t.replace(/https?:\/\/\S+/g, "");

  // Clichês de fechamento em início de linha (removemos a linha inteira).
  const closers =
    /^\s*(fica a dica|a real é que|no fim das contas|no fim do dia|a lição que fica|em resumo|resumindo|moral da história)\b.*$/gim;
  t = t.replace(closers, "");

  // Normaliza espaços e quebras.
  t = t
    .replace(/[ \t]+([.,;:!?])/g, "$1") // espaço antes de pontuação
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n");

  return t.trim();
}

export async function generatePost(topic: string, extra?: string): Promise<string> {
  const apiKey = requireKey();

  const cleanTopic = topic?.trim();
  if (!cleanTopic) throw new Error("Informe um tema para gerar o post.");

  const model = process.env.OPENAI_MODEL || "gpt-4o";
  // Também sorteia um formato para o tema dirigido variar (inclui ensinar).
  const type = pickWeighted(POST_TYPES);
  const userPrompt = [
    `Tema do post: ${cleanTopic}`,
    `Formato deste post: ${type.instr}`,
    extra?.trim() ? `Instruções e contexto adicionais: ${extra.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.85,
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
