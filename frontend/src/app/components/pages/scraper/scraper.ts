import { Component, AfterViewInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { environment } from '../../../../environments/environment';
import { ScraperService } from '../../../services/scraper.service';
import { finalize } from 'rxjs/operators';
import { MessageService } from 'primeng/api';
import { UserService } from '../../../services/user.service';

declare const google: any;

@Component({
  selector: 'app-scraper-page',
  templateUrl: './scraper.html',
  styleUrl: './scraper.scss',
  standalone: false
})
export class ScraperPage implements AfterViewInit, OnDestroy {
  // Form fields
  query = '';
  lat: number | null = null;
  lng: number | null = null;
  radius_m = 1000;
  // Only Google Places is supported now
  limit = 50;
  // Optional job name
  newName: string = '';

  creating = false;
  jobId: string | null = null;
  status: string | null = null;
  progress = 0;
  error: string | null = null;
  preview: Array<{ name: string; address: string; phone?: string | null; website?: string | null; rating?: number | null; reviewsCount?: number | null }> = [];
  importing = false;
  importResult: { inserted: number; total: number } | null = null;
  // Jobs list + modal state
  jobs: Array<{ id: string; name?: string | null; status: string; progress: number; error?: string | null; created_at: string; params: any }> = [];
  showNewModal = false;
  private jobsRefreshHandle: any = null;
  private gmap: any = null;
  private gmarker: any = null;
  // Previews and import state per job
  previews: { [id: string]: Array<{ name: string; address: string; phone?: string | null; website?: string | null; rating?: number | null; reviewsCount?: number | null }> } = {};
  importingById: { [id: string]: boolean } = {};
  importResultById: { [id: string]: { inserted: number; total: number } | null } = {};

  // Full preview modal state per job
  showPreviewModal = false;
  previewJobId: string | null = null;
  previewItems: Array<{ name: string; address: string; phone?: string | null; website?: string | null; rating?: number | null; reviewsCount?: number | null }> = [];
  previewPage = 1;
  previewPageSize = 50;
  previewHasNext = false;
  previewIdx = 0;

  // Confirm import modal state
  showConfirmImport = false;
  pendingImportJobId: string | null = null;
  pendingImportCount: number | null = null;
  // Access control based on user having saved a Google Places key
  canUseScraper = false;

  constructor(private api: ScraperService, private cdr: ChangeDetectorRef, private sanitizer: DomSanitizer, private msg: MessageService, private user: UserService) {}

  ngOnInit(): void {
    this.loadJobs();
    this.startJobsAutoLoad();
    this.user.me$.subscribe((me) => {
      const ok = !!(me && me.hasGooglePlacesKey);
      if (this.canUseScraper !== ok) {
        this.canUseScraper = ok;
        try { this.cdr.detectChanges(); } catch {}
      }
    });
    this.user.refreshMe().subscribe();
  }

  ngAfterViewInit(): void {
    // Fallback load after first paint in case init races
    setTimeout(() => {
      if (!this.jobs?.length) this.loadJobs();
    }, 600);
  }

  ngOnDestroy(): void {
    this.stopJobsAutoLoad();
  }

  

  poll(): void {
    if (!this.jobId) return;
    this.api.pollJob(this.jobId).subscribe({
      next: (j) => { this.status = j.status; this.progress = j.progress || 0; this.error = (j.error as any) || null; },
      error: () => {}
    });
  }

  exportUrlCsv(): string { return this.jobId ? this.api.exportUrl(this.jobId, 'csv') : '#'; }
  exportUrlJson(): string { return this.jobId ? this.api.exportUrl(this.jobId, 'json') : '#'; }

  loadPreview(): void {
    if (!this.jobId) return;
    this.api.listPlaces(this.jobId, 20).subscribe({ next: (rows) => { this.preview = rows || []; }, error: () => { this.preview = []; } });
  }

  doImport(): void {
    if (!this.jobId) return;
    this.importing = true;
    this.api.importJob(this.jobId).pipe(finalize(() => { this.importing = false; })).subscribe({
      next: (r) => { this.importResult = r; },
      error: () => { this.importResult = null; this.error = 'Import fallito'; }
    });
  }

  loadJobs(): void {
    this.api.listJobs(50).subscribe({
      next: (arr) => {
        this.jobs = arr || [];
        try { this.cdr.detectChanges(); } catch {}
      },
      error: () => {
        this.jobs = [];
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }

  private loadPreviewFor(id: string): void {
    this.api.listPlaces(id, 20, 0).subscribe({
      next: (rows) => { this.previews[id] = rows || []; try { this.cdr.detectChanges(); } catch {} },
      error: () => { this.previews[id] = []; try { this.cdr.detectChanges(); } catch {} }
    });
  }

  private startJobsAutoLoad(): void {
    this.stopJobsAutoLoad();
    // Aggiorna periodicamente in maniera continua ogni 30s
    this.jobsRefreshHandle = setInterval(() => {
      this.loadJobs();
    }, 30000);
  }

  private stopJobsAutoLoad(): void {
    if (this.jobsRefreshHandle) {
      clearInterval(this.jobsRefreshHandle);
      this.jobsRefreshHandle = null;
    }
  }

  openNew(): void {
    this.showNewModal = true;
    // Default to Bari center if empty
    this.newName = '';
    if (this.lat == null || this.lng == null || !isFinite(Number(this.lat)) || !isFinite(Number(this.lng))) {
      this.lat = 41.1171; // Bari
      this.lng = 16.8719; // Bari
    }
    setTimeout(() => this.initGoogleMap(), 0);
  }
  closeNew(): void { this.showNewModal = false; this.disposeGoogleMap(); }

  openJob(job: any): void {
    if (this.jobId === (job?.id || null)) { this.jobId = null; return; }
    this.jobId = job?.id || null;
    this.status = job?.status || null;
    this.progress = job?.progress || 0;
    this.error = job?.error || null;
    if (this.jobId && !this.previews[this.jobId]) this.loadPreviewFor(this.jobId);
    if (this.jobId && this.status !== 'completed') this.poll();
  }

  // Submit stays the same, but closes modal and refreshes list
  submit(): void {
    this.error = null;
    this.status = null;
    this.jobId = null;
    if (!this.query || this.lat == null || this.lng == null) {
      this.error = 'Compila query, coordinate e scegli almeno una fonte';
      return;
    }
    this.creating = true;
    this.api.createSearchJob({ query: this.query.trim(), lat: Number(this.lat), lng: Number(this.lng), radius_m: Number(this.radius_m), sources: ['google'], limit: Number(this.limit || 50), name: (this.newName && this.newName.trim()) ? this.newName.trim() : undefined })
      .pipe(finalize(() => { this.creating = false; }))
      .subscribe({
        next: (r) => { this.closeNew(); this.loadJobs(); this.jobId = r.jobId; try { this.msg.add({ severity: 'success', summary: 'Job creato', detail: `ID: ${r.jobId}` }); } catch {} },
        error: () => { this.error = 'Creazione job fallita'; try { this.msg.add({ severity: 'error', summary: 'Creazione job fallita' }); } catch {} }
      });
  }

  // Google Maps JS helpers (click to set coords)
  onCoordChange(): void {
    const lat = Number(this.lat); const lng = Number(this.lng);
    if (!this.gmap || !isFinite(lat) || !isFinite(lng)) return;
    const pos = { lat, lng } as any;
    this.gmap.setCenter(pos);
    this.gmap.setZoom(14);
    if (this.gmarker) this.gmarker.setPosition(pos); else this.gmarker = new google.maps.Marker({ position: pos, map: this.gmap });
  }

  private async ensureGoogleApi(): Promise<boolean> {
    if ((window as any).google?.maps) return true;
    const key = (environment as any).googleMapsKey || '';
    if (!key) return false;
    if ((window as any)._gmapLoading) return (window as any)._gmapLoading;
    (window as any)._gmapLoading = new Promise<boolean>((resolve) => {
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`;
      s.async = true; s.defer = true;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return (window as any)._gmapLoading;
  }

  private async initGoogleMap(): Promise<void> {
    const ok = await this.ensureGoogleApi();
    const el = document.getElementById('newJobMap');
    if (!el) return;
    const lat = Number(this.lat) || 41.1171; const lng = Number(this.lng) || 16.8719;
    if (!ok) {
      el.innerHTML = '<div style="display:grid;place-items:center;height:100%;color:#64748b;">Impossibile caricare Google Maps: imposta environment.googleMapsKey</div>';
      return;
    }
    try {
      this.gmap = new google.maps.Map(el, { center: { lat, lng }, zoom: 14, disableDefaultUI: false });
      this.gmarker = new google.maps.Marker({ position: { lat, lng }, map: this.gmap });
      this.gmap.addListener('click', (e: any) => {
        const ll = e.latLng; const newLat = ll?.lat?.() ?? null; const newLng = ll?.lng?.() ?? null;
        if (newLat == null || newLng == null) return;
        this.lat = Number(newLat.toFixed(6));
        this.lng = Number(newLng.toFixed(6));
        if (this.gmarker) this.gmarker.setPosition({ lat: this.lat, lng: this.lng });
        else this.gmarker = new google.maps.Marker({ position: { lat: this.lat, lng: this.lng }, map: this.gmap });
        try { this.cdr.detectChanges(); } catch {}
      });
      setTimeout(() => { try { google.maps.event.trigger(this.gmap, 'resize'); this.gmap.setCenter({ lat, lng }); } catch {} }, 50);
    } catch {}
  }

  private disposeGoogleMap(): void {
    try { if (this.gmarker) { this.gmarker.setMap(null); } } catch {}
    this.gmarker = null;
    this.gmap = null;
  }

  // Per-card helpers
  previewFor(id: string): Array<{ name: string; address: string; phone?: string | null; website?: string | null; rating?: number | null; reviewsCount?: number | null }> {
    return this.previews[id] || [];
  }
  exportingCsvUrl(id: string): string { return this.api.exportUrl(id, 'csv'); }
  exportingJsonUrl(id: string): string { return this.api.exportUrl(id, 'json'); }
  doImportFor(id: string): void {
    this.importingById[id] = true;
    this.api.importJob(id).pipe(finalize(() => { this.importingById[id] = false; try { this.cdr.detectChanges(); } catch {} })).subscribe({
      next: (r) => { this.importResultById[id] = r; try { this.msg.add({ severity: 'success', summary: 'Import completato', detail: `Importati ${r.inserted}/${r.total}` }); } catch {} },
      error: () => { this.importResultById[id] = null; try { this.msg.add({ severity: 'error', summary: 'Import fallito' }); } catch {} }
    });
  }

  openConfirmImport(id: string): void {
    this.pendingImportJobId = id;
    this.showConfirmImport = true;
    this.pendingImportCount = null;
    // load count of rows for the job
    this.api.countRows(id).subscribe({
      next: (r) => { this.pendingImportCount = Number(r?.total || 0); try { this.cdr.detectChanges(); } catch {} },
      error: () => { this.pendingImportCount = null; try { this.cdr.detectChanges(); } catch {} }
    });
  }
  closeConfirmImport(): void {
    this.showConfirmImport = false;
    this.pendingImportJobId = null;
  }
  proceedConfirmImport(): void {
    const id = this.pendingImportJobId;
    if (!id) { this.closeConfirmImport(); return; }
    this.showConfirmImport = false;
    this.doImportFor(id);
  }

  // Full preview modal handlers
  openFullPreview(id: string): void {
    this.previewJobId = id;
    this.previewPage = 1;
    this.previewIdx = 0;
    this.showPreviewModal = true;
    this.loadFullPreviewPage();
  }
  closeFullPreview(): void {
    this.showPreviewModal = false;
    this.previewJobId = null;
    this.previewItems = [];
  }
  loadFullPreviewPage(): void {
    const id = this.previewJobId;
    if (!id) return;
    const offset = (this.previewPage - 1) * this.previewPageSize;
    this.api.listPlaces(id, this.previewPageSize, offset).subscribe({
      next: (rows) => {
        const items = rows || [];
        this.previewItems = items;
        // If we got a full page, assume there may be next page
        this.previewHasNext = items.length === this.previewPageSize;
        this.previewIdx = 0;
        try { this.cdr.detectChanges(); } catch {}
      },
      error: () => {
        this.previewItems = [];
        this.previewHasNext = false;
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }
  nextPreviewPage(): void { if (this.previewHasNext) { this.previewPage++; this.loadFullPreviewPage(); } }
  prevPreviewPage(): void { if (this.previewPage > 1) { this.previewPage--; this.loadFullPreviewPage(); } }

  // KV preview helpers (mirror CSV import modal)
  previewRequiredFields(): string[] {
    return [
      'name','site','city','category','email_1','email_2','email_3','phone_1','phone_2','phone_3','latitude','longitude','assign','contact_method','data_start','data_follow_up_1','data_follow_up_2','status','note'
    ];
  }
  previewCurrent(): any | null {
    if (!this.previewItems.length) return null;
    const it: any = this.previewItems[Math.max(0, Math.min(this.previewIdx, this.previewItems.length - 1))] || {};
    const category = Array.isArray((it as any).categories) && (it as any).categories.length ? String((it as any).categories[0]) : '';
    return {
      name: it.name || '',
      site: it.website || '',
      city: it.address || '',
      category,
      email_1: '', email_2: '', email_3: '',
      phone_1: it.phone || '', phone_2: '', phone_3: '',
      latitude: it.lat != null ? String(it.lat) : '',
      longitude: it.lng != null ? String(it.lng) : '',
      assign: '', contact_method: '', data_start: '', data_follow_up_1: '', data_follow_up_2: '', status: 'Non contattato', note: ''
    };
  }
  previewMapUrl(): SafeResourceUrl | null {
    const r: any = this.previewCurrent();
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
  nextPreviewItem(): void { if (this.previewIdx < Math.max(0, this.previewItems.length - 1)) { this.previewIdx++; this.cdr.markForCheck(); } }
  prevPreviewItem(): void { if (this.previewIdx > 0) { this.previewIdx--; this.cdr.markForCheck(); } }

  exportCsv(id: string): void {
    const url = this.api.exportUrl(id, 'csv');
    try { window.open(url, '_blank'); } catch {}
    try { this.msg.add({ severity: 'info', summary: 'Download avviato', detail: 'Esportazione CSV' }); } catch {}
  }
}
