import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { KeycloakService } from '../../../services/keycloak.service';
import { UserService } from '../../../services/user.service';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss',
  standalone: false
})
export class NavbarComponent {
  isLight = false;
  userInitial = 'U';

  constructor(private kc: KeycloakService, private router: Router, private user: UserService) {
    const saved = localStorage.getItem('theme');
    if (saved === 'light') {
      this.isLight = true;
      document.documentElement.removeAttribute('data-theme');
    } else if (saved === 'dark') {
      this.isLight = false;
      document.documentElement.setAttribute('data-theme', 'dark');
    }
    this.userInitial = kc.getUserInitial();
    // subscribe to user updates for initial
    this.user.me$.subscribe((me) => {
      if (!me) return;
      if (me.firstName) this.userInitial = me.firstName.charAt(0).toUpperCase();
    });
    // initial refresh (non-blocking)
    this.user.refreshMe().subscribe({ next: () => {}, error: () => {} });
  }

  toggleTheme() {
    this.isLight = !this.isLight;
    if (this.isLight) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    }
  }

  logout() {
    this.kc.logout();
  }

  openProfile() {
    this.router.navigateByUrl('/profilo');
  }
}
