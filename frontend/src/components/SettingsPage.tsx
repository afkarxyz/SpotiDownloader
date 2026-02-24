import { useState, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { InputWithContext } from "@/components/ui/input-with-context";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FolderOpen, Save, RotateCcw, Info, Settings, FolderCog } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { getSettings, getSettingsWithDefaults, saveSettings, resetToDefaultSettings, applyThemeMode, applyFont, FONT_OPTIONS, FOLDER_PRESETS, FILENAME_PRESETS, TEMPLATE_VARIABLES, type Settings as SettingsType, type FontFamily, type FolderPreset, type FilenamePreset } from "@/lib/settings";
import { themes, applyTheme } from "@/lib/themes";
import { SelectFolder } from "../../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
const FlacIcon = () => (<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" className="inline-block mr-2 fill-muted-foreground">
  <path d="M.821 7.73L0 7.728l.295-1.4l.526.001V6.2q.001-.58.181-.992q.182-.421.511-.686q.341-.274.809-.4a4 4 0 0 1 1.05-.128l.397 1.56l-.481-.01c-.306-.007-.535.065-.683.203c-.144.133-.213.345-.213.595l.906-.017v1.4h-.906v3.99l-1.57.18v-4.17zM5.79 4.21l.005 7.52l-1.59.204v-7.54l1.59-.182z"/>
  <path fillRule="evenodd" d="M6.22 10.1c0-1.14.742-1.93 1.84-1.92c.551.003.974.161 1.26.469l.002-.299a.77.77 0 0 0-.25-.602c-.158-.149-.41-.224-.773-.224c-.274 0-.552.045-.77.106a2.7 2.7 0 0 0-.534.182l.238-1.46q.152-.064.53-.142c.252-.053.57-.079.963-.079c.58 0 1.14.174 1.51.515c.44.403.54.688.542 1.48c.005 1.21-.103 3.68-.103 3.68l-1.38.135l.003-.48c-.292.356-.715.561-1.24.565c-1.04.007-1.84-.782-1.84-1.92zm3.05-.111c0-.427-.339-.716-.771-.716s-.771.292-.771.716c0 .425.317.716.771.716s.771-.289.771-.716" clipRule="evenodd"/>
  <path d="M11.3 9.04c0-1.75 1.25-2.95 2.83-2.95c.726 0 1.38.252 1.88.694l-.835 1.22a1.27 1.27 0 0 0-.924-.382c-.737 0-1.36.578-1.36 1.42c0 .77.588 1.43 1.36 1.43c.391 0 .721-.148.954-.402l.85 1.23c-.49.448-1.15.704-1.92.704c-1.66 0-2.83-1.2-2.83-2.95z"/>
</svg>);
const Mp3Icon = () => (<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" className="inline-block mr-2 fill-muted-foreground">
  <path d="M3.41 13a3.25 3.25 0 0 1-2.16-.953c-.718-.721-1.13-1.73-1.23-2.73a6.24 6.24 0 0 1 .94-3.88c.841-1.31 2.24-2.22 3.68-2.4c1.28-.158 2.45.461 3.07 1.62c.166.31.357.83.336.912c-.021.084-.074.047-.106-.073c-.264-1-1.23-1.81-2.21-2.04c-1.55-.363-2.92.606-3.84 1.75c-.604.753-.879 1.65-1.04 2.72c-.221 1.48.312 3.61 1.99 4.03c1.16.292 2.19-.28 2.88-1.2c.442-.588.632-1.43.889-2.16l.311-.905c.036-.124-.01-.224-.14-.25s-.266.086-.332.25L5.647 10h-1.31l.776-2.38s.043-.178-.078-.206c-.121-.029-.253.035-.332.255L3.85 10h-1.3l1.13-3.27l1.27-.001l-.084.27s.348-.344.895-.344s.687.344.687.344s.162-.102.274-.152c.442-.2.889-.276 1.24-.113c.126.058.275.23.316.363c.046.15.04.387-.017.594c-.108.396-.829 2.29-1.03 2.78c-.69 1.71-2 2.62-3.84 2.52zm4-1.33l1.74-4.92h1.38l-.079.257c.211-.192.545-.339.823-.34q.803-.004.948.6c.157.645-.319 1.83-.944 2.35c-.36.299-.72.457-1.14.457s-.633-.293-.633-.293l-.68 1.89l-1.41.001zm2.7-2.26c.191-.1.43-.546.648-1.21c.107-.327.154-.568.146-.753c-.005-.116-.014-.157-.04-.18c-.123-.112-.38.102-.579.482a5.6 5.6 0 0 0-.438 1.2c-.036.189-.029.378.018.442c.038.053.156.06.245.013zm2.67.63a1.4 1.4 0 0 1-.557-.201a1 1 0 0 1-.296-.257c-.072-.087-.124-.182-.124-.182l.695-.635l.249.134s-.02.415 0 .476c.053.158.24.224.468.166c.211-.054.341-.144.514-.361c.222-.278.343-.594.329-.861c-.008-.165-.053-.252-.16-.317c-.067-.04-.107-.046-.377-.046l-.312-.003l.162-.542h.216a.9.9 0 0 0 .543-.143c.268-.157.518-.558.566-.905c.017-.123.015-.15-.012-.223q-.063-.169-.277-.168a.7.7 0 0 0-.512.242a.6.6 0 0 0-.148.357l-.01.108l-.334.112l-.323-.637s.13-.165.419-.345c.43-.268 1.05-.409 1.58-.359c.578.055.893.303.921.727c.056.87-.662 1.23-1.11 1.41c.287.272.593.591.381 1.19c-.125.355-.413.702-.767.925a3 3 0 0 1-.675.288a2.7 2.7 0 0 1-1.05.046z"/>
</svg>);
interface SettingsPageProps {
    onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
    onResetRequest?: (resetFn: () => void) => void;
}
export function SettingsPage({ onUnsavedChangesChange, onResetRequest }: SettingsPageProps) {
    const [savedSettings, setSavedSettings] = useState<SettingsType>(getSettings());
    const [tempSettings, setTempSettings] = useState<SettingsType>(savedSettings);
    const [isDark, setIsDark] = useState(document.documentElement.classList.contains('dark'));
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const hasUnsavedChanges = JSON.stringify(savedSettings) !== JSON.stringify(tempSettings);
    const resetToSaved = useCallback(() => {
        const freshSavedSettings = getSettings();
        flushSync(() => {
            setTempSettings(freshSavedSettings);
            setIsDark(document.documentElement.classList.contains('dark'));
        });
    }, []);
    useEffect(() => {
        if (onResetRequest) {
            onResetRequest(resetToSaved);
        }
    }, [onResetRequest, resetToSaved]);
    useEffect(() => {
        onUnsavedChangesChange?.(hasUnsavedChanges);
    }, [hasUnsavedChanges, onUnsavedChangesChange]);
    useEffect(() => {
        applyThemeMode(savedSettings.themeMode);
        applyTheme(savedSettings.theme);
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const handleChange = () => {
            if (savedSettings.themeMode === "auto") {
                applyThemeMode("auto");
                applyTheme(savedSettings.theme);
            }
        };
        mediaQuery.addEventListener("change", handleChange);
        return () => mediaQuery.removeEventListener("change", handleChange);
    }, [savedSettings.themeMode, savedSettings.theme]);
    useEffect(() => {
        applyThemeMode(tempSettings.themeMode);
        applyTheme(tempSettings.theme);
        applyFont(tempSettings.fontFamily);
        setTimeout(() => {
            setIsDark(document.documentElement.classList.contains('dark'));
        }, 0);
    }, [tempSettings.themeMode, tempSettings.theme, tempSettings.fontFamily]);
    useEffect(() => {
        const loadDefaults = async () => {
            if (!savedSettings.downloadPath) {
                const settingsWithDefaults = await getSettingsWithDefaults();
                setSavedSettings(settingsWithDefaults);
                setTempSettings(settingsWithDefaults);
                await saveSettings(settingsWithDefaults);
            }
        };
        loadDefaults();
    }, []);
    const handleSave = async () => {
        await saveSettings(tempSettings);
        setSavedSettings(tempSettings);
        toast.success("Settings saved");
        onUnsavedChangesChange?.(false);
    };
    const handleReset = async () => {
        const defaultSettings = await resetToDefaultSettings();
        setTempSettings(defaultSettings);
        setSavedSettings(defaultSettings);
        applyThemeMode(defaultSettings.themeMode);
        applyTheme(defaultSettings.theme);
        applyFont(defaultSettings.fontFamily);
        setShowResetConfirm(false);
        toast.success("Settings reset to default");
    };
    const handleBrowseFolder = async () => {
        try {
            const selectedPath = await SelectFolder(tempSettings.downloadPath || "");
            if (selectedPath && selectedPath.trim() !== "") {
                setTempSettings((prev) => ({ ...prev, downloadPath: selectedPath }));
            }
        }
        catch (error) {
            console.error("Error selecting folder:", error);
            toast.error(`Error selecting folder: ${error}`);
        }
    };
    const [activeTab, setActiveTab] = useState<"general" | "files">("general");
    return (<div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between shrink-0">
          <h1 className="text-2xl font-bold">Settings</h1>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowResetConfirm(true)} className="gap-1.5">
              <RotateCcw className="h-4 w-4"/>
              Reset to Default
            </Button>
            <Button onClick={handleSave} className="gap-1.5">
              <Save className="h-4 w-4"/>
              Save Changes
            </Button>
          </div>
      </div>

      <div className="flex gap-2 border-b shrink-0">
        <Button variant={activeTab === "general" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("general")} className="rounded-b-none gap-2">
          <Settings className="h-4 w-4"/>
          General
        </Button>
        <Button variant={activeTab === "files" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("files")} className="rounded-b-none gap-2">
          <FolderCog className="h-4 w-4"/>
          File Management
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto pt-4">
        {activeTab === "general" && (<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="download-path">Download Path</Label>
                    <div className="flex gap-2">
                      <InputWithContext id="download-path" value={tempSettings.downloadPath} onChange={(e) => setTempSettings((prev) => ({ ...prev, downloadPath: e.target.value }))} placeholder="C:\Users\YourUsername\Music"/>
                      <Button type="button" onClick={handleBrowseFolder} className="gap-1.5">
                        <FolderOpen className="h-4 w-4"/>
                        Browse
                      </Button>
                    </div>
                  </div>

                 <div className="space-y-2">
                  <Label htmlFor="theme-mode">Mode</Label>
                  <Select value={tempSettings.themeMode} onValueChange={(value: "auto" | "light" | "dark") => setTempSettings((prev) => ({ ...prev, themeMode: value }))}>
                    <SelectTrigger id="theme-mode">
                      <SelectValue placeholder="Select theme mode"/>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="theme">Accent</Label>
                  <Select value={tempSettings.theme} onValueChange={(value) => setTempSettings((prev) => ({ ...prev, theme: value }))}>
                    <SelectTrigger id="theme">
                      <SelectValue placeholder="Select a theme"/>
                    </SelectTrigger>
                    <SelectContent>
                      {themes.map((theme) => (<SelectItem key={theme.name} value={theme.name}>
                        <span className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full border border-border" style={{
                    backgroundColor: isDark ? theme.cssVars.dark.primary : theme.cssVars.light.primary
                }}/>
                          {theme.label}
                        </span>
                      </SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="font">Font</Label>
                  <Select value={tempSettings.fontFamily} onValueChange={(value: FontFamily) => setTempSettings((prev) => ({ ...prev, fontFamily: value }))}>
                    <SelectTrigger id="font">
                      <SelectValue placeholder="Select a font"/>
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_OPTIONS.map((font) => (<SelectItem key={font.value} value={font.value}>
                        <span style={{ fontFamily: font.fontFamily }}>{font.label}</span>
                      </SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Switch id="sfx-enabled" checked={tempSettings.sfxEnabled} onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, sfxEnabled: checked }))}/>
                  <Label htmlFor="sfx-enabled" className="cursor-pointer text-sm font-normal">Sound Effects</Label>
                </div>
              </div>

              <div className="space-y-4">
                   <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="audioFormat" className="text-sm">Format</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help"/>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="text-xs">FLAC is still in beta and may occasionally fail.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <Select value={tempSettings.audioFormat} onValueChange={(value: "mp3" | "flac") => setTempSettings((prev) => ({ ...prev, audioFormat: value }))}>
                        <SelectTrigger id="audioFormat" className="h-9 w-40">
                          <SelectValue placeholder="Select audio format"/>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mp3">
                            <span className="flex items-center"><Mp3Icon />MP3</span>
                          </SelectItem>
                          <SelectItem value="flac">
                            <span className="flex items-center"><FlacIcon />FLAC</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="border-t pt-4"/>

                   <div className="space-y-4">
                     <div className="flex items-center gap-3">
                        <Switch id="embed-lyrics" checked={tempSettings.embedLyrics} onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, embedLyrics: checked }))}/>
                        <Label htmlFor="embed-lyrics" className="cursor-pointer text-sm font-normal">Embed Lyrics</Label>
                      </div>
                      <div className="flex items-center gap-3">
                        <Switch id="embed-max-quality-cover" checked={tempSettings.embedMaxQualityCover} onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, embedMaxQualityCover: checked }))}/>
                        <Label htmlFor="embed-max-quality-cover" className="cursor-pointer text-sm font-normal">Embed Max Quality Cover</Label>
                      </div>
                      <div className="flex items-center gap-3">
                        <Switch id="use-single-genre" checked={tempSettings.useSingleGenre} onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, useSingleGenre: checked }))}/>
                        <Label htmlFor="use-single-genre" className="cursor-pointer text-sm font-normal">Use Single Genre</Label>
                      </div>
                   </div>
              </div>
          </div>)}

        {activeTab === "files" && (<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-4">
                  <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm">Folder Structure</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help"/>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p className="text-xs whitespace-nowrap">Variables: {TEMPLATE_VARIABLES.map(v => v.key).join(", ")}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="flex gap-2">
                        <Select value={tempSettings.folderPreset} onValueChange={(value: FolderPreset) => {
                const preset = FOLDER_PRESETS[value];
                setTempSettings(prev => ({
                    ...prev,
                    folderPreset: value,
                    folderTemplate: value === "custom" ? (prev.folderTemplate || preset.template) : preset.template
                }));
            }}>
                          <SelectTrigger className="h-9 w-fit">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(FOLDER_PRESETS).map(([key, { label }]) => (<SelectItem key={key} value={key}>{label}</SelectItem>))}
                          </SelectContent>
                        </Select>
                        {tempSettings.folderPreset === "custom" && (<InputWithContext value={tempSettings.folderTemplate} onChange={(e) => setTempSettings(prev => ({ ...prev, folderTemplate: e.target.value }))} placeholder="{artist}/{album}" className="h-9 text-sm flex-1"/>)}
                      </div>
                      {tempSettings.folderTemplate && (<p className="text-xs text-muted-foreground">
                        Preview: <span className="font-mono">{tempSettings.folderTemplate.replace(/\{artist\}/g, "Kendrick Lamar, SZA").replace(/\{album\}/g, "Black Panther").replace(/\{album_artist\}/g, "Kendrick Lamar").replace(/\{year\}/g, "2018")}/</span>
                      </p>)}
                    </div>

                    <div className="flex items-center gap-3">
                      <Switch id="create-playlist-folder" checked={tempSettings.createPlaylistFolder} onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, createPlaylistFolder: checked }))}/>
                       <Label htmlFor="create-playlist-folder" className="text-sm cursor-pointer font-normal">Playlist Folder</Label>
                    </div>

                    <div className="flex items-center gap-3">
                      <Switch id="create-m3u8-file" checked={tempSettings.createM3u8File} onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, createM3u8File: checked }))}/>
                       <Label htmlFor="create-m3u8-file" className="text-sm cursor-pointer font-normal">Create M3U8 Playlist File</Label>
                    </div>

                    <div className="flex items-center gap-3">
                      <Switch id="use-first-artist-only" checked={tempSettings.useFirstArtistOnly} onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, useFirstArtistOnly: checked }))}/>
                       <Label htmlFor="use-first-artist-only" className="text-sm cursor-pointer font-normal">Use First Artist Only</Label>
                    </div>


              </div>

              <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">Filename Format</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help"/>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs whitespace-nowrap">Variables: {TEMPLATE_VARIABLES.map(v => v.key).join(", ")}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex gap-2">
                    <Select value={tempSettings.filenamePreset} onValueChange={(value: FilenamePreset) => {
                const preset = FILENAME_PRESETS[value];
                setTempSettings(prev => ({
                    ...prev,
                    filenamePreset: value,
                    filenameTemplate: value === "custom" ? (prev.filenameTemplate || preset.template) : preset.template
                }));
            }}>
                      <SelectTrigger className="h-9 w-fit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(FILENAME_PRESETS).map(([key, { label }]) => (<SelectItem key={key} value={key}>{label}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    {tempSettings.filenamePreset === "custom" && (<InputWithContext value={tempSettings.filenameTemplate} onChange={(e) => setTempSettings(prev => ({ ...prev, filenameTemplate: e.target.value }))} placeholder="{track}. {title}" className="h-9 text-sm flex-1"/>)}
                  </div>
                  {tempSettings.filenameTemplate && (<p className="text-xs text-muted-foreground">
                    Preview: <span className="font-mono">{tempSettings.filenameTemplate.replace(/\{artist\}/g, "Kendrick Lamar, SZA").replace(/\{album_artist\}/g, "Kendrick Lamar").replace(/\{title\}/g, "All The Stars").replace(/\{track\}/g, "01").replace(/\{disc\}/g, "1").replace(/\{year\}/g, "2018")}.{tempSettings.audioFormat}</span>
                  </p>)}
              </div>
          </div>)}


      </div>





    <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
      <DialogContent className="max-w-md [&>button]:hidden">
        <DialogHeader>
          <DialogTitle>Reset to Default?</DialogTitle>
          <DialogDescription>
            This will reset all settings to their default values. Your custom configurations will be lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowResetConfirm(false)}>Cancel</Button>
          <Button onClick={handleReset}>Reset</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>);
}
