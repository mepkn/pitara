import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { addApiRoutes } from "./lib/apiRoutes";

const http = httpRouter();

// Public: Convex Auth's routes, and /api/v1/* which needs a personal API token.
auth.addHttpRoutes(http);
addApiRoutes(http);

export default http;
