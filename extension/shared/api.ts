// Kaspa REST API helpers for the extension
const KAS_API = "https://api.kaspa.org";
const KAS_SOMPI = 1e8;

export async function fetchKasBalance(address: string): Promise<number> {
  const res = await fetch(`${KAS_API}/addresses/${encodeURIComponent(address)}/balance`);
  if (!res.ok) throw new Error(`Balance fetch failed: ${res.status}`);
  const data = await res.json();
  // API returns { address, balance } where balance is in sompi
  return (data?.balance ?? 0) / KAS_SOMPI;
}

export async function fetchKasUsdPrice(): Promise<number> {
  try {
    const res = await fetch(`${KAS_API}/info/price?stringOnly=false`);
    if (!res.ok) return 0;
    const data = await res.json();
    return data?.price ?? 0;
  } catch {
    return 0;
  }
}

export async function broadcastTransaction(txJson: string): Promise<string> {
  const res = await fetch(`${KAS_API}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: txJson,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Broadcast failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data?.transactionId ?? data?.txid ?? "";
}
