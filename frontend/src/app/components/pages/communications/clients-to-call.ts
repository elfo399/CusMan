import { Component, OnInit, ChangeDetectorRef, ViewChild, ElementRef, HostListener } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MessageService } from 'primeng/api';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ClientiService, Cliente } from '../../../services/clienti.service';
import { UserService } from '../../../services/user.service';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-clients-to-call',
  templateUrl: './clients-to-call.html',
  styleUrl: './clients-to-call.scss',
  standalone: false
})
export class ClientsToCallComponent implements OnInit {
  titleKey: string = 'communications.title';
  clienti: Cliente[] = [];
  private allRows: Cliente[] = [];
  exporting = false;
  loading = true;
  error = false;
  q: string = '';
  page = 1;
  pageSize = 100;
  hasNext = false;
  hasTotal = false;
  totalPages = 0;
  // sorting (by name A/Z)
  sortBy: 'id' | 'name' | 'city' | 'category' | 'status' | 'assign' = 'name';
  sortDir: 'asc' | 'desc' = 'asc';
  showFilters = false;
  showAddMenu = false;
  // CSV import state
  showImportPrompt = false;
  showImportPanel = false;
  importHeaders: string[] = [];
  importPreview: Array<Partial<{ name: string; site?: string | null; city?: string | null; category?: string | null; email_1?: string | null; email_2?: string | null; email_3?: string | null; phone_1?: string | null; phone_2?: string | null; phone_3?: string | null; latitude?: number | null; longitude?: number | null; assign?: string | null; contact_method?: string | null; data_start?: string | null; data_follow_up_1?: string | null; data_follow_up_2?: string | null; status?: string | null; note?: string | null }>> = [];
  importItems: Array<Partial<{ name: string; site?: string | null; city?: string | null; category?: string | null; email_1?: string | null; email_2?: string | null; email_3?: string | null; phone_1?: string | null; phone_2?: string | null; phone_3?: string | null; latitude?: number | null; longitude?: number | null; assign?: string | null; contact_method?: string | null; data_start?: string | null; data_follow_up_1?: string | null; data_follow_up_2?: string | null; status?: string | null; note?: string | null }>> = [];
  importTotal = 0;
  importUnmapped: string[] = [];
  importMissingHeaders: string[] = [];
  importInProgress = false;
  importResult: { inserted: number; failed: number } | null = null;
  // flash message after import
  flashMsg: string | null = null;
  // CSV preview paging
  importIdx = 0;
  distinctCities: string[] = [];
  distinctCategories: string[] = [];
  distinctStatuses: string[] = [];
  // temporary selected filters
  selCity = new Set<string>();
  selCategory = new Set<string>();
  selStatus = new Set<string>();
  // filters loading state
  filtersLoading = false;
  filtersError = false;
  // submenu state + inline search
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
  // optional contacts section (email_2/3, phone_2/3)
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
  openRowMenuId: number | null = null;
  rowMenuUp = false;
  // Export progress state
  exportPhase: 'preparing' | 'fetching' | 'building' | 'downloading' | null = null;
  exportTotal = 0;
  exportDone = 0;
  showExportConfirm = false;
  exportCount = 0;
  totalCount = 0;

  // Site confirm/open state
  confirmSite = false;
  pendingSiteUrl: string = '';
  // Save confirm state
  confirmSave = false;
  changesSummary: Array<{ key: string; label: string; from: any; to: any }> = [];

  users: Array<{ id: string; username: string; display: string }> = [];
  private userDisplayByUsername = new Map<string, string>();

  mapUrl: SafeResourceUrl | null = null;
  mapsLink: string | null = null;
  @ViewChild('csvInput') csvInput?: ElementRef<HTMLInputElement>;
  // Site open confirm (defined later)

  // Only my contacts filter
  private onlyMine = false;
  private meUsername: string | null = null;

  constructor(private clientiSvc: ClientiService, private cdr: ChangeDetectorRef, private userSvc: UserService, private sanitizer: DomSanitizer, private route: ActivatedRoute, private msg: MessageService) {}

