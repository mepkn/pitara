// Plain-string error codes from the API (shared/types.ts ApiError) plus two of our own:
// `offline` (fetch failed) and `timeout`.
const MESSAGES: Record<string, string> = {
  notConfigured: "Add your API token in the extension options first.",
  notAuthenticated: "The API token is not valid (revoked or mistyped). Create a new one in Pitara → Settings → API tokens.",
  notAllowed: "This account is not allowed to use Pitara.",
  notFound: "That bookmark no longer exists.",
  invalidUrl: "That is not a web address Pitara can save.",
  tooLong: "Something you typed is too long.",
  limitReached: "A Pitara limit was reached (bookmarks, tags or tag count).",
  tooManyRequests: "Too many requests. Wait a minute and try again.",
  badRequest: "Pitara could not understand that request.",
  offline: "Can't reach Pitara. Check your connection and try again.",
  timeout: "Pitara took too long to answer. Try again.",
  serverError: "Pitara had a problem. Try again in a moment.",
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 0) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function errorMessage(error: unknown): string {
  const code = error instanceof ApiError ? error.code : undefined;
  return (code && MESSAGES[code]) || "Something went wrong. Try again.";
}

/** True when the token itself is the problem, so the UI can point at the options page. */
export function isTokenProblem(error: unknown): boolean {
  return error instanceof ApiError && (error.code === "notAuthenticated" || error.code === "notConfigured");
}
