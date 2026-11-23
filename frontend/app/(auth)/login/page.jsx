import { redirect } from 'next/navigation';
import { auth } from '../../../lib/auth';
import LoginForm from '../../../components/LoginForm';

export const metadata = {
  title: 'Sign in — Postly',
  description: 'Sign in to Postly, or create a free account.',
};

export default async function LoginPage() {
  if ((await auth())?.user?.id) redirect('/dashboard');
  return <LoginForm />;
}
