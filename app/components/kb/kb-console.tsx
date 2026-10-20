"use client";

// Knowledge base console: browse and edit articles, test search, re-index, Notice Board.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  RefreshCw,
  Loader2,
  Save,
  Eye,
  Pencil,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Megaphone,
  X,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiJson, jsonInit } from "../api";
import { useSession } from "../context/session-context";
import { Markdown } from "../markdown";

interface ArticleSummary {
  path: string;
  folder: string;
  title: string;
  tags: string[];
  sensitive: boolean;
  status: string | null;
  mtimeMs: number;
}
interface Article extends ArticleSummary {
  raw: string;
  body: string;
  editable: boolean;
  versions: number;
}
interface KbStatus {
  index: { state: string; finishedAt?: string; docs?: number; chunks?: number; embeddings?: boolean; error?: string };
  indexBuiltAt: string | null;
  products: { files: number; updatedAt: string | null; fresh: boolean };
}
interface Notice {
  id: number;
  title: string;
  body: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  endedAt: string | null;
  active: boolean;
}

const FOLDER_LABEL: Record<string, string> = {
  intents: "Intents",
  faq: "FAQ",
  policies: "Policies",
  tickets: "Solved examples",
  learned: "Learned",
  products: "Products",
};

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "never");

function Banner({ tone, children }: { tone: "error" | "ok" | "info"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-lg px-3 py-2 text-sm",
        tone === "error" && "bg-destructive/10 text-destructive",
        tone === "ok" && "bg-success/10 text-success",
        tone === "info" && "bg-info/10 text-info",
      )}
    >
      {children}
    </div>
  );
}

// ---------- index status + re-index ----------

export function IndexStatusBar({ owner, onReindexed }: { owner: boolean; onReindexed?: () => void }) {
  const [status, setStatus] = useState<KbStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => apiJson<KbStatus>("/api/kb/status").then(setStatus).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);
  const running = status?.index.state === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const next = await apiJson<KbStatus>("/api/kb/status").catch(() => null);
      if (next) setStatus(next);
      if (next && next.index.state !== "running") onReindexed?.();
    }, 2000);
    return () => clearInterval(t);
  }, [running, onReindexed]);

  const reindex = async () => {
    setError(null);
    try {
      await apiJson("/api/kb/reindex", jsonInit("POST"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-index failed to start");
    }
  };

  if (!status) return <div className="h-10" />;
  const failed = status.index.state === "failed";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-4 py-2.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        {running ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : failed ? (
          <AlertTriangle className="size-3.5 text-destructive" />
        ) : (
          <CheckCircle2 className="size-3.5 text-success" />
        )}
        {running ? "Re-indexing…" : failed ? `Last re-index failed: ${status.index.error}. Search uses the previous index.` : `Index built ${when(status.indexBuiltAt)}`}
      </span>
      {status.index.docs != null && !running && (
        <span>
          {status.index.docs} articles · {status.index.chunks} sections · {status.index.embeddings ? "meaning + keyword search" : "keyword search only"}
        </span>
      )}
      <span className={cn(!status.products.fresh && "text-warning")}>
        Products {status.products.files ? `updated ${when(status.products.updatedAt)}` : "not synced yet"}
        {status.products.files > 0 && !status.products.fresh && " (stale)"}
      </span>
      {error && <span className="text-destructive">{error}</span>}
      {owner && (
        <button
          type="button"
          onClick={reindex}
          disabled={running}
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 font-medium text-foreground ring-1 ring-border hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3.5", running && "animate-spin")} />
          Re-index
        </button>
      )}
    </div>
  );
}

// ---------- test search ----------

