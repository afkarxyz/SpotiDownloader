import { useState, useRef } from "react";
import { downloadTrack, fetchSpotifyMetadata } from "@/lib/api";
import { getSettings, parseTemplate, type TemplateData } from "@/lib/settings";
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
interface FileExistenceResult {
    spotify_id: string;
    exists: boolean;
    file_path?: string;
    track_name?: string;
    artist_name?: string;
}
const CheckFilesExistence = (outputDir: string, rootDir: string, audioFormat: string, tracks: CheckFileExistenceRequest[]): Promise<FileExistenceResult[]> => (window as any)["go"]["main"]["App"]["CheckFilesExistence"](outputDir, rootDir, audioFormat, tracks);
const SkipDownloadItem = (itemID: string, filePath: string): Promise<void> => (window as any)["go"]["main"]["App"]["SkipDownloadItem"](itemID, filePath);
const CreateM3U8File = (playlistName: string, outputDir: string, filePaths: string[]): Promise<void> => (window as any)["go"]["main"]["App"]["CreateM3U8File"](playlistName, outputDir, filePaths);
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
    const isUnauthorizedDownloadError = (error?: string) => {
        const msg = (error || "").toLowerCase();
        return msg.includes("unauthorized") || msg.includes("403") || msg.includes("401") || msg.includes("err_unauthorized");
    };
    const downloadWithSpotiDownloader = async (track: TrackMetadata, settings: any, playlistName?: string, position?: number, retryCount: number = 0, isAlbum?: boolean, releaseYear?: string) => {
        const os = settings.operatingSystem;
        let outputDir = settings.downloadPath;
        let useAlbumTrackNumber = false;
        const placeholder = "__SLASH_PLACEHOLDER__";
        let finalReleaseDate = track.release_date;
        let finalTrackNumber = track.track_number;
        if (track.spotify_id) {
            try {
                const trackURL = `https://open.spotify.com/track/${track.spotify_id}`;
                const trackMetadata = await fetchSpotifyMetadata(trackURL, false, 0, 10);
                if ("track" in trackMetadata && trackMetadata.track) {
                    if (trackMetadata.track.release_date) {
                        finalReleaseDate = trackMetadata.track.release_date;
                    }
                    if (trackMetadata.track.track_number > 0) {
                        finalTrackNumber = trackMetadata.track.track_number;
                    }
                }
            }
            catch (err) { }
        }
        const yearValue = releaseYear || finalReleaseDate?.substring(0, 4);
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
            date: track.release_date,
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
                    release_date: finalReleaseDate || "",
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
        const sessionToken = await ensureValidToken();
        const { AddToDownloadQueue } = await import("../../wailsjs/go/main/App");
        const itemID = await AddToDownloadQueue(track.spotify_id || "", track.name || "", displayArtist || "", track.album_name || "");
        const response = await downloadTrack({
            track_id: track.spotify_id || "",
            session_token: sessionToken,
            track_name: track.name,
            artist_name: track.artists,
            album_name: track.album_name,
            album_artist: track.album_artist || track.artists,
            release_date: finalReleaseDate || track.release_date,
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
        });
        if (!response.success && retryCount < 2) {
            const errorMsg = response.error?.toLowerCase() || "";
            if (errorMsg.includes("unauthorized") ||
                errorMsg.includes("403") ||
                errorMsg.includes("err_unauthorized")) {
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
    const handleDownloadTrack = async (track: TrackMetadata, playlistName?: string, _isArtistDiscography?: boolean, isAlbum?: boolean, position?: number) => {
        const id = track.spotify_id;
        if (!id) {
            toast.error("No ID found for this track");
            return;
        }
        const settings = getSettings();
        const displayArtist = settings.useFirstArtistOnly && track.artists ? getFirstArtist(track.artists) : track.artists;
        logger.info(`starting download: ${track.name} - ${displayArtist}`);
        setDownloadingTrack(id);
        try {
            const response = await downloadWithSpotiDownloader(track, settings, playlistName, position, 0, isAlbum);
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
        const settings = getSettings();
        setIsDownloading(true);
        setBulkDownloadType("selected");
        setDownloadProgress(0);
        let outputDir = settings.downloadPath;
        const os = settings.operatingSystem;
        const folderTemplate = settings.folderTemplate || "";
        const useAlbumSubfolder = folderTemplate.includes("{album}") ||
            folderTemplate.includes("{album_artist}") ||
            folderTemplate.includes("{playlist}");
        if (settings.createPlaylistFolder &&
            playlistName &&
            (!isAlbum || !useAlbumSubfolder)) {
            outputDir = joinPath(os, outputDir, sanitizePath(playlistName.replace(/\//g, " "), os));
        }
        const selectedTrackObjects = selectedTracks
            .map((id) => allTracks.find((t) => t.spotify_id === id))
            .filter((t): t is TrackMetadata => t !== undefined);
        logger.info(`checking existing files in parallel...`);
        const existenceChecks = selectedTrackObjects.map((track, index) => {
            const useAlbumTrackNumber = settings.folderTemplate?.includes("{album}") || false;
            const placeholder = "__SLASH_PLACEHOLDER__";
            const yearValue = track.release_date?.substring(0, 4) || "";
            const finalTrackNumber = track.track_number || 0;
            const trackNumberForTemplate = settings.folderTemplate &&
                settings.folderTemplate.trim() !== "" &&
                finalTrackNumber > 0
                ? finalTrackNumber
                : index + 1;
            const displayArtist = settings.useFirstArtistOnly && track.artists ? getFirstArtist(track.artists) : track.artists;
            const displayAlbumArtist = settings.useFirstArtistOnly && track.album_artist ? getFirstArtist(track.album_artist) : (track.album_artist || track.artists || "");
            const templateData: TemplateData = {
                artist: (displayArtist || "").replace(/\//g, placeholder),
                album: (track.album_name || "").replace(/\//g, placeholder),
                album_artist: (displayAlbumArtist || "").replace(/\//g, placeholder),
                title: (track.name || "").replace(/\//g, placeholder),
                track: trackNumberForTemplate,
                disc: track.disc_number,
                year: yearValue,
                date: track.release_date,
                playlist: playlistName?.replace(/\//g, placeholder),
            };
            let relativePath = "";
            if (settings.folderTemplate) {
                const folderPath = parseTemplate(settings.folderTemplate, templateData);
                if (folderPath) {
                    const parts = folderPath.split("/").filter((p: string) => p.trim());
                    const sanitizedParts = parts.map((part: string) => {
                        const sanitizedPart = part.replace(new RegExp(placeholder, "g"), " ");
                        return sanitizePath(sanitizedPart, os);
                    });
                    relativePath = sanitizedParts.join(os === "Windows" ? "\\" : "/");
                }
            }
            return {
                spotify_id: track.spotify_id || "",
                track_name: track.name || "",
                artist_name: displayArtist || "",
                album_name: track.album_name || "",
                album_artist: displayAlbumArtist || "",
                release_date: track.release_date || "",
                track_number: track.track_number || 0,
                disc_number: track.disc_number || 0,
                position: index + 1,
                use_album_track_number: useAlbumTrackNumber,
                filename_format: settings.filenameTemplate || "",
                include_track_number: settings.trackNumber || false,
                audio_format: settings.audioFormat,
                relative_path: relativePath,
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
        for (const track of selectedTrackObjects) {
            const trackID = track.spotify_id || "";
            const displayArtist = settings.useFirstArtistOnly && track.artists ? getFirstArtist(track.artists) : track.artists;
            if (existingSpotifyIDs.has(trackID)) {
                const itemID = await AddToDownloadQueue(track.spotify_id || "", track.name || "", displayArtist || "", track.album_name || "");
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
                const releaseYear = track.release_date?.substring(0, 4);
                const useAlbumTrackNumber = settings.folderTemplate?.includes("{album}") || false;
                const playlistIndex = selectedTracks.indexOf(id) + 1;
                const trackPosition = useAlbumTrackNumber && track.track_number > 0
                    ? track.track_number
                    : playlistIndex;
                logger.debug(`[DEBUG] handleDownloadSelected - Track: ${track.name} | release_date: "${track.release_date}" | releaseYear: "${releaseYear}" | track.track_number: ${track.track_number} | useAlbumTrackNumber: ${useAlbumTrackNumber} | playlistIndex: ${playlistIndex} | trackPosition used: ${trackPosition}`);
                let response = await downloadTrack({
                    track_id: id,
                    session_token: sessionToken,
                    track_name: track.name || "",
                    artist_name: track.artists,
                    album_name: track.album_name,
                    album_artist: track.album_artist || track.artists,
                    release_date: track.release_date,
                    cover_url: track.images,
                    album_track_number: track.track_number,
                    disc_number: track.disc_number,
                    total_tracks: track.total_tracks,
                    spotify_total_discs: track.total_discs,
                    copyright: track.copyright,
                    publisher: track.publisher,
                    output_dir: outputDir,
                    audio_format: settings.audioFormat,
                    filename_format: settings.filenameTemplate,
                    track_number: settings.trackNumber,
                    position: trackPosition,
                    use_album_track_number: useAlbumTrackNumber,
                    embed_lyrics: settings.embedLyrics,
                    embed_max_quality_cover: settings.embedMaxQualityCover,
                    use_first_artist_only: settings.useFirstArtistOnly,
                    use_single_genre: settings.useSingleGenre,
                    embed_genre: settings.embedGenre,
                });
                if (!response.success && isUnauthorizedDownloadError(response.error)) {
                    sessionToken = await ensureValidToken(true);
                    response = await downloadTrack({
                        track_id: id,
                        session_token: sessionToken,
                        track_name: track.name || "",
                        artist_name: track.artists,
                        album_name: track.album_name,
                        album_artist: track.album_artist || track.artists,
                        release_date: track.release_date,
                        cover_url: track.images,
                        album_track_number: track.track_number,
                        disc_number: track.disc_number,
                        total_tracks: track.total_tracks,
                        spotify_total_discs: track.total_discs,
                        copyright: track.copyright,
                        publisher: track.publisher,
                        output_dir: outputDir,
                        audio_format: settings.audioFormat,
                        filename_format: settings.filenameTemplate,
                        track_number: settings.trackNumber,
                        position: trackPosition,
                        use_album_track_number: useAlbumTrackNumber,
                        embed_lyrics: settings.embedLyrics,
                        embed_max_quality_cover: settings.embedMaxQualityCover,
                        use_first_artist_only: settings.useFirstArtistOnly,
                        use_single_genre: settings.useSingleGenre,
                        embed_genre: settings.embedGenre,
                    });
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
        const settings = getSettings();
        setIsDownloading(true);
        setBulkDownloadType("all");
        setDownloadProgress(0);
        let outputDir = settings.downloadPath;
        const os = settings.operatingSystem;
        const folderTemplate = settings.folderTemplate || "";
        const useAlbumSubfolder = folderTemplate.includes("{album}") ||
            folderTemplate.includes("{album_artist}") ||
            folderTemplate.includes("{playlist}");
        if (settings.createPlaylistFolder &&
            playlistName &&
            (!isAlbum || !useAlbumSubfolder)) {
            outputDir = joinPath(os, outputDir, sanitizePath(playlistName.replace(/\//g, " "), os));
        }
        logger.info(`checking existing files in parallel...`);
        const existenceChecks = tracksWithId.map((track, index) => {
            const useAlbumTrackNumber = settings.folderTemplate?.includes("{album}") || false;
            const placeholder = "__SLASH_PLACEHOLDER__";
            const yearValue = track.release_date?.substring(0, 4) || "";
            const finalTrackNumber = track.track_number || 0;
            const trackNumberForTemplate = settings.folderTemplate &&
                settings.folderTemplate.trim() !== "" &&
                finalTrackNumber > 0
                ? finalTrackNumber
                : index + 1;
            const displayArtist = settings.useFirstArtistOnly && track.artists ? getFirstArtist(track.artists) : track.artists;
            const displayAlbumArtist = settings.useFirstArtistOnly && track.album_artist ? getFirstArtist(track.album_artist) : (track.album_artist || track.artists || "");
            const templateData: TemplateData = {
                artist: (displayArtist || "").replace(/\//g, placeholder),
                album: (track.album_name || "").replace(/\//g, placeholder),
                album_artist: (displayAlbumArtist || "").replace(/\//g, placeholder),
                title: (track.name || "").replace(/\//g, placeholder),
                track: trackNumberForTemplate,
                disc: track.disc_number,
                year: yearValue,
                date: track.release_date,
                playlist: playlistName?.replace(/\//g, placeholder),
            };
            let relativePath = "";
            if (settings.folderTemplate) {
                const folderPath = parseTemplate(settings.folderTemplate, templateData);
                if (folderPath) {
                    const parts = folderPath.split("/").filter((p: string) => p.trim());
                    const sanitizedParts = parts.map((part: string) => {
                        const sanitizedPart = part.replace(new RegExp(placeholder, "g"), " ");
                        return sanitizePath(sanitizedPart, os);
                    });
                    relativePath = sanitizedParts.join(os === "Windows" ? "\\" : "/");
                }
            }
            return {
                spotify_id: track.spotify_id || "",
                track_name: track.name || "",
                artist_name: displayArtist || "",
                album_name: track.album_name || "",
                album_artist: displayAlbumArtist || "",
                release_date: track.release_date || "",
                track_number: track.track_number || 0,
                disc_number: track.disc_number || 0,
                position: index + 1,
                use_album_track_number: useAlbumTrackNumber,
                filename_format: settings.filenameTemplate || "",
                include_track_number: settings.trackNumber || false,
                audio_format: settings.audioFormat || "mp3",
                relative_path: relativePath,
            };
        });
        const existenceResults = await CheckFilesExistence(outputDir, settings.downloadPath, settings.audioFormat, existenceChecks);
        const finalFilePaths: string[] = new Array(tracksWithId.length).fill("");
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
        for (const track of tracksWithId) {
            const trackID = track.spotify_id || "";
            const displayArtist = settings.useFirstArtistOnly && track.artists ? getFirstArtist(track.artists) : track.artists;
            if (existingSpotifyIDs.has(trackID)) {
                const itemID = await AddToDownloadQueue(trackID, track.name || "", displayArtist || "", track.album_name || "");
                const filePath = existingFilePaths.get(trackID) || "";
                setTimeout(() => SkipDownloadItem(itemID, filePath), 10);
                setSkippedTracks((prev: Set<string>) => new Set(prev).add(trackID));
                setDownloadedTracks((prev: Set<string>) => new Set(prev).add(trackID));
            }
        }
        const tracksToDownload = tracksWithId.filter((track) => {
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
        const total = tracksWithId.length;
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
                const playlistIndex = tracksWithId.findIndex((t) => t.spotify_id === id) + 1;
                let response = await downloadTrack({
                    track_id: id,
                    session_token: sessionToken,
                    track_name: track.name || "",
                    artist_name: track.artists || "",
                    album_name: track.album_name || "",
                    album_artist: track.album_artist || track.artists || "",
                    release_date: track.release_date || "",
                    cover_url: track.images || "",
                    album_track_number: track.track_number || 0,
                    disc_number: track.disc_number || 0,
                    total_tracks: track.total_tracks || 0,
                    spotify_total_discs: track.total_discs || 0,
                    copyright: track.copyright || "",
                    publisher: track.publisher || "",
                    output_dir: outputDir,
                    audio_format: settings.audioFormat,
                    filename_format: settings.filenameTemplate,
                    track_number: settings.trackNumber,
                    position: playlistIndex,
                    use_album_track_number: isAlbum,
                    embed_lyrics: settings.embedLyrics,
                    embed_max_quality_cover: settings.embedMaxQualityCover,
                    use_first_artist_only: settings.useFirstArtistOnly,
                    use_single_genre: settings.useSingleGenre,
                    embed_genre: settings.embedGenre,
                });
                if (!response.success && isUnauthorizedDownloadError(response.error)) {
                    sessionToken = await ensureValidToken(true);
                    response = await downloadTrack({
                        track_id: id,
                        session_token: sessionToken,
                        track_name: track.name || "",
                        artist_name: track.artists || "",
                        album_name: track.album_name || "",
                        album_artist: track.album_artist || track.artists || "",
                        release_date: track.release_date || "",
                        cover_url: track.images || "",
                        album_track_number: track.track_number || 0,
                        disc_number: track.disc_number || 0,
                        total_tracks: track.total_tracks || 0,
                        spotify_total_discs: track.total_discs || 0,
                        copyright: track.copyright || "",
                        publisher: track.publisher || "",
                        output_dir: outputDir,
                        audio_format: settings.audioFormat,
                        filename_format: settings.filenameTemplate,
                        track_number: settings.trackNumber,
                        position: playlistIndex,
                        use_album_track_number: isAlbum,
                        embed_lyrics: settings.embedLyrics,
                        embed_max_quality_cover: settings.embedMaxQualityCover,
                        use_first_artist_only: settings.useFirstArtistOnly,
                        use_single_genre: settings.useSingleGenre,
                        embed_genre: settings.embedGenre,
                    });
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
