import { useState, useRef } from "react";
import { downloadTrack, fetchSpotifyMetadata } from "@/lib/api";
import { CheckFilesExistence, CreateM3U8File, SkipDownloadItem } from "../../wailsjs/go/main/App";
import { getSettingsWithDefaults, parseTemplate, type Settings, type TemplateData } from "@/lib/settings";
import { ensureValidToken } from "@/lib/token-manager";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { joinPath, sanitizePath, getFirstArtist } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { TrackMetadata } from "@/types/api";
interface CheckFileExistenceRequest {
    spotify_id: string;
    track_name: string;
    artist_name: string;
    album_name?: string;
    album_artist?: string;
    release_date?: string;
    track_number?: number;
    disc_number?: number;
    position?: number;
    use_album_track_number?: boolean;
    filename_format?: string;
    include_track_number?: boolean;
    audio_format?: string;
    relative_path?: string;
}
interface BatchTrackPathInfo {
    displayArtist: string;
    displayAlbumArtist: string;
    baseOutputDir: string;
    targetOutputDir: string;
    relativePath: string;
    trackPosition: number;
    useAlbumTrackNumber: boolean;
}
function normalizeReleaseDate(releaseDate?: string): string {
    if (!releaseDate) {
        return "";
    }
    const trimmedReleaseDate = releaseDate.trim();
    if (!trimmedReleaseDate) {
        return "";
    }
    const dateWithoutTime = trimmedReleaseDate.split("T")[0] || trimmedReleaseDate;
    return dateWithoutTime.split(" ")[0] || dateWithoutTime;
}
function getReleaseYear(releaseDate?: string): string {
    const normalizedReleaseDate = normalizeReleaseDate(releaseDate);
    return normalizedReleaseDate.length >= 4 ? normalizedReleaseDate.slice(0, 4) : "";
}
function folderTemplateNeedsReleaseDate(settings: Settings): boolean {
    const folderTemplate = settings.folderTemplate || "";
    return folderTemplate.includes("{year}") || folderTemplate.includes("{date}");
}
async function enrichTrackReleaseDate(track: TrackMetadata, settings: Settings): Promise<TrackMetadata> {
    const normalizedReleaseDate = normalizeReleaseDate(track.release_date);
    if (!folderTemplateNeedsReleaseDate(settings)) {
        return normalizedReleaseDate === (track.release_date || "")
            ? track
            : { ...track, release_date: normalizedReleaseDate };
    }
    if (normalizedReleaseDate) {
        return normalizedReleaseDate === (track.release_date || "")
            ? track
            : { ...track, release_date: normalizedReleaseDate };
    }
    if (!track.spotify_id) {
        return track;
    }
    try {
        const trackURL = `https://open.spotify.com/track/${track.spotify_id}`;
        const trackMetadata = await fetchSpotifyMetadata(trackURL, false, 0, 10);
        if ("track" in trackMetadata && trackMetadata.track?.release_date) {
            const enrichedReleaseDate = normalizeReleaseDate(trackMetadata.track.release_date);
            if (enrichedReleaseDate) {
                return {
                    ...track,
                    release_date: enrichedReleaseDate,
                };
            }
        }
    }
    catch {
    }
    return track;
}
async function enrichTracksReleaseDates(tracks: TrackMetadata[], settings: Settings): Promise<TrackMetadata[]> {
    if (!folderTemplateNeedsReleaseDate(settings)) {
        return tracks;
    }
    return await Promise.all(tracks.map((track) => enrichTrackReleaseDate(track, settings)));
}
function buildBatchTrackPathInfo(track: TrackMetadata, settings: Settings, playlistName: string | undefined, isAlbum: boolean | undefined, fallbackPosition: number): BatchTrackPathInfo {
    const os = settings.operatingSystem;
    const placeholder = "__SLASH_PLACEHOLDER__";
    const folderTemplate = settings.folderTemplate || "";
    const finalTrackNumber = track.track_number || 0;
    const hasSubfolder = folderTemplate.trim() !== "";
    const trackPosition = hasSubfolder && finalTrackNumber > 0 ? finalTrackNumber : fallbackPosition;
    const displayArtist = settings.useFirstArtistOnly && track.artists ? getFirstArtist(track.artists) : (track.artists || "");
    const displayAlbumArtist = settings.useFirstArtistOnly && track.album_artist
        ? getFirstArtist(track.album_artist)
        : (track.album_artist || track.artists || "");
    const templateData: TemplateData = {
        artist: displayArtist.replace(/\//g, placeholder),
        album: (track.album_name || "").replace(/\//g, placeholder),
        album_artist: displayAlbumArtist.replace(/\//g, placeholder),
        title: (track.name || "").replace(/\//g, placeholder),
        track: trackPosition,
        disc: track.disc_number,
        year: getReleaseYear(track.release_date),
        date: normalizeReleaseDate(track.release_date),
        playlist: playlistName?.replace(/\//g, placeholder),
    };
    const useAlbumSubfolder = folderTemplate.includes("{album}") ||
        folderTemplate.includes("{album_artist}") ||
        folderTemplate.includes("{playlist}");
    let baseOutputDir = settings.downloadPath;
    if (settings.createPlaylistFolder &&
        playlistName &&
        (!isAlbum || !useAlbumSubfolder)) {
        baseOutputDir = joinPath(os, baseOutputDir, sanitizePath(playlistName.replace(/\//g, " "), os));
    }
    let targetOutputDir = baseOutputDir;
    let relativePath = "";
    if (folderTemplate) {
        const folderPath = parseTemplate(folderTemplate, templateData);
        if (folderPath) {
            const parts = folderPath.split("/").filter((p: string) => p.trim());
            const sanitizedParts = parts.map((part: string) => {
                const sanitizedPart = part.replace(new RegExp(placeholder, "g"), " ");
                return sanitizePath(sanitizedPart, os);
            });
            relativePath = sanitizedParts.join(os === "Windows" ? "\\" : "/");
            for (const part of sanitizedParts) {
                targetOutputDir = joinPath(os, targetOutputDir, part);
            }
        }
    }
    return {
        displayArtist,
        displayAlbumArtist,
        baseOutputDir,
        targetOutputDir,
        relativePath,
        trackPosition,
        useAlbumTrackNumber: hasSubfolder,
    };
}
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
    const isRetryableError = (error?: string) => {
        const msg = (error || "").toLowerCase();
        const isUnauthorized = (msg.includes("unauthorized") || msg.includes("403") || msg.includes("401") || msg.includes("err_unauthorized"));
        // Sometimes, the API returns 400 for expired tokens, worth retrying on this error too.
        const isInvalidRequest = (msg.includes("err_request_invalid") || msg.includes("400"));
        return isUnauthorized || isInvalidRequest;
    };
    const downloadWithSpotiDownloader = async (track: TrackMetadata, settings: Settings, playlistName?: string, position?: number, isAlbum?: boolean, releaseYear?: string) => {
        const os = settings.operatingSystem;
        let outputDir = settings.downloadPath;
        let useAlbumTrackNumber = false;
        const placeholder = "__SLASH_PLACEHOLDER__";
        let finalReleaseDate = normalizeReleaseDate(track.release_date);
        let finalTrackNumber = track.track_number;
        if (track.spotify_id) {
            try {
                const trackURL = `https://open.spotify.com/track/${track.spotify_id}`;
                const trackMetadata = await fetchSpotifyMetadata(trackURL, false, 0, 10);
                if ("track" in trackMetadata && trackMetadata.track) {
                    if (trackMetadata.track.release_date) {
                        finalReleaseDate = normalizeReleaseDate(trackMetadata.track.release_date);
                    }
                    if (trackMetadata.track.track_number > 0) {
                        finalTrackNumber = trackMetadata.track.track_number;
                    }
                }
            }
            catch {
            }
        }
        const resolvedReleaseDate = finalReleaseDate || normalizeReleaseDate(track.release_date);
        const yearValue = releaseYear || getReleaseYear(resolvedReleaseDate);
        const hasSubfolder = settings.folderTemplate && settings.folderTemplate.trim() !== "";
        const trackNumberForTemplate = hasSubfolder && finalTrackNumber > 0 ? finalTrackNumber : position || 0;
        if (hasSubfolder) {
            useAlbumTrackNumber = true;
        }
        const displayArtist = settings.useFirstArtistOnly && track.artists
            ? getFirstArtist(track.artists)
            : track.artists;
        const displayAlbumArtist = settings.useFirstArtistOnly && track.album_artist
            ? getFirstArtist(track.album_artist)
            : track.album_artist;
        const templateData: TemplateData = {
            artist: displayArtist?.replace(/\//g, placeholder) || undefined,
            album: track.album_name?.replace(/\//g, placeholder) || undefined,
            album_artist: displayAlbumArtist?.replace(/\//g, placeholder) ||
                displayArtist?.replace(/\//g, placeholder) ||
                undefined,
            title: track.name?.replace(/\//g, placeholder) || undefined,
            track: trackNumberForTemplate,
            disc: track.disc_number,
            year: yearValue,
            date: resolvedReleaseDate || undefined,
            playlist: playlistName?.replace(/\//g, placeholder) || undefined,
        };
        const folderTemplate = settings.folderTemplate || "";
        const useAlbumSubfolder = folderTemplate.includes("{album}") ||
            folderTemplate.includes("{album_artist}") ||
            folderTemplate.includes("{playlist}");
        if (settings.createPlaylistFolder &&
            playlistName &&
            (!isAlbum || !useAlbumSubfolder)) {
            outputDir = joinPath(os, outputDir, sanitizePath(playlistName.replace(/\//g, " "), os));
        }
        if (settings.folderTemplate) {
            const folderPath = parseTemplate(settings.folderTemplate, templateData);
            if (folderPath) {
                const parts = folderPath.split("/").filter((p: string) => p.trim());
                for (const part of parts) {
                    const sanitizedPart = part.replace(new RegExp(placeholder, "g"), " ");
                    outputDir = joinPath(os, outputDir, sanitizePath(sanitizedPart, os));
                }
            }
        }
        if (track.name && track.artists) {
            try {
                const checkRequest: CheckFileExistenceRequest = {
                    spotify_id: track.spotify_id || "",
                    track_name: track.name,
                    artist_name: displayArtist || "",
                    album_name: track.album_name,
                    album_artist: displayAlbumArtist,
                    release_date: resolvedReleaseDate || "",
                    track_number: finalTrackNumber || 0,
                    disc_number: track.disc_number || 0,
                    position: trackNumberForTemplate,
                    use_album_track_number: useAlbumTrackNumber,
                    filename_format: settings.filenameTemplate || "",
                    include_track_number: settings.trackNumber || false,
                    audio_format: settings.audioFormat,
                };
                const existenceResults = await CheckFilesExistence(outputDir, settings.downloadPath, settings.audioFormat, [checkRequest]);
                if (existenceResults.length > 0 && existenceResults[0].exists) {
                    return {
                        success: true,
                        message: "File already exists",
                        file: existenceResults[0].file_path || "",
                        already_exists: true,
                    };
                }
            }
            catch (err) {
                console.warn("File existence check failed:", err);
            }
        }
        let sessionToken = await ensureValidToken();
        const { AddToDownloadQueue } = await import("../../wailsjs/go/main/App");
        const itemID = await AddToDownloadQueue(track.spotify_id || "", track.name || "", displayArtist || "", track.album_name || "");
        let downloadRequest = {
            track_id: track.spotify_id || "",
            session_token: sessionToken,
            track_name: track.name,
            artist_name: track.artists,
            album_name: track.album_name,
            album_artist: track.album_artist || track.artists,
            release_date: resolvedReleaseDate,
            cover_url: track.images,
            album_track_number: finalTrackNumber || track.track_number,
            disc_number: track.disc_number,
            total_tracks: track.total_tracks,
            spotify_total_discs: track.total_discs,
            copyright: track.copyright,
            publisher: track.publisher,
            output_dir: outputDir,
            audio_format: settings.audioFormat,
            filename_format: settings.filenameTemplate,
            use_first_artist_only: settings.useFirstArtistOnly,
            track_number: settings.trackNumber,
            position: trackNumberForTemplate,
            use_album_track_number: useAlbumTrackNumber,
            spotify_id: track.spotify_id,
            embed_lyrics: settings.embedLyrics,
            embed_max_quality_cover: settings.embedMaxQualityCover,
            item_id: itemID,
            use_single_genre: settings.useSingleGenre,
            embed_genre: settings.embedGenre,
        };
        let response = await downloadTrack(downloadRequest);
        
        if (!response.success && isRetryableError(response.error)) {
            sessionToken = await ensureValidToken(true);
            downloadRequest.session_token = sessionToken
            response = await downloadTrack(downloadRequest);
        }

        if (!response.success && response.item_id) {
            const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
            await MarkDownloadItemFailed(response.item_id, response.error || "Download failed");
        }
        return response;
    };
    const handleDownloadTrack = async (track: TrackMetadata, playlistName?: string, _isArtistDiscography?: boolean, isAlbum?: boolean, position?: number) => {
        const id = track.spotify_id;
        if (!id) {
            toast.error("No ID found for this track");
            return;
        }
        const settings = await getSettingsWithDefaults();
        const displayArtist = settings.useFirstArtistOnly && track.artists ? getFirstArtist(track.artists) : track.artists;
        logger.info(`starting download: ${track.name} - ${displayArtist}`);
        setDownloadingTrack(id);
        try {
            const response = await downloadWithSpotiDownloader(track, settings, playlistName, position, isAlbum);
            if (response.success) {
                if (response.already_exists) {
                    logger.info(`skipped: ${track.name} - ${displayArtist} (already exists)`);
                    toast.info(response.message);
                    setSkippedTracks((prev) => new Set(prev).add(id));
                }
                else {
                    logger.success(`downloaded: ${track.name} - ${displayArtist}`);
                    toast.success(response.message);
                }
                setDownloadedTracks((prev: Set<string>) => new Set(prev).add(id));
                setFailedTracks((prev: Set<string>) => {
                    const newSet = new Set(prev);
                    newSet.delete(id);
                    return newSet;
                });
            }
            else {
                logger.error(`failed: ${track.name} - ${displayArtist} - ${response.error}`);
                toast.error(response.error || "Download failed");
                setFailedTracks((prev) => new Set(prev).add(id));
            }
        }
        catch (err) {
            logger.error(`error: ${track.name} - ${err}`);
            toast.error(err instanceof Error ? err.message : "Download failed");
            setFailedTracks((prev) => new Set(prev).add(id));
        }
        finally {
            setDownloadingTrack(null);
        }
    };
    const handleDownloadSelected = async (selectedTracks: string[], allTracks: TrackMetadata[], playlistName?: string, isAlbum?: boolean) => {
        if (selectedTracks.length === 0) {
            toast.error("No tracks selected");
            return;
        }
        logger.info(`starting batch download: ${selectedTracks.length} selected tracks`);
        const settings = await getSettingsWithDefaults();
        setIsDownloading(true);
        setBulkDownloadType("selected");
        setDownloadProgress(0);
        const selectedTrackObjects = await enrichTracksReleaseDates(selectedTracks
            .map((id) => allTracks.find((t) => t.spotify_id === id))
            .filter((t): t is TrackMetadata => t !== undefined), settings);
        const selectedTrackPathInfo = selectedTrackObjects.map((track, index) => ({
            track,
            pathInfo: buildBatchTrackPathInfo(track, settings, playlistName, isAlbum, index + 1),
        }));
        const outputDir = selectedTrackPathInfo[0]?.pathInfo.baseOutputDir || settings.downloadPath;
        logger.info(`checking existing files in parallel...`);
        const existenceChecks = selectedTrackPathInfo.map(({ track, pathInfo }) => {
            return {
                spotify_id: track.spotify_id || "",
                track_name: track.name || "",
                artist_name: pathInfo.displayArtist,
                album_name: track.album_name || "",
                album_artist: pathInfo.displayAlbumArtist,
                release_date: normalizeReleaseDate(track.release_date),
                track_number: track.track_number || 0,
                disc_number: track.disc_number || 0,
                position: pathInfo.trackPosition,
                use_album_track_number: pathInfo.useAlbumTrackNumber,
                filename_format: settings.filenameTemplate || "",
                include_track_number: settings.trackNumber || false,
                audio_format: settings.audioFormat,
                relative_path: pathInfo.relativePath,
            };
        });
        const existenceResults = await CheckFilesExistence(outputDir, settings.downloadPath, settings.audioFormat, existenceChecks);
        const existingSpotifyIDs = new Set<string>();
        const existingFilePathsBySpotifyID = new Map<string, string>();
        const finalFilePaths = new Map<string, string>();
        for (const result of existenceResults) {
            if (result.exists) {
                existingSpotifyIDs.add(result.spotify_id);
                existingFilePathsBySpotifyID.set(result.spotify_id, result.file_path || "");
                finalFilePaths.set(result.spotify_id, result.file_path || "");
            }
        }
        logger.info(`found ${existingSpotifyIDs.size} existing files`);
        const { AddToDownloadQueue } = await import("../../wailsjs/go/main/App");
        for (const { track, pathInfo } of selectedTrackPathInfo) {
            const trackID = track.spotify_id || "";
            if (existingSpotifyIDs.has(trackID)) {
                const itemID = await AddToDownloadQueue(track.spotify_id || "", track.name || "", pathInfo.displayArtist, track.album_name || "");
                const filePath = existingFilePathsBySpotifyID.get(trackID) || "";
                setTimeout(() => SkipDownloadItem(itemID, filePath), 10);
                setSkippedTracks((prev: Set<string>) => new Set(prev).add(trackID));
                setDownloadedTracks((prev: Set<string>) => new Set(prev).add(trackID));
            }
        }
        const tracksToDownload = selectedTrackObjects.filter((track) => {
            const trackID = track.spotify_id || "";
            return !existingSpotifyIDs.has(trackID);
        });
        let sessionToken = settings.sessionToken || "";
        if (tracksToDownload.length > 0) {
            try {
                sessionToken = await ensureValidToken();
            }
            catch (err) {
                logger.error(`failed to fetch session token for batch: ${err}`);
                toast.error(err instanceof Error ? err.message : "Failed to fetch session token");
                setDownloadingTrack(null);
                setCurrentDownloadInfo(null);
                setIsDownloading(false);
                setBulkDownloadType(null);
                shouldStopDownloadRef.current = false;
                return;
            }
        }
        let successCount = 0;
        let errorCount = 0;
        let skippedCount = existingSpotifyIDs.size;
        const total = selectedTracks.length;
        setDownloadProgress(Math.round((skippedCount / total) * 100));
        for (let i = 0; i < tracksToDownload.length; i++) {
            if (shouldStopDownloadRef.current) {
                toast.info(`Download stopped. ${successCount} tracks downloaded, ${tracksToDownload.length - i} remaining.`);
                break;
            }
            const track = tracksToDownload[i];
            const id = track.spotify_id || "";
            const displayArtist = settings.useFirstArtistOnly && track.artists ? getFirstArtist(track.artists) : track.artists;
            setDownloadingTrack(id);
            setCurrentDownloadInfo({ name: track.name, artists: displayArtist || "" });
            try {
                const playlistIndex = selectedTracks.indexOf(id) + 1;
                const pathInfo = buildBatchTrackPathInfo(track, settings, playlistName, isAlbum, playlistIndex);
                let downloadRequest = {
                    track_id: id,
                    session_token: sessionToken,
                    track_name: track.name || "",
                    artist_name: track.artists,
                    album_name: track.album_name,
                    album_artist: track.album_artist || track.artists,
                    release_date: normalizeReleaseDate(track.release_date),
                    cover_url: track.images,
                    album_track_number: track.track_number,
                    disc_number: track.disc_number,
                    total_tracks: track.total_tracks,
                    spotify_total_discs: track.total_discs,
                    copyright: track.copyright,
                    publisher: track.publisher,
                    output_dir: pathInfo.targetOutputDir,
                    audio_format: settings.audioFormat,
                    filename_format: settings.filenameTemplate,
                    track_number: settings.trackNumber,
                    position: pathInfo.trackPosition,
                    use_album_track_number: pathInfo.useAlbumTrackNumber,
                    embed_lyrics: settings.embedLyrics,
                    embed_max_quality_cover: settings.embedMaxQualityCover,
                    use_first_artist_only: settings.useFirstArtistOnly,
                    use_single_genre: settings.useSingleGenre,
                    embed_genre: settings.embedGenre,
                };
                let response = await downloadTrack(downloadRequest);

                if (!response.success && isRetryableError(response.error)) {
                    sessionToken = await ensureValidToken(true);
                    downloadRequest.session_token = sessionToken
                    response = await downloadTrack(downloadRequest);
                }

                if (response.success) {
                    if (response.already_exists) {
                        skippedCount++;
                        logger.info(`skipped: ${track.name} - ${displayArtist} (already exists)`);
                        setSkippedTracks((prev) => new Set(prev).add(id));
                    }
                    else {
                        successCount++;
                        logger.success(`downloaded: ${track.name} - ${displayArtist}`);
                    }
                    if (response.file) {
                        finalFilePaths.set(id, response.file);
                        finalFilePaths.set(track.spotify_id || id, response.file);
                    }
                    setDownloadedTracks((prev) => new Set(prev).add(id));
                    setFailedTracks((prev) => {
                        const newSet = new Set(prev);
                        newSet.delete(id);
                        return newSet;
                    });
                }
                else {
                    errorCount++;
                    logger.error(`failed: ${track.name} - ${displayArtist}`);
                    setFailedTracks((prev) => new Set(prev).add(id));
                }
            }
            catch (err) {
                errorCount++;
                logger.error(`error: ${track.name} - ${err}`);
                setFailedTracks((prev) => new Set(prev).add(id));
            }
            const completedCount = skippedCount + successCount + errorCount;
            setDownloadProgress(Math.min(100, Math.round((completedCount / total) * 100)));
        }
        setDownloadingTrack(null);
        setCurrentDownloadInfo(null);
        setIsDownloading(false);
        setBulkDownloadType(null);
        shouldStopDownloadRef.current = false;
        if (settings.createM3u8File && playlistName) {
            const paths = selectedTrackObjects
                .map((t) => finalFilePaths.get(t.spotify_id || "") || "")
                .filter((p) => p !== "");
            if (paths.length > 0) {
                try {
                    logger.info(`creating m3u8 playlist: ${playlistName}`);
                    await CreateM3U8File(playlistName, outputDir, paths);
                    toast.success("M3U8 playlist created");
                }
                catch (err) {
                    logger.error(`failed to create m3u8 playlist: ${err}`);
                    toast.error(`Failed to create M3U8 playlist: ${err}`);
                }
            }
        }
        logger.info(`batch complete: ${successCount} downloaded, ${skippedCount} skipped, ${errorCount} failed`);
        if (errorCount === 0 && skippedCount === 0) {
            toast.success(`Downloaded ${successCount} tracks successfully`);
        }
        else if (errorCount === 0 && successCount === 0) {
            toast.info(`${skippedCount} tracks already exist`);
        }
        else if (errorCount === 0) {
            toast.info(`${successCount} downloaded, ${skippedCount} skipped`);
        }
        else {
            const parts = [];
            if (successCount > 0)
                parts.push(`${successCount} downloaded`);
            if (skippedCount > 0)
                parts.push(`${skippedCount} skipped`);
            parts.push(`${errorCount} failed`);
            toast.warning(parts.join(", "));
        }
    };
    const handleDownloadAll = async (tracks: TrackMetadata[], playlistName?: string, isAlbum?: boolean) => {
        const tracksWithId = tracks.filter((track) => track.spotify_id);
        if (tracksWithId.length === 0) {
            toast.error("No tracks available for download");
            return;
        }
        logger.info(`starting batch download: ${tracksWithId.length} tracks`);
        const settings = await getSettingsWithDefaults();
        setIsDownloading(true);
        setBulkDownloadType("all");
        setDownloadProgress(0);
        const enrichedTracksWithId = await enrichTracksReleaseDates(tracksWithId, settings);
        const trackPathInfo = enrichedTracksWithId.map((track, index) => ({
            track,
            pathInfo: buildBatchTrackPathInfo(track, settings, playlistName, isAlbum, index + 1),
        }));
        const outputDir = trackPathInfo[0]?.pathInfo.baseOutputDir || settings.downloadPath;
        logger.info(`checking existing files in parallel...`);
        const existenceChecks = trackPathInfo.map(({ track, pathInfo }) => {
            return {
                spotify_id: track.spotify_id || "",
                track_name: track.name || "",
                artist_name: pathInfo.displayArtist,
                album_name: track.album_name || "",
                album_artist: pathInfo.displayAlbumArtist,
                release_date: normalizeReleaseDate(track.release_date),
                track_number: track.track_number || 0,
                disc_number: track.disc_number || 0,
                position: pathInfo.trackPosition,
                use_album_track_number: pathInfo.useAlbumTrackNumber,
                filename_format: settings.filenameTemplate || "",
                include_track_number: settings.trackNumber || false,
                audio_format: settings.audioFormat || "mp3",
                relative_path: pathInfo.relativePath,
            };
        });
        const existenceResults = await CheckFilesExistence(outputDir, settings.downloadPath, settings.audioFormat, existenceChecks);
        const finalFilePaths: string[] = new Array(enrichedTracksWithId.length).fill("");
        const existingSpotifyIDs = new Set<string>();
        const existingFilePaths = new Map<string, string>();
        for (let i = 0; i < existenceResults.length; i++) {
            const result = existenceResults[i];
            if (result.exists) {
                existingSpotifyIDs.add(result.spotify_id);
                existingFilePaths.set(result.spotify_id, result.file_path || "");
                finalFilePaths[i] = result.file_path || "";
            }
        }
        logger.info(`found ${existingSpotifyIDs.size} existing files`);
        const { AddToDownloadQueue } = await import("../../wailsjs/go/main/App");
        for (const { track, pathInfo } of trackPathInfo) {
            const trackID = track.spotify_id || "";
            if (existingSpotifyIDs.has(trackID)) {
                const itemID = await AddToDownloadQueue(trackID, track.name || "", pathInfo.displayArtist, track.album_name || "");
                const filePath = existingFilePaths.get(trackID) || "";
                setTimeout(() => SkipDownloadItem(itemID, filePath), 10);
                setSkippedTracks((prev: Set<string>) => new Set(prev).add(trackID));
                setDownloadedTracks((prev: Set<string>) => new Set(prev).add(trackID));
            }
        }
        const tracksToDownload = enrichedTracksWithId.filter((track) => {
            const trackID = track.spotify_id || "";
            return !existingSpotifyIDs.has(trackID);
        });
        let sessionToken = settings.sessionToken || "";
        if (tracksToDownload.length > 0) {
            try {
                sessionToken = await ensureValidToken();
            }
            catch (err) {
                logger.error(`failed to fetch session token for batch: ${err}`);
                toast.error(err instanceof Error ? err.message : "Failed to fetch session token");
                setDownloadingTrack(null);
                setCurrentDownloadInfo(null);
                setIsDownloading(false);
                setBulkDownloadType(null);
                shouldStopDownloadRef.current = false;
                return;
            }
        }
        let successCount = 0;
        let errorCount = 0;
        let skippedCount = existingSpotifyIDs.size;
        const total = enrichedTracksWithId.length;
        setDownloadProgress(Math.round((skippedCount / total) * 100));
        for (let i = 0; i < tracksToDownload.length; i++) {
            if (shouldStopDownloadRef.current) {
                toast.info(`Download stopped. ${successCount} tracks downloaded, ${tracksToDownload.length - i} remaining.`);
                break;
            }
            const track = tracksToDownload[i];
            const id = track.spotify_id || "";
            const displayArtist = settings.useFirstArtistOnly && track.artists ? getFirstArtist(track.artists) : track.artists;
            setDownloadingTrack(id);
            setCurrentDownloadInfo({ name: track.name, artists: displayArtist || "" });
            try {
                const playlistIndex = enrichedTracksWithId.findIndex((t) => t.spotify_id === id) + 1;
                const pathInfo = buildBatchTrackPathInfo(track, settings, playlistName, isAlbum, playlistIndex);
                let downloadRequest = {
                    track_id: id,
                    session_token: sessionToken,
                    track_name: track.name || "",
                    artist_name: track.artists || "",
                    album_name: track.album_name || "",
                    album_artist: track.album_artist || track.artists || "",
                    release_date: normalizeReleaseDate(track.release_date),
                    cover_url: track.images || "",
                    album_track_number: track.track_number || 0,
                    disc_number: track.disc_number || 0,
                    total_tracks: track.total_tracks || 0,
                    spotify_total_discs: track.total_discs || 0,
                    copyright: track.copyright || "",
                    publisher: track.publisher || "",
                    output_dir: pathInfo.targetOutputDir,
                    audio_format: settings.audioFormat,
                    filename_format: settings.filenameTemplate,
                    track_number: settings.trackNumber,
                    position: pathInfo.trackPosition,
                    use_album_track_number: pathInfo.useAlbumTrackNumber,
                    embed_lyrics: settings.embedLyrics,
                    embed_max_quality_cover: settings.embedMaxQualityCover,
                    use_first_artist_only: settings.useFirstArtistOnly,
                    use_single_genre: settings.useSingleGenre,
                    embed_genre: settings.embedGenre,
                };
                let response = await downloadTrack(downloadRequest);

                if (!response.success && isRetryableError(response.error)) {
                    sessionToken = await ensureValidToken(true);
                    downloadRequest.session_token = sessionToken;
                    response = await downloadTrack(downloadRequest);
                }

                if (response.success) {
                    if (response.already_exists) {
                        skippedCount++;
                        logger.info(`skipped: ${track.name} - ${displayArtist} (already exists)`);
                        setSkippedTracks((prev) => new Set(prev).add(id));
                    }
                    else {
                        successCount++;
                        logger.success(`downloaded: ${track.name} - ${displayArtist}`);
                    }
                    setDownloadedTracks((prev) => new Set(prev).add(id));
                    setFailedTracks((prev) => {
                        const newSet = new Set(prev);
                        newSet.delete(id);
                        return newSet;
                    });
                    if (response.file) {
                        finalFilePaths[playlistIndex - 1] = response.file;
                    }
                }
                else {
                    errorCount++;
                    logger.error(`failed: ${track.name} - ${displayArtist}`);
                    setFailedTracks((prev) => new Set(prev).add(id));
                }
            }
            catch (err) {
                errorCount++;
                logger.error(`error: ${track.name} - ${err}`);
                setFailedTracks((prev) => new Set(prev).add(id));
            }
            const completedCount = skippedCount + successCount + errorCount;
            setDownloadProgress(Math.min(100, Math.round((completedCount / total) * 100)));
        }
        setDownloadingTrack(null);
        setCurrentDownloadInfo(null);
        setIsDownloading(false);
        setBulkDownloadType(null);
        shouldStopDownloadRef.current = false;
        shouldStopDownloadRef.current = false;
        if (settings.createM3u8File && playlistName) {
            try {
                logger.info(`creating m3u8 playlist: ${playlistName}`);
                await CreateM3U8File(playlistName, outputDir, finalFilePaths.filter((p) => p !== ""));
                toast.success("M3U8 playlist created");
            }
            catch (err) {
                logger.error(`failed to create m3u8 playlist: ${err}`);
                toast.error(`Failed to create M3U8 playlist: ${err}`);
            }
        }
        logger.info(`batch complete: ${successCount} downloaded, ${skippedCount} skipped, ${errorCount} failed`);
        if (errorCount === 0 && skippedCount === 0) {
            toast.success(`Downloaded ${successCount} tracks successfully`);
        }
        else if (errorCount === 0 && successCount === 0) {
            toast.info(`${skippedCount} tracks already exist`);
        }
        else if (errorCount === 0) {
            toast.info(`${successCount} downloaded, ${skippedCount} skipped`);
        }
        else {
            const parts = [];
            if (successCount > 0)
                parts.push(`${successCount} downloaded`);
            if (skippedCount > 0)
                parts.push(`${skippedCount} skipped`);
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
