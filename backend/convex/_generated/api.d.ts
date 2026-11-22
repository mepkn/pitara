/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as apiTokens from "../apiTokens.js";
import type * as apiV1 from "../apiV1.js";
import type * as auth from "../auth.js";
import type * as bookmarks from "../bookmarks.js";
import type * as collections from "../collections.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as importData from "../importData.js";
import type * as importExport from "../importExport.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_allowlist from "../lib/allowlist.js";
import type * as lib_apiBody from "../lib/apiBody.js";
import type * as lib_apiRoutes from "../lib/apiRoutes.js";
import type * as lib_bookmarkWrites from "../lib/bookmarkWrites.js";
import type * as lib_collectMetadata from "../lib/collectMetadata.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_htmlMeta from "../lib/htmlMeta.js";
import type * as lib_importConfig from "../lib/importConfig.js";
import type * as lib_nodeTransport from "../lib/nodeTransport.js";
import type * as lib_safeFetch from "../lib/safeFetch.js";
import type * as lib_ssrf from "../lib/ssrf.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as metadata from "../metadata.js";
import type * as metadataFetch from "../metadataFetch.js";
import type * as otp from "../otp.js";
import type * as tags from "../tags.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  apiTokens: typeof apiTokens;
  apiV1: typeof apiV1;
  auth: typeof auth;
  bookmarks: typeof bookmarks;
  collections: typeof collections;
  crons: typeof crons;
  http: typeof http;
  importData: typeof importData;
  importExport: typeof importExport;
  "lib/access": typeof lib_access;
  "lib/allowlist": typeof lib_allowlist;
  "lib/apiBody": typeof lib_apiBody;
  "lib/apiRoutes": typeof lib_apiRoutes;
  "lib/bookmarkWrites": typeof lib_bookmarkWrites;
  "lib/collectMetadata": typeof lib_collectMetadata;
  "lib/env": typeof lib_env;
  "lib/htmlMeta": typeof lib_htmlMeta;
  "lib/importConfig": typeof lib_importConfig;
  "lib/nodeTransport": typeof lib_nodeTransport;
  "lib/safeFetch": typeof lib_safeFetch;
  "lib/ssrf": typeof lib_ssrf;
  "lib/tokens": typeof lib_tokens;
  metadata: typeof metadata;
  metadataFetch: typeof metadataFetch;
  otp: typeof otp;
  tags: typeof tags;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
