import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface Cliente {
  id: number;
  nome: string;
  citta: string;
  categoria: string;
  assegnato: string;
  stato: string;
  site?: string | null;
  data_start?: string | null;
  data_follow_up_1?: string | null;
  data_follow_up_2?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ClientiService {
  constructor(private http: HttpClient) {}

  getClientiDaChiamare(opts?: { q?: string; limit?: number; offset?: number; city?: string[]; category?: string[]; status?: string[]; assign?: string[]; sort?: 'id' | 'name' | 'city' | 'category' | 'status' | 'assign'; dir?: 'asc' | 'desc' }): Observable<{ items: Cliente[]; total: number }> {
    let params = new HttpParams();
    if (opts?.q) params = params.set('q', opts.q);
    if (opts?.limit) params = params.set('limit', String(opts.limit));
    if (opts?.offset) params = params.set('offset', String(opts.offset));
    if (opts?.city?.length) params = params.set('city', opts.city.join(','));
    if (opts?.category?.length) params = params.set('category', opts.category.join(','));
    if (opts?.status?.length) params = params.set('status', opts.status.join(','));
    if (opts?.sort) params = params.set('sort', opts.sort);
    if (opts?.dir) params = params.set('dir', opts.dir);
    if (opts?.assign?.length) params = params.set('assign', opts.assign.join(','));
    return this.http
      .get<Cliente[]>(`${environment.apiBase}/clienti-da-chiamare`, { params, observe: 'response' as const })
      .pipe(
        map((resp) => ({
          items: resp.body || [],
          total: Number(resp.headers.get('X-Total-Count') || '0')
        }))
      );
  }

  // Rows from DB clienti table
  getClienti(opts?: { q?: string; limit?: number; offset?: number }): Observable<any[]> {
    let params = new HttpParams();
    if (opts?.q) params = params.set('q', opts.q);
    if (opts?.limit) params = params.set('limit', String(opts.limit));
    if (opts?.offset) params = params.set('offset', String(opts.offset));
    return this.http.get<any[]>(`${environment.apiBase}/clienti`, { params });
  }

  getClienteById(id: number): Observable<any> {
    return this.http.get<any>(`${environment.apiBase}/clienti/${id}`);
  }

  updateCliente(id: number, payload: any): Observable<any> {
    return this.http.put<any>(`${environment.apiBase}/clienti/${id}`, payload);
  }

  deleteCliente(id: number): Observable<void> {
    return this.http.delete<void>(`${environment.apiBase}/clienti/${id}`);
  }

  getFilters(opts?: { assign?: string[] }): Observable<{ cities: string[]; categories: string[]; statuses: string[] }> {
    let params = new HttpParams();
    if (opts?.assign?.length) params = params.set('assign', opts.assign.join(','));
    return this.http.get<{ cities: string[]; categories: string[]; statuses: string[] }>(`${environment.apiBase}/clienti/filters`, { params });
  }

  createCliente(payload: any): Observable<any> {
    return this.http.post<any>(`${environment.apiBase}/clienti`, payload);
  }

  importBatch(items: Array<Partial<{ name: string; site?: string | null; city?: string | null; category?: string | null; email_1?: string | null; email_2?: string | null; email_3?: string | null; phone_1?: string | null; phone_2?: string | null; phone_3?: string | null; latitude?: number | null; longitude?: number | null; assign?: string | null; contact_method?: string | null; data_start?: string | null; data_follow_up_1?: string | null; data_follow_up_2?: string | null; status?: string | null; note?: string | null }>>): Observable<{ inserted: number; failed: number; errors: Array<{ index: number; code: string }> }> {
    return this.http.post<{ inserted: number; failed: number; errors: Array<{ index: number; code: string }> }>(
      `${environment.apiBase}/clienti/batch`,
      { items }
    );
  }

  // Same as importBatch but emits upload progress events
  importBatchProgress(items: Array<Partial<{ name: string; site?: string | null; city?: string | null; category?: string | null; email_1?: string | null; email_2?: string | null; email_3?: string | null; phone_1?: string | null; phone_2?: string | null; phone_3?: string | null; latitude?: number | null; longitude?: number | null; assign?: string | null; contact_method?: string | null; data_start?: string | null; data_follow_up_1?: string | null; data_follow_up_2?: string | null; status?: string | null; note?: string | null }>>): Observable<HttpEvent<any>> {
    return this.http.post<any>(`${environment.apiBase}/clienti/batch`, { items }, { observe: 'events', reportProgress: true });
  }

  exportClienti(opts?: { q?: string; city?: string[]; category?: string[]; status?: string[]; assign?: string[]; sort?: 'id'|'name'|'city'|'category'|'status'|'assign'; dir?: 'asc'|'desc' }): Observable<Blob> {
    let params = new HttpParams();
    if (opts?.q) params = params.set('q', opts.q);
    if (opts?.city?.length) params = params.set('city', opts.city.join(','));
    if (opts?.category?.length) params = params.set('category', opts.category.join(','));
    if (opts?.status?.length) params = params.set('status', opts.status.join(','));
    if (opts?.assign?.length) params = params.set('assign', opts.assign.join(','));
    if (opts?.sort) params = params.set('sort', opts.sort);
    if (opts?.dir) params = params.set('dir', opts.dir);
    return this.http.get(`${environment.apiBase}/clienti/export`, { params, responseType: 'blob' as const });
  }
}
