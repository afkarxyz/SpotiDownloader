import { useState, useRef } from "react";
import { downloadTrack } from "@/lib/api";
import { getSettings, parseTemplate, type TemplateData } from "@/lib/settings";
import { ensureValidToken } from "@/lib/token-manager";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { joinPath, sanitizePath } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { TrackMetadata } from "@/types/api";

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
      title: track.name?.replace(/\//g, placeholder) || undefined,
      track: position,
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

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const total = selectedTracks.length;

    for (let i = 0; i < selectedTracks.length; i++) {
      if (shouldStopDownloadRef.current) {
        toast.info(`Download stopped. ${successCount} tracks downloaded, ${selectedTracks.length - i} skipped.`);
        break;
      }

      const isrc = selectedTracks[i];
      const track = allTracks.find((t) => t.isrc === isrc);
      setDownloadingTrack(isrc);

      if (track) {
        setCurrentDownloadInfo({ name: track.name, artists: track.artists });
      }

      try {
        if (!track) continue;
        const releaseYear = track.release_date?.substring(0, 4);
        const response = await downloadWithSpotiDownloader(track, settings, playlistName, i + 1, 0, isAlbum, releaseYear);

        if (response.success) {
          if (response.already_exists) {
            skippedCount++;
            logger.info(`skipped: ${track?.name} - ${track?.artists} (already exists)`);
            setSkippedTracks((prev) => new Set(prev).add(isrc));
          } else {
            successCount++;
            logger.success(`downloaded: ${track?.name} - ${track?.artists}`);
          }
          setDownloadedTracks((prev) => new Set(prev).add(isrc));
          setFailedTracks((prev) => {
            const newSet = new Set(prev);
            newSet.delete(isrc);
            return newSet;
          });
        } else {
          errorCount++;
          logger.error(`failed: ${track?.name} - ${track?.artists}`);
          setFailedTracks((prev) => new Set(prev).add(isrc));
        }
      } catch (err) {
        errorCount++;
        logger.error(`error: ${track?.name} - ${err}`);
        setFailedTracks((prev) => new Set(prev).add(isrc));
      }

      setDownloadProgress(Math.round(((i + 1) / total) * 100));
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

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const total = tracksWithIsrc.length;

    for (let i = 0; i < tracksWithIsrc.length; i++) {
      if (shouldStopDownloadRef.current) {
        toast.info(`Download stopped. ${successCount} tracks downloaded, ${tracksWithIsrc.length - i} skipped.`);
        break;
      }

      const track = tracksWithIsrc[i];
      setDownloadingTrack(track.isrc);
      setCurrentDownloadInfo({ name: track.name, artists: track.artists });

      try {
        const releaseYear = track.release_date?.substring(0, 4);
        const response = await downloadWithSpotiDownloader(track, settings, playlistName, i + 1, 0, isAlbum, releaseYear);

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

      setDownloadProgress(Math.round(((i + 1) / total) * 100));
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
