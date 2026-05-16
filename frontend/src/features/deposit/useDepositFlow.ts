"use client";

import type { DepositFlowViewModel } from "./types";
import { useBackendDepositFlow } from "./useBackendDepositFlow";

export function useDepositFlow(): DepositFlowViewModel {
  return useBackendDepositFlow();
}

