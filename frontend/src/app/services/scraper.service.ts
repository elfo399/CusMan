import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, timer, switchMap, takeWhile } from 'rxjs';
import { environment } from '../../environments/environment';

export type SourceKey = 'google';

@Injectable({ providedIn: 'root' })
export class ScraperService {
  constructor(private http: HttpClient) {}

  createSearchJob(payload: { query: string; lat: number; lng: number; radius_m: number; categories?: string[]; sources?: SourceKey[]; limit?: number; name?: string }): Observable<{ jobId: string }> {
    return this.http.post<{ jobId: string }>(`${environment.apiBase}/v1/search`, payload);
  }

  getJob(id: string): Observable<{ id: string; name?: string | null; status: string; progress: number; error?: string | null }> {
    return this.http.get<{ id: string; name?: string | null; status: string; progress: number; error?: string | null }>(`${environment.apiBase}/v1/jobs/${id}`);
  }

  pollJob(id: string, intervalMs = 1500): Observable<{ id: string; status: string; progress: number; error?: string | null }> {
    return timer(0, intervalMs).pipe(
      switchMap(() => this.getJob(id)),
      takeWhile((j) => j.status === 'queued' || j.status === 'running', true)
    );
  }

  listJobs(limit = 50): Observable<Array<{ id: string; name?: string | null; status: string; progress: number; error?: string | null; created_at: string; params: any }>> {
    return this.http.get<Array<{ id: string; name?: string | null; status: string; progress: number; error?: string | null; created_at: string; params: any }>>(
      `${environment.apiBase}/v1/jobs`, { params: { limit } }
    );
  }

  countRows(jobId: string): Observable<{ total: number }> {
    return this.http.get<{ total: number }>(`${environment.apiBase}/v1/jobs/${encodeURIComponent(jobId)}/count`);
  }

  exportUrl(id: string, format: 'csv' | 'json' | 'jsonl' = 'csv'): string {
    return `${environment.apiBase}/v1/export/${encodeURIComponent(id)}?format=${encodeURIComponent(format)}`;
  }

  enrichContacts(payload: { website?: string; domain?: string; emails?: string[] }): Observable<{ emails: string[] }> {
    return this.http.post<{ emails: string[] }>(`${environment.apiBase}/v1/enrich-contacts`, payload);
  }

  listPlaces(jobId: string, limit = 20, offset = 0): Observable<Array<{ name: string; address: string; phone?: string | null; website?: string | null; rating?: number | null; reviewsCount?: number | null; lat?: number | null; lng?: number | null; categories?: string[] }>> {
    return this.http.get<Array<{ name: string; address: string; phone?: string | null; website?: string | null; rating?: number | null; reviewsCount?: number | null; lat?: number | null; lng?: number | null; categories?: string[] }>>(
      `${environment.apiBase}/v1/jobs/${encodeURIComponent(jobId)}/places`,
      { params: { limit, offset } }
    );
  }

  importJob(jobId: string): Observable<{ inserted: number; total: number }> {
    return this.http.post<{ inserted: number; total: number }>(`${environment.apiBase}/v1/jobs/${encodeURIComponent(jobId)}/import`, {});
  }
}
