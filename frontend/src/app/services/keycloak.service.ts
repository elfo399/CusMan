import { Injectable } from '@angular/core';
import Keycloak, { KeycloakInitOptions, KeycloakProfile } from 'keycloak-js';

@Injectable({ providedIn: 'root' })
export class KeycloakService {
  private keycloak = new (Keycloak as any)({
    url: this.detectAuthUrl(),
    realm: 'cusman',
    clientId: 'cusman-frontend'
  });

  private authenticated = false;
  private profile: KeycloakProfile | undefined;

  async init(): Promise<void> {
    const options: KeycloakInitOptions = {
      onLoad: 'login-required',
      checkLoginIframe: false,
      pkceMethod: 'S256',
      silentCheckSsoRedirectUri: undefined
    } as KeycloakInitOptions;

    this.authenticated = await this.keycloak.init(options);
    if (this.authenticated) {
      try {
        this.profile = await this.keycloak.loadUserProfile();
      } catch {}
      this.scheduleTokenRefresh();
    }
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  getUserProfile(): KeycloakProfile | undefined {
    return this.profile;
  }

  getToken(): string | undefined {
    return (this.keycloak as any).token as string | undefined;
  }

  getUserInitial(): string {
    const name = this.profile?.firstName || this.profile?.username || '';
    return name ? name.charAt(0).toUpperCase() : 'U';
  }

  async login(): Promise<void> {
    await this.keycloak.login();
  }

  async logout(): Promise<void> {
    await this.keycloak.logout({ redirectUri: window.location.origin + '/' });
  }

  async openAccountManagement(): Promise<void> {
    try {
      await (this.keycloak as any).accountManagement();
    } catch {}
  }

  private scheduleTokenRefresh() {
    const refresh = async () => {
      try {
        await (this.keycloak as any).updateToken(30);
      } catch {}
    };
    setInterval(refresh, 20000);
  }

  private detectAuthUrl(): string {
    // Browser must reach Keycloak directly. Use localhost:8081 for dev and Docker.
    const isDockerNginx = typeof window !== 'undefined' && window.location?.port === '8080';
    const isNgServe = typeof window !== 'undefined' && window.location?.port === '4200';
    if (isDockerNginx || isNgServe) return 'http://localhost:8081';
    // Fallback: same as above
    return 'http://localhost:8081';
  }
}
