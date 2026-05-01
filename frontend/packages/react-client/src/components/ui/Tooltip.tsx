import React, { useState } from "react";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  delay?: number;
}

/**
 * A lightweight, accessible Tooltip component.
 */
const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = "top",
  delay = 300,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  const showTooltip = () => {
    const id = setTimeout(() => setIsVisible(true), delay);
    setTimeoutId(id);
  };

  const hideTooltip = () => {
    if (timeoutId) clearTimeout(timeoutId);
    setIsVisible(false);
  };

  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <div
      className="relative flex items-center"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      {isVisible && (
        <div
          className={`absolute z-50 px-2 py-1 text-[10px] font-bold rounded shadow-xl whitespace-nowrap pointer-events-none animate-in fade-in zoom-in duration-150 border ${positionClasses[position]}`}
          role="tooltip"
          aria-live="polite"
          style={{
            backgroundColor: "var(--theme-surface)",
            color: "var(--theme-text)",
            borderColor: "var(--theme-border)",
            backdropFilter: "blur(4px)",
          }}
        >
          {content}
          <div
            className={`absolute w-2 h-2 rotate-45 ${
              position === "top"
                ? "top-full -translate-y-1/2 left-1/2 -translate-x-1/2 border-b border-r"
                : position === "bottom"
                  ? "bottom-full translate-y-1/2 left-1/2 -translate-x-1/2 border-t border-l"
                  : position === "left"
                    ? "left-full -translate-x-1/2 top-1/2 -translate-y-1/2 border-t border-r"
                    : "right-full translate-x-1/2 top-1/2 -translate-y-1/2 border-b border-l"
            }`}
            style={{
              backgroundColor: "var(--theme-surface)",
              borderColor: "var(--theme-border)",
            }}
          />
        </div>
      )}
    </div>
  );
};

export default Tooltip;
