import { FetchSessionTokenWithParams } from "../../wailsjs/go/main/App";
import { getSettings, updateSettings, isTokenExpired } from "./settings";
let isFetchingToken = false;
let lastFetchTime = 0;
export class ChromeNotInstalledError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ChromeNotInstalledError";
    }
}
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
        const timeout = settings.tokenTimeout || 5;
        const retry = settings.tokenRetry || 1;
        const response = await FetchSessionTokenWithParams(timeout, retry);
        updateSettings({
            sessionToken: response.token,
            sessionTokenExpiry: response.expires_at,
        });
        return response.token;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("CHROME_NOT_INSTALLED")) {
            const message = errorMessage.replace("CHROME_NOT_INSTALLED: ", "");
            window.dispatchEvent(new CustomEvent("chromeNotInstalled", { detail: { message } }));
            throw new ChromeNotInstalledError(message);
        }
        throw error;
    }
    finally {
        isFetchingToken = false;
    }
}
