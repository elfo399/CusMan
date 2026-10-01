import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PartnerService, PartnerCard, PartnerFull } from '../../../services/partner.service';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'app-clients-page',
  templateUrl: './clients.html',
  styleUrl: './clients.scss',
  standalone: false
})
export class ClientsPage implements OnInit {
  loading = true;
  error = false;
  items: PartnerCard[] = [];
  page = 1;
  // Griglia configurabile: righe x colonne
  gridCols = 5;
  gridRows = 4;
  pageSize = 20;
  hasNext = false;
  hasTotal = false;
  totalPages = 0;
  selected: any | null = null;
  showDetail = false;
  activeTab: 'gen' | 'tech' | 'eco' | 'proj' | 'map' = 'gen';

  // Creation state
  showCreate = false;
  createData: Partial<PartnerFull> = { name: '', useGPS: 0 };
  creating = false;
  createActiveTab: 'gen' | 'tech' | 'eco' | 'map' | 'proj' = 'gen';

  // Edit state (inside detail)
  editing = false;
  editData: Partial<PartnerFull> = {};
  useCoordsEdit = false;

  // Users and status options
  userOptions: Array<{ value: string; label: string }> = [];
  statusOptions: string[] = ['attivo', 'configurazione', 'sviluppo', 'dismissione'];

  // Confirm dialogs state
  showConfirmDelete = false;
  showConfirmSave = false;
  changes: Array<{ key: string; from: any; to: any }> = [];

  constructor(private partner: PartnerService, private cdr: ChangeDetectorRef, private sanitizer: DomSanitizer, private msg: MessageService, private http: HttpClient) {}

  ngOnInit(): void {
    // Load grid preference from localStorage
    try { const v = localStorage.getItem('clients.grid.cols'); if (v) { const n = Number(v); if (Number.isFinite(n) && n >= 1 && n <= 10) this.gridCols = n; } } catch {}
    try { const r = localStorage.getItem('clients.grid.rows'); if (r) { const n = Number(r); if (Number.isFinite(n) && n >= 1 && n <= 20) this.gridRows = n; } } catch {}
    this.pageSize = Math.max(1, this.gridCols) * Math.max(1, this.gridRows);
    this.loadPage();
    this.loadUsers();
  }

  // Export removed from Clients page (moved to Comunicazione)

  private loadUsers(): void {
    try {
      // Backend returns [{ id, username, firstName, lastName, email }]
      this.http.get<any[]>(`/api/users`).subscribe({
        next: (arr) => {
          const opts = (arr || []).map((u) => {
            const fn = (u.firstName || '').toString().trim();
            const ln = (u.lastName || '').toString().trim();
            const name = (fn || ln) ? `${fn} ${ln}`.trim() : '';
            const label = name ? `${name} (${u.username})` : `${u.username}`;
            return { value: String(u.username || ''), label };
          });
          this.userOptions = opts;
          try { this.cdr.detectChanges(); } catch {}
        },
        error: () => { this.userOptions = []; try { this.cdr.detectChanges(); } catch {} }
      });
    } catch { this.userOptions = []; }
  }

