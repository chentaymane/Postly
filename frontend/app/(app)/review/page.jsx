import { redirect } from 'next/navigation';

// Review is the "Needs you" tab of Schedule now. Old links still land there.
export default function ReviewPage() {
  redirect('/schedule?tab=review');
}
