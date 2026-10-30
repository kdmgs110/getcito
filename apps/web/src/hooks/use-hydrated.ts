import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Prevent controlled SSR forms from accepting input before React attaches handlers. */
export function useHydrated(): boolean {
	return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
