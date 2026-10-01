import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface PartnerCard {
  id: number;
  name: string;
  status?: string | null;
  assign?: string | null;
  domain?: string | null;
  site?: string | null;
  renew_date?: string | null;
}

export interface PartnerFull extends PartnerCard {
  referent?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  useGPS?: boolean | number | null;
  domain_expiry?: string | null;
  hosting_provider?: string | null;
  hosting_expiry?: string | null;
  ssl_expiry?: string | null;
  panel_url?: string | null;
  data_start?: string | null;
  data_end?: string | null;
  price?: number | null;
  note?: string | null;
}

@Injectable({ providedIn: 'root' })
export class PartnerService {
  constructor(private http: HttpClient) {}

  list(opts?: { limit?: number; offset?: number }): Observable<{ items: PartnerCard[]; total: number }> {
    let params = new HttpParams();
    if (opts?.limit) params = params.set('limit', String(opts.limit));
    if (opts?.offset) params = params.set('offset', String(opts.offset));
    return this.http
      .get<PartnerCard[]>(`${environment.apiBase}/partner`, { params, observe: 'response' as const })
      .pipe(map((resp) => ({ items: resp.body || [], total: Number(resp.headers.get('X-Total-Count') || '0') })));
  }

  get(id: number): Observable<PartnerFull> {
    return this.http.get<PartnerFull>(`${environment.apiBase}/partner/${id}`);
  }

  create(data: Partial<PartnerFull>): Observable<PartnerFull> {
    return this.http.post<PartnerFull>(`${environment.apiBase}/partner`, data);
  }

  update(id: number, data: Partial<PartnerFull>): Observable<PartnerFull> {
    return this.http.put<PartnerFull>(`${environment.apiBase}/partner/${id}`, data);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${environment.apiBase}/partner/${id}`);
  }

  exportAllCsv(): Observable<Blob> {
    return this.http.get(`${environment.apiBase}/partner/export?format=csv`, { responseType: 'blob' as const });
  }
}
