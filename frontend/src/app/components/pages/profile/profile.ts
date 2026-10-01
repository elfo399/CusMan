import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { KeycloakService } from '../../../services/keycloak.service';
import { KeycloakProfile } from 'keycloak-js';
import { UserService, MeDto } from '../../../services/user.service';
import { LanguageService } from '../../../services/language.service';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
  standalone: false
})
export class ProfileComponent implements OnInit {
  profile: KeycloakProfile | undefined;
  me: MeDto | undefined;
  firstName = '';
  lastName = '';
  email = '';
  lang: 'it' | 'en' = 'it';
  // Email verification flow removed

  constructor(public kc: KeycloakService, private user: UserService, private langSvc: LanguageService, private cdr: ChangeDetectorRef) {
    this.profile = kc.getUserProfile();
  }

  openAccountManagement() {
    this.kc.openAccountManagement();
  }

  ngOnInit(): void {
    if (this.profile) {
      this.firstName = this.profile.firstName || '';
      this.lastName = this.profile.lastName || '';
      this.email = this.profile.email || '';
    }
    // language current
    this.lang = this.langSvc.current();

    // subscribe to global user stream
    this.user.me$.subscribe((me) => { if (me) this.me = me; });
    // trigger initial load
    this.user.refreshMe().subscribe();
  }

  save() {
    this.user.updateMe({ firstName: this.firstName, lastName: this.lastName, email: this.email }).subscribe((m) => {
      this.me = m;
    });
  }

  // resendVerification() removed

  logout() {
    this.kc.logout();
  }

  // Avatar upload removed; only initial is shown

  onLangChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value as 'it' | 'en';
    this.langSvc.set(value);
    this.lang = value;
  }
}



