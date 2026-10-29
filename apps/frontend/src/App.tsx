import { lazy, Suspense } from 'react'
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
import { StudioProjectsPage } from '@/pages/studio/StudioProjectsPage'
import { StudioProjectDetailPage } from '@/pages/studio/StudioProjectDetailPage'
import { StudioAskPage } from '@/pages/studio/StudioAskPage'
import { AiPage } from '@/pages/AiPage'
import { VisualizerPage } from '@/pages/visualizer/VisualizerPage'
import { VisualizerEditorPage } from '@/pages/visualizer/VisualizerEditorPage'
import { VisualizerReviewPage } from '@/pages/visualizer/VisualizerReviewPage'
import { ProcurementPage } from '@/pages/procurement/ProcurementPage'
import { ProcurementItemPage } from '@/pages/procurement/ProcurementItemPage'
import { CreatePurchaseOrderPage } from '@/pages/procurement/CreatePurchaseOrderPage'
import { PurchaseOrderDetailPage } from '@/pages/procurement/PurchaseOrderDetailPage'
import { PurchaseOrderSharePage } from '@/pages/procurement/PurchaseOrderSharePage'
import { Toaster } from '@/components/ui/toast'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

// The 3D Designer pulls in three.js and the path tracer; load it only when opened.
const DesignerPage = lazy(() => import('@/pages/designer/DesignerPage').then((m) => ({ default: m.DesignerPage })))
const DesignerEditorPage = lazy(() => import('@/pages/designer/DesignerEditorPage').then((m) => ({ default: m.DesignerEditorPage })))
const DesignerTourPage = lazy(() => import('@/pages/designer/DesignerTourPage').then((m) => ({ default: m.DesignerTourPage })))
const lazyPage = (el: JSX.Element) => <Suspense fallback={<LoadingSpinner />}>{el}</Suspense>

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
        <Route path="/visualizer/review/:token" element={<VisualizerReviewPage />} />
        <Route path="/designer/tour/:token" element={lazyPage(<DesignerTourPage />)} />
        <Route path="/invoices/share/:token" element={<InvoiceSharePage />} />
        <Route path="/procurement/orders/share/:token" element={<PurchaseOrderSharePage />} />

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
          <Route path="/procurement" element={<ProcurementPage />} />
          <Route path="/procurement/items/:id" element={<ProcurementItemPage />} />
          <Route path="/procurement/orders/new" element={<CreatePurchaseOrderPage />} />
          <Route path="/procurement/orders/:id" element={<PurchaseOrderDetailPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/ai" element={<AiPage />} />
          <Route path="/studio" element={<StudioProjectsPage />} />
          <Route path="/studio/ask" element={<StudioAskPage />} />
          <Route path="/studio/:id" element={<StudioProjectDetailPage />} />
          <Route path="/visualizer" element={<VisualizerPage />} />
          <Route path="/visualizer/:id" element={<VisualizerEditorPage />} />
          <Route path="/designer" element={lazyPage(<DesignerPage />)} />
          <Route path="/designer/:id" element={lazyPage(<DesignerEditorPage />)} />
        </Route>

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}
