import type { Page } from 'playwright';
import { humanDrag } from './human-behavior.js';
import { acquireMouseLock, releaseMouseLock } from './mouse-lock.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const BAXIA_IFRAME_SELECTOR = 'iframe#baxia-dialog-content, iframe[src*="_____tmd_____/punish"]';

/**
 * Solves the Baxia slidein captcha inside an iframe on the page.
 */
export async function solveBaxiaCaptcha(page: Page): Promise<boolean> {
  const iframeLocator = page.locator(BAXIA_IFRAME_SELECTOR).first();
  const isIframeVisible = await iframeLocator.isVisible().catch(() => false);
  const isMainPageSlider = await page.locator('#nc_1_n1z, .btn_slide').first().isVisible().catch(() => false);
  const isPunishPage = page.url().includes('_____tmd_____/punish') || isMainPageSlider;

  if (!isIframeVisible && !isPunishPage) {
    return false;
  }

  while (!acquireMouseLock('captcha-solver')) {
    console.log('[Captcha] Esperando que se libere el bloqueo del mouse antes de resolver...');
    await sleep(200);
  }

  console.log(`[Captcha] Captcha de Baxia detectado (Iframe: ${isIframeVisible}, Página de castigo principal: ${isPunishPage}). Intentando resolver...`);

  try {
    const context = isIframeVisible ? page.frameLocator(BAXIA_IFRAME_SELECTOR) : page;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const slider = context.locator('#nc_1_n1z, .btn_slide').first();
        await slider.waitFor({ state: 'visible', timeout: 5000 });

        const sliderBox = await slider.boundingBox();
        if (!sliderBox) {
          console.warn(`[Captcha] Intento ${attempt}: No se encontró la caja delimitadora del deslizador.`);
          await sleep(1000);
          continue;
        }

        const track = context.locator('#nc_1_n1t, .nc_scale').first();
        const trackBox = await track.boundingBox();
        const dragDistance = trackBox ? (trackBox.width - sliderBox.width) : 260;

        const startX = sliderBox.x + sliderBox.width / 2;
        const startY = sliderBox.y + sliderBox.height / 2;

        console.log(`[Captcha] Intento ${attempt}: Arrastrando deslizador desde x=${startX}, y=${startY} por ${dragDistance}px`);
        
        const endX = startX + dragDistance;
        const endY = startY;
        
        await humanDrag(page, startX, startY, endX, endY);

        await sleep(2000);

        if (isIframeVisible) {
          const isGone = !(await iframeLocator.isVisible().catch(() => false));
          if (isGone) {
            console.log('[Captcha] Captcha de iframe Baxia resuelto con éxito.');
            return true;
          }
        } else {
          const stillPunish = page.url().includes('_____tmd_____/punish');
          const sliderVisible = await page.locator('#nc_1_n1z, .btn_slide').first().isVisible().catch(() => false);
          if (!stillPunish || !sliderVisible) {
            console.log('[Captcha] Captcha de página principal Baxia resuelto con éxito.');
            if (page.url().includes('_____tmd_____/punish')) {
              console.log('[Captcha] Página de castigo resuelta. Navegando de vuelta a la página principal del chat...');
              await page.goto('https://chat.qwen.ai/', { waitUntil: 'domcontentloaded', timeout: 20000 });
            }
            return true;
          }
        }

        const okElement = context.locator('.btn_ok, .nc_ok, div#nc-loading-circle').first();
        const isOkVisible = await okElement.isVisible().catch(() => false);
        if (isOkVisible) {
          console.log('[Captcha] Captcha de Baxia resuelto con éxito (estado OK detectado).');
          await sleep(1500);
          if (!isIframeVisible && page.url().includes('_____tmd_____/punish')) {
            console.log('[Captcha] Castigo resuelto. Navegando de vuelta a la página principal del chat...');
            await page.goto('https://chat.qwen.ai/', { waitUntil: 'domcontentloaded', timeout: 20000 });
          }
          return true;
        }

        console.warn(`[Captcha] Intento ${attempt} no resolvió el captcha. Reintentando...`);
        await sleep(1000);
      } catch (err: any) {
        console.error(`[Captcha] Error en el intento ${attempt}:`, err.message);
        await sleep(1000);
      }
    }

    console.error('[Captcha] Falló la resolución del captcha de Baxia después de 3 intentos.');
    return false;
  } finally {
    releaseMouseLock('captcha-solver');
  }
}

/**
 * Starts a background loop to watch for and solve Baxia captchas on the page.
 * Returns an object with a stop() method to stop the loop.
 */
export function startCaptchaWatcher(page: Page, timeoutMs: number) {
  let finished = false;
  const promise = (async () => {
    const start = Date.now();
    while (!finished && (Date.now() - start < timeoutMs)) {
      try {
        if (page.isClosed()) break;
        const hasIframe = await page.locator(BAXIA_IFRAME_SELECTOR).first().isVisible().catch(() => false);
        const hasMainPageSlider = await page.locator('#nc_1_n1z, .btn_slide').first().isVisible().catch(() => false);
        const isPunishPage = page.url().includes('_____tmd_____/punish') || hasMainPageSlider;
        if (hasIframe || isPunishPage) {
          console.log(`[Captcha] Baxia captcha detected on page (Iframe: ${hasIframe}, Punish Page: ${isPunishPage}). Solving...`);
          await solveBaxiaCaptcha(page);
        }
      } catch {
        // ignore
      }
      await sleep(1000);
    }
  })();

  return {
    stop: () => {
      finished = true;
    },
    promise
  };
}
