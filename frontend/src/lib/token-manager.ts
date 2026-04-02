import { FetchSessionToken } from "../../wailsjs/go/main/App";
import { type Settings, getSettings, updateSettings, isTokenExpired } from "./settings";

let isFetchingToken = false;
let lastFetchTime = 0;

const TOKEN_GRACE_SECONDS = 120;

function isTokenWithinGraceWindow(settings: Settings): boolean {
    if (!settings.sessionToken || !settings.sessionTokenExpiry) {
        return false;
    }

    const now = Math.floor(Date.now() / 1000);
    return settings.sessionTokenExpiry + TOKEN_GRACE_SECONDS > now;
}

async function fetchAndStoreToken(): Promise<string> {
    const now = Date.now();
    if (now - lastFetchTime < 2000) {
        await new Promise(resolve => setTimeout(resolve, 2000 - (now - lastFetchTime)));
    }

    isFetchingToken = true;
    lastFetchTime = Date.now();

    try {
        const response = await FetchSessionToken();
        await updateSettings({
            sessionToken: response.token,
            sessionTokenExpiry: response.expires_at,
        });
        return response.token;
    }
    finally {
        isFetchingToken = false;
    }
}

function refreshTokenInBackground(): void {
    if (isFetchingToken) {
        return;
    }

    void fetchAndStoreToken().catch((error) => {
        console.error("Background token refresh failed:", error);
    });
}

export async function ensureValidToken(forceRefresh: boolean = false): Promise<string> {
    const settings = getSettings();
    if (!forceRefresh && !isTokenExpired(settings)) {
        return settings.sessionToken;
    }
    if (!forceRefresh && isTokenWithinGraceWindow(settings)) {
        refreshTokenInBackground();
        return settings.sessionToken;
    }
    if (isFetchingToken) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return ensureValidToken(forceRefresh);
    }
    return fetchAndStoreToken();
}
