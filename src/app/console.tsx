"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatSpDateTime, utcToSpInputValue } from "@/lib/datetime";

type Status = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED";

interface PostDTO {
  id: string;
  content: string;
  status: Status;
  topic: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  linkedinId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  url?: string | null;
}

type Tab = "compose" | "queue" | "history";

const MAX = 3000;

interface Props {
  linkedinConnected: boolean;
  accountName: string | null;
  isDev: boolean;
}

export default function Console({ linkedinConnected, accountName, isDev }: Props) {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("compose");

  // Composer
  const [topic, setTopic] = useState("");
  const [extra, setExtra] = useState("");
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [folded, setFolded] = useState(true);

  // Scheduling panel
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleValue, setScheduleValue] = useState("");

  // Data
  const [drafts, setDrafts] = useState<PostDTO[]>([]);
  const [history, setHistory] = useState<PostDTO[]>([]);

  // Assuntos gerados nesta sessão — enviados ao gerar para a IA não repetir.
  const [recentTopics, setRecentTopics] = useState<string[]>([]);
  // Busca na aba Histórico.
  const [historyQuery, setHistoryQuery] = useState("");

  // UX
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "ok" | "error"; msg: string } | null>(null);

  const showToast = useCallback((type: "ok" | "error", msg: string) => {
    setToast({ type, msg });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const refreshDrafts = useCallback(async () => {
    const res = await fetch("/api/drafts", { cache: "no-store" });
    if (res.ok) setDrafts((await res.json()).drafts ?? []);
  }, []);

  const refreshHistory = useCallback(async () => {
    const res = await fetch("/api/posts", { cache: "no-store" });
    if (res.ok) setHistory((await res.json()).posts ?? []);
  }, []);

  // Mount: ler retorno do OAuth (?li=...) e carregar listas.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const li = params.get("li");
    if (li === "connected") showToast("ok", "LinkedIn conectado!");
    else if (li === "error") showToast("error", params.get("reason") || "Falha ao conectar o LinkedIn.");
    if (li) window.history.replaceState({}, "", window.location.pathname);
    void refreshDrafts();
    void refreshHistory();
  }, [refreshDrafts, refreshHistory, showToast]);

  const count = text.length;
  const over = count > MAX;

  const clearComposer = useCallback(() => {
    setText("");
    setTopic("");
    setExtra("");
    setEditingId(null);
    setScheduleOpen(false);
    setScheduleValue("");
  }, []);

  // ── Ações ────────────────────────────────────────────────
  async function doGenerate() {
    // Sem tema é o caminho principal: a IA pesquisa novidades e escreve sozinha.
    const auto = !topic.trim();
    setBusy("generate");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, extra, recent: auto ? recentTopics : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast("error", data.error || "Erro ao gerar.");
        return;
      }
      setText(data.text);
      // No modo automático, guardamos a manchete detectada como tema e a
      // acumulamos para os próximos cliques não repetirem o assunto.
      if (auto && data.topic) {
        setTopic(data.topic);
        setRecentTopics((prev) => [data.topic, ...prev].slice(0, 15));
      }
      setFolded(true);
    } catch {
      showToast("error", "Erro de conexão com a geração.");
    } finally {
      setBusy(null);
    }
  }

  /** Garante que existe um rascunho salvo e devolve o id. */
  async function ensureDraftId(): Promise<string | null> {
    if (editingId) {
      // salva edições atuais antes de prosseguir
      const res = await fetch(`/api/drafts/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, topic: topic || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        showToast("error", d.error || "Erro ao salvar.");
        return null;
      }
      return editingId;
    }
    const res = await fetch("/api/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text, topic: topic || null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast("error", data.error || "Erro ao salvar rascunho.");
      return null;
    }
    setEditingId(data.draft.id);
    return data.draft.id as string;
  }

  async function doSaveDraft() {
    if (!text.trim()) {
      showToast("error", "Nada para salvar.");
      return;
    }
    setBusy("save");
    try {
      const id = await ensureDraftId();
      if (id) {
        showToast("ok", "Rascunho salvo.");
        await refreshDrafts();
      }
    } finally {
      setBusy(null);
    }
  }

  async function doPublishNow() {
    if (!text.trim()) return;
    if (!linkedinConnected) {
      showToast("error", "Conecte o LinkedIn antes de publicar.");
      return;
    }
    if (!window.confirm("Publicar agora no LinkedIn?")) return;

    setBusy("publish");
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, id: editingId ?? undefined, topic: topic || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast("error", data.error || "Erro ao publicar.");
        await refreshDrafts();
        await refreshHistory();
        return;
      }
      showToast("ok", "Publicado no LinkedIn!");
      clearComposer();
      await refreshDrafts();
      await refreshHistory();
      setTab("history");
    } catch {
      showToast("error", "Erro de conexão ao publicar.");
    } finally {
      setBusy(null);
    }
  }

  async function doSchedule() {
    if (!text.trim()) {
      showToast("error", "Nada para agendar.");
      return;
    }
    if (!scheduleValue) {
      showToast("error", "Escolha data e hora.");
      return;
    }
    setBusy("schedule");
    try {
      const id = await ensureDraftId();
      if (!id) return;
      const res = await fetch(`/api/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, topic: topic || null, scheduledAt: scheduleValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast("error", data.error || "Erro ao agendar.");
        return;
      }
      showToast("ok", "Post agendado.");
      clearComposer();
      await refreshDrafts();
      setTab("queue");
    } finally {
      setBusy(null);
    }
  }

  function loadIntoComposer(p: PostDTO) {
    setText(p.content);
    setTopic(p.topic ?? "");
    setExtra("");
    setEditingId(p.id);
    setScheduleOpen(false);
    setScheduleValue(p.scheduledAt ? utcToSpInputValue(new Date(p.scheduledAt)) : "");
    setFolded(true);
    setTab("compose");
  }

  async function doDelete(id: string) {
    if (!window.confirm("Excluir este post?")) return;
    const res = await fetch(`/api/drafts/${id}`, { method: "DELETE" });
    if (res.ok) {
      if (editingId === id) clearComposer();
      showToast("ok", "Excluído.");
      await refreshDrafts();
      await refreshHistory();
    } else {
      showToast("error", "Não foi possível excluir.");
    }
  }

  async function doUnschedule(id: string) {
    const res = await fetch(`/api/drafts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledAt: null }),
    });
    if (res.ok) {
      showToast("ok", "Agendamento cancelado. Voltou para rascunho.");
      await refreshDrafts();
    } else {
      showToast("error", "Não foi possível desagendar.");
    }
  }

  async function doRunCron() {
    setBusy("cron");
    try {
      const res = await fetch("/api/dev/run-cron", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast("error", data.error || "Erro ao rodar o agendador.");
        return;
      }
      showToast("ok", `Agendador: ${data.published} publicado(s), ${data.failed} falha(s).`);
      await refreshDrafts();
      await refreshHistory();
    } finally {
      setBusy(null);
    }
  }

  async function doLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
  }

  async function doCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("ok", "Texto copiado.");
    } catch {
      showToast("error", "Não foi possível copiar.");
    }
  }

  // ── Derivados ────────────────────────────────────────────
  const scheduled = useMemo(() => drafts.filter((d) => d.status === "SCHEDULED"), [drafts]);
  const onlyDrafts = useMemo(() => drafts.filter((d) => d.status === "DRAFT"), [drafts]);
  const matchesQuery = useCallback(
    (p: PostDTO) => {
      const q = historyQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        p.content.toLowerCase().includes(q) || (p.topic ?? "").toLowerCase().includes(q)
      );
    },
    [historyQuery],
  );
  const published = useMemo(
    () => history.filter((p) => p.status === "PUBLISHED" && matchesQuery(p)),
    [history, matchesQuery],
  );
  const failed = useMemo(
    () => history.filter((p) => p.status === "FAILED" && matchesQuery(p)),
    [history, matchesQuery],
  );

  const minSchedule = utcToSpInputValue(new Date(Date.now() + 60 * 1000));
  const initials = (accountName || "eu").trim().slice(0, 2).toUpperCase();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo">mesa</span>
          <span className="tag">console de posts</span>
        </div>
        <div className="topbar-actions">
          {linkedinConnected ? (
            <span className="chip">
              <span className="dot dot-on" />
              {accountName ? accountName : "LinkedIn conectado"}
            </span>
          ) : (
            <a className="btn btn-leaf btn-sm" href="/api/auth/linkedin">
              Conectar LinkedIn
            </a>
          )}
          {linkedinConnected && (
            <a className="btn btn-ghost btn-sm" href="/api/auth/linkedin">
              Reconectar
            </a>
          )}
          <button className="btn btn-ghost btn-sm" onClick={doLogout}>
            Sair
          </button>
        </div>
      </header>

      <nav className="tabs">
        <button className="tab" data-active={tab === "compose"} onClick={() => setTab("compose")}>
          Compor
        </button>
        <button className="tab" data-active={tab === "queue"} onClick={() => setTab("queue")}>
          Fila<span className="count">{drafts.length}</span>
        </button>
        <button className="tab" data-active={tab === "history"} onClick={() => setTab("history")}>
          Histórico<span className="count">{history.length}</span>
        </button>
      </nav>

      {tab === "compose" && (
        <>
          <section className="card">
            <div className="card-head">
              <h2>1 · Gerar com IA</h2>
            </div>
            <p style={{ margin: "0 0 14px", color: "var(--muted, #8a8a8a)", fontSize: 14 }}>
              Clique em <strong>Gerar post automático</strong> e a IA pesquisa as novidades de
              tecnologia e desenvolvimento na web e escreve um post. Cada clique traz um diferente.
              Quer direcionar? Preencha um tema abaixo (opcional).
            </p>
            <div className="field">
              <label className="label">Tema (opcional)</label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Deixe vazio para a IA escolher a partir das novidades de tech"
              />
            </div>
            <div className="field">
              <label className="label">Instruções extras (opcional)</label>
              <input
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                placeholder="Ex.: tom mais pessoal, citar um número, fechar com convite ao debate"
              />
            </div>
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button className="btn btn-leaf" onClick={doGenerate} disabled={busy === "generate"}>
                {busy === "generate"
                  ? "Pesquisando e gerando…"
                  : topic.trim()
                    ? "Gerar texto"
                    : "Gerar post automático"}
              </button>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>2 · Revisar {editingId ? "· editando rascunho" : ""}</h2>
              <span className="counter" data-over={over}>
                {count}/{MAX}
              </span>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="O texto aparece aqui depois de gerar — ou escreva do zero. Você revisa e edita antes de publicar."
            />

            {text.trim() && (
              <>
                <div style={{ height: 16 }} />
                <label className="label">Pré-visualização (dobra do feed)</label>
                <div className="preview">
                  <div className="pv-head">
                    <div className="avatar">{initials}</div>
                    <div>
                      <div className="pv-name">{accountName || "Você"}</div>
                      <div className="pv-sub">agora · LinkedIn</div>
                    </div>
                  </div>
                  <div className={`pv-text ${folded ? "folded" : ""}`}>{text}</div>
                  <button className="seemore" onClick={() => setFolded((f) => !f)}>
                    {folded ? "…ver mais" : "ver menos"}
                  </button>
                </div>
              </>
            )}

            <div className="btn-row" style={{ marginTop: 16 }}>
              <button
                className="btn btn-ghost"
                onClick={doSaveDraft}
                disabled={busy !== null || !text.trim()}
              >
                {busy === "save" ? "Salvando…" : "Salvar rascunho"}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setScheduleOpen((s) => !s)}
                disabled={busy !== null || !text.trim()}
              >
                Agendar
              </button>
              <div className="spacer" />
              <button
                className="btn btn-primary"
                onClick={doPublishNow}
                disabled={busy !== null || !text.trim() || over || !linkedinConnected}
                title={!linkedinConnected ? "Conecte o LinkedIn primeiro" : ""}
              >
                {busy === "publish" ? "Publicando…" : "Postar agora"}
              </button>
            </div>

            {scheduleOpen && (
              <div className="note" style={{ marginTop: 14 }}>
                <label className="label">Agendar para (horário de Brasília)</label>
                <div className="btn-row">
                  <input
                    type="datetime-local"
                    value={scheduleValue}
                    min={minSchedule}
                    onChange={(e) => setScheduleValue(e.target.value)}
                  />
                  <button
                    className="btn btn-leaf btn-sm"
                    onClick={doSchedule}
                    disabled={busy !== null || over}
                  >
                    {busy === "schedule" ? "Agendando…" : "Confirmar agendamento"}
                  </button>
                </div>
                <p style={{ margin: "8px 0 0" }}>
                  No plano grátis da Vercel o cron roda 1x/dia. Veja o README para cadência mais fina.
                </p>
              </div>
            )}

            {editingId && (
              <button
                className="btn btn-danger btn-sm"
                style={{ marginTop: 10 }}
                onClick={clearComposer}
              >
                Limpar / novo post
              </button>
            )}
          </section>
        </>
      )}

      {tab === "queue" && (
        <>
          <section className="card">
            <div className="card-head">
              <h2>Agendados</h2>
              {isDev && (
                <button className="btn btn-ghost btn-sm" onClick={doRunCron} disabled={busy === "cron"}>
                  {busy === "cron" ? "Rodando…" : "▶ Rodar agendador (dev)"}
                </button>
              )}
            </div>
            {scheduled.length === 0 ? (
              <div className="empty">Nenhum post agendado.</div>
            ) : (
              scheduled.map((p) => (
                <div className="item" key={p.id}>
                  <div className="item-head">
                    <span className="badge badge-scheduled">Agendado</span>
                    <span className="item-meta">
                      {p.scheduledAt ? formatSpDateTime(new Date(p.scheduledAt)) : ""}
                    </span>
                  </div>
                  <div className="item-text">{p.content}</div>
                  <div className="item-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => loadIntoComposer(p)}>
                      Editar
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => doUnschedule(p.id)}>
                      Desagendar
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => doDelete(p.id)}>
                      Excluir
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Rascunhos</h2>
            </div>
            {onlyDrafts.length === 0 ? (
              <div className="empty">Nenhum rascunho. Gere ou escreva um na aba Compor.</div>
            ) : (
              onlyDrafts.map((p) => (
                <div className="item" key={p.id}>
                  <div className="item-head">
                    <span className="badge badge-draft">Rascunho</span>
                    <span className="item-meta">{formatSpDateTime(new Date(p.updatedAt))}</span>
                  </div>
                  <div className="item-text">{p.content}</div>
                  <div className="item-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => loadIntoComposer(p)}>
                      Abrir / editar
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => doDelete(p.id)}>
                      Excluir
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      )}

      {tab === "history" && (
        <>
          <section className="card">
            <div className="field">
              <input
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                placeholder="Buscar no histórico por texto ou tema…"
              />
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Publicados<span className="count">{published.length}</span></h2>
            </div>
            {published.length === 0 ? (
              <div className="empty">
                {historyQuery.trim() ? "Nenhum publicado bate com a busca." : "Nada publicado ainda."}
              </div>
            ) : (
              published.map((p) => (
                <div className="item" key={p.id}>
                  <div className="item-head">
                    <span className="badge badge-published">Publicado</span>
                    <span className="item-meta">
                      {p.publishedAt ? formatSpDateTime(new Date(p.publishedAt)) : ""}
                    </span>
                  </div>
                  {p.topic && <div className="item-meta" style={{ marginBottom: 6 }}>Tema: {p.topic}</div>}
                  <div className="item-text">{p.content}</div>
                  <div className="item-actions">
                    {p.url ? (
                      <a className="btn btn-ghost btn-sm" href={p.url} target="_blank" rel="noreferrer">
                        Ver no LinkedIn ↗
                      </a>
                    ) : (
                      <span className="item-meta">URN não disponível</span>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => doCopy(p.content)}>
                      Copiar
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => doDelete(p.id)}>
                      Remover do histórico
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>

          {failed.length > 0 && (
            <section className="card">
              <div className="card-head">
                <h2>Falhas<span className="count">{failed.length}</span></h2>
              </div>
              {failed.map((p) => (
                <div className="item" key={p.id}>
                  <div className="item-head">
                    <span className="badge badge-failed">Falhou</span>
                    <span className="item-meta">{formatSpDateTime(new Date(p.updatedAt))}</span>
                  </div>
                  {p.topic && <div className="item-meta" style={{ marginBottom: 6 }}>Tema: {p.topic}</div>}
                  <div className="item-text">{p.content}</div>
                  {p.error && <div className="item-error">{p.error}</div>}
                  <div className="item-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => loadIntoComposer(p)}>
                      Editar e tentar de novo
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => doCopy(p.content)}>
                      Copiar
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => doDelete(p.id)}>
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
