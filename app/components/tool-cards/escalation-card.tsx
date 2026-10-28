import { AlertTriangle, Copy, CheckCircle2, ChevronDown, UserPlus, ArrowRight } from "lucide-react";
import { useState, useRef, useEffect } from "react";

// Escalating assigns the ticket to a teammate (an active staff account), raises its priority
// and saves the reason as an internal note. Nothing goes to the customer.
export interface EscalationTeammate {
  id: number;
  displayName: string;
}

interface EscalationCardProps {
  reason: string;
  priority: string;
  staff: EscalationTeammate[];
  onAssign?: (teammate: EscalationTeammate) => void;
  onCancel?: () => void;
  /** Completed: the teammate the ticket was assigned to */
  assignedTo?: string;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export function EscalationCard({ reason, priority, staff, onAssign, onCancel, assignedTo }: EscalationCardProps) {
  const [copied, setCopied] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [selected, setSelected] = useState<EscalationTeammate | null>(staff[0] ?? null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The staff list arrives after the card can first render
  const choice = selected ?? staff[0] ?? null;

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCopy = () => {
    const text = `Escalation
━━━━━━━━━━━━━━━━━━━━
Assigned to: ${assignedTo ?? choice?.displayName ?? ""}
Priority: ${priority}
Reason: ${reason}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAssign = () => {
    if (!choice) return;
    setAssigning(true);
    onAssign?.(choice);
  };

  const handleCancel = () => {
    setCancelled(true);
    onCancel?.();
  };

  if (cancelled) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-muted-foreground" />
          <span className="text-sm font-semibold text-muted-foreground line-through">Escalation Cancelled</span>
        </div>
      </div>
    );
  }

  // Pending: pick the teammate
  if (!assignedTo) {
    return (
      <div className="bg-card border border-yellow-500/30 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-yellow-500" />
            <span className="text-sm font-semibold text-foreground">Escalate Ticket</span>
          </div>
          <span className="px-2 py-0.5 bg-yellow-500/10 text-yellow-600 rounded text-xs font-medium uppercase">{priority}</span>
        </div>

        <div className="text-xs text-muted-foreground bg-muted p-2 rounded">{reason}</div>

        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">
            Assign to (the reason is saved as an internal note):
          </span>
          {choice ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                disabled={assigning}
                className="w-full flex items-center gap-2 px-3 py-2 bg-muted rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
              >
                <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium">
                  {initials(choice.displayName)}
                </div>
                <div className="text-left flex-1 text-sm font-medium text-foreground">{choice.displayName}</div>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </button>
              {showUserMenu && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg py-1 z-50">
                  {staff.map((member) => (
                    <button
                      key={member.id}
                      onClick={() => {
                        setSelected(member);
                        setShowUserMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
                    >
                      <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium">
                        {initials(member.displayName)}
                      </div>
                      <div className="flex-1 text-sm font-medium text-foreground">{member.displayName}</div>
                      {choice.id === member.id && <CheckCircle2 className="w-4 h-4 text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">No staff accounts to assign to.</div>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleCancel}
            disabled={assigning}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs border border-border text-foreground rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleAssign}
            disabled={!choice || assigning}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
          >
            <ArrowRight className="w-3 h-3" />
            Assign
          </button>
        </div>
      </div>
    );
  }

  // Completed: the ticket was assigned and the note saved
  return (
    <div className="bg-card border border-green-500/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-500" />
          <span className="text-sm font-semibold text-green-600">Ticket Escalated</span>
        </div>
        <span className="px-2 py-0.5 bg-green-500/10 text-green-600 rounded text-xs font-medium uppercase">{priority}</span>
      </div>

      <div className="flex items-center gap-3 p-2 bg-green-500/5 rounded-lg border border-green-500/20">
        <div className="w-8 h-8 rounded-full bg-green-500/20 text-green-600 flex items-center justify-center text-xs font-medium">
          {initials(assignedTo)}
        </div>
        <div>
          <div className="text-sm font-medium text-foreground">{assignedTo}</div>
          <div className="text-xs text-muted-foreground">Assigned, with the reason as an internal note</div>
        </div>
      </div>

      <div className="text-xs text-muted-foreground bg-muted p-2 rounded">{reason}</div>

      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1.5 text-xs border border-border text-foreground rounded hover:bg-accent transition-colors ml-auto"
          title="Copy details"
        >
          {copied ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
    </div>
  );
}
