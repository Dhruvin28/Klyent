import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { DashboardPage } from '@/pages/DashboardPage'
import { ClientsPage } from '@/pages/ClientsPage'
import { ClientDetailPage } from '@/pages/ClientDetailPage'
import { PaymentsPage } from '@/pages/PaymentsPage'
import { FilesPage } from '@/pages/FilesPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { SharePage } from '@/pages/SharePage'
import { FreelancePage } from '@/pages/FreelancePage'
import { FreelanceDetailPage } from '@/pages/FreelanceDetailPage'
import { ProposalsPage } from '@/pages/ProposalsPage'
import { CreateProposalPage } from '@/pages/CreateProposalPage'
import { CreateCostBreakupProposalPage } from '@/pages/CreateCostBreakupProposalPage'
import { ProposalDetailPage } from '@/pages/ProposalDetailPage'
import { ProposalSharePage } from '@/pages/ProposalSharePage'
import { InvoicesPage } from '@/pages/InvoicesPage'
import { CreateInvoicePage } from '@/pages/CreateInvoicePage'
import { InvoiceDetailPage } from '@/pages/InvoiceDetailPage'
import { InvoiceSharePage } from '@/pages/InvoiceSharePage'
import { Toaster } from '@/components/ui/toast'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Auth routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        {/* Public share routes */}
        <Route path="/share/:token" element={<SharePage />} />
        <Route path="/proposals/share/:token" element={<ProposalSharePage />} />
        <Route path="/invoices/share/:token" element={<InvoiceSharePage />} />

        {/* Protected app routes */}
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/clients/:id" element={<ClientDetailPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/freelance" element={<FreelancePage />} />
          <Route path="/freelance/:id" element={<FreelanceDetailPage />} />
          <Route path="/proposals" element={<ProposalsPage />} />
          <Route path="/proposals/new" element={<CreateProposalPage />} />
          <Route path="/proposals/new/cost-breakup" element={<CreateCostBreakupProposalPage />} />
          <Route path="/proposals/:id" element={<ProposalDetailPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/invoices/new" element={<CreateInvoicePage />} />
          <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}
