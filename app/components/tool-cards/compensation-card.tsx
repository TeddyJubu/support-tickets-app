import {
  DollarSign,
  Send,
  CheckCircle2,
  Star,
  X,
  ArrowRight,
} from "lucide-react";
import { useState } from "react";

interface CompensationOption {
  type: string;
  value: string;
  description: string;
}

interface CompensationCardProps {
  options: CompensationOption[];
  reasoning: string;
  customerValue: string;
  /** Mode: "select" for approval-required state, "sent" for completed state */
  mode?: "select" | "sent";
  /** Called when user selects an offer (approval-required mode) */
  onSelectOffer?: (option: CompensationOption) => void;
  /** Called when user cancels (approval-required mode) */
  onCancel?: () => void;
  /** The offer that was selected (sent mode) */
  selectedOffer?: CompensationOption;
  /** Legacy: Called when user sends an offer (for backwards compatibility) */
  onSendOffer?: (option: { type: string; value: string }) => void;
}

export function CompensationCard({
  options,
  reasoning,
  customerValue,
  mode,
  onSelectOffer,
  onCancel,
  selectedOffer,
  onSendOffer,
}: CompensationCardProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [sentOffers, setSentOffers] = useState<Set<number>>(new Set());
  const recommendedIndex = 0; // First option is recommended

  // Legacy mode (backwards compatibility)
  if (!mode && onSendOffer) {
    const handleSend = (option: CompensationOption, index: number) => {
      onSendOffer(option);
      setSentOffers((prev) => new Set([...prev, index]));
    };

    return (
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-500" />
            <span className="text-sm font-semibold text-foreground">
              Retention Offers
            </span>
          </div>
          <span className="text-xs px-2 py-1 bg-muted text-muted-foreground rounded-full">
            LTV: {customerValue}
          </span>
        </div>
        <p className="text-xs text-muted-foreground bg-muted p-2 rounded">
          {reasoning}
        </p>
        <div className="space-y-2">
          {options.map((option, i) => (
            <div
              key={i}
              className={`p-3 bg-muted rounded-lg ${i === recommendedIndex ? "ring-1 ring-primary/50" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {option.type}
                    </span>
                    {i === recommendedIndex && (
                      <span className="flex items-center gap-1 text-xs text-primary">
                        <Star className="w-3 h-3 fill-current" />
                        Best fit
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {option.description}
                  </div>
                </div>
                <span className="text-sm font-semibold text-green-500 whitespace-nowrap">
                  {option.value}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50">
                <button
                  onClick={() => handleSend(option, i)}
                  disabled={sentOffers.has(i)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {sentOffers.has(i) ? (
                    <>
                      <CheckCircle2 className="w-3 h-3" />
                      Sent
                    </>
                  ) : (
                    <>
                      <Send className="w-3 h-3" />
                      Send Offer
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Selection mode (approval-required state)
  if (mode === "select") {
    return (
      <div className="bg-card border border-yellow-500/30 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-yellow-500" />
            <span className="text-sm font-semibold text-foreground">
              Select Compensation Offer
            </span>
          </div>
          <span className="text-xs px-2 py-1 bg-muted text-muted-foreground rounded-full">
            LTV: {customerValue}
          </span>
        </div>

        <p className="text-xs text-muted-foreground bg-muted p-2 rounded">
          {reasoning}
        </p>

        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">
            Click an offer to send to customer:
          </span>
          {options.map((option, i) => (
            <button
              key={i}
              onClick={() => onSelectOffer?.(option)}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              className={`w-full text-left p-3 rounded-lg transition-all ${
                i === recommendedIndex
                  ? "bg-primary/10 ring-1 ring-primary/50 hover:bg-primary/20"
                  : "bg-muted hover:bg-accent"
              } ${hoveredIndex === i ? "scale-[1.01]" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {option.type}
                    </span>
                    {i === recommendedIndex && (
                      <span className="flex items-center gap-1 text-xs text-primary">
                        <Star className="w-3 h-3 fill-current" />
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {option.description}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-green-500 whitespace-nowrap">
                    {option.value}
                  </span>
                  <ArrowRight
                    className={`w-4 h-4 text-primary transition-opacity ${hoveredIndex === i ? "opacity-100" : "opacity-0"}`}
                  />
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="pt-2 border-t border-border">
          <button
            onClick={onCancel}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            <X className="w-3 h-3" />
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Sent mode (completed state)
  if (mode === "sent" && selectedOffer) {
    return (
      <div className="bg-card border border-green-500/30 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <span className="text-sm font-semibold text-green-600">
              Compensation Sent
            </span>
          </div>
          <span className="text-xs px-2 py-1 bg-muted text-muted-foreground rounded-full">
            LTV: {customerValue}
          </span>
        </div>

        <div className="p-3 bg-green-500/5 rounded-lg border border-green-500/20">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {selectedOffer.type}
                </span>
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <Send className="w-3 h-3" />
                  Sent to customer
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {selectedOffer.description}
              </div>
            </div>
            <span className="text-sm font-semibold text-green-500 whitespace-nowrap">
              {selectedOffer.value}
            </span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          The customer will receive this offer via email. You can follow up in
          the conversation to discuss details.
        </p>
      </div>
    );
  }

  return null;
}
