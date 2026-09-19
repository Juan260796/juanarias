export const CLIENT_LOGIN_DOMAIN = "clientes.juancuentas.app";

export function normalizeUsername(value) {
  return String(value || "").trim();
}

export function canonicalUsername(value) {
  return normalizeUsername(value).toLowerCase();
}

export function validUsername(value) {
  return /^[A-Za-z0-9._-]{3,30}$/.test(normalizeUsername(value));
}

export function usernameToEmail(value) {
  return `${canonicalUsername(value)}@${CLIENT_LOGIN_DOMAIN}`;
}
