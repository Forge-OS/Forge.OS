import { C, mono } from "../../tokens";

export const Btn = ({children, onClick, variant = "primary", disabled, style = {}, size = "md", ...rest}: any) => {
  const s = {
    primary:{bg:`linear-gradient(90deg, ${C.accent} 0%, #7BE9CF 100%)`,color:"#04110E",border:`1px solid ${C.accent}55`,shadow:"0 10px 24px rgba(57,221,182,0.26)"},
    ghost:{bg:"transparent",color:C.text,border:`1px solid ${C.border}`,shadow:"none"},
    danger:{bg:C.dLow,color:C.danger,border:`1px solid ${C.danger}55`,shadow:"none"},
    warn:{bg:C.wLow,color:C.warn,border:`1px solid ${C.warn}50`,shadow:"none"},
  }[variant];

  return (
    <button
      {...rest}
      onClick={onClick}
      disabled={disabled}
      className={`forge-btn${rest.className ? ` ${rest.className}` : ""}`}
      style={{
        background:s.bg,
        color:s.color,
        border:s.border,
        borderRadius:10,
        padding:size==="sm"?"6px 12px":"10px 18px",
        fontSize:size==="sm"?11:12,
        cursor:disabled?"not-allowed":"pointer",
        opacity:disabled?0.45:1,
        fontWeight:700,
        letterSpacing:"0.08em",
        textTransform:"uppercase",
        boxShadow:s.shadow,
        transition:"all 0.16s ease",
        ...mono,
        ...style,
      }}
    >
      {children}
    </button>
  );
};
