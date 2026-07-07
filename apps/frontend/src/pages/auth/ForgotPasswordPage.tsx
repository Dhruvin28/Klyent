import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Layers, Loader2, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useForgotPassword, useVerifyOtp, useResetPassword } from '@/hooks/useAuth'
import { useToast } from '@/components/ui/toast'

type Step = 'email' | 'otp' | 'password'

const emailSchema = z.object({
  email: z.string().email('Enter a valid email address'),
})
type EmailFormData = z.infer<typeof emailSchema>

const otpSchema = z.object({
  otp: z.string().length(6, 'Enter the 6-digit code'),
})
type OtpFormData = z.infer<typeof otpSchema>

const passwordSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
type PasswordFormData = z.infer<typeof passwordSchema>

function extractErrorMessage(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.error ||
    (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.message ||
    fallback
  )
}

function PasswordCriteria({ password }: { password: string }) {
  const criteria = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'One uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'One number', met: /[0-9]/.test(password) },
  ]
  if (!password) return null
  return (
    <ul className="mt-2 space-y-1">
      {criteria.map(({ label, met }) => (
        <li key={label} className={`flex items-center gap-1.5 text-xs ${met ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
          {met ? <Check className="h-3 w-3 shrink-0" /> : <X className="h-3 w-3 shrink-0" />}
          {label}
        </li>
      ))}
    </ul>
  )
}

export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [resetToken, setResetToken] = useState('')

  const forgotPassword = useForgotPassword()
  const verifyOtp = useVerifyOtp()
  const resetPassword = useResetPassword()

  const emailForm = useForm<EmailFormData>({ resolver: zodResolver(emailSchema) })
  const otpForm = useForm<OtpFormData>({ resolver: zodResolver(otpSchema) })
  const passwordForm = useForm<PasswordFormData>({ resolver: zodResolver(passwordSchema) })
  const newPasswordValue = passwordForm.watch('newPassword', '')

  const onSubmitEmail = async (data: EmailFormData) => {
    try {
      await forgotPassword.mutateAsync(data.email)
      setEmail(data.email)
      setStep('otp')
      toast({ title: 'Check your email', description: 'If an account exists for that email, a code has been sent.' })
    } catch (err: unknown) {
      toast({
        title: 'Something went wrong',
        description: extractErrorMessage(err, 'Could not send the reset code. Please try again.'),
        variant: 'destructive',
      })
    }
  }

  const onSubmitOtp = async (data: OtpFormData) => {
    try {
      const { resetToken } = await verifyOtp.mutateAsync({ email, otp: data.otp })
      setResetToken(resetToken)
      setStep('password')
    } catch (err: unknown) {
      toast({
        title: 'Invalid code',
        description: extractErrorMessage(err, 'That code is invalid or has expired.'),
        variant: 'destructive',
      })
    }
  }

  const onSubmitPassword = async (data: PasswordFormData) => {
    try {
      await resetPassword.mutateAsync({ resetToken, newPassword: data.newPassword })
      toast({ title: 'Password updated', description: 'You can now sign in with your new password.' })
      navigate('/login', { replace: true })
    } catch (err: unknown) {
      toast({
        title: 'Could not reset password',
        description: extractErrorMessage(err, 'The reset link expired. Please start again.'),
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Layers className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">Klyent</h1>
            <p className="text-sm text-muted-foreground">Reset your password</p>
          </div>
        </div>

        <Card>
          {step === 'email' && (
            <>
              <CardHeader className="space-y-1 pb-4">
                <CardTitle className="text-xl">Forgot password</CardTitle>
                <CardDescription>Enter your email and we'll send you a one-time code</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={emailForm.handleSubmit(onSubmitEmail)} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      autoComplete="email"
                      {...emailForm.register('email')}
                    />
                    {emailForm.formState.errors.email && (
                      <p className="text-xs text-destructive">{emailForm.formState.errors.email.message}</p>
                    )}
                  </div>
                  <Button type="submit" className="w-full" disabled={emailForm.formState.isSubmitting}>
                    {emailForm.formState.isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending code...
                      </>
                    ) : (
                      'Send code'
                    )}
                  </Button>
                </form>
              </CardContent>
            </>
          )}

          {step === 'otp' && (
            <>
              <CardHeader className="space-y-1 pb-4">
                <CardTitle className="text-xl">Enter code</CardTitle>
                <CardDescription>We sent a 6-digit code to {email}</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={otpForm.handleSubmit(onSubmitOtp)} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="otp">One-time code</Label>
                    <Input
                      id="otp"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="123456"
                      autoComplete="one-time-code"
                      {...otpForm.register('otp')}
                    />
                    {otpForm.formState.errors.otp && (
                      <p className="text-xs text-destructive">{otpForm.formState.errors.otp.message}</p>
                    )}
                  </div>
                  <Button type="submit" className="w-full" disabled={otpForm.formState.isSubmitting}>
                    {otpForm.formState.isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      'Verify code'
                    )}
                  </Button>
                  <button
                    type="button"
                    className="w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
                    onClick={() => setStep('email')}
                  >
                    Use a different email
                  </button>
                </form>
              </CardContent>
            </>
          )}

          {step === 'password' && (
            <>
              <CardHeader className="space-y-1 pb-4">
                <CardTitle className="text-xl">Set new password</CardTitle>
                <CardDescription>Choose a new password for your account</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={passwordForm.handleSubmit(onSubmitPassword)} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="newPassword">New password</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      placeholder="Min. 8 characters"
                      autoComplete="new-password"
                      {...passwordForm.register('newPassword')}
                    />
                    {passwordForm.formState.errors.newPassword ? (
                      <p className="text-xs text-destructive">{passwordForm.formState.errors.newPassword.message}</p>
                    ) : (
                      <PasswordCriteria password={newPasswordValue} />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="confirmPassword">Confirm password</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="Repeat password"
                      autoComplete="new-password"
                      {...passwordForm.register('confirmPassword')}
                    />
                    {passwordForm.formState.errors.confirmPassword && (
                      <p className="text-xs text-destructive">{passwordForm.formState.errors.confirmPassword.message}</p>
                    )}
                  </div>
                  <Button type="submit" className="w-full" disabled={passwordForm.formState.isSubmitting}>
                    {passwordForm.formState.isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Updating password...
                      </>
                    ) : (
                      'Update password'
                    )}
                  </Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Remembered your password?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
