import { FetchSessionToken } from "../../wailsjs/go/main/App";
import { getSettings, updateSettings, isTokenExpired } from "./settings";
let isFetchingToken = false;
let lastFetchTime = 0;
export async function ensureValidToken(forceRefresh: boolean = false): Promise<string> {
    const settings = getSettings();
    if (!forceRefresh && !isTokenExpired(settings)) {
        return settings.sessionToken;
    }
    if (isFetchingToken) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return ensureValidToken(forceRefresh);
    }
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
    catch (error) {
        throw error;
    }
    finally {
        isFetchingToken = false;
    }
}
