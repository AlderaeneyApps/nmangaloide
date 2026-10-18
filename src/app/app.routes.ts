import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage),
  },
  {
    path: 'tags',
    loadComponent: () => import('./pages/tags/tags.page').then((m) => m.TagsPage),
  },
  {
    path: 'favorites',
    loadComponent: () => import('./pages/favorites/favorites.page').then((m) => m.FavoritesPage),
  },
  {
    path: 'downloaded',
    loadComponent: () => import('./pages/downloaded/downloaded.page').then((m) => m.DownloadedPage),
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings.page').then((m) => m.SettingsPage),
  },
  {
    path: 'gallery/:id',
    loadComponent: () => import('./pages/gallery/gallery.page').then((m) => m.GalleryPage),
  },
  {
    path: 'gallery/:id/read',
    loadComponent: () => import('./pages/reader/reader.page').then((m) => m.ReaderPage),
  },
];