  ngOnInit(): void {
    this.onlyMine = !!this.route.snapshot.data?.['mine'];
    this.titleKey = this.route.snapshot.data?.['titleKey'] || 'communications.title';
    // Load current user (needed when onlyMine=true)
    this.userSvc.refreshMe().subscribe({
      next: (me) => { this.meUsername = me?.username || null; this.loadData(); },
      error: () => { this.meUsername = null; this.loadData(); }
    });
    this.userSvc.listUsers().subscribe({
      next: (arr) => {
        this.users = (arr || []).map((u) => ({ id: u.id, username: u.username, display: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username }));
        this.userDisplayByUsername.clear();
        this.users.forEach(u => this.userDisplayByUsername.set(u.username, u.display));
        this.cdr.markForCheck();
      },
      error: () => {}
    });

    // Load distinct filter values (global)
    this.clientiSvc.getFilters().subscribe({
      next: (f) => {
        this.distinctCities = f.cities || [];
        this.distinctCategories = f.categories || [];
        this.distinctStatuses = f.statuses || [];
        this.cdr.markForCheck();
      },
      error: () => {}
    });
  }

  // Add-menu handlers
  toggleAddMenu(force?: boolean): void {
    this.showAddMenu = typeof force === 'boolean' ? force : !this.showAddMenu;
    this.cdr.markForCheck();
  }
  openImportPrompt(): void {
    this.toggleAddMenu(false);
    this.showImportPrompt = true;
    this.cdr.markForCheck();
  }
  closeImportPrompt(): void {
    this.showImportPrompt = false;
    this.cdr.markForCheck();
  }
  triggerCsvInput(): void {
    try { this.csvInput?.nativeElement?.click(); } catch {}
  }
  onCsvSelected(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (!input?.files?.length) { this.toggleAddMenu(false); return; }
    const file = input.files![0];
    this.toggleAddMenu(false);
    this.showImportPrompt = false;
    const reader = new FileReader();
    reader.onload = () => {
      const text = (reader.result || '') as string;
      try {
        const parsed = this.parseCsv(text);
        this.importHeaders = parsed.headers;
        const { items, unmapped, mappedFields } = this.mapCsvToClienti(parsed.headers, parsed.rows);
        this.importItems = items;
        this.importTotal = items.length;
        this.importUnmapped = unmapped;
        this.importMissingHeaders = this.requiredFields().filter(f => !mappedFields.has(f));
        this.importPreview = items.slice(0, 20);
        this.importIdx = 0;
        this.importResult = null;
        this.showImportPanel = true;
        this.cdr.markForCheck();
      } catch (err) {
        console.error('CSV parse failed', err);
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  // Minimal CSV parser supporting quoted fields and commas
  private parseCsv(text: string): { headers: string[]; rows: string[][] } {
    const rows: string[][] = [];
    let i = 0;
    const len = text.length;
    let cur: string[] = [];
    let field = '';
    let inQuotes = false;
    while (i < len) {
      const ch = text[i++];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else { field += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { cur.push(field); field = ''; }
        else if (ch === '\n') { cur.push(field); field = ''; rows.push(cur); cur = []; }
        else if (ch === '\r') { /* skip */ }
        else { field += ch; }
      }
    }
    if (field.length || cur.length) { cur.push(field); rows.push(cur); }
    if (!rows.length) return { headers: [], rows: [] };
    const headers = (rows.shift() || []).map(h => h.replace(/^\uFEFF/, '').trim());
    return { headers, rows };
  }

  private normalizeHeader(h: string): string {
    return h.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_]+/g, ' ').trim();
  }

  private headerToField(h: string): string | null {
    const n = this.normalizeHeader(h);
    const map: Record<string, string> = {
      'name': 'name', 'nome': 'name', 'ragione sociale': 'name',
      'city': 'city', 'citta': 'city', 'citt a': 'city',
      'category': 'category', 'categoria': 'category',
      'assign': 'assign', 'assegnato': 'assign', 'assegnatario': 'assign',
      'status': 'status', 'stato': 'status',
      'site': 'site', 'sito': 'site', 'website': 'site', 'url': 'site',
      // Emails (support underscore, space and numeric suffixes)
      'email': 'email_1', 'email 1': 'email_1', 'email1': 'email_1', 'email_1': 'email_1',
      'email 2': 'email_2', 'email2': 'email_2', 'email_2': 'email_2',
      'email 3': 'email_3', 'email3': 'email_3', 'email_3': 'email_3',
      // Phones (support italian aliases and mobile synonyms)
      'phone': 'phone_1', 'telefono': 'phone_1', 'cell': 'phone_1', 'cellulare': 'phone_1', 'mobile': 'phone_1', 'gsm': 'phone_1',
      'phone 1': 'phone_1', 'telefono 1': 'phone_1', 'phone_1': 'phone_1',
      'phone 2': 'phone_2', 'telefono 2': 'phone_2', 'cell 2': 'phone_2', 'cellulare 2': 'phone_2', 'mobile 2': 'phone_2', 'phone_2': 'phone_2',
      'phone 3': 'phone_3', 'telefono 3': 'phone_3', 'cell 3': 'phone_3', 'cellulare 3': 'phone_3', 'mobile 3': 'phone_3', 'phone_3': 'phone_3',
      'contact method': 'contact_method', 'metodo contatto': 'contact_method', 'contact_method': 'contact_method',
      'lat': 'latitude', 'latitude': 'latitude',
      'lon': 'longitude', 'lng': 'longitude', 'longitudine': 'longitude', 'longitude': 'longitude',
      // Dates (support underscore variants from template)
      'data start': 'data_start', 'start date': 'data_start', 'data inizio': 'data_start', 'data_start': 'data_start',
      'follow up 1': 'data_follow_up_1', 'followup1': 'data_follow_up_1', 'data_follow_up_1': 'data_follow_up_1',
      'follow up 2': 'data_follow_up_2', 'followup2': 'data_follow_up_2', 'data_follow_up_2': 'data_follow_up_2',
      'note': 'note', 'note ': 'note'
    };
    return map[n] || null;
  }

  private mapCsvToClienti(headers: string[], rows: string[][]): { items: any[]; unmapped: string[]; mappedFields: Set<string> } {
    const idxToField: Array<string | null> = headers.map(h => this.headerToField(h));
    const unmapped = headers.filter((_, i) => !idxToField[i]);
    const mappedFields = new Set(idxToField.filter((x): x is string => !!x));
    const items: any[] = [];
    for (const r of rows) {
      const obj: any = {};
      for (let i = 0; i < r.length && i < idxToField.length; i++) {
        const f = idxToField[i];
        if (!f) continue;
        const v = r[i]?.trim();
        if (v === '') continue;
        if (f === 'latitude' || f === 'longitude') {
          const num = Number(v.replace(',', '.'));
          if (!Number.isNaN(num)) obj[f] = num;
        } else {
          obj[f] = v;
        }
      }
      if (obj.name) items.push(obj);
    }
    return { items, unmapped, mappedFields };
  }

  cancelImport(): void { this.showImportPanel = false; this.importItems = []; this.importPreview = []; this.importUnmapped = []; this.importResult = null; }
  confirmImport(): void {
    if (!this.importItems.length) { this.cancelImport(); return; }
    this.importInProgress = true;
    this.clientiSvc.importBatch(this.importItems).pipe(finalize(() => { this.importInProgress = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (r) => {
          this.importResult = { inserted: r.inserted, failed: r.failed };
          // Close panel and show success toast
          this.showImportPanel = false;
          const parts: string[] = [];
          if (r.inserted > 0) parts.push(`${r.inserted} record importati`);
          if (r.failed > 0) parts.push(`${r.failed} falliti`);
          const detail = parts.join(', ');
          this.msg.add({ severity: 'success', summary: 'Import completato', detail: detail || 'Operazione completata' });
          // refresh table
          this.loadData();
        },
        error: () => {
          this.importResult = { inserted: 0, failed: this.importItems.length };
          this.msg.add({ severity: 'error', summary: 'Import fallito', detail: 'Si è verificato un errore. Riprova.' });
        }
      });
  }

  // Preview helpers
  currentPreview(): any | null { return this.importItems.length ? this.importItems[this.importIdx] : null; }
  prevImport(): void { if (this.importIdx > 0) { this.importIdx--; this.cdr.markForCheck(); } }
  nextImport(): void { if (this.importIdx < Math.max(0, this.importItems.length - 1)) { this.importIdx++; this.cdr.markForCheck(); } }

  importMapUrl(): SafeResourceUrl | null {
    const r: any = this.currentPreview();
    if (!r) return null;
    const toNum = (v: any) => {
      if (v == null) return null;
      const n = Number(String(v).replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    };
    const lat = toNum(r.latitude);
    const lon = toNum(r.longitude);
    if (lat != null && lon != null) {
      const url = `https://www.google.com/maps?q=${lat},${lon}&z=13&output=embed`;
      return this.sanitizer.bypassSecurityTrustResourceUrl(url);
    }
    const q = (r.city || r.site || r.name || '').toString().trim();
    if (q) {
      const url = `https://www.google.com/maps?q=${encodeURIComponent(q)}&z=12&output=embed`;
      return this.sanitizer.bypassSecurityTrustResourceUrl(url);
    }
    return null;
  }

  // Required headers: all DB columns except id (auto)
  requiredFields(): string[] {
    return [
      'name','site','city','category','email_1','email_2','email_3','phone_1','phone_2','phone_3','latitude','longitude','assign','contact_method','data_start','data_follow_up_1','data_follow_up_2','status','note'
    ];
  }

  // UI helper: groups for una struttura più chiara (mantiene l'ordine CSV sopra)
  requiredFieldGroups(): Array<{ title: string; fields: string[] }> {
    const order = this.requiredFields();
    const pick = (names: string[]) => names.filter(n => order.includes(n));
    return [
      { title: 'Identità', fields: pick(['name', 'site', 'category']) },
      { title: 'Localizzazione', fields: pick(['city', 'latitude', 'longitude']) },
      { title: 'Contatti', fields: pick(['email_1','email_2','email_3','phone_1','phone_2','phone_3']) },
      { title: 'Assegnazione & Stato', fields: pick(['assign','contact_method','status']) },
      { title: 'Date', fields: pick(['data_start','data_follow_up_1','data_follow_up_2']) },
      { title: 'Note', fields: pick(['note']) }
    ];
  }

  // UI helper: indice 1-based della posizione nel CSV
  fieldIndex(name: string): number {
    const i = this.requiredFields().indexOf(name);
    return i >= 0 ? (i + 1) : 0;
  }

  downloadTemplate(): void {
    const headers = ['id', ...this.requiredFields()].join(',');
    const blob = new Blob([headers + '\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clienti_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  private loadData(): void {
    this.loading = true;
    this.clientiSvc
      .getClientiDaChiamare({ q: this.q || undefined, limit: this.pageSize, offset: (this.page - 1) * this.pageSize, city: Array.from(this.selCity), category: Array.from(this.selCategory), status: Array.from(this.selStatus), assign: (this.onlyMine && this.meUsername) ? [this.meUsername] : undefined, sort: this.sortBy, dir: this.sortDir })
      .pipe(
        finalize(() => {
          this.loading = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: (res) => {
          const rows = res.items || [];
          const total = res.total || 0;
          this.totalCount = total;
          this.allRows = rows;
          this.hasNext = rows.length === this.pageSize;
          this.clienti = this.allRows;
          this.hasTotal = true;
          this.totalPages = Math.max(1, Math.ceil(total / this.pageSize));
          this.error = false;
          this.cdr.markForCheck();
        },
        error: (err: any) => {
          if (err?.status === 304 && err?.error) {
            try {
              this.allRows = Array.isArray(err.error) ? err.error : JSON.parse(err.error);
              this.hasNext = (this.clienti?.length || 0) === this.pageSize;
              this.clienti = this.allRows;
              // keep previous totalPages if known; otherwise unknown
              this.error = false;
            } catch {
              this.error = true;
            }
          } else {
            this.error = true;
          }
          this.cdr.markForCheck();
        }
      });
  }

  // search handled client-side (by name only)

  // Ordinamento per colonna rimosso

  refresh(): void { this.loadData(); }
  nextPage(): void { if (this.hasNext) { this.page++; this.loadData(); } }
  prevPage(): void { if (this.page > 1) { this.page--; this.loadData(); } }
  setSort(col: 'id'|'name'|'city'|'category'|'status'|'assign'): void {
    if (this.sortBy === col) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = col;
      this.sortDir = 'asc';
    }
    this.page = 1;
    this.loadData();
  }

  // Filters UI
  toggleFilters(): void {
    this.showFilters = !this.showFilters;
    if (this.showFilters) {
      // load only if not already loaded
      if (this.distinctCities.length && this.distinctCategories.length && this.distinctStatuses.length) return;
      this.filtersLoading = true;
      this.filtersError = false;
      this.clientiSvc.getFilters().subscribe({
        next: (f) => {
          this.distinctCities = f.cities || [];
          this.distinctCategories = f.categories || [];
          this.distinctStatuses = f.statuses || [];
          this.filtersLoading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.filtersLoading = false;
          this.filtersError = true;
          this.cdr.markForCheck();
        }
      });
    }
  }
  isChecked(type: 'city'|'category'|'status', value: string): boolean {
    const s = type==='city'?this.selCity:type==='category'?this.selCategory:this.selStatus;
    return s.has(value);
  }
  toggleOption(type: 'city'|'category'|'status', value: string, ev: any): void {
    const set = type==='city'?this.selCity:type==='category'?this.selCategory:this.selStatus;
    if (ev?.target?.checked) set.add(value); else set.delete(value);
  }
  clearAllFilters(): void { this.selCity.clear(); this.selCategory.clear(); this.selStatus.clear(); }
  applyFilters(): void { this.page = 1; this.loadData(); this.showFilters = false; }

  applyFilter(): void { this.page = 1; this.loadData(); }
  clearFilter(): void { this.q = ''; this.page = 1; this.loadData(); }


  // UI helpers for submenu + search
  toggleSection(type: 'city'|'category'|'status'): void {
    if (type==='city') this.openCities = !this.openCities;
    else if (type==='category') this.openCategories = !this.openCategories;
    else this.openStatuses = !this.openStatuses;
  }
  filterList(list: string[], q: string): string[] {
    const s = (q || '').toLowerCase().trim();
    if (!s) return list;
    return list.filter(v => v && v.toLowerCase().includes(s));
  }

      // No avatar/checkbox UI anymore, so helper methods removed

  statusClass(stato: string | null | undefined): string {
    const v = (stato || '').toLowerCase();
    if (/non\s*contatt/.test(v) || v === '') return 'stato stato--gray';
    if (v.includes('contattato') || v.includes('contact')) return 'stato stato--green';
    if ((v.includes('primo') && v.includes('follow')) || v.includes('follow 1') || v.includes('follow-up 1')) return 'stato stato--yellow';
    if ((v.includes('secondo') && v.includes('follow')) || v.includes('follow 2') || v.includes('follow-up 2')) return 'stato stato--orange';
    if (v.includes('scartat') || v.includes('rifiut') || v.includes('reject') || v.includes('perso')) return 'stato stato--red';
    if (v.includes('follow')) return 'stato stato--yellow';
    return 'stato stato--gray';
  }

  assignedDisplay(usernameOrName?: string): string {
    if (!usernameOrName) return '';
    const disp = this.userDisplayByUsername.get(usernameOrName);
    return disp || usernameOrName;
  }

  // Global ESC to close top-most modal or panel
  @HostListener('document:keydown.escape')
  onEsc(): void {
    // Close in priority order: confirm overlays > import panel/prompt > detail panel
    if (this.confirmSave) { this.closeSaveConfirm(); return; }
    if (this.confirmDelete) { this.closeConfirmDelete(); return; }
    if (this.confirmSite) { this.closeSiteConfirm(); return; }
    if (this.showImportPanel) { this.cancelImport(); return; }
    if (this.showImportPrompt) { this.closeImportPrompt(); return; }
    if (this.detailOpen) { this.closeDetails(); return; }
  }

  // Row menu handlers
  toggleRowMenu(id: number, ev?: MouseEvent): void {
    if (this.openRowMenuId === id) {
      this.openRowMenuId = null;
      this.cdr.markForCheck();
      return;
    }
    this.openRowMenuId = id;
    try {
      const el = (ev?.currentTarget || ev?.target) as HTMLElement | null;
      const rect = el ? el.getBoundingClientRect() : null;
      const spaceBelow = rect ? (window.innerHeight - rect.bottom) : 0;
      const estimatedMenuHeight = 220; // approximate .row-menu max-height
      this.rowMenuUp = spaceBelow < (estimatedMenuHeight + 12);
    } catch { this.rowMenuUp = false; }
    this.cdr.markForCheck();
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
    // Reuse the same confirm overlay used in details
    this.selected = c;
    this.editing = { id: c.id } as any;
    this.confirmDelete = true;
    this.cdr.markForCheck();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.openRowMenuId !== null) {
      this.openRowMenuId = null;
      this.cdr.markForCheck();
    }
  }

  openDetails(c: Cliente): void {
    this.detailOpen = true;
    this.detailLoading = true;
    this.selected = c;
    this.editing = null;
    this.cdr.markForCheck();
    this.clientiSvc.getClienteById(c.id).pipe(finalize(() => { this.detailLoading = false; this.cdr.markForCheck(); })).subscribe({
      next: (full) => {
        // Map backend fields to FE shape if needed
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
          // follow up dates from DB (YYYY-MM-DD strings)
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
        // fallback to current row data
        this.editing = { ...c } as any;
        this.original = JSON.parse(JSON.stringify(this.editing));
        this.showMoreContacts = false;
        this.cdr.markForCheck();
      }
    });
  }

  // Export a single record as CSV (full details when available)
  exportCsvRow(c: Cliente): void {
    if (!c?.id) return;
    this.openRowMenuId = null;
    const headers = ['id', ...this.requiredFields()];
    const toCsv = (v: any) => {
      if (v == null) return '';
      const s = String(v);
      if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    this.clientiSvc.getClienteById(c.id).subscribe({
      next: (full) => {
        const row: Record<string, any> = {
          id: full.id,
          name: full.name ?? c.nome ?? '',
          site: full.site ?? '',
          city: full.city ?? c.citta ?? '',
          category: full.category ?? c.categoria ?? '',
          email_1: full.email_1 ?? '',
          email_2: full.email_2 ?? '',
          email_3: full.email_3 ?? '',
          phone_1: full.phone_1 ?? '',
          phone_2: full.phone_2 ?? '',
          phone_3: full.phone_3 ?? '',
          latitude: full.latitude ?? '',
          longitude: full.longitude ?? '',
          assign: full.assign ?? c.assegnato ?? '',
          contact_method: full.contact_method ?? '',
          data_start: full.data_start ?? '',
          data_follow_up_1: full.data_follow_up_1 ?? '',
          data_follow_up_2: full.data_follow_up_2 ?? '',
          status: full.status ?? c.stato ?? '',
          note: full.note ?? ''
        };
        const values = [row['id'], ...this.requiredFields().map(k => row[k])];
        const csv = headers.join(',') + '\n' + values.map(toCsv).join(',') + '\n';
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = (row['name'] ? String(row['name']).trim().replace(/[^a-z0-9_-]+/gi,'_') : 'cliente');
        a.download = `cliente_${c.id}_${safeName}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => {
        // fallback: export minimal row
        const rowMin = {
          id: c.id,
          name: c.nome ?? '',
          site: '',
          city: c.citta ?? '',
          category: c.categoria ?? '',
          email_1: '', email_2: '', email_3: '',
          phone_1: '', phone_2: '', phone_3: '',
          latitude: '', longitude: '',
          assign: c.assegnato ?? '',
          contact_method: '',
          data_start: '', data_follow_up_1: '', data_follow_up_2: '',
          status: c.stato ?? '',
          note: ''
        } as any;
        const headers = ['id', ...this.requiredFields()];
        const values = [rowMin['id'], ...this.requiredFields().map(k => (rowMin as any)[k])];
        const csv = headers.join(',') + '\n' + values.map(toCsv).join(',') + '\n';
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = ((rowMin as any)['name'] ? String((rowMin as any)['name']).trim().replace(/[^a-z0-9_-]+/gi,'_') : 'cliente');
        a.download = `cliente_${c.id}_${safeName}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  }

  // Export all rows matching current filters/pagination as CSV
      async exportAllCsv(): Promise<void> {
    try {
      this.exporting = true;
      this.exportPhase = 'preparing';
      // If we know the total (from server list), show it
      this.exportTotal = this.totalCount || 0;
      this.exportDone = 0;
      this.cdr.markForCheck();

      const blob = await firstValueFrom(
        this.clientiSvc.exportClienti({
          q: this.q || undefined,
          city: Array.from(this.selCity),
          category: Array.from(this.selCategory),
          status: Array.from(this.selStatus),
          assign: (this.onlyMine && this.meUsername) ? [this.meUsername] : undefined,
          sort: this.sortBy,
          dir: this.sortDir
        })
      );
      this.exportPhase = 'downloading';
      // Mark as completed for visual feedback
      if (this.exportTotal > 0) this.exportDone = this.exportTotal;
      this.cdr.markForCheck();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clienti_template_export.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    } finally {
      // Keep the card visible briefly so the user can see the status
      setTimeout(() => {
        this.exporting = false;
        this.exportPhase = null;
        this.exportDone = 0;
        this.exportTotal = 0;
        this.cdr.markForCheck();
      }, 1200);
    }
  }

  // Export confirm flow (used by toolbar)
  openExportConfirm(): void {
    // Prefer server total count when available
    this.exportCount = this.totalCount > 0 ? this.totalCount : (this.clienti?.length || 0);
    this.showExportConfirm = true;
    this.cdr.markForCheck();
  }
  cancelExportConfirm(): void { this.showExportConfirm = false; this.cdr.markForCheck(); }
  proceedExportConfirm(): void { this.showExportConfirm = false; this.exportAllCsv(); }

  // Delete confirm handlers
  closeConfirmDelete(): void { this.confirmDelete = false; this.cdr.markForCheck(); }
  deleteCliente(): void {
    const id = Number((this.editing as any)?.id || (this.selected as any)?.id);
    if (!Number.isFinite(id)) { this.closeConfirmDelete(); return; }
    this.deleting = true;
    this.clientiSvc.deleteCliente(id).pipe(finalize(() => { this.deleting = false; this.cdr.markForCheck(); })).subscribe({
      next: () => { this.closeConfirmDelete(); this.detailOpen = false; this.selected = null; this.loadData(); },
      error: () => { this.closeConfirmDelete(); }
    });
  }

  // Details panel helpers
  closeDetails(): void { this.detailOpen = false; this.selected = null; this.editing = null; this.showErrors = false; this.openRowMenuId = null; this.cdr.markForCheck(); }
  openCreate(): void {
    this.showAddMenu = false;
    this.creating = true;
    this.detailLoading = false;
    this.editing = {
      id: null,
      nome: '',
      citta: '',
      categoria: '',
      assegnato: null,
      stato: 'Non contattato',
      site: '',
      email_1: '', email_2: '', email_3: '',
      phone_1: '', phone_2: '', phone_3: '',
      latitude: null, longitude: null,
      data_follow_up_1: '', data_follow_up_2: '',
      note: ''
    } as any;
    this.selected = null;
    this.detailOpen = true;
    this.updateMapUrl();
    this.cdr.markForCheck();
  }

  closeSaveConfirm(): void { this.confirmSave = false; this.cdr.markForCheck(); }
  private mapEditingToPayload(): any {
    const e: any = this.editing || {};
    const toNum = (v: any) => {
      if (v == null || v === '') return null;
      const n = Number(String(v).replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    };
    return {
      name: e.nome ?? e.name ?? '',
      site: e.site ?? '',
      city: e.citta ?? e.city ?? '',
      category: e.categoria ?? e.category ?? '',
      email_1: e.email_1 ?? '',
      email_2: e.email_2 ?? '',
      email_3: e.email_3 ?? '',
      phone_1: e.phone_1 ?? '',
      phone_2: e.phone_2 ?? '',
      phone_3: e.phone_3 ?? '',
      latitude: toNum(e.latitude),
      longitude: toNum(e.longitude),
      assign: e.assegnato ?? e.assign ?? '',
      contact_method: e.contact_method ?? '',
      data_start: e.data_start ?? '',
      data_follow_up_1: e.data_follow_up_1 ?? '',
      data_follow_up_2: e.data_follow_up_2 ?? '',
      status: e.stato ?? e.status ?? 'Non contattato',
      note: e.note ?? ''
    };
  }
  saveChanges(): void {
    if (!this.editing) return;
    const payload = this.mapEditingToPayload();
    this.saving = true;
    if (this.creating) {
      this.clientiSvc.createCliente(payload).pipe(finalize(() => { this.saving = false; this.cdr.markForCheck(); })).subscribe({
        next: () => { this.detailOpen = false; this.creating = false; this.flashMsg = 'Creato'; this.loadData(); },
        error: () => { /* keep panel open */ }
      });
    } else {
      const id = Number((this.editing as any)?.id || (this.selected as any)?.id);
      if (!Number.isFinite(id)) { this.saving = false; return; }
      this.clientiSvc.updateCliente(id, payload).pipe(finalize(() => { this.saving = false; this.cdr.markForCheck(); })).subscribe({
        next: () => { this.detailOpen = false; this.flashMsg = 'Aggiornato'; this.loadData(); },
        error: () => { /* keep panel open */ }
      });
    }
  }

  // Open site confirmation and helpers
  siteHref(site: any): string | null {
    try {
      const raw = (site || '').toString().trim();
      if (!raw) return null;
      if (/^https?:\/\//i.test(raw)) return raw;
      return 'http://' + raw;
    } catch { return null; }
  }
  onSiteClick(ev: Event, url: string): void {
    ev?.preventDefault?.();
    this.pendingSiteUrl = url;
    this.confirmSite = true;
    this.cdr.markForCheck();
  }
  closeSiteConfirm(): void { this.confirmSite = false; this.pendingSiteUrl = ''; this.cdr.markForCheck(); }
  proceedOpenSite(): void {
    const url = this.pendingSiteUrl;
    this.closeSiteConfirm();
    if (url) window.open(url, '_blank', 'noopener');
  }

  // Compute or update map URL from current editing object
  updateMapUrl(): void {
    try {
      const r: any = this.editing;
      if (!r) { this.mapUrl = null; this.mapsLink = null; return; }
      const toNum = (v: any) => {
        if (v == null || v === '') return null;
        const n = Number(String(v).replace(',', '.'));
        return Number.isFinite(n) ? n : null;
      };
      const lat = toNum(r.latitude);
      const lon = toNum(r.longitude);
      if (lat != null && lon != null) {
        const u = `https://www.google.com/maps?q=${lat},${lon}&z=13&output=embed`;
        this.mapUrl = this.sanitizer.bypassSecurityTrustResourceUrl(u);
        this.mapsLink = `https://www.google.com/maps?q=${lat},${lon}`;
        return;
      }
      const q = (r.city || r.site || r.nome || r.name || '').toString().trim();
      if (q) {
        const u = `https://www.google.com/maps?q=${encodeURIComponent(q)}&z=12&output=embed`;
        this.mapUrl = this.sanitizer.bypassSecurityTrustResourceUrl(u);
        this.mapsLink = `https://www.google.com/maps?q=${encodeURIComponent(q)}`;
        return;
      }
      this.mapUrl = null; this.mapsLink = null;
    } catch { this.mapUrl = null; this.mapsLink = null; }
  }

  // Form validation helpers
  isFormValid(): boolean {
    const e: any = this.editing || {};
    const req = [e?.nome, e?.citta, e?.categoria, e?.stato];
    return req.every((v) => typeof v === 'string' && v.trim().length > 0);
  }
  missingFields(): string[] {
    const e: any = this.editing || {};
    const out: string[] = [];
    if (!(e?.nome || '').toString().trim()) out.push('nome');
    if (!(e?.citta || '').toString().trim()) out.push('citta');
    if (!(e?.categoria || '').toString().trim()) out.push('categoria');
    if (!(e?.stato || '').toString().trim()) out.push('stato');
    return out;
  }
  onCoordChange(): void { this.updateMapUrl(); }

  openSaveConfirm(): void {
    const orig: any = this.original || {};
    const e: any = this.editing || {};
    const pairs: Array<[string,string]> = [
      ['nome','Nome'], ['citta','Città'], ['categoria','Categoria'], ['assegnato','Assegnato'], ['stato','Stato'],
      ['site','Sito'], ['email_1','Email'], ['email_2','Email2'], ['email_3','Email3'],
      ['phone_1','Telefono'], ['phone_2','Telefono2'], ['phone_3','Telefono3'],
      ['latitude','Latitudine'], ['longitude','Longitudine'],
      ['data_follow_up_1','Follow up 1'], ['data_follow_up_2','Follow up 2'], ['note','Note']
    ];
    const diff: Array<{ key: string; label: string; from: any; to: any }> = [];
    for (const [k, lbl] of pairs) {
      const fromVal = orig?.[k];
      const toVal = e?.[k];
      const fromStr = fromVal == null ? '' : String(fromVal);
      const toStr = toVal == null ? '' : String(toVal);
      if (fromStr !== toStr) diff.push({ key: k, label: lbl, from: fromVal, to: toVal });
    }
    this.changesSummary = diff;
    this.confirmSave = true;
    this.cdr.markForCheck();
  }
}
