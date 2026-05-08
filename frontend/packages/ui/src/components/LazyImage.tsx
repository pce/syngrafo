import React, { useEffect, useRef, useState } from "react";

export interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
}

/**
 * Defers loading until the element scrolls near the viewport.
 * Uses `IntersectionObserver` so off-screen images never make a network request.
 * A Tailwind `animate-pulse` skeleton is shown while the image is pending.
 */
export const LazyImage: React.FC<LazyImageProps> = ({ src, alt, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (inView) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px 0px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [inView]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full flex items-center justify-center ${className ?? ""}`}
    >
      {inView ? (
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <div className="w-full h-full bg-[var(--theme-border)]/40 animate-pulse" />
      )}
    </div>
  );
};
