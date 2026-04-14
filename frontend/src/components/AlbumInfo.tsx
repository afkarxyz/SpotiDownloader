import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen, ImageDown, FileText, XCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SearchAndSort } from "./SearchAndSort";
import { TrackList } from "./TrackList";
import { DownloadProgress } from "./DownloadProgress";
import { buildClickableArtists, splitArtistNames } from "@/lib/artist-links";
import type { TrackMetadata } from "@/types/api";
interface AlbumInfoProps {
    albumInfo: {
        name: string;
        artists: string;
        images: string;
        release_date: string;
        total_tracks: number;
        artist_id?: string;
        artist_url?: string;
    };
    trackList: TrackMetadata[];
    searchQuery: string;
    sortBy: string;
    selectedTracks: string[];
    downloadedTracks: Set<string>;
    failedTracks: Set<string>;
    skippedTracks: Set<string>;
    downloadingTrack: string | null;
    isDownloading: boolean;
    bulkDownloadType: "all" | "selected" | null;
    downloadProgress: number;
    currentDownloadInfo: {
        name: string;
        artists: string;
    } | null;
    downloadingLyricsTrack?: string | null;
    downloadedLyrics?: Set<string>;
    failedLyrics?: Set<string>;
    skippedLyrics?: Set<string>;
    downloadedCovers?: Set<string>;
    failedCovers?: Set<string>;
    skippedCovers?: Set<string>;
    downloadingCoverTrack?: string | null;
    isBulkDownloadingCovers?: boolean;
    isBulkDownloadingLyrics?: boolean;
    isMetadataLoading?: boolean;
    currentPage: number;
    itemsPerPage: number;
    onSearchChange: (value: string) => void;
    onSortChange: (value: string) => void;
    onToggleTrack: (id: string) => void;
    onToggleSelectAll: (tracks: TrackMetadata[]) => void;
    onDownloadTrack: (track: TrackMetadata, folderName?: string, isArtistDiscography?: boolean, isAlbum?: boolean, position?: number) => void;
    onDownloadLyrics?: (spotifyId: string, name: string, artists: string, albumName: string, folderName?: string, isArtistDiscography?: boolean, position?: number, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
    onDownloadCover?: (coverUrl: string, trackName: string, artistName: string, albumName: string, folderName?: string, isArtistDiscography?: boolean, position?: number, trackId?: string, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
    onDownloadAllLyrics?: () => void;
    onDownloadAllCovers?: () => void;
    onDownloadAll: () => void;
    onDownloadSelected: () => void;
    onStopDownload: () => void;
    onOpenFolder: () => void;
    onPageChange: (page: number) => void;
    onArtistClick?: (artist: {
        id: string;
        name: string;
        external_urls: string;
    }) => void;
    onTrackClick?: (track: TrackMetadata) => void;
    onBack?: () => void;
}
export function AlbumInfo({ albumInfo, trackList, searchQuery, sortBy, selectedTracks, downloadedTracks, failedTracks, skippedTracks, downloadingTrack, isDownloading, bulkDownloadType, downloadProgress, currentDownloadInfo, downloadingLyricsTrack, downloadedLyrics, failedLyrics, skippedLyrics, downloadedCovers, failedCovers, skippedCovers, downloadingCoverTrack, isBulkDownloadingCovers, isBulkDownloadingLyrics, isMetadataLoading = false, currentPage, itemsPerPage, onSearchChange, onSortChange, onToggleTrack, onToggleSelectAll, onDownloadTrack, onDownloadLyrics, onDownloadCover, onDownloadAllLyrics, onDownloadAllCovers, onDownloadAll, onDownloadSelected, onStopDownload, onOpenFolder, onPageChange, onArtistClick, onTrackClick, onBack, }: AlbumInfoProps) {
    const albumArtistNames = splitArtistNames(albumInfo.artists);
    const artistSeparator = albumInfo.artists.includes(";") ? "; " : ", ";
    const fetchedTrackCount = trackList.length;
    const totalTrackCount = albumInfo.total_tracks;
    const showStreamingProgress = isMetadataLoading && totalTrackCount > 0 && fetchedTrackCount < totalTrackCount;
    const clickableAlbumArtists = (() => {
        const artistsByName = new Map<string, {
            id: string;
            name: string;
            external_urls: string;
        }>();
        for (const track of trackList) {
            const clickableTrackArtists = buildClickableArtists(track.artists, track.artists_data, track.artist_id, track.artist_url);
            for (const artist of clickableTrackArtists) {
                const normalizedName = artist.name.trim().toLowerCase();
                if (!normalizedName || !artist.external_urls || artistsByName.has(normalizedName)) {
                    continue;
                }
                artistsByName.set(normalizedName, artist);
            }
        }
        return albumArtistNames.map((name) => {
            const normalizedName = name.trim().toLowerCase();
            const matchedArtist = artistsByName.get(normalizedName);
            if (matchedArtist) {
                return {
                    ...matchedArtist,
                    name,
                };
            }
            if (albumArtistNames.length === 1 && albumInfo.artist_id && albumInfo.artist_url) {
                return {
                    id: albumInfo.artist_id,
                    name,
                    external_urls: albumInfo.artist_url,
                };
            }
            return {
                id: "",
                name,
                external_urls: "",
            };
        });
    })();
    return (<div className="space-y-6">
      <Card className="relative">
      {onBack && (<div className="absolute top-4 right-4 z-10">
          <Button variant="ghost" size="icon" onClick={onBack}>
              <XCircle className="h-5 w-5"/>
          </Button>
      </div>)}
        <CardContent className="px-6">
          <div className="flex gap-6 items-start">
            {albumInfo.images && (<img src={albumInfo.images} alt={albumInfo.name} className="w-48 h-48 rounded-md shadow-lg object-cover"/>)}
            <div className="flex-1 space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Album</p>
                <h2 className="text-4xl font-bold">{albumInfo.name}</h2>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">
                    {clickableAlbumArtists.length > 0 ? clickableAlbumArtists.map((artist, index) => (<span key={`${artist.id || artist.name}-${index}`}>
                          {onArtistClick && artist.external_urls ? (<span className="cursor-pointer hover:underline" onClick={() => onArtistClick({
                    id: artist.id,
                    name: artist.name,
                    external_urls: artist.external_urls,
                })}>
                              {artist.name}
                            </span>) : (artist.name)}
                          {index < clickableAlbumArtists.length - 1 && artistSeparator}
                        </span>)) : albumInfo.artists}
                  </span>
                  <span>•</span>
                  <span>{albumInfo.release_date}</span>
                  <span>•</span>
                  <span>
                    {showStreamingProgress
            ? `${fetchedTrackCount.toLocaleString()} / ${totalTrackCount.toLocaleString()} tracks`
            : `${Math.max(totalTrackCount, fetchedTrackCount).toLocaleString()} ${Math.max(totalTrackCount, fetchedTrackCount) === 1 ? "track" : "tracks"}`}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={onDownloadAll} disabled={isDownloading}>
                  {isDownloading && bulkDownloadType === "all" ? (<Spinner />) : (<Download className="h-4 w-4"/>)}
                  Download All
                </Button>
                {selectedTracks.length > 0 && (<Button onClick={onDownloadSelected} variant="secondary" disabled={isDownloading}>
                    {isDownloading && bulkDownloadType === "selected" ? (<Spinner />) : (<Download className="h-4 w-4"/>)}
                    Download Selected ({selectedTracks.length.toLocaleString()})
                  </Button>)}
                {onDownloadAllLyrics && (<Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={onDownloadAllLyrics} variant="outline" disabled={isBulkDownloadingLyrics}>
                        {isBulkDownloadingLyrics ? <Spinner /> : <FileText className="h-4 w-4"/>}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Download All Lyrics</p>
                    </TooltipContent>
                  </Tooltip>)}
                {onDownloadAllCovers && (<Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={onDownloadAllCovers} variant="outline" disabled={isBulkDownloadingCovers}>
                        {isBulkDownloadingCovers ? <Spinner /> : <ImageDown className="h-4 w-4"/>}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Download All Separate Covers</p>
                    </TooltipContent>
                  </Tooltip>)}
                {downloadedTracks.size > 0 && (<Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={onOpenFolder} variant="outline" size="icon">
                        <FolderOpen className="h-4 w-4"/>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Open Folder</p>
                    </TooltipContent>
                  </Tooltip>)}
              </div>
              {isDownloading && (<DownloadProgress progress={downloadProgress} currentTrack={currentDownloadInfo} onStop={onStopDownload}/>)}
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <SearchAndSort searchQuery={searchQuery} sortBy={sortBy} onSearchChange={onSearchChange} onSortChange={onSortChange}/>
        <TrackList tracks={trackList} searchQuery={searchQuery} sortBy={sortBy} selectedTracks={selectedTracks} downloadedTracks={downloadedTracks} failedTracks={failedTracks} skippedTracks={skippedTracks} downloadingTrack={downloadingTrack} isDownloading={isDownloading} downloadingLyricsTrack={downloadingLyricsTrack} downloadedLyrics={downloadedLyrics} failedLyrics={failedLyrics} skippedLyrics={skippedLyrics} currentPage={currentPage} itemsPerPage={itemsPerPage} showCheckboxes={true} hideAlbumColumn={true} folderName={albumInfo.name} isAlbum={true} onToggleTrack={onToggleTrack} onDownloadLyrics={onDownloadLyrics} onDownloadCover={onDownloadCover} downloadedCovers={downloadedCovers} failedCovers={failedCovers} skippedCovers={skippedCovers} downloadingCoverTrack={downloadingCoverTrack} onToggleSelectAll={onToggleSelectAll} onDownloadTrack={onDownloadTrack} onPageChange={onPageChange} onArtistClick={onArtistClick} onTrackClick={onTrackClick}/>
      </div>
    </div>);
}
