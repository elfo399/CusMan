import { Component, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ClientiService, Cliente } from '../../../services/clienti.service';
import { UserService } from '../../../services/user.service';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-my-contacts',
  templateUrl: './my-contacts.html',
  styleUrl: '../communications/clients-to-call.scss',
  standalone: false
})
export class MyContactsComponent implements OnInit {
  // Title for header
  titleKey = 'nav.myContacts';

  clienti: Cliente[] = [];
  private allRows: Cliente[] = [];
  loading = true;
  error = false;
  q: string = '';
  page = 1;
  pageSize = 500; // rollback pagination UI; fetch more rows at once
  hasNext = false;
  hasTotal = false;
  totalPages = 0;
  sortBy: 'id' | 'name' | 'city' | 'category' | 'status' | 'assign' = 'name';
  sortDir: 'asc' | 'desc' = 'asc';
  showFilters = false;
  distinctCities: string[] = [];
  distinctCategories: string[] = [];
  distinctStatuses: string[] = [];
  selCity = new Set<string>();
  selCategory = new Set<string>();
  selStatus = new Set<string>();
  filtersLoading = false;
  filtersError = false;
  openCities = true;
  openCategories = false;
  openStatuses = false;
  cityFilter = '';
  categoryFilter = '';
  statusFilter = '';
  detailOpen = false;
  detailLoading = false;
  selected: any | null = null;
  editing: any | null = null;
  original: any | null = null;
  saving = false;
  deleting = false;
  creating = false;
  showMoreContacts = false;
  states: string[] = [
    'Non contattato',
    'Contattato',
    'Primo follow up',
    'Secondo follow up',
    'Scartato'
  ];
  confirmDelete = false;
  showErrors = false;

  // Row menu state (align with Communications page)
  openRowMenuId: number | null = null;
  rowMenuUp = false;

  users: Array<{ id: string; username: string; display: string }> = [];
  private userDisplayByUsername = new Map<string, string>();

  private meUsername: string | null = null;

  mapUrl: SafeResourceUrl | null = null;
  mapsLink: string | null = null;

  constructor(private clientiSvc: ClientiService, private cdr: ChangeDetectorRef, private userSvc: UserService, private sanitizer: DomSanitizer) {}

  ngOnInit(): void {
    // Load current user, then load data filtered by assignment
    this.userSvc.refreshMe().subscribe({
      next: (me) => { this.meUsername = me?.username || null; this.loadData(); this.loadFilters(); },
      error: () => { this.meUsername = null; this.loadData(); this.loadFilters(); }
    });

    // Load users for display
    this.userSvc.listUsers().subscribe({
      next: (arr) => {
        this.users = (arr || []).map((u) => ({ id: u.id, username: u.username, display: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username }));
        this.userDisplayByUsername.clear();
        this.users.forEach(u => this.userDisplayByUsername.set(u.username, u.display));
        this.cdr.markForCheck();
      },
      error: () => {}
    });

    // Initial filters will be loaded after meUsername is set
  }

