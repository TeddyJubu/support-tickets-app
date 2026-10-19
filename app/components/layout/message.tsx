"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Copy, Check, Mail, MessageCircle, Info, CornerDownRight } from "lucide-react";
import type { TicketMessage } from "../types";
import { Avatar } from "../ui";

interface MessageProps {
  message: TicketMessage;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy message"}
      title={copied ? "Copied" : "Copy message"}
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
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

  const isAgent = message.type === "agent";
  const ChannelIcon = message.channel === "Email" ? Mail : MessageCircle;

  return (
    <div className={cn("group flex gap-3 py-2", isAgent && "flex-row-reverse")}>
      <Avatar
        name={message.sender}
        size="sm"
        className={cn("mt-0.5", isAgent && "!bg-primary !text-primary-foreground")}
      />
      <div className={cn("flex min-w-0 max-w-[85%] flex-col", isAgent && "items-end")}>
        <div className={cn("mb-1 flex items-center gap-2 text-xs", isAgent && "flex-row-reverse")}>
          <span className="font-semibold text-foreground">{message.sender}</span>
          <span className="tabular-nums text-muted-foreground">{message.timestamp}</span>
          {message.channel && (
            <span className="inline-flex items-center gap-1 text-muted-foreground" title={`Sent via ${message.channel}`}>
              <ChannelIcon className="size-3" />
            </span>
          )}
        </div>
        <div className={cn("flex items-start gap-1", isAgent && "flex-row-reverse")}>
          <div
            className={cn(
              "rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
              isAgent
                ? "rounded-tr-md bg-primary text-primary-foreground shadow-soft"
                : "rounded-tl-md bg-card text-card-foreground shadow-soft ring-1 ring-border",
            )}
          >
            {message.content}
          </div>
          <CopyButton text={message.content} />
        </div>
        {isAgent && message.channel === "Email" && message.emailSubject && (
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <CornerDownRight className="size-3" />
            {message.emailSubject}
          </span>
        )}
      </div>
    </div>
  );
}
