import { useState } from "react";
import { C, mono } from "../../tokens";
import { Badge, Btn, Card, Inp, Label } from "../ui";

const ALERT_TYPES = [
  ["risk_event", "Risk Events", "High-priority risk gate violations, kill-switch, drawdown halts"],
  ["queue_pending", "Queue Pending", "Transactions awaiting wallet signature (threshold-based)"],
  ["ai_outage", "AI Outage", "Quant engine failures and endpoint timeouts"],
  ["regime_shift", "Regime Shifts", "Market regime changes detected by quant"],
  ["tx_failure", "Transaction Failures", "Transaction broadcast failures and on-chain rejections"],
  ["confirmation_timeout", "Confirmation Timeout", "Transactions not confirmed within expected time"],
  ["low_balance", "Low Balance", "Wallet balance below configured threshold"],
  ["network_disconnect", "Network Disconnect", "Kaspa DAG feed disconnection alerts"],
  ["system", "System", "General system events and updates"],
] as const;

// CORS proxy for direct webhook calls (free, public proxy)
const CORS_PROXY = "https://corsproxy.io/?";

function testDiscordWebhook(webhookUrl: string): Promise<{success: boolean, message: string}> {
  return fetch(CORS_PROXY + encodeURIComponent(webhookUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      content: "🔔 Forge-OS test alert - your Discord webhook is working!" 
    }),
  }).then(() => ({ success: true, message: "Discord connected!" }))
   .catch((e) => ({ success: false, message: "Discord failed: " + e.message }));
}

function testTelegramWebhook(botApiUrl: string, chatId: string): Promise<{success: boolean, message: string}> {
  if (!botApiUrl || !chatId) {
    return Promise.resolve({ success: false, message: "Telegram: Bot URL and Chat ID required" });
  }
  return fetch(CORS_PROXY + encodeURIComponent(botApiUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      chat_id: chatId, 
      text: "🔔 Forge-OS test alert - your Telegram bot is working!",
      disable_web_page_preview: true,
    }),
  }).then(() => ({ success: true, message: "Telegram connected!" }))
   .catch((e) => ({ success: false, message: "Telegram failed: " + e.message }));
}

function testEmailWebhook(webhookUrl: string): Promise<{success: boolean, message: string}> {
  if (!webhookUrl) {
    return Promise.resolve({ success: false, message: "Email webhook URL required" });
  }
  return fetch(CORS_PROXY + encodeURIComponent(webhookUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      subject: "Forge-OS Test Alert", 
      message: "Your email webhook is working!",
    }),
  }).then(() => ({ success: true, message: "Email webhook connected!" }))
   .catch((e) => ({ success: false, message: "Email webhook failed: " + e.message }));
}