  // ESC per chiudere la modale come in "Comunicazioni"
  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.confirmSave) { this.closeSaveConfirm(); return; }
    if (this.confirmDelete) { this.closeConfirmDelete(); return; }
    if (this.confirmSite) { this.closeSiteConfirm(); return; }
    if (this.detailOpen && !this.creating) { this.closeDetails(); return; }
  }

  // Row menu handlers (same behavior as Communications)
  toggleRowMenu(id: number, ev?: MouseEvent): void {
    if (this.openRowMenuId === id) { this.openRowMenuId = null; this.cdr.markForCheck(); return; }
    this.openRowMenuId = id;
    try {
      const el = (ev?.currentTarget || ev?.target) as HTMLElement | null;
      const rect = el ? el.getBoundingClientRect() : null;
      const spaceBelow = rect ? (window.innerHeight - rect.bottom) : 0;
      const estimatedMenuHeight = 220;
      this.rowMenuUp = spaceBelow < (estimatedMenuHeight + 12);
    } catch { this.rowMenuUp = false; }
    this.cdr.markForCheck();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.openRowMenuId !== null) { this.openRowMenuId = null; this.cdr.markForCheck(); }
  }

  openSiteFromRow(c: Cliente): void {
    const url = this.siteHref((c as any).site);
    if (!url) return;
    this.onSiteClick({ preventDefault(){} } as any, url);
    this.openRowMenuId = null;
    this.cdr.markForCheck();
  }

  deleteRow(c: Cliente): void {
    this.openRowMenuId = null;
    if (!c?.id) return;
    this.selected = c;
    this.editing = { id: c.id } as any;
    this.confirmDelete = true;
    this.cdr.markForCheck();
  }

  private loadData(): void {
    this.loading = true;
    this.clientiSvc
      .getClientiDaChiamare({
        q: this.q || undefined,
        limit: this.pageSize,
        offset: (this.page - 1) * this.pageSize,
        city: Array.from(this.selCity),
        category: Array.from(this.selCategory),
        status: Array.from(this.selStatus),
        assign: this.meUsername ? [this.meUsername] : [],
        sort: this.sortBy,
        dir: this.sortDir
      })
      .pipe(finalize(() => { this.loading = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (res) => {
          const rows = res.items || [];
          const total = res.total || 0;
          this.allRows = rows;
          this.hasNext = rows.length === this.pageSize;
          this.clienti = this.allRows;
          this.hasTotal = true;
          this.totalPages = Math.max(1, Math.ceil(total / this.pageSize));
          this.error = false;
          this.cdr.markForCheck();
        },
        error: () => { this.error = true; }
      });
  }

  // Toolbar helpers
  applyFilter(): void { this.page = 1; this.loadData(); }
  refresh(): void { this.loadData(); }
  nextPage(): void { if (this.hasNext) { this.page++; this.loadData(); } }
  prevPage(): void { if (this.page > 1) { this.page--; this.loadData(); } }
  toggleFilters(): void { this.showFilters = !this.showFilters; }
  filterList(list: string[], q: string): string[] { const s = (q || '').toLowerCase(); return list.filter(x => x.toLowerCase().includes(s)); }
  isChecked(kind: 'city' | 'category' | 'status', v: string): boolean { const set = kind==='city'?this.selCity: kind==='category'?this.selCategory:this.selStatus; return set.has(v); }
  toggleOption(kind: 'city' | 'category' | 'status', v: string, ev: Event): void { const set = kind==='city'?this.selCity: kind==='category'?this.selCategory:this.selStatus; const t=(ev.target as HTMLInputElement); t.checked? set.add(v): set.delete(v); }
  toggleSection(kind: 'city' | 'category' | 'status'): void { if (kind==='city') this.openCities=!this.openCities; if (kind==='category') this.openCategories=!this.openCategories; if (kind==='status') this.openStatuses=!this.openStatuses; }
  clearAllFilters(): void { this.selCity.clear(); this.selCategory.clear(); this.selStatus.clear(); }
  applyFilters(): void { this.page=1; this.loadData(); this.showFilters=false; }

  private loadFilters(): void {
    const me = this.meUsername;
    this.clientiSvc.getFilters({ assign: me ? [me] : [] }).subscribe({
      next: (f) => {
        this.distinctCities = f.cities || [];
        this.distinctCategories = f.categories || [];
        this.distinctStatuses = f.statuses || [];
        this.cdr.markForCheck();
      },
      error: () => { /* ignore */ }
    });
  }

  // Table helpers
  statusClass(stato: string | null | undefined): string {
    const v = (stato || '').toLowerCase();
    if (/non\s*contatt/.test(v) || v === '') return 'stato--gray';
    if (v.includes('contattato') || v.includes('contact')) return 'stato--green';
    if ((v.includes('primo') && v.includes('follow')) || v.includes('follow 1') || v.includes('follow-up 1')) return 'stato--yellow';
    if ((v.includes('secondo') && v.includes('follow')) || v.includes('follow 2') || v.includes('follow-up 2')) return 'stato--orange';
    if (v.includes('scartat') || v.includes('rifiut') || v.includes('reject') || v.includes('perso')) return 'stato--red';
    if (v.includes('follow')) return 'stato--yellow';
    return 'stato--gray';
  }
  assignedDisplay(username: string | null | undefined): string { if (!username) return '—'; return this.userDisplayByUsername.get(username) || username; }
  siteHref(url: string | null | undefined): string | null { const s=(url||'').trim(); if (!s) return null; if(/^https?:\/\//i.test(s)) return s; return `http://${s}`; }
  onSiteClick(ev: Event, href: string | null) { if (!href) return; ev.preventDefault(); this.pendingSiteUrl = href; this.confirmSite = true; }

  // Detail dialog
  pendingSiteUrl: string | null = null;
  confirmSite = false;
  closeSiteConfirm(): void { this.confirmSite = false; this.pendingSiteUrl = null; this.cdr.markForCheck(); }
  proceedOpenSite(): void { if (this.pendingSiteUrl) window.open(this.pendingSiteUrl, '_blank'); this.closeSiteConfirm(); }

  openDetails(c: Cliente): void {
    this.detailOpen = true;
    this.detailLoading = true;
    this.selected = c;
    this.editing = null;
    this.cdr.markForCheck();
    this.clientiSvc.getClienteById(c.id).pipe(finalize(() => { this.detailLoading = false; this.cdr.markForCheck(); })).subscribe({
      next: (full) => {
        this.editing = {
          id: full.id,
          nome: full.name ?? c.nome,
          citta: full.city ?? c.citta,
          categoria: full.category ?? c.categoria,
          assegnato: full.assign ?? c.assegnato,
          stato: full.status ?? c.stato,
          site: full.site ?? '',
          email_1: full.email_1 ?? '',
          email_2: full.email_2 ?? '',
          email_3: full.email_3 ?? '',
          phone_1: full.phone_1 ?? '',
          phone_2: full.phone_2 ?? '',
          phone_3: full.phone_3 ?? '',
          latitude: full.latitude != null ? Number(full.latitude) : null,
          longitude: full.longitude != null ? Number(full.longitude) : null,
          data_follow_up_1: full.data_follow_up_1 ?? '',
          data_follow_up_2: full.data_follow_up_2 ?? '',
          note: full.note ?? ''
        };
        this.original = JSON.parse(JSON.stringify(this.editing));
        this.showMoreContacts = !!(this.editing.email_2 || this.editing.email_3 || this.editing.phone_2 || this.editing.phone_3);
        this.updateMapUrl();
        this.cdr.markForCheck();
      },
      error: () => {
        this.editing = { ...c } as any;
        this.original = JSON.parse(JSON.stringify(this.editing));
        this.showMoreContacts = false;
        this.cdr.markForCheck();
      }
    });
  }

  openCreate(): void {
    this.creating = true;
    this.detailOpen = true;
    this.detailLoading = false;
    this.selected = null;
    this.editing = {
      id: null,
      nome: '',
      citta: '',
      categoria: '',
      assegnato: this.meUsername ?? null,
      stato: 'Non contattato',
      site: '',
      email_1: '',
      email_2: '',
      email_3: '',
      phone_1: '',
      phone_2: '',
      phone_3: '',
      latitude: null,
      longitude: null,
      data_follow_up_1: '',
      data_follow_up_2: '',
      note: ''
    };
    this.original = JSON.parse(JSON.stringify(this.editing));
    this.showMoreContacts = false;
    this.showErrors = false;
    this.updateMapUrl();
    this.cdr.markForCheck();
  }

  closeDetails(): void { this.detailOpen = false; this.selected = null; this.editing = null; this.creating = false; this.showErrors = false; this.cdr.markForCheck(); }

  // Confirm open/save/delete
  confirmSave = false;
  openSaveConfirm(): void {
    if (!this.isFormValid()) { this.showErrors = true; this.cdr.markForCheck(); return; }
    this.changesSummary = this.buildChanges();
    this.confirmSave = true;
    this.cdr.markForCheck();
  }
  closeSaveConfirm(): void { this.confirmSave = false; this.cdr.markForCheck(); }

  saveChanges(): void {
    if (!this.editing) return;
    this.confirmSave = false;
    if (!this.isFormValid()) { this.showErrors = true; this.cdr.markForCheck(); return; }
    const id = this.editing.id;
    const payload: any = {
      name: this.editing.nome,
      city: this.editing.citta,
      category: this.editing.categoria,
      assign: this.normalizeEmpty(this.editing.assegnato),
      status: this.editing.stato,
      site: this.editing.site,
      email_1: this.normalizeEmpty(this.editing.email_1),
      phone_1: this.normalizeEmpty(this.editing.phone_1),
      note: this.editing.note
    };
    payload.email_2 = this.normalizeEmpty(this.editing.email_2);
    payload.email_3 = this.normalizeEmpty(this.editing.email_3);
    payload.phone_2 = this.normalizeEmpty(this.editing.phone_2);
    payload.phone_3 = this.normalizeEmpty(this.editing.phone_3);
    payload.data_follow_up_1 = this.normalizeEmpty(this.editing.data_follow_up_1);
    payload.data_follow_up_2 = this.normalizeEmpty(this.editing.data_follow_up_2);
    const lat = this.editing.latitude;
    const lng = this.editing.longitude;
    payload.latitude = (lat === '' || lat === null || isNaN(Number(lat))) ? null : Number(lat);
    payload.longitude = (lng === '' || lng === null || isNaN(Number(lng))) ? null : Number(lng);

    this.saving = true;
    const obs = this.creating ? this.clientiSvc.createCliente(payload) : this.clientiSvc.updateCliente(id, payload);
    obs.pipe(finalize(() => { this.saving = false; this.cdr.markForCheck(); })).subscribe({
      next: (resp) => {
        const assignFinal = (resp?.assign ?? payload.assign) || null;
        if (this.creating) {
          // Add only if rimane assegnato a me
          if (!this.meUsername || assignFinal === this.meUsername) {
            const created = resp;
            const row: Cliente = {
              id: created.id,
              nome: created.name ?? payload.name,
              citta: created.city ?? payload.city,
              categoria: created.category ?? payload.category,
              assegnato: assignFinal as any,
              stato: created.status ?? payload.status,
              data_start: created.data_start ?? undefined,
              data_follow_up_1: created.data_follow_up_1 ?? payload.data_follow_up_1 ?? null,
              data_follow_up_2: created.data_follow_up_2 ?? payload.data_follow_up_2 ?? null
            } as Cliente;
            this.clienti = [row, ...this.clienti];
          }
        } else {
          const updated = resp;
          const idx = this.clienti.findIndex(x => x.id === id);
          if (assignFinal && this.meUsername && assignFinal !== this.meUsername) {
            // Non è più mio: rimuovi dalla vista
            this.clienti = this.clienti.filter(x => x.id !== id);
          } else if (idx >= 0) {
            this.clienti[idx] = {
              id,
              nome: updated.name ?? payload.name,
              citta: updated.city ?? payload.city,
              categoria: updated.category ?? payload.category,
              assegnato: assignFinal as any,
              stato: updated.status ?? payload.status,
              data_start: this.clienti[idx].data_start,
              data_follow_up_1: updated.data_follow_up_1 ?? payload.data_follow_up_1 ?? this.clienti[idx].data_follow_up_1 ?? null,
              data_follow_up_2: updated.data_follow_up_2 ?? payload.data_follow_up_2 ?? this.clienti[idx].data_follow_up_2 ?? null
            } as Cliente;
          }
        }
        this.closeDetails();
        // Refresh list to ensure cleared/changed dates and fields reflect server state
        this.loadData();
      },
      error: () => {}
    });
  }

  // Delete
  openConfirmDelete(): void { this.confirmDelete = true; this.cdr.markForCheck(); }
  closeConfirmDelete(): void { this.confirmDelete = false; this.cdr.markForCheck(); }
  deleteCliente(): void {
    if (!this.editing) return;
    const id = this.editing.id;
    this.deleting = true;
    this.clientiSvc.deleteCliente(id).pipe(finalize(() => { this.deleting = false; this.cdr.markForCheck(); })).subscribe({
      next: () => { this.clienti = this.clienti.filter(x => x.id !== id); this.closeConfirmDelete(); this.closeDetails(); },
      error: () => {}
    });
  }

  // Helpers
  changesSummary: Array<{ key: string; label: string; from: any; to: any }> = [];
  private buildChanges(): Array<{ key: string; label: string; from: any; to: any }> {
    // Use translation keys for labels; template applies | t
    const labels: Record<string, string> = {
      nome: 'form.name',
      citta: 'form.city',
      categoria: 'form.category',
      assegnato: 'form.assigned',
      stato: 'form.status',
      site: 'form.site',
      email_1: 'form.email',
      email_2: 'form.email2',
      email_3: 'form.email3',
      phone_1: 'form.phone',
      phone_2: 'form.phone2',
      phone_3: 'form.phone3',
      data_follow_up_1: 'form.follow1',
      data_follow_up_2: 'form.follow2',
      note: 'form.notes'
    };
    const keys = Object.keys(labels);
    const before = this.original || {} as any;
    const after = this.editing || {} as any;
    const fmt = (v: any) => {
      const n = this.normalizeEmpty(v);
      return n === null ? '—' : String(v ?? '');
    };
    const changes: Array<{ key: string; label: string; from: any; to: any }> = [];
    for (const k of keys) {
      const a = this.normalizeEmpty(after[k]);
      const b = this.normalizeEmpty(before[k]);
      const eq = (a === b) || (String(a) === String(b));
      if (!eq) changes.push({ key: k, label: labels[k], from: fmt(before[k]), to: fmt(after[k]) });
    }
    return changes;
  }
  isFormValid(): boolean {
    const e = this.editing || ({} as any);
    const okNome = !!(e.nome && String(e.nome).trim());
    const okCitta = !!(e.citta && String(e.citta).trim());
    const okCategoria = !!(e.categoria && String(e.categoria).trim());
    const okStato = !!(e.stato && String(e.stato).trim());
    return okNome && okCitta && okCategoria && okStato;
  }
  onCoordChange(): void { this.updateMapUrl(); }
  private updateMapUrl(): void { const lat = Number(this.editing?.latitude); const lng = Number(this.editing?.longitude); const valid = isFinite(lat) && isFinite(lng); if (!valid) { this.mapUrl = null; this.mapsLink = null; return; } const url = `https://maps.google.com/maps?q=${lat},${lng}&z=14&output=embed`; this.mapUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url); this.mapsLink = `https://maps.google.com/?q=${lat},${lng}`; }
  normalizeEmpty(v: any): any { const s = (v ?? '').toString().trim(); return s ? v : null; }
}
