const artistIDPattern = /^[A-Za-z0-9]{22}$/;

export function extractArtistID(input: string): string {
    const value = input.trim();
    if (!value) {
        return "";
    }

    if (artistIDPattern.test(value)) {
        return value;
    }

    if (value.startsWith("spotify:artist:")) {
        const parts = value.split(":");
        const candidate = parts[parts.length - 1] || "";
        return artistIDPattern.test(candidate) ? candidate : "";
    }

    let normalized = value;
    if (normalized.startsWith("open.spotify.com/")) {
        normalized = `https://${normalized}`;
    }

    try {
        const parsed = new URL(normalized);
        const pathParts = parsed.pathname.split("/").filter(Boolean);
        const artistIndex = pathParts.indexOf("artist");
        if (artistIndex !== -1 && pathParts[artistIndex + 1]) {
            const candidate = pathParts[artistIndex + 1];
            return artistIDPattern.test(candidate) ? candidate : "";
        }
    }
    catch {
        return "";
    }

    return "";
}
