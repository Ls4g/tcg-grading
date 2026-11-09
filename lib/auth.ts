// One shared login, checked with HTTP Basic auth. Every price lookup spends
// Apify credit, so the whole app is private. If the credentials are not
// configured, everything is refused (fail closed).

function credentials() {
  const username = process.env.APP_USERNAME;
  const password = process.env.APP_PASSWORD;
  return username && password ? { username, password } : null;
}

export function isConfigured() {
  return credentials() !== null;
}

function constantTimeEqual(left: string, right: string) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function isAuthorized(request: Request) {
  const configured = credentials();
  const authorization = request.headers.get("authorization");
  if (!configured || !authorization?.startsWith("Basic ")) return false;
  try {
    const provided = atob(authorization.slice(6));
    const separator = provided.indexOf(":");
    return separator !== -1
      && constantTimeEqual(provided.slice(0, separator), configured.username)
      && constantTimeEqual(provided.slice(separator + 1), configured.password);
  } catch {
    return false;
  }
}
