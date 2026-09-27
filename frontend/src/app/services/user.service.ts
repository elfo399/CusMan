import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface MeDto {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  emailVerified?: boolean;
  hasGooglePlacesKey?: boolean;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private _me$ = new BehaviorSubject<MeDto | null>(null);

  constructor(private http: HttpClient) {}

  get me$(): Observable<MeDto | null> {
    return this._me$.asObservable();
  }

  me(): Observable<MeDto> {
    return this.http.get<MeDto>(`${environment.apiBase}/me`);
  }

  refreshMe(): Observable<MeDto> {
    return this.me().pipe(tap((u) => this._me$.next(u)));
  }

  updateMe(payload: Partial<Pick<MeDto, 'firstName' | 'lastName' | 'email'>>): Observable<MeDto> {
    return this.http.put<MeDto>(`${environment.apiBase}/me`, payload).pipe(
      tap((u) => this._me$.next(u))
    );
  }

  // Avatar upload removed

  listUsers(): Observable<Array<{ id: string; username: string; firstName?: string; lastName?: string; email?: string }>> {
    return this.http.get<Array<{ id: string; username: string; firstName?: string; lastName?: string; email?: string }>>(
      `${environment.apiBase}/users`
    );
  }

  setGooglePlacesKey(key: string): Observable<MeDto> {
    return this.http.put<MeDto>(`${environment.apiBase}/me/google-places-key`, { key }).pipe(
      tap((u) => this._me$.next(u))
    );
  }

  clearGooglePlacesKey(): Observable<MeDto> {
    return this.http.delete<MeDto>(`${environment.apiBase}/me/google-places-key`).pipe(
      tap((u) => this._me$.next(u))
    );
  }

  getAttributes(): Observable<{ attributes: Record<string, any> }> {
    return this.http.get<{ attributes: Record<string, any> }>(`${environment.apiBase}/me/attributes`);
  }
}
