import { Component, OnInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Chart, registerables } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { UserService } from '../../../services/user.service';

// Plugin to paint chart area background using a color (supports dark/light)
const chartAreaBg = {
  id: 'chartAreaBg',
  beforeDraw(chart: any, _args: any, options: any) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    ctx.save();
    ctx.fillStyle = options?.color || '#ffffff';
    ctx.fillRect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
    ctx.restore();
  }
};

Chart.register(...registerables, ChartDataLabels, chartAreaBg as any);

type StatusAgg = { status: string; total: number };

@Component({
  selector: 'app-charts-page',
  templateUrl: './charts.html',
  styleUrl: './charts.scss',
  standalone: false
})
export class ChartsPage implements OnInit, OnDestroy {
  loading = true;
  error = false;
  data: StatusAgg[] = [];
  totalContacts = 0;
  kpi: { label: string; value: number }[] = [];
  partnerKpi: { label: string; value: number }[] = [];
  activePartners = 0;
  partnersTotal = 0;
  kpiTotal = 0;

  // PrimeNG Chart inputs
  barData: any;
  barOptions: any;
  pieData: any;
  pieOptions: any;
  partnerPieData: any;
  partnerPieOptions: any;
  assignData: any;
  assignOptions: any;
  partnerAssignData: any;
  partnerAssignOptions: any;
  private assignRaw?: { mine: number; others: number; total: number };

