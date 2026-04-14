import lrclibIcon from "@/assets/icons/lrclib.png";
import musicBrainzDarkIcon from "@/assets/icons/musicbrainz_d.png";
import musicBrainzLightIcon from "@/assets/icons/musicbrainz_l.png";
import spotiDownloaderIcon from "@/assets/icons/spoti.png";
type IconProps = {
    className?: string;
};
function StaticImageIcon({ alt, className = "w-8 h-8", src }: IconProps & {
    alt: string;
    src: string;
}) {
    return (<span role="img" aria-label={alt} className={`inline-flex shrink-0 ${className}`}>
            <img src={src} alt="" aria-hidden="true" className="h-full w-full object-contain"/>
        </span>);
}
function ThemedImageIcon({ alt, className = "w-8 h-8", darkSrc, lightSrc, }: IconProps & {
    alt: string;
    darkSrc: string;
    lightSrc: string;
}) {
    return (<span role="img" aria-label={alt} className={`relative inline-flex shrink-0 ${className}`}>
            <img src={lightSrc} alt="" aria-hidden="true" className="h-full w-full object-contain dark:hidden"/>
            <img src={darkSrc} alt="" aria-hidden="true" className="hidden h-full w-full object-contain dark:block"/>
        </span>);
}
export function LrclibIcon({ className = "w-8 h-8" }: IconProps) {
    return <StaticImageIcon alt="LRCLIB" className={className} src={lrclibIcon}/>;
}
export function MusicBrainzIcon({ className = "w-8 h-8" }: IconProps) {
    return <ThemedImageIcon alt="MusicBrainz" className={className} lightSrc={musicBrainzLightIcon} darkSrc={musicBrainzDarkIcon}/>;
}
export function SpotiDownloaderIcon({ className = "w-8 h-8" }: IconProps) {
    return <StaticImageIcon alt="SpotiDownloader" className={className} src={spotiDownloaderIcon}/>;
}
