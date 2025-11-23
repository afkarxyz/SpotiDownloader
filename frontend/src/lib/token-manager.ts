import { FetchSessionToken } from "../../wailsjs/go/main/App";
import { getSettings, updateSettings, isTokenExpired } from "./settings";

let isFetchingToken = false;
let lastFetchTime = 0;

export async function ensureValidToken(forceRefresh: boolean = false): Promise<string> {
  const settings = getSettings();

  // If token is still valid and not forcing refresh, return it
  if (!forceRefresh && !isTokenExpired(settings)) {
    return settings.sessionToken;
  }

  // If already fetching, wait for it
  if (isFetchingToken) {
    // Wait and retry
    await new Promise(resolve => setTimeout(resolve, 1000));
    return ensureValidToken(forceRefresh);
  }

  // Prevent too frequent fetches (minimum 2 seconds between fetches)
  const now = Date.now();
  if (now - lastFetchTime < 2000) {
    await new Promise(resolve => setTimeout(resolve, 2000 - (now - lastFetchTime)));
  }

  // Fetch new token
  isFetchingToken = true;
  lastFetchTime = Date.now();
  try {
    const response = await FetchSessionToken();
    updateSettings({
      sessionToken: response.token,
      sessionTokenExpiry: response.expires_at,
    });
    return response.token;
  } finally {
    isFetchingToken = false;
  }
}
