import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { authMutation, verifySignupCode } from './oauth/runtime';
import { requireSupabase } from '@/lib/supabase';
import { authErrorCode, friendlyError, isObscuredSignup } from './errors';
import { passwordRejection, validateSignupPassword } from './password-policy';
import { emailCodeLength } from './email-verification';

export function useEmailAuth(signingUp: boolean, googleBusy: boolean) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const [requestedAgain, setRequestedAgain] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [operation, setOperation] = useState<'submit' | 'resend' | 'verify' | null>(null);
  const running = useRef(false);
  const lifetime = useRef(0);
  useFocusEffect(
    useCallback(() => {
      lifetime.current++;
      running.current = false;
      setOperation(null);
      return () => {
        lifetime.current++;
      };
    }, []),
  );
  const begin = (next: NonNullable<typeof operation>) => {
    if (running.current || googleBusy) return null;
    running.current = true;
    setOperation(next);
    setError('');
    const request = lifetime.current;
    return () => request === lifetime.current;
  };
  const finish = (current: () => boolean) => {
    if (current()) {
      running.current = false;
      setOperation(null);
    }
  };
  const confirm = (address: string, requested: boolean) => {
    setConfirmationEmail(address);
    setPassword('');
    setCode('');
    setRequestedAgain(false);
    setResendAt(requested ? Date.now() + 60_000 : 0);
  };
  async function submit() {
    if (running.current || googleBusy) return;
    const address = email.trim();
    const validation = {
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)
        ? undefined
        : 'Enter a valid email address.',
      password: signingUp
        ? validateSignupPassword(password)
        : password
          ? undefined
          : 'Enter your password.',
    };
    setFieldErrors(validation);
    setError('');
    if (validation.email || validation.password) return;
    const current = begin('submit');
    if (!current) return;
    try {
      const auth = requireSupabase().auth;
      if (signingUp) {
        const { data, error: failure } = await authMutation(() =>
          auth.signUp({ email: address, password }),
        );
        if (failure) throw failure;
        if (current() && !data.session) confirm(address, true);
      } else {
        const { error: failure } = await authMutation(() =>
          auth.signInWithPassword({ email: address, password }),
        );
        if (failure) throw failure;
      }
    } catch (cause) {
      if (!current()) return;
      if (signingUp && isObscuredSignup(cause)) {
        confirm(address, true);
        return;
      }
      if (authErrorCode(cause) === 'email_not_confirmed') {
        confirm(address, false);
        return;
      }
      const passwordError = passwordRejection(cause);
      if (passwordError) setFieldErrors((previous) => ({ ...previous, password: passwordError }));
      else
        setError(friendlyError(cause, 'We couldn’t connect. Check your connection and try again.'));
    } finally {
      finish(current);
    }
  }
  async function resend() {
    if (!confirmationEmail || Date.now() < resendAt) return;
    const current = begin('resend');
    if (!current) return;
    // Apply the same local cooldown to success, uncertainty and obscured no-ops.
    // Server rate limits remain authoritative across screens and devices.
    setResendAt(Date.now() + 60_000);
    setRequestedAgain(false);
    try {
      const { error: failure } = await authMutation(() =>
        requireSupabase().auth.resend({ type: 'signup', email: confirmationEmail }),
      );
      if (
        failure &&
        !isObscuredSignup(failure) &&
        !['email_already_confirmed', 'user_not_found'].includes(String(authErrorCode(failure)))
      )
        throw failure;
      if (current()) {
        setRequestedAgain(true);
        setCode('');
      }
    } catch (cause) {
      if (current())
        setError(
          friendlyError(
            cause,
            'We couldn’t request another email. Check your connection and try again.',
          ),
        );
    } finally {
      finish(current);
    }
  }
  async function verify() {
    if (
      !confirmationEmail ||
      !emailCodeLength ||
      !new RegExp(`^[0-9]{${emailCodeLength}}$`).test(code)
    )
      return;
    const current = begin('verify');
    if (!current) return;
    try {
      await verifySignupCode(confirmationEmail, code, current);
    } catch (cause) {
      if (!current()) return;
      const code = authErrorCode(cause);
      setError(
        code === 'over_request_rate_limit'
          ? 'Too many attempts. Try again later.'
          : code === 'otp_expired' ||
              code === 'access_denied' ||
              code === 'validation_failed' ||
              code === 'user_not_found'
            ? 'That code is incorrect or has expired. Check it or request a new one.'
            : 'We couldn’t verify your email. Check your connection and try again. If you already verified, sign in.',
      );
    } finally {
      finish(current);
    }
  }
  return {
    email,
    password,
    code,
    error,
    fieldErrors,
    confirmationEmail,
    requestedAgain,
    resendAt,
    operation,
    submit,
    resend,
    verify,
    editEmail(value: string) {
      setEmail(value);
      setError('');
      setFieldErrors((old) => ({ ...old, email: undefined }));
    },
    editPassword(value: string) {
      setPassword(value);
      setError('');
      setFieldErrors((old) => ({ ...old, password: undefined }));
    },
    editCode(value: string) {
      setCode(value.replace(/[^0-9]/g, '').slice(0, emailCodeLength ?? 0));
      setError('');
    },
    changeEmail() {
      if (running.current || googleBusy) return;
      lifetime.current++;
      setConfirmationEmail(null);
      setRequestedAgain(false);
      setCode('');
      setError('');
      setFieldErrors({});
    },
  };
}
