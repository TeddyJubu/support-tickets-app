import {
  Lightbulb,
  Zap,
  Copy,
  CheckCircle2,
  Edit3,
  X,
  Check,
  GripVertical,
} from "lucide-react";
import { useState } from "react";

interface ResolutionSuggestionCardProps {
  suggestion: string;
  confidence: number;
  reasoning: string;
  steps: string[];
  /** Mode: "confirm" for approval-required, "applied" for completed */
  mode?: "confirm" | "applied";
  /** Called when user confirms resolution (confirm mode) */
  onConfirm?: (modifiedSteps?: string[]) => void;
  /** Called when user cancels (confirm mode) */
  onCancel?: () => void;
  /** Legacy: Called when user applies resolution */
  onApply?: () => void;
}

export function ResolutionSuggestionCard({
  suggestion,
  confidence,
  reasoning,
  steps,
  mode,
  onConfirm,
  onCancel,
  onApply,
}: ResolutionSuggestionCardProps) {
  const [applied, setApplied] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editableSteps, setEditableSteps] = useState<string[]>(steps);
  const [isEditing, setIsEditing] = useState(false);

  const handleApply = () => {
    onApply?.();
    setApplied(true);
  };

  const handleCopySteps = () => {
    const stepsToUse = isEditing ? editableSteps : steps;
    const text = `Resolution: ${suggestion}\n\nSteps:\n${stepsToUse.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEdit = () => {
    setEditing(true);
    setTimeout(() => setEditing(false), 2000);
  };

  const handleStepChange = (index: number, value: string) => {
    const newSteps = [...editableSteps];
    newSteps[index] = value;
    setEditableSteps(newSteps);
  };

  // Legacy mode (backwards compatibility)
  if (!mode && onApply) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-yellow-500" />
            <span className="text-sm font-semibold text-foreground">
              AI Recommendation
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-16 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full"
                style={{ width: `${confidence}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground font-medium">
              {confidence}%
            </span>
          </div>
        </div>
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-sm font-medium text-foreground">{suggestion}</p>
          <p className="text-xs text-muted-foreground mt-2">{reasoning}</p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase">
              Resolution Steps
            </span>
            <button
              onClick={handleCopySteps}
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
              title="Copy steps"
            >
              {copied ? (
                <CheckCircle2 className="w-3 h-3 text-green-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>
          <ol className="space-y-1">
            {steps.map((step, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-foreground"
              >
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs shrink-0">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleApply}
            disabled={applied}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {applied ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Applied
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Apply Resolution
              </>
            )}
          </button>
          <button
            onClick={handleEdit}
            disabled={editing}
            className="px-3 py-2 border border-border text-foreground rounded-lg hover:bg-accent transition-colors text-sm disabled:opacity-50"
            title="Edit steps"
          >
            {editing ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : (
              <Edit3 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    );
  }

  // Confirm mode (approval-required state)
  if (mode === "confirm") {
    return (
      <div className="bg-card border border-yellow-500/30 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-yellow-500" />
            <span className="text-sm font-semibold text-foreground">
              Confirm Resolution
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-16 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full"
                style={{ width: `${confidence}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground font-medium">
              {confidence}% match
            </span>
          </div>
        </div>

        <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
          <p className="text-sm font-medium text-foreground">{suggestion}</p>
          <p className="text-xs text-muted-foreground mt-2">{reasoning}</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase">
              Resolution Steps
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsEditing(!isEditing)}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                  isEditing
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                <Edit3 className="w-3 h-3" />
                {isEditing ? "Editing" : "Edit"}
              </button>
              <button
                onClick={handleCopySteps}
                className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                title="Copy steps"
              >
                {copied ? (
                  <CheckCircle2 className="w-3 h-3 text-green-500" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>

          <ol className="space-y-1.5">
            {(isEditing ? editableSteps : steps).map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                {isEditing && (
                  <GripVertical className="w-4 h-4 text-muted-foreground/50 mt-0.5 cursor-grab" />
                )}
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs shrink-0">
                  {i + 1}
                </span>
                {isEditing ? (
                  <input
                    type="text"
                    value={step}
                    onChange={(e) => handleStepChange(i, e.target.value)}
                    className="flex-1 bg-muted px-2 py-1 rounded text-sm text-foreground border border-border focus:border-primary focus:outline-none"
                  />
                ) : (
                  <span className="text-foreground">{step}</span>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex gap-2 pt-2 border-t border-border">
          <button
            onClick={onCancel}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs border border-border text-foreground rounded-lg hover:bg-accent transition-colors"
          >
            <X className="w-3 h-3" />
            Cancel
          </button>
          <button
            onClick={() => onConfirm?.(isEditing ? editableSteps : undefined)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
          >
            <Check className="w-3 h-3" />
            Apply Resolution
          </button>
        </div>
      </div>
    );
  }

  // Applied mode (completed state)
  if (mode === "applied") {
    return (
      <div className="bg-card border border-green-500/30 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <span className="text-sm font-semibold text-green-600">
              Resolution Applied
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-16 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full"
                style={{ width: `${confidence}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground font-medium">
              {confidence}%
            </span>
          </div>
        </div>

        <div className="p-3 bg-green-500/5 rounded-lg border border-green-500/20">
          <p className="text-sm font-medium text-foreground">{suggestion}</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase">
              Action Steps
            </span>
            <button
              onClick={handleCopySteps}
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
              title="Copy steps"
            >
              {copied ? (
                <CheckCircle2 className="w-3 h-3 text-green-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>
          <ol className="space-y-1">
            {steps.map((step, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-foreground"
              >
                <span className="w-5 h-5 rounded-full bg-green-500/20 text-green-600 flex items-center justify-center text-xs shrink-0">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        <p className="text-xs text-muted-foreground pt-2 border-t border-border">
          Follow these steps to resolve the customer's issue. The AI will assist
          you along the way.
        </p>
      </div>
    );
  }

  return null;
}
