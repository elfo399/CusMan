import { APP_INITIALIZER, NgModule, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { HTTP_INTERCEPTORS, HttpClientModule } from '@angular/common/http';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { TableModule } from 'primeng/table';
import { ChartModule } from 'primeng/chart';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

import { AppRoutingModule } from './app-routing.module';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeng/themes/aura';
import { App } from './app';
import { LayoutComponent } from './components/elements/layout/layout';
import { NavbarComponent } from './components/elements/navbar/navbar';
import { HomeComponent } from './components/pages/home/home';
import { ClientsToCallComponent } from './components/pages/communications/clients-to-call';
import { ClientsPage } from './components/pages/clients/clients';
import { ChartsPage } from './components/pages/charts/charts';
import { MyContactsComponent } from './components/pages/my-contacts/my-contacts';
import { SettingsComponent } from './components/elements/settings/settings';
import { ProfileComponent } from './components/pages/profile/profile';
import { ScraperPage } from './components/pages/scraper/scraper';
import { KeycloakService } from './services/keycloak.service';
import { AuthInterceptor } from './interceptors/auth.interceptor';
import { TranslatePipe } from './pipes/translate.pipe';

function initKeycloak(kc: KeycloakService) {
  return () => kc.init();
}

@NgModule({
  declarations: [
    App,
    LayoutComponent,
    NavbarComponent,
    HomeComponent,
    ClientsToCallComponent,
    ClientsPage,
    ChartsPage,
    MyContactsComponent,
    SettingsComponent,
    ProfileComponent,
    ScraperPage
  ],
  imports: [
    BrowserModule,
    FormsModule,
    BrowserAnimationsModule,
    HttpClientModule,
    ButtonModule,
    DialogModule,
    TooltipModule,
    TableModule,
    ChartModule,
    ToastModule,
    AppRoutingModule,
    TranslatePipe
  ],
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    providePrimeNG({ ripple: true, theme: { preset: Aura } }),
    { provide: APP_INITIALIZER, useFactory: initKeycloak, deps: [KeycloakService], multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
    MessageService
  ],
  bootstrap: [App]
})
export class AppModule { }