  open(it: PartnerCard): void {
    this.selected = null;
    this.partner.get(it.id).subscribe({
      next: (full) => {
        this.selected = full;
        this.showDetail = true;
        this.activeTab = 'gen';
        this.editing = false;
        this.editData = { ...full };
        // Normalize coords 0 -> null to avoid default "0" in inputs
        if ((this.editData as any).latitude === 0) (this.editData as any).latitude = null as any;
        if ((this.editData as any).longitude === 0) (this.editData as any).longitude = null as any;
        // Initialize toggle from stored preference when available; fallback to presence of coords
        const stored = (full as any)?.useGPS;
        this.useCoordsEdit = (stored != null) ? this.isOn(stored) : this.hasCoords(full);
        try { this.cdr.detectChanges(); } catch {}
      },
      error: () => {
        this.selected = null;
        this.showDetail = false;
        this.editing = false;
        this.editData = {};
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }
  onUseGpsToggle(v: any): void {
    const b = !!v;
    this.useCoordsEdit = b;
    if (this.editData) (this.editData as any).useGPS = b ? 1 : 0;
  }

  closeDetail(): void { this.showDetail = false; try { this.cdr.detectChanges(); } catch {} }

  // Build a Google Maps embed URL from partner record
  // Behavior aggiornato:
  // - Se useGPS (preferenza) è attivo o siamo in toggle attivo (preferCoords=true) e ci sono coordinate, usa le coordinate
  // - Altrimenti, se esiste indirizzo, usa l'indirizzo
  // - Se indirizzo vuoto e useGPS=0, non mostrare mappa anche se ci sono coordinate
  getMapEmbedUrlFor(d: any, preferCoords = false): SafeResourceUrl | null {
    try {
      const lat = Number((d?.latitude ?? d?.lat));
      const lng = Number((d?.longitude ?? d?.lng));
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
      const address = (d?.address || '').toString().trim();
      const pref = !!(preferCoords || this.isOn(d?.useGPS));

      if (pref && hasCoords) {
        const url = `https://www.google.com/maps?q=${lat},${lng}&z=14&output=embed`;
        return this.sanitizer.bypassSecurityTrustResourceUrl(url);
      }

      if (address) {
        const q = encodeURIComponent(address);
        const url = `https://maps.google.com/maps?q=${q}&z=14&output=embed`;
        return this.sanitizer.bypassSecurityTrustResourceUrl(url);
      }

      // Indirizzo vuoto e preferenza disattivata: nessuna mappa
      return null;
    } catch {
      return null;
    }
  }

  private isOn(v: any): boolean { return v === 1 || v === '1' || v === true; }

  private hasCoords(obj: any): boolean {
    const lat = Number((obj?.latitude ?? obj?.lat));
    const lng = Number((obj?.longitude ?? obj?.lng));
    return Number.isFinite(lat) && Number.isFinite(lng);
  }

  // Mostra la tab mappa solo se:
  // - c'è un indirizzo, oppure
  // - la preferenza useGPS è attiva (toggle in UI o valore salvato) e ci sono coordinate
  hasAddressOrCoords(obj: any): boolean {
    try {
      const hasAddr = !!(obj && typeof obj.address === 'string' && obj.address.trim());
      const pref = this.useCoordsEdit || !!(obj && this.isOn(obj.useGPS));
      // Mostra la tab se c'è indirizzo OPPURE se la preferenza è attiva,
      // indipendentemente dal fatto che le coordinate siano già valorizzate
      return hasAddr || pref;
    } catch {
      return false;
    }
  }

  // CRUD helpers
  openCreate(): void {
    this.createData = { name: '' };
    this.createActiveTab = 'gen';
    this.showCreate = true;
  }
  cancelCreate(): void { this.showCreate = false; this.createData = { name: '' }; }
  doCreate(): void {
    const payload = this.normalizeNumeric({ ...this.createData });
    // Basic range validation to avoid server 500 on DECIMAL overflow
    if (payload.latitude != null && (Number(payload.latitude) < -90 || Number(payload.latitude) > 90)) {
      try { this.msg.add({ severity: 'warn', summary: 'Latitudine fuori range (-90..90)' }); } catch {}
      return;
    }
    if (payload.longitude != null && (Number(payload.longitude) < -180 || Number(payload.longitude) > 180)) {
      try { this.msg.add({ severity: 'warn', summary: 'Longitudine fuori range (-180..180)' }); } catch {}
      return;
    }
    if (!payload.name || !String(payload.name).trim()) { try { this.msg.add({ severity: 'warn', summary: 'Nome richiesto' }); } catch {}; return; }
    // Persist preference as 0/1
    (payload as any).useGPS = this.useCoordsEdit ? 1 : (this.createData?.useGPS ? 1 : 0);
    this.creating = true;
    this.partner.create(payload).subscribe({
      next: (r) => {
        this.creating = false;
        this.showCreate = false;
        try { this.msg.add({ severity: 'success', summary: 'Creato', detail: r.name }); } catch {}
        this.reloadList();
      },
      error: () => {
        this.creating = false;
        try { this.msg.add({ severity: 'error', summary: 'Creazione fallita' }); } catch {}
      }
    });
  }

  startEdit(): void {
    if (!this.selected) return;
    this.editing = true;
    this.editData = { ...this.selected };
    if ((this.editData as any).latitude === 0) (this.editData as any).latitude = null as any;
    if ((this.editData as any).longitude === 0) (this.editData as any).longitude = null as any;
  }
  cancelEdit(): void { this.editing = false; this.editData = this.selected ? { ...this.selected } : {}; }
  prepareConfirmSave(): void {
    const sel = this.selected as PartnerFull | null;
    if (!sel) return;
    const diffs = this.computeChanges(sel, this.editData);
    if (!diffs.length) { try { this.msg.add({ severity: 'info', summary: 'Nessuna modifica' }); } catch {}; return; }
    this.changes = diffs;
    this.showConfirmSave = true;
  }
  private computeChanges(original: PartnerFull, edited: Partial<PartnerFull>): Array<{ key: string; from: any; to: any }> {
    const keys = Object.keys(edited || {});
    const out: Array<{ key: string; from: any; to: any }> = [];
    for (const k of keys) {
      const fromVal = (original as any)[k];
      const toVal = (edited as any)[k];
      const fromStr = fromVal == null ? '' : String(fromVal);
      const toStr = toVal == null ? '' : String(toVal);
      if (fromStr !== toStr) out.push({ key: k, from: fromVal, to: toVal });
    }
    return out;
  }
  fieldLabel(k: string): string {
    const map: Record<string,string> = {
      name: 'Nome', referent: 'Referente', email: 'Email', phone: 'Telefono', address: 'Indirizzo',
      site: 'Sito', domain: 'Dominio', domain_expiry: 'Scadenza dominio', hosting_provider: 'Provider hosting',
      hosting_expiry: 'Scadenza hosting', ssl_expiry: 'Scadenza SSL', panel_url: 'URL pannello', status: 'Stato',
      assign: 'Assegnato a', data_start: 'Data inizio', data_end: 'Data fine', renew_date: 'Data rinnovo', price: 'Prezzo', note: 'Note',
      latitude: 'Latitudine', longitude: 'Longitudine', useGPS: 'Usa coordinate GPS'
    };
    return map[k] || k;
  }
  proceedSaveEdit(): void {
    const sel = this.selected as PartnerFull | null;
    if (!sel) { this.showConfirmSave = false; return; }
    const id = Number(sel.id);
    const payload = this.normalizeNumeric({ ...this.editData });

    // Persist preference and force coordinate handling based on the toggle:
    (payload as any).useGPS = this.useCoordsEdit ? 1 : 0;
    // - If using coordinates, ensure both latitude/longitude are coerced and present in payload
    // - If not using coordinates, explicitly null them to clear any previous values
    if (this.useCoordsEdit) {
      const lat = (this.editData as any)?.latitude;
      const lng = (this.editData as any)?.longitude;
      const num = this.normalizeNumeric({ latitude: lat, longitude: lng } as any);
      (payload as any).latitude = (num as any).latitude;
      (payload as any).longitude = (num as any).longitude;
    } else {
      (payload as any).latitude = null;
      (payload as any).longitude = null;
    }
    // Range validation
    if (payload.latitude != null && (Number(payload.latitude) < -90 || Number(payload.latitude) > 90)) {
      try { this.msg.add({ severity: 'warn', summary: 'Latitudine fuori range (-90..90)' }); } catch {}
      return;
    }
    if (payload.longitude != null && (Number(payload.longitude) < -180 || Number(payload.longitude) > 180)) {
      try { this.msg.add({ severity: 'warn', summary: 'Longitudine fuori range (-180..180)' }); } catch {}
      return;
    }
    if (!payload.name || !String(payload.name).trim()) { try { this.msg.add({ severity: 'warn', summary: 'Nome richiesto' }); } catch {}; return; }
    this.partner.update(id, payload).subscribe({
      next: (r) => {
        this.selected = r;
        this.editData = { ...r };
        this.editing = false;
        this.showConfirmSave = false;
        try { this.msg.add({ severity: 'success', summary: `Aggiornato (${this.changes.length} campi)` }); } catch {}
        this.reloadList();
      },
      error: () => { this.showConfirmSave = false; try { this.msg.add({ severity: 'error', summary: 'Aggiornamento fallito' }); } catch {} }
    });
  }

  // Coerce numeric fields (lat/long/price) from string/locale to number
  private normalizeNumeric<T extends { [k: string]: any }>(obj: T): T {
    const fix = (v: any) => {
      if (v == null || v === '') return null as any;
      const s = String(v).replace(',', '.').trim();
      const n = Number(s);
      return Number.isFinite(n) ? (n as any) : null as any;
    };
    if ('latitude' in obj) (obj as any).latitude = fix((obj as any).latitude);
    if ('longitude' in obj) (obj as any).longitude = fix((obj as any).longitude);
    if ('price' in obj) (obj as any).price = fix((obj as any).price);
    return obj;
  }
  openConfirmDelete(): void { this.showConfirmDelete = true; }
  proceedDelete(): void {
    const sel = this.selected as PartnerFull | null;
    if (!sel) { this.showConfirmDelete = false; return; }
    const id = Number(sel.id);
    if (!Number.isFinite(id)) { this.showConfirmDelete = false; return; }
    this.partner.delete(id).subscribe({
      next: () => {
        this.showConfirmDelete = false;
        try { this.msg.add({ severity: 'success', summary: 'Eliminato' }); } catch {}
        this.showDetail = false;
        this.selected = null;
        this.reloadList();
      },
      error: () => { this.showConfirmDelete = false; try { this.msg.add({ severity: 'error', summary: 'Eliminazione fallita' }); } catch {} }
    });
  }
  cancelDelete(): void { this.showConfirmDelete = false; }

  private loadPage(): void {
    this.loading = true;
    const offset = (this.page - 1) * this.pageSize;
    this.partner.list({ limit: this.pageSize, offset }).subscribe({
      next: (res) => {
        this.items = res.items || [];
        const total = res.total || 0;
        this.hasTotal = true;
        this.totalPages = Math.max(1, Math.ceil(total / this.pageSize));
        this.hasNext = offset + this.items.length < total;
        this.loading = false;
        try { this.cdr.detectChanges(); } catch {}
      },
      error: () => {
        this.loading = false; this.error = true; try { this.cdr.detectChanges(); } catch {}
      }
    });
  }
  private reloadList(): void { this.loadPage(); }
  nextPage(): void { if (this.hasNext) { this.page++; this.loadPage(); } }
  prevPage(): void { if (this.page > 1) { this.page--; this.loadPage(); } }
}
