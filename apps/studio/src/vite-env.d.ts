/// <reference types="vite/client" />

import type { UrbanTestFaultControl } from './dev/urbanFaults';

declare global {
  interface Window {
    __aeroflowTestFaults?: { urban?: UrbanTestFaultControl };
  }
}
