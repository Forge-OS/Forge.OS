import { useCallback, useEffect, useState } from "react";
import { DEFAULT_NETWORK } from "../../../constants";
import { defaultAlertConfig, emitAlert, readAlertConfig, writeAlertConfig } from "../../../runtime/alerts";

type UseAlertsParams = {
  alertScope: string;
  agentName?: string;
  agentId?: string;
  activeStrategyLabel?: string;
};

export function useAlerts(params: UseAlertsParams) {
  const { alertScope, agentName, agentId, activeStrategyLabel } = params;
  const [alertConfig, setAlertConfig] = useState(() => readAlertConfig(alertScope));
  const [alertSaveBusy, setAlertSaveBusy] = useState(false);
  const [lastAlertResult, setLastAlertResult] = useState(null as any);

  useEffect(() => {
    setAlertConfig(readAlertConfig(alertScope));
  }, [alertScope]);

  const sendAlertEvent = useCallback(async (evt: any) => {
    try {
      const result = await emitAlert(alertScope, evt, alertConfig);
      if (result?.sent || result?.reason) {
        setLastAlertResult(result);
      }
      return result;
    } catch (e: any) {
      const failure = { sent: false, reason: e?.message || "alert_error" };
      setLastAlertResult(failure);
      return failure;
    }
  }, [alertConfig, alertScope]);

  const patchAlertConfig = useCallback((patch: any) => {
    setAlertConfig((prev: any) => ({
      ...(prev || defaultAlertConfig()),
      ...patch,
      updatedAt: Date.now(),
    }));
  }, []);

  const toggleAlertType = useCallback((key: string, enabled: boolean) => {
    setAlertConfig((prev: any) => ({
      ...(prev || defaultAlertConfig()),
      eventToggles: {
        ...((prev || defaultAlertConfig()).eventToggles || {}),
        [key]: enabled,
      },
      updatedAt: Date.now(),
    }));
  }, []);

  const saveAlertConfig = useCallback(async () => {
    setAlertSaveBusy(true);
    try {
      writeAlertConfig(alertScope, alertConfig);
      setLastAlertResult({ sent: true, reason: "saved", sentCount: 0 });
    } catch (e: any) {
      setLastAlertResult({ sent: false, reason: e?.message || "save_failed" });
    } finally {
      setAlertSaveBusy(false);
    }
  }, [alertConfig, alertScope]);

  const sendTestAlert = useCallback(async () => {
    const result = await sendAlertEvent({
      type: "system",
      key: `test_alert:${String(agentId || agentName || "agent")}`,
      title: `${agentName || "Agent"} test alert`,
      message: `Test alert from Forge.OS (${DEFAULT_NETWORK}) · strategy=${String(activeStrategyLabel || "Custom")}`,
      severity: "info",
      meta: { network: DEFAULT_NETWORK, strategy: activeStrategyLabel },
    });
    setLastAlertResult(result);
  }, [activeStrategyLabel, agentId, agentName, sendAlertEvent]);

  return {
    alertConfig,
    setAlertConfig,
    alertSaveBusy,
    lastAlertResult,
    setLastAlertResult,
    sendAlertEvent,
    patchAlertConfig,
    toggleAlertType,
    saveAlertConfig,
    sendTestAlert,
  };
}
