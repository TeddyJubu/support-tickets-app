import { cn } from "@/lib/utils";
import { Brain, Check, Copy, CheckCircle2, MessageSquare } from "lucide-react";
import { useState } from "react";
import type { Sentiment } from "../types";

interface SentimentCardProps {
  sentiment: Sentiment;
}

// Suggested tones based on sentiment
const suggestedTones: Record<string, string> = {
  positive: "Keep the positive momentum! Use an upbeat, appreciative tone.",
  neutral: "Stay professional and helpful. Address concerns directly.",
  negative: "Use empathetic language. Acknowledge frustration first.",
  frustrated: "Lead with empathy. Apologize and focus on solutions.",
  "neutral-concerned":
    "Be understanding and reassuring. Show you care about their concerns.",
};

export function SentimentCard({ sentiment }: SentimentCardProps) {
  const [copied, setCopied] = useState(false);
  const [showTone, setShowTone] = useState(false);

  const colors: Record<string, string> = {
    positive: "text-green-500",
    neutral: "text-yellow-500",
    negative: "text-red-500",
    frustrated: "text-red-500",
  };

  const bgColors: Record<string, string> = {
    positive: "bg-green-500/10",
    neutral: "bg-yellow-500/10",
    negative: "bg-red-500/10",
    frustrated: "bg-red-500/10",
  };

  const handleCopy = () => {
    const text = `Sentiment Analysis
━━━━━━━━━━━━━━━━━━━━
${sentiment.emoji} ${sentiment.label}

Indicators:
${sentiment.reasons.map((r) => `• ${r}`).join("\n")}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const suggestedTone =
    suggestedTones[sentiment.label.toLowerCase()] || suggestedTones["neutral"];

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="w-5 h-5 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            Sentiment Analysis
          </span>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-2 px-4 py-0.5 rounded-full",
            bgColors[sentiment.label.toLowerCase()] || "bg-muted",
          )}
        >
          <span className="text-lg">{sentiment.emoji}</span>
          <span
            className={cn(
              "text-xs font-medium capitalize",
              colors[sentiment.label.toLowerCase()] || "text-foreground",
            )}
          >
            {sentiment.label}
          </span>
        </span>
      </div>
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground uppercase">
          Key Indicators
        </div>
        <ul className="space-y-1">
          {sentiment.reasons.map((reason, i) => (
            <li
              key={i}
              className="flex items-center gap-2 text-sm text-foreground"
            >
              <Check className="w-3 h-3 text-green-500" />
              {reason}
            </li>
          ))}
        </ul>
      </div>
      {showTone && (
        <div className="p-2 bg-primary/10 rounded text-xs text-primary border border-primary/20">
          <span className="font-medium">Suggested Tone:</span> {suggestedTone}
        </div>
      )}
      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <button
          onClick={() => setShowTone(!showTone)}
          className={cn(
            "flex items-center gap-1 px-3 py-1.5 text-xs rounded transition-colors",
            showTone
              ? "bg-primary/20 text-primary"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          <MessageSquare className="w-3 h-3" />
          {showTone ? "Hide Tone" : "Suggested Tone"}
        </button>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1.5 text-xs border border-border text-foreground rounded hover:bg-accent transition-colors ml-auto"
          title="Copy analysis"
        >
          {copied ? (
            <CheckCircle2 className="w-3 h-3 text-green-500" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      </div>
    </div>
  );
}
