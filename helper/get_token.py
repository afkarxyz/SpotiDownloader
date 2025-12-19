from DrissionPage import ChromiumPage
import time
import sys

def get_session_token_sync(max_wait=5):
    page = None
    try:
        page = ChromiumPage()
        page.get("https://spotidownloader.com/")
        time.sleep(0.5)
        
        spotify_url = "https://open.spotify.com/track/53iuhJlwXhSER5J2IYYv1W"
        input_element = page.ele('css:.searchInput')
        if input_element:
            input_element.input(spotify_url)
            time.sleep(0.5)
        
        download_button = page.ele('css:button[type="submit"]')
        if download_button:
            download_button.click()
            time.sleep(0.5)
        
        page.run_js("""
            window.originalFetch = window.fetch;
            window.sessionToken = null;
            window.fetch = function(...args) {
                return window.originalFetch(...args).then(async response => {
                    if (response.url.includes('api.spotidownloader.com/session')) {
                        try {
                            const data = await response.clone().json();
                            if (data?.token) window.sessionToken = data.token;
                        } catch {}
                    }
                    return response;
                });
            };        
        """)
        
        for _ in range(max_wait * 2):
            token = page.run_js("return window.sessionToken")
            if token:
                return token
            time.sleep(0.5)
        
        return None
    except:
        return None
    finally:
        if page:
            try:
                page.quit()
            except:
                pass

async def main():
    return get_session_token_sync()

def get_token(max_retries=1, timeout=5):
    for attempt in range(max_retries):
        token = get_session_token_sync(max_wait=timeout)
        if token:
            return token
        time.sleep(0.5)
    return None

if __name__ == "__main__":
    timeout = 5
    retry = 1
    
    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == "--timeout" and i + 1 < len(args):
            try:
                timeout = int(args[i + 1])
            except ValueError:
                pass
        elif arg == "--retry" and i + 1 < len(args):
            try:
                retry = int(args[i + 1])
            except ValueError:
                pass
    
    token = get_token(max_retries=retry, timeout=timeout)
    if token:
        print(token)