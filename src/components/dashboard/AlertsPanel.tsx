import { C, mono } from "../../tokens";
import { Badge, Btn, Card, Inp, Label } from "../ui";

const ALERT_TYPES = [
  ["risk_event", "Risk Events"],
  ["queue_pending", "Queue Pending"],
  ["ai_outage", "AI Outage"],
  ["regime_shift", "Regime Shifts"],
  ["system", "System"],
] as const;

export function AlertsPanel({ config, onPatch, onToggleType, onSave, onTest, saving, lastResult }: any) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 700, ...mono }}>Alerts & Notifications</div>
          <div style={{ fontSize: 11, color: C.dim }}>
            Telegram, Discord, and email-webhook alerts for risk events, queue backlog, AI outages, and regime shifts.
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Badge text={config?.enabled ? "ALERTS ON" : "ALERTS OFF"} color={config?.enabled ? C.ok : C.warn} dot />
          {lastResult?.reason && <Badge text={String(lastResult.reason).toUpperCase()} color={lastResult.sent ? C.ok : C.warn} />}
        </div>
      </div>

      <Card p={14} style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <Label>Routing</Label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.dim, ...mono }}>
            <input type="checkbox" checked={Boolean(config?.enabled)} onChange={(e) => onPatch({ enabled: e.target.checked })} />
            ENABLE ALERTING
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 10 }}>
          <Inp
            label="Discord Webhook URL"
            value={config?.discordWebhookUrl || ""}
            onChange={(v: string) => onPatch({ discordWebhookUrl: v })}
            hint="Discord incoming webhook (optional)."
          />
          <Inp
            label="Telegram Bot API URL"
            value={config?.telegramBotApiUrl || ""}
            onChange={(v: string) => onPatch({ telegramBotApiUrl: v })}
            hint="Example: https://api.telegram.org/bot<token>/sendMessage"
          />
          <Inp
            label="Telegram Chat ID"
            value={config?.telegramChatId || ""}
            onChange={(v: string) => onPatch({ telegramChatId: v })}
            hint="Required if Telegram route is configured."
          />
          <Inp
            label="Email Webhook URL"
            value={config?.emailWebhookUrl || ""}
            onChange={(v: string) => onPatch({ emailWebhookUrl: v })}
            hint="Your backend endpoint that sends email notifications."
          />
          <Inp
            label="Min Alert Interval"
            value={String(config?.minIntervalSec || 90)}
            onChange={(v: string) => onPatch({ minIntervalSec: Math.max(15, Math.min(3600, Number(v) || 90)) })}
            type="number"
            suffix="sec"
            hint="Per-alert-key throttle to avoid spam."
          />
        </div>
      </Card>

      <Card p={14} style={{ marginBottom: 12 }}>
        <Label>Event Types</Label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
          {ALERT_TYPES.map(([key, label]) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, background: C.s2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "10px 12px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={Boolean(config?.eventToggles?.[key])}
                onChange={(e) => onToggleType(key, e.target.checked)}
              />
              <span style={{ fontSize: 11, color: C.text, ...mono }}>{label.toUpperCase()}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card p={14}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn onClick={onSave} disabled={saving}>{saving ? "SAVING..." : "SAVE ALERT CONFIG"}</Btn>
          <Btn onClick={onTest} variant="ghost" disabled={saving}>SEND TEST ALERT</Btn>
        </div>
        {lastResult && (
          <div style={{ marginTop: 10, fontSize: 11, color: lastResult.sent ? C.ok : C.warn, ...mono }}>
            {lastResult.sent
              ? `Alert sent${lastResult.sentCount ? ` (${lastResult.sentCount} route${lastResult.sentCount > 1 ? "s" : ""})` : ""}`
              : `Alert not sent: ${lastResult.reason || "unknown"}`}
            {Array.isArray(lastResult.failures) && lastResult.failures.length > 0 ? ` · ${lastResult.failures.join(" | ")}` : ""}
          </div>
        )}
      </Card>
    </div>
  );
}
