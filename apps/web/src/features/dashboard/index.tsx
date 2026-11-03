import type { RouteObject } from 'react-router-dom';
import Dashboard from './components/Dashboard';

export default Dashboard;

export const dashboardRoutes: RouteObject[] = [
  { index: true, element: <Dashboard /> },
];
