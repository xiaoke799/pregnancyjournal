import { defineEventHandler } from "h3";
import { ok } from "../../utils/api-response";
import { getGatewayUser } from "../../utils/gateway-user";

export default defineEventHandler((event) => ok(getGatewayUser(event)));
