import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LayoutComponent } from './components/elements/layout/layout';
// Removed generic PageComponent; pages now have dedicated components
import { ClientsPage } from './components/pages/clients/clients';
import { ChartsPage } from './components/pages/charts/charts';
import { HomeComponent } from './components/pages/home/home';
import { ClientsToCallComponent } from './components/pages/communications/clients-to-call';
import { MyContactsComponent } from './components/pages/my-contacts/my-contacts';
import { AuthGuard } from './auth.guard';
import { ProfileComponent } from './components/pages/profile/profile';
import { ScraperPage } from './components/pages/scraper/scraper';
// Settings is now an element used inside Profile; no route here

const routes: Routes = [
  {
    path: '',
    component: LayoutComponent,
    canActivate: [AuthGuard],
  children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', component: HomeComponent, data: { titleKey: 'nav.home' } },
      { path: 'clienti-da-chiamare', component: ClientsToCallComponent, data: { titleKey: 'communications.title' } },
      { path: 'miei-contatti', component: MyContactsComponent, data: { titleKey: 'nav.myContacts' } },
      { path: 'profilo', component: ProfileComponent, data: { titleKey: 'nav.profile' } },
      { path: 'clienti', component: ClientsPage, data: { titleKey: 'nav.clients' } },
      { path: 'grafici', component: ChartsPage, data: { titleKey: 'nav.charts' } },
      { path: 'scraper', component: ScraperPage, data: { titleKey: 'nav.scraper' } },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
