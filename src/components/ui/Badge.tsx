import { C, mono } from "../../tokens";

export const Badge = ({text, color = C.accent, dot, ...rest}: any) => (
  <span
    {...rest}
    style={{background:color+"18", color, border:`1px solid ${color}35`, borderRadius:6, padding:"3px 9px", fontSize:11, letterSpacing:"0.04em", ...mono, display:"inline-flex", alignItems:"center", gap:5, whiteSpace:"nowrap"}}
  >
    {dot && <span style={{width:5, height:5, borderRadius:"50%", background:color, display:"inline-block"}}/>}{text}
  </span>
);
