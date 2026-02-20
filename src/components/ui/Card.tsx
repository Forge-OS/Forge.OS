import { C } from "../../tokens";

export const Card = ({children, p = 16, style = {}}: any) => (
  <div
    style={{
      background:`linear-gradient(165deg, ${C.s2} 0%, #0a1725 52%, ${C.s1} 100%)`,
      border:`1px solid ${C.border}cc`,
      borderRadius:14,
      padding:p,
      boxShadow:`${C.shadow}, inset 0 1px 0 rgba(255,255,255,0.04)`,
      backdropFilter:"blur(6px)",
      transition:"border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease",
      ...style,
    }}
  >
    {children}
  </div>
);
