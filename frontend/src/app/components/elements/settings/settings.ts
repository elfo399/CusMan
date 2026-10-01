import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { LanguageService } from '../../../services/language.service';
import { UserService, MeDto } from '../../../services/user.service';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
  standalone: false
})
export class SettingsComponent implements OnInit {
  lang: 'it' | 'en' = 'it';
  me: MeDto | null = null;
  gplacesKey: string = '';
  savingKey = false;
  showKey = false;
  // Clients grid preference
  clientsGridCols = 5;
  clientsGridRows = 4;
  savingGrid = false;

  constructor(private langSvc: LanguageService, private user: UserService, private cdr: ChangeDetectorRef, private msg: MessageService) {}

  ngOnInit(): void {
    this.lang = this.langSvc.current();
    // Load grid preference from localStorage
    try { const v = localStorage.getItem('clients.grid.cols'); if (v) this.clientsGridCols = Math.max(1, Number(v)) || 5; } catch {}
    try { const r = localStorage.getItem('clients.grid.rows'); if (r) this.clientsGridRows = Math.max(1, Number(r)) || 4; } catch {}
    this.user.me$.subscribe((me) => {
      this.me = me;
      // Prefill input with existing key if present
      const needFetch = !!(me && me.hasGooglePlacesKey) && !this.gplacesKey;
      if (needFetch) {
        this.user.getAttributes().subscribe({
          next: (r) => {
            const gp = (Array.isArray(r?.attributes?.['google_places_key']) ? r.attributes['google_places_key'][0] : r?.attributes?.['google_places_key']) || '';
            this.gplacesKey = gp || '';
            try { this.cdr.detectChanges(); } catch {}
          },
          error: () => {}
        });
      }
      try { this.cdr.detectChanges(); } catch {}
    });
    this.user.refreshMe().subscribe();
  }

  onLangChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value as 'it' | 'en';
    this.langSvc.set(value);
    this.lang = value;
  }

  saveGooglePlacesKey() {
    const key = (this.gplacesKey || '').trim();
    this.savingKey = true;
    this.user.setGooglePlacesKey(key).subscribe({
      next: (u) => {
        this.me = u;
        this.gplacesKey = key;
        this.savingKey = false;
        try { this.msg.add({ severity: 'success', summary: 'Key salvata', detail: 'Google Places API key aggiornata' }); } catch {}
        try { this.cdr.detectChanges(); } catch {}
      },
      error: () => {
        this.savingKey = false;
        try { this.msg.add({ severity: 'error', summary: 'Salvataggio fallito', detail: 'Impossibile salvare la key' }); } catch {}
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }

  clearGooglePlacesKey() {
    this.savingKey = true;
    this.user.clearGooglePlacesKey().subscribe({
      next: (u) => {
        this.me = u;
        this.gplacesKey = '';
        this.savingKey = false;
        try { this.msg.add({ severity: 'success', summary: 'Key rimossa' }); } catch {}
        try { this.cdr.detectChanges(); } catch {}
      },
      error: () => {
        this.savingKey = false;
        try { this.msg.add({ severity: 'error', summary: 'Operazione fallita', detail: 'Impossibile rimuovere la key' }); } catch {}
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }

  toggleShowKey() { this.showKey = !this.showKey; }
  async copyKey() {
    try {
      await navigator.clipboard.writeText(this.gplacesKey || '');
      try { this.msg.add({ severity: 'info', summary: 'Copiato negli appunti' }); } catch {}
    } catch {}
  }

  // Save Clients grid preference locally
  saveClientsGrid() {
    this.savingGrid = true;
    try {
      localStorage.setItem('clients.grid.cols', String(this.clientsGridCols));
      localStorage.setItem('clients.grid.rows', String(this.clientsGridRows));
    } catch {}
    this.savingGrid = false;
    try { this.msg.add({ severity: 'success', summary: 'Preferenza salvata', detail: 'Griglia Clienti aggiornata' }); } catch {}
    try { this.cdr.detectChanges(); } catch {}
  }
}
