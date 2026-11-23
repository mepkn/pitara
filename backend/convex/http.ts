import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { tools } from "./kunji";
import { addApiRoutes } from "./lib/apiRoutes";
import { addKunjiRoutes } from "./lib/kunji";

const http = httpRouter();

// Public: Convex Auth's routes, and /api/v1/* which needs a personal API token.
auth.addHttpRoutes(http);
addApiRoutes(http);
// The kunji app contract: needs KUNJI_SECRET (unset refuses everything).
addKunjiRoutes(http, { tools, access: internal.kunji.access });

export default http;
