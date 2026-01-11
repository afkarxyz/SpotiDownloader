import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen, CheckCircle, XCircle, FileText, FileCheck, ImageDown } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TrackMetadata } from "@/types/api";
interface TrackInfoProps {
    track: TrackMetadata & {
        album_name: string;
        release_date: string;
    };
    isDownloading: boolean;
    downloadingTrack: string | null;
    isDownloaded: boolean;
    isFailed: boolean;
    isSkipped: boolean;
    downloadingLyricsTrack?: string | null;
    downloadedLyrics?: Set<string>;
    failedLyrics?: Set<string>;
    skippedLyrics?: Set<string>;
    downloadingCover?: boolean;
    downloadedCover?: boolean;
    failedCover?: boolean;
    skippedCover?: boolean;
    onDownload: (track: TrackMetadata) => void;
    onDownloadLyrics?: (spotifyId: string, trackName: string, artistName: string, albumName?: string, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
    onDownloadCover?: (coverUrl: string, trackName: string, artistName: string, albumName?: string, playlistName?: string, isArtistDiscography?: boolean, position?: number, trackId?: string, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
    onOpenFolder: () => void;
}
export function TrackInfo({ track, isDownloading, downloadingTrack, isDownloaded, isFailed, isSkipped, downloadingLyricsTrack, downloadedLyrics, failedLyrics, skippedLyrics, downloadingCover, downloadedCover, failedCover, skippedCover, onDownload, onDownloadLyrics, onDownloadCover, onOpenFolder, }: TrackInfoProps) {
    const formatDuration = (ms: number) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    };
    const formatPlays = (plays: string) => {
        const num = parseInt(plays, 10);
        if (isNaN(num))
            return plays;
        return num.toLocaleString();
    };
    return (<Card>
      <CardContent className="px-6">
        <div className="flex gap-6 items-start">
          {track.images && (<div className="shrink-0">
              <div className="relative w-48 h-48 rounded-md shadow-lg overflow-hidden">
                <img src={track.images} alt={track.name} className="w-full h-full object-cover"/>
                <div className="absolute bottom-1 right-1 bg-black/80 text-white px-1.5 py-0.5 text-xs font-medium rounded">
                  {formatDuration(track.duration_ms)}
                </div>
              </div>
            </div>)}
          <div className="flex-1 space-y-4 min-w-0">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold wrap-break-word">{track.name}</h1>
                {isSkipped ? (<FileCheck className="h-6 w-6 text-yellow-500 shrink-0"/>) : isDownloaded ? (<CheckCircle className="h-6 w-6 text-green-500 shrink-0"/>) : isFailed ? (<XCircle className="h-6 w-6 text-red-500 shrink-0"/>) : null}
              </div>
              <p className="text-lg text-muted-foreground">{track.artists}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="space-y-1">
                <div>
                  <p className="text-xs text-muted-foreground">Album</p>
                  <p className="font-medium truncate">{track.album_name}</p>
                </div>
                {track.plays && (<div>
                    <p className="text-xs text-muted-foreground">Total Plays</p>
                    <p className="font-medium">{formatPlays(track.plays)}</p>
                  </div>)}
              </div>
              <div className="space-y-1">
                <div>
                  <p className="text-xs text-muted-foreground">Release Date</p>
                  <p className="font-medium">{track.release_date}</p>
                </div>
                {track.copyright && (<div>
                    <p className="text-xs text-muted-foreground">Copyright</p>
                    <p className="font-medium truncate" title={track.copyright}>
                      {track.copyright}
                    </p>
                  </div>)}
              </div>
            </div>
            {track.isrc && (<div className="flex gap-2">
                <Button onClick={() => onDownload(track)} disabled={isDownloading || downloadingTrack === track.isrc}>
                  {downloadingTrack === track.isrc ? (<Spinner />) : (<>
                      <Download className="h-4 w-4"/>
                      Download
                    </>)}
                </Button>
                {track.spotify_id && onDownloadLyrics && (<Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={() => onDownloadLyrics(track.spotify_id!, track.name, track.artists, track.album_name, track.album_artist, track.release_date, track.disc_number)} variant="outline" size="icon" disabled={downloadingLyricsTrack === track.spotify_id}>
                        {downloadingLyricsTrack === track.spotify_id ? (<Spinner />) : skippedLyrics?.has(track.spotify_id) ? (<FileCheck className="h-4 w-4 text-yellow-500"/>) : downloadedLyrics?.has(track.spotify_id) ? (<CheckCircle className="h-4 w-4 text-green-500"/>) : failedLyrics?.has(track.spotify_id) ? (<XCircle className="h-4 w-4 text-red-500"/>) : (<FileText className="h-4 w-4"/>)}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {downloadingLyricsTrack === track.spotify_id ? (<p>Downloading lyrics...</p>) : skippedLyrics?.has(track.spotify_id) ? (<p>Lyrics already exists</p>) : downloadedLyrics?.has(track.spotify_id) ? (<p>Lyrics downloaded</p>) : failedLyrics?.has(track.spotify_id) ? (<p>Lyrics failed</p>) : (<p>Download Lyrics</p>)}
                    </TooltipContent>
                  </Tooltip>)}
                {track.images && onDownloadCover && (<Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={() => onDownloadCover(track.images, track.name, track.artists, track.album_name, undefined, undefined, undefined, track.spotify_id, track.album_artist, track.release_date, track.disc_number)} variant="outline" size="icon" disabled={downloadingCover}>
                        {downloadingCover ? (<Spinner />) : skippedCover ? (<FileCheck className="h-4 w-4 text-yellow-500"/>) : downloadedCover ? (<CheckCircle className="h-4 w-4 text-green-500"/>) : failedCover ? (<XCircle className="h-4 w-4 text-red-500"/>) : (<ImageDown className="h-4 w-4"/>)}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {downloadingCover ? (<p>Downloading cover...</p>) : skippedCover ? (<p>Cover already exists</p>) : downloadedCover ? (<p>Cover downloaded</p>) : failedCover ? (<p>Cover failed</p>) : (<p>Download Cover</p>)}
                    </TooltipContent>
                  </Tooltip>)}
                {isDownloaded && (<Button onClick={onOpenFolder} variant="outline">
                    <FolderOpen className="h-4 w-4"/>
                    Open Folder
                  </Button>)}
              </div>)}
          </div>
        </div>
      </CardContent>
    </Card>);
}
