import { C } from "../../tokens";

export const Card = ({children, p = 16, style = {}, ...rest}: any) => (
  <div
    {...rest}
    style={{
      background:`linear-gradient(165deg, rgba(16,25,35,0.52) 0%, rgba(10,17,28,0.34) 52%, rgba(16,25,35,0.52) 100%)`,
      border:`1px solid rgba(57,221,182,0.1)`,
      borderRadius:14,
      padding:p,
      boxShadow:`0 18px 45px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.06)`,
      backdropFilter:"blur(22px)",
      WebkitBackdropFilter:"blur(22px)",
      transition:"border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease",
      ...style,
    }}
  >
    {children}
  </div>
);
