import { CheckAPIStatus, FetchUnifiedAPIStatus } from "../../wailsjs/go/main/App";
import { CHECK_TIMEOUT_MS, withTimeout } from "@/lib/async-timeout";
export type ApiCheckStatus = "checking" | "online" | "offline" | "idle";
export interface ApiSource {
    id: string;
    type: "app" | "lrclib" | "musicbrainz";
    name: string;
}
export const API_SOURCES: ApiSource[] = [
    { id: "app", type: "app", name: "SpotiDownloader" },
    { id: "lrclib", type: "lrclib", name: "LRCLIB" },
    { id: "musicbrainz", type: "musicbrainz", name: "MusicBrainz" },
];
type ApiStatusState = {
    isCheckingAll: boolean;
    statuses: Record<string, ApiCheckStatus>;
};
let apiStatusState: ApiStatusState = {
    isCheckingAll: false,
    statuses: {},
};
let activeCheckAll: Promise<void> | null = null;
const listeners = new Set<() => void>();
type SpotiDownloaderUnifiedStatusResponse = {
    spotidownloader?: string;
    lrclib?: string;
};
function emitApiStatusChange() {
    for (const listener of listeners) {
        listener();
    }
}
function setApiStatusState(updater: (current: ApiStatusState) => ApiStatusState) {
    apiStatusState = updater(apiStatusState);
    emitApiStatusChange();
}
function statusFromUnifiedValue(value: string | undefined): ApiCheckStatus {
    return value === "up" ? "online" : "offline";
}
async function fetchUnifiedStatuses(forceRefresh: boolean): Promise<Pick<ApiStatusState, "statuses">> {
    const response = await FetchUnifiedAPIStatus(forceRefresh);
    const payload = JSON.parse(response) as SpotiDownloaderUnifiedStatusResponse;
    return {
        statuses: {
            app: statusFromUnifiedValue(payload.spotidownloader),
            lrclib: statusFromUnifiedValue(payload.lrclib),
        },
    };
}
async function checkMusicBrainzStatus(): Promise<ApiCheckStatus> {
    try {
        const isOnline = await withTimeout(CheckAPIStatus("musicbrainz"), CHECK_TIMEOUT_MS, "API status check timed out after 10 seconds for MusicBrainz");
        return isOnline ? "online" : "offline";
    }
    catch {
        return "offline";
    }
}
export function getApiStatusState(): ApiStatusState {
    return apiStatusState;
}
export function subscribeApiStatus(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
export function hasApiStatusResults(): boolean {
    return API_SOURCES.some((source) => {
        const status = apiStatusState.statuses[source.id];
        return status === "online" || status === "offline";
    });
}
export function ensureApiStatusCheckStarted(): void {
    if (!activeCheckAll && !hasApiStatusResults()) {
        void checkAllApiStatuses(false);
    }
}
export async function checkAllApiStatuses(forceRefresh: boolean = false): Promise<void> {
    if (activeCheckAll) {
        return activeCheckAll;
    }
    activeCheckAll = (async () => {
        const checkingStatuses = Object.fromEntries(API_SOURCES.map((source) => [source.id, "checking" as ApiCheckStatus]));
        setApiStatusState((current) => ({
            ...current,
            isCheckingAll: true,
            statuses: {
                ...current.statuses,
                ...checkingStatuses,
            },
        }));
        try {
            const [unifiedResult, musicBrainzStatus] = await Promise.allSettled([
                withTimeout(fetchUnifiedStatuses(forceRefresh), CHECK_TIMEOUT_MS, "Unified SpotiDownloader status check timed out after 10 seconds"),
                checkMusicBrainzStatus(),
            ]);
            setApiStatusState((current) => {
                const nextStatuses = { ...current.statuses };
                if (unifiedResult.status === "fulfilled") {
                    Object.assign(nextStatuses, unifiedResult.value.statuses);
                }
                else {
                    nextStatuses.app = "offline";
                    nextStatuses.lrclib = "offline";
                }
                nextStatuses.musicbrainz =
                    musicBrainzStatus.status === "fulfilled" ? musicBrainzStatus.value : "offline";
                return {
                    ...current,
                    statuses: nextStatuses,
                };
            });
        }
        finally {
            setApiStatusState((current) => ({
                ...current,
                isCheckingAll: false,
            }));
            activeCheckAll = null;
        }
    })();
    return activeCheckAll;
}
