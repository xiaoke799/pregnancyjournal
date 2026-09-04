import { defineEventHandler } from "h3";
import { ok } from "../../utils/api-response";
import { getAppConfig } from "../../utils/runtime-config";

export default defineEventHandler(() => {
  const config = getAppConfig();

  return ok({
    appName: config.appName,
    appTitle: config.appTitle,
    accessMode: config.accessMode,
    gatewayPrefix: config.gatewayPrefix,
    appPort: config.appPort,
    logLevel: config.logLevel
  });
});
