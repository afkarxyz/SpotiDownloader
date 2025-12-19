import { useState } from "react";
import { Button } from "@/components/ui/button";
import { InputWithContext } from "@/components/ui/input-with-context";
import { Label } from "@/components/ui/label";
import { Search, Info, XCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FetchHistory } from "@/components/FetchHistory";
import type { HistoryItem } from "@/components/FetchHistory";
import { getSettings, updateSettings } from "@/lib/settings";

interface SearchBarProps {
  url: string;
  loading: boolean;
  onUrlChange: (url: string) => void;
  onFetch: () => void;
  history: HistoryItem[];
  onHistorySelect: (item: HistoryItem) => void;
  onHistoryRemove: (id: string) => void;
  hasResult: boolean;
}

const TIMEOUT_OPTIONS = [5, 10, 15, 20, 25, 30];
const RETRY_OPTIONS = [1, 2, 3, 4, 5];

export function SearchBar({
  url,
  loading,
  onUrlChange,
  onFetch,
  history,
  onHistorySelect,
  onHistoryRemove,
  hasResult,
}: SearchBarProps) {
  const settings = getSettings();
  const [tokenTimeout, setTokenTimeout] = useState(settings.tokenTimeout || 5);
  const [tokenRetry, setTokenRetry] = useState(settings.tokenRetry || 1);

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

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="spotify-url">Spotify URL</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Supports track, album, playlist, and artist URLs</p>
              <p className="mt-1">Note: Playlist must be public (not private)</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <InputWithContext
              id="spotify-url"
              placeholder="https://open.spotify.com/..."
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onFetch()}
              className="pr-8"
            />
            {url && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                onClick={() => onUrlChange("")}
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button onClick={onFetch} disabled={loading}>
            {loading ? (
              <>
                <Spinner />
                Fetching...
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                Fetch
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Advanced Settings - inline */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="token-timeout" className="text-sm text-muted-foreground whitespace-nowrap">
            Timeout
          </Label>
          <Select value={tokenTimeout.toString()} onValueChange={handleTimeoutChange}>
            <SelectTrigger id="token-timeout" className="w-20" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="min-w-0 w-20">
              {TIMEOUT_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt.toString()}>
                  {opt}s
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="token-retry" className="text-sm text-muted-foreground whitespace-nowrap">
            Retry
          </Label>
          <Select value={tokenRetry.toString()} onValueChange={handleRetryChange}>
            <SelectTrigger id="token-retry" className="w-20" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="min-w-0 w-20">
              {RETRY_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt.toString()}>
                  {opt}x
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Settings for token fetcher (get_token)</p>
            <p className="mt-1">Timeout: Wait time per attempt</p>
            <p>Retry: Number of retry attempts</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {!hasResult && (
        <FetchHistory
          history={history}
          onSelect={onHistorySelect}
          onRemove={onHistoryRemove}
        />
      )}
    </div>
  );
}
