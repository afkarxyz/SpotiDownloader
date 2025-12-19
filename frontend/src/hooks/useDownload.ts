import { useState, useRef } from "react";
import { downloadTrack } from "@/lib/api";
import { getSettings, parseTemplate, type TemplateData } from "@/lib/settings";
import { ensureValidToken } from "@/lib/token-manager";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { joinPath, sanitizePath } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { TrackMetadata } from "@/types/api";

// Type definitions for new backend functions
interface CheckFileExistenceRequest {
  isrc: string;
  track_name: string;
  artist_name: string;
}

interface FileExistenceResult {
  isrc: string;
  exists: boolean;
  file_path?: string;
  track_name?: string;
  artist_name?: string;
}

// These functions will be available after Wails regenerates bindings
const CheckFilesExistence = (outputDir: string, audioFormat: string, tracks: CheckFileExistenceRequest[]): Promise<FileExistenceResult[]> =>
  (window as any)["go"]["main"]["App"]["CheckFilesExistence"](outputDir, audioFormat, tracks);
const SkipDownloadItem = (itemID: string, filePath: string): Promise<void> =>
  (window as any)["go"]["main"]["App"]["SkipDownloadItem"](itemID, filePath);

export function useDownload() {
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadingTrack, setDownloadingTrack] = useState<string | null>(null);
  const [bulkDownloadType, setBulkDownloadType] = useState<"all" | "selected" | null>(null);
  const [downloadedTracks, setDownloadedTracks] = useState<Set<string>>(new Set());
  const [failedTracks, setFailedTracks] = useState<Set<string>>(new Set());
  const [skippedTracks, setSkippedTracks] = useState<Set<string>>(new Set());
  const [currentDownloadInfo, setCurrentDownloadInfo] = useState<{
    name: string;
    artists: string;
  } | null>(null);
  const shouldStopDownloadRef = useRef(false);

  const downloadWithSpotiDownloader = async (
    track: TrackMetadata,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings: any,
    playlistName?: string,
    position?: number,
    retryCount: number = 0,
    isAlbum?: boolean,
    releaseYear?: string
  ) => {
    const sessionToken = await ensureValidToken();
    const os = settings.operatingSystem;
    let outputDir = settings.downloadPath;
    let useAlbumTrackNumber = false;

    // Replace forward slashes in template data values to prevent them from being interpreted as path separators
    const placeholder = "__SLASH_PLACEHOLDER__";
    const templateData: TemplateData = {
      artist: track.artists?.replace(/\//g, placeholder) || undefined,
      album: track.album_name?.replace(/\//g, placeholder) || undefined,
      album_artist: track.album_artist?.replace(/\//g, placeholder) || track.artists?.replace(/\//g, placeholder) || undefined,
      title: track.name?.replace(/\//g, placeholder) || undefined,
      track: position,
      disc: track.disc_number,
      year: releaseYear || track.release_date?.substring(0, 4),
      playlist: playlistName?.replace(/\//g, placeholder) || undefined,
      isrc: track.isrc,
    };

    if (playlistName && !isAlbum) {
      outputDir = joinPath(os, outputDir, sanitizePath(playlistName.replace(/\//g, " "), os));
    }

    if (settings.folderTemplate) {
      const folderPath = parseTemplate(settings.folderTemplate, templateData);
      if (folderPath) {
        // Split by / (template separators), then restore placeholders as spaces
        const parts = folderPath.split("/").filter((p: string) => p.trim());
        for (const part of parts) {
          // Restore any slashes that were in the original values as spaces
          const sanitizedPart = part.replace(new RegExp(placeholder, "g"), " ");
          outputDir = joinPath(os, outputDir, sanitizePath(sanitizedPart, os));
        }
      }

      // Use album track number if template contains {album}
      if (settings.folderTemplate.includes("{album}")) {
        useAlbumTrackNumber = true;
      }
    }

    const { AddToDownloadQueue } = await import("../../wailsjs/go/main/App");
    const itemID = await AddToDownloadQueue(track.isrc, track.name || "", track.artists || "", track.album_name || "");

    const response = await downloadTrack({
      isrc: track.isrc,
      track_id: track.spotify_id,
      session_token: sessionToken,
      track_name: track.name,
      artist_name: track.artists,
      album_name: track.album_name,
      album_artist: track.album_artist,
      release_date: track.release_date,
      cover_url: track.images,
      album_track_number: track.track_number,
      disc_number: track.disc_number,
      total_tracks: track.total_tracks, // Total tracks in album from Spotify
      output_dir: outputDir,
      audio_format: settings.audioFormat,
      filename_format: settings.filenameTemplate,
      track_number: settings.trackNumber,
      position,
      use_album_track_number: useAlbumTrackNumber,
      spotify_id: track.spotify_id,
      embed_lyrics: settings.embedLyrics,
      embed_max_quality_cover: settings.embedMaxQualityCover,
      item_id: itemID,
    });

    if (!response.success && retryCount < 2) {
      const errorMsg = response.error?.toLowerCase() || "";
      if (errorMsg.includes("unauthorized") || errorMsg.includes("403") || errorMsg.includes("err_unauthorized")) {
        await ensureValidToken(true);
        return downloadWithSpotiDownloader(track, settings, playlistName, position, retryCount + 1, isAlbum, releaseYear);
      }
    }

    if (!response.success && response.item_id) {
      const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
      await MarkDownloadItemFailed(response.item_id, response.error || "Download failed");
    }

    return response;
  };

  const handleDownloadTrack = async (
    track: TrackMetadata,
    playlistName?: string,
    _isArtistDiscography?: boolean,
    isAlbum?: boolean,
    position?: number
  ) => {
    if (!track.isrc) {
      toast.error("No ISRC found for this track");
      return;
    }

    logger.info(`starting download: ${track.name} - ${track.artists}`);
    const settings = getSettings();
    setDownloadingTrack(track.isrc);

    try {
      const response = await downloadWithSpotiDownloader(track, settings, playlistName, position, 0, isAlbum);

      if (response.success) {
        if (response.already_exists) {
          logger.info(`skipped: ${track.name} - ${track.artists} (already exists)`);
          toast.info(response.message);
          setSkippedTracks((prev) => new Set(prev).add(track.isrc));
        } else {
          logger.success(`downloaded: ${track.name} - ${track.artists}`);
          toast.success(response.message);
        }
        setDownloadedTracks((prev) => new Set(prev).add(track.isrc));
        setFailedTracks((prev) => {
          const newSet = new Set(prev);
          newSet.delete(track.isrc);
          return newSet;
        });
      } else {
        logger.error(`failed: ${track.name} - ${track.artists} - ${response.error}`);
        toast.error(response.error || "Download failed");
        setFailedTracks((prev) => new Set(prev).add(track.isrc));
      }
    } catch (err) {
      logger.error(`error: ${track.name} - ${err}`);
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
    isAlbum?: boolean
  ) => {
    if (selectedTracks.length === 0) {
      toast.error("No tracks selected");
      return;
    }

    logger.info(`starting batch download: ${selectedTracks.length} selected tracks`);
    const settings = getSettings();
    setIsDownloading(true);
    setBulkDownloadType("selected");
    setDownloadProgress(0);

    // Build output directory path
    let outputDir = settings.downloadPath;
    const os = settings.operatingSystem;
    if (playlistName && !isAlbum) {
      outputDir = joinPath(os, outputDir, sanitizePath(playlistName.replace(/\//g, " "), os));
    }

    // Get selected track objects
    const selectedTrackObjects = selectedTracks
      .map((isrc) => allTracks.find((t) => t.isrc === isrc))
      .filter((t): t is TrackMetadata => t !== undefined);

    // Check file existence in parallel first
    logger.info(`checking existing files in parallel...`);
    const existenceChecks = selectedTrackObjects.map((track) => ({
      isrc: track.isrc,
      track_name: track.name || "",
      artist_name: track.artists || "",
    }));

    const existenceResults = await CheckFilesExistence(outputDir, settings.audioFormat, existenceChecks);
    const existingISRCs = new Set<string>();
    const existingFilePaths = new Map<string, string>();

    for (const result of existenceResults) {
      if (result.exists) {
        existingISRCs.add(result.isrc);
        existingFilePaths.set(result.isrc, result.file_path || "");
      }
    }

    logger.info(`found ${existingISRCs.size} existing files`);

    // Mark existing files as skipped immediately and add to queue
    const { AddToDownloadQueue } = await import("../../wailsjs/go/main/App");
    for (const track of selectedTrackObjects) {
      if (existingISRCs.has(track.isrc)) {
        const itemID = await AddToDownloadQueue(track.isrc, track.name || "", track.artists || "", track.album_name || "");
        const filePath = existingFilePaths.get(track.isrc) || "";
        setTimeout(() => SkipDownloadItem(itemID, filePath), 10);
        setSkippedTracks((prev) => new Set(prev).add(track.isrc));
        setDownloadedTracks((prev) => new Set(prev).add(track.isrc));
      }
    }

    // Filter out existing tracks
    const tracksToDownload = selectedTrackObjects.filter((track) => !existingISRCs.has(track.isrc));

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = existingISRCs.size;
    const total = selectedTracks.length;

    // Update progress to reflect already-skipped tracks
    setDownloadProgress(Math.round((skippedCount / total) * 100));

    for (let i = 0; i < tracksToDownload.length; i++) {
      if (shouldStopDownloadRef.current) {
        toast.info(`Download stopped. ${successCount} tracks downloaded, ${tracksToDownload.length - i} remaining.`);
        break;
      }

      const track = tracksToDownload[i];
      const isrc = track.isrc;
      // Calculate original position in selected list
      const originalIndex = selectedTracks.indexOf(isrc);
      setDownloadingTrack(isrc);
      setCurrentDownloadInfo({ name: track.name, artists: track.artists });

      try {
        const releaseYear = track.release_date?.substring(0, 4);
        const response = await downloadWithSpotiDownloader(track, settings, playlistName, originalIndex + 1, 0, isAlbum, releaseYear);

        if (response.success) {
          if (response.already_exists) {
            skippedCount++;
            logger.info(`skipped: ${track.name} - ${track.artists} (already exists)`);
            setSkippedTracks((prev) => new Set(prev).add(isrc));
          } else {
            successCount++;
            logger.success(`downloaded: ${track.name} - ${track.artists}`);
          }
          setDownloadedTracks((prev) => new Set(prev).add(isrc));
          setFailedTracks((prev) => {
            const newSet = new Set(prev);
            newSet.delete(isrc);
            return newSet;
          });
        } else {
          errorCount++;
          logger.error(`failed: ${track.name} - ${track.artists}`);
          setFailedTracks((prev) => new Set(prev).add(isrc));
        }
      } catch (err) {
        errorCount++;
        logger.error(`error: ${track.name} - ${err}`);
        setFailedTracks((prev) => new Set(prev).add(isrc));
      }

      const completedCount = skippedCount + successCount + errorCount;
      setDownloadProgress(Math.min(100, Math.round((completedCount / total) * 100)));
    }

    setDownloadingTrack(null);
    setCurrentDownloadInfo(null);
    setIsDownloading(false);
    setBulkDownloadType(null);
    shouldStopDownloadRef.current = false;

    logger.info(`batch complete: ${successCount} downloaded, ${skippedCount} skipped, ${errorCount} failed`);
    if (errorCount === 0 && skippedCount === 0) {
      toast.success(`Downloaded ${successCount} tracks successfully`);
    } else if (errorCount === 0 && successCount === 0) {
      toast.info(`${skippedCount} tracks already exist`);
    } else if (errorCount === 0) {
      toast.info(`${successCount} downloaded, ${skippedCount} skipped`);
    } else {
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
    isAlbum?: boolean
  ) => {
    const tracksWithIsrc = tracks.filter((track) => track.isrc);

    if (tracksWithIsrc.length === 0) {
      toast.error("No tracks available for download");
      return;
    }

    logger.info(`starting batch download: ${tracksWithIsrc.length} tracks`);
    const settings = getSettings();
    setIsDownloading(true);
    setBulkDownloadType("all");
    setDownloadProgress(0);

    // Build output directory path (same logic as downloadWithSpotiDownloader)
    let outputDir = settings.downloadPath;
    const os = settings.operatingSystem;
    if (playlistName && !isAlbum) {
      outputDir = joinPath(os, outputDir, sanitizePath(playlistName.replace(/\//g, " "), os));
    }

    // Check file existence in parallel first
    logger.info(`checking existing files in parallel...`);
    const existenceChecks = tracksWithIsrc.map((track) => ({
      isrc: track.isrc,
      track_name: track.name || "",
      artist_name: track.artists || "",
    }));

    const existenceResults = await CheckFilesExistence(outputDir, settings.audioFormat, existenceChecks);
    const existingISRCs = new Set<string>();
    const existingFilePaths = new Map<string, string>();

    for (const result of existenceResults) {
      if (result.exists) {
        existingISRCs.add(result.isrc);
        existingFilePaths.set(result.isrc, result.file_path || "");
      }
    }

    logger.info(`found ${existingISRCs.size} existing files`);

    // Mark existing files as skipped immediately and add to queue
    const { AddToDownloadQueue } = await import("../../wailsjs/go/main/App");
    for (const track of tracksWithIsrc) {
      if (existingISRCs.has(track.isrc)) {
        const itemID = await AddToDownloadQueue(track.isrc, track.name || "", track.artists || "", track.album_name || "");
        const filePath = existingFilePaths.get(track.isrc) || "";
        // Use a small delay to ensure the item is added before skipping
        setTimeout(() => SkipDownloadItem(itemID, filePath), 10);
        setSkippedTracks((prev) => new Set(prev).add(track.isrc));
        setDownloadedTracks((prev) => new Set(prev).add(track.isrc));
      }
    }

    // Filter out existing tracks
    const tracksToDownload = tracksWithIsrc.filter((track) => !existingISRCs.has(track.isrc));

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = existingISRCs.size;
    const total = tracksWithIsrc.length;

    // Update progress to reflect already-skipped tracks
    setDownloadProgress(Math.round((skippedCount / total) * 100));

    for (let i = 0; i < tracksToDownload.length; i++) {
      if (shouldStopDownloadRef.current) {
        toast.info(`Download stopped. ${successCount} tracks downloaded, ${tracksToDownload.length - i} remaining.`);
        break;
      }

      const track = tracksToDownload[i];
      // Calculate original position in full list
      const originalIndex = tracksWithIsrc.findIndex((t) => t.isrc === track.isrc);
      setDownloadingTrack(track.isrc);
      setCurrentDownloadInfo({ name: track.name, artists: track.artists });

      try {
        const releaseYear = track.release_date?.substring(0, 4);
        const response = await downloadWithSpotiDownloader(track, settings, playlistName, originalIndex + 1, 0, isAlbum, releaseYear);

        if (response.success) {
          if (response.already_exists) {
            skippedCount++;
            logger.info(`skipped: ${track.name} - ${track.artists} (already exists)`);
            setSkippedTracks((prev) => new Set(prev).add(track.isrc));
          } else {
            successCount++;
            logger.success(`downloaded: ${track.name} - ${track.artists}`);
          }
          setDownloadedTracks((prev) => new Set(prev).add(track.isrc));
          setFailedTracks((prev) => {
            const newSet = new Set(prev);
            newSet.delete(track.isrc);
            return newSet;
          });
        } else {
          errorCount++;
          logger.error(`failed: ${track.name} - ${track.artists}`);
          setFailedTracks((prev) => new Set(prev).add(track.isrc));
        }
      } catch (err) {
        errorCount++;
        logger.error(`error: ${track.name} - ${err}`);
        setFailedTracks((prev) => new Set(prev).add(track.isrc));
      }

      const completedCount = skippedCount + successCount + errorCount;
      setDownloadProgress(Math.min(100, Math.round((completedCount / total) * 100)));
    }

    setDownloadingTrack(null);
    setCurrentDownloadInfo(null);
    setIsDownloading(false);
    setBulkDownloadType(null);
    shouldStopDownloadRef.current = false;

    logger.info(`batch complete: ${successCount} downloaded, ${skippedCount} skipped, ${errorCount} failed`);
    if (errorCount === 0 && skippedCount === 0) {
      toast.success(`Downloaded ${successCount} tracks successfully`);
    } else if (errorCount === 0 && successCount === 0) {
      toast.info(`${skippedCount} tracks already exist`);
    } else if (errorCount === 0) {
      toast.info(`${successCount} downloaded, ${skippedCount} skipped`);
    } else {
      const parts = [];
      if (successCount > 0) parts.push(`${successCount} downloaded`);
      if (skippedCount > 0) parts.push(`${skippedCount} skipped`);
      parts.push(`${errorCount} failed`);
      toast.warning(parts.join(", "));
    }
  };

  const handleStopDownload = () => {
    logger.info("download stopped by user");
    shouldStopDownloadRef.current = true;
    toast.info("Stopping download...");
  };

  const resetDownloadedTracks = () => {
    setDownloadedTracks(new Set());
    setFailedTracks(new Set());
    setSkippedTracks(new Set());
  };

  return {
    downloadProgress,
    isDownloading,
    downloadingTrack,
    bulkDownloadType,
    downloadedTracks,
    failedTracks,
    skippedTracks,
    currentDownloadInfo,
    handleDownloadTrack,
    handleDownloadSelected,
    handleDownloadAll,
    handleStopDownload,
    resetDownloadedTracks,
  };
}
