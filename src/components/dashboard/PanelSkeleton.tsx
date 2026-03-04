import { C } from "../../tokens";

/** Shimmer skeleton used as Suspense fallback for lazy-loaded dashboard panels. */
export function PanelSkeleton({ label, lines = 3 }: { label?: string; lines?: number }) {
  return (
    <div style={{background:`linear-gradient(165deg, rgba(16,25,35,0.52) 0%, rgba(10,17,28,0.34) 52%, rgba(16,25,35,0.52) 100%)`, border:`1px solid rgba(57,221,182,0.1)`, borderRadius:14, padding:18, marginBottom:0}}>
      {label && (
        <div className="forge-shimmer" style={{width:96, height:10, borderRadius:4, marginBottom:14}}/>
      )}
      {Array.from({length: lines}).map((_, i) => (
        <div
          key={i}
          className="forge-shimmer"
          style={{height:10, borderRadius:4, marginBottom:i < lines - 1 ? 8 : 0, width: i === lines - 1 ? "60%" : "100%"}}
        />
      ))}
    </div>
  );
}
