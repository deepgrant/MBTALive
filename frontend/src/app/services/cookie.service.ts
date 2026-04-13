import { Injectable } from '@angular/core';
import { AppSettings } from '../models/app-settings.model';

@Injectable({
  providedIn: 'root'
})
export class CookieService {
  private readonly defaultExpirationDays = 30;
  private readonly settingsCookieName = 'mbta_app_settings';

  getCookie(name: string): string | null {
    const prefix = name + '=';
    for (const raw of document.cookie.split(';')) {
      const cookie = raw.trim();
      if (cookie.startsWith(prefix)) {
        return decodeURIComponent(cookie.substring(prefix.length));
      }
    }
    return null;
  }

  setCookie(name: string, value: string, days: number = this.defaultExpirationDays): void {
    const expiration = new Date();
    expiration.setTime(expiration.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${expiration.toUTCString()};path=/`;
  }

  deleteCookie(name: string): void {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
  }

  getSettingsCookie(): AppSettings | null {
    const value = this.getCookie(this.settingsCookieName);
    if (!value) return null;
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null ? parsed as AppSettings : null;
    } catch {
      return null;
    }
  }

  setSettingsCookie(settings: AppSettings, days: number = this.defaultExpirationDays): void {
    try {
      this.setCookie(this.settingsCookieName, JSON.stringify(settings), days);
    } catch {
      // JSON.stringify failure is non-recoverable; ignore silently
    }
  }

  /** Merge a partial update into the existing settings cookie. */
  patchSettingsCookie(patch: Partial<AppSettings>): void {
    const current = this.getSettingsCookie() ?? {};
    this.setSettingsCookie({ ...current, ...patch });
  }

  deleteSettingsCookie(): void {
    this.deleteCookie(this.settingsCookieName);
  }
}
