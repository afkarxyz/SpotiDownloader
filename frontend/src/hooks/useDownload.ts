import { useState, useRef } from "react";
import { downloadTrack } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { ensureValidToken } from "@/lib/token-manager";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { joinPath, sanitizePath } from "@/lib/utils";
import type { TrackMetadata } from "@/types/api";

export function useDownload() {
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadingTrack, setDownloadingTrack] = useState<string | null>(null);
  const [bulkDownloadType, setBulkDownloadType] = useState<"all" | "selected" | null>(null);
  const [downloadedTracks, setDownloadedTracks] = useState<Set<string>>(new Set());
  const [failedTracks, setFailedTracks] = useState<Set<string>>(new Set());
  const [currentDownloadInfo, setCurrentDownloadInfo] = useState<{
    name: string;
    artists: string;
  } | null>(null);
  const shouldStopDownloadRef = useRef(false);

  const downloadWithSpotiDownloader = async (
    track: TrackMetadata,
    settings: any,
    playlistName?: string,
    isArtistDiscography?: boolean,
    position?: number,
    retryCount: number = 0
  ) => {
    // Ensure we have a valid token before downloading
    const sessionToken = await ensureValidToken();
    
    const os = settings.operatingSystem;

    let outputDir = settings.downloadPath;
    let useAlbumTrackNumber = false;

    if (playlistName) {
      outputDir = joinPath(os, outputDir, sanitizePath(playlistName, os));

      if (isArtistDiscography) {
        if (settings.albumSubfolder && track.album_name) {
          outputDir = joinPath(os, outputDir, sanitizePath(track.album_name, os));
          useAlbumTrackNumber = true;
        }
      } else {
        if (settings.artistSubfolder && track.artists) {
          outputDir = joinPath(os, outputDir, sanitizePath(track.artists, os));
        }

        if (settings.albumSubfolder && track.album_name) {
          outputDir = joinPath(os, outputDir, sanitizePath(track.album_name, os));
          useAlbumTrackNumber = true;
        }
      }
    }

    const response = await downloadTrack({
      isrc: track.isrc,
      track_id: track.id,
      session_token: sessionToken,
      track_name: track.name,
      artist_name: track.artists,
      album_name: track.album_name,
      release_date: track.release_date,
      cover_url: track.images,
      album_track_number: track.track_number,
      output_dir: outputDir,
      audio_format: settings.audioFormat,
      filename_format: settings.filenameFormat,
      track_number: settings.trackNumber,
      position,
      use_album_track_number: useAlbumTrackNumber,
    });

    // Check if token expired (403 or ERR_UNAUTHORIZED)
    if (!response.success && retryCount < 2) {
      const errorMsg = response.error?.toLowerCase() || "";
      if (errorMsg.includes("unauthorized") || errorMsg.includes("403") || errorMsg.includes("err_unauthorized")) {
        // Force refresh token and retry
        await ensureValidToken(true);
        return downloadWithSpotiDownloader(
          track,
          settings,
          playlistName,
          isArtistDiscography,
          position,
          retryCount + 1
        );
      }
    }

    return response;
  };

  const handleDownloadTrack = async (
    track: TrackMetadata
  ) => {
    if (!track.isrc) {
      toast.error("No ISRC found for this track");
      return;
    }

    const settings = getSettings();
    setDownloadingTrack(track.isrc);

    try {
      // Single track download - no position parameter
      const response = await downloadWithSpotiDownloader(
        track,
        settings,
        undefined,
        false,
        undefined // Don't pass position for single track
      );

      if (response.success) {
        if (response.already_exists) {
          toast.info(response.message);
        } else {
          toast.success(response.message);
        }
        setDownloadedTracks((prev) => new Set(prev).add(track.isrc));
        setFailedTracks((prev) => {
          const newSet = new Set(prev);
          newSet.delete(track.isrc);
          return newSet;
        });
      } else {
        toast.error(response.error || "Download failed");
        setFailedTracks((prev) => new Set(prev).add(track.isrc));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
      setFailedTracks((prev) => new Set(prev).add(track.isrc));
    } finally {
      setDownloadingTrack(null);
    }
  };

  const handleDownloadSelected = async (
    selectedTracks: string[],
    allTracks: TrackMetadata[],
    playlistName?: string,
    isArtistDiscography?: boolean
  ) => {
    if (selectedTracks.length === 0) {
      toast.error("No tracks selected");
      return;
    }

    const settings = getSettings();
    setIsDownloading(true);
    setBulkDownloadType("selected");
    setDownloadProgress(0);

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const total = selectedTracks.length;

    for (let i = 0; i < selectedTracks.length; i++) {
      if (shouldStopDownloadRef.current) {
        toast.info(
          `Download stopped. ${successCount} tracks downloaded, ${selectedTracks.length - i} skipped.`
        );
        break;
      }

      const isrc = selectedTracks[i];
      const track = allTracks.find((t) => t.isrc === isrc);

      setDownloadingTrack(isrc);

      if (track) {
        setCurrentDownloadInfo({ name: track.name, artists: track.artists });
      }

      try {
        // Use sequential numbering (1, 2, 3...) for selected tracks
        if (!track) continue;
        
        const response = await downloadWithSpotiDownloader(
          track,
          settings,
          playlistName,
          isArtistDiscography,
          i + 1 // Sequential position based on selection order
        );

        if (response.success) {
          if (response.already_exists) {
            skippedCount++;
            console.log(`Skipped: ${track?.name} - ${track?.artists} (already exists)`);
          } else {
            successCount++;
          }
          setDownloadedTracks((prev) => new Set(prev).add(isrc));
          setFailedTracks((prev) => {
            const newSet = new Set(prev);
            newSet.delete(isrc);
            return newSet;
          });
        } else {
          errorCount++;
          setFailedTracks((prev) => new Set(prev).add(isrc));
        }
      } catch (err) {
        errorCount++;
        setFailedTracks((prev) => new Set(prev).add(isrc));
      }

      setDownloadProgress(Math.round(((i + 1) / total) * 100));
    }

    setDownloadingTrack(null);
    setCurrentDownloadInfo(null);
    setIsDownloading(false);
    setBulkDownloadType(null);
    shouldStopDownloadRef.current = false;

    // Build summary message
    if (errorCount === 0 && skippedCount === 0) {
      toast.success(`Downloaded ${successCount} tracks successfully`);
    } else if (errorCount === 0 && successCount === 0) {
      // All skipped
      toast.info(`${skippedCount} tracks already exist`);
    } else if (errorCount === 0) {
      // Mix of downloaded and skipped
      toast.info(`${successCount} downloaded, ${skippedCount} skipped`);
    } else {
      // Has errors
      const parts = [];
      if (successCount > 0) parts.push(`${successCount} downloaded`);
      if (skippedCount > 0) parts.push(`${skippedCount} skipped`);
      parts.push(`${errorCount} failed`);
      toast.warning(parts.join(", "));
    }
  };

  const handleDownloadAll = async (
    tracks: TrackMetadata[],
    playlistName?: string,
    isArtistDiscography?: boolean
  ) => {
    const tracksWithIsrc = tracks.filter((track) => track.isrc);

    if (tracksWithIsrc.length === 0) {
      toast.error("No tracks available for download");
      return;
    }

    const settings = getSettings();
    setIsDownloading(true);
    setBulkDownloadType("all");
    setDownloadProgress(0);

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const total = tracksWithIsrc.length;

    for (let i = 0; i < tracksWithIsrc.length; i++) {
      if (shouldStopDownloadRef.current) {
        toast.info(
          `Download stopped. ${successCount} tracks downloaded, ${tracksWithIsrc.length - i} skipped.`
        );
        break;
      }

      const track = tracksWithIsrc[i];

      setDownloadingTrack(track.isrc);
      setCurrentDownloadInfo({ name: track.name, artists: track.artists });

      try {
        const response = await downloadWithSpotiDownloader(
          track,
          settings,
          playlistName,
          isArtistDiscography,
          i + 1
        );

        if (response.success) {
          if (response.already_exists) {
            skippedCount++;
            console.log(`Skipped: ${track.name} - ${track.artists} (already exists)`);
          } else {
            successCount++;
          }
          setDownloadedTracks((prev) => new Set(prev).add(track.isrc));
          setFailedTracks((prev) => {
            const newSet = new Set(prev);
            newSet.delete(track.isrc);
            return newSet;
          });
        } else {
          errorCount++;
          setFailedTracks((prev) => new Set(prev).add(track.isrc));
        }
      } catch (err) {
        errorCount++;
        setFailedTracks((prev) => new Set(prev).add(track.isrc));
      }

      setDownloadProgress(Math.round(((i + 1) / total) * 100));
    }

    setDownloadingTrack(null);
    setCurrentDownloadInfo(null);
    setIsDownloading(false);
    setBulkDownloadType(null);
    shouldStopDownloadRef.current = false;

    // Build summary message
    if (errorCount === 0 && skippedCount === 0) {
      toast.success(`Downloaded ${successCount} tracks successfully`);
    } else if (errorCount === 0 && successCount === 0) {
      // All skipped
      toast.info(`${skippedCount} tracks already exist`);
    } else if (errorCount === 0) {
      // Mix of downloaded and skipped
      toast.info(`${successCount} downloaded, ${skippedCount} skipped`);
    } else {
      // Has errors
      const parts = [];
      if (successCount > 0) parts.push(`${successCount} downloaded`);
      if (skippedCount > 0) parts.push(`${skippedCount} skipped`);
      parts.push(`${errorCount} failed`);
      toast.warning(parts.join(", "));
    }
  };

  const handleStopDownload = () => {
    shouldStopDownloadRef.current = true;
    toast.info("Stopping download...");
  };

  const resetDownloadedTracks = () => {
    setDownloadedTracks(new Set());
    setFailedTracks(new Set());
  };

  return {
    downloadProgress,
    isDownloading,
    downloadingTrack,
    bulkDownloadType,
    downloadedTracks,
    failedTracks,
    currentDownloadInfo,
    handleDownloadTrack,
    handleDownloadSelected,
    handleDownloadAll,
    handleStopDownload,
    resetDownloadedTracks,
  };
}