  private observer?: MutationObserver;
  private meUsername: string | null = null;
  private navSub?: Subscription;
  private visHandler?: () => void;

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef, private user: UserService, private router: Router) {}

  ngOnInit(): void {
    // load current user to compute assign share
    this.user.refreshMe().subscribe({
      next: (me) => { this.meUsername = me?.username || null; this.fetch(); },
      error: () => { this.meUsername = null; this.fetch(); }
    });
    // Recompute chart palettes when theme changes (data-theme attribute)
    if (typeof document !== 'undefined') {
      this.observer = new MutationObserver(() => {
        if (!this.loading && !this.error && this.data.length) {
          this.setupCharts();
          if (this.assignRaw) this.setupAssignPie(this.assignRaw);
          this.cdr.markForCheck();
        }
      });
      this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

      // Refresh charts when tab becomes visible again
      this.visHandler = () => { if (document.visibilityState === 'visible') this.fetch(); };
      document.addEventListener('visibilitychange', this.visHandler);
    }

    // Also refresh when route becomes active (defensive)
    this.navSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        // simple match on path segment
        if ((e.urlAfterRedirects || e.url).includes('/grafici')) this.fetch();
      });
  }

  ngOnDestroy(): void {
    try { this.observer?.disconnect(); } catch {}
    try { if (this.visHandler) document.removeEventListener('visibilitychange', this.visHandler); } catch {}
    try { this.navSub?.unsubscribe(); } catch {}
  }

  private fetch(): void {
    this.loading = true;
    this.error = false;
    this.http.get<StatusAgg[]>(`${environment.apiBase}/contacts-by-status`).subscribe({
      next: (rows) => {
        const normalized = (rows || []).map(r => ({
          status: (r.status && r.status.trim()) ? r.status : (this.docLang() === 'en' ? 'Unknown' : 'Sconosciuto'),
          total: Number(r.total || 0)
        }));
        // Ensure all known statuses are present (even with 0)
        const known = ['Non contattato', 'Contattato', 'Primo follow up', 'Secondo follow up', 'Scartato'];
        const map = new Map<string, number>();
        for (const r of normalized) map.set(r.status, (map.get(r.status) || 0) + r.total);
        const full: StatusAgg[] = [];
        for (const k of known) full.push({ status: k, total: map.get(k) || 0 });
        // Include Unknown and any unexpected statuses at the end
        const added = new Set(known);
        const unkKey = this.docLang() === 'en' ? 'Unknown' : 'Sconosciuto';
        if (map.has('Unknown')) full.push({ status: unkKey, total: map.get('Unknown') || 0 });
        for (const [k, v] of map.entries()) {
          if (!added.has(k) && k !== 'Unknown') full.push({ status: k, total: v });
        }
        this.data = full;
        // KPIs from statuses
        const by = new Map(full.map(r => [r.status, r.total]));
        const names = ['Non contattato','Contattato','Primo follow up','Secondo follow up','Scaduto'];
        this.kpi = names.map(n => ({ label: n, value: Number(by.get(n) || 0) }));
        this.kpiTotal = full.reduce((s, r) => s + Number(r.total || 0), 0);
        this.setupCharts();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = true;
        this.loading = false;
        this.cdr.markForCheck();
      }
    });

    // Fetch partner stats (active partners KPI)
    this.http.get<{ total: number; active: number; byStatus?: Record<string, number> }>(`${environment.apiBase}/partner/stats`).subscribe({
      next: (s) => {
        this.activePartners = Number(s?.active || 0);
        this.partnersTotal = Number(s?.total || 0);
        const by = s?.byStatus || {};
        const keys = ['attivo','configurazione','sviluppo','dismissione'];
        this.partnerKpi = keys.map(k => ({ label: this.partnerStatusLabel(k), value: Number((by as any)[k] || 0) }));
        // Partner distribution pie
        const labelsP = keys.map(k => this.partnerStatusLabel(k));
        const valuesP = keys.map(k => Number((by as any)[k] || 0));
        const css = getComputedStyle(document.documentElement);
        const paletteP = this.buildPartnerPalette(labelsP, css);
        const totalP = Math.max(1, valuesP.reduce((s0, v) => s0 + v, 0));
        this.partnerPieData = { labels: labelsP, datasets: [{ data: valuesP, backgroundColor: paletteP, hoverOffset: 8 }] };
        this.partnerPieOptions = {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom' },
            chartAreaBg: { color: css.getPropertyValue('--panel')?.trim() || '#ffffff' },
            datalabels: {
              color: '#ffffff',
              formatter: (v: number) => {
                const pct = Math.round((v / totalP) * 100);
                return `${v} (${pct}%)`;
              }
            }
          }
        };
        this.cdr.markForCheck();
      },
      error: () => {}
    });

    // Fetch assign share pie (two slices)
    const params = this.meUsername ? `?assign=${encodeURIComponent(this.meUsername)}` : '';
    this.http.get<{ mine: number; others: number; total: number }>(`${environment.apiBase}/assign-share${params}`).subscribe({
      next: (res) => {
        this.assignRaw = res;
        this.totalContacts = Number(res?.total || 0);
        this.setupAssignPie(res);
        this.cdr.markForCheck();
      },
      error: () => {
        // Fallback total from statuses sum
        this.totalContacts = this.data.reduce((s, r) => s + r.total, 0);
      }
    });

    // Partner assign share pie
    const partnerParams = this.meUsername ? `?assign=${encodeURIComponent(this.meUsername)}` : '';
    this.http.get<{ mine: number; others: number; total: number }>(`${environment.apiBase}/partner/assign-share${partnerParams}`).subscribe({
      next: (res) => {
        this.setupPartnerAssignPie(res);
        this.cdr.markForCheck();
      },
      error: () => {}
    });
  }

  private setupCharts(): void {
    const labels = this.data.map(d => d.status);
    const values = this.data.map(d => d.total);
    const totalAll = values.reduce((a, b) => a + b, 0) || 1;

    const css = getComputedStyle(document.documentElement);
    const palette = this.buildStatePalette(labels, css);
    const tickColor = css.getPropertyValue('--color-text-secondary')?.trim() || '#64748B';
    const axisColor = css.getPropertyValue('--color-border')?.trim() || '#E2E8F0';
    const barLabelColor = css.getPropertyValue('--color-text-primary')?.trim() || '#0F172A';
    const pieLabelColor = '#ffffff';
    const chartBg = css.getPropertyValue('--panel')?.trim() || '#ffffff';

    // Bar (horizontal)
    this.barData = {
      labels,
      datasets: [
        {
          label: this.docLang() === 'en' ? 'Contacts' : 'Contatti',
          data: values,
          backgroundColor: palette,
          borderColor: palette,
          borderWidth: 1
        }
      ]
    };
    this.barOptions = {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        chartAreaBg: { color: chartBg },
        datalabels: {
          anchor: 'end',
          align: 'right',
          color: barLabelColor,
          formatter: (v: number) => {
            const pct = Math.round((v / totalAll) * 100);
            return `${v} (${pct}%)`;
          }
        },
        tooltip: {
          callbacks: {
            label: (ctx: any) => {
              const v = ctx.parsed.x || 0;
              const pct = Math.round((v / totalAll) * 100);
              return `${v} (${pct}%)`;
            }
          }
        }
      },
      scales: {
        x: { beginAtZero: true, grid: { color: axisColor }, ticks: { precision: 0, color: tickColor } },
        y: { grid: { color: axisColor }, ticks: { autoSkip: false, color: tickColor } }
      }
    };

    // Pie
    this.pieData = {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: palette,
          hoverOffset: 8
        }
      ]
    };
    this.pieOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        chartAreaBg: { color: chartBg },
        datalabels: {
          color: pieLabelColor,
          formatter: (v: number) => {
            const pct = Math.round((v / totalAll) * 100);
            return `${v} (${pct}%)`;
          }
        },
        tooltip: {
          callbacks: {
            label: (ctx: any) => {
              const v = ctx.parsed || 0;
              const pct = Math.round((v / totalAll) * 100);
              const label = ctx.label || '';
              return `${label}: ${v} (${pct}%)`;
            }
          }
        }
      }
    };
  }

  private setupAssignPie(data: { mine: number; others: number; total: number }): void {
    const css = getComputedStyle(document.documentElement);
    const pieLabelColor = '#ffffff';
    const chartBg = css.getPropertyValue('--panel')?.trim() || '#ffffff';
    const myColor = css.getPropertyValue('--color-primary')?.trim() || '#3B82F6';
    const otherColor = css.getPropertyValue('--icon-color')?.trim() || '#94a3b8';
    const labels = [this.docLang() === 'en' ? 'Mine' : 'Assegnati a me', this.docLang() === 'en' ? 'Others' : 'Altri'];
    const values = [Math.max(0, data?.mine || 0), Math.max(0, data?.others || 0)];
    const totalAll = Math.max(1, (data?.total || 0));
    this.assignData = {
      labels,
      datasets: [{ data: values, backgroundColor: [myColor, otherColor], hoverOffset: 8 }]
    };
    this.assignOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        chartAreaBg: { color: chartBg },
        datalabels: {
          color: pieLabelColor,
          formatter: (v: number) => {
            const pct = Math.round((v / totalAll) * 100);
            return `${v} (${pct}%)`;
          }
        },
        tooltip: {
          callbacks: {
            label: (ctx: any) => {
              const v = ctx.parsed || 0;
              const pct = Math.round((v / totalAll) * 100);
              const label = ctx.label || '';
              return `${label}: ${v} (${pct}%)`;
            }
          }
        }
      }
    };
  }

  private docLang(): 'it' | 'en' {
    const l = (typeof document !== 'undefined' && document.documentElement?.lang) || 'it';
    return l === 'en' ? 'en' : 'it';
  }

  private setupPartnerAssignPie(data: { mine: number; others: number; total: number }): void {
    const css = getComputedStyle(document.documentElement);
    const pieLabelColor = '#ffffff';
    const chartBg = css.getPropertyValue('--panel')?.trim() || '#ffffff';
    const myColor = css.getPropertyValue('--color-primary')?.trim() || '#3B82F6';
    const otherColor = css.getPropertyValue('--icon-color')?.trim() || '#94a3b8';
    const labels = [this.docLang() === 'en' ? 'Mine' : 'Assegnati a me', this.docLang() === 'en' ? 'Others' : 'Altri'];
    const values = [Math.max(0, data?.mine || 0), Math.max(0, data?.others || 0)];
    const totalAll = Math.max(1, (data?.total || 0));
    this.partnerAssignData = { labels, datasets: [{ data: values, backgroundColor: [myColor, otherColor], hoverOffset: 8 }] };
    this.partnerAssignOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        chartAreaBg: { color: chartBg },
        datalabels: {
          color: pieLabelColor,
          formatter: (v: number) => {
            const pct = Math.round((v / totalAll) * 100);
            return `${v} (${pct}%)`;
          }
        }
      }
    };
  }

  private kpiLabelActive(): string {
    return this.docLang() === 'en' ? 'Active clients' : 'Clienti attivi';
  }

  private partnerStatusLabel(k: string): string {
    const it: Record<string,string> = { attivo: 'Attivo', configurazione: 'Configurazione', sviluppo: 'Sviluppo', dismissione: 'Dismissione' };
    const en: Record<string,string> = { attivo: 'Active', configurazione: 'Config', sviluppo: 'Development', dismissione: 'Dismissed' };
    const map = this.docLang() === 'en' ? en : it;
    return map[k] || k;
  }

  private buildStatePalette(labels: string[], css: CSSStyleDeclaration): string[] {
    const map: Record<string, string> = {
      'Non contattato': css.getPropertyValue('--state-none')?.trim() || '#94a3b8',
      'Contattato': css.getPropertyValue('--state-contacted')?.trim() || '#10b981',
      'Primo follow up': css.getPropertyValue('--state-follow1')?.trim() || '#f59e0b',
      'Secondo follow up': css.getPropertyValue('--state-follow2')?.trim() || '#d97706',
      'Scartato': css.getPropertyValue('--state-rejected')?.trim() || '#ef4444',
      'Unknown': '#64748B'
    };
    return labels.map(l => map[l] || '#3B82F6');
  }

  private buildPartnerPalette(labels: string[], css: CSSStyleDeclaration): string[] {
    const it: Record<string, string> = {
      'Attivo': css.getPropertyValue('--state-contacted')?.trim() || '#10b981',
      'Configurazione': css.getPropertyValue('--state-follow1')?.trim() || '#f59e0b',
      'Sviluppo': css.getPropertyValue('--state-follow2')?.trim() || '#d97706',
      'Dismissione': css.getPropertyValue('--state-rejected')?.trim() || '#ef4444'
    };
    const enMap: Record<string, string> = { 'Active':'#10b981', 'Config':'#f59e0b', 'Development':'#d97706', 'Dismissed':'#ef4444' };
    const map = this.docLang() === 'en' ? enMap : it;
    return labels.map(l => map[l] || '#3B82F6');
  }
}
