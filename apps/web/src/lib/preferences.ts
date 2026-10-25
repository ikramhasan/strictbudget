import { useQuery } from "@tanstack/react-query";
import { $api } from "./api";
import { useOptionalQueryClient } from "./query-client";

export const preferencesQueryOptions = () => $api.queryOptions("get", "/v1/me/preferences");

/**
 * "Enable keyboard shortcuts" (undo and redo included). On until the account's options have loaded,
 * as the setting defaults to on, and on where there's no query client to load them.
 */
export function useShortcutsEnabled() {
  const { client, present } = useOptionalQueryClient();
  const preferences = useQuery({ ...preferencesQueryOptions(), enabled: present }, client);
  return preferences.data?.keyboardShortcuts ?? true;
}
