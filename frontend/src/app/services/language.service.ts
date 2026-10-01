import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

type Lang = 'it' | 'en';

const MESSAGES: Record<Lang, Record<string, string>> = {
  it: {
    'nav.home': 'Home',
    'nav.communications': 'Comunicazioni',
    'nav.clients': 'Clienti',
    'nav.chat': 'Chat',
    'nav.inbox': 'Posta',
    'nav.charts': 'Grafici',
    'nav.myContacts': 'Miei contatti',
    'nav.settings': 'Impostazioni',
    'nav.profile': 'Profilo',

    'home.welcome': 'Benvenuto in Cusman',
    'home.tagline': 'Gestione clienti semplificata e veloce.',

    'profile.title': 'Profilo utente',
    'profile.edit': 'Modifica profilo',
    'profile.logout': 'Logout',
    'profile.username': 'Username',
    'profile.firstName': 'Nome',
    'profile.lastName': 'Cognome',
    'profile.email': 'Email',
    'profile.emailVerified': 'Email verificata',

    'communications.title': 'Comunicazioni',
    'communications.items': 'clienti',
    'communications.errorLoading': 'Errore nel caricamento dei clienti',
    'communications.table.name': 'Nome',
    'communications.table.city': 'Città',
    'communications.table.category': 'Categoria',
    'communications.table.assigned': 'Assegnato',
    'communications.table.status': 'Stato',
    'communications.empty': 'Nessun cliente trovato',

    'page.placeholderFor': 'Contenuto placeholder per',

    'settings.title': 'Impostazioni',
    'settings.language': 'Lingua',
    'settings.italian': 'Italiano',
    'settings.english': 'Inglese',
    'theme.light': 'Chiaro',
    'theme.dark': 'Scuro',

    'common.yes': 'SÃ¬',
    'common.no': 'No'
  },
  en: {
    'nav.home': 'Home',
    'nav.communications': 'Communications',
    'nav.clients': 'Clients',
    'nav.chat': 'Chat',
    'nav.inbox': 'Inbox',
    'nav.charts': 'Charts',
    'nav.myContacts': 'My contacts',
    'nav.settings': 'Settings',
    'nav.profile': 'Profile',

    'home.welcome': 'Welcome to Cusman',
    'home.tagline': 'Customer management, simple and fast.',

    'profile.title': 'User Profile',
    'profile.edit': 'Edit profile',
    'profile.logout': 'Logout',
    'profile.username': 'Username',
    'profile.firstName': 'First name',
    'profile.lastName': 'Last name',
    'profile.email': 'Email',
    'profile.emailVerified': 'Email verified',

    'communications.title': 'Communications',
    'communications.items': 'clients',
    'communications.errorLoading': 'Error loading clients',
    'communications.table.name': 'Name',
    'communications.table.city': 'City',
    'communications.table.category': 'Category',
    'communications.table.assigned': 'Assigned to',
    'communications.table.status': 'Status',
    'communications.empty': 'No clients found',

    'page.placeholderFor': 'Placeholder content for',

    'settings.title': 'Settings',
    'settings.language': 'Language',
    'settings.italian': 'Italian',
    'settings.english': 'English',
    'theme.light': 'Light',
    'theme.dark': 'Dark',

    'common.yes': 'Yes',
    'common.no': 'No'
  }
};

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private lang$ = new BehaviorSubject<Lang>(this.loadInitial());

  private loadInitial(): Lang {
    const saved = localStorage.getItem('lang');
    const val = (saved || 'it') as Lang;
    document.documentElement.lang = val;
    return val;
  }

  current(): Lang { return this.lang$.value; }

  set(lang: Lang) {
    if (this.lang$.value === lang) return;
    localStorage.setItem('lang', lang);
    document.documentElement.lang = lang;
    this.lang$.next(lang);
  }

  // Simple translate lookup
  t(key: string): string {
    const lang = this.lang$.value;
    return MESSAGES[lang][key] ?? key;
  }
}
