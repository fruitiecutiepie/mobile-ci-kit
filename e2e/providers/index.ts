import type { DeviceProvider } from "./provider.ts";
import { LocalProvider } from "./local.ts";

/**
 * Resolve the provider by name.
 *
 * Only `local` exists here. The switch is a switch, not a registry with dynamic loading, because
 * one entry does not justify a plugin system -- and when a second provider arrives, adding a case
 * is the whole change on this side of the boundary.
 */
export function resolveProvider(name = process.env.DEVICE_PROVIDER ?? "local"): DeviceProvider {
  switch (name) {
    case "local":
      return new LocalProvider();
    default:
      throw new Error(
        `unknown DEVICE_PROVIDER: ${name}. Only "local" is implemented in this repo; ` +
          `see docs/appium-portability.md for what a farm provider must satisfy.`,
      );
  }
}

export { LocalProvider };
export type { DeviceProvider };
