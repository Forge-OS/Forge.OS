import { useState, useEffect } from "react";
import { C, mono } from "../../tokens";
import { Badge, Btn, Card, Label } from "../ui";
import {
  buildDcaSchedule,
  setDcaEnabled,
  deleteDcaSchedule,
  getAllSchedules,
  describeDcaSchedule,
  formatCountdown,
  type DcaSchedule,
  type DcaFrequency,
} from "../../quant/dcaScheduler";

interface Props {
  currentPriceUsd?: number;
}

export function DcaPanel({ currentPriceUsd = 0 }: Props) {
  const [schedules, setSchedules] = useState<DcaSchedule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [freq, setFreq] = useState<DcaFrequency>("weekly");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [intervalHours, setIntervalHours] = useState("4");
  const [hour, setHour] = useState("9");
  const [minute, setMinute] = useState("0");
  const [kasAmount, setKasAmount] = useState("");
  const [maxExecutions, setMaxExecutions] = useState("0");
  const [note, setNote] = useState("");

  function refresh() {
    setSchedules(getAllSchedules());
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, []);

  function handleCreate() {
    setError(null);
    const kas = parseFloat(kasAmount);
    if (!Number.isFinite(kas) || kas <= 0) { setError("Enter a valid KAS amount."); return; }
    const schedule = buildDcaSchedule({
      frequency: freq,
      intervalHours: parseInt(intervalHours),
      dayOfWeek: parseInt(dayOfWeek),
      dayOfMonth: parseInt(dayOfMonth),
      hour: parseInt(hour),
      minute: parseInt(minute),
      kasAmount: kas,
      maxExecutions: parseInt(maxExecutions) || 0,
      note: note.trim() || undefined,
    });
    if (!schedule) { setError("Failed to create schedule."); return; }
    setKasAmount(""); setNote(""); setShowForm(false);
    refresh();
  }

  function handleToggle(id: string, enabled: boolean) {
    setDcaEnabled(id, enabled);
    refresh();
  }

  function handleDelete(id: string) {
    deleteDcaSchedule(id);
    refresh();
  }

  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const inputStyle = {
    background: C.s2, border: `1px solid ${C.border}`, borderRadius: 6,
    color: C.text, padding: "8px 12px", fontSize: 13, width: "100%",
    boxSizing: "border-box" as const, ...mono,
  };

  const active = schedules.filter((s) => s.enabled);
  const inactive = schedules.filter((s) => !s.enabled);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, color: C.text, fontWeight: 700, ...mono, marginBottom: 2 }}>DCA Scheduler</div>
          <div style={{ fontSize: 12, color: C.dim }}>Recurring KAS accumulation on a fixed schedule</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {currentPriceUsd > 0 && (
            <span style={{ fontSize: 12, color: C.accent, ...mono }}>${currentPriceUsd.toFixed(4)}</span>
          )}
          <Btn size="sm" variant={showForm ? "ghost" : "primary"} onClick={() => setShowForm((v) => !v)}>
            {showForm ? "CANCEL" : "+ NEW SCHEDULE"}
          </Btn>
        </div>
      </div>

      {showForm && (
        <Card p={16} style={{ marginBottom: 16, border: `1px solid ${C.accent}40` }}>
          <Label>New DCA Schedule</Label>
          {error && (
            <div style={{ fontSize: 12, color: C.danger, marginBottom: 10, padding: "6px 10px", background: `${C.danger}15`, borderRadius: 4 }}>
              {error}
            </div>
          )}
          {/* Frequency selector */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>FREQUENCY</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["hourly", "daily", "weekly", "biweekly", "monthly"] as DcaFrequency[]).map((f) => (
                <Btn key={f} size="sm" variant={freq === f ? "primary" : "ghost"} onClick={() => setFreq(f)}>
                  {f.toUpperCase()}
                </Btn>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            {freq === "hourly" && (
              <div>
                <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>EVERY N HOURS</div>
                <input style={inputStyle} type="number" min="1" max="24" value={intervalHours} onChange={(e) => setIntervalHours(e.target.value)} />
              </div>
            )}
            {(freq === "weekly" || freq === "biweekly") && (
              <div>
                <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>DAY OF WEEK</div>
                <select style={inputStyle} value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
                  {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </div>
            )}
            {freq === "monthly" && (
              <div>
                <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>DAY OF MONTH (1–28)</div>
                <input style={inputStyle} type="number" min="1" max="28" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
              </div>
            )}
            {freq !== "hourly" && (
              <div>
                <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>TIME (UTC HH:MM)</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input style={{ ...inputStyle, width: "50%" }} type="number" min="0" max="23" placeholder="9" value={hour} onChange={(e) => setHour(e.target.value)} />
                  <input style={{ ...inputStyle, width: "50%" }} type="number" min="0" max="59" placeholder="0" value={minute} onChange={(e) => setMinute(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>KAS AMOUNT PER RUN</div>
              <input style={inputStyle} type="number" placeholder="500" value={kasAmount} onChange={(e) => setKasAmount(e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>MAX RUNS (0 = unlimited)</div>
              <input style={inputStyle} type="number" min="0" placeholder="0" value={maxExecutions} onChange={(e) => setMaxExecutions(e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>NOTE (optional)</div>
            <input style={inputStyle} type="text" placeholder="e.g. weekly DCA" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {kasAmount && currentPriceUsd > 0 && (
            <div style={{ fontSize: 11, color: C.dim, ...mono, marginBottom: 10 }}>
              ~${(parseFloat(kasAmount) * currentPriceUsd).toFixed(2)} per run @ ${currentPriceUsd.toFixed(4)}/KAS
            </div>
          )}
          <Btn size="sm" variant="primary" onClick={handleCreate}>CREATE SCHEDULE</Btn>
        </Card>
      )}

      {active.length > 0 && (
        <Card p={0} style={{ marginBottom: 12 }}>
          <div style={{ padding: "10px 14px", background: C.s2, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 11, color: C.text, fontWeight: 600, ...mono }}>ACTIVE ({active.length})</span>
          </div>
          {active.map((s, i) => (
            <div
              key={s.id}
              style={{
                padding: "12px 14px",
                borderBottom: i < active.length - 1 ? `1px solid ${C.border}` : "none",
                display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              }}
            >
              <div>
                <div style={{ fontSize: 13, color: C.text, ...mono, marginBottom: 2 }}>
                  {describeDcaSchedule(s)}
                </div>
                <div style={{ fontSize: 11, color: C.dim, ...mono }}>
                  Runs: {s.executionCount}
                  {s.maxExecutions > 0 ? ` / ${s.maxExecutions}` : ""} ·
                  Next: {s.nextExecutionAt > 0 ? formatCountdown(s.nextExecutionAt) : "—"}
                  {s.note ? ` · ${s.note}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <Btn size="sm" variant="ghost" onClick={() => handleToggle(s.id, false)}>PAUSE</Btn>
                <Btn size="sm" variant="ghost" onClick={() => handleDelete(s.id)}>DELETE</Btn>
              </div>
            </div>
          ))}
        </Card>
      )}

      {inactive.length > 0 && (
        <Card p={0}>
          <div style={{ padding: "10px 14px", background: C.s2, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 11, color: C.text, fontWeight: 600, ...mono }}>PAUSED ({inactive.length})</span>
          </div>
          {inactive.map((s, i) => (
            <div
              key={s.id}
              style={{
                padding: "12px 14px",
                borderBottom: i < inactive.length - 1 ? `1px solid ${C.border}` : "none",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                opacity: 0.6,
              }}
            >
              <div style={{ fontSize: 12, color: C.dim, ...mono }}>{describeDcaSchedule(s)}</div>
              <div style={{ display: "flex", gap: 6 }}>
                <Btn size="sm" variant="ghost" onClick={() => handleToggle(s.id, true)}>RESUME</Btn>
                <Btn size="sm" variant="ghost" onClick={() => handleDelete(s.id)}>DELETE</Btn>
              </div>
            </div>
          ))}
        </Card>
      )}

      {schedules.length === 0 && (
        <div style={{ textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 13, color: C.dim, marginBottom: 4 }}>No DCA schedules</div>
          <div style={{ fontSize: 12, color: C.dim }}>
            Set up a recurring buy to automatically accumulate KAS at regular intervals
          </div>
        </div>
      )}
    </div>
  );
}
