import {
  FileText,
  ExternalLink,
  Copy,
  CheckCircle2,
  BookOpen,
} from "lucide-react";
import { useState } from "react";

interface Article {
  title: string;
  snippet: string;
  relevance?: number;
  /** Optional link opened by the "Open" button */
  href?: string;
  /** Optional click handler for the "Open" button (takes precedence over href) */
  onOpen?: () => void;
}

interface KnowledgeBaseCardProps {
  articles: Article[];
  /** Card heading, e.g. "Products" (defaults to "Knowledge Base") */
  title?: string;
  /** Plural noun for the count badge (defaults to "articles") */
  itemLabel?: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export function KnowledgeBaseCard({
  articles,
  title = "Knowledge Base",
  itemLabel = "articles",
  icon: Icon = BookOpen,
}: KnowledgeBaseCardProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = (article: Article, index: number) => {
    navigator.clipboard.writeText(`${article.title}\n\n${article.snippet}`);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-5 h-5 text-primary" />
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="ml-auto text-xs px-2 py-1 bg-muted text-muted-foreground rounded-full">
          {articles.length} {itemLabel}
        </span>
      </div>
      <div className="space-y-2">
        {articles.map((article, i) => (
          <div key={i} className="p-3 bg-muted rounded-lg">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h5 className="text-sm font-medium text-foreground">
                  {article.title}
                </h5>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {article.snippet}
                </p>
              </div>
              {article.relevance != null && (
                <span className="text-xs text-green-500 font-medium whitespace-nowrap">
                  {article.relevance}%
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50">
              {(article.onOpen || article.href) && (
                <button
                  onClick={() =>
                    article.onOpen
                      ? article.onOpen()
                      : window.open(article.href, "_blank", "noopener,noreferrer")
                  }
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
                  title="Open"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open
                </button>
              )}
              <button
                onClick={() => handleCopy(article, i)}
                className="flex items-center gap-1 px-2 py-1 text-xs border border-border text-foreground rounded hover:bg-accent transition-colors"
                title="Copy snippet"
              >
                {copiedIndex === i ? (
                  <CheckCircle2 className="w-3 h-3 text-green-500" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
              {article.relevance != null && (
                <div className="flex items-center gap-1 ml-auto">
                  <div className="h-1.5 w-12 bg-background rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full"
                      style={{ width: `${article.relevance}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
