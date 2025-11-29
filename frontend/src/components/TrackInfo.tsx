import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen, CheckCircle, XCircle, FileText, FileCheck } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TrackMetadata } from "@/types/api";

interface TrackInfoProps {
  track: TrackMetadata & { album_name: string; release_date: string };
  isDownloading: boolean;
  downloadingTrack: string | null;
  isDownloaded: boolean;
  isFailed: boolean;
  isSkipped: boolean;
  downloadingLyricsTrack?: string | null;
  onDownload: (track: TrackMetadata) => void;
  onDownloadLyrics?: (spotifyId: string, trackName: string, artistName: string, albumName?: string) => void;
  onOpenFolder: () => void;
}

export function TrackInfo({
  track,
  isDownloading,
  downloadingTrack,
  isDownloaded,
  isFailed,
  isSkipped,
  downloadingLyricsTrack,
  onDownload,
  onDownloadLyrics,
  onOpenFolder,
}: TrackInfoProps) {
  return (
    <Card>
      <CardContent className="px-6">
        <div className="flex gap-6 items-start">
          {track.images && (
            <img
              src={track.images}
              alt={track.name}
              className="w-48 h-48 rounded-md shadow-lg object-cover shrink-0"
            />
          )}
          <div className="flex-1 space-y-4 min-w-0">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold wrap-break-word">{track.name}</h1>
                {isSkipped ? (
                  <FileCheck className="h-6 w-6 text-yellow-500 shrink-0" />
                ) : isDownloaded ? (
                  <CheckCircle className="h-6 w-6 text-green-500 shrink-0" />
                ) : isFailed ? (
                  <XCircle className="h-6 w-6 text-red-500 shrink-0" />
                ) : null}
              </div>
              <p className="text-lg text-muted-foreground">{track.artists}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Album</p>
                <p className="font-medium truncate">{track.album_name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Release Date</p>
                <p className="font-medium">{track.release_date}</p>
              </div>
            </div>
            {track.isrc && (
              <div className="flex gap-2">
                <Button
                  onClick={() => onDownload(track)}
                  disabled={isDownloading || downloadingTrack === track.isrc}
                >
                  {downloadingTrack === track.isrc ? (
                    <Spinner />
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Download
                    </>
                  )}
                </Button>
                {track.id && onDownloadLyrics && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => onDownloadLyrics(track.id!, track.name, track.artists, track.album_name)}
                        variant="outline"
                        disabled={downloadingLyricsTrack === track.id}
                      >
                        {downloadingLyricsTrack === track.id ? (
                          <Spinner />
                        ) : (
                          <>
                            <FileText className="h-4 w-4" />
                            Download Lyrics
                          </>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Download Lyrics</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                {isDownloaded && (
                  <Button onClick={onOpenFolder} variant="outline">
                    <FolderOpen className="h-4 w-4" />
                    Open Folder
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
