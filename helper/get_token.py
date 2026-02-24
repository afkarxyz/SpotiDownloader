import asyncio
import nodriver as uc
import sys
import time
import os

if getattr(sys, 'frozen', False):
    if hasattr(sys, '_MEIPASS'):
        base_path = sys._MEIPASS
    else:
        base_path = os.path.dirname(sys.executable)
else:
    base_path = os.path.dirname(os.path.abspath(__file__))

EXT_PATH = os.path.join(base_path, "uBOLite")

async def get_session_token_async(max_wait=5):
    browser = None
    try:
        browser = await uc.start(browser_args=[
            "--disable-features=DisableDisableExtensionsExceptCommandLineSwitch,DisableLoadExtensionCommandLineSwitch",
            f"--load-extension={EXT_PATH}",
            f"--disable-extensions-except={EXT_PATH}"
        ])
        
        page = await browser.get("https://spotidownloader.com/")
        await asyncio.sleep(2)
        
        await page.evaluate("""
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
        
        try:
            inp = await page.select('.searchInput')
            if inp:
                await inp.send_keys("https://open.spotify.com/track/53iuhJlwXhSER5J2IYYv1W")
                await asyncio.sleep(1)
            
            btn = await page.select('button[type="submit"]')
            if btn:
                attempts = max(1, int(max_wait / 2))
                for _ in range(attempts):
                    await btn.click()
                    for _ in range(4):
                        await asyncio.sleep(0.5)
                        token = await page.evaluate("window.sessionToken")
                        if token: return token
        except: pass

        return None
    except: return None
    finally:
        if browser:
            try: browser.stop()
            except: pass

def get_token(max_retries=1, timeout=5):
    for _ in range(max_retries):
        try:
            token = uc.loop().run_until_complete(get_session_token_async(max_wait=timeout))
            if token: return token
        except: pass
        time.sleep(1)
    return None

if __name__ == "__main__":
    original_stdout = sys.stdout
    
    sys.stdout = open(os.devnull, 'w')
    sys.stderr = open(os.devnull, 'w')
    
    try:
        timeout, retry = 5, 1
        args = sys.argv[1:]
        for i, arg in enumerate(args):
            if arg == "--timeout" and i+1 < len(args):
                try: timeout = int(args[i+1])
                except: pass
            elif arg == "--retry" and i+1 < len(args):
                try: retry = int(args[i+1])
                except: pass
                
        token = get_token(max_retries=retry, timeout=timeout)
        if token:
            print(token, file=original_stdout)
    except:
        pass