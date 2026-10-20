"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Copy, Check, Mail, MessageCircle, Info, CornerDownRight, StickyNote, Paperclip, FileWarning, ChevronDown } from "lucide-react";
import type { Attachment } from "@/lib/helpdesk-types";
import type { TicketMessage } from "../types";
import { Avatar, copyText } from "../ui";

interface MessageProps {
  message: TicketMessage;
}

const LONG_CHARS = 1600;
const LONG_LINES = 28;
// Images that are safe to show inline (never SVG, which can carry script)
const INLINE_IMAGE = /^image\/(png|jpe?g|gif|webp)$/i;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const label = copied === null ? "Copy message" : copied ? "Copied" : "Couldn't copy";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={async () => {
        setCopied(await copyText(text));
        setTimeout(() => setCopied(null), 1500);
      }}
      className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
    >
      {copied ? (
        <Check className="size-3.5 text-success" />
      ) : (
        <Copy className={cn("size-3.5", copied === false && "text-destructive")} />
      )}
    </button>
  );
}

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

function Attachments({ items }: { items: Attachment[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((a) => {
        const url = `/api/helpdesk/attachments/${a.id}`;
        if (!a.stored) {
          return (
            <span
              key={a.id}
              title="Not stored: too large or a blocked file type"
              className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground"
            >
              <FileWarning className="size-3.5" />
              {a.filename} · {formatSize(a.size)}
            </span>
          );
        }
        if (INLINE_IMAGE.test(a.contentType)) {
          const open = expanded === a.id;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setExpanded(open ? null : a.id)}
              title={open ? "Shrink" : `Expand ${a.filename}`}
              className={cn("overflow-hidden rounded-lg ring-1 ring-border", open ? "w-full" : "size-24")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-gated file */}
              <img src={url} alt={a.filename} className={cn("size-full", open ? "object-contain" : "object-cover")} />
            </button>
          );
        }
        return (
          <a
            key={a.id}
            href={url}
            className="inline-flex items-center gap-1.5 rounded-lg bg-card px-2.5 py-1.5 text-xs text-foreground ring-1 ring-border hover:bg-accent"
          >
            <Paperclip className="size-3.5" />
            {a.filename} · {formatSize(a.size)}
          </a>
        );
      })}
    </div>
  );
}

// Splits off quoted history ("> " lines and "On … wrote:" blocks) so it can be folded away
function splitQuoted(text: string) {
  const lines = text.split("\n");
  const start = lines.findIndex(
    (l, i) => /^>/.test(l) || (/^On .{4,200}wrote:\s*$/.test(l) && lines.slice(i + 1).some((x) => x.startsWith(">"))),
  );
  if (start <= 0) return { body: text, quoted: "" };
  return { body: lines.slice(0, start).join("\n").trimEnd(), quoted: lines.slice(start).join("\n") };
}

function Body({ text }: { text: string }) {
  const { body, quoted } = splitQuoted(text);
  const long = body.length > LONG_CHARS || body.split("\n").length > LONG_LINES;
  const [showAll, setShowAll] = useState(false);
  const [showQuoted, setShowQuoted] = useState(false);
  const visible = long && !showAll ? `${body.split("\n").slice(0, LONG_LINES).join("\n").slice(0, LONG_CHARS).trimEnd()}…` : body;
  return (
    <>
      {visible}
      {long && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 block text-xs font-medium underline-offset-2 opacity-80 hover:underline">
          {showAll ? "Show less" : "Show the whole message"}
        </button>
      )}
      {quoted && (
        <>
          <button
            type="button"
            onClick={() => setShowQuoted((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 text-xs opacity-70 hover:opacity-100"
            aria-expanded={showQuoted}
          >
            <ChevronDown className={cn("size-3 transition-transform", showQuoted && "rotate-180")} />
            {showQuoted ? "Hide quoted text" : "Show quoted text"}
          </button>
          {showQuoted && <div className="mt-1 border-l-2 border-current/20 pl-3 opacity-70">{quoted}</div>}
        </>
      )}
    </>
  );
}

export function Message({ message }: MessageProps) {
  if (message.type === "system") {
    return (
      <div className="flex justify-center py-2">
        <div className="inline-flex max-w-[90%] items-start gap-2 rounded-full bg-muted/70 px-3 py-1.5 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" />
          <span className="break-words [overflow-wrap:anywhere]">{message.content}</span>
          {message.timestamp && (
            <span className="shrink-0 tabular-nums text-muted-foreground/70">{message.timestamp}</span>
          )}
        </div>
      </div>
    );
  }

  const isNote = message.type === "note";
  const isAgent = message.type === "agent" || isNote;
  const ChannelIcon = message.channel === "Email" ? Mail : MessageCircle;

  return (
    <div className={cn("group flex gap-3 py-2", isAgent && "flex-row-reverse")}>
      <Avatar
        name={message.sender}
        size="sm"
        className={cn("mt-0.5", message.type === "agent" && "!bg-primary !text-primary-foreground")}
      />
      <div className={cn("flex min-w-0 max-w-[85%] flex-col", isAgent && "items-end")}>
        <div className={cn("mb-1 flex items-center gap-2 text-xs", isAgent && "flex-row-reverse")}>
          <span className="font-semibold text-foreground">{message.sender}</span>
          <span className="tabular-nums text-muted-foreground">{message.timestamp}</span>
          {isNote ? (
            <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-px text-[10px] font-semibold text-warning">
              <StickyNote className="size-3" />
              Internal note
            </span>
          ) : (
            message.channel && (
              <span className="inline-flex items-center gap-1 text-muted-foreground" title={`Sent via ${message.channel}`}>
                <ChannelIcon className="size-3" />
              </span>
            )
          )}
        </div>
        <div className={cn("flex items-start gap-1", isAgent && "flex-row-reverse")}>
          <div
            className={cn(
              "rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
              isNote
                ? "rounded-tr-md bg-warning/10 text-foreground ring-1 ring-warning/30"
                : isAgent
                  ? "rounded-tr-md bg-primary text-primary-foreground shadow-soft"
                  : "rounded-tl-md bg-card text-card-foreground shadow-soft ring-1 ring-border",
            )}
          >
            <Body text={message.content} />
          </div>
          <CopyButton text={message.content} />
        </div>
        {message.attachments && message.attachments.length > 0 && <Attachments items={message.attachments} />}
        {message.truncated && (
          <span className="mt-1 text-[11px] text-muted-foreground">This message was longer; only the first part was kept.</span>
        )}
        {message.type === "agent" && message.channel === "Email" && message.emailSubject && (
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <CornerDownRight className="size-3" />
            {message.emailSubject}
          </span>
        )}
      </div>
    </div>
  );
}
