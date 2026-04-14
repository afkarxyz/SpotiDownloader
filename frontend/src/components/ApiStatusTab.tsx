import { Button } from "@/components/ui/button";
import { LrclibIcon, MusicBrainzIcon, SpotiDownloaderIcon } from "@/components/ExternalStatusIcons";
import { useApiStatus } from "@/hooks/useApiStatus";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
export function ApiStatusTab() {
    const { sources, statuses, isCheckingAll, refreshAll } = useApiStatus();
    return (<div className="space-y-6">
            <div className="flex items-center justify-end">
                <Button variant="outline" onClick={() => void refreshAll()} disabled={isCheckingAll} className="gap-2">
                    <RefreshCw className={`h-4 w-4 ${isCheckingAll ? "animate-spin" : ""}`}/>
                    Refresh All
                </Button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sources.map((source) => {
            const status = statuses[source.id] || "idle";
            return (<div key={source.id} className="flex items-center justify-between rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
                            <div className="flex items-center gap-3">
                                {source.type === "app" ? (<>
                                        <span className="flex items-center justify-center" aria-label={source.name} title="Checks MP3 and FLAC availability">
                                            <SpotiDownloaderIcon className="h-5 w-5 shrink-0"/>
                                        </span>
                                        <span className="font-medium leading-none">SpotiDownloader.com</span>
                                    </>) : (<>
                                        {source.type === "lrclib" ? (<LrclibIcon className="h-5 w-5 shrink-0"/>) : (<MusicBrainzIcon className="h-5 w-5 shrink-0"/>)}
                                        <span className="font-medium leading-none">{source.name}</span>
                                    </>)}
                            </div>

                            <div className="flex items-center">
                                {status === "checking" && (<Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/>)}
                                {status === "online" && (<CheckCircle2 className="h-5 w-5 text-emerald-500"/>)}
                                {status === "offline" && (<XCircle className="h-5 w-5 text-destructive"/>)}
                                {status === "idle" && <div className="h-5 w-5 rounded-full bg-muted"/>}
                            </div>
                        </div>);
        })}
            </div>
        </div>);
}
