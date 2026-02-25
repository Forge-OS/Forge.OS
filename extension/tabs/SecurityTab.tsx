import { useState } from "react";
import { C, mono } from "../../src/tokens";
import { shortAddr } from "../../src/helpers";
import { clearManagedWallet, type ManagedWallet } from "../shared/storage";

interface Props {
  wallet: ManagedWallet | null;
  network: string;
}

export function SecurityTab({ wallet, network }: Props) {
  const [showPhrase, setShowPhrase] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const handleClear = async () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    await clearManagedWallet();
    chrome.tabs.create({ url: "https://forgeos.xyz" });
    window.close();
  };

  const words = wallet?.phrase?.split(" ") ?? [];
  const hasManagedWallet = Boolean(wallet?.phrase);
  const provider = hasManagedWallet ? "managed" : wallet?.address ? "watch-only" : "none";

  return (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>

      {/* Provider + network */}
      <div style={{ background: "rgba(8,13,20,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
        <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.12em", marginBottom: 8 }}>CONNECTION STATUS</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <div style={{ fontSize: 7, color: C.dim, marginBottom: 3 }}>PROVIDER</div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: wallet ? C.ok : C.warn }} />
              <span style={{ fontSize: 9, color: C.text, fontWeight: 700 }}>{provider.toUpperCase()}</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 7, color: C.dim, marginBottom: 3 }}>NETWORK</div>
            <span style={{
              fontSize: 8, color: network === "mainnet" ? C.warn : C.ok, fontWeight: 700,
              background: network === "mainnet" ? `${C.warn}15` : `${C.ok}15`,
              border: `1px solid ${network === "mainnet" ? C.warn : C.ok}30`,
              borderRadius: 3, padding: "2px 6px",
            }}>{network.toUpperCase()}</span>
          </div>
          {wallet?.address && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: 7, color: C.dim, marginBottom: 3 }}>ADDRESS</div>
              <div style={{ fontSize: 8, color: C.text }}>{shortAddr(wallet.address)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Seed phrase backup */}
      <div style={{ background: hasManagedWallet ? `${C.ok}0A` : `${C.warn}0A`, border: `1px solid ${hasManagedWallet ? C.ok : C.warn}30`, borderRadius: 10, padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 12 }}>{hasManagedWallet ? "🔑" : "⚠"}</span>
          <span style={{ fontSize: 9, color: hasManagedWallet ? C.ok : C.warn, fontWeight: 700, letterSpacing: "0.08em" }}>
            {hasManagedWallet ? "SEED PHRASE STORED" : "NO MANAGED WALLET"}
          </span>
        </div>
        <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.5, marginBottom: 8 }}>
          {hasManagedWallet
            ? "Your 24-word seed phrase is stored locally. Keep it backed up offline. Never share it."
            : "Connect or create a wallet on Forge-OS to manage keys here."}
        </div>

        {hasManagedWallet && (
          <>
            <button
              onClick={() => setShowPhrase(v => !v)}
              style={{
                background: showPhrase ? `${C.warn}15` : "rgba(33,48,67,0.5)",
                border: `1px solid ${showPhrase ? C.warn : C.border}`,
                borderRadius: 6, padding: "6px 10px",
                color: showPhrase ? C.warn : C.dim, fontSize: 8, cursor: "pointer",
                ...mono, letterSpacing: "0.08em", fontWeight: 700, width: "100%", marginBottom: 6,
              }}
            >{showPhrase ? "HIDE SEED PHRASE" : "SHOW SEED PHRASE"}</button>

            {showPhrase && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 6 }}>
                {words.map((word, i) => (
                  <div key={i} style={{
                    background: "rgba(5,7,10,0.8)", border: `1px solid ${C.border}`,
                    borderRadius: 4, padding: "4px 5px",
                    display: "flex", alignItems: "center", gap: 3,
                  }}>
                    <span style={{ fontSize: 6, color: C.dim }}>{i + 1}.</span>
                    <span style={{ fontSize: 7, color: C.text, fontWeight: 600 }}>{word}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Security notes */}
      <div style={{ background: "rgba(8,13,20,0.4)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
        <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.1em", marginBottom: 6 }}>SECURITY NOTES</div>
        {[
          "Forge-OS never transmits your private key or seed phrase.",
          "All signing happens locally in the extension.",
          "Keys are stored only in chrome.storage.local on this device.",
        ].map((note, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: i < 2 ? 4 : 0 }}>
            <span style={{ color: C.ok, fontSize: 8, flexShrink: 0 }}>✓</span>
            <span style={{ fontSize: 7, color: C.dim, lineHeight: 1.5 }}>{note}</span>
          </div>
        ))}
      </div>

      {/* Danger zone */}
      {hasManagedWallet && (
        <div style={{ marginTop: 4 }}>
          <button
            onClick={handleClear}
            style={{
              background: confirmClear ? C.dLow : "rgba(8,13,20,0.4)",
              border: `1px solid ${C.danger}${confirmClear ? "70" : "30"}`,
              borderRadius: 8, padding: "7px", width: "100%",
              color: C.danger, fontSize: 8, cursor: "pointer", ...mono,
              letterSpacing: "0.08em", fontWeight: 700,
            }}
          >{confirmClear ? "⚠ CONFIRM — THIS CANNOT BE UNDONE" : "REMOVE WALLET FROM EXTENSION"}</button>
          {confirmClear && (
            <div style={{ fontSize: 7, color: C.danger, marginTop: 4, textAlign: "center" }}>
              Make sure your seed phrase is backed up before removing.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
