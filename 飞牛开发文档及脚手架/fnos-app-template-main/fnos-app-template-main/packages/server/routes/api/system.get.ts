import { defineEventHandler } from "h3";
import { ok } from "../../utils/api-response";
import { getSystemSummary } from "../../services/system.service";

export default defineEventHandler(() => ok(getSystemSummary()));
