// Forge-OS Site Bridge — content script injected on forgeos.xyz
// Reads localStorage agent + wallet data and syncs to extension storage.

const AGENTS_KEY = "forgeos.session.agents.v2";
const WALLET_KEY = "forgeos.managed.wallet.v1";

function sync() {
  try {
    const agents = localStorage.getItem(AGENTS_KEY) ?? null;
    const wallet = localStorage.getItem(WALLET_KEY) ?? null;
    if (agents || wallet) {
      chrome.runtime.sendMessage({ type: "FORGEOS_SYNC", agents, wallet });
    }
  } catch {}
}

// Sync on load and whenever localStorage changes
sync();
window.addEventListener("storage", (e) => {
  if (e.key === AGENTS_KEY || e.key === WALLET_KEY) sync();
});
// Poll every 5s as a fallback (some storage changes don't fire the event)
setInterval(sync, 5000);
