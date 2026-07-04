import type { ProviderEnv } from "../types.ts";

/**
 * Resolve a provider env value from scoped overrides, then `process.env` if available.
 * This is safe for browsers because `process` is checked before access.
 */
export function getProviderEnvValue(name: string, env?: ProviderEnv): string | undefined {
	return (
		env?.[name] ||
		(typeof process !== "undefined" ? process.env[name] : undefined) ||
		undefined
	);
}
