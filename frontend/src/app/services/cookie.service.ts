import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class CookieService {
  private readonly defaultExpirationDays = 30;

  /**
   * Get a cookie value by name
   * @param name Cookie name
   * @returns Cookie value or null if not found
   */
  getCookie(name: string): string | null {
    const nameEQ = name + '=';
    const cookies = document.cookie.split(';');
    
    for (let i = 0; i < cookies.length; i++) {
      let cookie = cookies[i];
      while (cookie.charAt(0) === ' ') {
        cookie = cookie.substring(1, cookie.length);
      }
      if (cookie.indexOf(nameEQ) === 0) {
        return decodeURIComponent(cookie.substring(nameEQ.length, cookie.length));
      }
    }
    return null;
  }

  /**
   * Set a cookie with a value and expiration
   * @param name Cookie name
   * @param value Cookie value
   * @param days Number of days until expiration (defaults to 30)
   */
  setCookie(name: string, value: string, days: number = this.defaultExpirationDays): void {
    const expirationDate = new Date();
    expirationDate.setTime(expirationDate.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = `expires=${expirationDate.toUTCString()}`;
    document.cookie = `${name}=${encodeURIComponent(value)};${expires};path=/`;
  }

  /**
   * Delete a cookie by name
   * @param name Cookie name
   */
  deleteCookie(name: string): void {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
  }
}

