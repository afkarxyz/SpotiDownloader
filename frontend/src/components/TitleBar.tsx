import { X, Minus, Maximize, Settings, Info } from "lucide-react";
import { WindowMinimise, WindowToggleMaximise, Quit } from "../../wailsjs/runtime/runtime";
import { Menubar, MenubarContent, MenubarMenu, MenubarRadioGroup, MenubarRadioItem, MenubarSub, MenubarSubContent, MenubarSubTrigger, MenubarTrigger, MenubarLabel, MenubarSeparator, MenubarItem } from "@/components/ui/menubar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getSettings, updateSettings } from "@/lib/settings";
import { useState, useEffect } from "react";
const TIMEOUT_OPTIONS = [5, 10, 15, 20, 25, 30];
const RETRY_OPTIONS = [1, 2, 3, 4, 5];
export function TitleBar() {
    const [tokenTimeout, setTokenTimeout] = useState(5);
    const [tokenRetry, setTokenRetry] = useState(1);
    const [useSpotFetchAPI, setUseSpotFetchAPI] = useState(false);
    useEffect(() => {
        const settings = getSettings();
        if (settings) {
            setTokenTimeout(settings.tokenTimeout || 5);
            setTokenRetry(settings.tokenRetry || 1);
            setUseSpotFetchAPI(settings.useSpotFetchAPI || false);
        }
    }, []);
    const handleTimeoutChange = (value: string) => {
        const timeout = parseInt(value, 10);
        setTokenTimeout(timeout);
        updateSettings({ tokenTimeout: timeout });
    };
    const handleRetryChange = (value: string) => {
        const retry = parseInt(value, 10);
        setTokenRetry(retry);
        updateSettings({ tokenRetry: retry });
    };
    const handleSpotFetchAPIToggle = () => {
        const newValue = !useSpotFetchAPI;
        setUseSpotFetchAPI(newValue);
        updateSettings({ useSpotFetchAPI: newValue });
    };
    const handleMinimize = () => {
        WindowMinimise();
    };
    const handleMaximize = () => {
        WindowToggleMaximise();
    };
    const handleClose = () => {
        Quit();
    };
    return (<>

      <div className="fixed top-0 left-14 right-0 h-10 z-40 bg-background/80 backdrop-blur-sm" style={{ "--wails-draggable": "drag" } as React.CSSProperties} onDoubleClick={handleMaximize}/>


      <div className="fixed top-1.5 right-2 z-50 flex h-7 gap-0.5 items-center">
        <Menubar className="border-none bg-transparent shadow-none px-0 mr-1" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}>
            <MenubarMenu>
                <MenubarTrigger className="cursor-pointer w-8 h-7 p-0 flex items-center justify-center hover:bg-muted transition-colors rounded data-[state=open]:bg-muted">
                    <Settings className="w-3.5 h-3.5"/>
                </MenubarTrigger>
                <MenubarContent align="end" className="min-w-[200px]">
                    <MenubarLabel>Token Fetcher Settings</MenubarLabel>
                    <MenubarSeparator />
                    <MenubarSub>
                        <MenubarSubTrigger>Timeout</MenubarSubTrigger>
                        <MenubarSubContent>
                            <MenubarRadioGroup value={tokenTimeout.toString()} onValueChange={handleTimeoutChange}>
                                {TIMEOUT_OPTIONS.map((opt) => (<MenubarRadioItem key={opt} value={opt.toString()}>
                                        {opt}s
                                    </MenubarRadioItem>))}
                            </MenubarRadioGroup>
                        </MenubarSubContent>
                    </MenubarSub>
                    <MenubarSub>
                        <MenubarSubTrigger>Retry</MenubarSubTrigger>
                        <MenubarSubContent>
                            <MenubarRadioGroup value={tokenRetry.toString()} onValueChange={handleRetryChange}>
                                {RETRY_OPTIONS.map((opt) => (<MenubarRadioItem key={opt} value={opt.toString()}>
                                        {opt}x
                                    </MenubarRadioItem>))}
                            </MenubarRadioGroup>
                        </MenubarSubContent>
                    </MenubarSub>

                    <MenubarSeparator />
                    <div className="flex items-center gap-1.5 px-2 py-1.5">
                        <MenubarLabel className="p-0">SpotFetch API</MenubarLabel>
                        <TooltipProvider delayDuration={300}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Info className="w-3.5 h-3.5 cursor-help text-muted-foreground"/>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-xs">
                                    <p className="font-semibold mb-2">Spotify Blocked Countries:</p>
                                    <p className="text-xs">Afghanistan, Antarctica, Central African Republic, China, Cuba, Eritrea, Iran, Myanmar, North Korea, Russia, Somalia, South Sudan, Sudan, Syria, Turkmenistan, Yemen</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <MenubarItem onClick={handleSpotFetchAPIToggle} className="justify-between">
                        <span>Use SpotFetch API</span>
                        <span className="ml-4">{useSpotFetchAPI ? "✓" : ""}</span>
                    </MenubarItem>
                </MenubarContent>
            </MenubarMenu>
        </Menubar>
        <button onClick={handleMinimize} className="w-8 h-7 flex items-center justify-center hover:bg-muted transition-colors rounded" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties} aria-label="Minimize">
          <Minus className="w-3.5 h-3.5"/>
        </button>
        <button onClick={handleMaximize} className="w-8 h-7 flex items-center justify-center hover:bg-muted transition-colors rounded" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties} aria-label="Maximize">
          <Maximize className="w-3.5 h-3.5"/>
        </button>
        <button onClick={handleClose} className="w-8 h-7 flex items-center justify-center hover:bg-destructive hover:text-white transition-colors rounded" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties} aria-label="Close">
          <X className="w-3.5 h-3.5"/>
        </button>
      </div>
    </>);
}
