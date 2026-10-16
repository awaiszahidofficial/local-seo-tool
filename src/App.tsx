import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { PublicOnlyRoute } from './components/PublicOnlyRoute'
import { AuthProvider } from './contexts/AuthProvider'
import { CrawlerPage } from './pages/CrawlerPage'
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { SignInPage } from './pages/auth/SignInPage'
import { SignUpPage } from './pages/auth/SignUpPage'
import { LocalAuditorPage } from './pages/LocalAuditorPage'
import { ServiceAreaPage } from './pages/ServiceAreaPage'
import { GbpAuditPage } from './pages/GbpAuditPage'
import { SearchConsoleCallbackPage } from './pages/SearchConsoleCallbackPage'
import { SearchConsolePage } from './pages/SearchConsolePage'
import { KeywordsPage } from './pages/KeywordsPage'
import { ListingsPage } from './pages/ListingsPage'
import { RecommendationsPage } from './pages/RecommendationsPage'
import { ReportViewPage } from './pages/ReportViewPage'
import { ReportsPage } from './pages/ReportsPage'
import { ModulePage } from './pages/ModulePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { OverviewPage } from './pages/OverviewPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { ProjectEditPage } from './pages/ProjectEditPage'
import { ProjectNewPage } from './pages/ProjectNewPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/sign-in" element={<SignInPage />} />
            <Route path="/sign-up" element={<SignUpPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          </Route>

          {/* Reachable with a recovery session, so it is neither public-only nor protected. */}
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<OverviewPage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/new" element={<ProjectNewPage />} />
              <Route path="projects/:projectId" element={<ProjectDetailPage />} />
              <Route path="projects/:projectId/edit" element={<ProjectEditPage />} />
              <Route path="crawler" element={<CrawlerPage />} />
              <Route path="page-auditor" element={<LocalAuditorPage />} />
              <Route path="service-area" element={<ServiceAreaPage />} />
              <Route path="gbp-audit" element={<GbpAuditPage />} />
              <Route path="search-console" element={<SearchConsolePage />} />
              <Route path="search-console/callback" element={<SearchConsoleCallbackPage />} />
              <Route path="listings" element={<ListingsPage />} />
              <Route path="keywords" element={<KeywordsPage />} />
              <Route path="recommendations" element={<RecommendationsPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="reports/:reportId" element={<ReportViewPage />} />
              <Route path="modules/:moduleId" element={<ModulePage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
