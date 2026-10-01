import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { KeycloakService } from './services/keycloak.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private kc: KeycloakService, private router: Router) {}

  async canActivate(): Promise<boolean | UrlTree> {
    if (this.kc.isAuthenticated()) return true;
    try {
      await this.kc.login();
      return true;
    } catch {
      return this.router.parseUrl('/');
    }
  }
}

