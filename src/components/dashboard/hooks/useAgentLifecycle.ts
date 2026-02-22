import { useCallback, useState } from "react";
import { transitionAgentLifecycle } from "../../../runtime/lifecycleMachine";

export function useAgentLifecycle(initialStatus: string = "RUNNING") {
  const [status, setStatus] = useState(initialStatus);

  const transitionAgentStatus = useCallback((event: any) => {
    setStatus((prev: any) => transitionAgentLifecycle(String(prev || "RUNNING") as any, event) as any);
  }, []);

  return {
    status,
    setStatus,
    transitionAgentStatus,
  };
}
