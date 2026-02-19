export const fmt  = (n: any, d = 4) => parseFloat(n || 0).toFixed(d);
export const fmtT = (ts: any) => new Date(ts).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
export const fmtD = (ts: any) => new Date(ts).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
export const shortAddr = (a: any) => a ? `${a.slice(0,18)}...${a.slice(-6)}` : "—";
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const uid = () => Math.random().toString(36).slice(2,10);

export const isKaspaAddress = (address: any) => {
  const v = String(address || "").trim().toLowerCase();
  return v.startsWith("kaspa:") || v.startsWith("kaspatest:");
};

export const normalizeKaspaAddress = (address: any) => {
  const v = String(address || "").trim();
  if(!isKaspaAddress(v)) {
    throw new Error("Invalid Kaspa address. Must start with 'kaspa:' or 'kaspatest:'");
  }
  return v;
};
