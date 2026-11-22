import type { ReactNode } from 'react';
import { Guard } from './auth.js';
import { APP } from './config.js';
import { AdminPage } from './pages/Admin.js';
import { ListPage } from './pages/List.js';
import { LoginPage } from './pages/Login.js';
import { RecordPage } from './pages/Record.js';
import { ReportsPage } from './pages/Reports.js';

/** The client routes and the guard each one sits behind. */
export const routes: { path: string; element: ReactNode }[] = [
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <Guard>
        <ListPage />
      </Guard>
    ),
  },
  {
    path: '/record/:id',
    element: (
      <Guard>
        <RecordPage />
      </Guard>
    ),
  },
  {
    path: '/reports',
    element: (
      <Guard roles={APP.reportRoles}>
        <ReportsPage />
      </Guard>
    ),
  },
  {
    path: '/admin',
    element: (
      <Guard>
        <AdminPage />
      </Guard>
    ),
  },
];
