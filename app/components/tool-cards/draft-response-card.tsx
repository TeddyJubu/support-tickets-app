import { Mail, Check, Edit3, Copy, CheckCircle2, Send } from "lucide-react";
import { useState } from "react";

interface DraftResponseCardProps {
  subject: string;
  body: string;
  tone: string;
  onUseReply: () => void;
  onSendEmail?: (subject: string, body: string) => void;
}

export function DraftResponseCard({
  subject,
  body,
  tone,
  onUseReply,
  onSendEmail,
}: DraftResponseCardProps) {
  const [copied, setCopied] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [usedAsDraft, setUsedAsDraft] = useState(false);
  const [editing, setEditing] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendEmail = () => {
    if (onSendEmail) {
      onSendEmail(subject, body);
      setEmailSent(true);
    }
  };

  const handleUseReply = () => {
    onUseReply();
    setUsedAsDraft(true);
  };

  const handleEdit = () => {
    setEditing(true);
    // Also put in composer for editing
    onUseReply();
    setTimeout(() => setEditing(false), 2000);
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            AI Draft Response
          </span>
        </div>
        <span className="text-xs px-2 py-1 bg-muted text-muted-foreground rounded-full capitalize">
          {tone}
        </span>
      </div>
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">Subject</div>
        <div className="text-xs font-medium text-foreground bg-muted p-2 rounded">
          {subject}
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">Message</div>
        <div className="text-xs text-foreground bg-muted p-3 rounded whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
          {body}
        </div>
      </div>
      <div className="flex flex-col gap-2 pt-2">
        {/* Primary actions */}
        <div className="flex gap-2">
          <button
            onClick={handleUseReply}
            disabled={usedAsDraft}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-muted text-foreground rounded-lg hover:bg-accent transition-colors text-xs font-medium disabled:opacity-50"
          >
            {usedAsDraft ? (
              <>
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                Added to Draft
              </>
            ) : (
              <>
                <Check className="w-3 h-3" />
                Use as Draft
              </>
            )}
          </button>
          {onSendEmail && (
            <button
              onClick={handleSendEmail}
              disabled={emailSent}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-xs font-medium disabled:opacity-50"
            >
              {emailSent ? (
                <>
                  <CheckCircle2 className="w-3 h-3" />
                  Email Sent
                </>
              ) : (
                <>
                  <Send className="w-3 h-3" />
                  Send Email
                </>
              )}
            </button>
          )}
        </div>
        {/* Secondary actions */}
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 border border-border text-foreground rounded-lg hover:bg-accent transition-colors text-xs"
            title="Copy to clipboard"
          >
            {copied ? (
              <CheckCircle2 className="w-3 h-3 text-green-500" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={handleEdit}
            disabled={editing}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 border border-border text-foreground rounded-lg hover:bg-accent transition-colors text-xs disabled:opacity-50"
            title="Edit draft"
          >
            {editing ? (
              <>
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                Editing...
              </>
            ) : (
              <>
                <Edit3 className="w-3 h-3" />
                Edit
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
