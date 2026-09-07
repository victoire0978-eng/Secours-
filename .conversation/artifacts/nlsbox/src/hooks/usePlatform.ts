import { useMemo } from 'react';

export interface PlatformInfo {
  isIOS: boolean;
  isAndroid: boolean;
}

/**
 * Detects iPhone, iPad and iPod, including iPadOS devices that identify as
 * desktop Safari (MacIntel + touch points).
 */
export const usePlatform = (): PlatformInfo =>
  useMemo(() => {
    if (typeof navigator === 'undefined') {
      return { isIOS: false, isAndroid: false };
    }

    const userAgent = navigator.userAgent || '';
    const isIOSUserAgent = /iPad|iPhone|iPod/.test(userAgent);
    const isIPadDesktopMode =
      navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    const isIOS = isIOSUserAgent || isIPadDesktopMode;

    return {
      isIOS,
      isAndroid: !isIOS && /Android/i.test(userAgent),
    };
  }, []);