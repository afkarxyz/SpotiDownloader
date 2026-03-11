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

async def close_browser_safely(browser):
    if not browser:
        return

    try:
        tabs = list(getattr(browser, "tabs", []) or [])
        for tab in tabs:
            try:
                await tab.close()
            except:
                pass
    except:
        pass

    process = getattr(browser, "_process", None)

    try:
        browser.stop()
    except:
        pass

    if process:
        try:
            for _ in range(20):
                if process.poll() is not None:
                    return
                await asyncio.sleep(0.1)
            process.kill()
        except:
            pass

async def get_session_token_async(max_wait=5, browser_path=None):
    browser = None
    try:
        start_kwargs = {
            "browser_args": [
            "--disable-features=DisableDisableExtensionsExceptCommandLineSwitch,DisableLoadExtensionCommandLineSwitch",
            f"--load-extension={EXT_PATH}",
            f"--disable-extensions-except={EXT_PATH}"
            ]
        }
        if browser_path:
            start_kwargs["browser_executable_path"] = browser_path

        browser = await uc.start(**start_kwargs)
        
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
        await close_browser_safely(browser)

def get_token(max_retries=1, timeout=5, browser_path=None):
    for _ in range(max_retries):
        try:
            token = uc.loop().run_until_complete(
                get_session_token_async(max_wait=timeout, browser_path=browser_path)
            )
            if token: return token
        except: pass
        time.sleep(1)
    return None

if __name__ == "__main__":
    original_stdout = sys.stdout
    
    sys.stdout = open(os.devnull, 'w')
    sys.stderr = open(os.devnull, 'w')
    
    try:
        timeout, retry, browser_path = 5, 1, None
        args = sys.argv[1:]
        for i, arg in enumerate(args):
            if arg == "--timeout" and i+1 < len(args):
                try: timeout = int(args[i+1])
                except: pass
            elif arg == "--retry" and i+1 < len(args):
                try: retry = int(args[i+1])
                except: pass
            elif arg == "--browser-path" and i+1 < len(args):
                browser_path = args[i+1]
                
        token = get_token(max_retries=retry, timeout=timeout, browser_path=browser_path)
        if token:
            print(token, file=original_stdout)
    except:
        pass
