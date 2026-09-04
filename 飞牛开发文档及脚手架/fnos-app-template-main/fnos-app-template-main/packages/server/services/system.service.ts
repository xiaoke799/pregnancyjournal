import { arch, platform } from "node:os";
import { getAppConfig } from "../utils/runtime-config";

export function getSystemSummary() {
  const config = getAppConfig();

  return {
    appName: config.appName,
    appTitle: config.appTitle,
    accessMode: config.accessMode,
    gatewayPrefix: config.gatewayPrefix,
    appPort: config.appPort,
    runtime: "nitro",
    nodePlatform: platform(),
    nodeArch: arch(),
    processUptimeSec: Math.floor(process.uptime())
  };
}
