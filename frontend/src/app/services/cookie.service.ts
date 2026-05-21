import { Injectable } from '@angular/core';
import { AppSettings } from '../models/app-settings.model';

@Injectable({
  providedIn: 'root'
})
export class CookieService {
  private readonly defaultExpirationDays = 30;
  private readonly settingsCookieName = 'mbta_app_settings';

  private getCookie(name: string): string | null {
    const nameEQ = name + '=';
    for (let cookie of document.cookie.split(';')) {
      cookie = cookie.trim();
      if (cookie.indexOf(nameEQ) === 0) {
        return decodeURIComponent(cookie.substring(nameEQ.length));
      }
    }
    return null;
  }

  private setCookie(name: string, value: string, days: number = this.defaultExpirationDays): void {
    const expirationDate = new Date();
    expirationDate.setTime(expirationDate.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${expirationDate.toUTCString()};path=/`;
  }

  private deleteCookie(name: string): void {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
  }

  /**
   * Get app settings from cookie
   * @returns AppSettings object or null if not found or invalid
   */
  getSettingsCookie(): AppSettings | null {
    const cookieValue = this.getCookie(this.settingsCookieName);
    if (!cookieValue) {
      return null;
    }

    try {
      const settings = JSON.parse(cookieValue) as AppSettings;
      // Validate structure
      if (typeof settings === 'object' && settings !== null) {
        return settings;
      }
      return null;
    } catch (error) {
      console.error('CookieService: Error parsing settings cookie:', error);
      return null;
    }
  }

  /**
   * Set app settings cookie
   * @param settings AppSettings object to save
   * @param days Number of days until expiration (defaults to 30)
   */
  setSettingsCookie(settings: AppSettings, days: number = this.defaultExpirationDays): void {
    try {
      const jsonString = JSON.stringify(settings);
      this.setCookie(this.settingsCookieName, jsonString, days);
    } catch (error) {
      console.error('CookieService: Error stringifying settings:', error);
    }
  }

  /**
   * Delete app settings cookie
   */
  deleteSettingsCookie(): void {
    this.deleteCookie(this.settingsCookieName);
  }
}

