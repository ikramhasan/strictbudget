import { createApiClient, createQueryApi } from "@strictbudget/api-client";
import { CLIENT_ID } from "./live-updates";

export const apiBaseUrl = import.meta.env.VITE_API_URL ?? window.location.origin;

export const apiClient = createApiClient({ baseUrl: apiBaseUrl });

// Names this tab on every request, so its own changes aren't echoed back as live updates.
apiClient.use({
  onRequest({ request }) {
    request.headers.set("X-Client-Id", CLIENT_ID);
    return request;
  },
});

export const $api = createQueryApi(apiClient);