export function AlertsPanel({ config, onPatch, onToggleType, onSave, onTest, saving, lastResult }: any) {
  const isEnabled = Boolean(config?.enabled);
  const hasWebhook = Boolean(config?.discordWebhookUrl || config?.telegramBotApiUrl || config?.emailWebhookUrl);
  const [testing, setTesting] = useState({} as Record<string, boolean>);
  const [testResults, setTestResults] = useState({} as Record<string, {success: boolean, message: string}>);

  const handleTestChannel = async (channel: string) => {
    setTesting((p) => ({ ...p, [channel]: true }));
    setTestResults((p) => ({ ...p, [channel]: { success: false, message: "Testing..." } }));
    
    let result = { success: false, message: "Unknown channel" };
    
    if (channel === "discord") {
      result = await testDiscordWebhook(config?.discordWebhookUrl);
    } else if (channel === "telegram") {
      result = await testTelegramWebhook(config?.telegramBotApiUrl, config?.telegramChatId);
    } else if (channel === "email") {
      result = await testEmailWebhook(config?.emailWebhookUrl);
    }
    
    setTestResults((p) => ({ ...p, [channel]: result }));
    setTesting((p) => ({ ...p, [channel]: false }));
  };
  
  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, color: C.text, fontWeight: 700, ...mono, marginBottom: 4 }}>Alert Center</div>
          <div style={{ fontSize: 12, color: C.dim }}>
            Get notified via Discord, Telegram, or email when important events happen
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ 
            width: 12, height: 12, borderRadius: "50%", 
            background: isEnabled && hasWebhook ? C.ok : C.dim 
          }}/>
          <span style={{ fontSize: 11, color: isEnabled && hasWebhook ? C.ok : C.dim, ...mono }}>
            {isEnabled && hasWebhook ? "ACTIVE" : "INACTIVE"}
          </span>
        </div>
      </div>

      {/* Quick Start Guide */}
      <Card p={16} style={{ marginBottom: 16, background: `${C.accent}08`, border: `1px solid ${C.accent}30` }}>
        <div style={{ fontSize: 14, color: C.text, fontWeight: 600, marginBottom: 12, ...mono }}>🚀 Quick Start Guide</div>
        <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
          <div style={{ marginBottom: 8 }}><strong style={{ color: C.accent }}>1. Discord (Easiest):</strong> Go to Server Settings → Integrations → Create Webhook → Copy URL → Paste below</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: C.accent }}>2. Telegram:</strong> Message @BotFather to create a bot → Copy API token → Message your bot once → Get Chat ID → Paste both below</div>
          <div><strong style={{ color: C.accent }}>3. Test:</strong> Click "Test" next to each channel to verify it works, then click "Save Config"</div>
        </div>
      </Card>

      {/* Status Card */}
      <Card p={16} style={{ marginBottom: 16, background: isEnabled ? `${C.ok}08` : `${C.dim}08`, border: `1px solid ${isEnabled ? C.ok : C.dim}30` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input 
                type="checkbox" 
                checked={isEnabled} 
                onChange={(e) => onPatch({ enabled: e.target.checked })} 
                style={{ width: 18, height: 18, accentColor: C.ok }}
              />
              <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>Enable Alerts</span>
            </label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {lastResult?.reason && (
              <Badge 
                text={lastResult.sent ? "SENT" : lastResult.reason.replace(/_/g, " ")} 
                color={lastResult.sent ? C.ok : C.warn} 
              />
            )}
          </div>
        </div>
      </Card>

      {/* Webhooks - Simplified */}
      <Card p={0} style={{ marginBottom: 16 }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, background: C.s2 }}>
          <span style={{ fontSize: 12, color: C.text, fontWeight: 600, ...mono }}>📱 Notification Channels</span>
        </div>
        <div style={{ padding: 16 }}>
          {/* Discord */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>Discord</span>
                {config?.discordWebhookUrl && (
                  <Badge 
                    text={testResults?.discord?.success ? "✓ Connected" : testResults?.discord ? "✗ Failed" : ""} 
                    color={testResults?.discord?.success ? C.ok : C.danger} 
                  />
                )}
              </div>
              <Btn 
                onClick={() => handleTestChannel("discord")} 
                variant="ghost" 
                size="sm"
                disabled={!config?.discordWebhookUrl || testing?.discord}
              >
                {testing?.discord ? "Testing..." : "Test"}
              </Btn>
            </div>
            <Inp
              label="Discord Webhook URL"
              value={config?.discordWebhookUrl || ""}
              onChange={(v: string) => {
                onPatch({ discordWebhookUrl: v });
                setTestResults((p) => ({ ...p, discord: undefined }));
              }}
              placeholder="https://discord.com/api/webhooks/..."
            />
            {testResults?.discord && (
              <div style={{ fontSize: 11, color: testResults.discord.success ? C.ok : C.danger, marginTop: 4 }}>
                {testResults.discord.message}
              </div>
            )}
          </div>

          {/* Telegram */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>Telegram</span>
                {config?.telegramBotApiUrl && config?.telegramChatId && (
                  <Badge 
                    text={testResults?.telegram?.success ? "✓ Connected" : testResults?.telegram ? "✗ Failed" : ""} 
                    color={testResults?.telegram?.success ? C.ok : C.danger} 
                  />
                )}
              </div>
              <Btn 
                onClick={() => handleTestChannel("telegram")} 
                variant="ghost" 
                size="sm"
                disabled={!config?.telegramBotApiUrl || !config?.telegramChatId || testing?.telegram}
              >
                {testing?.telegram ? "Testing..." : "Test"}
              </Btn>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Inp
                label="Telegram Bot Token"
                value={config?.telegramBotApiUrl || ""}
                onChange={(v: string) => {
                  onPatch({ telegramBotApiUrl: v });
                  setTestResults((p) => ({ ...p, telegram: undefined }));
                }}
                placeholder="https://api.telegram.org/bot..."
              />
              <Inp
                label="Chat ID"
                value={config?.telegramChatId || ""}
                onChange={(v: string) => {
                  onPatch({ telegramChatId: v });
                  setTestResults((p) => ({ ...p, telegram: undefined }));
                }}
                placeholder="Your chat ID"
              />
            </div>
            {testResults?.telegram && (
              <div style={{ fontSize: 11, color: testResults.telegram.success ? C.ok : C.danger, marginTop: 4 }}>
                {testResults.telegram.message}
              </div>
            )}
          </div>

          {/* Email */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>Email (Custom Server)</span>
                {config?.emailWebhookUrl && (
                  <Badge 
                    text={testResults?.email?.success ? "✓ Connected" : testResults?.email ? "✗ Failed" : ""} 
                    color={testResults?.email?.success ? C.ok : C.danger} 
                  />
                )}
              </div>
              <Btn 
                onClick={() => handleTestChannel("email")} 
                variant="ghost" 
                size="sm"
                disabled={!config?.emailWebhookUrl || testing?.email}
              >
                {testing?.email ? "Testing..." : "Test"}
              </Btn>
            </div>
            <Inp
              label="Email Webhook URL"
              value={config?.emailWebhookUrl || ""}
              onChange={(v: string) => {
                onPatch({ emailWebhookUrl: v });
                setTestResults((p) => ({ ...p, email: undefined }));
              }}
              placeholder="https://your-backend.com/email"
            />
            {testResults?.email && (
              <div style={{ fontSize: 11, color: testResults.email.success ? C.ok : C.danger, marginTop: 4 }}>
                {testResults.email.message}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Threshold Settings */}
      <Card p={0} style={{ marginBottom: 16 }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, background: C.s2 }}>
          <span style={{ fontSize: 12, color: C.text, fontWeight: 600, ...mono }}>Alert Thresholds</span>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
            <Inp
              label="Queue Pending Threshold"
              value={String(config?.queuePendingThreshold || 3)}
              onChange={(v: string) => onPatch({ queuePendingThreshold: Math.max(1, Math.min(50, Number(v) || 3)) })}
              type="number"
              suffix="txns"
              hint="Alert when pending exceeds this count"
            />
            <Inp
              label="Low Balance Threshold"
              value={String(config?.lowBalanceThreshold || 100)}
              onChange={(v: string) => onPatch({ lowBalanceThreshold: Math.max(0, Math.min(100000, Number(v) || 100)) })}
              type="number"
              suffix="KAS"
              hint="Alert when balance drops below"
            />
          </div>
        </div>
      </Card>

      {/* Event Types */}
      <Card p={0} style={{ marginBottom: 16 }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, background: C.s2 }}>
          <span style={{ fontSize: 12, color: C.text, fontWeight: 600, ...mono }}>Alert Triggers</span>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
            {ALERT_TYPES.map(([key, label, desc]) => {
              const isOn = Boolean(config?.eventToggles?.[key]);
              return (
                <label 
                  key={key} 
                  style={{ 
                    display: "flex", 
                    alignItems: "flex-start", 
                    gap: 10, 
                    background: isOn ? `${C.ok}10` : C.s2, 
                    border: `1px solid ${isOn ? C.ok : C.border}`, 
                    borderRadius: 8, 
                    padding: "12px 14px", 
                    cursor: "pointer",
                    transition: "all 0.15s"
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={(e) => onToggleType(key, e.target.checked)}
                    style={{ marginTop: 2, width: 16, height: 16, accentColor: C.ok }}
                  />
                  <div>
                    <div style={{ fontSize: 12, color: isOn ? C.ok : C.text, fontWeight: 600, ...mono }}>{label}</div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{desc}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Actions */}
      <Card p={16}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={onSave} disabled={saving}>{saving ? "SAVING..." : "SAVE CONFIG"}</Btn>
            <Btn onClick={onTest} variant="ghost" disabled={saving}>TEST ALERT</Btn>
          </div>
          {lastResult && (
            <div style={{ fontSize: 11, color: lastResult.sent ? C.ok : C.warn, ...mono }}>
              {lastResult.sent 
                ? `✓ Sent via ${lastResult.sentCount} channel${lastResult.sentCount > 1 ? "s" : ""}`
                : `✗ ${lastResult.reason?.replace(/_/g, " ") || "Failed"}`}
              {Array.isArray(lastResult.failures) && lastResult.failures.length > 0 && (
                <span style={{ color: C.danger }}> · {lastResult.failures.join(", ")}</span>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
