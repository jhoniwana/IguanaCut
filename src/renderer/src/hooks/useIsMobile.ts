import { useEffect, useState } from 'react';

/**
 * Detecta pantallas angostas (telefonos). En el WebView Android el
 * layout viewport == ancho del dispositivo en dp (meta width=device-width),
 * asi que innerWidth distingue movil (360-430) de tablet/desktop.
 * Mismo criterio que VideoEditor (isMobile, < 640).
 */
export function useIsMobile(breakpoint = 640): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [breakpoint]);

  return isMobile;
}
