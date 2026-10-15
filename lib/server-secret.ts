import "server-only";

/**
 * The server secret (`API_KEY_SERVER_SECRET`, server env only; Vault
 * `api_key_server_secret` holds the same value). Database functions that
 * hand out something sensitive (a sealed AI key, the shared key, anything
 * the extension asks for) require it, so only this server can call them,
 * even with a valid session or token. Never logged.
 */

export const SERVER_SECRET_ENV = "API_KEY_SERVER_SECRET";

export class ServerSecretError extends Error {
  constructor() {
    super(`${SERVER_SECRET_ENV} isn't set (32+ characters).`);
    this.name = "ServerSecretError";
  }
}

export function serverSecret(): string {
  const secret = process.env[SERVER_SECRET_ENV]?.trim() ?? "";
  if (secret.length < 32) throw new ServerSecretError();
  return secret;
}