function TestSearch() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{
    results: Array<{ path: string; title: string; heading: string | null; text: string; sensitive: boolean; score: number }>;
    notices: Notice[];
    mode: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return setError("Type a customer question first");
    setBusy(true);
    setError(null);
    try {
      setOut(await apiJson(`/api/kb/search?q=${encodeURIComponent(q)}&k=5`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">Test a question</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">See what the AI would find for a customer question.</p>
      <form onSubmit={run} className="mt-3 flex gap-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setError(null);
          }}
          placeholder="e.g. my dress arrived torn, what now?"
          aria-label="Customer question"
          className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring"
        />
        <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Search
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {out && (
        <div className="mt-3 space-y-2">
          {out.notices.length > 0 && (
            <Banner tone="info">
              {out.notices.length} active notice{out.notices.length === 1 ? "" : "s"} also go to the AI and override these articles.
            </Banner>
          )}
          {out.results.length === 0 && <p className="text-sm text-muted-foreground">Nothing found.</p>}
          {out.results.map((r, i) => (
            <div key={i} className="rounded-lg bg-muted/50 p-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-foreground">{r.title}</span>
                {r.heading && <span className="text-muted-foreground">› {r.heading}</span>}
                {r.sensitive && (
                  <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 text-[10px] font-semibold text-destructive">
                    <ShieldAlert className="size-3" /> Escalate
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{r.text}</p>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Search mode: {out.mode}</p>
        </div>
      )}
    </section>
  );
}

// ---------- articles ----------

const TEMPLATE = `---
title: New topic
category: policies
status: draft
tags: []
---

## What the customer needs to know

Write self-contained guidance here. Each "## " section is found on its own, so repeat any
safety rules a section needs inside that section.
`;

function NewArticle({ folders, onCreated }: { folders: string[]; onCreated: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState(folders[0] ?? "policies");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/\.md$/, "");
    if (!/^[a-z0-9][a-z0-9._-]{0,90}$/.test(file)) return setError("Use letters, digits, - and _");
    try {
      await apiJson("/api/kb/article", jsonInit("POST", { path: `${folder}/${file}.md`, raw: TEMPLATE.replace("category: policies", `category: ${folder}`) }));
      setOpen(false);
      setName("");
      onCreated(`${folder}/${file}.md`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create it");
    }
  };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
        <Plus className="size-4" /> New article
      </button>
    );
  }
  return (
    <form onSubmit={create} className="flex flex-wrap items-center gap-2">
      <select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Folder" className="h-8 rounded-lg border border-input bg-background px-2 text-sm">
        {folders.map((f) => (
          <option key={f} value={f}>
            {FOLDER_LABEL[f] ?? f}
          </option>
        ))}
      </select>
      <input
        autoFocus
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        placeholder="file-name"
        aria-label="File name"
        className="h-8 w-44 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:border-ring"
      />
      <button type="submit" className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
        Create
      </button>
      <button type="button" onClick={() => setOpen(false)} aria-label="Cancel" className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-accent">
        <X className="size-4" />
      </button>
      {error && <span className="w-full text-xs text-destructive">{error}</span>}
    </form>
  );
}

function ArticleEditor({ path, owner, onSaved }: { path: string; owner: boolean; onSaved: () => void }) {
  const [article, setArticle] = useState<Article | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [message, setMessage] = useState<{ tone: "error" | "ok" | "info"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Keyed by path in the parent, so each article starts from fresh state
    let live = true;
    apiJson<Article>(`/api/kb/article?path=${encodeURIComponent(path)}`)
      .then((a) => {
        if (!live) return;
        setArticle(a);
        setDraft(a.raw);
      })
      .catch((e) => live && setMessage({ tone: "error", text: e.message }));
    return () => {
      live = false;
    };
  }, [path]);

  const dirty = !!article && draft !== article.raw;
  // Warn before leaving the page with unsaved edits
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const save = async () => {
    if (!article) return;
    setSaving(true);
    try {
      const saved = await apiJson<Article>("/api/kb/article", jsonInit("PUT", { path: article.path, raw: draft, expectedMtimeMs: article.mtimeMs }));
      setArticle(saved);
      setDraft(saved.raw);
      setMessage({ tone: "ok", text: "Saved. Re-index to apply it to AI answers." });
      onSaved();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  if (!article) {
    return <div className="p-6 text-sm text-muted-foreground">{message ? message.text : "Loading…"}</div>;
  }
  const canEdit = owner && article.editable;
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{article.title}</h2>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {article.path} · {article.versions} earlier version{article.versions === 1 ? "" : "s"} kept
          </p>
        </div>
        {article.sensitive && (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive" title="Drafts on this topic always go to a person">
            <ShieldAlert className="size-3.5" /> Sensitive
          </span>
        )}
        {canEdit && (
          <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
            {(["preview", "edit"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium", mode === m ? "bg-background shadow-soft" : "text-muted-foreground")}
              >
                {m === "preview" ? <Eye className="size-3.5" /> : <Pencil className="size-3.5" />}
                {m === "preview" ? "Preview" : "Edit"}
              </button>
            ))}
          </div>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {dirty ? "Save" : "Saved"}
          </button>
        )}
      </div>
      {message && (
        <div className="px-5 pt-3">
          <Banner tone={message.tone}>{message.text}</Banner>
        </div>
      )}
      {!article.editable && (
        <div className="px-5 pt-3">
          <Banner tone="info">
            {article.folder === "products" ? "Generated from the catalog every day: edits would be overwritten." : "Promoted from approved replies; read-only here."}
          </Banner>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {mode === "edit" ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Article Markdown"
            spellCheck
            className="h-full min-h-[50vh] w-full resize-none rounded-lg border border-input bg-background p-3 font-mono text-[13px] leading-relaxed outline-none focus:border-ring"
          />
        ) : (
          <Markdown source={draft.replace(/^---[\s\S]*?---\n?/, "")} />
        )}
      </div>
    </div>
  );
}

export function ArticlesTab({ owner }: { owner: boolean }) {
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [editable, setEditable] = useState<string[]>([]);
  const [folder, setFolder] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      apiJson<{ articles: ArticleSummary[]; editableFolders: string[] }>(`/api/kb/articles${folder === "products" ? "?folder=products" : ""}`)
        .then((data) => {
          setArticles(data.articles);
          setEditable(data.editableFolders);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load articles")),
    [folder],
  );
  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return articles.filter(
      (a) => (!folder || a.folder === folder) && (!q || a.title.toLowerCase().includes(q) || a.tags.some((t) => t.includes(q)) || a.path.includes(q)),
    );
  }, [articles, folder, filter]);

  return (
    <div className="grid h-[calc(100dvh-12.5rem)] min-h-[28rem] grid-cols-1 grid-rows-[minmax(0,16rem)_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card md:grid-cols-[20rem_1fr] md:grid-rows-1">
      <div className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-r">
        <div className="space-y-2 border-b border-border p-3">
          <label className="flex items-center gap-2 rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm">
            <Search className="size-4 text-muted-foreground" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by title or tag" aria-label="Filter articles" className="w-full bg-transparent outline-none" />
          </label>
          <div className="flex flex-wrap gap-1">
            {["", "intents", "faq", "policies", "tickets", "learned", "products"].map((f) => (
              <button
                key={f || "all"}
                type="button"
                onClick={() => setFolder(f)}
                className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", folder === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
              >
                {f ? FOLDER_LABEL[f] : "All"}
              </button>
            ))}
          </div>
          {owner && <NewArticle folders={editable} onCreated={(p) => load().then(() => setSelected(p))} />}
        </div>
        {error && <p className="p-3 text-sm text-destructive">{error}</p>}
        <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {shown.map((a) => (
            <li key={a.path}>
              <button
                type="button"
                onClick={() => setSelected(a.path)}
                aria-current={selected === a.path ? "true" : undefined}
                className={cn("w-full rounded-lg px-2.5 py-2 text-left", selected === a.path ? "bg-accent" : "hover:bg-accent/60")}
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{a.title}</span>
                  {a.sensitive && <ShieldAlert className="size-3.5 shrink-0 text-destructive" aria-label="Sensitive" />}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {FOLDER_LABEL[a.folder] ?? a.folder} · {a.tags.slice(0, 4).join(", ")}
                </span>
              </button>
            </li>
          ))}
          {!shown.length && !error && <li className="p-3 text-sm text-muted-foreground">No articles{filter ? " match" : " yet"}.</li>}
        </ul>
      </div>
      <div className="min-h-0">
        {selected ? (
          <ArticleEditor key={selected} path={selected} owner={owner} onSaved={load} />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">Pick an article to read{owner ? " or edit" : ""} it.</div>
        )}
      </div>
    </div>
  );
}

// ---------- Notice Board ----------

export function NoticeBoard({ owner }: { owner: boolean }) {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [form, setForm] = useState({ title: "", body: "", expiresAt: "" });
  const [reviewing, setReviewing] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [confirmEnd, setConfirmEnd] = useState<number | null>(null);

  const load = useCallback(() => apiJson<{ notices: Notice[] }>("/api/kb/notices").then((d) => setNotices(d.notices)).catch((e) => setMessage({ tone: "error", text: e.message })), []);
  useEffect(() => {
    load();
  }, [load]);

  const review = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) return setMessage({ tone: "error", text: "Write a title and the notice first" });
    if (form.expiresAt && new Date(form.expiresAt).getTime() <= Date.now()) return setMessage({ tone: "error", text: "The end date must be in the future" });
    setMessage(null);
    setReviewing(true);
  };
  const publish = async () => {
    try {
      await apiJson("/api/kb/notices", jsonInit("POST", { ...form, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null }));
      setForm({ title: "", body: "", expiresAt: "" });
      setReviewing(false);
      setMessage({ tone: "ok", text: "Published. The AI sees it on the next draft." });
      load();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Couldn't publish" });
      setReviewing(false);
    }
  };
  const end = async (id: number) => {
    setConfirmEnd(null);
    try {
      await apiJson(`/api/kb/notices/${id}/end`, jsonInit("POST"));
      load();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Couldn't end it" });
    }
  };

  const active = notices?.filter((n) => n.active) ?? [];
  const past = notices?.filter((n) => !n.active) ?? [];
  const input = "mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring";

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Live notices</h2>
        {notices && !active.length && <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No live notices. The AI answers from the knowledge base only.</p>}
        {active.map((n) => (
          <article key={n.id} className="rounded-xl border border-warning/40 bg-warning/5 p-4">
            <div className="flex items-start gap-2">
              <Megaphone className="mt-0.5 size-4 text-warning" />
              <div className="min-w-0 flex-1">
                <h3 className="font-medium">{n.title}</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm">{n.body}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  By {n.createdBy} · {when(n.createdAt)} · {n.expiresAt ? `ends ${when(n.expiresAt)}` : "until ended"}
                </p>
              </div>
              {owner &&
                (confirmEnd === n.id ? (
                  <span className="flex items-center gap-1">
                    <button type="button" onClick={() => end(n.id)} className="rounded-md bg-destructive px-2 py-1 text-xs font-medium text-white">
                      End now
                    </button>
                    <button type="button" onClick={() => setConfirmEnd(null)} className="rounded-md px-2 py-1 text-xs hover:bg-accent">
                      Keep
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmEnd(n.id)} className="rounded-md px-2 py-1 text-xs font-medium ring-1 ring-border hover:bg-accent">
                    End
                  </button>
                ))}
            </div>
          </article>
        ))}
        {past.length > 0 && (
          <>
            <h2 className="pt-2 text-sm font-semibold text-muted-foreground">Ended or expired</h2>
            {past.map((n) => (
              <article key={n.id} className="rounded-xl border border-border p-3 opacity-80">
                <div className="flex items-center gap-2">
                  <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{n.title}</h3>
                  {owner && (
                    <button
                      type="button"
                      onClick={() => {
                        setForm({ title: n.title, body: n.body, expiresAt: "" });
                        setReviewing(false);
                      }}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-accent"
                    >
                      <RotateCcw className="size-3.5" /> Reuse
                    </button>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
              </article>
            ))}
          </>
        )}
      </section>

      {owner ? (
        <section className="h-fit rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Post a notice</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Temporary facts, like closures or delays. The AI follows them over the knowledge base.</p>
          {message && (
            <div className="mt-3">
              <Banner tone={message.tone}>{message.text}</Banner>
            </div>
          )}
          {reviewing ? (
            <div className="mt-3 space-y-3">
              <div className="rounded-lg bg-muted/60 p-3 text-sm">
                <p className="text-xs font-medium text-muted-foreground">The AI will be told:</p>
                <p className="mt-1 font-medium">{form.title.trim()}</p>
                <p className="mt-1 whitespace-pre-wrap">{form.body.trim()}</p>
                <p className="mt-2 text-xs text-muted-foreground">{form.expiresAt ? `Until ${new Date(form.expiresAt).toLocaleString()}` : "Until you end it"}</p>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setReviewing(false)} className="h-8 rounded-lg px-3 text-sm ring-1 ring-border hover:bg-accent">
                  Back to edit
                </button>
                <button type="button" onClick={publish} className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
                  Publish
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={review} className="mt-3 space-y-3" noValidate>
              <label className="block text-sm font-medium">
                Title
                <input className={input} maxLength={120} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
              </label>
              <label className="block text-sm font-medium">
                Notice
                <textarea className={input} rows={4} maxLength={2000} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
              </label>
              <label className="block text-sm font-medium">
                Ends <span className="font-normal text-muted-foreground">(optional)</span>
                <input type="datetime-local" className={input} value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
              </label>
              <button type="submit" className="h-8 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground">
                Review before publishing
              </button>
            </form>
          )}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Only the owner can post notices.</p>
      )}
    </div>
  );
}

export function KbConsole() {
  const { user } = useSession();
  const owner = user?.role === "owner";
  const [tab, setTab] = useState<"articles" | "notices" | "search">("articles");
  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <IndexStatusBar owner={owner} />
      <div className="inline-flex rounded-lg bg-muted p-0.5 text-sm" role="tablist">
        {(
          [
            ["articles", "Articles"],
            ["notices", "Notice board"],
            ["search", "Test search"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn("rounded-md px-3 py-1.5 font-medium", tab === value ? "bg-background shadow-soft" : "text-muted-foreground hover:text-foreground")}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "articles" && <ArticlesTab owner={owner} />}
      {tab === "notices" && <NoticeBoard owner={owner} />}
      {tab === "search" && <TestSearch />}
    </div>
  );
}
