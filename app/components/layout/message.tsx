"use client";

import { cn } from "@/lib/utils";
import {
  Copy,
  ThumbsUp,
  ThumbsDown,
  Share,
  Trash2,
  MessageCircle,
  Mail,
} from "lucide-react";
import type { TicketMessage } from "../types";

interface MessageProps {
  message: TicketMessage;
}

// Check if avatar is a URL or initials
function isAvatarUrl(avatar?: string): boolean {
  return avatar?.startsWith("http") || avatar?.startsWith("/") || false;
}

// Online status indicator component
function OnlineStatus({ isOnline }: { isOnline?: boolean }) {
  return (
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background",
        isOnline ? "bg-green-500" : "bg-gray-400",
      )}
    />
  );
}

export function Message({ message }: MessageProps) {
  if (message.type === "system") {
    return (
      <div className="flex items-center justify-center py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center">
            <MessageCircle className="w-3 h-3" />
          </div>
          <span>{message.content}</span>
          <span className="text-muted-foreground/60">
            • {message.timestamp}
          </span>
        </div>
      </div>
    );
  }

  const isAgent = message.type === "agent";
  const hasImageAvatar = isAvatarUrl(message.avatar);

  return (
    <div
      className={cn(
        "flex gap-3 py-4 group",
        isAgent && "bg-accent/50 px-4 -mx-4 rounded-xl",
      )}
    >
      {/* Avatar - supports both image URLs and text initials with online status */}
      <div className="relative shrink-0 w-9 h-9 self-start">
        {hasImageAvatar ? (
          <img
            src={message.avatar}
            alt={message.sender}
            className="w-9 h-9 rounded-full object-cover"
          />
        ) : (
          <div
            className={cn(
              "w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold",
              isAgent
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {message.avatar}
          </div>
        )}
        {/* Show online status for customer messages */}
        {!isAgent && <OnlineStatus isOnline={message.isOnline} />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-foreground">
            {message.sender}
          </span>
          <span className="text-xs text-muted-foreground">
            • {message.timestamp}
          </span>
          {message.channel && (
            <>
              <span className="text-xs text-muted-foreground">•</span>
              <span className="inline-flex items-center gap-1 text-xs text-primary font-medium">
                {message.channel === "Email" ? (
                  <Mail className="w-3 h-3" />
                ) : (
                  <MessageCircle className="w-3 h-3" />
                )}
                {message.channel}
              </span>
            </>
          )}
        </div>

        {/* Email message with subject */}
        {message.channel === "Email" && message.emailSubject ? (
          <div className="mt-2 border border-border rounded-lg overflow-hidden">
            <div className="bg-muted px-3 py-2 border-b border-border">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-primary" />
                <span className="text-xs font-medium text-muted-foreground">
                  Subject:
                </span>
                <span className="text-sm font-medium text-foreground">
                  {message.emailSubject}
                </span>
              </div>
            </div>
            <div className="p-3 text-sm text-foreground leading-relaxed whitespace-pre-wrap bg-card">
              {message.content}
            </div>
          </div>
        ) : (
          <p className="mt-1.5 text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {message.content}
          </p>
        )}
      </div>

      {isAgent && (
        <div className="flex items-start gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-background rounded">
            <Copy className="w-4 h-4" />
          </button>
          <button className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-background rounded">
            <ThumbsUp className="w-4 h-4" />
          </button>
          <button className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-background rounded">
            <ThumbsDown className="w-4 h-4" />
          </button>
          <button className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-background rounded">
            <Share className="w-4 h-4" />
          </button>
          <button className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-background rounded">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
